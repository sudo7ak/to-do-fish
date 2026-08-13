<script module lang="ts">
	import type { Condition, Task } from '../types';
	import type { TaskDraft, Refusal } from '../store/tasks';

	/** What the form holds. Flattened, because a form cannot edit a discriminated union directly. */
	export type SheetForm = {
		title: string;
		date: string;
		kind: 'plain' | 'time' | 'task' | 'text' | 'treat';
		at: string;
		dependsOn: string;
		before: string;
		text: string;
		treatCost: number;
		priority: boolean;
	};

	export function emptyForm(date: string): SheetForm {
		return {
			title: '',
			date,
			kind: 'plain',
			at: '18:00',
			dependsOn: '',
			before: '',
			text: '',
			treatCost: 3,
			priority: false
		};
	}

	/** Reads an existing task back into the flat form shape. */
	export function formFor(task: Task): SheetForm {
		const form = emptyForm(task.date);
		form.title = task.title;
		form.priority = task.priority ?? false;

		if (task.treatCost !== undefined) {
			return { ...form, kind: 'treat', treatCost: task.treatCost, priority: false };
		}
		if (task.condition?.kind === 'time') {
			return { ...form, kind: 'time', at: task.condition.at };
		}
		if (task.condition?.kind === 'task') {
			return {
				...form,
				kind: 'task',
				dependsOn: task.condition.taskId,
				before: task.condition.before ?? ''
			};
		}
		if (task.condition?.kind === 'text') {
			return { ...form, kind: 'text', text: task.condition.text };
		}
		return form;
	}

	/**
	 * Flat form back to a draft. A task is either a treat or conditional, never both:
	 * a reward you must also wait for is two mechanics fighting over one creature.
	 * Treats cannot be priority — they are their own special creature kind.
	 */
	export function toDraft(form: SheetForm): TaskDraft {
		const base = {
			title: form.title.trim(),
			date: form.date,
			...(form.priority && form.kind !== 'treat' ? { priority: true as const } : {})
		};

		switch (form.kind) {
			case 'treat':
				return { ...base, treatCost: Math.max(0, Math.round(form.treatCost)) };
			case 'time':
				return { ...base, condition: { kind: 'time', at: form.at } };
			case 'task':
				return {
					...base,
					condition: {
						kind: 'task',
						taskId: form.dependsOn,
						...(form.before ? { before: form.before } : {})
					} satisfies Condition
				};
			case 'text':
				return { ...base, condition: { kind: 'text', text: form.text.trim() } };
			case 'plain':
				return base;
		}
	}

	/** A form that cannot be saved yet, and why — checked before the store is asked. */
	export function formError(form: SheetForm): string | null {
		if (!form.title.trim()) return 'Give the task a name.';
		if (form.kind === 'task' && !form.dependsOn) return 'Choose the task this one waits on.';
		if (form.kind === 'text' && !form.text.trim()) return 'Describe the condition you will judge.';
		if (form.kind === 'treat' && form.treatCost < 0) return 'A treat cannot cost less than nothing.';
		return null;
	}

	export function describeRefusal(refusal: Refusal): string {
		switch (refusal.reason) {
			case 'cycle':
				return 'These tasks would wait on each other forever. Pick a different one.';
			case 'unaffordable':
				return 'Not enough pearls for that yet.';
			case 'claimed':
				return 'That treat has already been claimed.';
		}
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { validateCondition } from '../triggers/validate';
	// `Task` is already in scope from the module script above.
	import { isLive } from '../types';
	import type { Outcome } from '../store/tasks';

	/**
	 * The add and edit sheet: frosted glass sliding up over a blurred tank.
	 *
	 * Cycles are rejected here, before the task is saved, because a cycle is a
	 * structural failure rather than something evaluation should have to survive.
	 */
	type Props = {
		open: boolean;
		date: string;
		tasks: Task[];
		/** Present when editing; absent when adding. */
		task?: Task;
		onSave: (draft: ReturnType<typeof toDraft>) => Promise<Outcome>;
		onClose: () => void;
	};

	const { open, date, tasks, task, onSave, onClose }: Props = $props();

	// Seeded once; the effect below re-reads the props every time the sheet reopens,
	// so tracking them here would only fight it.
	let form = $state(untrack(() => (task ? formFor(task) : emptyForm(date))));
	let error = $state<string | null>(null);
	let saving = $state(false);

	// Reset whenever the sheet is reopened on a different task or date.
	$effect(() => {
		if (open) {
			form = task ? formFor(task) : emptyForm(date);
			error = null;
		}
	});

	/** Candidates for a dependency: live tasks on this date, never the task being edited. */
	const dependencies = $derived(
		tasks.filter((t) => isLive(t) && t.date === form.date && t.id !== task?.id)
	);

	// Immediate feedback while the dependency is being chosen, rather than on save.
	const cycleWarning = $derived.by(() => {
		if (form.kind !== 'task' || !form.dependsOn) return null;
		const check = validateCondition(tasks, {
			id: task?.id,
			condition: { kind: 'task', taskId: form.dependsOn }
		});
		return check.ok ? null : describeRefusal({ ok: false, reason: 'cycle' });
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();

		error = formError(form) ?? cycleWarning;
		if (error) return;

		saving = true;
		const result = await onSave(toDraft(form));
		saving = false;

		if (result.ok) onClose();
		else error = describeRefusal(result);
	}
</script>

{#if open}
	<div
		class="backdrop"
		role="button"
		tabindex="-1"
		aria-label="Close"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
	></div>

	<section class="sheet" aria-label={task ? 'Edit task' : 'New task'}>
		<h2>{task ? 'Edit task' : 'New task'}</h2>
		<form onsubmit={submit}>
			<label>
				<span>Task</span>
				<!-- svelte-ignore a11y_autofocus -->
				<input bind:value={form.title} autofocus placeholder="Call mum" />
			</label>

			<label>
				<span>Day</span>
				<input type="date" bind:value={form.date} />
			</label>

			{#if form.kind !== 'treat'}
				<label class="choice priority-toggle" class:selected={form.priority}>
					<input type="checkbox" bind:checked={form.priority} />
					<span>🦈 Priority</span>
				</label>
			{/if}

			<fieldset>
				<legend>When</legend>
				{#each [['plain', 'Straight away'], ['time', 'At a time'], ['task', 'After another task'], ['text', 'When I decide'], ['treat', 'Guilty pleasure']] as [value, label] (value)}
					<label class="choice" class:selected={form.kind === value}>
						<input type="radio" bind:group={form.kind} {value} />
						<span>{label}</span>
					</label>
				{/each}
			</fieldset>

			{#if form.kind === 'time'}
				<label>
					<span>Time</span>
					<input type="time" bind:value={form.at} />
				</label>
			{:else if form.kind === 'task'}
				<label>
					<span>After</span>
					<select bind:value={form.dependsOn}>
						<option value="">Choose a task…</option>
						{#each dependencies as candidate (candidate.id)}
							<option value={candidate.id}>{candidate.title}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>Only if finished before <em>(optional)</em></span>
					<input type="time" bind:value={form.before} />
				</label>
			{:else if form.kind === 'text'}
				<label>
					<span>Condition</span>
					<input bind:value={form.text} placeholder="if I finish work early" />
					<small>Nothing will prompt you. Tap the bubble when it is true.</small>
				</label>
			{:else if form.kind === 'treat'}
				<label>
					<span>Cost in pearls</span>
					<input type="number" min="0" step="1" bind:value={form.treatCost} />
				</label>
			{/if}

			{#if error || cycleWarning}
				<p class="error" role="alert">{error ?? cycleWarning}</p>
			{/if}

			<div class="actions">
				<button type="button" class="ghost" onclick={onClose}>Cancel</button>
				<button type="submit" disabled={saving}>{task ? 'Save' : 'Add'}</button>
			</div>
		</form>
	</section>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		border: 0;
		padding: 0;
		background: rgba(10, 30, 40, 0.35);
		backdrop-filter: blur(6px);
	}

	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		/* Above the list view: Edit is reachable from there, and a sheet that opens
		   behind the list cannot be used at all. */
		z-index: 21;
		/* Centred and capped. Full-bleed, the fields stretch to the whole desktop
		   width and the form stops being readable — this was designed at phone size. */
		max-width: 34rem;
		margin: 0 auto;
		max-height: 85dvh;
		overflow-y: auto;
		padding: 1.5rem 1.5rem calc(1.5rem + env(safe-area-inset-bottom));
		border-radius: 1.25rem 1.25rem 0 0;
		background: rgba(255, 255, 255, 0.9);
		backdrop-filter: blur(20px);
		box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.25);
		color: #12303a;
	}

	/* Wider than a phone: a floating card rather than a sheet welded to the edge. */
	@media (min-width: 40rem) {
		.sheet {
			inset: auto 0 2rem 0;
			border-radius: 1.25rem;
			box-shadow: 0 18px 60px rgba(0, 0, 0, 0.3);
		}
	}

	h2 {
		margin: 0 0 1.1rem;
		font-size: 1.15rem;
		font-weight: 600;
	}

	form {
		display: grid;
		gap: 0.9rem;
	}

	label {
		display: grid;
		gap: 0.35rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: rgba(18, 48, 58, 0.7);
	}

	input,
	select {
		padding: 0.7rem 0.8rem;
		border: 1px solid rgba(18, 48, 58, 0.18);
		border-radius: 0.7rem;
		background: #fff;
		font-size: 1rem;
		font-family: inherit;
		color: #12303a;
		transition: border-color 0.15s, box-shadow 0.15s;
	}

	input:focus,
	select:focus {
		outline: none;
		border-color: #12303a;
		box-shadow: 0 0 0 3px rgba(18, 48, 58, 0.12);
	}

	fieldset {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	legend {
		padding: 0 0 0.5rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: rgba(18, 48, 58, 0.7);
	}

	.choice {
		display: flex;
		align-items: center;
		padding: 0.45rem 0.85rem;
		border: 1px solid rgba(18, 48, 58, 0.14);
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.7);
		font-size: 0.85rem;
		font-weight: 500;
		color: #12303a;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s, color 0.15s;
	}

	.choice:hover {
		border-color: rgba(18, 48, 58, 0.35);
	}

	.choice.selected {
		border-color: #12303a;
		background: #12303a;
		color: #fff;
	}

	/* The native control keeps focus and keyboard behaviour; the chip is the visible
	   affordance. Bare OS radios read as a raw form, not as an app. */
	.choice input {
		position: absolute;
		width: 1px;
		height: 1px;
		opacity: 0;
	}

	.choice:focus-within {
		box-shadow: 0 0 0 3px rgba(18, 48, 58, 0.18);
	}

	small {
		opacity: 0.7;
	}

	.error {
		margin: 0;
		color: #a03325;
		font-size: 0.85rem;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}

	button {
		padding: 0.6rem 1.1rem;
		border: 0;
		border-radius: 999px;
		background: #12303a;
		color: #fff;
		font-size: 0.95rem;
		cursor: pointer;
	}

	.ghost {
		background: rgba(18, 48, 58, 0.1);
		color: #12303a;
	}
</style>

<script module lang="ts">
	import type { Task } from '../types';

	/**
	 * What a tap on a creature should do.
	 *
	 * Two taps act immediately rather than opening anything. Releasing a free-text
	 * bubble is the whole interaction for that kind of condition — the app never
	 * prompts about one, so putting a confirmation sheet in the way would be the
	 * same nagging by another name. Claiming an affordable lantern is equally
	 * unambiguous: the price is already on the creature.
	 */
	export type TapAction = 'release' | 'claim' | 'sheet';

	export function tapAction(task: Task, affordable: boolean): TapAction {
		if (task.status === 'waiting') {
			if (task.treatCost !== undefined) return affordable ? 'claim' : 'sheet';
			if (task.condition?.kind === 'text') return 'release';
		}
		return 'sheet';
	}

	/** Which buttons the sheet offers for this task. */
	export function actionsFor(task: Task, affordable: boolean): string[] {
		const actions: string[] = [];

		if (task.treatCost !== undefined && task.status === 'waiting') {
			if (affordable) actions.push('claim');
		} else if (task.status === 'waiting') {
			actions.push('release');
		}

		if (task.status !== 'done') actions.push('complete');

		actions.push('edit', 'move', 'delete');
		return actions;
	}

	/** One line describing what the creature is waiting for. */
	export function describeCondition(task: Task): string | null {
		if (task.treatCost !== undefined) {
			return task.status === 'waiting'
				? `Costs ${task.treatCost} ${task.treatCost === 1 ? 'pearl' : 'pearls'}`
				: 'Claimed';
		}

		switch (task.condition?.kind) {
			case 'time':
				return `Waiting until ${task.condition.at}`;
			case 'task':
				return task.condition.before
					? `Waiting on another task, before ${task.condition.before}`
					: 'Waiting on another task';
			case 'text':
				return task.condition.text;
			default:
				return null;
		}
	}
</script>

<script lang="ts">
	import { shiftDate, formatDay } from './DateHeader.svelte';

	/**
	 * The detail sheet for one creature: frosted glass over a blurred tank.
	 */
	type Props = {
		task: Task | null;
		/** Whether the current pearl balance covers this treat, if it is one. */
		affordable: boolean;
		onComplete: (id: string) => void;
		onRelease: (id: string) => void;
		onClaim: (id: string) => void;
		onEdit: (task: Task) => void;
		onMove: (id: string, date: string) => void;
		onDelete: (id: string) => void;
		onClose: () => void;
	};

	const {
		task,
		affordable,
		onComplete,
		onRelease,
		onClaim,
		onEdit,
		onMove,
		onDelete,
		onClose
	}: Props = $props();

	const actions = $derived(task ? actionsFor(task, affordable) : []);
	const condition = $derived(task ? describeCondition(task) : null);
	const confirmingDelete = $state({ value: false });

	// Disarm whenever the sheet moves to another creature, or a tap on one task
	// would arrive at "Really delete" for the next.
	$effect(() => {
		task?.id;
		confirmingDelete.value = false;
	});

	function act(fn: () => void) {
		fn();
		onClose();
	}
</script>

{#if task}
	<div
		class="backdrop"
		role="button"
		tabindex="-1"
		aria-label="Close"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
	></div>

	<section class="sheet" aria-label={task.title}>
		<h2>{task.title}</h2>

		<p class="meta">
			{formatDay(task.date)}
			{#if condition}<span class="dot">·</span>{condition}{/if}
			{#if task.status === 'done'}<span class="dot">·</span>Done{/if}
		</p>

		{#if task.treatCost !== undefined && task.status === 'waiting' && !affordable}
			<p class="hint">Finish more tasks to afford this one.</p>
		{/if}

		<div class="actions">
			{#if actions.includes('claim')}
				<button type="button" onclick={() => act(() => onClaim(task.id))}>Claim it</button>
			{/if}
			{#if actions.includes('release')}
				<button type="button" onclick={() => act(() => onRelease(task.id))}>
					Let it out
				</button>
			{/if}
			{#if actions.includes('complete')}
				<button type="button" onclick={() => act(() => onComplete(task.id))}>Done</button>
			{/if}

			<button type="button" class="ghost" onclick={() => act(() => onEdit(task))}>Edit</button>
			<button
				type="button"
				class="ghost"
				onclick={() => act(() => onMove(task.id, shiftDate(task.date, 1)))}
			>
				Push to tomorrow
			</button>

			{#if confirmingDelete.value}
				<button type="button" class="danger" onclick={() => act(() => onDelete(task.id))}>
					Really delete
				</button>
			{:else}
				<button type="button" class="ghost" onclick={() => (confirmingDelete.value = true)}>
					Delete
				</button>
			{/if}
		</div>
	</section>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		border: 0;
		padding: 0;
		background: rgba(10, 30, 40, 0.35);
		backdrop-filter: blur(6px);
	}

	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
		border-radius: 1.25rem 1.25rem 0 0;
		background: rgba(255, 255, 255, 0.82);
		backdrop-filter: blur(18px);
		box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.25);
		color: #12303a;
	}

	h2 {
		margin: 0;
		font-size: 1.15rem;
	}

	.meta {
		margin: 0.35rem 0 0;
		font-size: 0.85rem;
		opacity: 0.75;
	}

	.dot {
		margin: 0 0.4rem;
	}

	.hint {
		margin: 0.6rem 0 0;
		font-size: 0.85rem;
		opacity: 0.7;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 1rem;
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

	.danger {
		background: #a03325;
	}
</style>

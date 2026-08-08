<script module lang="ts">
	import { isLive, type Task } from '../types';

	/**
	 * The list view is not a fallback for a broken tank. It is a first-class second
	 * view of the same data, backed by the same store and the same actions — and the
	 * only one a keyboard or a screen reader can reach, since a canvas offers them
	 * nothing.
	 */

	export type Group = { key: string; heading: string; tasks: Task[] };

	/**
	 * Groups one date's tasks the way the tank arranges them: what is waiting, what
	 * is swimming, what is on the waterline, what is finished.
	 *
	 * Filters soft-deletes, like every derived read.
	 */
	export function groupTasks(tasks: Task[], date: string): Group[] {
		const today = tasks.filter((t) => isLive(t) && t.date === date);

		const treats = today.filter((t) => t.treatCost !== undefined && t.status === 'waiting');
		const waiting = today.filter((t) => t.treatCost === undefined && t.status === 'waiting');
		const open = today.filter((t) => t.status === 'open');
		const done = today.filter((t) => t.status === 'done');

		return [
			{ key: 'open', heading: 'Swimming', tasks: byCreated(open) },
			{ key: 'waiting', heading: 'Waiting', tasks: byCreated(waiting) },
			{ key: 'treats', heading: 'Guilty pleasures', tasks: byCreated(treats) },
			// Most recently finished first: the reverse of everything else, because a
			// long day's done list is read from the end.
			{ key: 'done', heading: 'Done', tasks: byCompleted(done) }
		].filter((group) => group.tasks.length > 0);
	}

	/** ULIDs sort by creation time, so this is also chronological. */
	function byCreated(tasks: Task[]): Task[] {
		return [...tasks].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
	}

	function byCompleted(tasks: Task[]): Task[] {
		return [...tasks].sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
	}

	/** Counts what a bulk action is about to affect, for the confirmation line. */
	export function describeSelection(count: number): string {
		if (count === 0) return 'Nothing selected';
		return `${count} ${count === 1 ? 'task' : 'tasks'} selected`;
	}
</script>

<script lang="ts">
	import { shiftDate, formatDay } from './DateHeader.svelte';
	import { describeCondition } from './CreatureSheet.svelte';

	type Props = {
		open: boolean;
		date: string;
		tasks: Task[];
		onComplete: (id: string) => void;
		onRelease: (id: string) => void;
		onEdit: (task: Task) => void;
		onMove: (id: string, date: string) => void;
		onDelete: (id: string) => void;
		onClose: () => void;
	};

	const { open, date, tasks, onComplete, onRelease, onEdit, onMove, onDelete, onClose }: Props =
		$props();

	const groups = $derived(groupTasks(tasks, date));
	let selected = $state(new Set<string>());

	// A selection that outlived the date it was made on would move the wrong tasks.
	$effect(() => {
		date;
		selected = new Set();
	});

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}

	function moveSelected(days: number) {
		for (const id of selected) {
			const task = tasks.find((t) => t.id === id);
			if (task) onMove(id, shiftDate(task.date, days));
		}
		selected = new Set();
	}

	function deleteSelected() {
		for (const id of selected) onDelete(id);
		selected = new Set();
	}
</script>

{#if open}
	<section class="list" aria-label="Task list">
		<header>
			<h2>{formatDay(date)}</h2>
			<button type="button" class="ghost" onclick={onClose}>Back to the tank</button>
		</header>

		{#if groups.length === 0}
			<p class="empty">Nothing planned for this day.</p>
		{/if}

		{#each groups as group (group.key)}
			<h3>{group.heading}</h3>
			<ul>
				{#each group.tasks as task (task.id)}
					{@const condition = describeCondition(task)}
					<li>
						<label class="pick">
							<input
								type="checkbox"
								checked={selected.has(task.id)}
								onchange={() => toggle(task.id)}
							/>
							<span class="visually-hidden">Select {task.title}</span>
						</label>

						<div class="body">
							<span class="title" class:done={task.status === 'done'}>{task.title}</span>
							{#if condition}<span class="condition">{condition}</span>{/if}
						</div>

						<div class="row-actions">
							{#if task.status === 'waiting' && task.treatCost === undefined}
								<button type="button" onclick={() => onRelease(task.id)}>Let out</button>
							{/if}
							{#if task.status !== 'done'}
								<button type="button" onclick={() => onComplete(task.id)}>Done</button>
							{/if}
							<button type="button" class="ghost" onclick={() => onEdit(task)}>Edit</button>
						</div>
					</li>
				{/each}
			</ul>
		{/each}

		{#if selected.size > 0}
			<div class="bulk" role="group" aria-label="Bulk actions">
				<span>{describeSelection(selected.size)}</span>
				<button type="button" onclick={() => moveSelected(1)}>Push to tomorrow</button>
				<button type="button" onclick={() => moveSelected(-1)}>Pull to yesterday</button>
				<button type="button" class="danger" onclick={deleteSelected}>Delete</button>
			</div>
		{/if}
	</section>
{/if}

<style>
	.list {
		position: fixed;
		inset: 0;
		overflow-y: auto;
		padding: 1rem 1rem 6rem;
		padding-top: max(1rem, env(safe-area-inset-top));
		background: rgba(245, 252, 253, 0.97);
		backdrop-filter: blur(20px);
		color: #12303a;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	h2 {
		margin: 0;
		font-size: 1.15rem;
	}

	h3 {
		margin: 1.4rem 0 0.4rem;
		font-size: 0.8rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		opacity: 0.6;
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0;
		border-bottom: 1px solid rgba(18, 48, 58, 0.08);
	}

	.body {
		display: grid;
		flex: 1;
		gap: 0.1rem;
		min-width: 0;
	}

	.title.done {
		opacity: 0.55;
		text-decoration: line-through;
	}

	.condition {
		font-size: 0.78rem;
		opacity: 0.65;
	}

	.row-actions {
		display: flex;
		gap: 0.35rem;
	}

	button {
		padding: 0.35rem 0.7rem;
		border: 0;
		border-radius: 999px;
		background: #12303a;
		color: #fff;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.ghost {
		background: rgba(18, 48, 58, 0.1);
		color: #12303a;
	}

	.danger {
		background: #a03325;
	}

	button:focus-visible,
	input:focus-visible {
		outline: 2px solid #12303a;
		outline-offset: 2px;
	}

	.bulk {
		position: fixed;
		inset: auto 0 0 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
		background: rgba(255, 255, 255, 0.95);
		box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.15);
		font-size: 0.85rem;
	}

	.empty {
		margin-top: 2rem;
		opacity: 0.6;
	}

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>

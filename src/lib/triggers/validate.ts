import { isLive, type Condition, type Task } from '../types';

/**
 * Structural failures are prevented at creation time rather than handled at
 * evaluation time. `evaluate()` is a pure read over whatever is stored; it should
 * never have to defend itself against data that could not happen.
 */

/** A task being created or edited. A brand-new task has no id yet. */
export type ConditionDraft = { id?: string; condition?: Condition };

export type ValidationResult = { ok: true } | { ok: false; reason: 'cycle' };

/**
 * Rejects a condition that would close a dependency loop — A waits on B, B waits on
 * A — at any depth, including a task waiting on itself.
 *
 * Only `task` conditions can cycle: a clock time and a sentence point at nothing.
 */
export function validateCondition(tasks: Task[], draft: ConditionDraft): ValidationResult {
	if (draft.condition?.kind !== 'task') return { ok: true };

	// A task with no id yet cannot be the target of an existing condition, so
	// following the chain can never arrive back at it.
	if (draft.id === undefined) return { ok: true };

	const byId = new Map(tasks.filter(isLive).map((t) => [t.id, t]));

	// Walk the chain the draft would create. Arriving back at the draft is the cycle.
	let cursor: string | undefined = draft.condition.taskId;
	const seen = new Set<string>();

	while (cursor !== undefined) {
		if (cursor === draft.id) return { ok: false, reason: 'cycle' };

		// A loop that does not include the draft is pre-existing bad data. Stop rather
		// than spin; the draft itself is not what closed it.
		if (seen.has(cursor)) break;
		seen.add(cursor);

		const next: Task | undefined = byId.get(cursor);
		cursor = next?.condition?.kind === 'task' ? next.condition.taskId : undefined;
	}

	return { ok: true };
}

/**
 * True when a `task` condition points at something no longer there — deleted, or
 * never saved. The bubble switches to the dashed treatment and is labelled as
 * having lost its trigger, degrading to manual release rather than waiting forever
 * on an event that can no longer happen.
 */
export function isOrphaned(tasks: Task[], task: Task): boolean {
	const condition = task.condition;
	if (condition?.kind !== 'task') return false;

	const target = tasks.find((t) => t.id === condition.taskId);
	return target === undefined || !isLive(target);
}

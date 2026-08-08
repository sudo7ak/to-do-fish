import { isLive, type KoiRecord, type Task } from '../types';

/**
 * A day clears when it has at least one non-treat task and every non-treat task on
 * it is done.
 *
 * Treats never block: a treat you chose not to buy is not unfinished work, and one
 * you bought but have not enjoyed yet is a reward, not a chore. An unreleased
 * free-text bubble does block — it is still `waiting`, and that is genuinely open.
 * Both fall out of "every non-treat task is done" without a special case.
 */
export function isDayCleared(tasks: Task[], date: string): boolean {
	const work = tasks.filter((t) => isLive(t) && t.date === date && t.treatCost === undefined);

	// An empty day is not a cleared day. Nothing happened; there is nothing to record.
	if (work.length === 0) return false;

	return work.every((t) => t.status === 'done');
}

/**
 * Awards the day's koi if it has just cleared, and otherwise returns the records
 * unchanged.
 *
 * Koi are awarded once and never revoked. Adding a task to an already-cleared past
 * day does not take the koi back — the koi records what happened, it is not a
 * recomputed status. That is why this appends to a stored list rather than deriving
 * from tasks the way pearls do.
 */
export function awardKoi(
	koi: KoiRecord[],
	tasks: Task[],
	date: string,
	now: number
): KoiRecord[] {
	if (koi.some((record) => record.date === date)) return koi;
	if (!isDayCleared(tasks, date)) return koi;

	return [...koi, { date, earnedAt: now }];
}

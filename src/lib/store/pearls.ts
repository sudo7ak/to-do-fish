import { isLive, type Task } from '../types';

/**
 * Pearls are derived, never stored. A stored balance can drift out of sync with the
 * tasks it came from; a recomputed one cannot.
 *
 *   earned = completed ordinary tasks
 *   spent  = the price of every treat that has left the waterline
 *
 * The balance is a running total across every date, not a daily figure — a pearl
 * earned on Monday buys a treat on Friday.
 */
export function pearlBalance(tasks: Task[]): number {
	const live = tasks.filter(isLive);

	const earned = live.filter((t) => t.status === 'done' && t.treatCost === undefined).length;

	// A treat counts as claimed once its status has left "waiting" — claiming is the
	// act of paying for it. Completing it later costs nothing more, and mints
	// nothing: a reward already paid for should not also pay out.
	const spent = live
		.filter((t) => t.treatCost !== undefined && t.status !== 'waiting')
		.reduce((total, t) => total + t.treatCost!, 0);

	// Deliberately unclamped. S9 refuses claims that cannot be afforded, so a
	// negative balance means a bug — and should be visible rather than floored at 0.
	return earned - spent;
}

/**
 * Whether the current balance covers this treat's price.
 *
 * Answers about price alone. A treat that has already been claimed still reports
 * true, because its cost is already counted in `spent` — so S9 must also check that
 * the treat is still `waiting` before charging, or a second claim double-spends.
 */
export function canAfford(tasks: Task[], task: Task): boolean {
	if (task.treatCost === undefined) return false;
	return pearlBalance(tasks) >= task.treatCost;
}

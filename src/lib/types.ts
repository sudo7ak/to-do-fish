/**
 * The domain model. One task type covers every creature in the tank: a bubble is a
 * task with a condition and `status: "waiting"`, a lantern is a task with
 * `treatCost`, a ghost is a task with `status: "done"`. There are no parallel type
 * hierarchies to keep in step.
 */

export type Condition =
	| { kind: 'time'; at: string } // "18:00", local clock time
	| { kind: 'task'; taskId: string; before?: string } // optional "17:00" cutoff
	| { kind: 'text'; text: string }; // manual release only — never fires from evaluate()

export type TaskStatus = 'waiting' | 'open' | 'done';

export type Task = {
	id: string; // ULID, generated client-side
	title: string;
	date: string; // "2026-08-08", local calendar date
	condition?: Condition; // absent = plain task, born as a fish
	treatCost?: number; // present = guilty pleasure, priced in pearls
	status: TaskStatus;
	createdAt: number;
	completedAt?: number;
	updatedAt: number; // bumped on every mutation
	deletedAt?: number; // soft delete; rows are never spliced out
};

export type KoiRecord = { date: string; earnedAt: number };

/**
 * `seenLegend` is a one-way latch for the first-run legend. It is a setting rather
 * than a separate storage key because `store/` reaches persistence only through the
 * `TaskStore` port, and a second key would be a second thing to migrate.
 */
export type Settings = {
	environment: 'progress' | 'calm';
	seenLegend: boolean;
	/** Bumped whenever a setting changes. The whole record is the unit of sync. */
	updatedAt: number;
};

/** Current storage schema version. Bumped when `Snapshot` changes shape. */
export const SCHEMA_VERSION = 3;

export type Snapshot = {
	version: number;
	tasks: Task[];
	koi: KoiRecord[];
	settings: Settings;
};

/**
 * Every derived read — the scene, the pearl balance, the koi rule, the trigger
 * evaluator, the list view — filters soft-deletes first. Giving that filter one
 * name makes its absence greppable; five hand-rolled copies would not be.
 *
 * Tests the field's presence rather than its truthiness: `deletedAt: 0` is a valid
 * epoch timestamp and must still count as deleted.
 */
export function isLive(task: Task): boolean {
	return task.deletedAt === undefined;
}

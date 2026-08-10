import { SCHEMA_VERSION, type KoiRecord, type Settings, type Snapshot, type Task } from '../../types';

/**
 * Reconciling two snapshots of the same tank.
 *
 * Pure on purpose: it imports nothing but the domain types, so every rule below is
 * tested as data in and data out. Merge bugs are invisible until data is already
 * gone, which is why this file — and not the network code — carries the coverage.
 */

/** Only what the remote is missing or stale on. An agreed sync pushes nothing at all. */
export type Push = { tasks: Task[]; koi: KoiRecord[]; settings?: Settings };

export type MergeResult = {
	/** What both sides should end up holding. */
	merged: Snapshot;
	push: Push;
};

export function merge(local: Snapshot, remote: Snapshot): MergeResult {
	const tasks = mergeTasks(local.tasks, remote.tasks);
	const koi = mergeKoi(local.koi, remote.koi);
	const settings = mergeSettings(local.settings, remote.settings);

	const remoteById = new Map(remote.tasks.map((task) => [task.id, task]));
	const remoteKoi = new Map(remote.koi.map((record) => [record.date, record]));

	return {
		merged: { version: SCHEMA_VERSION, tasks, koi, settings },
		push: {
			// Push the merged row, not the local one: if remote won, the two are the
			// same object and this is a no-op anyway.
			tasks: tasks.filter((task) => remoteById.get(task.id) !== task),
			koi: koi.filter((record) => remoteKoi.get(record.date)?.earnedAt !== record.earnedAt),
			// Absent when the remote already holds exactly this settings record.
			...(sameSettings(settings, remote.settings) ? {} : { settings })
		}
	};
}

function mergeTasks(local: Task[], remote: Task[]): Task[] {
	const byId = new Map(local.map((task) => [task.id, task]));

	for (const incoming of remote) {
		const mine = byId.get(incoming.id);
		byId.set(incoming.id, mine ? winner(mine, incoming) : incoming);
	}

	return [...byId.values()];
}

/**
 * Last write wins, per task, on the client `updatedAt` every mutation already bumps.
 *
 * A tie means the two clocks disagree, and the two failures are not symmetric: a
 * task that comes back from the dead is worse than a deletion that lands early, so
 * the tombstone takes the tie. Failing that, remote wins — an arbitrary but stable
 * choice, so the same pair merges the same way on both devices.
 */
function winner(local: Task, remote: Task): Task {
	if (local.updatedAt > remote.updatedAt) return local;
	if (remote.updatedAt > local.updatedAt) return remote;
	if (local.deletedAt !== undefined) return local;
	return remote;
}

/** Union, keeping the earlier award. A koi is granted once and can never be revoked. */
function mergeKoi(local: KoiRecord[], remote: KoiRecord[]): KoiRecord[] {
	const byDate = new Map(local.map((record) => [record.date, record]));

	for (const incoming of remote) {
		const mine = byDate.get(incoming.date);
		if (!mine || incoming.earnedAt < mine.earnedAt) byDate.set(incoming.date, incoming);
	}

	return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mergeSettings(local: Settings, remote: Settings): Settings {
	// A tie must resolve the same way on both devices or the record never converges:
	// if each side kept its own settings on equal timestamps, both would believe
	// they were merged and neither would push. Remote wins, matching `winner()`.
	const winner = remote.updatedAt >= local.updatedAt ? remote : local;

	// `seenLegend` is a one-way latch, so it is the one field that does not follow the
	// record. An older device syncing in must not make the first-run legend reappear.
	return { ...winner, seenLegend: local.seenLegend || remote.seenLegend };
}

/** Field-wise, because the latch above means the merged record is always a new object. */
function sameSettings(a: Settings, b: Settings): boolean {
	return (
		a.environment === b.environment && a.seenLegend === b.seenLegend && a.updatedAt === b.updatedAt
	);
}

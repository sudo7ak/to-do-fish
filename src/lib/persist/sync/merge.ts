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

/**
 * What a pull returns. Settings are optional and the difference matters: an account
 * that has never written a settings row has *no* record, which is not the same thing
 * as a record stamped `updatedAt: 0`. Migrated local settings are stamped 0 too, so a
 * synthesised zero would tie — and the tie goes to remote, silently replacing a choice
 * the user made with the default, at the exact moment they first sign in.
 */
export type RemoteSnapshot = Omit<Snapshot, 'settings' | 'owner'> & { settings?: Settings };

export type MergeResult = {
	/** What both sides should end up holding. */
	merged: Snapshot;
	push: Push;
};

/**
 * Which snapshot this account should merge from.
 *
 * Unclaimed data is adopted as-is: a device with a week of offline tasks signing in
 * for the first time merges them, and that is the spec's promise. Data claimed by
 * someone else is discarded outright — merging across identities would upload one
 * person's tank into another person's account under their `user_id`, with no undo,
 * and no amount of care further down can unpick that afterwards. The cost is real
 * and accepted: unsynced work belonging to the previous account is lost.
 */
export function claimFor(local: Snapshot, owner: string): Snapshot {
	if (local.owner === undefined || local.owner === owner) return { ...local, owner };

	return {
		version: SCHEMA_VERSION,
		tasks: [],
		koi: [],
		// Not carried over, `seenLegend` included: none of it is this account's.
		settings: { environment: 'progress', seenLegend: false, updatedAt: 0 },
		owner
	};
}

export function merge(local: Snapshot, remote: RemoteSnapshot): MergeResult {
	const tasks = mergeTasks(local.tasks, remote.tasks);
	const koi = mergeKoi(local.koi, remote.koi);
	const settings = mergeSettings(local.settings, remote.settings);

	const remoteById = new Map(remote.tasks.map((task) => [task.id, task]));
	const remoteKoi = new Map(remote.koi.map((record) => [record.date, record]));

	return {
		merged: {
			version: SCHEMA_VERSION,
			tasks,
			koi,
			settings,
			// Carried through so that storing the merge also stores the claim.
			...(local.owner === undefined ? {} : { owner: local.owner })
		},
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
 * Last write wins on the client `updatedAt` every mutation already bumps.
 *
 * A tie means the two clocks disagree, and remote takes it — arbitrary, but it has to
 * be *stable*, or each device keeps its own copy, both believe they are merged, and
 * neither pushes. One function so that tasks and settings cannot drift apart on it.
 */
function later<T extends { updatedAt: number }>(local: T, remote: T): T {
	return local.updatedAt > remote.updatedAt ? local : remote;
}

/**
 * As `later`, except that a tied tombstone beats a tied live row: the two failures
 * are not symmetric, and a task that comes back from the dead is worse than a
 * deletion that lands early.
 */
function winner(local: Task, remote: Task): Task {
	if (local.updatedAt === remote.updatedAt && local.deletedAt !== undefined) return local;
	return later(local, remote);
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

function mergeSettings(local: Settings, remote: Settings | undefined): Settings {
	// No record on the other side is not a tie — there is nothing to tie with, and
	// local wins unconditionally.
	if (!remote) return local;

	// `seenLegend` is a one-way latch, so it is the one field that does not follow the
	// record. An older device syncing in must not make the first-run legend reappear.
	return { ...later(local, remote), seenLegend: local.seenLegend || remote.seenLegend };
}

/** Field-wise, because the latch above means the merged record is always a new object. */
function sameSettings(a: Settings, b: Settings | undefined): boolean {
	return (
		b !== undefined &&
		a.environment === b.environment &&
		a.seenLegend === b.seenLegend &&
		a.updatedAt === b.updatedAt
	);
}

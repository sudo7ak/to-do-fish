import { SCHEMA_VERSION, type Snapshot } from '../../types';
import { StorageUnavailableError, type TaskStore } from '../port';
import { claimFor, merge } from './merge';
import { SyncUnavailableError, type Remote } from './remote';

/**
 * A `TaskStore` that keeps a second device in step.
 *
 * The local write is the one that must not fail, so it happens first and is awaited;
 * the push is debounced and its failure costs nothing, because a push sends the whole
 * snapshot and the next one carries whatever the last one missed. There is no durable
 * outbox to corrupt, and every push is idempotent by construction.
 */

export type SyncStatus = {
	state: 'idle' | 'syncing' | 'offline' | 'denied' | 'stale' | 'skewed' | 'storage' | 'rejected';
	/**
	 * When this device last synced successfully. Absent until one has.
	 *
	 * Deliberately in memory and never persisted: it describes THIS device, and the
	 * only thing this app persists is the snapshot — which is exactly what syncs. In
	 * settings it would replicate, and the laptop would display the phone's sync time.
	 */
	at?: number;
};

export type SyncingOptions = {
	local: TaskStore;
	remote: Remote;
	/** The account id this store syncs. The local snapshot is claimed for it. */
	owner: string;
	/** Called when a pull brought in something the page is not showing yet. */
	onExternalChange?: () => void;
	onStatus?: (status: SyncStatus) => void;
	now?: () => number;
	debounceMs?: number;
	setTimer?: (fn: () => void, ms: number) => number;
	clearTimer?: (handle: number) => void;
};

/**
 * How far ahead of this device's clock a remote timestamp may be before the ordering
 * stops meaning anything. Generous: a couple of hours is a time zone bug somewhere,
 * two days is a wrong clock.
 */
const SKEW_TOLERANCE_MS = 24 * 3600_000;

/**
 * Structural equality, not `JSON.stringify` — a remote task built by `fromTaskRow`
 * spreads its optional keys last, a local one is built in declaration order, and two
 * objects that differ only in key order must still compare equal or a wake with no
 * real change re-hydrates the page every time.
 */
function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
	return deepEqual(a, b);
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((item, i) => deepEqual(item, b[i]));
	}

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	return aKeys.every((key) => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

export class SyncingTaskStore implements TaskStore {
	#local: TaskStore;
	#remote: Remote;
	#owner: string;
	#onExternalChange?: () => void;
	#onStatus?: (status: SyncStatus) => void;
	#now: () => number;
	#debounceMs: number;
	#setTimer: (fn: () => void, ms: number) => number;
	#clearTimer: (handle: number) => void;
	#pending: number | undefined;
	/** Set on every successful sync, and never cleared — see `#status`. */
	#lastSyncedAt: number | undefined;

	/**
	 * A merge that must not be written down: the remote holds a shape this build does
	 * not know, so its rows can be read but not stored under this build's version
	 * number. `load()` serves this instead of localStorage while it is set.
	 */
	#memory: Snapshot | undefined;

	constructor(options: SyncingOptions) {
		this.#local = options.local;
		this.#remote = options.remote;
		this.#owner = options.owner;
		this.#onExternalChange = options.onExternalChange;
		this.#onStatus = options.onStatus;
		this.#now = options.now ?? Date.now;
		this.#debounceMs = options.debounceMs ?? 2000;
		this.#setTimer =
			options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
		this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
	}

	/**
	 * Local, immediately. The tank never waits on a network to paint.
	 *
	 * Claimed on the way out, so that another account's tank is never shown even for
	 * the moment between hydrating and the first sync landing.
	 */
	async load(): Promise<Snapshot> {
		return this.#memory ?? claimFor(await this.#local.load(), this.#owner);
	}

	async save(snapshot: Snapshot): Promise<void> {
		// The user's own write is their own data, and it supersedes the read-only view
		// of a newer remote. Local writes are never blocked: offline-first means the
		// tank keeps taking edits whatever the server is doing.
		this.#memory = undefined;

		// Awaited, and allowed to reject: a failed local write is the one the user
		// must hear about, and the existing banner is already wired for it.
		//
		// Claimed rather than stamped. Stamping would take a snapshot still belonging to
		// the previous account and relabel it as this one's — which is exactly what a
		// write does when the first sync after an account switch failed and the page is
		// still holding the old account's tasks in memory. `claimFor` discards those
		// instead, so a failed sync cannot turn into a cross-account leak on the next tap.
		//
		// The claim also carries forward on the ordinary path, because the app's save
		// rebuilds the snapshot from `{ version, tasks, koi, settings }` and would
		// otherwise drop it — after which a second account would look like a first, and
		// merge.
		await this.#local.save(claimFor(snapshot, this.#owner));

		if (this.#pending !== undefined) this.#clearTimer(this.#pending);
		this.#pending = this.#setTimer(() => void this.sync(), this.#debounceMs);
	}

	/**
	 * Pull, merge, push. Never rejects: a sync failure is a banner, not an exception.
	 * Everything between pull and push can throw in normal use — the local re-read
	 * and the local write both go through `LocalTaskStore`, which documents
	 * `StorageUnavailableError` as a real failure mode — so the whole body shares one
	 * catch rather than guarding pull and push alone.
	 */
	async sync(): Promise<void> {
		this.#status('syncing');

		try {
			const remote = await this.#remote.pull();

			// Re-read local rather than reusing anything captured before the pull: a
			// write may have landed while the request was in flight, and it is newer.
			// Compare against what is *stored*, not against the claimed form: a claim
			// the storage does not carry yet is itself a change worth writing down.
			const stored = await this.#local.load();
			const { merged, push } = merge(claimFor(stored, this.#owner), remote);

			// Skew is terminal, not a status passed through on the way to 'idle'. Every
			// exit below used to overwrite it, and on the quiet path there was not even
			// an await in between — so the banner never rendered for a single frame.
			const settled: SyncStatus['state'] = this.#skewed(remote) ? 'skewed' : 'idle';

			// Newer than this build understands. Read it into memory so the tank still
			// shows the account's data, but do not persist it: `migrate.ts` keys on the
			// stored version, so writing these rows as version SCHEMA_VERSION would
			// mislabel them permanently and no future migration would ever touch them.
			if (remote.version > SCHEMA_VERSION) {
				const changed = this.#memory === undefined || !sameSnapshot(merged, this.#memory);
				this.#memory = merged;
				if (changed) this.#onExternalChange?.();
				return this.#status('stale');
			}
			this.#memory = undefined;

			if (!sameSnapshot(merged, stored)) {
				await this.#local.save(merged);
				this.#onExternalChange?.();
			}

			if (push.tasks.length === 0 && push.koi.length === 0 && !push.settings) {
				this.#lastSyncedAt = this.#now();
				return this.#status(settled);
			}

			await this.#remote.push(push);
			this.#lastSyncedAt = this.#now();
			this.#status(settled);
		} catch (error) {
			this.#failed(error);
		}
	}

	/**
	 * Last-write-wins compares client clocks, so a device hours out makes edits that
	 * always win or always lose. This cannot be repaired here — but saying so beats
	 * merging silently and letting the user discover it as missing tasks.
	 */
	#skewed(remote: { tasks: { updatedAt: number }[] }): boolean {
		const latest = Math.max(0, ...remote.tasks.map((task) => task.updatedAt));
		return latest - this.#now() > SKEW_TOLERANCE_MS;
	}

	#failed(error: unknown): void {
		// A `StorageUnavailableError` from the local re-read or the local write is not
		// a network problem — telling the user to check their signal would send them
		// looking in the wrong place. It gets its own state.
		if (error instanceof StorageUnavailableError) return this.#status('storage');

		if (!(error instanceof SyncUnavailableError)) return this.#status('offline');

		// `rejected` is the one failure that will never come right on its own: the
		// server understood the write and refused the data, so the same rows will be
		// refused again on every retry. It has to say so rather than claim a network
		// problem the user could wait out.
		const BY_REASON = {
			network: 'offline',
			denied: 'denied',
			schema: 'stale',
			rejected: 'rejected'
		} as const satisfies Record<SyncUnavailableError['reason'], SyncStatus['state']>;

		this.#status(BY_REASON[error.reason]);
	}

	#status(state: SyncStatus['state']): void {
		// `at` rides on every status, failures included. A failure that blanked it
		// would lose "last synced 20 minutes ago" at the moment it is most useful.
		this.#onStatus?.({ state, ...(this.#lastSyncedAt === undefined ? {} : { at: this.#lastSyncedAt }) });
	}
}

import type { Snapshot } from '../../types';
import type { TaskStore } from '../port';
import { merge } from './merge';
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
	state: 'idle' | 'syncing' | 'offline' | 'denied' | 'stale' | 'skewed';
};

export type SyncingOptions = {
	local: TaskStore;
	remote: Remote;
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

export class SyncingTaskStore implements TaskStore {
	#local: TaskStore;
	#remote: Remote;
	#onExternalChange?: () => void;
	#onStatus?: (status: SyncStatus) => void;
	#now: () => number;
	#debounceMs: number;
	#setTimer: (fn: () => void, ms: number) => number;
	#clearTimer: (handle: number) => void;
	#pending: number | undefined;

	constructor(options: SyncingOptions) {
		this.#local = options.local;
		this.#remote = options.remote;
		this.#onExternalChange = options.onExternalChange;
		this.#onStatus = options.onStatus;
		this.#now = options.now ?? Date.now;
		this.#debounceMs = options.debounceMs ?? 2000;
		this.#setTimer =
			options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
		this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
	}

	/** Local, immediately. The tank never waits on a network to paint. */
	load(): Promise<Snapshot> {
		return this.#local.load();
	}

	async save(snapshot: Snapshot): Promise<void> {
		// Awaited, and allowed to reject: a failed local write is the one the user
		// must hear about, and the existing banner is already wired for it.
		await this.#local.save(snapshot);

		if (this.#pending !== undefined) this.#clearTimer(this.#pending);
		this.#pending = this.#setTimer(() => void this.sync(), this.#debounceMs);
	}

	/** Pull, merge, push. Never rejects: a sync failure is a banner, not an exception. */
	async sync(): Promise<void> {
		this.#status('syncing');

		let remote: Snapshot;
		try {
			remote = await this.#remote.pull();
		} catch (error) {
			return this.#failed(error);
		}

		// Re-read local rather than reusing anything captured before the pull: a write
		// may have landed while the request was in flight, and it is newer than this.
		const local = await this.#local.load();
		const { merged, push } = merge(local, remote);

		if (this.#skewed(remote)) this.#status('skewed');

		const changed = JSON.stringify(merged) !== JSON.stringify(local);
		if (changed) {
			await this.#local.save(merged);
			this.#onExternalChange?.();
		}

		if (push.tasks.length === 0 && push.koi.length === 0 && !push.settings) {
			return this.#status('idle');
		}

		try {
			await this.#remote.push(push);
			this.#status('idle');
		} catch (error) {
			this.#failed(error);
		}
	}

	/**
	 * Last-write-wins compares client clocks, so a device hours out makes edits that
	 * always win or always lose. This cannot be repaired here — but saying so beats
	 * merging silently and letting the user discover it as missing tasks.
	 */
	#skewed(remote: Snapshot): boolean {
		const latest = Math.max(0, ...remote.tasks.map((task) => task.updatedAt));
		return latest - this.#now() > SKEW_TOLERANCE_MS;
	}

	#failed(error: unknown): void {
		const reason = error instanceof SyncUnavailableError ? error.reason : 'network';
		this.#status(reason === 'denied' ? 'denied' : reason === 'schema' ? 'stale' : 'offline');
	}

	#status(state: SyncStatus['state']): void {
		this.#onStatus?.({ state });
	}
}

import type { Snapshot } from '../types';

/**
 * The only seam that knows where data lives. v1 ships `LocalTaskStore` (S8); a
 * future `RemoteTaskStore` and a `SyncingTaskStore` wrapping both implement the
 * same interface, and nothing above `persist/` ever learns which one it holds.
 *
 * Async from the start so that swapping in a network-backed implementation is not
 * a signature change.
 */
export interface TaskStore {
	load(): Promise<Snapshot>;
	save(snapshot: Snapshot): Promise<void>;
}

/**
 * `save` rejects with this when the browser refuses to persist — quota exceeded,
 * private-mode restrictions, storage disabled. The store surfaces a banner rather
 * than dropping the write silently; the app keeps running from memory.
 */
export class StorageUnavailableError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'StorageUnavailableError';
	}
}

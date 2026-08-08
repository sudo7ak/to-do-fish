import { SCHEMA_VERSION, type Snapshot } from '../types';
import { StorageUnavailableError, type TaskStore } from './port';
import { migrate } from './migrate';

/**
 * The only place in the app that knows about `localStorage`. Everything above
 * `persist/` talks to the `TaskStore` interface and never learns what is behind it.
 */

export const STORAGE_KEY = 'fish-tank-todo/snapshot';

/** A tank with nothing in it yet. Progress is the default environment; Calm is a choice. */
export function emptySnapshot(): Snapshot {
	return { version: SCHEMA_VERSION, tasks: [], koi: [], settings: { environment: 'progress' } };
}

export class LocalTaskStore implements TaskStore {
	#storage: Storage | undefined;
	#now: () => number;

	/**
	 * `storage` is injected so the failure paths can be tested without a browser, and
	 * may be absent entirely — Safari's private mode and disabled-storage settings
	 * both leave `localStorage` unreachable.
	 */
	constructor(storage: Storage | undefined = safeLocalStorage(), now: () => number = Date.now) {
		this.#storage = storage;
		this.#now = now;
	}

	async load(): Promise<Snapshot> {
		const raw = this.#read();
		if (raw === null) return emptySnapshot();

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return this.#quarantine(raw);
		}

		const result = migrate(parsed);
		return result.ok ? result.snapshot : this.#quarantine(raw);
	}

	async save(snapshot: Snapshot): Promise<void> {
		if (!this.#storage) {
			throw new StorageUnavailableError('No storage available on this device');
		}

		try {
			this.#storage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
		} catch (cause) {
			// Rejecting is the point: the app keeps running from memory and shows a
			// banner. Swallowing this would let the user work for an hour believing
			// their tasks were saved.
			throw new StorageUnavailableError('Changes are not being saved on this device', { cause });
		}
	}

	#read(): string | null {
		try {
			return this.#storage?.getItem(STORAGE_KEY) ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Copies an unreadable blob to a timestamped key before the app starts fresh, so
	 * nothing is destroyed without a copy remaining. The backup is best-effort: if it
	 * cannot be written, starting fresh still beats refusing to open.
	 */
	#quarantine(raw: string): Snapshot {
		try {
			this.#storage?.setItem(`${STORAGE_KEY}.corrupt.${this.#now()}`, raw);
		} catch {
			// Storage is full or unavailable. Nothing further to do here.
		}
		return emptySnapshot();
	}
}

/** Reading `localStorage` itself can throw where storage is disabled outright. */
function safeLocalStorage(): Storage | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		return undefined;
	}
}

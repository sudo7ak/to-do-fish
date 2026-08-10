import { describe, it, expect } from 'vitest';
import { LocalTaskStore, STORAGE_KEY, emptySnapshot } from './local';
import { StorageUnavailableError } from './port';
import { SCHEMA_VERSION, type Snapshot, type Task } from '../types';

/** Minimal in-memory stand-in for the Web Storage API. */
class FakeStorage {
	map = new Map<string, string>();
	getItem(key: string) {
		return this.map.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.map.set(key, value);
	}
	removeItem(key: string) {
		this.map.delete(key);
	}
	get keys() {
		return [...this.map.keys()];
	}
}

class FullStorage extends FakeStorage {
	setItem(): never {
		const error = new Error('QuotaExceededError');
		error.name = 'QuotaExceededError';
		throw error;
	}
}

const task = (over: Partial<Task> = {}): Task => ({
	id: 'a',
	title: 'Call mum',
	date: '2026-08-08',
	status: 'open',
	createdAt: 1,
	updatedAt: 1,
	...over
});

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
	version: SCHEMA_VERSION,
	tasks: [task()],
	koi: [{ date: '2026-08-07', earnedAt: 5 }],
	settings: { environment: 'calm', seenLegend: true, updatedAt: 0 },
	...over
});

const store = (storage: FakeStorage, now = () => 1000) =>
	new LocalTaskStore(storage as unknown as Storage, now);

describe('LocalTaskStore — round trip', () => {
	it('returns an empty snapshot when nothing has been saved', async () => {
		expect(await store(new FakeStorage()).load()).toEqual(emptySnapshot());
	});

	it('round-trips a snapshot unchanged', async () => {
		const storage = new FakeStorage();
		const s = store(storage);
		const original = snapshot();

		await s.save(original);
		expect(await s.load()).toEqual(original);
	});

	it('a second store reads what the first wrote', async () => {
		const storage = new FakeStorage();
		await store(storage).save(snapshot());
		expect(await store(storage).load()).toEqual(snapshot());
	});

	it('preserves soft-deleted tasks — tombstones must survive a reload', async () => {
		const storage = new FakeStorage();
		const s = store(storage);
		const deleted = snapshot({ tasks: [task({ id: 'gone', deletedAt: 99 })] });

		await s.save(deleted);
		expect((await s.load()).tasks[0].deletedAt).toBe(99);
	});
});

describe('LocalTaskStore — corrupt data', () => {
	it('starts fresh when the stored blob is not JSON', async () => {
		const storage = new FakeStorage();
		storage.setItem(STORAGE_KEY, '{not json at all');

		expect(await store(storage).load()).toEqual(emptySnapshot());
	});

	it('copies the unreadable blob to a timestamped backup before starting fresh', async () => {
		const storage = new FakeStorage();
		storage.setItem(STORAGE_KEY, '{not json at all');

		await store(storage, () => 1234).load();

		expect(storage.getItem(`${STORAGE_KEY}.corrupt.1234`)).toBe('{not json at all');
	});

	it('starts fresh when the blob is JSON but the wrong shape', async () => {
		const storage = new FakeStorage();
		storage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, tasks: 'nope' }));

		expect(await store(storage).load()).toEqual(emptySnapshot());
	});

	it('backs up a wrongly-shaped blob too', async () => {
		const storage = new FakeStorage();
		const bad = JSON.stringify({ hello: 'world' });
		storage.setItem(STORAGE_KEY, bad);

		await store(storage, () => 7).load();

		expect(storage.getItem(`${STORAGE_KEY}.corrupt.7`)).toBe(bad);
	});

	it('treats an unknown future version as corrupt rather than guessing at it', async () => {
		const storage = new FakeStorage();
		const future = JSON.stringify({ version: SCHEMA_VERSION + 99, tasks: [], koi: [], settings: {} });
		storage.setItem(STORAGE_KEY, future);

		expect(await store(storage, () => 3).load()).toEqual(emptySnapshot());
		expect(storage.getItem(`${STORAGE_KEY}.corrupt.3`)).toBe(future);
	});

	it('never destroys the original — the backup remains after starting fresh', async () => {
		const storage = new FakeStorage();
		storage.setItem(STORAGE_KEY, 'garbage');

		await store(storage, () => 42).load();

		expect(storage.getItem(`${STORAGE_KEY}.corrupt.42`)).toBe('garbage');
	});
});

describe('LocalTaskStore — migration', () => {
	it('migrates a version 0 snapshot forward', async () => {
		const storage = new FakeStorage();
		// v0 predates the settings and koi fields.
		storage.setItem(STORAGE_KEY, JSON.stringify({ version: 0, tasks: [task()] }));

		const loaded = await store(storage).load();

		expect(loaded.version).toBe(SCHEMA_VERSION);
		expect(loaded.tasks).toEqual([task()]);
		expect(loaded.koi).toEqual([]);
		expect(loaded.settings.environment).toBe('progress');
	});

	// Deliberately NOT `emptySnapshot().settings`, which this assertion used to
	// compare against. Migrated data and an empty tank now disagree on exactly one
	// field, and that disagreement is the feature: anything stored means the app has
	// been used, so its owner does not need the legend shown at them.
	it('marks migrated data as having seen the legend', async () => {
		const storage = new FakeStorage();
		storage.setItem(STORAGE_KEY, JSON.stringify({ version: 0, tasks: [task()] }));

		const loaded = await store(storage).load();

		expect(loaded.settings.seenLegend).toBe(true);
		expect(emptySnapshot().settings.seenLegend).toBe(false);
	});

	it('migrates a version 1 snapshot, keeping the chosen environment', async () => {
		const storage = new FakeStorage();
		storage.setItem(
			STORAGE_KEY,
			JSON.stringify({ version: 1, tasks: [], koi: [], settings: { environment: 'calm' } })
		);

		const loaded = await store(storage).load();

		expect(loaded.version).toBe(SCHEMA_VERSION);
		expect(loaded.settings).toEqual({ environment: 'calm', seenLegend: true, updatedAt: 0 });
	});

	it('treats a blob with no version field as version 0 and migrates it', async () => {
		const storage = new FakeStorage();
		storage.setItem(STORAGE_KEY, JSON.stringify({ tasks: [task()] }));

		const loaded = await store(storage).load();

		expect(loaded.version).toBe(SCHEMA_VERSION);
		expect(loaded.tasks).toEqual([task()]);
	});

	it('leaves a current-version snapshot alone', async () => {
		const storage = new FakeStorage();
		storage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));

		expect(await store(storage).load()).toEqual(snapshot());
	});
});

describe('LocalTaskStore — storage unavailable', () => {
	it('rejects rather than corrupting when the quota is exceeded', async () => {
		const s = store(new FullStorage());

		await expect(s.save(snapshot())).rejects.toBeInstanceOf(StorageUnavailableError);
	});

	it('keeps the underlying cause on the rejection', async () => {
		const s = store(new FullStorage());

		await expect(s.save(snapshot())).rejects.toMatchObject({
			cause: expect.objectContaining({ name: 'QuotaExceededError' })
		});
	});

	it('rejects when there is no storage at all', async () => {
		const s = new LocalTaskStore(undefined, () => 1);

		await expect(s.save(snapshot())).rejects.toBeInstanceOf(StorageUnavailableError);
	});

	it('loads an empty snapshot when there is no storage at all', async () => {
		expect(await new LocalTaskStore(undefined, () => 1).load()).toEqual(emptySnapshot());
	});

	it('a failed save leaves the previous good snapshot untouched', async () => {
		const storage = new FakeStorage();
		const good = store(storage);
		await good.save(snapshot());

		// A later save fails; the earlier data must still be readable.
		const failing = new LocalTaskStore(
			{
				getItem: (k: string) => storage.getItem(k),
				setItem: () => {
					throw new Error('nope');
				},
				removeItem: () => {}
			} as unknown as Storage,
			() => 1
		);
		await expect(failing.save(snapshot({ tasks: [] }))).rejects.toBeInstanceOf(
			StorageUnavailableError
		);
		expect(await good.load()).toEqual(snapshot());
	});
});

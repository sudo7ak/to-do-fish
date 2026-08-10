import { describe, it, expect } from 'vitest';
import { SupabaseRemote, SyncUnavailableError, type SupabaseLike } from './remote';
import { SCHEMA_VERSION, type Snapshot, type Task } from '../../types';

const USER = '00000000-0000-0000-0000-000000000001';

const task = (over: Partial<Task> = {}): Task => ({
	id: 'a',
	title: 'Call mum',
	date: '2026-08-10',
	status: 'open',
	createdAt: 1,
	updatedAt: 2,
	...over
});

const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
	version: SCHEMA_VERSION,
	tasks: [],
	koi: [],
	settings: { environment: 'calm', seenLegend: true, updatedAt: 9 },
	...over
});

/**
 * A stand-in for the two client calls this file makes. Records upserts so the tests
 * can assert what would have been written.
 */
function fakeClient(
	seed: Record<string, unknown[]> = {},
	fail?: { code?: string; message?: string }
): SupabaseLike & { upserts: Record<string, unknown[]> } {
	const upserts: Record<string, unknown[]> = {};

	return {
		upserts,
		from(table: string) {
			return {
				select: async () =>
					fail ? { data: null, error: fail } : { data: seed[table] ?? [], error: null },
				upsert: async (rows: unknown[]) => {
					if (fail) return { error: fail };
					upserts[table] = [...(upserts[table] ?? []), ...rows];
					return { error: null };
				}
			};
		}
	};
}

describe('SupabaseRemote — pull', () => {
	it('returns an empty snapshot for an account with nothing in it', async () => {
		const remote = new SupabaseRemote(fakeClient(), USER);

		const pulled = await remote.pull();

		expect(pulled.tasks).toEqual([]);
		expect(pulled.koi).toEqual([]);
	});

	it('maps rows back into the domain', async () => {
		const client = fakeClient({
			tasks: [
				{
					user_id: USER,
					id: 'a',
					title: 'Call mum',
					date: '2026-08-10',
					condition: null,
					treat_cost: null,
					status: 'open',
					created_at: 1,
					completed_at: null,
					updated_at: 2,
					deleted_at: null
				}
			],
			koi: [{ user_id: USER, date: '2026-08-09', earned_at: 5 }]
		});

		const pulled = await new SupabaseRemote(client, USER).pull();

		expect(pulled.tasks).toEqual([task()]);
		expect(pulled.koi).toEqual([{ date: '2026-08-09', earnedAt: 5 }]);
	});

	it('reports a refused read as denied, not as an empty tank', async () => {
		// An empty snapshot from a failed read is the worst possible outcome: merge
		// would treat every existing task as one the remote has never seen.
		const remote = new SupabaseRemote(fakeClient({}, { code: '42501' }), USER);

		await expect(remote.pull()).rejects.toThrow(SyncUnavailableError);
	});

	it('classifies a permission failure as denied', async () => {
		const remote = new SupabaseRemote(fakeClient({}, { code: '42501' }), USER);

		await expect(remote.pull()).rejects.toMatchObject({ reason: 'denied' });
	});

	it('classifies anything else as a network failure', async () => {
		const remote = new SupabaseRemote(fakeClient({}, { message: 'Failed to fetch' }), USER);

		await expect(remote.pull()).rejects.toMatchObject({ reason: 'network' });
	});
});

describe('SupabaseRemote — push', () => {
	it('writes nothing at all when there is nothing to write', async () => {
		// An empty push is the common case on a quiet sync, and an upsert of zero rows
		// is a request worth not making.
		const client = fakeClient();

		await new SupabaseRemote(client, USER).push({ tasks: [], koi: [] });

		expect(client.upserts.tasks).toBeUndefined();
		expect(client.upserts.koi).toBeUndefined();
		expect(client.upserts.settings).toBeUndefined();
	});

	it('upserts tasks with the user stamped on every row', async () => {
		const client = fakeClient();

		await new SupabaseRemote(client, USER).push(snapshot({ tasks: [task(), task({ id: 'b' })] }));

		expect(client.upserts.tasks).toHaveLength(2);
		expect(client.upserts.tasks.every((row: any) => row.user_id === USER)).toBe(true);
	});

	it('upserts tombstones like any other row', async () => {
		const client = fakeClient();

		await new SupabaseRemote(client, USER).push(snapshot({ tasks: [task({ deletedAt: 5 })] }));

		expect((client.upserts.tasks[0] as any).deleted_at).toBe(5);
	});

	it('upserts the settings row with this build schema version', async () => {
		const client = fakeClient();

		await new SupabaseRemote(client, USER).push(snapshot());

		expect((client.upserts.settings[0] as any).version).toBe(SCHEMA_VERSION);
	});

	it('rejects when the write is refused', async () => {
		const remote = new SupabaseRemote(fakeClient({}, { code: '42501' }), USER);

		await expect(remote.push(snapshot({ tasks: [task()] }))).rejects.toThrow(SyncUnavailableError);
	});
});

describe('SupabaseRemote — a newer schema', () => {
	it('refuses to push over rows written by a newer client', async () => {
		// Writing a v3 shape over v4 rows would silently drop whatever v4 added.
		const client = fakeClient({
			settings: [
				{
					user_id: USER,
					environment: 'calm',
					seen_legend: true,
					version: SCHEMA_VERSION + 1,
					updated_at: 1
				}
			]
		});
		const remote = new SupabaseRemote(client, USER);

		await remote.pull();

		await expect(remote.push(snapshot({ tasks: [task()] }))).rejects.toMatchObject({
			reason: 'schema'
		});
	});

	it('still allows the pull, so an out-of-date device can be read', async () => {
		const client = fakeClient({
			settings: [
				{
					user_id: USER,
					environment: 'calm',
					seen_legend: true,
					version: SCHEMA_VERSION + 1,
					updated_at: 1
				}
			]
		});

		await expect(new SupabaseRemote(client, USER).pull()).resolves.toBeDefined();
	});
});

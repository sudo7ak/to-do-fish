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
				select: () => ({
					eq: async () =>
						fail ? { data: null, error: fail } : { data: seed[table] ?? [], error: null }
				}),
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
		const remote = new SupabaseRemote(client, USER);
		await remote.pull();

		await remote.push({ tasks: [], koi: [] });

		expect(client.upserts.tasks).toBeUndefined();
		expect(client.upserts.koi).toBeUndefined();
		expect(client.upserts.settings).toBeUndefined();
	});

	it('upserts tasks with the user stamped on every row', async () => {
		const client = fakeClient();
		const remote = new SupabaseRemote(client, USER);
		await remote.pull();

		await remote.push(snapshot({ tasks: [task(), task({ id: 'b' })] }));

		expect(client.upserts.tasks).toHaveLength(2);
		expect(client.upserts.tasks.every((row: any) => row.user_id === USER)).toBe(true);
	});

	it('upserts tombstones like any other row', async () => {
		const client = fakeClient();
		const remote = new SupabaseRemote(client, USER);
		await remote.pull();

		await remote.push(snapshot({ tasks: [task({ deletedAt: 5 })] }));

		expect((client.upserts.tasks[0] as any).deleted_at).toBe(5);
	});

	it('upserts the settings row with this build schema version', async () => {
		const client = fakeClient();
		const remote = new SupabaseRemote(client, USER);
		await remote.pull();

		await remote.push(snapshot());

		expect((client.upserts.settings[0] as any).version).toBe(SCHEMA_VERSION);
	});

	it('rejects when the write is refused', async () => {
		// select succeeds (so the version guard is satisfied) but upsert is refused —
		// the two must be independent to isolate the write-time failure being tested.
		const client = fakeClient();
		const failingUpsert: SupabaseLike = {
			from: (table: string) => ({
				select: client.from(table).select,
				upsert: async () => ({ error: { code: '42501' } })
			})
		};
		const remote = new SupabaseRemote(failingUpsert, USER);
		await remote.pull();

		await expect(remote.push(snapshot({ tasks: [task()] }))).rejects.toThrow(SyncUnavailableError);
	});
});

describe('SupabaseRemote — push before any pull', () => {
	it('refuses when the remote version has never been read, and writes nothing', async () => {
		const client = fakeClient();
		const remote = new SupabaseRemote(client, USER);

		await expect(remote.push(snapshot({ tasks: [task()] }))).rejects.toMatchObject({
			reason: 'schema'
		});
		expect(client.upserts.tasks).toBeUndefined();
		expect(client.upserts.koi).toBeUndefined();
		expect(client.upserts.settings).toBeUndefined();
	});

	it('allows push after pulling an account with no settings row yet', async () => {
		const client = fakeClient();
		const remote = new SupabaseRemote(client, USER);

		await remote.pull();
		await remote.push(snapshot({ tasks: [task()] }));

		expect(client.upserts.tasks).toHaveLength(1);
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

	it('still allows the pull, and reports the version it actually found', async () => {
		// `toBeDefined()` used to be the whole assertion here, and it passed while the
		// caller had no way to learn the remote was newer — so the merged rows were
		// written to localStorage stamped with this build's version and would never be
		// migrated. The version has to come back for that decision to be makeable.
		const client = fakeClient({
			settings: [
				{
					user_id: USER,
					environment: 'calm',
					seen_legend: true,
					version: SCHEMA_VERSION + 1,
					updated_at: 1
				}
			],
			koi: [{ user_id: USER, date: '2026-08-09', earned_at: 5 }]
		});

		const pulled = await new SupabaseRemote(client, USER).pull();

		expect(pulled.version).toBe(SCHEMA_VERSION + 1);
		expect(pulled.settings).toEqual({ environment: 'calm', seenLegend: true, updatedAt: 1 });
		expect(pulled.koi).toEqual([{ date: '2026-08-09', earnedAt: 5 }]);
	});
});

describe('SupabaseRemote — reads are scoped to the account (I4)', () => {
	it('filters every select by user_id rather than trusting RLS alone', async () => {
		const filters: Record<string, [string, string][]> = {};
		const client: SupabaseLike = {
			from: (table: string) => ({
				select: () => ({
					eq: async (column: string, value: string) => {
						(filters[table] ??= []).push([column, value]);
						return { data: [], error: null };
					}
				}),
				upsert: async () => ({ error: null })
			})
		};

		await new SupabaseRemote(client, USER).pull();

		expect(filters).toEqual({
			tasks: [['user_id', USER]],
			koi: [['user_id', USER]],
			settings: [['user_id', USER]]
		});
	});
});

describe('SupabaseRemote — an account with no settings row', () => {
	it('reports the settings as absent rather than synthesising a zero-stamped record', async () => {
		// A synthesised `updatedAt: 0` ties with migrated local settings and the tie
		// goes to remote, which silently discards the user's environment choice.
		const pulled = await new SupabaseRemote(fakeClient(), USER).pull();

		expect(pulled.settings).toBeUndefined();
	});
});

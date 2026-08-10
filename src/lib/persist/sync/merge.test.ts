import { describe, it, expect } from 'vitest';
import { merge, claimFor } from './merge';
import { SCHEMA_VERSION, type Snapshot, type Task } from '../../types';

const task = (over: Partial<Task> = {}): Task => ({
	id: 'a',
	title: 'Call mum',
	date: '2026-08-10',
	status: 'open',
	createdAt: 1,
	updatedAt: 1,
	...over
});

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
	version: SCHEMA_VERSION,
	tasks: [],
	koi: [],
	settings: { environment: 'progress', seenLegend: false, updatedAt: 0 },
	...over
});

describe('merge — tasks', () => {
	it('keeps a task only one side has, from either side', () => {
		const result = merge(
			snap({ tasks: [task({ id: 'local' })] }),
			snap({ tasks: [task({ id: 'remote' })] })
		);

		expect(result.merged.tasks.map((t) => t.id).sort()).toEqual(['local', 'remote']);
	});

	it('takes the newer of two versions of the same task — local newer', () => {
		const result = merge(
			snap({ tasks: [task({ title: 'new', updatedAt: 20 })] }),
			snap({ tasks: [task({ title: 'old', updatedAt: 10 })] })
		);

		expect(result.merged.tasks[0].title).toBe('new');
	});

	it('takes the newer of two versions of the same task — remote newer', () => {
		const result = merge(
			snap({ tasks: [task({ title: 'old', updatedAt: 10 })] }),
			snap({ tasks: [task({ title: 'new', updatedAt: 20 })] })
		);

		expect(result.merged.tasks[0].title).toBe('new');
	});

	it('replaces the task wholesale rather than blending fields', () => {
		// Last-write-wins is per task. A merge that kept the loser's completedAt would
		// produce a row that never existed on either device.
		const result = merge(
			snap({ tasks: [task({ status: 'done', completedAt: 99, updatedAt: 10 })] }),
			snap({ tasks: [task({ status: 'open', updatedAt: 20 })] })
		);

		expect(result.merged.tasks[0].status).toBe('open');
		expect(result.merged.tasks[0].completedAt).toBeUndefined();
	});

	it('gives a tie to the deleted side, whichever side that is', () => {
		// A tie is clock skew. Resurrecting a deleted task is the worse failure, so
		// the tombstone wins rather than the arbitrary side.
		const deletedLocal = merge(
			snap({ tasks: [task({ updatedAt: 10, deletedAt: 10 })] }),
			snap({ tasks: [task({ updatedAt: 10 })] })
		);
		const deletedRemote = merge(
			snap({ tasks: [task({ updatedAt: 10 })] }),
			snap({ tasks: [task({ updatedAt: 10, deletedAt: 10 })] })
		);

		expect(deletedLocal.merged.tasks[0].deletedAt).toBe(10);
		expect(deletedRemote.merged.tasks[0].deletedAt).toBe(10);
	});

	it('gives a tie between two live tasks to remote', () => {
		const result = merge(
			snap({ tasks: [task({ title: 'local', updatedAt: 10 })] }),
			snap({ tasks: [task({ title: 'remote', updatedAt: 10 })] })
		);

		expect(result.merged.tasks[0].title).toBe('remote');
	});

	it('never resurrects a task deleted on the other device', () => {
		const result = merge(
			snap({ tasks: [task({ updatedAt: 5 })] }),
			snap({ tasks: [task({ updatedAt: 50, deletedAt: 50 })] })
		);

		expect(result.merged.tasks[0].deletedAt).toBe(50);
	});

	it('carries a tombstone the remote has never seen into the push', () => {
		const result = merge(snap({ tasks: [task({ deletedAt: 3 })] }), snap());

		expect(result.push.tasks).toHaveLength(1);
		expect(result.push.tasks[0].deletedAt).toBe(3);
	});
});

describe('merge — koi', () => {
	it('unions koi by date', () => {
		const result = merge(
			snap({ koi: [{ date: '2026-08-09', earnedAt: 1 }] }),
			snap({ koi: [{ date: '2026-08-10', earnedAt: 2 }] })
		);

		expect(result.merged.koi.map((k) => k.date)).toEqual(['2026-08-09', '2026-08-10']);
	});

	it('keeps the earlier earnedAt for the same day', () => {
		const result = merge(
			snap({ koi: [{ date: '2026-08-09', earnedAt: 500 }] }),
			snap({ koi: [{ date: '2026-08-09', earnedAt: 100 }] })
		);

		expect(result.merged.koi).toEqual([{ date: '2026-08-09', earnedAt: 100 }]);
	});

	it('never drops a koi the other side lacks — awarded once, never revoked', () => {
		const result = merge(snap({ koi: [{ date: '2026-08-09', earnedAt: 1 }] }), snap({ koi: [] }));

		expect(result.merged.koi).toHaveLength(1);
		expect(result.push.koi).toHaveLength(1);
	});
});

describe('merge — settings', () => {
	it('takes the newer settings record whole', () => {
		const result = merge(
			snap({ settings: { environment: 'calm', seenLegend: true, updatedAt: 20 } }),
			snap({ settings: { environment: 'progress', seenLegend: false, updatedAt: 10 } })
		);

		expect(result.merged.settings.environment).toBe('calm');
	});

	it('keeps seenLegend latched once either side has seen it', () => {
		// A one-way latch must not be un-latched by an older device syncing in: the
		// legend reappearing after a sign-in reads as a bug, not a setting.
		const result = merge(
			snap({ settings: { environment: 'calm', seenLegend: true, updatedAt: 5 } }),
			snap({ settings: { environment: 'progress', seenLegend: false, updatedAt: 50 } })
		);

		expect(result.merged.settings.seenLegend).toBe(true);
	});

	it('gives a tie on updatedAt to remote, matching how task ties resolve', () => {
		// A tie must resolve the same way on both devices, or each keeps its own
		// settings and the two never converge.
		const result = merge(
			snap({ settings: { environment: 'calm', seenLegend: true, updatedAt: 10 } }),
			snap({ settings: { environment: 'progress', seenLegend: true, updatedAt: 10 } })
		);

		expect(result.merged.settings.environment).toBe('progress');
	});
});

describe('merge — the push', () => {
	it('pushes nothing when the two sides already agree', () => {
		const same = snap({ tasks: [task()], koi: [{ date: '2026-08-09', earnedAt: 1 }] });

		const result = merge(same, structuredClone(same));

		expect(result.push.tasks).toEqual([]);
		expect(result.push.koi).toEqual([]);
	});

	it('pushes a task the remote has never seen', () => {
		const result = merge(snap({ tasks: [task({ id: 'fresh' })] }), snap());

		expect(result.push.tasks.map((t) => t.id)).toEqual(['fresh']);
	});

	it('pushes a task the remote has an older version of', () => {
		const result = merge(
			snap({ tasks: [task({ updatedAt: 20 })] }),
			snap({ tasks: [task({ updatedAt: 10 })] })
		);

		expect(result.push.tasks).toHaveLength(1);
	});

	it('does not push a task the remote already has a newer version of', () => {
		const result = merge(
			snap({ tasks: [task({ updatedAt: 10 })] }),
			snap({ tasks: [task({ updatedAt: 20 })] })
		);

		expect(result.push.tasks).toEqual([]);
	});

	it('pushes settings only when local is the newer side', () => {
		const localNewer = merge(
			snap({ settings: { environment: 'calm', seenLegend: true, updatedAt: 20 } }),
			snap({ settings: { environment: 'progress', seenLegend: true, updatedAt: 10 } })
		);
		const remoteNewer = merge(
			snap({ settings: { environment: 'calm', seenLegend: true, updatedAt: 10 } }),
			snap({ settings: { environment: 'progress', seenLegend: true, updatedAt: 20 } })
		);

		expect(localNewer.push.settings).toBeDefined();
		expect(remoteNewer.push.settings).toBeUndefined();
	});
});

describe('merge — an absent remote settings record (C2)', () => {
	it('keeps local settings when the account has no settings row yet', () => {
		// The inevitable first-sign-in state: migration 2 -> 3 stamped local settings
		// `updatedAt: 0`, and an account with no row has nothing at all. A synthesised
		// zero-stamped record would tie and the tie goes to remote, silently replacing
		// a choice the user actually made with the default.
		const result = merge(
			snap({ settings: { environment: 'calm', seenLegend: true, updatedAt: 0 } }),
			{ version: SCHEMA_VERSION, tasks: [], koi: [] }
		);

		expect(result.merged.settings.environment).toBe('calm');
	});

	it('pushes local settings up when the remote has none', () => {
		// Also the fix for the inert schema tripwire: an account whose owner never
		// changes a setting still gets a settings row, which is where `version` lives.
		const result = merge(snap(), { version: SCHEMA_VERSION, tasks: [], koi: [] });

		expect(result.push.settings).toBeDefined();
	});

	it('still gives a tie between two real records to remote', () => {
		const result = merge(
			snap({ settings: { environment: 'calm', seenLegend: true, updatedAt: 10 } }),
			snap({ settings: { environment: 'progress', seenLegend: true, updatedAt: 10 } })
		);

		expect(result.merged.settings.environment).toBe('progress');
	});
});

describe('claimFor — which account the local snapshot belongs to (C1)', () => {
	const A = 'account-a';
	const B = 'account-b';

	it('stamps an unclaimed snapshot without touching its contents', () => {
		const local = snap({ tasks: [task({ id: 'offline-week' })] });

		const claimed = claimFor(local, A);

		expect(claimed.owner).toBe(A);
		expect(claimed.tasks.map((t) => t.id)).toEqual(['offline-week']);
	});

	it('leaves the same account own snapshot alone', () => {
		const local = { ...snap({ tasks: [task()] }), owner: A };

		expect(claimFor(local, A).tasks).toHaveLength(1);
	});

	it('discards everything when a different account signs in', () => {
		// The alternative is uploading one person tank into another person account,
		// under their user_id, with no undo. Losing unsynced local work is the
		// accepted cost.
		const local = {
			...snap({
				tasks: [task()],
				koi: [{ date: '2026-08-09', earnedAt: 1 }],
				settings: { environment: 'calm' as const, seenLegend: true, updatedAt: 5 }
			}),
			owner: A
		};

		const claimed = claimFor(local, B);

		expect(claimed.owner).toBe(B);
		expect(claimed.tasks).toEqual([]);
		expect(claimed.koi).toEqual([]);
		expect(claimed.settings.environment).toBe('progress');
	});

	it('never carries a task across identities into the push', () => {
		const local = { ...snap({ tasks: [task({ id: 'a-secret' })] }), owner: A };

		const result = merge(claimFor(local, B), snap());

		expect(result.push.tasks).toEqual([]);
		expect(result.merged.tasks).toEqual([]);
	});

	it('carries the owner into the merged snapshot, so the claim is what gets stored', () => {
		const result = merge(claimFor(snap(), A), snap());

		expect(result.merged.owner).toBe(A);
	});
});

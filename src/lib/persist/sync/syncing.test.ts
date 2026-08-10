import { describe, it, expect, vi } from 'vitest';
import { SyncingTaskStore, type SyncStatus } from './syncing';
import { SyncUnavailableError, type Remote } from './remote';
import { StorageUnavailableError, type TaskStore } from '../port';
import { fromTaskRow, toTaskRow } from './rows';
import { SCHEMA_VERSION, type Snapshot, type Task } from '../../types';

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
	settings: { environment: 'progress', seenLegend: false, updatedAt: 0 },
	...over
});

/**
 * A snapshot already claimed by the account `setup()` syncs. Anything that asserts a
 * sync was *quiet* has to start from one: an unclaimed snapshot signing in for the
 * first time is genuinely a change, because the claim itself gets written down.
 */
const mine = (over: Partial<Snapshot> = {}): Snapshot => ({ ...snapshot(over), owner: 'owner' });

/** An in-memory TaskStore standing in for LocalTaskStore. */
function fakeLocal(initial: Snapshot = snapshot()) {
	let held = initial;
	return {
		saves: [] as Snapshot[],
		async load() {
			return held;
		},
		async save(next: Snapshot) {
			held = next;
			this.saves.push(next);
		},
		get held() {
			return held;
		}
	} satisfies TaskStore & { saves: Snapshot[]; held: Snapshot };
}

function fakeRemote(initial: Snapshot = snapshot()) {
	return {
		pushes: [] as Snapshot[],
		pulls: 0,
		pullResult: initial,
		pullError: undefined as unknown,
		pushError: undefined as unknown,
		freshnessResult: 0 as number | undefined,
		freshnessCalls: 0,
		async pull() {
			this.pulls++;
			if (this.pullError) throw this.pullError;
			return this.pullResult;
		},
		async push(next: Snapshot) {
			if (this.pushError) throw this.pushError;
			this.pushes.push(next);
		},
		async freshness() {
			this.freshnessCalls++;
			return this.freshnessResult;
		}
	} satisfies Remote & {
		pushes: Snapshot[];
		pulls: number;
		pullResult: Snapshot;
		pullError: unknown;
		pushError: unknown;
		freshnessResult: number | undefined;
		freshnessCalls: number;
	};
}

/** Hand-driven debounce timer. */
function fakeTimer() {
	let pending: (() => void) | undefined;
	return {
		set: (fn: () => void) => {
			pending = fn;
			return 1;
		},
		clear: () => {
			pending = undefined;
		},
		async fire() {
			const fn = pending;
			pending = undefined;
			await fn?.();
		},
		get armed() {
			return pending !== undefined;
		}
	};
}

function setup(local = fakeLocal(), remote = fakeRemote()) {
	const timer = fakeTimer();
	const statuses: SyncStatus[] = [];
	const external = vi.fn();

	const store = new SyncingTaskStore({
		local,
		remote,
		owner: 'owner',
		onExternalChange: external,
		onStatus: (status) => statuses.push(status),
		setTimer: timer.set,
		clearTimer: timer.clear,
		now: () => 1000
	});

	return { store, local, remote, timer, statuses, external };
}

describe('SyncingTaskStore — load', () => {
	it('returns the local snapshot without waiting on the network', async () => {
		const local = fakeLocal(snapshot({ tasks: [task()] }));
		const remote = fakeRemote();
		remote.pull = () => new Promise(() => {}); // never resolves
		const { store } = setup(local, remote);

		expect((await store.load()).tasks).toHaveLength(1);
	});
});

describe('SyncingTaskStore — save', () => {
	it('writes locally before anything else happens', async () => {
		const { store, local } = setup();

		await store.save(snapshot({ tasks: [task()] }));

		expect(local.saves).toHaveLength(1);
	});

	it('resolves even though the push has not run yet', async () => {
		const { store, timer } = setup();

		await store.save(snapshot({ tasks: [task()] }));

		expect(timer.armed).toBe(true);
	});

	it('rejects when the local write fails — a lost tick is not acceptable', async () => {
		const local = fakeLocal();
		local.save = async () => {
			throw new StorageUnavailableError('full');
		};
		const { store } = setup(local);

		await expect(store.save(snapshot())).rejects.toThrow(StorageUnavailableError);
	});

	it('keeps the local write when the push throws', async () => {
		const remote = fakeRemote();
		remote.pushError = new SyncUnavailableError('network', 'offline');
		const { store, local, timer } = setup(fakeLocal(), remote);

		await store.save(snapshot({ tasks: [task()] }));
		await timer.fire();

		expect(local.held.tasks).toHaveLength(1);
	});

	it('debounces a burst of writes into a single push', async () => {
		const { store, remote, timer } = setup();

		await store.save(snapshot({ tasks: [task({ id: 'a' })] }));
		await store.save(snapshot({ tasks: [task({ id: 'a' }), task({ id: 'b' })] }));
		await store.save(snapshot({ tasks: [task({ id: 'a' }), task({ id: 'b' }), task({ id: 'c' })] }));
		await timer.fire();

		expect(remote.pushes).toHaveLength(1);
		expect(remote.pushes[0].tasks).toHaveLength(3);
	});
});

describe('SyncingTaskStore — sync', () => {
	it('merges what the remote has into local', async () => {
		const local = fakeLocal(snapshot({ tasks: [task({ id: 'mine' })] }));
		const remote = fakeRemote(snapshot({ tasks: [task({ id: 'theirs' })] }));
		const { store } = setup(local, remote);

		await store.sync();

		expect(local.held.tasks.map((t) => t.id).sort()).toEqual(['mine', 'theirs']);
	});

	it('tells the page when a pull changed something', async () => {
		const local = fakeLocal();
		const remote = fakeRemote(snapshot({ tasks: [task({ id: 'theirs' })] }));
		const { store, external } = setup(local, remote);

		await store.sync();

		expect(external).toHaveBeenCalled();
	});

	it('stays quiet when the pull changed nothing', async () => {
		// A wake-up that finds no news must not re-hydrate the page, or every tab
		// focus costs a full store publish.
		const same = snapshot({ tasks: [task()] });
		const { store, external } = setup(fakeLocal(mine({ tasks: [task()] })), fakeRemote(same));

		await store.sync();

		expect(external).not.toHaveBeenCalled();
	});

	it('pushes what the remote is missing', async () => {
		const local = fakeLocal(snapshot({ tasks: [task({ id: 'mine' })] }));
		const { store, remote } = setup(local);

		await store.sync();

		expect(remote.pushes[0].tasks.map((t) => t.id)).toEqual(['mine']);
	});

	it('leaves local untouched when the pull fails', async () => {
		const local = fakeLocal(snapshot({ tasks: [task()] }));
		const remote = fakeRemote();
		remote.pullError = new SyncUnavailableError('network', 'offline');
		const { store } = setup(local, remote);

		await store.sync();

		expect(local.held.tasks).toHaveLength(1);
		expect(local.saves).toHaveLength(0);
	});

	it('does not reject on a failed sync — the tank keeps running', async () => {
		const remote = fakeRemote();
		remote.pullError = new SyncUnavailableError('network', 'offline');
		const { store } = setup(fakeLocal(), remote);

		await expect(store.sync()).resolves.toBeUndefined();
	});

	it('reports every remote failure reason as its own state', async () => {
		// Four reasons, four sentences. Collapsing any of them into 'offline' tells the
		// user to wait out something waiting will not fix.
		for (const [reason, expected] of [
			['network', 'offline'],
			['denied', 'denied'],
			['schema', 'stale'],
			['rejected', 'rejected']
		] as const) {
			const remote = fakeRemote();
			remote.pullError = new SyncUnavailableError(reason, reason);
			const { store, statuses } = setup(fakeLocal(), remote);

			await store.sync();

			expect(statuses.map((s) => s.state)).toContain(expected);
		}
	});

	it('flags a clock badly out of step rather than merging silently', async () => {
		// `now` is 1000 in these tests. A remote row stamped days ahead means one of
		// the two clocks is wrong, and last-write-wins is meaningless until it is not.
		const remote = fakeRemote(snapshot({ tasks: [task({ updatedAt: 1000 + 48 * 3600_000 })] }));
		const { store, statuses } = setup(fakeLocal(), remote);

		await store.sync();

		expect(statuses.map((s) => s.state)).toContain('skewed');
	});

	it('does not flag ordinary timestamps as skew', async () => {
		const remote = fakeRemote(snapshot({ tasks: [task({ updatedAt: 900 })] }));
		const { store, statuses } = setup(fakeLocal(), remote);

		await store.sync();

		expect(statuses.map((s) => s.state)).not.toContain('skewed');
	});

	it('does not let a pull clobber a write that landed while it was in flight', async () => {
		// The pull returns an older version of the same task. The merge must keep the
		// newer local one, not the snapshot the pull started from.
		const local = fakeLocal(snapshot({ tasks: [task({ title: 'old', updatedAt: 1 })] }));
		const remote = fakeRemote(snapshot({ tasks: [task({ title: 'stale', updatedAt: 1 })] }));
		remote.pull = async () => {
			await local.save(snapshot({ tasks: [task({ title: 'newest', updatedAt: 99 })] }));
			return remote.pullResult;
		};
		const { store } = setup(local, remote);

		await store.sync();

		expect(local.held.tasks[0].title).toBe('newest');
	});

	it('does not reject when the local re-read throws — a banner, not an exception', async () => {
		const local = fakeLocal();
		local.load = async () => {
			throw new StorageUnavailableError('full');
		};
		const { store, statuses } = setup(local);

		await expect(store.sync()).resolves.toBeUndefined();
		// Storage, not the network — the two clocks disagree on nothing here, quota
		// or private mode is a different failure than "check your signal".
		expect(statuses.map((s) => s.state)).toContain('storage');
	});

	it('does not reject when the local save of the merged snapshot throws', async () => {
		const local = fakeLocal();
		local.save = async () => {
			throw new StorageUnavailableError('full');
		};
		const remote = fakeRemote(snapshot({ tasks: [task({ id: 'theirs' })] }));
		const { store, statuses } = setup(local, remote);

		await expect(store.sync()).resolves.toBeUndefined();
		expect(statuses.map((s) => s.state)).toContain('storage');
	});

	it('reports a remote failure as offline, not storage', async () => {
		const remote = fakeRemote();
		remote.pullError = new SyncUnavailableError('network', 'offline');
		const { store, statuses } = setup(fakeLocal(), remote);

		await store.sync();

		expect(statuses.map((s) => s.state)).toContain('offline');
		expect(statuses.map((s) => s.state)).not.toContain('storage');
	});

	it('does not reject on an error that is neither StorageUnavailableError nor SyncUnavailableError', async () => {
		const remote = fakeRemote();
		remote.pullError = new Error('something unrelated broke');
		const { store, statuses } = setup(fakeLocal(), remote);

		await expect(store.sync()).resolves.toBeUndefined();
		expect(statuses.map((s) => s.state)).toContain('offline');
	});

	it('does not fire onExternalChange when the pull matches local under a different key order', async () => {
		// A remote task built by `fromTaskRow` spreads its optional keys (condition,
		// treatCost, completedAt, deletedAt) last; a locally authored task can have
		// `condition` set at creation, ahead of the later fields. Same values,
		// different key order — `JSON.stringify` would see these as different
		// snapshots and re-hydrate the page on every wake for no real change.
		const withCondition = task({ condition: { kind: 'time', at: '18:00' } });
		const authoredOrder: Task = {
			id: withCondition.id,
			condition: withCondition.condition,
			title: withCondition.title,
			date: withCondition.date,
			status: withCondition.status,
			createdAt: withCondition.createdAt,
			updatedAt: withCondition.updatedAt
		};
		const local = fakeLocal(mine({ tasks: [authoredOrder] }));
		const remote = fakeRemote(
			snapshot({ tasks: [fromTaskRow(toTaskRow(withCondition, 'user'))] })
		);
		const { store, local: localStore, external } = setup(local, remote);

		await store.sync();

		expect(external).not.toHaveBeenCalled();
		expect(localStore.saves).toHaveLength(0);
	});
});

describe('SyncingTaskStore — one sync at a time', () => {
	it('collapses concurrent syncs into a single round trip', async () => {
		// Three triggers in the same tick is the ordinary case: a tab switch fires
		// visibilitychange and focus, and a debounced write can land on top.
		const remote = fakeRemote();
		const releases: (() => void)[] = [];
		remote.pull = () => {
			remote.pulls++;
			return new Promise((resolve) => {
				releases.push(() => resolve(remote.pullResult));
			});
		};
		const { store } = setup(fakeLocal(), remote);

		const all = Promise.all([store.sync(), store.sync(), store.sync()]);
		// Release every pending pull, so a missing guard settles and fails on the
		// count rather than hanging until the test times out.
		for (const release of releases) release();
		await all;

		expect(remote.pulls).toBe(1);
	});

	it('lets a later sync run once the first has finished', async () => {
		// Single-flight must not become a lock: the next wake still syncs.
		const { store, remote } = setup();

		await store.sync();
		// The server has moved, so the freshness probe does not skip this one and
		// mask what the test is actually checking — that the lock released.
		remote.freshnessResult = 1;
		await store.sync();

		expect(remote.pulls).toBe(2);
	});

	it('still resolves every caller when the shared sync fails', async () => {
		const remote = fakeRemote();
		remote.pullError = new SyncUnavailableError('network', 'offline');
		const { store } = setup(fakeLocal(), remote);

		await expect(Promise.all([store.sync(), store.sync()])).resolves.toEqual([
			undefined,
			undefined
		]);
	});
});

describe('SyncingTaskStore — whose data this is (C1)', () => {
	const A = 'account-a';
	const B = 'account-b';

	function forOwner(owner: string, local = fakeLocal(), remote = fakeRemote()) {
		const timer = fakeTimer();
		const statuses: SyncStatus[] = [];
		const store = new SyncingTaskStore({
			local,
			remote,
			owner,
			onStatus: (status) => statuses.push(status),
			setTimer: timer.set,
			clearTimer: timer.clear,
			now: () => 1000
		});
		return { store, local, remote, timer, statuses };
	}

	it('merges unclaimed local data on a first sign-in, and stamps the owner on it', async () => {
		// The spec's promise: a week of offline use survives signing in.
		const local = fakeLocal(snapshot({ tasks: [task({ id: 'offline-week' })] }));
		const { store, remote } = forOwner(A, local);

		await store.sync();

		expect(local.held.tasks.map((t) => t.id)).toEqual(['offline-week']);
		expect(local.held.owner).toBe(A);
		expect(remote.pushes[0].tasks.map((t) => t.id)).toEqual(['offline-week']);
	});

	it('merges as usual when the same account signs in again', async () => {
		const local = fakeLocal({ ...snapshot({ tasks: [task({ id: 'mine' })] }), owner: A });
		const { store, remote } = forOwner(A, local);

		await store.sync();

		expect(local.held.tasks.map((t) => t.id)).toEqual(['mine']);
		expect(remote.pushes[0].tasks.map((t) => t.id)).toEqual(['mine']);
	});

	it('never uploads one account tank into another', async () => {
		const local = fakeLocal({ ...snapshot({ tasks: [task({ id: 'a-secret' })] }), owner: A });
		const { store, remote } = forOwner(B, local);

		await store.sync();

		expect(remote.pushes.flatMap((p) => p.tasks)).toEqual([]);
		expect(local.held.tasks).toEqual([]);
		expect(local.held.owner).toBe(B);
	});

	it('starts a different account from its own remote', async () => {
		const local = fakeLocal({
			...snapshot({ tasks: [task({ id: 'a-secret' })], koi: [{ date: '2026-08-01', earnedAt: 1 }] }),
			owner: A
		});
		const remote = fakeRemote(snapshot({ tasks: [task({ id: 'b-own' })] }));
		const { store } = forOwner(B, local, remote);

		await store.sync();

		expect(local.held.tasks.map((t) => t.id)).toEqual(['b-own']);
		expect(local.held.koi).toEqual([]);
	});

	it('does not show another account data even before the first sync completes', async () => {
		const local = fakeLocal({ ...snapshot({ tasks: [task({ id: 'a-secret' })] }), owner: A });
		const remote = fakeRemote();
		remote.pull = () => new Promise(() => {});
		const { store } = forOwner(B, local, remote);

		expect((await store.load()).tasks).toEqual([]);
	});

	it('refuses to write the previous account data under the new account name', async () => {
		// The residue of C1 (N1). After a sign-in the page still holds the previous
		// account's tasks in memory, and `hydrate()` is what drops them. If that first
		// sync fails — offline, or Supabase unreachable in the seconds after the OAuth
		// redirect — the next edit arrives here carrying A's tasks and A's claim. Merely
		// stamping the new owner onto it would relabel A's tank as B's, permanently
		// disarm the claim check, and push A's tasks under B's user_id when the network
		// returned. The write is discarded instead: it is not B's data to keep.
		const { store, local, remote, timer } = forOwner(B);

		await store.save({ ...snapshot({ tasks: [task({ id: 'a-secret' })] }), owner: A });
		await timer.fire();

		expect(local.held.tasks).toEqual([]);
		expect(local.held.owner).toBe(B);
		expect(remote.pushes.flatMap((p) => p.tasks)).toEqual([]);
	});

	it('keeps a write that is genuinely the signed-in account own', async () => {
		// The guard above must not eat ordinary edits: same owner, and unclaimed data
		// being written for the first time, both survive untouched.
		const { store, local } = forOwner(A);

		await store.save({ ...snapshot({ tasks: [task({ id: 'mine' })] }), owner: A });
		expect(local.held.tasks.map((t) => t.id)).toEqual(['mine']);

		await store.save(snapshot({ tasks: [task({ id: 'unclaimed' })] }));
		expect(local.held.tasks.map((t) => t.id)).toEqual(['unclaimed']);
		expect(local.held.owner).toBe(A);
	});

	it('stamps the owner on every write, so signing out cannot un-claim the snapshot', async () => {
		// Sign-out is not a delete, and the app's own save path rebuilds the snapshot
		// from `{ version, tasks, koi, settings }`. If the claim did not survive a
		// write it would be dropped and the next account would merge across identities.
		const { store, local } = forOwner(A);

		await store.save(snapshot({ tasks: [task()] }));

		expect(local.held.owner).toBe(A);
	});
});

describe('SyncingTaskStore — a remote written by a newer client (I5)', () => {
	it('does not write newer-shaped rows into localStorage under this build version', async () => {
		const local = fakeLocal();
		const remote = fakeRemote({
			...snapshot({ tasks: [task({ id: 'from-the-future' })] }),
			version: SCHEMA_VERSION + 1
		});
		const { store } = setup(local, remote);

		await store.sync();

		expect(local.saves).toEqual([]);
	});

	it('still reads it — the merged view is served from memory', async () => {
		const local = fakeLocal();
		const remote = fakeRemote({
			...snapshot({ tasks: [task({ id: 'from-the-future' })] }),
			version: SCHEMA_VERSION + 1
		});
		const { store, external } = setup(local, remote);

		await store.sync();

		expect((await store.load()).tasks.map((t) => t.id)).toEqual(['from-the-future']);
		expect(external).toHaveBeenCalled();
	});

	it('ends up stale, so the user is told this device is out of date', async () => {
		const remote = fakeRemote({ ...snapshot(), version: SCHEMA_VERSION + 1 });
		const { store, statuses } = setup(fakeLocal(), remote);

		await store.sync();

		expect(statuses.at(-1)?.state).toBe('stale');
	});
});

describe('SyncingTaskStore — the skew banner reaches the user (I3)', () => {
	it('ends up skewed on a quiet sync with nothing to push', async () => {
		const same = snapshot({ tasks: [task({ updatedAt: 1000 + 48 * 3600_000 })] });
		const { store, statuses } = setup(
			fakeLocal(mine({ tasks: [task({ updatedAt: 1000 + 48 * 3600_000 })] })),
			fakeRemote(same)
		);

		await store.sync();

		expect(statuses.at(-1)?.state).toBe('skewed');
	});

	it('ends up skewed on a sync that did push', async () => {
		const local = fakeLocal(snapshot({ tasks: [task({ id: 'mine' })] }));
		const remote = fakeRemote(snapshot({ tasks: [task({ id: 'theirs', updatedAt: 1000 + 48 * 3600_000 })] }));
		const { store, statuses } = setup(local, remote);

		await store.sync();

		expect(statuses.at(-1)?.state).toBe('skewed');
	});

	it('ends up idle when the clocks agree', async () => {
		const { store, statuses } = setup();

		await store.sync();

		expect(statuses.at(-1)?.state).toBe('idle');
	});
});

describe('SyncingTaskStore — when this device last synced', () => {
	it('stamps the time on a successful sync', async () => {
		const { store, statuses } = setup();

		await store.sync();

		expect(statuses.at(-1)?.at).toBe(1000);
	});

	it('has no time before the first successful sync', async () => {
		const remote = fakeRemote();
		remote.pullError = new SyncUnavailableError('network', 'offline');
		const { store, statuses } = setup(fakeLocal(), remote);

		await store.sync();

		expect(statuses.at(-1)?.at).toBeUndefined();
	});

	it('keeps the last successful time through a later failure', async () => {
		// This is the line that matters most in the UI: "Not syncing — offline. Last
		// synced 20 minutes ago." Clearing `at` on failure would blank the timestamp
		// at exactly the moment the user needs it.
		const remote = fakeRemote();
		const { store, statuses } = setup(fakeLocal(), remote);

		await store.sync();
		remote.pullError = new SyncUnavailableError('network', 'offline');
		// A server that has moved since the last sync, so the probe does not skip
		// straight to 'idle' before the failing pull ever runs.
		remote.freshnessResult = 1;
		await store.sync();

		expect(statuses.at(-1)?.state).toBe('offline');
		expect(statuses.at(-1)?.at).toBe(1000);
	});

	it('reports the time on the in-flight status too, so the UI never blanks', async () => {
		// The second sync emits 'syncing' before it emits anything else. If that
		// status dropped `at`, the line would flick to "Not synced yet" every time
		// the user pressed Sync now — the exact moment they are watching it.
		const { store, statuses } = setup();

		await store.sync();
		statuses.length = 0;
		await store.sync();

		const inFlight = statuses.filter((s) => s.state === 'syncing');
		expect(inFlight).toHaveLength(1);
		expect(inFlight[0].at).toBe(1000);
	});
});

describe('SyncingTaskStore — not syncing more than it needs to', () => {
	it('skips a wake sync that follows a successful one too closely', async () => {
		// Alt-tabbing repeatedly should not cost a round trip each time.
		const { store, remote } = setup();

		await store.sync('wake');
		await store.sync('wake');

		expect(remote.pulls).toBe(1);
	});

	it('never throttles a write, a manual sync, or an account change', async () => {
		// A user's own edit must reach the server immediately. This is the constraint
		// the whole feature is subordinate to.
		const { store, remote } = setup();

		await store.sync('wake');
		// Each call reports the server moving again, so the freshness probe never
		// gets a chance to mask what this test is actually checking — the cooldown.
		remote.freshnessResult = 1;
		await store.sync('write');
		remote.freshnessResult = 2;
		await store.sync('manual');
		remote.freshnessResult = 3;
		await store.sync('account');

		expect(remote.pulls).toBe(4);
	});

	it('wakes again once the cooldown has passed', async () => {
		let clock = 1000;
		const remote = fakeRemote();
		const store = new SyncingTaskStore({
			local: fakeLocal(),
			remote,
			owner: 'owner',
			now: () => clock,
			setTimer: () => 1,
			clearTimer: () => {}
		});

		await store.sync('wake');
		clock += 30_001;
		// The server has moved, so this second wake is a real pull rather than one
		// the freshness probe skips — the cooldown is what this test is checking.
		remote.freshnessResult = 1;
		await store.sync('wake');

		expect(remote.pulls).toBe(2);
	});

	it('does not let a failure start the cooldown', async () => {
		// A failed sync synced nothing, so it must not make the next wake look recent.
		// `backoffMs: 0` isolates that from the failure backoff, which is a separate
		// policy with its own test — without it this test would be asserting both at
		// once and the two disagree at zero elapsed time.
		const remote = fakeRemote();
		remote.pullError = new SyncUnavailableError('network', 'offline');
		const store = new SyncingTaskStore({
			local: fakeLocal(),
			remote,
			owner: 'owner',
			now: () => 1000,
			backoffMs: 0,
			setTimer: () => 1,
			clearTimer: () => {}
		});

		await store.sync('wake');
		remote.pullError = undefined;
		await store.sync('wake');

		expect(remote.pulls).toBe(2);
	});

	it('backs off repeated wake retries after a failure', async () => {
		// Every wake retrying a dead sync is how a phone burns battery on a flight.
		let clock = 1000;
		const remote = fakeRemote();
		remote.pullError = new SyncUnavailableError('network', 'offline');
		const store = new SyncingTaskStore({
			local: fakeLocal(),
			remote,
			owner: 'owner',
			now: () => clock,
			setTimer: () => 1,
			clearTimer: () => {}
		});

		await store.sync('wake');
		clock += 1000;
		await store.sync('wake');
		clock += 1000;
		await store.sync('wake');

		expect(remote.pulls).toBe(1);
	});

	it('retries a failed sync once the backoff has passed', async () => {
		let clock = 1000;
		const remote = fakeRemote();
		remote.pullError = new SyncUnavailableError('network', 'offline');
		const store = new SyncingTaskStore({
			local: fakeLocal(),
			remote,
			owner: 'owner',
			now: () => clock,
			setTimer: () => 1,
			clearTimer: () => {}
		});

		await store.sync('wake');
		clock += 60_001;
		await store.sync('wake');

		expect(remote.pulls).toBe(2);
	});

	it('lets a manual sync escape the backoff', async () => {
		// The button exists so the user can ask again. Refusing them because a wake
		// failed a moment ago would make it look broken.
		const remote = fakeRemote();
		remote.pullError = new SyncUnavailableError('network', 'offline');
		const { store } = setup(fakeLocal(), remote);

		await store.sync('wake');
		await store.sync('manual');

		expect(remote.pulls).toBe(2);
	});
});

describe('SyncingTaskStore — skipping a pull that would learn nothing', () => {
	it('skips the pull when the server has not moved since the last sync', async () => {
		// The probe's answer must equal what `newestOf` computes from the pulled
		// snapshot, or "unchanged" never matches and the probe costs a round trip
		// instead of saving three. `snapshot()` has no tasks and settings stamped 0,
		// so the newest timestamp it holds is 0 — the fake's default.
		const { store, remote } = setup();

		await store.sync('manual');
		const after = remote.pulls;
		await store.sync('manual');

		expect(remote.pulls).toBe(after);
	});

	it('pulls when the server has moved', async () => {
		const { store, remote } = setup();

		await store.sync('manual');
		remote.freshnessResult = 900;
		await store.sync('manual');

		expect(remote.pulls).toBe(2);
	});

	it('pulls when the probe cannot answer', async () => {
		// An undeployed SQL function must not stop the app syncing.
		const { store, remote } = setup();
		remote.freshnessResult = undefined;

		await store.sync('manual');
		await store.sync('manual');

		expect(remote.pulls).toBe(2);
	});

	it('pulls anyway when this device has something to push', async () => {
		// The probe only says whether the SERVER changed. A local edit still has to
		// go up, and push refuses without a preceding pull.
		const { store, remote, timer } = setup();

		await store.sync('manual');
		await store.save(snapshot({ tasks: [task({ id: 'mine' })] }));
		await timer.fire();

		expect(remote.pulls).toBe(2);
		expect(remote.pushes.at(-1)?.tasks.map((t) => t.id)).toEqual(['mine']);
	});

	it('counts a skipped sync as a successful one', async () => {
		// It verified the tank is current, which is exactly what the timestamp claims.
		const { store, statuses } = setup();

		await store.sync('manual');
		await store.sync('manual');

		expect(statuses.at(-1)?.state).toBe('idle');
		expect(statuses.at(-1)?.at).toBe(1000);
	});
});

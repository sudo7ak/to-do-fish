# Supabase Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The same tank on every device the user signs into, without giving up a
tank that works offline and signed out.

**Architecture:** A `SyncingTaskStore` implements the existing `TaskStore` port and
wraps `LocalTaskStore` plus a Supabase remote. Local is written first and always;
the cloud is reconciled by a pure `merge()` using last-write-wins on the `updatedAt`
each task already carries. Nothing above `persist/` learns that sync exists, except
one optional callback that asks the page to re-hydrate after a pull changed
something.

**Tech Stack:** SvelteKit 5 (runes), TypeScript, `@supabase/supabase-js` v2,
Postgres with RLS, vitest, Playwright via `scripts/e2e.mjs`, static build to GitHub
Pages.

**Spec:** `docs/superpowers/specs/2026-08-10-supabase-sync-design.md`

## Global Constraints

- **`render/` imports nothing outside itself.** No task here touches `render/`.
- **`store/` reaches persistence only through the `TaskStore` interface.** No task
  adds a Supabase import to `store/`.
- **`persist/sync/merge.ts` imports only `../../types`.** No Supabase import, no
  browser API. This is what makes it testable.
- **Timestamps are client epoch milliseconds (`bigint` in Postgres).** Never
  `timestamptz`, never a database default.
- **Absent optionals stay absent.** `condition`, `treatCost`, `completedAt`,
  `deletedAt` round-trip as `undefined`, never `null`. `isLive()` tests the field's
  presence, so `deletedAt: null` would read as a live task.
- **Tasks are never spliced.** Deletion is `deletedAt`, and tombstones replicate.
- **Koi are never revoked.** No delete path client-side or in SQL.
- **The app must build, test, and pass all E2E checks with Supabase unconfigured.**
  Missing env vars are a supported state, not an error.
- **Existing suites must stay green at every commit:** `npm test`, `npm run check`
  (0 errors), `npm run e2e` (68/68 with a dev server on port 5199).
- **Every mutation bumps `updatedAt`; IDs are client-side ULIDs.** Already true;
  do not regress it.
- Commit after every task. Conventional Commits, imperative subject.

---

### Task 1: The pure merge

The whole risk of this feature lives in this file. It has no network and no
Supabase types, so it can be tested as data in, data out.

**Files:**
- Create: `src/lib/persist/sync/merge.ts`
- Test: `src/lib/persist/sync/merge.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `Task`, `KoiRecord`, `Settings`, `SCHEMA_VERSION` from
  `src/lib/types.ts`.
- Produces: `merge(local: Snapshot, remote: Snapshot): MergeResult` where

  ```ts
  type Push = { tasks: Task[]; koi: KoiRecord[]; settings?: Settings };
  type MergeResult = { merged: Snapshot; push: Push };
  ```

  `push.settings` is absent when the remote already has the newer settings record.
  Later tasks call only `merge` and read `.merged` and `.push`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/persist/sync/merge.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { merge } from './merge';
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
```

Note the `settings.updatedAt` field used above — `Settings` does not have one yet.
Step 3 adds it, which is a schema change and therefore also a migration.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/lib/persist/sync/merge.test.ts`
Expected: FAIL — "Failed to resolve import './merge'".

- [ ] **Step 3: Add `updatedAt` to `Settings` and migrate**

Settings merge whole-record, so the record needs its own timestamp. In
`src/lib/types.ts`, change the `Settings` type and bump the schema version:

```ts
export type Settings = {
	environment: 'progress' | 'calm';
	seenLegend: boolean;
	/** Bumped whenever a setting changes. The whole record is the unit of sync. */
	updatedAt: number;
};

/** Current storage schema version. Bumped when `Snapshot` changes shape. */
export const SCHEMA_VERSION = 3;
```

In `src/lib/persist/migrate.ts`, add the step to the `migrations` map:

```ts
	// 2 -> 3: settings gained their own `updatedAt`, because the whole record is the
	// unit of last-write-wins once a second device exists.
	//
	// ZERO, not the current time. Stored settings predate sync, so they must lose to
	// anything a synced device has actually chosen. Stamping them "now" would let a
	// device that has never been configured overwrite one that has.
	2: (data) => {
		const settings =
			typeof data.settings === 'object' && data.settings !== null
				? (data.settings as Record<string, unknown>)
				: {};
		return { ...data, settings: { ...settings, updatedAt: 0 } };
	}
```

Then fix the type errors this produces: `emptySnapshot()` in
`src/lib/persist/local.ts` and the initial `writable` values in
`src/lib/store/tasks.ts` each need `updatedAt: 0` added to their settings literal,
and `setEnvironment` / `markLegendSeen` in `src/lib/store/tasks.ts` must stamp
`updatedAt: now`. Both currently take no clock — give them the same `now: number`
parameter the other reducers take, and pass `clock()` at the call site in
`createTaskStore`.

- [ ] **Step 4: Write the merge**

Create `src/lib/persist/sync/merge.ts`:

```ts
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

export type MergeResult = {
	/** What both sides should end up holding. */
	merged: Snapshot;
	push: Push;
};

export function merge(local: Snapshot, remote: Snapshot): MergeResult {
	const tasks = mergeTasks(local.tasks, remote.tasks);
	const koi = mergeKoi(local.koi, remote.koi);
	const settings = mergeSettings(local.settings, remote.settings);

	const remoteById = new Map(remote.tasks.map((task) => [task.id, task]));
	const remoteKoi = new Map(remote.koi.map((record) => [record.date, record]));

	return {
		merged: { version: SCHEMA_VERSION, tasks, koi, settings },
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
 * Last write wins, per task, on the client `updatedAt` every mutation already bumps.
 *
 * A tie means the two clocks disagree, and the two failures are not symmetric: a
 * task that comes back from the dead is worse than a deletion that lands early, so
 * the tombstone takes the tie. Failing that, remote wins — an arbitrary but stable
 * choice, so the same pair merges the same way on both devices.
 */
function winner(local: Task, remote: Task): Task {
	if (local.updatedAt > remote.updatedAt) return local;
	if (remote.updatedAt > local.updatedAt) return remote;
	if (local.deletedAt !== undefined) return local;
	return remote;
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

function mergeSettings(local: Settings, remote: Settings): Settings {
	const winner = remote.updatedAt > local.updatedAt ? remote : local;

	// `seenLegend` is a one-way latch, so it is the one field that does not follow the
	// record. An older device syncing in must not make the first-run legend reappear.
	return { ...winner, seenLegend: local.seenLegend || remote.seenLegend };
}

/** Field-wise, because the latch above means the merged record is always a new object. */
function sameSettings(a: Settings, b: Settings): boolean {
	return (
		a.environment === b.environment && a.seenLegend === b.seenLegend && a.updatedAt === b.updatedAt
	);
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run src/lib/persist/sync/merge.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Run the whole suite and the typecheck**

Run: `npm test && npm run check`
Expected: all tests pass (the existing settings tests may need `updatedAt` added to
their expected values — update the expectations, do not weaken the assertions), and
svelte-check reports 0 errors.

- [ ] **Step 7: Validate the tests by mutation**

Break each rule on purpose and confirm a test dies. Restore after each:

1. In `winner`, change `if (local.deletedAt !== undefined) return local;` to
   `return remote;` → the tie-goes-to-deleted test must fail.
2. In `mergeKoi`, change `incoming.earnedAt < mine.earnedAt` to `>` → the earlier-
   `earnedAt` test must fail.
3. In `mergeSettings`, drop the `seenLegend` latch line → the latch test must fail.
4. In `merge`, push `tasks` unfiltered → the no-op-sync test must fail.

If any mutation leaves the suite green, the test is not testing what it claims. Fix
the test, not the mutation.

- [ ] **Step 8: Commit**

```bash
git add src/lib/persist/sync/merge.ts src/lib/persist/sync/merge.test.ts \
        src/lib/types.ts src/lib/persist/migrate.ts src/lib/persist/local.ts \
        src/lib/store/tasks.ts
git commit -m "feat: pure last-write-wins merge for two snapshots of one tank"
```

---

### Task 2: Rows to snapshot and back

The mapping between Postgres rows and the domain, with no client involved. Split
from the network code so the `null`/`undefined` trap can be tested exhaustively.

**Files:**
- Create: `src/lib/persist/sync/rows.ts`
- Test: `src/lib/persist/sync/rows.test.ts`

**Interfaces:**
- Consumes: `Task`, `KoiRecord`, `Settings`, `Snapshot` from `src/lib/types.ts`.
- Produces:
  - `type TaskRow`, `type KoiRow`, `type SettingsRow`
  - `toTaskRow(task: Task, userId: string): TaskRow`
  - `fromTaskRow(row: TaskRow): Task`
  - `toKoiRow(record: KoiRecord, userId: string): KoiRow`
  - `fromKoiRow(row: KoiRow): KoiRecord`
  - `toSettingsRow(settings: Settings, userId: string, version: number): SettingsRow`
  - `fromSettingsRow(row: SettingsRow): Settings`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/persist/sync/rows.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
	toTaskRow,
	fromTaskRow,
	toKoiRow,
	fromKoiRow,
	toSettingsRow,
	fromSettingsRow
} from './rows';
import { SCHEMA_VERSION, isLive, type Task } from '../../types';

const USER = '00000000-0000-0000-0000-000000000001';

const task = (over: Partial<Task> = {}): Task => ({
	id: '01J0000000000000000000000A',
	title: 'Call mum',
	date: '2026-08-10',
	status: 'open',
	createdAt: 1,
	updatedAt: 2,
	...over
});

describe('task rows', () => {
	it('round-trips a plain task unchanged', () => {
		const original = task();
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('round-trips a timed condition through jsonb', () => {
		const original = task({ condition: { kind: 'time', at: '18:00' }, status: 'waiting' });
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('round-trips a dependency condition, cutoff and all', () => {
		const original = task({
			condition: { kind: 'task', taskId: 'other', before: '17:00' },
			status: 'waiting'
		});
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('round-trips a treat', () => {
		const original = task({ treatCost: 3, status: 'waiting' });
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('round-trips a completed task', () => {
		const original = task({ status: 'done', completedAt: 500 });
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('round-trips a tombstone', () => {
		const original = task({ deletedAt: 900 });
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('brings absent optionals back absent, never null', () => {
		// `isLive` tests for the field's presence, so `deletedAt: null` would read as a
		// live task while still being a tombstone in the database.
		const restored = fromTaskRow(toTaskRow(task(), USER));

		expect('deletedAt' in restored).toBe(false);
		expect('completedAt' in restored).toBe(false);
		expect('condition' in restored).toBe(false);
		expect('treatCost' in restored).toBe(false);
		expect(isLive(restored)).toBe(true);
	});

	it('reads a null column from the database back as absent', () => {
		// Postgres returns null for an unset column; the domain says undefined.
		const row = { ...toTaskRow(task(), USER), deleted_at: null, condition: null };

		expect('deletedAt' in fromTaskRow(row)).toBe(false);
		expect('condition' in fromTaskRow(row)).toBe(false);
	});

	it('keeps deletedAt: 0 as a deletion', () => {
		// Zero is a valid epoch and must not be mistaken for absent anywhere in the
		// mapping. This is the same trap `isLive` exists to avoid.
		const restored = fromTaskRow(toTaskRow(task({ deletedAt: 0 }), USER));

		expect(restored.deletedAt).toBe(0);
		expect(isLive(restored)).toBe(false);
	});

	it('stamps the user on the row', () => {
		expect(toTaskRow(task(), USER).user_id).toBe(USER);
	});
});

describe('koi rows', () => {
	it('round-trips a koi record', () => {
		const original = { date: '2026-08-09', earnedAt: 42 };
		expect(fromKoiRow(toKoiRow(original, USER))).toEqual(original);
	});
});

describe('settings rows', () => {
	it('round-trips settings', () => {
		const original = { environment: 'calm' as const, seenLegend: true, updatedAt: 7 };
		expect(fromSettingsRow(toSettingsRow(original, USER, SCHEMA_VERSION))).toEqual(original);
	});

	it('carries the writing client schema version', () => {
		const row = toSettingsRow(
			{ environment: 'calm', seenLegend: true, updatedAt: 7 },
			USER,
			SCHEMA_VERSION
		);

		expect(row.version).toBe(SCHEMA_VERSION);
	});
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/lib/persist/sync/rows.test.ts`
Expected: FAIL — "Failed to resolve import './rows'".

- [ ] **Step 3: Write the mapping**

Create `src/lib/persist/sync/rows.ts`:

```ts
import type { Condition, KoiRecord, Settings, Task, TaskStatus } from '../../types';

/**
 * The row shapes, and the translation to and from the domain.
 *
 * Kept apart from the Supabase client so the one genuinely dangerous rule here —
 * absent stays absent, and never becomes null — can be tested without a network.
 * `isLive()` asks whether `deletedAt` is present, so a `null` leaking into the
 * domain would make a deleted task swim again.
 */

export type TaskRow = {
	user_id: string;
	id: string;
	title: string;
	date: string;
	condition: Condition | null;
	treat_cost: number | null;
	status: TaskStatus;
	created_at: number;
	completed_at: number | null;
	updated_at: number;
	deleted_at: number | null;
};

export type KoiRow = { user_id: string; date: string; earned_at: number };

export type SettingsRow = {
	user_id: string;
	environment: Settings['environment'];
	seen_legend: boolean;
	version: number;
	updated_at: number;
};

/** Present stays present, absent becomes null. The inverse of `optional`. */
const nullable = <T>(value: T | undefined): T | null => (value === undefined ? null : value);

/**
 * Spreads to `{}` when the column is null, so the key is genuinely absent rather
 * than present-and-undefined. `{ deletedAt: undefined }` fails an `'in'` check but
 * passes a truthiness check, and the two would disagree.
 */
const optional = <K extends string, T>(key: K, value: T | null) =>
	value === null ? {} : ({ [key]: value } as Record<K, T>);

export function toTaskRow(task: Task, userId: string): TaskRow {
	return {
		user_id: userId,
		id: task.id,
		title: task.title,
		date: task.date,
		condition: nullable(task.condition),
		treat_cost: nullable(task.treatCost),
		status: task.status,
		created_at: task.createdAt,
		completed_at: nullable(task.completedAt),
		updated_at: task.updatedAt,
		deleted_at: nullable(task.deletedAt)
	};
}

export function fromTaskRow(row: TaskRow): Task {
	return {
		id: row.id,
		title: row.title,
		date: row.date,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		...optional('condition', row.condition),
		...optional('treatCost', row.treat_cost),
		...optional('completedAt', row.completed_at),
		...optional('deletedAt', row.deleted_at)
	};
}

export function toKoiRow(record: KoiRecord, userId: string): KoiRow {
	return { user_id: userId, date: record.date, earned_at: record.earnedAt };
}

export function fromKoiRow(row: KoiRow): KoiRecord {
	return { date: row.date, earnedAt: row.earned_at };
}

export function toSettingsRow(settings: Settings, userId: string, version: number): SettingsRow {
	return {
		user_id: userId,
		environment: settings.environment,
		seen_legend: settings.seenLegend,
		version,
		updated_at: settings.updatedAt
	};
}

export function fromSettingsRow(row: SettingsRow): Settings {
	return {
		environment: row.environment,
		seenLegend: row.seen_legend,
		updatedAt: row.updated_at
	};
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/lib/persist/sync/rows.test.ts`
Expected: PASS.

- [ ] **Step 5: Validate by mutation**

Change `optional` to `({ [key]: value ?? undefined })` — always present. The
"absent optionals" test must fail. Restore it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/persist/sync/rows.ts src/lib/persist/sync/rows.test.ts
git commit -m "feat: map task, koi and settings rows to and from the domain"
```

---

### Task 3: The remote

The only file allowed to import `@supabase/supabase-js`. It reads and writes; it
decides nothing.

**Files:**
- Create: `src/lib/persist/sync/remote.ts`
- Test: `src/lib/persist/sync/remote.test.ts`
- Modify: `package.json` (add the dependency)

**Interfaces:**
- Consumes: `rows.ts` (all six mappers and the three row types), `Snapshot` and
  `SCHEMA_VERSION` from `src/lib/types.ts`.
- Produces:
  - `interface Remote { pull(): Promise<Snapshot>; push(push: Push): Promise<void> }`, with
    `Push` imported from `./merge`
  - `class SupabaseRemote implements Remote`, constructed as
    `new SupabaseRemote(client: SupabaseLike, userId: string)`
  - `type SupabaseLike` — the narrow slice of the Supabase client this uses, so
    tests can pass a fake
  - `class SyncUnavailableError extends Error` with
    `readonly reason: 'network' | 'denied' | 'schema'`

- [ ] **Step 1: Add the dependency**

```bash
npm install @supabase/supabase-js
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/persist/sync/remote.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `npx vitest run src/lib/persist/sync/remote.test.ts`
Expected: FAIL — "Failed to resolve import './remote'".

- [ ] **Step 4: Write the remote**

Create `src/lib/persist/sync/remote.ts`:

```ts
import { SCHEMA_VERSION, type Snapshot } from '../../types';
import type { Push } from './merge';
import {
	fromKoiRow,
	fromSettingsRow,
	fromTaskRow,
	toKoiRow,
	toSettingsRow,
	toTaskRow,
	type KoiRow,
	type SettingsRow,
	type TaskRow
} from './rows';

/**
 * The only file in the app that talks to Supabase.
 *
 * It reads and writes and classifies its failures; it decides nothing. Every rule
 * about which side wins lives in `merge.ts`, which has no idea this file exists.
 */

/** The slice of the Supabase client actually used, so a test can supply a fake. */
export type SupabaseLike = {
	from(table: string): {
		select(columns?: string): Promise<{ data: unknown[] | null; error: unknown }>;
		upsert(rows: unknown[], options?: { onConflict: string }): Promise<{ error: unknown }>;
	};
};

export interface Remote {
	pull(): Promise<Snapshot>;
	push(push: Push): Promise<void>;
}

/**
 * Sync failed. `reason` exists because the three cases want three different
 * sentences: network is "we will retry", denied is "something is wrong with this
 * account", schema is "this device is out of date".
 */
export class SyncUnavailableError extends Error {
	readonly reason: 'network' | 'denied' | 'schema';

	constructor(reason: SyncUnavailableError['reason'], message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'SyncUnavailableError';
		this.reason = reason;
	}
}

export class SupabaseRemote implements Remote {
	#client: SupabaseLike;
	#userId: string;

	/**
	 * The schema version last seen on the server. Remembered from the pull so a push
	 * can refuse rather than overwrite rows a newer client wrote.
	 */
	#remoteVersion = SCHEMA_VERSION;

	constructor(client: SupabaseLike, userId: string) {
		this.#client = client;
		this.#userId = userId;
	}

	async pull(): Promise<Snapshot> {
		const [tasks, koi, settings] = await Promise.all([
			this.#select<TaskRow>('tasks'),
			this.#select<KoiRow>('koi'),
			this.#select<SettingsRow>('settings')
		]);

		const row = settings[0];
		this.#remoteVersion = row?.version ?? SCHEMA_VERSION;

		return {
			version: SCHEMA_VERSION,
			tasks: tasks.map(fromTaskRow),
			koi: koi.map(fromKoiRow),
			// An account with no settings row yet is not an error; it is a first sync.
			settings: row
				? fromSettingsRow(row)
				: { environment: 'progress', seenLegend: false, updatedAt: 0 }
		};
	}

	async push(snapshot: Push): Promise<void> {
		if (this.#remoteVersion > SCHEMA_VERSION) {
			throw new SyncUnavailableError(
				'schema',
				'This device is out of date and will not overwrite newer data'
			);
		}

		await this.#upsert(
			'tasks',
			snapshot.tasks.map((task) => toTaskRow(task, this.#userId)),
			'user_id,id'
		);
		await this.#upsert(
			'koi',
			snapshot.koi.map((record) => toKoiRow(record, this.#userId)),
			'user_id,date'
		);
		if (snapshot.settings) {
			await this.#upsert(
				'settings',
				[toSettingsRow(snapshot.settings, this.#userId, SCHEMA_VERSION)],
				'user_id'
			);
		}
	}

	async #select<T>(table: string): Promise<T[]> {
		const { data, error } = await this.#client.from(table).select('*');
		if (error) throw classify(error, `Could not read ${table}`);
		return (data ?? []) as T[];
	}

	async #upsert(table: string, rows: unknown[], onConflict: string): Promise<void> {
		// Zero rows is the quiet-sync case and worth not sending.
		if (rows.length === 0) return;

		const { error } = await this.#client.from(table).upsert(rows, { onConflict });
		if (error) throw classify(error, `Could not write ${table}`);
	}
}

/**
 * Postgres `42501` is insufficient_privilege, which here means RLS refused — a
 * broken account or a missing policy, not a flaky connection, so it must not be
 * retried in a loop.
 */
function classify(error: unknown, message: string): SyncUnavailableError {
	const code = (error as { code?: string })?.code;
	const reason = code === '42501' ? 'denied' : 'network';
	return new SyncUnavailableError(reason, message, { cause: error });
}
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run src/lib/persist/sync/remote.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the whole suite and the typecheck**

Run: `npm test && npm run check`
Expected: all green, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/persist/sync/remote.ts \
        src/lib/persist/sync/remote.test.ts
git commit -m "feat: read and write tank rows through Supabase"
```

---

### Task 4: The syncing store

Where a policy and a network meet. Thin, because the policy lives in `merge.ts`.

**Files:**
- Create: `src/lib/persist/sync/syncing.ts`
- Test: `src/lib/persist/sync/syncing.test.ts`

**Interfaces:**
- Consumes: `TaskStore` and `StorageUnavailableError` from `../port`, `merge` from
  `./merge`, `Remote` and `SyncUnavailableError` from `./remote`.
- Produces:
  - `type SyncStatus = { state: 'idle' | 'syncing' | 'offline' | 'denied' | 'stale' | 'skewed' }`
  - `class SyncingTaskStore implements TaskStore`, constructed as
    `new SyncingTaskStore(options: SyncingOptions)` where

    ```ts
    type SyncingOptions = {
      local: TaskStore;
      remote: Remote;
      onExternalChange?: () => void;
      onStatus?: (status: SyncStatus) => void;
      now?: () => number;
      debounceMs?: number;
      setTimer?: (fn: () => void, ms: number) => number;
      clearTimer?: (handle: number) => void;
    };
    ```
  - Methods beyond the port: `sync(): Promise<void>` — pull, merge, push. Called on
    wake by the page.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/persist/sync/syncing.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { SyncingTaskStore, type SyncStatus } from './syncing';
import { SyncUnavailableError, type Remote } from './remote';
import { StorageUnavailableError, type TaskStore } from '../port';
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
	} satisfies TaskStore & { saves: Snapshot[] };
}

function fakeRemote(initial: Snapshot = snapshot()) {
	return {
		pushes: [] as Snapshot[],
		pullResult: initial,
		pullError: undefined as unknown,
		pushError: undefined as unknown,
		async pull() {
			if (this.pullError) throw this.pullError;
			return this.pullResult;
		},
		async push(next: Snapshot) {
			if (this.pushError) throw this.pushError;
			this.pushes.push(next);
		}
	} satisfies Remote & { pushes: Snapshot[] };
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
		const { store, external } = setup(fakeLocal(structuredClone(same)), fakeRemote(same));

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

	it('reports offline, denied and stale as distinct states', async () => {
		for (const [reason, expected] of [
			['network', 'offline'],
			['denied', 'denied'],
			['schema', 'stale']
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
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/lib/persist/sync/syncing.test.ts`
Expected: FAIL — "Failed to resolve import './syncing'".

- [ ] **Step 3: Write the syncing store**

Create `src/lib/persist/sync/syncing.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/lib/persist/sync/syncing.test.ts`
Expected: PASS.

- [ ] **Step 5: Validate by mutation**

1. In `sync`, replace the re-read (`const local = await this.#local.load()`) with a
   snapshot captured before the pull → the in-flight-write test must fail.
2. Delete the `changed` guard and always call `onExternalChange` → the "stays quiet"
   test must fail.
3. Make `save` push without awaiting the local write → the local-write test must fail.

Restore each. If a mutation leaves the suite green, re-aim the test.

- [ ] **Step 6: Run the whole suite and the typecheck**

Run: `npm test && npm run check`
Expected: all green, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/persist/sync/syncing.ts src/lib/persist/sync/syncing.test.ts
git commit -m "feat: a TaskStore that reconciles local and remote on wake"
```

---

### Task 5: The database

Schema, RLS, and the setup a second person would need to reproduce it. No app code.

**Files:**
- Create: `supabase/schema.sql`
- Create: `docs/supabase-setup.md`

**Interfaces:**
- Consumes: the column names in `src/lib/persist/sync/rows.ts`. They must match
  exactly — `user_id`, `treat_cost`, `created_at`, `completed_at`, `updated_at`,
  `deleted_at`, `earned_at`, `seen_legend`, `version`.
- Produces: nothing importable. The tables `tasks`, `koi`, `settings`.

- [ ] **Step 1: Write the schema**

Create `supabase/schema.sql`:

```sql
-- The whole server side of the fish tank. Three tables, RLS on all of them, and no
-- server-side code: the anon key plus these policies are the entire security model.
--
-- Timestamps are client epoch milliseconds, deliberately. `updated_at` is the input
-- to last-write-wins and the client owns it; a database default would introduce a
-- second clock that disagrees with the first.

create table if not exists public.tasks (
  user_id      uuid   not null references auth.users on delete cascade,
  id           text   not null,
  title        text   not null,
  date         text   not null,
  condition    jsonb,
  treat_cost   int,
  status       text   not null check (status in ('waiting', 'open', 'done')),
  created_at   bigint not null,
  completed_at bigint,
  updated_at   bigint not null,
  -- A soft delete. Rows are never removed: a deletion that does not replicate is a
  -- task that comes back from the dead on the other device.
  deleted_at   bigint,
  primary key (user_id, id)
);

create table if not exists public.koi (
  user_id   uuid   not null references auth.users on delete cascade,
  date      text   not null,
  earned_at bigint not null,
  primary key (user_id, date)
);

create table if not exists public.settings (
  user_id     uuid primary key references auth.users on delete cascade,
  environment text   not null check (environment in ('progress', 'calm')),
  seen_legend boolean not null,
  version     int    not null,
  updated_at  bigint not null
);

alter table public.tasks    enable row level security;
alter table public.koi      enable row level security;
alter table public.settings enable row level security;

-- One policy per table covering every verb. There is no sharing in this app: a row
-- belongs to exactly one account and is invisible to every other.
create policy "own tasks"    on public.tasks    for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own koi"      on public.koi      for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own settings" on public.settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Deliberately absent: any trigger, default, or generated column touching
-- `updated_at`. The merge depends on the client's number arriving unmodified.

-- The tank is only ever read a whole account at a time, so this is the only index
-- worth having beyond the primary keys.
create index if not exists tasks_user_updated on public.tasks (user_id, updated_at);
```

- [ ] **Step 2: Apply it and confirm RLS actually refuses**

In the Supabase dashboard, SQL Editor, run the file. Then, in the same editor:

```sql
-- With no authenticated user, this must return zero rows rather than everything.
set role anon;
select count(*) from public.tasks;
reset role;
```

Expected: `0`, and no error. A non-zero count means a policy is missing and the plan
must not continue.

- [ ] **Step 3: Write the setup document**

Create `docs/supabase-setup.md`:

```markdown
# Supabase setup

What has to exist outside this repository for sync to work. Everything here is a
one-time manual step in a dashboard; none of it is automated, because it is done
once per project and a script would be read less often than this file.

## 1. Project

Create a Supabase project. Note the project URL and the **anon** key from
Settings → API. The anon key is public by design and ships in the built JavaScript;
row-level security is the boundary, not the key. The **service role** key must never
appear in this repository or in a build.

## 2. Schema

Run `supabase/schema.sql` in the SQL Editor. It is idempotent — re-running it is
safe.

Verify RLS refuses an anonymous read before going further:

    set role anon;
    select count(*) from public.tasks;  -- must be 0
    reset role;

## 3. Google sign-in

In Google Cloud, create an OAuth 2.0 Client ID of type "Web application":

- Authorized JavaScript origins: `https://sudo7ak.github.io`
- Authorized redirect URI: `https://<project>.supabase.co/auth/v1/callback`

In Supabase, Authentication → Providers → Google: paste the client ID and secret.

In Supabase, Authentication → URL Configuration:

- Site URL: `https://sudo7ak.github.io/to-do-fish/`
- Additional redirect URLs: `http://localhost:5173/`, `http://localhost:5199/`

Both localhost entries matter — 5173 is `npm run dev` and 5199 is what the
screenshot and E2E scripts expect.

## 4. Build configuration

Add two **repository variables** (not secrets — they are public and secrets are
awkward to read in a build) under Settings → Secrets and variables → Actions →
Variables:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`

Locally, put the same two in `.env.local`, which is gitignored.

With both absent the app builds and runs local-only with sign-in hidden. That is a
supported state, not a broken one: it is how the E2E sweep and the screenshot
scripts run without a cloud account.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql docs/supabase-setup.md
git commit -m "feat: tank schema with row-level security, and its setup notes"
```

---

### Task 6: Sign-in

Config detection and a Google session. No UI yet.

**Files:**
- Create: `src/lib/auth/session.ts`
- Test: `src/lib/auth/session.test.ts`
- Create: `.env.example`
- Modify: `.gitignore` (add `.env.local` if absent)

**Interfaces:**
- Consumes: `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY` from
  `$env/static/public`.
- Produces:
  - `type Account = { id: string; email: string | null }`
  - `isSyncConfigured(): boolean`
  - `createAuth(client?: AuthClient): Auth` where
    `type Auth = { account: Readable<Account | null>; ready: Promise<void>; signIn(): Promise<void>; signOut(): Promise<void>; client: SupabaseLike | null }`
  - `type AuthClient` — the narrow slice used, so tests pass a fake.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/auth/session.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { createAuth, type AuthClient } from './session';

const USER = { id: 'user-1', email: 'someone@example.com' };

function fakeClient(session: { user: typeof USER } | null = null) {
	const listeners: ((session: { user: typeof USER } | null) => void)[] = [];

	return {
		signedIn: false,
		signedOut: false,
		auth: {
			getSession: async () => ({ data: { session }, error: null }),
			onAuthStateChange(callback: (event: string, s: { user: typeof USER } | null) => void) {
				listeners.push((s) => callback('x', s));
				return { data: { subscription: { unsubscribe() {} } } };
			},
			async signInWithOAuth() {
				this.signedIn = true;
				return { error: null };
			},
			async signOut() {
				this.signedOut = true;
				return { error: null };
			}
		},
		emit(next: { user: typeof USER } | null) {
			for (const listener of listeners) listener(next);
		}
	} as unknown as AuthClient & { signedIn: boolean; signedOut: boolean; emit: (s: unknown) => void };
}

describe('createAuth', () => {
	it('has no account before anyone signs in', async () => {
		const auth = createAuth(fakeClient(null));
		await auth.ready;

		expect(get(auth.account)).toBeNull();
	});

	it('picks up a session that already exists', async () => {
		const auth = createAuth(fakeClient({ user: USER }));
		await auth.ready;

		expect(get(auth.account)).toEqual({ id: 'user-1', email: 'someone@example.com' });
	});

	it('follows a sign-in that happens later', async () => {
		const client = fakeClient(null);
		const auth = createAuth(client);
		await auth.ready;

		client.emit({ user: USER });

		expect(get(auth.account)?.id).toBe('user-1');
	});

	it('clears the account on sign-out', async () => {
		const client = fakeClient({ user: USER });
		const auth = createAuth(client);
		await auth.ready;

		client.emit(null);

		expect(get(auth.account)).toBeNull();
	});

	it('asks the client to sign out rather than only forgetting locally', async () => {
		const client = fakeClient({ user: USER });
		const auth = createAuth(client);
		await auth.ready;

		await auth.signOut();

		expect(client.signedOut).toBe(true);
	});
});

describe('createAuth — unconfigured', () => {
	it('reports no account and no client when Supabase is not configured', async () => {
		// The app must build and run with no cloud project at all: this is how the E2E
		// sweep and the screenshot scripts run.
		const auth = createAuth(null);
		await auth.ready;

		expect(get(auth.account)).toBeNull();
		expect(auth.client).toBeNull();
	});

	it('does not throw when signIn is called with no client', async () => {
		const auth = createAuth(null);

		await expect(auth.signIn()).resolves.toBeUndefined();
	});
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/lib/auth/session.test.ts`
Expected: FAIL — "Failed to resolve import './session'".

- [ ] **Step 3: Write the session module**

Create `src/lib/auth/session.ts`:

```ts
import { createClient } from '@supabase/supabase-js';
import { writable, type Readable } from 'svelte/store';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { SupabaseLike } from '../persist/sync/remote';

/**
 * Who is signed in, if anyone.
 *
 * Absent configuration is a supported state, not an error: with no project URL the
 * app runs exactly as it did before sync existed, which is what lets the E2E sweep
 * and the screenshot scripts work without a cloud account.
 */

export type Account = { id: string; email: string | null };

/** The slice of the Supabase client used here, so a test can supply a fake. */
export type AuthClient = {
	auth: {
		getSession(): Promise<{ data: { session: { user: { id: string; email?: string } } | null } }>;
		onAuthStateChange(
			callback: (event: string, session: { user: { id: string; email?: string } } | null) => void
		): { data: { subscription: { unsubscribe(): void } } };
		signInWithOAuth(options: {
			provider: 'google';
			options?: { redirectTo?: string };
		}): Promise<{ error: unknown }>;
		signOut(): Promise<{ error: unknown }>;
	};
};

export type Auth = {
	account: Readable<Account | null>;
	/** Resolves once the existing session, if any, has been read. */
	ready: Promise<void>;
	signIn(): Promise<void>;
	signOut(): Promise<void>;
	/** The client to hand to `SupabaseRemote`, or null when unconfigured. */
	client: SupabaseLike | null;
};

export function isSyncConfigured(): boolean {
	return Boolean(PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_ANON_KEY);
}

export function defaultClient(): (AuthClient & SupabaseLike) | null {
	if (!isSyncConfigured()) return null;

	return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			// The OAuth return lands back on the app URL carrying a code. This exchanges
			// it and then clears it from the address bar, so a shared or bookmarked link
			// never carries someone's auth code.
			detectSessionInUrl: true,
			flowType: 'pkce'
		}
	}) as unknown as AuthClient & SupabaseLike;
}

export function createAuth(client: (AuthClient & Partial<SupabaseLike>) | null = defaultClient()): Auth {
	const account = writable<Account | null>(null);

	const toAccount = (session: { user: { id: string; email?: string } } | null): Account | null =>
		session ? { id: session.user.id, email: session.user.email ?? null } : null;

	const ready = (async () => {
		if (!client) return;
		const { data } = await client.auth.getSession();
		account.set(toAccount(data.session));
		client.auth.onAuthStateChange((_event, session) => account.set(toAccount(session)));
	})();

	return {
		account,
		ready,
		client: (client as SupabaseLike | null) ?? null,

		async signIn() {
			// Unconfigured is not an error: the control that calls this is not rendered,
			// and a throw here would only turn a missing feature into a crash.
			if (!client) return;
			await client.auth.signInWithOAuth({
				provider: 'google',
				options: { redirectTo: window.location.href.split('?')[0] }
			});
		},

		async signOut() {
			// The local snapshot is deliberately left alone. Signing out is not a delete.
			if (!client) return;
			await client.auth.signOut();
		}
	};
}
```

- [ ] **Step 4: Add the env example and confirm the unconfigured build**

Create `.env.example`:

```
# Both are public: they ship in the built JavaScript and row-level security is the
# real boundary. Copy to .env.local to develop against a real project. With both
# absent the app runs local-only and sign-in is hidden — that is a supported state.
PUBLIC_SUPABASE_URL=
PUBLIC_SUPABASE_ANON_KEY=
```

Ensure `.gitignore` contains `.env.local`. SvelteKit's `$env/static/public` needs the
variables declared even when empty, so also confirm `npm run check` passes with no
`.env.local` present — if it complains about missing exports, add an `.env` with both
keys set to empty strings and commit that.

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/lib/auth/session.test.ts && npm test && npm run check`
Expected: all green, 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth/session.ts src/lib/auth/session.test.ts .env.example .env .gitignore
git commit -m "feat: Google session, with unconfigured as a supported state"
```

---

### Task 7: Wiring the app

One control in the header, and the store construction that picks local or syncing.

**Files:**
- Create: `src/lib/ui/AccountButton.svelte`
- Modify: `src/routes/+page.svelte` (store construction near line 27, `onMount` near
  line 67, and the header markup)

**Interfaces:**
- Consumes: `createAuth`, `isSyncConfigured` from `$lib/auth/session`;
  `SyncingTaskStore`, `SyncStatus` from `$lib/persist/sync/syncing`; `SupabaseRemote`
  from `$lib/persist/sync/remote`; `LocalTaskStore`; `createTaskStore`.
- Produces: nothing importable beyond `AccountButton.svelte`, whose props are
  `{ account: Account | null; status: SyncStatus['state']; onSignIn: () => void; onSignOut: () => void }`.

- [ ] **Step 1: Write the account button**

Create `src/lib/ui/AccountButton.svelte`:

```svelte
<script lang="ts">
	import type { Account } from '$lib/auth/session';
	import type { SyncStatus } from '$lib/persist/sync/syncing';

	/**
	 * The whole of sync's interface: one control in the date header.
	 *
	 * Signed out it offers sign-in; signed in it shows the account and the state of
	 * the last sync. There is deliberately no settings screen — sync has one switch
	 * and it is this one.
	 */
	type Props = {
		account: Account | null;
		status: SyncStatus['state'];
		onSignIn: () => void;
		onSignOut: () => void;
	};

	const { account, status, onSignIn, onSignOut }: Props = $props();

	/**
	 * Not saving and not syncing are different sentences, and the second is far less
	 * alarming: the tank on this device is fine either way.
	 */
	const TROUBLE: Record<SyncStatus['state'], string> = {
		idle: '',
		syncing: '',
		offline: 'Not syncing — offline',
		denied: 'Not syncing — sign in again',
		stale: 'Not syncing — this device is out of date',
		skewed: "Not syncing reliably — this device's clock looks wrong"
	};

	const trouble = $derived(TROUBLE[status]);
</script>

{#if account}
	<button class="account" onclick={onSignOut} title={account.email ?? 'Signed in'}>
		<span class="dot" class:trouble={trouble !== ''}></span>
		Sign out
	</button>
{:else}
	<button class="account" onclick={onSignIn}>Sign in to sync</button>
{/if}

{#if trouble}
	<p class="trouble-text" role="status">{trouble}</p>
{/if}

<style>
	.account {
		font: inherit;
		background: none;
		border: 0;
		color: inherit;
		opacity: 0.75;
		padding: 0.4rem 0.6rem;
		cursor: pointer;
	}

	.dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.5;
		margin-right: 0.35rem;
	}

	.dot.trouble {
		background: #e8a33d;
		opacity: 1;
	}

	.trouble-text {
		margin: 0;
		font-size: 0.75rem;
		opacity: 0.7;
	}
</style>
```

- [ ] **Step 2: Wire it into the page**

In `src/routes/+page.svelte`, replace the single store construction line with a
factory, and keep everything else about the store untouched:

```ts
	import { createAuth, isSyncConfigured, type Account } from '$lib/auth/session';
	import { SyncingTaskStore, type SyncStatus } from '$lib/persist/sync/syncing';
	import { SupabaseRemote } from '$lib/persist/sync/remote';
	import AccountButton from '$lib/ui/AccountButton.svelte';

	const auth = createAuth();

	let account = $state<Account | null>(null);
	let syncState = $state<SyncStatus['state']>('idle');

	const local = new LocalTaskStore();

	/**
	 * The store is built once, at module scope, and cannot be rebuilt when someone
	 * signs in half an hour later — so what it holds is a port that forwards to
	 * whichever store is current. Signed out that is `local`, and every call is the
	 * one the app has always made.
	 *
	 * Handing `createTaskStore(local)` directly would look right and quietly break
	 * sync: writes would reach localStorage and never reach the debounced push.
	 */
	let active: TaskStore = local;
	let syncing: SyncingTaskStore | undefined;

	const port: TaskStore = {
		load: () => active.load(),
		save: (snapshot) => active.save(snapshot)
	};

	const store = createTaskStore(port);

	/** Points `active` at a syncing store for this account, or back at plain local. */
	function useAccount(id: string | undefined) {
		if (!id || !auth.client) {
			syncing = undefined;
			active = local;
			return;
		}

		syncing = new SyncingTaskStore({
			local,
			remote: new SupabaseRemote(auth.client, id),
			onExternalChange: () => void store.hydrate(),
			onStatus: (status) => (syncState = status.state)
		});
		active = syncing;
	}
```

`TaskStore` needs importing from `$lib/persist/port`.

In `onMount`, subscribe to the account and re-point sync when it changes, and add
`sync()` to the wake handlers that already exist:

```ts
		const unsubscribe = auth.account.subscribe((next) => {
			account = next;
			// A sign-in on a device with a week of offline tasks merges rather than asks:
			// the local snapshot is pushed and the remote pulled through the same rules.
			useAccount(next?.id);
			void syncing?.sync();
		});

		const wake = () => {
			rollover();
			void syncing?.sync();
		};
```

Use `wake` in place of `rollover` in the `wakeEvents` loop, and call `unsubscribe()`
in the returned teardown.

Render the control inside the date header row:

```svelte
	<AccountButton
		{account}
		status={syncState}
		onSignIn={() => void auth.signIn()}
		onSignOut={() => void auth.signOut()}
	/>
```

Wrap it in `{#if isSyncConfigured()}` so an unconfigured build shows nothing at all.

- [ ] **Step 3: Look at it**

Anything visual in this project is looked at, not reasoned about. With
`npx vite dev --port 5199 &` running:

Run: `npm run screenshot`
Expected: the header renders with the sign-in control absent (no `.env.local`), and
nothing about the tank has moved. If the control shifts the date or the way-back
button, fix the layout before continuing.

- [ ] **Step 4: Run everything**

Run: `npm test && npm run check && npm run e2e`
Expected: all unit tests pass, 0 typecheck errors, 68/68 E2E checks.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/AccountButton.svelte src/routes/+page.svelte
git commit -m "feat: sign in to sync, from one control in the header"
```

---

### Task 8: Proving the local path survived, and shipping it

The regression guard on the whole feature's central claim, plus the build.

**Files:**
- Modify: `scripts/e2e.mjs` (add checks near the end, before the console-error check)
- Modify: `.github/workflows/deploy.yml`
- Modify: `CLAUDE.md`
- Modify: `docs/pending.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

- [ ] **Step 1: Add the E2E checks**

In `scripts/e2e.mjs`, before the console-errors section:

```js
// Sync is configured out of this build, and the promise is that its absence changes
// nothing. The 68 checks above are the real assertion; these two say why they held.
check(
	'no sign-in control in an unconfigured build',
	(await page.locator('button:has-text("Sign in to sync")').count()) === 0
);
check(
	'no network calls left the page',
	requests.every((url) => new URL(url).host === new URL(page.url()).host),
	requests.join(', ')
);
```

Near the top of the file, where the page is created, start recording requests:

```js
const requests = [];
page.on('request', (request) => requests.push(request.url()));
```

- [ ] **Step 2: Run the sweep and verify it passes**

Run: `npx vite dev --port 5199 & sleep 4; npm run e2e`
Expected: 70/70 passed.

- [ ] **Step 3: Pass the configuration through CI**

In `.github/workflows/deploy.yml`, add the two variables to the build step's
environment, alongside the existing `BASE_PATH`:

```yaml
        env:
          BASE_PATH: /to-do-fish
          PUBLIC_SUPABASE_URL: ${{ vars.PUBLIC_SUPABASE_URL }}
          PUBLIC_SUPABASE_ANON_KEY: ${{ vars.PUBLIC_SUPABASE_ANON_KEY }}
```

Leave the test, check, and E2E steps without them — the sweep asserts the
unconfigured path, and giving it credentials would silently stop testing what it
exists to test.

- [ ] **Step 4: Update the project documentation**

In `CLAUDE.md`, the "What this is" section says "Local-first: no backend, no
accounts, no network calls in v1." Replace it with:

```markdown
Local-first: the tank works with no account and no network, and that is the primary
path, not a fallback. Signing in with Google adds multi-device sync — a
`SyncingTaskStore` behind the same `TaskStore` port — and nothing above `persist/`
can tell the difference. With `PUBLIC_SUPABASE_URL` unset the app is exactly the
v1 app, which is how the E2E sweep and the screenshot scripts run.
```

Add to the "Invariants that break quietly" section:

```markdown
**Sync merges are last-write-wins per task, and ties go to the tombstone.** The rules
live in `persist/sync/merge.ts`, which imports only `../../types` so they can be
tested as data in and data out. A tie means two clocks disagree; a resurrected task
is worse than an early deletion. `settings.seenLegend` is the one field that does not
follow the record — it is a one-way latch, and an older device syncing in must not
make the first-run legend reappear.

**Row nulls are not domain absences.** `isLive()` tests whether `deletedAt` is
present, so a `null` arriving from Postgres would make a deleted task swim again.
`persist/sync/rows.ts` maps null to genuinely-absent keys, and a test asserts `'in'`
rather than truthiness — because `deletedAt: 0` is a valid deletion.
```

In `docs/pending.md`, add an item recording what sync does not do: no Realtime, no
per-field merge, no conflict UI, and clock skew mitigated by a banner rather than
repaired. Tag it **structural**.

- [ ] **Step 5: Manual verification against a real project**

Automated tests cannot cover real OAuth. Work through this by hand once, with
`.env.local` pointing at the project from Task 5, and record the result in the commit
message:

1. Sign in on a laptop. Add a task. Sign in on a phone. The task is in the tank.
2. Complete it on the phone. Wake the laptop tab. It is a ghost there.
3. Put the phone in aeroplane mode. Add a task. Restore the network, background and
   foreground the app. The task reaches the laptop.
4. Delete a task on the laptop. Wake the phone. It stays deleted — this is the one
   most likely to be wrong, because it is the only case where the correct outcome is
   an absence.
5. Sign out on the phone. The tank is still there, with its tasks.
6. Sign in on a phone that has never synced but has local tasks. Both sets survive.

- [ ] **Step 6: Run everything one last time**

Run: `npm test && npm run check && npm run build && npm run e2e`
Expected: all unit tests pass, 0 typecheck errors, a clean build, 70/70 E2E.

- [ ] **Step 7: Commit**

```bash
git add scripts/e2e.mjs .github/workflows/deploy.yml CLAUDE.md docs/pending.md
git commit -m "test: assert the unconfigured build makes no network calls"
```

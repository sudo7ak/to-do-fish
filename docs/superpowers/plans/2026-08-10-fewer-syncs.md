# Fewer Syncs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the round trips a returning tab costs, from roughly nine to at most
three — and to zero when nothing has changed on either side.

**Architecture:** Five independent reductions, applied where each belongs. Two are
pure waste removal (duplicate listeners, concurrent syncs). Two are policy and so
must know *why* a sync was asked for, which means `sync()` takes a reason. The last
replaces three SELECTs with one cheap question to the server, and falls back to the
full pull whenever it cannot answer.

**Tech Stack:** SvelteKit 5 (runes), TypeScript, Supabase (Postgres + RLS), vitest,
Playwright via `scripts/e2e.mjs`.

## Global Constraints

- **A user's own edit must never be delayed by any of this.** The cooldown, the
  backoff, and the freshness probe apply to *wake* syncs only. A write-triggered
  sync, a manual "Sync now", and an account change always run in full.
- **Nothing may make a sync reject.** `sync()` still never throws; a failure is a
  banner.
- **The probe is an optimisation, never a gate.** If it errors — the SQL function
  is not deployed, the network hiccups — fall through to the full pull. It must not
  turn a working sync into a failed one.
- **`SupabaseRemote.push()` refuses until a successful `pull()`**, so no path may
  skip the pull and then push.
- **`merge.ts` stays pure** and imports only `../../types`.
- `npm test`, `npm run check` (0 errors), `npm run build`, and `npm run e2e` in both
  modes all pass before each commit. Locally a real `.env.local` is present, so the
  configured run is `E2E_EXPECT_SYNC=1 npm run e2e`; for the unconfigured run,
  `mv .env.local /tmp/env.local.bak && npm run e2e; mv /tmp/env.local.bak .env.local`
  and confirm it is restored — it holds real project keys.
- Commit after every task. Conventional Commits.

---

### Task 1: Stop listening twice

The cheapest win, and it stands alone: `visibilitychange` is registered on both
`document` and `window`, and it bubbles, so every tab switch calls the handler twice
before anything else in this plan applies.

**Files:**
- Modify: `src/routes/+page.svelte` (the `wakeEvents` loop inside `onMount`)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing importable.

- [ ] **Step 1: Register each event where it actually fires**

Replace the loop that adds every event to both targets:

```js
		// Each event on the one target that fires it. `visibilitychange` is fired at
		// the document and bubbles, so listening on both meant every tab switch woke
		// the tank twice; `pageshow` and `focus` are window events and never reached
		// the document listener at all.
		const wakeTargets: [EventTarget, string][] = [
			[document, 'visibilitychange'],
			[document, 'resume'],
			[window, 'pageshow'],
			[window, 'focus']
		];
		for (const [target, event] of wakeTargets) target.addEventListener(event, wake);
```

and the teardown to match:

```js
			for (const [target, event] of wakeTargets) target.removeEventListener(event, wake);
```

`resume` stays on `document`: it is the Page Lifecycle event, fired at the document
when a frozen tab thaws.

- [ ] **Step 2: Verify**

Run: `npm test && npm run check && npm run build`
Expected: all pass, 0 errors.

Then, with `npx vite dev --port 5199 &` running, confirm the wake path still works at
all — this is the one behaviour a mistake here would silently remove. In the browser
console on the running app:

```js
let woke = 0;
const count = () => woke++;
for (const e of ['visibilitychange', 'pageshow', 'focus']) {
	document.addEventListener(e, count);
	window.addEventListener(e, count);
}
// Switch to another tab and back, then read `woke`.
```

Expected: with the app's own listeners deduped, switching away and back fires the
app's `wake` fewer times than before — note the number in your report. The counter
above is your own probe, not the app's; it exists to prove events still arrive.

- [ ] **Step 3: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "fix: wake the tank once per wake, not twice"
```

---

### Task 2: One sync at a time, and a reason for each

Concurrent syncs are waste — three triggers in the same tick each do the full
pull-merge-push. Single-flight collapses them. The reason parameter lands in the same
task because Tasks 3 and 4 are policies that must never apply to a user's own edit,
and adding it separately would mean touching every call site twice.

**Files:**
- Modify: `src/lib/persist/sync/syncing.ts`
- Modify: `src/routes/+page.svelte` (three `sync()` call sites)
- Test: `src/lib/persist/sync/syncing.test.ts`

**Interfaces:**
- Consumes: `SyncingTaskStore` as it stands.
- Produces:
  - `type SyncReason = 'wake' | 'write' | 'manual' | 'account'`
  - `sync(reason?: SyncReason): Promise<void>` — defaults to `'manual'`, so every
    existing call and test keeps its current meaning: always runs, never throttled.

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/persist/sync/syncing.test.ts`:

```ts
describe('SyncingTaskStore — one sync at a time', () => {
	it('collapses concurrent syncs into a single round trip', async () => {
		// Three triggers in the same tick is the ordinary case: a tab switch fires
		// visibilitychange and focus, and a debounced write can land on top.
		const remote = fakeRemote();
		let release: () => void = () => {};
		remote.pull = () => {
			remote.pulls++;
			return new Promise((resolve) => {
				release = () => resolve(remote.pullResult);
			});
		};
		const { store } = setup(fakeLocal(), remote);

		const all = Promise.all([store.sync(), store.sync(), store.sync()]);
		release();
		await all;

		expect(remote.pulls).toBe(1);
	});

	it('lets a later sync run once the first has finished', async () => {
		// Single-flight must not become a lock: the next wake still syncs.
		const { store, remote } = setup();

		await store.sync();
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
```

`remote.pulls` does not exist yet. Add a counter to the existing `fakeRemote` helper so
every test can assert round trips — increment it inside `pull()`:

```ts
function fakeRemote(initial: Snapshot = snapshot()) {
	return {
		pushes: [] as Snapshot[],
		pulls: 0,
		pullResult: initial,
		pullError: undefined as unknown,
		pushError: undefined as unknown,
		async pull() {
			this.pulls++;
			if (this.pullError) throw this.pullError;
			return this.pullResult;
		},
		// …push unchanged…
	};
}
```

The first test above builds its own `remote` and overrides `pull`, so increment
`this.pulls` inside that override too, or its assertion counts nothing.

- [ ] **Step 2: Run them and verify they fail**

Run: `npx vitest run src/lib/persist/sync/syncing.test.ts`
Expected: FAIL — the first test reports 3 pulls where 1 is expected.

- [ ] **Step 3: Implement single-flight and the reason**

In `src/lib/persist/sync/syncing.ts`:

```ts
/**
 * Why a sync was asked for. Policy applies only to `'wake'`: a user's own edit, a
 * tap on Sync now, and an account change must never be throttled or skipped.
 */
export type SyncReason = 'wake' | 'write' | 'manual' | 'account';
```

Add the field:

```ts
	/** The sync currently running, shared by every caller that arrives while it does. */
	#inFlight: Promise<void> | undefined;
```

Rename the existing method body to `#runSync` and make `sync` the gate:

```ts
	sync(reason: SyncReason = 'manual'): Promise<void> {
		// Three triggers can land in one tick — visibilitychange, focus, and a
		// debounced write. They would each do a full pull, merge and push against the
		// same data. Sharing the promise makes them one round trip, and every caller
		// still resolves when it finishes.
		if (this.#inFlight) return this.#inFlight;

		this.#inFlight = this.#runSync(reason).finally(() => {
			this.#inFlight = undefined;
		});
		return this.#inFlight;
	}

	async #runSync(_reason: SyncReason): Promise<void> {
		// …the entire existing body of sync(), unchanged…
	}
```

The parameter is unused until Task 3; name it `_reason` so the typecheck stays clean,
and drop the underscore there.

Change the debounced write in `save()` to name itself:

```ts
		this.#pending = this.#setTimer(() => void this.sync('write'), this.#debounceMs);
```

- [ ] **Step 4: Name the reasons at the call sites**

In `src/routes/+page.svelte`:

- the account subscription: `void store.hydrate().then(() => syncing?.sync('account'));`
- the wake handler: `void syncing?.sync('wake');`
- the panel: `onSyncNow={() => void syncing?.sync('manual')}`

- [ ] **Step 5: Run the tests and verify they pass**

Run: `npx vitest run src/lib/persist/sync/syncing.test.ts`
Expected: PASS.

- [ ] **Step 6: Validate by mutation**

Delete the `if (this.#inFlight) return this.#inFlight;` line and confirm "collapses
concurrent syncs into a single round trip" fails with 3 pulls. Restore it.

- [ ] **Step 7: Full verification and commit**

Run: `npm test && npm run check && npm run build`

```bash
git add src/lib/persist/sync/syncing.ts src/lib/persist/sync/syncing.test.ts src/routes/+page.svelte
git commit -m "perf: share one in-flight sync between concurrent triggers"
```

---

### Task 3: A cooldown, and backing off a failure

Two policies, both keyed on the reason, both in the same method — split into separate
tasks they would each rewrite the other's guard.

**Files:**
- Modify: `src/lib/persist/sync/syncing.ts`
- Test: `src/lib/persist/sync/syncing.test.ts`

**Interfaces:**
- Consumes: `SyncReason` from Task 2.
- Produces: `SyncingOptions` gains two optional numbers, both with defaults:
  `cooldownMs?: number` (default 30_000) and `backoffMs?: number` (default 60_000).

- [ ] **Step 1: Write the failing tests**

```ts
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
		await store.sync('write');
		await store.sync('manual');
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
		await store.sync('wake');

		expect(remote.pulls).toBe(2);
	});

	it('does not let a failure start the cooldown', async () => {
		// A failed sync synced nothing, so it must not make the next wake look recent.
		//
		// `backoffMs: 0` isolates that from the failure backoff, which is a separate
		// policy with its own test below. Without it this test would assert both at
		// once, and the two disagree: zero elapsed time is the strictest case for the
		// backoff, so it would block the very retry this test expects to go through.
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
```

- [ ] **Step 2: Run them and verify they fail**

Run: `npx vitest run src/lib/persist/sync/syncing.test.ts`
Expected: FAIL — every skip case reports more pulls than expected.

- [ ] **Step 3: Implement both policies**

Add the options, with defaults, alongside the existing ones in `SyncingOptions` and
the constructor:

```ts
	/** How recently a wake sync must have succeeded before the next one is skipped. */
	cooldownMs?: number;
	/** How long a wake sync waits after a failure before trying again. */
	backoffMs?: number;
```

```ts
	#cooldownMs: number;
	#backoffMs: number;
	/** When the last sync failed, so wake syncs can back off rather than hammer. */
	#lastFailedAt: number | undefined;
```

```ts
		this.#cooldownMs = options.cooldownMs ?? 30_000;
		this.#backoffMs = options.backoffMs ?? 60_000;
```

Gate at the top of `sync`, before the in-flight check — a skipped sync should not even
join a running one:

```ts
	sync(reason: SyncReason = 'manual'): Promise<void> {
		if (reason === 'wake' && this.#tooSoon()) return Promise.resolve();

		if (this.#inFlight) return this.#inFlight;
		// …unchanged…
	}

	/**
	 * Whether a wake sync is worth making. Only wakes are ever skipped: an edit, a
	 * tap on Sync now, and an account change all run whatever this says.
	 *
	 * A failure does not start the cooldown — it synced nothing — but it does start
	 * the backoff, so a dead connection is retried on a timer rather than on every
	 * tab switch.
	 */
	#tooSoon(): boolean {
		const now = this.#now();

		// Strictly `<`, so a `backoffMs` of 0 disables the backoff entirely rather
		// than blocking forever at zero elapsed time. The cooldown below reads the
		// same way for the same reason.
		if (this.#lastFailedAt !== undefined && now - this.#lastFailedAt < this.#backoffMs) {
			return true;
		}

		return this.#lastSyncedAt !== undefined && now - this.#lastSyncedAt < this.#cooldownMs;
	}
```

Record the failure in `#failed`, and clear it on success. In `#failed`, as its first
statement:

```ts
		this.#lastFailedAt = this.#now();
```

and wherever `#lastSyncedAt` is stamped (both sites in the sync body), clear the
failure alongside it:

```ts
			this.#lastFailedAt = undefined;
```

- [ ] **Step 4: Run them and verify they pass**

Run: `npx vitest run src/lib/persist/sync/syncing.test.ts`
Expected: PASS.

- [ ] **Step 5: Validate by mutation**

Three, each restored after:
1. Drop `reason === 'wake' &&` from the gate → "never throttles a write, a manual
   sync, or an account change" must fail.
2. Set `#lastFailedAt` on success as well as failure → "does not let a failure start
   the cooldown" must fail.
3. Remove the backoff branch from `#tooSoon` → "backs off repeated wake retries after
   a failure" must fail.

Report which test failed for each.

- [ ] **Step 6: Full verification and commit**

Run: `npm test && npm run check && npm run build`

```bash
git add src/lib/persist/sync/syncing.ts src/lib/persist/sync/syncing.test.ts
git commit -m "perf: skip a wake sync that would learn nothing"
```

---

### Task 4: Ask the cheap question first

Three SELECTs to discover that nothing changed is three too many. One aggregate over
the same rows answers it, and the full pull happens only when the answer moved.

**Files:**
- Create: `supabase/freshness.sql`
- Modify: `src/lib/persist/sync/remote.ts`
- Modify: `src/lib/persist/sync/syncing.ts`
- Modify: `docs/supabase-setup.md`
- Test: `src/lib/persist/sync/remote.test.ts`, `src/lib/persist/sync/syncing.test.ts`

**Interfaces:**
- Consumes: `SyncReason` from Task 2, the cooldown gate from Task 3.
- Produces:
  - `Remote` gains `freshness(): Promise<number | undefined>` — the newest timestamp
    the account holds server-side, or `undefined` when the question could not be
    answered, which always means "do the full pull".
  - `SupabaseLike` gains `rpc(fn: string): Promise<{ data: unknown; error: unknown }>`.

- [ ] **Step 1: Write the SQL**

Create `supabase/freshness.sql`:

```sql
-- One question instead of three table reads: what is the newest timestamp this
-- account holds? A wake sync that gets the same answer as last time can skip the
-- pull entirely, because nothing on the server has moved.
--
-- `security invoker` matters: the function runs as the caller, so the row-level
-- security policies still apply and `auth.uid()` is the signed-in user. A
-- `security definer` function here would read every account's rows.
create or replace function public.sync_freshness()
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select greatest(
    coalesce((select max(updated_at) from public.tasks    where user_id = auth.uid()), 0),
    coalesce((select max(earned_at)  from public.koi      where user_id = auth.uid()), 0),
    coalesce((select max(updated_at) from public.settings where user_id = auth.uid()), 0)
  );
$$;

grant execute on function public.sync_freshness() to authenticated;
```

Note for the report: this file is **not applied by this task** — applying SQL to the
project is a manual step for the human, and the client is required to work whether or
not it exists.

- [ ] **Step 2: Write the failing remote tests**

Add to `src/lib/persist/sync/remote.test.ts`. The existing `fakeClient` needs an `rpc`
method — add one that returns `{ data, error }` from fields the test sets, mirroring
how `select` already works in that helper:

```ts
describe('SupabaseRemote — freshness', () => {
	it('reports the newest timestamp the account holds', async () => {
		const client = fakeClient({}, undefined, { data: 1786377942054, error: null });

		expect(await new SupabaseRemote(client, USER).freshness()).toBe(1786377942054);
	});

	it('reports undefined when the function is not deployed, so the caller pulls', async () => {
		// The SQL is applied by hand. A client running against a project without it
		// must still sync — the probe is an optimisation, never a gate.
		const client = fakeClient({}, undefined, { data: null, error: { code: '42883' } });

		expect(await new SupabaseRemote(client, USER).freshness()).toBeUndefined();
	});

	it('reports undefined rather than throwing when the call fails', async () => {
		const client = fakeClient({}, undefined, { data: null, error: { message: 'offline' } });

		await expect(new SupabaseRemote(client, USER).freshness()).resolves.toBeUndefined();
	});

	it('treats an empty account as zero rather than unknown', async () => {
		// Zero is a real answer: the account holds nothing. Returning undefined would
		// force a pointless full pull on every wake for a brand-new account.
		const client = fakeClient({}, undefined, { data: 0, error: null });

		expect(await new SupabaseRemote(client, USER).freshness()).toBe(0);
	});
});
```

Extend `fakeClient`'s signature to take that third argument and expose `rpc`:

```ts
function fakeClient(
	seed: Record<string, unknown[]> = {},
	fail?: { code?: string; message?: string },
	rpcResult: { data: unknown; error: unknown } = { data: 0, error: null }
) {
	// …existing body…
	return {
		// …existing fields…
		async rpc() {
			return rpcResult;
		}
	};
}
```

- [ ] **Step 3: Run them and verify they fail**

Run: `npx vitest run src/lib/persist/sync/remote.test.ts`
Expected: FAIL — `freshness is not a function`.

- [ ] **Step 4: Implement `freshness`**

In `src/lib/persist/sync/remote.ts`, extend `SupabaseLike`:

```ts
	rpc(fn: string): Promise<{ data: unknown; error: unknown }>;
```

add it to the `Remote` interface:

```ts
	/** The newest timestamp the account holds, or `undefined` if it cannot be asked. */
	freshness(): Promise<number | undefined>;
```

and implement it:

```ts
	/**
	 * One aggregate instead of three table reads, so a wake sync can discover that
	 * nothing changed without pulling everything.
	 *
	 * Never throws, and never classifies a failure: the SQL function is applied by
	 * hand and may simply not exist, which is not an error the user should hear
	 * about. Any failure returns `undefined`, and `undefined` means "pull properly".
	 */
	async freshness(): Promise<number | undefined> {
		try {
			const { data, error } = await this.#client.rpc('sync_freshness');
			if (error || typeof data !== 'number') return undefined;
			return data;
		} catch {
			return undefined;
		}
	}
```

- [ ] **Step 5: Write the failing syncing tests**

Add to `src/lib/persist/sync/syncing.test.ts`. `fakeRemote` needs the new method —
add `freshnessResult: 0 as number | undefined` and
`async freshness() { this.freshnessCalls++; return this.freshnessResult; }` plus a
`freshnessCalls: 0` counter, and widen its `satisfies` type accordingly:

```ts
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
```

- [ ] **Step 6: Run them and verify they fail**

Run: `npx vitest run src/lib/persist/sync/syncing.test.ts`
Expected: FAIL — the skip cases pull anyway.

- [ ] **Step 7: Use the probe**

In `src/lib/persist/sync/syncing.ts`, add:

```ts
	/** The server's newest timestamp as of the last completed sync, if it was asked. */
	#seenFreshness: number | undefined;
	/** Whether this device has written since its last successful push. */
	#dirty = false;
```

Set `#dirty = true` at the end of `save()`, and clear it wherever `#lastSyncedAt` is
stamped.

At the top of `#runSync`, after the `'syncing'` status:

```ts
			// The probe answers "has the server moved?" in one round trip. It cannot
			// answer "do I have anything to send", so a device with unpushed work pulls
			// regardless — and `push()` refuses without a preceding pull anyway.
			if (!this.#dirty && this.#seenFreshness !== undefined) {
				const freshness = await this.#remote.freshness();
				if (freshness !== undefined && freshness === this.#seenFreshness) {
					this.#lastSyncedAt = this.#now();
					this.#lastFailedAt = undefined;
					return this.#status('idle');
				}
			}
```

and after a successful pull, remember what the server said:

```ts
			this.#seenFreshness = newestOf(remote);
```

with a small helper next to `sameSnapshot`. Note that `syncing.ts` currently imports
only `{ claimFor, merge }` from `./merge`, so add the type:
`import { claimFor, merge, type RemoteSnapshot } from './merge';`

```ts
/**
 * The newest timestamp in a pulled snapshot, matching what `sync_freshness()`
 * computes server-side. They must agree, or the probe would report a change on
 * every sync and cost a round trip instead of saving three.
 */
function newestOf(remote: RemoteSnapshot): number {
	return Math.max(
		0,
		...remote.tasks.map((task) => task.updatedAt),
		...remote.koi.map((record) => record.earnedAt),
		...(remote.settings ? [remote.settings.updatedAt] : [])
	);
}
```

Note the asymmetry deliberately: the probe is only consulted once a sync has
completed, so `#seenFreshness` is never guessed.

- [ ] **Step 8: Run them and verify they pass**

Run: `npx vitest run src/lib/persist/sync`
Expected: PASS.

- [ ] **Step 9: Validate by mutation**

1. Drop `!this.#dirty &&` from the guard → "pulls anyway when this device has
   something to push" must fail.
2. Treat an `undefined` probe result as "unchanged" → "pulls when the probe cannot
   answer" must fail.

Restore each, and report which test caught it.

- [ ] **Step 10: Document the manual step**

In `docs/supabase-setup.md`, after the schema section, add:

```markdown
## 2b. The freshness function (optional)

Run `supabase/freshness.sql` in the SQL Editor. It adds one function that reports the
newest timestamp your account holds, so a device waking up can discover that nothing
changed in a single query instead of reading all three tables.

Entirely optional: without it the app syncs exactly as before, just with three reads
per wake instead of one. The client treats a missing function as "cannot answer" and
falls back to the full pull.
```

- [ ] **Step 11: Full verification and commit**

Run: `npm test && npm run check && npm run build`, then the E2E sweep in both modes
per the Global Constraints.

```bash
git add supabase/freshness.sql src/lib/persist/sync/remote.ts src/lib/persist/sync/syncing.ts \
        src/lib/persist/sync/remote.test.ts src/lib/persist/sync/syncing.test.ts docs/supabase-setup.md
git commit -m "perf: ask whether the server moved before pulling everything"
```

---

### Task 5: Record what now governs a sync

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

- [ ] **Step 1: Write it down**

Add to the "Invariants that break quietly" section of `CLAUDE.md`:

```markdown
**Only wake syncs are ever skipped.** `sync(reason)` takes `'wake' | 'write' |
'manual' | 'account'`, and the cooldown, the failure backoff, and the freshness probe
all apply to `'wake'` alone. A user's own edit, a tap on Sync now, and an account
change always run in full — throttling any of those means an edit that silently never
leaves the device. The default is `'manual'`, so a call that forgets to say why is
never the throttled kind.

**The freshness probe is an optimisation, never a gate.** `sync_freshness()` is
applied by hand and may not exist on a given project; `freshness()` returns
`undefined` for any failure, and `undefined` always means "pull properly". A device
with unpushed work skips the probe entirely — it answers only whether the *server*
moved, and `push()` refuses without a preceding `pull()` regardless.
```

- [ ] **Step 2: Verify and commit**

Run: `npm run check`

```bash
git add CLAUDE.md
git commit -m "docs: what governs whether a sync actually runs"
```

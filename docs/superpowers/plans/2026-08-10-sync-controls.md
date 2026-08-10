# Sync Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the account controls off the tank and into Settings, and make sync
something the user can see — a last-synced time, and a button to refresh it.

**Architecture:** `SyncStatus` gains an optional `at` timestamp, stamped in memory by
`SyncingTaskStore` on every successful sync and deliberately preserved through
failures. A pure formatter turns it into English. A new `SyncPanel` renders inside the
existing Settings sheet, and `AccountButton` and the header's account row are deleted.

**Tech Stack:** SvelteKit 5 (runes), TypeScript, vitest, Playwright via
`scripts/e2e.mjs`.

**Spec:** `docs/superpowers/specs/2026-08-10-sync-controls-design.md`

## Global Constraints

- **The timestamp is never persisted and never synced.** It lives in
  `SyncingTaskStore`. `Snapshot` does not change. Putting it in settings would
  replicate a device-local fact to a device where it is meaningless.
- **One sync path.** "Sync now" calls the same `sync()` the wake events call. No
  second code path.
- **Unconfigured stays supported.** With `PUBLIC_SUPABASE_URL` unset the app builds,
  typechecks, and passes every E2E check with no Sync section rendered at all.
- **Banner is for failures that never fix themselves:** `denied`, `stale`,
  `rejected`. Never `offline`. Never `skewed`. `saveFailed` outranks all of them.
- **`store/` reaches persistence only through the `TaskStore` interface**, and
  `render/` imports nothing outside itself. Neither is touched by this plan.
- Existing suites stay green at every commit: `npm test`, `npm run check` (0 errors),
  `npm run build`, and `npm run e2e` (70/70 — locally with a real `.env.local` use
  `E2E_EXPECT_SYNC=1 npm run e2e`).
- Commit after every task. Conventional Commits, imperative subject.

---

### Task 1: The timestamp, and the words for it

Two pieces that belong together: the status carrying a time, and the pure function
that renders it. The second is where the fiddly cases live.

**Files:**
- Create: `src/lib/ui/ago.ts`
- Create: `src/lib/ui/ago.test.ts`
- Modify: `src/lib/persist/sync/syncing.ts`
- Test: `src/lib/persist/sync/syncing.test.ts`

**Interfaces:**
- Consumes: `SyncStatus` from `src/lib/persist/sync/syncing.ts`.
- Produces:
  - `ago(at: number, now: number): string` — the relative part alone: `"just now"`,
    `"3 minutes ago"`. Callers compose `Synced ${ago(...)}`.
  - `SyncStatus` gains `at?: number`, present on every status emitted once this
    device has synced successfully at least once.

- [ ] **Step 1: Write the failing formatter tests**

Create `src/lib/ui/ago.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ago } from './ago';

const NOW = 1_700_000_000_000;
const seconds = (n: number) => n * 1000;
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;

describe('ago', () => {
	it('calls anything under a minute "just now"', () => {
		expect(ago(NOW, NOW)).toBe('just now');
		expect(ago(NOW - seconds(59), NOW)).toBe('just now');
	});

	it('switches to minutes exactly on the minute', () => {
		// The boundary, because this is where relative-time code always breaks.
		expect(ago(NOW - minutes(1), NOW)).toBe('1 minute ago');
	});

	it('does not pluralise a single minute or hour', () => {
		expect(ago(NOW - minutes(1), NOW)).toBe('1 minute ago');
		expect(ago(NOW - hours(1), NOW)).toBe('1 hour ago');
	});

	it('counts whole minutes, rounding down', () => {
		expect(ago(NOW - minutes(3) - seconds(59), NOW)).toBe('3 minutes ago');
	});

	it('switches to hours exactly on the hour', () => {
		expect(ago(NOW - minutes(59), NOW)).toBe('59 minutes ago');
		expect(ago(NOW - hours(1), NOW)).toBe('1 hour ago');
	});

	it('switches to days exactly on the day', () => {
		expect(ago(NOW - hours(23), NOW)).toBe('23 hours ago');
		expect(ago(NOW - hours(24), NOW)).toBe('1 day ago');
	});

	it('treats a future timestamp as just now rather than printing a negative', () => {
		// A device whose clock is behind the server's can produce this, and
		// "-4 minutes ago" is worse than a harmless rounding to now.
		expect(ago(NOW + minutes(5), NOW)).toBe('just now');
	});
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run src/lib/ui/ago.test.ts`
Expected: FAIL — "Failed to resolve import './ago'".

- [ ] **Step 3: Write the formatter**

Create `src/lib/ui/ago.ts`:

```ts
/**
 * How long ago, in words — the relative part only, so callers can compose it into
 * "Synced 3 minutes ago" or "Last synced 3 minutes ago".
 *
 * `now` is a parameter rather than a `Date.now()` call so the whole thing is a pure
 * function of two numbers and its boundaries can be tested exactly.
 */
export function ago(at: number, now: number): string {
	// A clock behind the server's produces a future timestamp. "-4 minutes ago" reads
	// as a bug; rounding it to now is a harmless lie about a few seconds.
	const elapsed = Math.max(0, now - at);

	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return count(minutes, 'minute');

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return count(hours, 'hour');

	return count(Math.floor(hours / 24), 'day');
}

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
```

- [ ] **Step 4: Run the formatter tests and verify they pass**

Run: `npx vitest run src/lib/ui/ago.test.ts`
Expected: PASS, 7 cases.

- [ ] **Step 5: Write the failing status tests**

Add to `src/lib/persist/sync/syncing.test.ts`, inside a new `describe` block. Note
that `setup()` in that file already injects `now: () => 1000`:

```ts
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
```

- [ ] **Step 6: Run them and verify they fail**

Run: `npx vitest run src/lib/persist/sync/syncing.test.ts`
Expected: FAIL — `at` is `undefined` where a number is expected.

- [ ] **Step 7: Carry the timestamp**

In `src/lib/persist/sync/syncing.ts`, extend the type:

```ts
export type SyncStatus = {
	state: 'idle' | 'syncing' | 'offline' | 'denied' | 'stale' | 'skewed' | 'storage' | 'rejected';
	/**
	 * When this device last synced successfully. Absent until one has.
	 *
	 * Deliberately in memory and never persisted: it describes THIS device, and the
	 * only thing this app persists is the snapshot — which is exactly what syncs. In
	 * settings it would replicate, and the laptop would display the phone's sync time.
	 */
	at?: number;
};
```

Add a field alongside the other private state:

```ts
	/** Set on every successful sync, and never cleared — see `#status`. */
	#lastSyncedAt: number | undefined;
```

Stamp it where a sync completes successfully. In `sync()`, immediately before the
status that settles it — both the quiet-path return and the post-push call — set:

```ts
		this.#lastSyncedAt = this.#now();
```

Then have every status carry it:

```ts
	#status(state: SyncStatus['state']): void {
		// `at` rides on every status, failures included. A failure that blanked it
		// would lose "last synced 20 minutes ago" at the moment it is most useful.
		this.#onStatus?.({ state, ...(this.#lastSyncedAt === undefined ? {} : { at: this.#lastSyncedAt }) });
	}
```

- [ ] **Step 8: Run them and verify they pass**

Run: `npx vitest run src/lib/persist/sync/syncing.test.ts`
Expected: PASS.

- [ ] **Step 9: Validate by mutation**

Change `#status` to clear the timestamp on failure —
`...(state === 'idle' ? { at: this.#lastSyncedAt } : {})` — and confirm "keeps the
last successful time through a later failure" fails. Restore it. If it passes, the
test is not testing what it claims; strengthen the test rather than the mutation.

- [ ] **Step 10: Run the whole suite and the typecheck**

Run: `npm test && npm run check`
Expected: all pass, 0 errors.

- [ ] **Step 11: Commit**

```bash
git add src/lib/ui/ago.ts src/lib/ui/ago.test.ts \
        src/lib/persist/sync/syncing.ts src/lib/persist/sync/syncing.test.ts
git commit -m "feat: report when this device last synced"
```

---

### Task 2: The Sync panel

The component alone, rendered nowhere yet, so its states can be built and tested
before the wiring lands.

**Files:**
- Create: `src/lib/ui/SyncPanel.svelte`
- Modify: `src/lib/ui/Settings.svelte`

**Interfaces:**
- Consumes: `ago` from `./ago`, `SyncStatus` from `../persist/sync/syncing`,
  `Account` from `../auth/session`.
- Produces: `SyncPanel.svelte` with props
  `{ account: Account | null; status: SyncStatus; now: number; onSignIn: () => void; onSignOut: () => void; onSyncNow: () => void }`.
  `Settings.svelte` gains one optional prop: `sync?: Snippet`, rendered as its own
  section below the Tank section. Absent means no section at all.

- [ ] **Step 1: Write the panel**

Create `src/lib/ui/SyncPanel.svelte`:

```svelte
<script lang="ts">
	import type { Account } from '$lib/auth/session';
	import type { SyncStatus } from '$lib/persist/sync/syncing';
	import { ago } from './ago';

	/**
	 * Everything sync offers the user, in one place behind the gear.
	 *
	 * The timestamp is the point, not the button. A tank that agrees with the server
	 * and one that has been failing for two days look identical; this is the only
	 * thing that tells them apart, and it answers the question before you tap.
	 */
	type Props = {
		account: Account | null;
		status: SyncStatus;
		/** Passed in rather than read here, so the line is a pure function of props. */
		now: number;
		onSignIn: () => void;
		onSignOut: () => void;
		onSyncNow: () => void;
	};

	const { account, status, now, onSignIn, onSignOut, onSyncNow }: Props = $props();

	/** Failures that will never fix themselves say so; `offline` will, and stays mild. */
	const TROUBLE: Record<SyncStatus['state'], string> = {
		idle: '',
		syncing: '',
		offline: 'Not syncing — offline',
		denied: 'Not syncing — sign in again',
		stale: 'Not syncing — this device is out of date',
		rejected: 'Not syncing — the server refused this data',
		skewed: "Syncing, but this device's clock looks wrong",
		storage: 'Not syncing — local storage is unavailable'
	};

	const line = $derived.by(() => {
		const trouble = TROUBLE[status.state];
		const last = status.at === undefined ? undefined : ago(status.at, now);

		// A failure still reports the last success: knowing sync is broken matters
		// less than knowing how stale the tank is because of it.
		if (trouble) return last ? `${trouble}. Last synced ${last}.` : trouble;
		if (status.state === 'syncing') return 'Syncing…';
		return last ? `Synced ${last}` : 'Not synced yet';
	});
</script>

<h2>Sync</h2>

{#if account}
	<p class="who">{account.email ?? 'Signed in'}</p>

	<div class="status">
		<span aria-live="polite">{line}</span>
		<button type="button" onclick={onSyncNow} disabled={status.state === 'syncing'}>
			Sync now
		</button>
	</div>

	<button type="button" class="row" onclick={onSignOut}>Sign out</button>
{:else}
	<button type="button" class="row" onclick={onSignIn}>Sign in to sync</button>
{/if}

<style>
	h2 {
		margin: 1.5rem 0 1rem;
		font-size: 1.15rem;
		font-weight: 600;
	}

	.who {
		margin: 0 0 0.35rem;
		font-size: 0.9rem;
		/* An address can be longer than the sheet; truncate rather than widen it. */
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
		opacity: 0.8;
	}

	.status span {
		/* The longest line wraps inside its own column instead of pushing the button
		   off the sheet. */
		min-width: 0;
	}

	.status button {
		flex: none;
		font: inherit;
		padding: 0.4rem 0.8rem;
		border: 1px solid rgba(18, 48, 58, 0.2);
		border-radius: 0.6rem;
		background: rgba(255, 255, 255, 0.6);
		color: inherit;
		cursor: pointer;
	}

	.status button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
```

- [ ] **Step 2: Give Settings a slot for it**

In `src/lib/ui/Settings.svelte`, add to the `Props` type and the destructure:

```ts
	import type { Snippet } from 'svelte';

	type Props = {
		open: boolean;
		environment: Environment;
		onChange: (environment: Environment) => void;
		onOpenLegend: () => void;
		onClose: () => void;
		/**
		 * The sync section. Absent when Supabase is not configured, in which case no
		 * heading renders either — an empty "Sync" section would be worse than none.
		 */
		sync?: Snippet;
	};
```

Render it between the legend row and the actions:

```svelte
	{#if sync}
		{@render sync()}
	{/if}

	<div class="actions">
```

- [ ] **Step 3: Verify the typecheck**

Run: `npm run check`
Expected: 0 errors. The panel is not yet rendered anywhere, which is fine.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ui/SyncPanel.svelte src/lib/ui/Settings.svelte
git commit -m "feat: a sync section for the settings sheet"
```

---

### Task 3: Wire it, and take the header back

The swap. The header returns to what it was before sync existed.

**Files:**
- Modify: `src/routes/+page.svelte`
- Modify: `src/lib/ui/DateHeader.svelte`
- Modify: `src/lib/ui/Banner.svelte`
- Delete: `src/lib/ui/AccountButton.svelte`

**Interfaces:**
- Consumes: `SyncPanel.svelte` and the `sync` prop on `Settings.svelte` from Task 2;
  `SyncStatus` carrying `at` from Task 1.
- Produces: `Banner.svelte` props become
  `{ visible: boolean; title?: string; detail?: string }`, defaulting to the existing
  save-failure copy so its current call site is unchanged in meaning.

- [ ] **Step 1: Let the banner carry a message**

In `src/lib/ui/Banner.svelte`:

```svelte
	type Props = {
		visible: boolean;
		/** Defaults to the save failure this banner was built for. */
		title?: string;
		detail?: string;
	};

	const {
		visible,
		title = 'Changes are not being saved on this device.',
		detail = 'Your tasks are still here for now, but they will be lost if you reload.'
	}: Props = $props();
```

and in the markup, replace the two hardcoded strings with `{title}` and `{detail}`.

- [ ] **Step 2: Remove the account row from the header**

In `src/lib/ui/DateHeader.svelte`, delete the `account?: Snippet` prop, its entry in
the destructure, the `{#if account}…{/if}` block wrapping `.account-row`, and the
`.account-row` style rule. Leave `.row` and everything else untouched — the header
returns to the single row it had before sync.

- [ ] **Step 3: Rewire the page**

In `src/routes/+page.svelte`:

Replace the `AccountButton` import with `SyncPanel`:

```ts
	import SyncPanel from '$lib/ui/SyncPanel.svelte';
```

Hold the whole status rather than only its state, and a clock for the relative line:

```ts
	let syncStatus = $state<SyncStatus>({ state: 'idle' });
```

Change the `onStatus` callback in `useAccount` to `(status) => (syncStatus = status)`.

`now` already exists as a `$state` holding today's date string and is not a clock, so
add one for the timestamp, ticking on the interval that already exists:

```ts
	// Only so "3 minutes ago" ages while the sheet is open. The existing 20-second
	// rollover interval is a fine cadence for a line measured in minutes.
	let clock = $state(Date.now());
```

and in the existing `rollover` function, add `clock = Date.now();`.

Delete the `accountControl` snippet and the `account={…}` prop passed to
`<DateHeader>`. Add the snippet for Settings instead:

```svelte
{#snippet syncSection()}
	<SyncPanel
		{account}
		status={syncStatus}
		now={clock}
		onSignIn={() => void auth.signIn()}
		onSignOut={() => void auth.signOut()}
		onSyncNow={() => void syncing?.sync()}
	/>
{/snippet}
```

and pass it: `sync={isSyncConfigured() ? syncSection : undefined}` on `<Settings>`.

- [ ] **Step 4: Give the banner its precedence**

Replace the existing `<Banner visible={$saveFailed} />` with:

```svelte
<!--
  Local storage failing is strictly worse than the cloud failing, so it wins the one
  banner. Only sync failures that will never fix themselves get one at all: a phone
  loses signal constantly, and nagging about it teaches you to ignore the banner —
  which costs you the three below.
-->
{#if $saveFailed}
	<Banner visible={true} />
{:else if syncStatus.state === 'denied'}
	<Banner
		visible={true}
		title="Sync is signed out."
		detail="Your tasks are safe on this device. Open Settings to sign in again."
	/>
{:else if syncStatus.state === 'stale'}
	<Banner
		visible={true}
		title="This device is out of date."
		detail="It will not sync until the app is reloaded to pick up the newer version."
	/>
{:else if syncStatus.state === 'rejected'}
	<Banner
		visible={true}
		title="The server refused this data."
		detail="Your tasks are safe on this device, but they are not reaching your other ones."
	/>
{/if}
```

- [ ] **Step 5: Delete the old control**

```bash
rm src/lib/ui/AccountButton.svelte
```

Then confirm nothing still imports it:

```bash
grep -rn "AccountButton" src scripts
```

Expected: no matches.

- [ ] **Step 6: Verify, and look at it**

Run: `npm test && npm run check && npm run build`
Expected: all pass, 0 errors.

Then look at the sheet, which is mandatory for anything visual in this project and is
how the last placement bug in this feature was caught. With
`npx vite dev --port 5199 &` running, write a scratch script in `scripts/` (Playwright
must resolve from the repo) that opens Settings and screenshots the sheet clipped, at
`deviceScaleFactor` 4 or more. Do not crop afterwards with `sips -c` — it crops from
the centre and silently returns the wrong region.

Capture, and READ each image with the Read tool:
1. Signed out — one "Sign in to sync" row, no timestamp, no button.
2. Signed in, idle, with a long email (`a.very.long.address@somecompany.example`).
3. The longest line: `skewed` state with an `at` an hour old.
4. At 420×860 and at a narrower width.

Confirm the email truncates rather than widening the sheet, the "Sync now" button
stays on screen, and the status line wraps within its own column. Describe what you
saw. If anything overflows, fix it and look again.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: move the account controls behind the gear"
```

---

### Task 4: Prove it, and say so

**Files:**
- Modify: `scripts/e2e.mjs`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

- [ ] **Step 1: Retarget the E2E checks**

In `scripts/e2e.mjs`, the sync section currently looks for a header button. Replace
the sign-in check with one that opens Settings, and add the header assertion. Read the
file first and follow its existing idiom for opening sheets — it already opens
Settings elsewhere to reach the legend, and that selector is the one to reuse:

```js
// The account controls live behind the gear now, so the tank itself must carry no
// trace of them either way.
check(
	'the header has no account row',
	(await page.locator('.account-row').count()) === 0
);

await page.getByLabel('Settings').click();
const syncSection = await page.getByRole('heading', { name: 'Sync' }).count();
check(
	expectSync ? 'Settings offers sync when configured' : 'Settings has no sync section when unconfigured',
	expectSync ? syncSection === 1 : syncSection === 0
);
if (expectSync) {
	check(
		'the sign-in control is offered in a configured build',
		(await page.getByRole('button', { name: 'Sign in to sync' }).count()) === 1
	);
}
await page.getByRole('button', { name: 'Done' }).click();
```

Keep the existing "no network calls left the page" check exactly as it is — it holds
either way and is not relaxed for a configured build.

- [ ] **Step 2: Run both modes**

Run: `npx vite dev --port 5199 &` then `npm run e2e`
Expected: all checks pass with no `.env.local` present (temporarily move it aside if
you have one: `mv .env.local /tmp/ && npm run e2e; mv /tmp/.env.local .`).

Run: `E2E_EXPECT_SYNC=1 npm run e2e` with `.env.local` in place.
Expected: all checks pass, including the configured-only ones.

- [ ] **Step 3: Update the standing brief**

In `CLAUDE.md`, the architecture section describes `ui/` components. Add one line to
the "Invariants that break quietly" section:

```markdown
**The last-synced time is device-local and must never be persisted.** It lives in
`SyncingTaskStore` and rides on `SyncStatus`. The only thing this app persists is
`Snapshot`, which is exactly what syncs — so a timestamp stored there would replicate,
and the laptop would display the phone's sync time as its own. The cost is that it
blanks on reload, which is honest: the line reads "Not synced yet" until the launch
sync lands.
```

- [ ] **Step 4: Full verification**

Run: `npm test && npm run check && npm run build`
Expected: all pass, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e.mjs CLAUDE.md
git commit -m "test: assert sync lives behind the gear, in both builds"
```

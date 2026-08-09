# Legend Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent legend sheet that names each creature kind, reachable from Settings and shown once on a first visit.

**Architecture:** A new `ui/Legend.svelte` sibling sheet, built on the same `backdrop + .sheet` construction as `Settings.svelte`. Its entry list is plain exported data in `<script module>` with its own unit test; the component draws each entry by handing a synthetic `Creature` and a centred `Placement` to the real `drawCreature`, so legend art cannot drift from the tank. A new `seenLegend` flag on `Settings` drives one-time auto-open, and takes opposite defaults on the fresh-install and migration paths.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), TypeScript, vitest, Playwright, canvas 2D.

## Global Constraints

- `render/` imports nothing outside itself. `ui/` may import from `render/`; never the reverse.
- `store/` reaches persistence only through the `TaskStore` interface.
- All per-creature variation comes from `hash(id)`. Never `Math.random()`, never `hash % n`.
- `place()` is the single owner of creature position, shared with `pick()`. The legend must not become a third definition — it bypasses `place()` entirely by passing an explicit `Placement`.
- Nothing may allocate per frame inside a draw path.
- `npm run check` must report **0 errors** at every commit.
- All 486 existing unit tests and 62 E2E checks must still pass.
- Anything visual is **looked at**, not reasoned about — screenshot with a `clip` region at `deviceScaleFactor` 4–8. Never crop with `sips -c` afterwards.
- Spec: `docs/superpowers/specs/2026-08-09-legend-sheet-design.md`.
- Branch: `legend-sheet`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/types.ts` | Modify: `Settings` gains `seenLegend`; `SCHEMA_VERSION` 1 → 2. |
| `src/lib/persist/migrate.ts` | Modify: add the `1 -> 2` step. |
| `src/lib/persist/local.ts` | Modify: `emptySnapshot()` defaults `seenLegend: false`. |
| `src/lib/persist/local.test.ts` | Modify: re-aim the migration assertion that compares against `emptySnapshot().settings`. |
| `src/lib/store/tasks.ts` | Modify: two default-settings literals; add `markLegendSeen`. |
| `src/lib/store/settings.ts` | Modify: add `shouldAutoOpen`. |
| `src/lib/store/settings.test.ts` | Create: tests for `shouldAutoOpen`. |
| `src/lib/ui/Legend.svelte` | Create: entry data in `<script module>`, plus the sheet component. |
| `src/lib/ui/Legend.test.ts` | Create: tests over the entry list. |
| `src/lib/ui/Settings.svelte` | Modify: add the "What am I looking at?" row and an `onOpenLegend` prop. |
| `src/routes/+page.svelte` | Modify: own `legendOpen`, wire both sheets, auto-open after hydrate. |
| `scripts/e2e.mjs` | Modify: `snap()` emits v2; new checks for the row and for auto-open. |

---

### Task 1: Schema — `seenLegend` and the 1 → 2 migration

**Files:**
- Modify: `src/lib/types.ts:30`, `src/lib/types.ts:33`
- Modify: `src/lib/persist/migrate.ts:12-22`
- Modify: `src/lib/persist/local.ts:14`
- Modify: `src/lib/store/tasks.ts:164`, `src/lib/store/tasks.ts:168`
- Test: `src/lib/persist/local.test.ts:135-165`

**Interfaces:**
- Consumes: nothing.
- Produces: `Settings = { environment: 'progress' | 'calm'; seenLegend: boolean }`, `SCHEMA_VERSION = 2`. Every later task depends on this shape.

**The whole point of this task:** stored data migrates to `seenLegend: true` (the app has been used), a fresh install starts at `false` (it has not). Both compile either way, so the tests are the only thing holding them apart.

- [ ] **Step 1: Write the failing tests**

In `src/lib/persist/local.test.ts`, replace the `LocalTaskStore — migration` describe block (currently lines 135–165) with:

```ts
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

		expect(loaded.version).toBe(2);
		expect(loaded.settings).toEqual({ environment: 'calm', seenLegend: true });
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
```

`emptySnapshot`, `STORAGE_KEY`, `SCHEMA_VERSION` and the `task`/`snapshot`/`FakeStorage` helpers are all already imported or defined at the top of that file — the replacement block needs no new imports.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/persist/local.test.ts`
Expected: FAIL. `loaded.settings.seenLegend` is `undefined`, not `true`; `loaded.version` is `1`, not `2`.

- [ ] **Step 3: Widen the type and bump the version**

In `src/lib/types.ts`, replace line 30 and the `SCHEMA_VERSION` line:

```ts
/**
 * `seenLegend` is a one-way latch for the first-run legend. It is a setting rather
 * than a separate storage key because `store/` reaches persistence only through the
 * `TaskStore` port, and a second key would be a second thing to migrate.
 */
export type Settings = { environment: 'progress' | 'calm'; seenLegend: boolean };

/** Current storage schema version. Bumped when `Snapshot` changes shape. */
export const SCHEMA_VERSION = 2;
```

- [ ] **Step 4: Add the migration step**

In `src/lib/persist/migrate.ts`, add a `1` key to the `migrations` record, leaving the existing `0` step untouched:

```ts
const migrations: Record<number, Migration> = {
	// 0 -> 1: `koi` and `settings` did not exist yet.
	0: (data) => ({
		...data,
		koi: Array.isArray(data.koi) ? data.koi : [],
		settings:
			typeof data.settings === 'object' && data.settings !== null
				? data.settings
				: { environment: 'progress' }
	}),

	// 1 -> 2: `seenLegend` did not exist yet.
	//
	// TRUE, not false. The obvious reading of a new boolean field is "default it off",
	// and that is wrong here: reaching this step at all means there was stored data,
	// which means the app has been used. Only a fresh install — which has no snapshot
	// to migrate and takes `emptySnapshot()` instead — should be shown the legend.
	//
	// A v0 blob reaches `true` through this step as well, so the v0 fallback above
	// needs no change.
	1: (data) => {
		const settings =
			typeof data.settings === 'object' && data.settings !== null
				? (data.settings as Record<string, unknown>)
				: {};
		return { ...data, settings: { ...settings, seenLegend: true } };
	}
};
```

- [ ] **Step 5: Default the three fresh-install sites to `false`**

`src/lib/persist/local.ts:14` — inside `emptySnapshot()`:

```ts
export function emptySnapshot(): Snapshot {
	return {
		version: SCHEMA_VERSION,
		tasks: [],
		koi: [],
		// A tank with nothing in it has never been used, so its owner gets the legend.
		settings: { environment: 'progress', seenLegend: false }
	};
}
```

`src/lib/store/tasks.ts:161-168` — both literals:

```ts
	const state = writable<State>({
		tasks: [],
		koi: [],
		settings: { environment: 'progress', seenLegend: false }
	});
	const tasks = writable<Task[]>([]);
	const koi = writable<KoiRecord[]>([]);
	const settings = writable<Settings>({ environment: 'progress', seenLegend: false });
```

- [ ] **Step 6: Run the full unit suite and the typechecker**

Run: `npm test && npm run check`
Expected: all tests PASS, 0 typecheck errors. If another test hardcodes a `Settings` literal, it will fail to typecheck — add `seenLegend: false` to it, since test fixtures stand in for fresh state.

- [ ] **Step 7: Validate the migration test by mutation**

Temporarily change the `1 -> 2` step to write `seenLegend: false`. Run `npx vitest run src/lib/persist/local.test.ts` and confirm *"marks migrated data as having seen the legend"* FAILS. Then put `true` back and confirm it passes again. A test that cannot fail reads as coverage without being it.

- [ ] **Step 8: Commit**

```bash
git add src/lib/types.ts src/lib/persist/migrate.ts src/lib/persist/local.ts src/lib/persist/local.test.ts src/lib/store/tasks.ts
git commit -m "feat: seenLegend on Settings, schema v2

Migrated data defaults to true and a fresh install to false. The two paths
disagree on purpose: stored data means the app has been used, so its owner
does not need a first-run legend."
```

---

### Task 2: Store — `shouldAutoOpen` and `markLegendSeen`

**Files:**
- Modify: `src/lib/store/settings.ts`
- Create: `src/lib/store/settings.test.ts`
- Modify: `src/lib/store/tasks.ts` (reducer near `setEnvironment` at line 113, facade type near line 156, facade method near line 215)

**Interfaces:**
- Consumes: `Settings` from Task 1.
- Produces:
  - `shouldAutoOpen(settings: Settings): boolean` from `src/lib/store/settings.ts`
  - `markLegendSeen(state: State): State` from `src/lib/store/tasks.ts`
  - `TaskStoreFacade.markLegendSeen(): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/lib/store/settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldAutoOpen, showsMoodNumber } from './settings';
import type { Settings } from '../types';

const settings = (over: Partial<Settings> = {}): Settings => ({
	environment: 'progress',
	seenLegend: false,
	...over
});

describe('shouldAutoOpen', () => {
	it('opens the legend for someone who has never seen it', () => {
		expect(shouldAutoOpen(settings())).toBe(true);
	});

	it('stays shut once it has been seen', () => {
		expect(shouldAutoOpen(settings({ seenLegend: true }))).toBe(false);
	});

	it('does not care which environment is chosen', () => {
		expect(shouldAutoOpen(settings({ environment: 'calm' }))).toBe(true);
		expect(shouldAutoOpen(settings({ environment: 'calm', seenLegend: true }))).toBe(false);
	});
});

describe('showsMoodNumber is unaffected', () => {
	it('still keys off the environment alone', () => {
		expect(showsMoodNumber(settings())).toBe(true);
		expect(showsMoodNumber(settings({ environment: 'calm' }))).toBe(false);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/store/settings.test.ts`
Expected: FAIL — `shouldAutoOpen` is not exported from `./settings`.

- [ ] **Step 3: Implement `shouldAutoOpen`**

Append to `src/lib/store/settings.ts`:

```ts
/**
 * Whether to show the legend unasked.
 *
 * A pure predicate rather than a condition inline in the page, so the rule is
 * testable without mounting anything. One-way: the flag is written the moment the
 * legend is shown, not when it is closed, so a reload mid-view does not re-open it.
 */
export function shouldAutoOpen(settings: Settings): boolean {
	return !settings.seenLegend;
}
```

Add the type import at the top of the file if `Settings` is not already imported — it is, on line 1.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/lib/store/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing store test**

Append to `src/lib/store/tasks.test.ts`:

```ts
describe('markLegendSeen', () => {
	it('latches the flag on', () => {
		const state = {
			tasks: [],
			koi: [],
			settings: { environment: 'progress' as const, seenLegend: false }
		};

		expect(markLegendSeen(state).settings.seenLegend).toBe(true);
	});

	it('is idempotent — showing the legend twice is not an error', () => {
		const state = {
			tasks: [],
			koi: [],
			settings: { environment: 'calm' as const, seenLegend: true }
		};

		expect(markLegendSeen(state)).toEqual(state);
	});

	it('leaves the environment alone', () => {
		const state = {
			tasks: [],
			koi: [],
			settings: { environment: 'calm' as const, seenLegend: false }
		};

		expect(markLegendSeen(state).settings.environment).toBe('calm');
	});
});
```

Add `markLegendSeen` to the existing import from `./tasks` at the top of that file.

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/lib/store/tasks.test.ts -t markLegendSeen`
Expected: FAIL — `markLegendSeen` is not exported.

- [ ] **Step 7: Implement the reducer and facade method**

In `src/lib/store/tasks.ts`, directly after `setEnvironment` (line 113–115):

```ts
/**
 * Records that the legend has been shown. Not a task mutation, so nothing here bumps
 * `updatedAt` — that field stamps edits to tasks, and stamping a settings change with
 * it would make a sync reconciler think a task moved.
 */
export function markLegendSeen(state: State): State {
	return { ...state, settings: { ...state.settings, seenLegend: true } };
}
```

In the `TaskStoreFacade` type, beside `setEnvironment` (line 156):

```ts
	markLegendSeen(): Promise<void>;
```

In the returned object, beside the `setEnvironment` entry (line 215):

```ts
		markLegendSeen: () => commit(markLegendSeen(get(state))),
```

- [ ] **Step 8: Run the full suite and typecheck**

Run: `npm test && npm run check`
Expected: all PASS, 0 errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/store/settings.ts src/lib/store/settings.test.ts src/lib/store/tasks.ts src/lib/store/tasks.test.ts
git commit -m "feat: shouldAutoOpen predicate and markLegendSeen reducer"
```

---

### Task 3: The entry list, and a text-only sheet

**Files:**
- Create: `src/lib/ui/Legend.svelte`
- Create: `src/lib/ui/Legend.test.ts`

**Interfaces:**
- Consumes: `Creature`, `CreatureKind` from `$lib/scene/types`.
- Produces, from `src/lib/ui/Legend.svelte` `<script module>`:
  - `type LegendEntry = { id: string; title: string; blurb: string; zoom: number; creature: Creature }`
  - `const LEGEND_ENTRIES: LegendEntry[]`
  - `const LEGEND_TIME: number`
  - Default export: the `Legend` component, props `{ open: boolean; onClose: () => void }`.

This task ships the sheet with **no canvases** — text rows only. Task 4 adds the art. Splitting there is deliberate: the entry data is pure and unit-testable, the drawing is not, and a reviewer can reject one without the other.

- [ ] **Step 1: Write the failing test**

Create `src/lib/ui/Legend.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LEGEND_ENTRIES, LEGEND_TIME } from './Legend.svelte';
import type { CreatureKind } from '../scene/types';

/**
 * Every kind, spelled out. This is a Record rather than an array so that adding a
 * member to `CreatureKind` breaks `npm run check` here — a compile error naming the
 * missing kind beats a test asserting a count that someone will relax.
 */
const ALL_KINDS: Record<CreatureKind, true> = {
	fish: true,
	bubble: true,
	ghost: true,
	koi: true,
	treat: true,
	pearl: true
};

describe('legend entries', () => {
	it('covers every creature kind the tank can draw', () => {
		const covered = new Set(LEGEND_ENTRIES.map((e) => e.creature.kind));
		expect([...Object.keys(ALL_KINDS)].filter((k) => !covered.has(k as CreatureKind))).toEqual([]);
	});

	it('has seven rows — the six kinds plus the treat split', () => {
		expect(LEGEND_ENTRIES).toHaveLength(7);
	});

	it('gives every row a unique id', () => {
		const ids = LEGEND_ENTRIES.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('explains both treat states, because the dim one is what people ask about', () => {
		const treats = LEGEND_ENTRIES.filter((e) => e.creature.kind === 'treat');
		expect(treats).toHaveLength(2);
		expect(treats.filter((t) => t.creature.locked)).toHaveLength(1);
		expect(treats.filter((t) => !t.creature.locked)).toHaveLength(1);
	});

	it('says something in every row', () => {
		for (const entry of LEGEND_ENTRIES) {
			expect(entry.title).toMatch(/\S/);
			expect(entry.blurb.length).toBeGreaterThan(15);
		}
	});

	// Every visual property downstream comes from hash(id). A generated id would make
	// the legend fish a different fish on every open, and every screenshot a new one.
	it('uses fixed literal creature ids so the art is stable', () => {
		for (const entry of LEGEND_ENTRIES) {
			expect(entry.creature.id).toMatch(/^legend-/);
		}
	});

	it('draws no creature at a scale that would spill its row', () => {
		for (const entry of LEGEND_ENTRIES) {
			expect(entry.zoom).toBeGreaterThan(0);
			expect(entry.zoom).toBeLessThanOrEqual(1.5);
		}
	});

	it('pins the drawing time, so each frame is reproducible', () => {
		expect(Number.isFinite(LEGEND_TIME)).toBe(true);
	});
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/ui/Legend.test.ts`
Expected: FAIL — cannot resolve `./Legend.svelte`.

- [ ] **Step 3: Create the component with entry data and text rows**

Create `src/lib/ui/Legend.svelte`:

```svelte
<script module lang="ts">
	import type { Creature } from '../scene/types';

	/**
	 * The reference for what lives in the tank.
	 *
	 * The app teaches its chrome fine and its vocabulary not at all: a bubble, a dim
	 * exotic fish and a koi each mean something specific and nothing on screen says
	 * what. This is a key, not a tour — it is here on the first day and on the
	 * hundredth, when the meaning of a dim fish has been forgotten.
	 */
	export type LegendEntry = {
		/** Stable row id, independent of the creature's own id. */
		id: string;
		title: string;
		blurb: string;
		/**
		 * Draw scale for this row's thumbnail. A pearl and an angelfish differ by
		 * roughly four times in natural size, and a legend wants them the same size on
		 * the page. Set by looking at the rendered sheet, not by arithmetic.
		 */
		zoom: number;
		/** Synthetic descriptor, handed to the real `drawCreature`. */
		creature: Creature;
	};

	/**
	 * The instant every legend creature is drawn at.
	 *
	 * Fixed so each thumbnail is the same frame on every open and every screenshot.
	 * Non-zero because the body wave is a function of time: at 0 every fish is drawn
	 * mid-stroke at phase zero, which is the one pose that looks posed.
	 */
	export const LEGEND_TIME = 3.2;

	export const LEGEND_ENTRIES: LegendEntry[] = [
		{
			id: 'fish',
			title: 'Fish',
			blurb: 'An ordinary task, swimming until you finish it.',
			zoom: 0.85,
			creature: { id: 'legend-fish', kind: 'fish', label: 'Fish', depth: 0.4, tapRadius: 34 }
		},
		{
			id: 'bubble',
			title: 'Bubble',
			blurb: 'A task waiting for its moment — a time, another task, or your say-so.',
			zoom: 1,
			creature: { id: 'legend-bubble', kind: 'bubble', label: 'Bubble', depth: 0.3, tapRadius: 32 }
		},
		{
			id: 'ghost',
			title: 'Ghost',
			blurb: 'A task you finished today. It stays, faintly, so the day shows its work.',
			zoom: 0.9,
			creature: { id: 'legend-ghost', kind: 'ghost', label: 'Ghost', depth: 0.5, tapRadius: 26 }
		},
		{
			id: 'treat-locked',
			title: 'Treat, out of reach',
			blurb: 'A reward you have not earned yet. Dim until you can afford it.',
			zoom: 0.8,
			creature: {
				id: 'legend-treat-locked',
				kind: 'treat',
				label: 'Treat',
				depth: 0.2,
				locked: true,
				cost: 3,
				tapRadius: 36
			}
		},
		{
			id: 'treat',
			title: 'Treat, affordable',
			blurb: 'Bright once you have the pearls. Tap it to claim it.',
			zoom: 0.8,
			creature: {
				id: 'legend-treat',
				kind: 'treat',
				label: 'Treat',
				depth: 0.2,
				cost: 3,
				tapRadius: 36
			}
		},
		{
			id: 'koi',
			title: 'Koi',
			blurb: 'A day you cleared completely. It keeps swimming from then on.',
			zoom: 0.7,
			creature: { id: 'legend-koi', kind: 'koi', label: 'Koi', depth: 0.6, tapRadius: 38 }
		},
		{
			id: 'pearl',
			title: 'Pearl',
			blurb: 'Dropped on the sand each time you finish something. Treats are priced in these.',
			zoom: 1.4,
			creature: { id: 'legend-pearl', kind: 'pearl', label: 'Pearl', depth: 1, tapRadius: 16 }
		}
	];
</script>

<script lang="ts">
	type Props = {
		open: boolean;
		onClose: () => void;
	};

	const { open, onClose }: Props = $props();
</script>

{#if open}
	<div
		class="backdrop"
		role="button"
		tabindex="-1"
		aria-label="Close"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
	></div>

	<section class="sheet" aria-label="What am I looking at?">
		<h2>What am I looking at?</h2>

		<ul>
			{#each LEGEND_ENTRIES as entry (entry.id)}
				<li>
					<span class="text">
						<strong>{entry.title}</strong>
						<small>{entry.blurb}</small>
					</span>
				</li>
			{/each}
		</ul>

		<div class="actions">
			<!-- Not "Back to the tank": ListView.svelte:123 already uses that label, and
			     two buttons with one accessible name make every E2E selector ambiguous. -->
			<button type="button" onclick={onClose}>Got it</button>
		</div>
	</section>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 22;
		border: 0;
		padding: 0;
		background: rgba(10, 30, 40, 0.35);
		backdrop-filter: blur(6px);
	}

	/* Above Settings (21), because it opens from inside that sheet. */
	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 23;
		max-width: 34rem;
		max-height: 82vh;
		overflow-y: auto;
		margin: 0 auto;
		padding: 1.5rem 1.5rem calc(1.5rem + env(safe-area-inset-bottom));
		border-radius: 1.25rem 1.25rem 0 0;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(18px);
		box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.25);
		color: #12303a;
	}

	@media (min-width: 40rem) {
		.sheet {
			inset: auto 0 2rem 0;
			border-radius: 1.25rem;
			box-shadow: 0 18px 60px rgba(0, 0, 0, 0.3);
		}
	}

	h2 {
		margin: 0 0 1rem;
		font-size: 1.15rem;
		font-weight: 600;
	}

	ul {
		display: grid;
		gap: 0.9rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.9rem;
	}

	.text {
		display: grid;
		gap: 0.15rem;
	}

	strong {
		font-size: 0.95rem;
		font-weight: 600;
	}

	small {
		font-size: 0.82rem;
		line-height: 1.35;
		opacity: 0.75;
	}

	.actions {
		margin-top: 1.25rem;
	}

	button {
		padding: 0.6rem 1.1rem;
		border: 0;
		border-radius: 999px;
		background: #12303a;
		color: #fff;
		font-size: 0.95rem;
		cursor: pointer;
	}

	button:focus-visible {
		outline: 2px solid #12303a;
		outline-offset: 2px;
	}
</style>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/ui/Legend.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Validate the coverage test by mutation**

Delete the `pearl` entry from `LEGEND_ENTRIES` and run the test file again. Confirm *"covers every creature kind the tank can draw"* FAILS naming `pearl`, and *"has seven rows"* FAILS too. Restore the entry.

- [ ] **Step 6: Typecheck and commit**

Run: `npm run check`
Expected: 0 errors.

```bash
git add src/lib/ui/Legend.svelte src/lib/ui/Legend.test.ts
git commit -m "feat: legend sheet with the seven creature entries

Text only for now. The entry list is plain data with its own test, following
ENVIRONMENT_CHOICES; the drawing arrives next."
```

---

### Task 4: Draw each entry with the real renderer

**Files:**
- Modify: `src/lib/ui/Legend.svelte`

**Interfaces:**
- Consumes: `LEGEND_ENTRIES`, `LEGEND_TIME` (Task 3); `drawCreature`, `type Placement` from `$lib/render/creatures`; `palette`, `type Environment` from `$lib/render/palette`.
- Produces: `Legend` props become `{ open: boolean; environment: Environment; onClose: () => void }`.

**Why this shape:** `drawCreature` takes an explicit `Placement`, so the legend never touches `place()`. `place()` stays the single owner of creature position, shared only with `pick()`.

- [ ] **Step 1: Add the environment prop and the canvas elements**

Replace the instance `<script>` block in `src/lib/ui/Legend.svelte` with:

```svelte
<script lang="ts">
	import { drawCreature, type Placement } from '../render/creatures';
	import { palette, type Environment } from '../render/palette';

	type Props = {
		open: boolean;
		/** Matches the tank the user is actually looking at. */
		environment: Environment;
		onClose: () => void;
	};

	const { open, environment, onClose }: Props = $props();

	/** Thumbnail size in CSS pixels. */
	const THUMB = { w: 72, h: 52 };

	/**
	 * Drawn at a cleared day's palette regardless of progress.
	 *
	 * A reference wants its subjects legible, and the Progress palette at 0 is
	 * deliberately murky — the legend would open dimmest exactly when a new user first
	 * sees it, which is the worst possible moment for it.
	 */
	const LEGEND_CLEARED = 1;

	let canvases = $state<(HTMLCanvasElement | undefined)[]>([]);

	/**
	 * One static frame per row, drawn when the sheet opens or the palette changes.
	 *
	 * No requestAnimationFrame: seven animating canvases over a blurred tank is real
	 * cost on a phone for a sheet nobody watches. Nothing here allocates repeatedly —
	 * it runs on open, not per frame.
	 */
	$effect(() => {
		if (!open) return;

		const colors = palette(environment, LEGEND_CLEARED);
		const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

		LEGEND_ENTRIES.forEach((entry, i) => {
			const canvas = canvases[i];
			if (!canvas) return;

			canvas.width = THUMB.w * dpr;
			canvas.height = THUMB.h * dpr;

			const ctx = canvas.getContext('2d');
			if (!ctx) return;

			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, THUMB.w, THUMB.h);

			// Centre the row, then scale, then draw at the origin — so the placement
			// carries no layout maths of its own and `place()` stays uninvolved.
			ctx.translate(THUMB.w / 2, THUMB.h / 2);
			ctx.scale(entry.zoom, entry.zoom);

			const at: Placement = {
				x: 0,
				y: 0,
				flip: false,
				pitch: 0,
				// `effort` is a multiple of the creature's own average pace, so 1 is a fish
				// holding station. 0 would flatten the body wave and draw a stick.
				effort: 1,
				turn: 0
			};

			drawCreature(ctx, entry.creature, at, colors, LEGEND_TIME);
			ctx.setTransform(1, 0, 0, 1, 0, 0);
		});
	});
</script>
```

- [ ] **Step 2: Put a canvas in each row**

In the markup, replace the `<li>` body so the canvas precedes the text:

```svelte
			{#each LEGEND_ENTRIES as entry, i (entry.id)}
				<li>
					<!-- Decorative: the row's text is the accessible content, and a canvas
					     offers a screen reader nothing. -->
					<canvas
						bind:this={canvases[i]}
						aria-hidden="true"
						style="width: {THUMB.w}px; height: {THUMB.h}px"
					></canvas>
					<span class="text">
						<strong>{entry.title}</strong>
						<small>{entry.blurb}</small>
					</span>
				</li>
			{/each}
```

Add to the `<style>` block:

```css
	canvas {
		flex: none;
		border-radius: 0.6rem;
		/* A hint of water behind each subject: the creatures are drawn for a tank and
		   read as cut-outs on plain white. */
		background: rgba(79, 195, 217, 0.18);
	}
```

- [ ] **Step 3: Typecheck and run the unit suite**

Run: `npm run check && npm test`
Expected: 0 errors, all tests PASS. `Legend.test.ts` still passes — it imports only from `<script module>`, which is untouched.

- [ ] **Step 4: Look at it**

Nothing below is trustworthy until this step is done. Copy this into `scripts/legend-shot.mjs` (Playwright must resolve from the repo — a script run from `/tmp` cannot import it):

```js
import { chromium } from 'playwright';

const URL = 'http://localhost:5199/';

const browser = await chromium.launch();
const page = await browser.newPage({
	viewport: { width: 460, height: 900 },
	deviceScaleFactor: 4
});
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE ERROR:', m.text()));

await page.goto(URL);
await page.evaluate(() => localStorage.removeItem('fish-tank-todo/snapshot'));
await page.reload();
await page.waitForTimeout(1200);

// The legend opens by itself here because storage was just cleared.
const sheet = await page.locator('section[aria-label="What am I looking at?"]').boundingBox();
if (!sheet) throw new Error('legend sheet not on screen');

await page.screenshot({ path: 'legend.png', clip: sheet });
console.log('wrote legend.png');
await browser.close();
```

Run:

```bash
npx vite dev --port 5199 &
node scripts/legend-shot.mjs
```

Then **open `legend.png` and look at it.** Check: every creature inside its tile, none clipped at an edge, none so small it is a speck, the two treats visibly different in brightness, the pearl visible against the tinted background, the koi distinguishable from the fish.

Adjust the per-entry `zoom` values to fix anything that is spilling or too small, and re-shoot. This is the step art passes have skipped here before — fins larger than their bodies and six species rendering as two would both have been caught by one screenshot.

- [ ] **Step 5: Commit**

`scripts/legend-shot.mjs` is scratch — do not commit it. Remove it, or leave it untracked.

```bash
git add src/lib/ui/Legend.svelte
git commit -m "feat: draw legend entries with the real renderer

Each row hands drawCreature a centred Placement, so place() stays the single
owner of position and the legend cannot drift from the tank. One static frame
per row -- seven animating canvases over a blurred tank is real cost for a
sheet nobody watches."
```

---

### Task 5: Wire it up — Settings row, page state, auto-open

**Files:**
- Modify: `src/lib/ui/Settings.svelte`
- Modify: `src/lib/ui/Settings.test.ts`
- Modify: `src/routes/+page.svelte:19-23` (imports), `:44-46` (state), `:64-84` (onMount), `:235-241` (markup)

**Interfaces:**
- Consumes: `Legend` (Tasks 3–4), `shouldAutoOpen` and `store.markLegendSeen` (Task 2).
- Produces: `Settings` gains an `onOpenLegend: () => void` prop.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/ui/Settings.test.ts`:

```ts
import { LEGEND_ENTRIES } from './Legend.svelte';

describe('the legend is reachable from Settings', () => {
	// The row lives here rather than in a third corner button because the date header
	// is inset 4.25rem to clear the corner cluster -- three constants across two files
	// agreeing by convention alone (pending.md 5.2). Widening the cluster re-opens the
	// swallowed-arrow bug.
	it('has something to open', () => {
		expect(LEGEND_ENTRIES.length).toBeGreaterThan(0);
	});
});
```

- [ ] **Step 2: Add the row to Settings**

In `src/lib/ui/Settings.svelte`, add `onOpenLegend` to `Props` and the destructure:

```ts
	type Props = {
		open: boolean;
		environment: Environment;
		onChange: (environment: Environment) => void;
		onOpenLegend: () => void;
		onClose: () => void;
	};

	const { open, environment, onChange, onOpenLegend, onClose }: Props = $props();
```

In the markup, between the closing `</fieldset>` and `<div class="actions">`:

```svelte
		<button type="button" class="row" onclick={onOpenLegend}>
			<span>What am I looking at?</span>
			<span class="chevron" aria-hidden="true">›</span>
		</button>
```

And in `<style>`:

```css
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		margin-top: 1rem;
		padding: 0.75rem 0.9rem;
		border: 0;
		border-radius: 0.75rem;
		background: rgba(18, 48, 58, 0.08);
		color: #12303a;
		font-size: 0.95rem;
		text-align: left;
		cursor: pointer;
	}

	.row:hover {
		background: rgba(18, 48, 58, 0.14);
	}

	.chevron {
		opacity: 0.5;
	}
```

- [ ] **Step 3: Wire the page**

In `src/routes/+page.svelte`, add to the imports beside the other `$lib/ui` lines:

```ts
	import Legend from '$lib/ui/Legend.svelte';
	import { shouldAutoOpen } from '$lib/store/settings';
```

Beside `let settingsOpen = $state(false);`:

```ts
	let legendOpen = $state(false);
```

In `onMount`, replace the hydrate block:

```ts
		store.hydrate().then(() => {
			hydrated = true;
			ticker.start();

			// Written the moment it is shown, not when it is closed: a reload mid-view
			// must not bring it back. The write goes through `commit` like any other
			// mutation, so a storage failure surfaces on the existing banner.
			if (shouldAutoOpen(store.snapshot().settings)) {
				legendOpen = true;
				store.markLegendSeen();
			}
		});
```

In the markup, add `onOpenLegend` to the existing `<Settings>` and add `<Legend>` after it:

```svelte
	<Settings
		open={settingsOpen}
		environment={$settings.environment}
		onChange={(environment) => store.setEnvironment(environment)}
		onOpenLegend={() => (legendOpen = true)}
		onClose={() => (settingsOpen = false)}
	/>

	<Legend
		open={legendOpen}
		environment={$settings.environment}
		onClose={() => (legendOpen = false)}
	/>
```

- [ ] **Step 4: Typecheck and run the unit suite**

Run: `npm run check && npm test`
Expected: 0 errors, all PASS.

- [ ] **Step 5: Drive it by hand**

With the dev server on :5199, open it in a browser:
1. Clear `localStorage` for the origin, reload → the legend appears by itself.
2. Close it, reload → it does **not** come back.
3. Open ⚙ → tap "What am I looking at?" → the legend appears over Settings.
4. Close the legend → Settings is still open behind it.
5. Switch to Calm in Settings, reopen the legend → the art uses the Calm palette.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ui/Settings.svelte src/lib/ui/Settings.test.ts src/routes/+page.svelte
git commit -m "feat: open the legend from Settings, and once on a first visit

The flag is latched when the sheet is shown rather than when it is closed, so
a reload mid-view does not show it twice."
```

---

### Task 6: E2E coverage, and stop the legend ambushing the suite

**Files:**
- Modify: `scripts/e2e.mjs:55-63` (the `snap` helper), `:103` (the first `reset`), and a new block at the end.

**Interfaces:**
- Consumes: everything above.
- Produces: nothing further.

**The trap this task exists for:** `scripts/e2e.mjs:103` is `await reset(null)`, which clears storage entirely. Under this change that is a first visit, so the legend opens over the tank and swallows the first five checks' clicks. The seeded `snap()` helper has the same problem in reverse — it must emit v2 with `seenLegend: true` so the other 57 checks are unaffected.

- [ ] **Step 1: Update the `snap` helper to v2**

In `scripts/e2e.mjs`, replace the `snap` function (lines 55–63):

```js
// Seeded states stand for someone who has already used the app, so the legend must
// not auto-open over them. Only the fresh-storage block below exercises that path.
const snap = (tasksList, koi = []) => ({
	version: 2,
	tasks: tasksList,
	koi,
	settings: { environment: 'progress', seenLegend: true }
});
```

- [ ] **Step 2: Add the fresh-visit checks and dismiss the legend**

Replace line 103, `await reset(null);`, with:

```js
// ------------------------------------------------------------------ legend
// This is the suite's only genuinely fresh start, so it is where auto-open is
// checked. It must also dismiss the sheet: everything after this clicks on the tank.
console.log('\n== Legend ==');
await reset(null);

const legend = page.locator('section[aria-label="What am I looking at?"]');
check('a first visit opens the legend unasked', await legend.isVisible());
check('the legend names every creature', (await legend.locator('li').count()) === 7);

await legend.getByRole('button', { name: 'Got it' }).click();
await page.waitForTimeout(250);
check('the legend closes', !(await legend.isVisible()));

await page.reload();
await page.waitForTimeout(700);
check('a second visit does not re-open it', !(await legend.isVisible()));

await page.locator('button[aria-label="Settings"]').click();
await page.waitForTimeout(250);
await page.locator('button', { hasText: 'What am I looking at?' }).click();
await page.waitForTimeout(250);
check('Settings can open the legend again', await legend.isVisible());

await legend.getByRole('button', { name: 'Got it' }).click();
await page.waitForTimeout(200);
await page.locator('section[aria-label="Settings"] button', { hasText: 'Done' }).click();
await page.waitForTimeout(250);
check('closing both sheets returns to the tank', !(await legend.isVisible()));
```

Both legend clicks are scoped to `legend` rather than `page`. The sheet's own button says "Got it" precisely so it does not collide with `ListView.svelte:123`, which already owns "Back to the tank" — but scoping costs nothing and survives a future label change.

- [ ] **Step 3: Run the suite**

```bash
npx vite dev --port 5199 &
npm run e2e
```

Expected: 68/68 passed (62 existing + 6 new), and "no page errors during the run".

If any of the original 62 now fail, the cause is almost certainly a seeded snapshot that is not `seenLegend: true` — grep `scripts/e2e.mjs` for any object literal with `settings:` that does not go through `snap()`.

- [ ] **Step 4: Confirm the screenshot script still works**

Run: `npm run screenshot`

`scripts/screenshot.mjs:47` seeds `version: 1`, which now migrates to v2 and lands on `seenLegend: true` — so no legend covers the tank shot. **Leave it at version 1**: it is the only place that exercises the migration end to end in a real browser. Open `tank.png` and confirm no sheet is over the tank.

- [ ] **Step 5: Full verification before the final commit**

```bash
npm test && npm run check && npm run build && npm run e2e
```

Expected: all unit tests PASS, 0 typecheck errors, clean build, 68/68 E2E.

- [ ] **Step 6: Update the docs**

In `docs/pending.md`, under section 4's table, add:

```markdown
| **Legend art at small sizes** | The seven thumbnails are drawn at fixed per-entry `zoom` values set by eye at 460px. Untested on a very narrow or a very wide viewport. |
```

In `CLAUDE.md`, under the `render/` module list, add a line after the `render/pick.ts` entry noting the second consumer:

```markdown
`drawCreature` has two callers: `ui/Tank.svelte` (the tank) and `ui/Legend.svelte`
(one static thumbnail per creature kind, drawn from an explicit `Placement` so
`place()` is bypassed and stays the single owner of position).
```

- [ ] **Step 7: Commit**

```bash
git add scripts/e2e.mjs docs/pending.md CLAUDE.md
git commit -m "test: E2E coverage for the legend, and keep it off the other checks

The suite's first block runs on cleared storage, which is now a first visit --
the legend opened over it and ate the first five clicks. That block checks
auto-open and then dismisses it; every seeded snapshot says seenLegend: true."
```

---

## Verification checklist

Run before calling this done:

- [ ] `npm test` — all unit tests pass
- [ ] `npm run check` — 0 errors
- [ ] `npm run build` — clean
- [ ] `npm run e2e` — 68/68
- [ ] `legend.png` has been **opened and looked at** at `deviceScaleFactor` 4
- [ ] `tank.png` has been looked at — no sheet over the tank
- [ ] Cleared `localStorage` in a real browser shows the legend once and not twice

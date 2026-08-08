# Fish Tank To-Do — Implementation Stories

Source of truth: `docs/superpowers/specs/2026-08-08-fish-tank-todo-design.md`.
Visual/behavioural target: working prototype artifact `/artifact/ce25bc2d-302e-4d1c-8ae9-4dd969d4e4d3`.

Each story below is sized to be done in one sitting by one agent, has its own
acceptance criteria, and touches a disjoint set of files from its wave-mates.

## How to use this file

- **Sequential loop:** work the stories in wave order, top to bottom.
- **Parallel sub-agents:** everything inside a wave is safe to run simultaneously —
  no two stories in the same wave write the same file.
- **Waves 0 and 1 are gates.** They fix the type contracts every other layer codes
  against. Do not fan out until they are merged.

File ownership is listed per story. An agent must not create or edit files outside
its "Owns" list; if it needs something else, that is a missing story, not a licence.

---

## Wave 0 — Scaffold (1 story, blocks everything)

### S0. Scaffold the project

**Owns:** `package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`,
`src/routes/+layout.ts`, `src/routes/+page.svelte` (placeholder), `src/app.html`,
`.gitignore`

Run `npx sv create .` — SvelteKit, TypeScript, Vitest. Switch to `adapter-static`.
Add:

```ts
// src/routes/+layout.ts
export const ssr = false;
export const prerender = true;
```

Create empty directories with a `.gitkeep`: `src/lib/persist/`, `src/lib/store/`,
`src/lib/triggers/`, `src/lib/scene/`, `src/lib/render/`, `src/lib/ui/`.

**Done when:** `npm run dev` serves a blank page, `npm run build` produces a static
bundle, `npm test` runs Vitest with zero tests and exits 0.

---

## Wave 1 — Contracts (parallelisable, 2 stories, blocks waves 2+)

Both are type-and-signature only. No behaviour. They exist so waves 2–5 can be
written against a stable surface without agents colliding.

### S1. Domain types

**Owns:** `src/lib/types.ts`

Transcribe the spec's data model verbatim: `Condition`, `Task`, `KoiRecord`,
`Settings`, plus `Snapshot = { version: number; tasks: Task[]; koi: KoiRecord[];
settings: Settings }`.

Add one helper used everywhere: `isLive(t: Task): boolean` → `t.deletedAt ===
undefined`. Every derived read filters soft-deletes; giving that filter one name
makes its absence greppable.

**Done when:** types compile; a `types.test.ts` asserts `isLive` on a deleted and a
live task.

### S2. Scene + store port signatures

**Owns:** `src/lib/scene/types.ts`, `src/lib/persist/port.ts`

`persist/port.ts`:

```ts
export interface TaskStore {
  load(): Promise<Snapshot>;
  save(snapshot: Snapshot): Promise<void>;
}
```

`scene/types.ts` — the creature descriptor the renderer consumes:

```ts
type CreatureKind = "fish" | "bubble" | "ghost" | "koi" | "lantern" | "pearl";
type Creature = {
  id: string;            // task id, or synthetic for pearls/koi
  kind: CreatureKind;
  taskId?: string;
  label: string;
  depth: number;         // 0 = waterline, 1 = tank floor
  dashed?: boolean;      // free-text bubble / lost trigger
  locked?: boolean;      // lantern not yet affordable
  cost?: number;
  tapRadius: number;
};
type Scene = { creatures: Creature[]; clearedPct: number; pearls: number };
```

**Done when:** both files compile and export; no implementations exist yet.

---

## Wave 2 — Pure logic (parallelisable, 5 stories)

All five are pure functions over `Task[]`. No Svelte, no DOM, no storage. This wave
holds the project's actual risk and is where the test budget goes.

### S3. Trigger evaluation

**Owns:** `src/lib/triggers/evaluate.ts`, `src/lib/triggers/evaluate.test.ts`

`evaluate(tasks: Task[], now: number): string[]` — ids to release.

- `time` fires when `now >= at` on the task's local date.
- `task` fires when the referenced task is `done`; with `before`, only if that task
  completed before that clock time — otherwise permanently missed.
- `text` **never** fires here.
- Compare against absolute `now`, never accumulated deltas.
- Skip soft-deleted tasks, and ignore soft-deleted dependency targets.

**Done when:** table tests cover before/at/after the time; dependency done and not
done; `before` cutoff met and missed; a sleep from 17:00→22:00 releasing the 18:00
task; `text` never returned; deleted tasks excluded.

### S4. Condition validation at creation

**Owns:** `src/lib/triggers/validate.ts`, `src/lib/triggers/validate.test.ts`

`validateCondition(tasks, draft): { ok: true } | { ok: false; reason: "cycle" }` and
`isOrphaned(tasks, task): boolean` (target missing or soft-deleted → the bubble
degrades to manual release, dashed, labelled as having lost its trigger).

Cycles are rejected **before save**, at arbitrary depth (A→B→C→A).

**Done when:** direct and transitive cycles rejected; a valid chain accepted;
orphan detection true for deleted and missing targets.

### S5. Pearl arithmetic

**Owns:** `src/lib/store/pearls.ts`, `src/lib/store/pearls.test.ts`

```
earned = count(live tasks, status "done", no treatCost)
spent  = sum(treatCost of live tasks with treatCost and status !== "waiting")
pearls = earned − spent
```

Also `canAfford(tasks, task): boolean`. Derived only — never stored.

**Done when:** tests cover multiple claims, an unaffordable claim, a completed treat
minting no pearl, and soft-deleted tasks excluded from both sides.

### S6. Koi rule

**Owns:** `src/lib/store/koi.ts`, `src/lib/store/koi.test.ts`

`isDayCleared(tasks, date): boolean` — at least one live non-treat task on the date
and every live non-treat task `done`. Unclaimed treats never block. An unreleased
free-text bubble (`status: "waiting"`) does block.

`awardKoi(koi, tasks, date, now): KoiRecord[]` — appends once, idempotent, and never
removes an existing record.

**Done when:** tests cover awarded once; not revoked when a task is added to a
cleared past day; not blocked by an unclaimed treat; blocked by an unreleased
free-text bubble; an empty day is not cleared; deleted tasks excluded.

### S7. Scene builder

**Owns:** `src/lib/scene/build.ts`, `src/lib/scene/build.test.ts`

`buildScene(tasks, koi, date, now): Scene`. Maps tasks for one date to creatures:

| Task shape | Creature |
| --- | --- |
| condition + `waiting` | bubble (dashed if `text` or orphaned) |
| `treatCost` + `waiting` | lantern (`locked` unless affordable) |
| plain or released, `open` | fish |
| `done` | ghost |
| each pearl in balance | pearl |
| each `KoiRecord` (all dates ≤ shown) | koi |

Bubble `depth` derives from time-until-trigger: firing within the hour → ~0.2;
next week → ~0.8; free-text and undated → 1.0. Lanterns capped at 4 visible, the
remainder collapsing into one overflow lantern.

**Done when:** tests assert creature kind, count, and resting depth for each row —
never pixels. Deleted tasks produce no creature.

---

## Wave 3 — Shell (parallelisable, 3 stories)

### S8. LocalTaskStore

**Owns:** `src/lib/persist/local.ts`, `src/lib/persist/local.test.ts`,
`src/lib/persist/migrate.ts`

Implements `TaskStore` against `localStorage`, async from the start.

- Round-trips a `Snapshot`.
- Corrupt blob → copy to a timestamped backup key, then start fresh.
- Older `version` → migrate forward. Unknown future version → treat as corrupt.
- Storage full or unavailable → `save` **rejects** (the store surfaces a banner; do
  not swallow it here).

**Done when:** tests cover round-trip, migration, corrupt-blob backup, and a
rejecting quota-exceeded save. Nothing outside this file touches `localStorage`.

### S9. Task store + actions

**Owns:** `src/lib/store/tasks.ts`, `src/lib/store/settings.ts`,
`src/lib/store/tasks.test.ts`, `src/lib/ulid.ts`

Svelte stores plus reducers, reaching persistence only through `TaskStore`.

Actions: `addTask`, `editTask`, `moveToDate`, `completeTask`, `softDelete`,
`releaseBubble`, `claimTreat`, `setEnvironment`.

Rules baked in here: IDs are client-side ULIDs; **every** mutation bumps
`updatedAt`; delete sets `deletedAt` and never splices; `claimTreat` refuses when
`canAfford` is false; `completeTask` triggers `awardKoi` if the day is now cleared.

**Done when:** tests cover date rollover, moving a task between dates, ULID
uniqueness and sort order, `updatedAt` bumped by each action, and a refused claim.

### S10. Trigger ticker

**Owns:** `src/lib/store/ticker.ts`, `src/lib/store/ticker.test.ts`

Calls `evaluate(get(tasks), Date.now())` once a second and again on
`visibilitychange` → visible, moving returned ids from `waiting` to `open`.

Never accumulates deltas. Never touches free-text conditions.

**Done when:** a fake-timer test proves catch-up after a simulated sleep releases
rather than skips.

---

## Wave 4 — Canvas (mostly parallel, 4 stories)

Port the drawing code from the working prototype rather than rewriting it. `render/`
imports `scene/types` and nothing from `store/`.

### S11. Canvas host + loop

**Owns:** `src/lib/ui/Tank.svelte`, `src/lib/render/loop.ts`

One `<canvas>`, DPR-scaled, `requestAnimationFrame`, paused while the tab is hidden.
The loop reads the store with `get()` and must never trigger a re-render — that
property is why Svelte was chosen; do not swap it for a reactive subscription.

Under `prefers-reduced-motion`, freeze ambient drift while state changes (bubble
pop, fish→ghost) still play.

**Done when:** an empty tank animates its water at 60fps and pauses on tab hide.

### S12. Water, plants, caustics, palette

**Owns:** `src/lib/render/water.ts`, `src/lib/render/palette.ts`

Wavy surface, gradient, foreground planting, caustic shafts. `palette(env,
clearedPct)` interpolates loaded→calm for *Progress* and pins calm for *Calm*.
Tokens from the spec's table.

**Done when:** dragging `clearedPct` 0→1 visibly clears the water.

### S13. Creature drawing

**Owns:** `src/lib/render/creatures.ts`

One draw function per `CreatureKind`: fish (sinusoidal path, bubble trail, flips on
direction change), bubble (clean sphere; dashed variant), ghost (translucent
outline, slower), koi (gold, slow), lantern (waterline, dim vs bright), pearl
(settled among plants).

**Done when:** a hand-built `Scene` fixture renders every creature kind correctly.

### S14. Pointer hit-testing

**Owns:** `src/lib/render/pick.ts`, `src/lib/render/pick.test.ts`

`pick(scene, x, y): Creature | null` — nearest creature within its `tapRadius`.

**Done when:** unit tests cover a hit, a miss, and two overlapping creatures where
the nearer centre wins.

---

## Wave 5 — Chrome (parallelisable, 5 stories)

### S15. Date header + navigation

**Owns:** `src/lib/ui/DateHeader.svelte`

Date, prev/next arrows to any past or future date including empty ones. Mood number
and word shown only in *Progress*.

### S16. Add / edit task sheet

**Owns:** `src/lib/ui/TaskSheet.svelte`

Frosted-glass sheet over a blurred tank. Title, date, condition picker (time / task
/ free text), treat cost. Rejects cycles at save via `validateCondition` with a
readable message.

### S17. Creature tap sheet

**Owns:** `src/lib/ui/CreatureSheet.svelte`

Tap a creature → its detail sheet: complete, edit, move to another date, delete.
Tapping a **free-text bubble releases it** — the app never prompts about one.
Tapping an affordable lantern claims it.

### S18. List view

**Owns:** `src/lib/ui/ListView.svelte`

A genuine keyboard-navigable DOM list over the same store and the same actions.
Bulk edit and move-between-dates live here. First-class second view, not a fallback.

### S19. Buttons, banner, settings

**Owns:** `src/lib/ui/Controls.svelte`, `src/lib/ui/Banner.svelte`,
`src/lib/ui/Settings.svelte`

Bottom pill button (add), two corner glass buttons (menu → list view, settings).
Environment toggle. Persistent banner when `save` rejects: *changes are not being
saved on this device*.

---

## Wave 6 — Assembly (1 story, serial)

### S20. Wire it together

**Owns:** `src/routes/+page.svelte`

Compose header, tank, sheets, controls. Boot: `load()` → hydrate stores → start
ticker → start loop. Verify the tank by eye against the prototype.

**Done when:** the full v1 loop works — add a conditional task, watch it wait as a
bubble, see it release, complete it, watch the pearl drop, buy a treat, clear the
day, and find the koi still swimming when you navigate to tomorrow and back.

---

## Dependency map

```
S0
├─ S1 ──┬─ S3, S4, S5, S6 ────┐
│       ├─ S7 (needs S2)      │
│       └─ S8, S9, S10        ├─ S20
└─ S2 ──┬─ S7                 │
        ├─ S11, S12, S13, S14 │
        └─ S15…S19 (need S9) ─┘
```

Practical fan-out: **S3–S7 in parallel**, then **S8–S10 in parallel**, then
**S11–S14 alongside S15–S19**, then S20 alone.

## Invariants every story must respect

Repeated here because none of these throw, and none are caught by types.

1. Filter `deletedAt` on every derived read — scene, pearls, koi, triggers, list.
2. Evaluate triggers against absolute `now`, never tick deltas.
3. Pearls are derived, never stored. A completed treat mints no pearl.
4. Koi are awarded once and never revoked.
5. Free-text conditions never fire from `evaluate()`.
6. Bump `updatedAt` on every mutation; IDs are client-side ULIDs.
7. No creature position is ever persisted.
8. `triggers/` never imports `scene/`. `render/` never imports `store/`. `store/`
   reaches storage only through `TaskStore`.

# Progress

Story list: `docs/stories.md`. One story per loop iteration.

| Story | Status | Note |
| --- | --- | --- |
| S0 | done | Scaffold hand-written (`sv create` is interactive + dir non-empty). Svelte 5 / Kit 2 / adapter-static / Vitest 3. `sveltekit` plugin imports from `@sveltejs/kit/vite`, not `@sveltejs/vite-plugin-svelte`. `passWithNoTests: true` in `vite.config.ts` — **remove it once S1 lands a real test**. Layer dirs exist under `src/lib/{persist,store,triggers,scene,render,ui}`. Extra files beyond Owns: `static/favicon.png` (prerender 404s without it), `docs/progress.md`. |
| S1 | done | `src/lib/types.ts`: Condition/Task/KoiRecord/Settings/Snapshot per spec, plus `SCHEMA_VERSION = 1` (S8 migrates against it) and `isLive()`. `isLive` checks `deletedAt === undefined`, not truthiness — `deletedAt: 0` is a valid epoch and must still read as deleted. Every derived layer filters with `isLive`, never a hand-rolled check. Also removed S0's `passWithNoTests` from `vite.config.ts` (outside S1's Owns — see note below). |
| S2 | done | `scene/types.ts` (`CreatureKind`/`Creature`/`Scene`, depth 0=waterline→1=floor) imports nothing at all, so `render/` structurally cannot reach `store/`. `persist/port.ts` has `TaskStore` plus `StorageUnavailableError` — S8 rejects `save` with it, S19 renders the banner off it. No implementations yet, by design. **Wave 1 complete: S3–S7 may now fan out in parallel.** |
| S3 | done | `triggers/evaluate.ts` — 18 tests. Three calls the spec left open: (a) a waiting **treat never fires** — lanterns leave the waterline by being paid for, so `treatCost !== undefined` returns early; (b) the `before` cutoff resolves against the **waiting task's own date**, not the dependency's; (c) a dependency that is `done` but has **no `completedAt`** does not satisfy a `before` cutoff — it cannot be shown to have been met. Orphan handling is free: the id map is built from live tasks only, so deleted and never-existing targets both fall out as "no target". S4 owns the dashed/degraded labelling; evaluate just declines to fire. |
| S4 | done | `triggers/validate.ts` — 15 tests. `validateCondition(tasks, draft)` where `ConditionDraft = { id?, condition? }`; **S9 must call it before saving any `task` condition**, on edit as well as create. A draft with no `id` (new task) can't cycle — nothing can point back at it yet. Cycle walk carries a `seen` set: pre-existing cyclic data breaks the walk instead of hanging, and is not blamed on the draft. Chains through deleted tasks are severed, so they close no loop. `isOrphaned` covers deleted and never-existed targets; S7 reads it for the dashed treatment, S3 already declines to fire either case. |
| S5 | done | `store/pearls.ts` — `pearlBalance(tasks)` + `canAfford(tasks, task)`, 18 tests. Balance is a **running total across all dates**, not per-day (the spec formula has no date filter). Deliberately **unclamped**: a negative balance means a bug and should be visible, not floored at 0. `canAfford` answers price only — an already-claimed treat still reports `true` because its cost is in `spent`, so **S9 must also require `status === 'waiting'` before charging or a second claim double-spends**. `canAfford` is `false` for non-treats, `true` for a zero-cost treat. |
| S6 | done | `store/koi.ts` — `isDayCleared` + `awardKoi`, 19 tests. Both treat rules and the free-text rule fall out of "every live non-treat task on the date is done" — no special cases. **Order matters in `awardKoi`: the already-recorded check runs before the cleared check**, which is what makes "never revoked" hold; reversing them silently drops the koi the moment a task is added to a cleared past day. Empty day (and a day whose tasks are all deleted) is not cleared. Pure and non-mutating — S9 calls it on `completeTask` and stores the returned array. |
| S7 | done | `scene/build.ts` — `buildScene(tasks, koi, date, now)`, 44 tests, plus exported `MAX_VISIBLE_LANTERNS`. Depth: ≤1h (and overdue) → 0.2, ≥7d → 0.8, linear between; no clock → floor. A `task` condition counts as clocked **only when it carries a `before` cutoff** — otherwise it waits on an event, not a time, so it sits on the floor. Overdue bubbles float at 0.2 rather than sinking. `clearedPct` excludes treats, matching the koi rule. Balance is computed **once** per call and passed down (runs every frame) — that is why lanterns compare `balance < cost` inline instead of calling `canAfford`. Scene imports `store/pearls` and `triggers/validate`, which the layer order permits; only triggers→scene and render→store are forbidden. **Wave 2 complete: S8–S10 unblocked.** |
| S8 | done | `persist/local.ts` + `persist/migrate.ts`, 18 tests. Key `fish-tank-todo/snapshot`, backups at `<key>.corrupt.<ts>`. **`localStorage` and `now` are constructor-injected** (`new LocalTaskStore(storage?, now?)`) so failure paths test without a browser — no jsdom needed; storage may be `undefined` entirely (private mode), in which case `load` returns empty and `save` rejects. Migration runs steps N→N+1 in order; **a missing `version` field is version 0**, a future version is quarantined, never guessed. Shape check is structural only (`tasks`/`koi`/`settings`), not per-field, so a future build's extra task fields survive. `emptySnapshot()` defaults environment to **`progress`** — S19's toggle should treat Calm as the opt-in. Backup write is best-effort: if it throws, the app still opens. |
| S9 | done | `store/tasks.ts` (pure reducers + `createTaskStore` facade), `store/settings.ts`, `lib/ulid.ts` — 33 tests. All eight actions plus `release(ids)` for S10's batches. Every mutation funnels through one private `mutate()` that stamps `updatedAt` — that is what stops a future action forgetting it. **`claimTreat` guards on `status === 'waiting'` first, affordability second** (S5's warning: the cost is already in `spent`, so a balance check alone lets a second claim through once the balance recovers) — refusals are `cycle` / `unaffordable` / `claimed`. **`commit()` publishes to memory before persisting**, so a rejected save costs the banner, not the user's edit; `saveFailed` is the store S19 renders off. ULID is monotonic within a millisecond via carry-increment, so ids stay sortable under bulk adds. |
| S10 | done | `store/ticker.ts` — `createTicker(store, { now?, intervalMs?, wakeTarget? })` with `start`/`stop`/`tick`, 12 tests under fake timers. Takes a narrow `TickerStore` (`{ tasks, release }`) rather than the whole facade, so it tests against a 10-line fake; the real `createTaskStore` satisfies it structurally. **A tick with nothing due writes nothing** — persisting every second would churn storage for no gain, and the canvas reads state directly rather than waiting on a save. `wakeTarget` defaults to `document` and is `undefined` server-side/in node, so `start()` is safe anywhere. **S20 must call `stop()` on teardown** or the interval and the listener both leak. **Wave 3 complete: S11–S19 unblocked.** |
| S11 | done | `render/loop.ts` (15 tests) + `ui/Tank.svelte`. `loop.ts` imports nothing at all — rAF, cancel, hidden, reduced-motion and wake target are all injected, so the hidden/resume/reduced-motion/throwing-draw paths test in node. **Frame `dt` is clamped to 100ms**: a tab hidden for an hour otherwise resumes with `dt = 3_600_000` and teleports every creature. A throwing `draw` is logged and the loop continues rather than dying for the session. **`Tank.svelte` takes `draw` as a prop** (defaulting to a flat gradient) because S12/S13 don't exist yet — S20 composes the real painters in; the prop is also what keeps the loop calling `get()` instead of subscribing. DPR handled by sizing the backing store and `setTransform(dpr,…)` so drawing stays in CSS pixels. **Not yet verified by eye — Tank is not mounted anywhere until S20.** |
| S12 | done | `render/palette.ts` (14 tests) + `render/water.ts`. `palette(env, clearedPct)` interpolates LOADED→CALM for Progress and pins CALM for Calm; creature colours are fixed across both. Also exports `moodPercent`/`moodWord` — **S15 reads these for the Progress header**. `render/` now imports **nothing outside itself**: `Environment` is redeclared locally rather than imported from `../types`, so invariant 8 holds structurally, not by convention. `water.ts` exports `drawWater`/`drawSurface`/`drawCaustics`/`drawPlants` plus `drawTank` (back-to-front composite). Plant variation comes from a **deterministic hash of the blade index**, not stored randomness, so no position is ever persisted and the tank looks the same each load. Caustics use `globalCompositeOperation = 'lighter'`. **Water/plants/caustics are unverified by eye — nothing mounts them until S20.** |
| S13 | done | `render/creatures.ts` — all six kinds + `drawCreatures` (sorted back-to-front, caller array not mutated), 25 tests against a recording fake ctx. **`place(creature, size, time, animate)` is exported and is the single source of position — S14's `pick()` MUST call it rather than deriving coordinates itself, or hit-testing drifts away from what was drawn.** Position seeds come from a hash of the creature id, so a reload puts every creature back in the same lane and nothing is persisted. `animate: false` freezes drift while draw calls continue, satisfying the reduced-motion rule. Ghost = outlined fish at 0.28 alpha; dashed bubble = `setLineDash`; locked lantern = 0.45 alpha with no glow. **Art unverified by eye until S20 mounts it.** |
| S14 | done | `render/pick.ts` — 11 tests. **Signature deviates from the story**: `pick(creatures, point, size, time, animate?)`, not `pick(scene, x, y)` — positions come from `place()`, which needs `size`/`time`, and S17 must pass the same values the loop drew with. Ties go to the creature drawn on top (`STACKING` mirrors `drawCreatures`), so array order never decides a hit. A sweep test asserts every hit lies within the radius of where the renderer actually put it — that is the property protecting against pick/draw drift. **Wave 4 complete: S15–S19 (chrome) unblocked.** |
| S15 | done | `ui/DateHeader.svelte` — 20 tests. **Date helpers live in the component's `<script module>` and are importable: `import { shiftDate, formatDay, today, parseDate, toDateString } from './DateHeader.svelte'`. S16/S17/S18/S20 must reuse these, not reimplement date maths.** Arithmetic goes through the `Date` calendar constructor, never `+86400000` — tests cover both 2026 DST boundaries, leap day, and month/year rollover, all of which a millisecond implementation gets wrong silently. Props: `{ date, environment, clearedPct, onNavigate }`; navigation is unbounded, including onto empty dates. Mood line renders only under Progress. |
| S16 | done | `ui/TaskSheet.svelte` — 24 tests over the exported `emptyForm`/`formFor`/`toDraft`/`formError`/`describeRefusal`, all round-tripping task → form → draft. **A task is either a treat or conditional, never both** — one `kind` radio covers plain/time/task/text/treat, so the two mechanics cannot fight over one creature. Cycle feedback is live while picking a dependency (`$derived` over `validateCondition`), not just on save; the dependency list excludes the task being edited. Empty `before` is omitted rather than stored as `''`. Props: `{ open, date, tasks, task?, onSave, onClose }` where `onSave` returns the store's `Outcome` so refusals surface as sentences — `describeRefusal` never says "cycle" to the user. |
| S17 | done | `ui/CreatureSheet.svelte` — 24 tests over exported `tapAction`/`actionsFor`/`describeCondition`. **`tapAction(task, affordable)` is the routing rule S20 must call on every pick**: free-text bubble → `release` immediately (never prompt), affordable lantern → `claim` immediately, everything else → `sheet`. An **unaffordable** lantern opens the sheet rather than doing nothing, so the price is visible; a **claimed** treat also opens the sheet, so a second tap cannot re-claim it. A timed bubble opens the sheet — letting it out early is a decision, not a stray tap. Delete is two-step, and a `$effect` disarms it when the sheet moves to another creature (otherwise tap-B lands on tap-A's armed "Really delete"). Uses S15's `shiftDate`/`formatDay`. |
| S18 | done | `ui/ListView.svelte` — 15 tests over exported `groupTasks`/`describeSelection`. Four groups (Swimming / Waiting / Guilty pleasures / Done), empty ones omitted; a **claimed** treat files under Swimming and a completed one under Done, matching the tank rather than the data shape. Filters `deletedAt` and the date, like every derived read. Creation ties break on id so row order never wobbles between renders; Done sorts most-recent-first. Real DOM: `ul`/`li`, real `button`s and checkboxes, visible focus rings — this is the only view a keyboard or screen reader can use, since the canvas offers them nothing. Bulk select drives move ±1 day and delete; a `$effect` clears the selection when the date changes, or bulk-move would act on tasks the user can no longer see. |
| S19 | done | `ui/Controls.svelte` (pill + two glass corner buttons; pearl count rides the pill — the tank has nowhere else to put a number), `ui/Banner.svelte` (`{ visible }`, wire to S9's `saveFailed`; **not dismissible** — the condition outlives the acknowledgement, and the app looking normal while running from memory is exactly the trap), `ui/Settings.svelte` (7 tests; exports `ENVIRONMENT_CHOICES`/`blurbFor`, Progress listed first to match `emptySnapshot()`'s default). Tests assert what the setting actually *does* via `palette()`, not just that labels exist. **Wave 5 complete: only S20 remains.** |
| S20 | done (code) — **visual verification outstanding** | `src/routes/+page.svelte`. Boot: `hydrate()` → `ticker.start()`, with `onMount` returning `ticker.stop()` (S10's leak). `draw` reads `store.snapshot()` (a `get()`) — **never `$tasks`** — so the 60fps loop triggers no re-render; the chrome uses `$`-subscriptions separately. Picking reuses `lastFrame.time/size/animate` captured in `draw`, so hit-testing answers against the frame actually painted rather than the wall clock. Every pick routes through S17's `tapAction`. Creatures with no `taskId` (pearls, overflow lantern) are ignored. A11y: the pointer wrapper carries a documented `svelte-ignore` — no ARIA role would be honest for a canvas, and ListView is the real keyboard route. **Verified: build, typecheck, 336 tests, dev server HTTP 200, `+page.svelte` compiles. NOT verified: the tank by eye — Chrome extension not connected. The S11/S12/S13 visual caveats therefore still stand.** |

## Blocked

_none_

## Art pass (post-S20, user-requested)

Reworked `render/palette.ts`, `render/creatures.ts`, `render/water.ts` for vibrance and
fish variety; `+page.svelte` now also calls `drawForeground` after the creatures.

- **Six species** (`clown`/`tang`/`angel`/`guppy`/`neon`/`betta`) as data specs — body
  gradient, fin colour, tail style, pattern, fin-flow — driving **one** drawer, so a
  seventh species is a table entry, not another function. `speciesFor(id)` is a hash of
  the creature id: **the same task is the same fish on every reload**, which is what
  lets you recognise it without reading the label.
- Per-fish detail: dorsal/anal/pectoral fins, four tail shapes, clipped patterns
  (bands/stripe/spots), belly-light gradient, gill arc, and an eye with a catchlight.
- Palette gained `waterMid`, `plantsDeep`, `sand`, `rock`, and `light` (0–1). CALM is
  markedly more saturated; LOADED keeps the same hues drained towards slate, so the
  Progress shift still reads as the water clouding rather than a different tank.
- Tank gained a three-stop column, sand bed with grain and stones, two planting layers
  (hazed back, saturated front), god rays plus a rippling caustic net, drifting motes,
  a bright meniscus, and depth haze + vignette drawn over the creatures.
- Spec tokens `fish`/`lantern`/`pearl` unchanged. All scenery variation is
  `noise(i)`/`hash(id)`, so nothing random and nothing persisted.
- **Verified: 340 tests, clean typecheck and build, `render/` still imports nothing
  outside itself. NOT verified by eye — Chrome extension still not connected.**

## E2E suite — `npm run e2e` (`scripts/e2e.mjs`)

50 checks driven through the real UI (Playwright), covering every v1 mechanic: all five
task kinds, ULID ids, pearl arithmetic, claim/affordability refusals, the ticker
(timed release, dependency release, free-text never firing), cycle rejection with a
jargon-free message, koi award and non-revocation, date navigation and moving tasks,
list bulk move/soft-delete, both environments, reload persistence, the storage-failure
banner (via a thrown `localStorage.setItem`), and tank tap-to-complete. Run the dev
server first. **Two real bugs it caught immediately:**

- **The edit sheet opened *behind* the list view.** Nothing set `z-index`, so DOM order
  decided and `ListView` (declared last) covered the sheets — Edit from the list was
  completely unusable. There is now an explicit ladder: list 10, sheets 20/21,
  banner 30.
- **The corner glass buttons sat on top of the date arrows.** Menu/settings are fixed
  at `1rem` and 2.6rem wide, directly over the header arrows, so they swallowed the
  clicks and the date could not be changed. Header is now inset `4.25rem`.

## Three visibility bugs (reported from use, reproduced in Playwright)

1. **Pearls were invisible.** They rested on the sand, where the add-pill and the
   planting both sit — balance said 3, you could see one. Now lifted to
   `PEARL_LIFT = 96` above the floor, nestled in the plant tops. A test sweeps 40
   pearls and asserts none lands in the bottom 80px.
2. **Finishing the day emptied the tank.** My earlier ghost→koi merge deleted the
   day's ghosts the moment it cleared, so the reward for finishing was watching your
   work vanish. **Reverted.** The spec's "ghosts merge into one koi" is already
   satisfied by ghosts being date-scoped: on every *later* date you see the koi and
   none of that day's ghosts, without deleting anything on the day itself.
3. **A claimed treat turned into an ordinary fish**, so buying a guilty pleasure
   looked like it deleted it. `Creature.claimed` is now set by `buildScene`, and the
   renderer draws a claimed treat as the exotic fish at 0.72 scale — recognisably the
   thing you bought, now swimming in the shoal.

Ghosts also went from 0.4 alpha hairline to 0.62 with a 0.16 body wash: at the old
value completing a task looked like deleting it.

## Treat-completion bug (found from a user screenshot)

**An unclaimed treat could be marked Done, skipping payment.** `actionsFor` pushed
`complete` for any non-done task, so both the tank sheet and the list offered "Done"
on a waiting treat. That path calls `completeTask`, never `claimTreat` — so the
affordability guard never ran, while `pearlBalance` still counted the price as spent
(status left `waiting`). Result: a treat taken for free *and* a balance that could go
negative. This is what made pearls appear stuck: the reporter's "Do homework" was a
treat, and its price was being deducted.

Fixes:
- `actionsFor` no longer offers `complete` for an unclaimed treat — claim it first.
- **ListView now offers `Claim`** (and "Need N more" when short). It previously had no
  way to buy a treat at all, so keyboard users could not use the mechanic — which
  broke the promise that the list is a first-class second view of the same actions.
  It now renders straight from `actionsFor`, so the two views cannot drift.
- `describeCondition` returns null for done tasks; finished items were showing
  "Waiting until 15:00" under a struck-through title.

`onClaim` added to ListView's props and wired in `+page.svelte`.

## Swim model + treat fish

**Treats are exotic fish, not lanterns.** Creature kind renamed `lantern` → `treat`
throughout (`scene/types`, `scene/build`, `render/pick`, `render/creatures`, tests;
`MAX_VISIBLE_LANTERNS` → `MAX_VISIBLE_TREATS`). Affordable = iridescent
magenta/gold/violet, sail fins with clipped rays, veil tail, halo, sparkles; locked =
same fish muted to violet-grey at 0.62 alpha, no halo, no sparkles — *not yet*, not
dead. Cruises below the waterline, clear of the shoal. `palette.lantern` keeps its
name: it is a spec colour token.

**Swim model** in `place()`:

- **Warped clock, not a warped path.** `warp = t + sin(0.37t)·0.9 + sin(0.13t)·1.6`,
  then the usual sinusoid is traversed against `warp`. Pace swings ~0.46×–1.54×
  (burst and glide). **`warp` must stay monotonic** — its derivative bottoms out near
  0.46; push the coefficients up and it goes negative, and fish twitch backwards
  mid-stroke. Because it is monotonic, `flip` is still just `cos(swim) < 0`.
- **Vertical wander** on a different frequency from the horizontal sweep, giving a
  lazy Lissajous loop instead of a rail. **Bubbles are exempt** — their depth encodes
  time-until-trigger, so wandering it would be lying to the user.
- **Per-fish lane centre** as well as amplitude and pace: sweeping everything about
  the tank's midpoint made them all cross the centre together and bunch.

Tests pin: vertical travel, pace variation (fastest stretch > 3× slowest), two fish
taking different paths, bubbles holding depth, facing both ways, and a 400-sample
in-bounds sweep per kind (the wander has room to push a fish through the glass at
some phase — three spot-checks would not have caught it).

## Second art pass — with actual eyes on it

Added `playwright` (dev) + `npm run screenshot` (`scripts/screenshot.mjs`): seeds a
realistic tank into localStorage, screenshots at 420×860 @2x. **Use this before
touching anything visual** — the first art pass was done blind and shipped four bugs
that a single screenshot would have caught immediately.

What the screenshots found:

- **Fins and tails were larger than the bodies** and detached (`flow` 1.7–2.0 as a
  multiplier of body length). `flow` is now a *fraction* (0.26–0.45), tails root on a
  short vertical edge rather than a single point, and fin rays were added.
- **Every fish sat on one line.** `(seed >> 7)` discarded exactly the low bits that
  differ between sibling ids like `t-aaa`/`t-bbb`.
- **Only two species ever appeared.** `hash % 6` with a constant id stride of 993
  (`993 % 6 == 3`) alternates between two values. Both now route through `mix32()`, an
  avalanche mixer — **never use raw `hash % n` or `hash >> k` on sequential ids here.**
- Bubble trail drew off the nose instead of behind the tail.
- Surface band filled from y=0, so raising the waterline to 128 turned the whole top
  of the screen into a milky slab; it is now a 26px lip above the wave.
- Lanterns read as tin cans → bellied paper silhouette, curved ribs, finial, inner glow.
- Pearls piled behind the add-pill → spread along the bed and lifted clear.
- Plants were uniform spikes → broad leaves at ~4–8px, heights cut to 7–18% of tank.

Haze/vignette/motes/caustics were all dialled back (they stacked into grey murk).

## Lantern placement fix (post-art-pass)

Two real bugs in where treats sat, both invisible to the type system:

- **Lanterns were drawn behind the date header.** `y = TOP_MARGIN * 0.6` ≈ 17px, so the
  body spanned y≈1–33 — under the chrome and clipped by the canvas top.
- **All lanterns crowded the left third.** `laneX(seed, size, creature.depth)` with the
  lantern's `depth: 0` hit `Math.max(spread, 0.4)`, pinning x to `[0.1w, 0.42w]`.

Fixes: `water.ts` now exports **`WATERLINE = 128`** and `surfaceOffset(x, time)`, and
`creatures.ts` imports both — the lanterns float on the *same* line the surface draws
and bob with it, rather than hovering at a fixed height over a moving wave. Swimmers'
`TOP_MARGIN` is now `WATERLINE + 26`, so nothing swims above the surface. Lantern x
uses golden-ratio spacing (`spreadX`), which spreads four or five hashes evenly where
`hash % w` clumps.

Five tests pin it: on the waterline, clear of the header, spread across the width,
bobbing over time, swimmers below the line. **128 clears a ~70px desktop header
comfortably; on a notched phone (`safe-area-inset-top` ≈ 47px) the header is ~97px and
the clearance is only a few pixels — if it collides there, raise `WATERLINE`.**

## Ownership deviations

- **S1 edited `vite.config.ts`** (S0's file) to remove `passWithNoTests: true`, the
  debt S0's own handoff note queued for S1. Judged safe rather than blocking: S0 is
  `done`, the loop is sequential, so no other agent held that file. Had a wave-mate
  been running against it, this would have been a `blocked` instead.

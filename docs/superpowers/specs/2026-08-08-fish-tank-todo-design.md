# Fish Tank To-Do — Design

**Date:** 2026-08-08
**Status:** Approved, ready for implementation planning

## What this is

A personal to-do webapp where the entire interface is an aquarium. Every task is a
creature in the tank. There is no list, no rows, no checkboxes on the main screen.

Two mechanics extend the ordinary to-do model:

- **If–then tasks.** A task can carry a condition — a clock time, another task
  finishing, or a sentence you judge yourself. Until the condition is met the task
  is not yet a task; it waits in a bubble.
- **Guilty pleasures.** Finishing a task drops a pearl. Treats are priced in pearls
  and float on the waterline as lanterns until you can pay for one.

Local-first: no backend, no accounts, no sync. Data lives in browser storage.

## Visual reference

The design follows the aquarium app shown in `fish_tank_idea.mp4`, analysed at the
start of this project:

- Full-bleed tank, no list chrome. Only a date header, prev/next day arrows, a
  bottom pill button, and two corner glass buttons.
- An animated wavy water surface under the status bar gives the tank a real top edge.
- Water palette shifts with state: bright cyan and lush plants when calm, desaturated
  slate-blue and faded plants when loaded.
- Fish drift on loose paths, emit bubble trails, and flip on direction change.
- Resolved items are translucent outline fish; live items are solid and vivid.
- Detail views are frosted-glass sheets sliding up over a blurred tank.

Palette taken from the reference frames:

| Token | Value | Use |
| --- | --- | --- |
| calm water | `#7FD4E8` → `#4FC3D9` | clear-state gradient |
| loaded water | `#5A7A85` → `#3E5560` | murky-state gradient |
| fish | `#E8543C` | live task |
| plants | `#6FBF73` | foreground planting |
| lantern | `#FFC46B` | guilty-pleasure treat |
| pearl | `#EAF6F8` | earned currency |
| glass | white 15% + blur | sheets and buttons |

## Decisions

| Area | Decision |
| --- | --- |
| Environment | Two, chosen by the user: **Progress** (murky at the start of the day, clearing as you finish, with a mood number) and **Calm** (one fixed bright palette, no number) |
| Conditions | Clock-time and task-completion triggers fire automatically; free-text conditions are released by hand |
| Free-text look | Dashed bubble outline instead of a clean sphere; tap to release; the app never prompts |
| Waiting task | Fish sealed inside a bubble, visible the whole time, nudging the wall. Bubble pops on release |
| Treats | Lanterns resting on the waterline, bought with pearls |
| Pearls | One per completed task |
| On complete | Fish drains to a translucent ghost and keeps swimming |
| Golden koi | Clearing every task on a day merges that day's ghosts into one permanent golden koi, visible on every date thereafter |
| Dates | One tank showing one date; navigate freely to past and future dates; tasks can be moved between dates |

Two decisions carry reasoning worth keeping.

**Depth encodes imminence.** The chosen bubble treatment has one known weakness: a
tank full of bubbles is cluttered. The fix is to give each waiting bubble a resting
depth derived from time-until-trigger. A task firing within the hour floats at eye
level; one firing next week rests down in the plants; free-text and undated bubbles
sit on the floor. Bubbles drift upward as their moment approaches. Twenty waiting
tasks stay readable because nineteen of them are stacked out of the swim area.

**Koi are never revoked.** A koi is awarded once, at the moment a day first reaches
all-done, and recorded against that date. Adding a task to an already-cleared past
day does not take the koi back. The koi is a record of what happened, not a
recomputed status. It is also the only thing in the app that accumulates across days.

A day counts as cleared when it has at least one non-treat task and every non-treat
task on it is `done`. Unclaimed treats never block a koi — a treat you chose not to
buy is not unfinished work. A free-text bubble you never released does block it,
because that is genuinely still open.

## Architecture

Four layers with a single direction of dependency. Nothing below reaches upward.

```
persist/    TaskStore port + LocalTaskStore   the only layer that knows where data lives
store/      tasks, settings, koi records      Svelte stores + reducers
triggers/   pure: (tasks, now) -> ids to release
scene/      tasks -> creature descriptors (fish, bubbles, ghosts, koi, lanterns, pearls)
render/     creature descriptors -> canvas pixels
ui/         Svelte: date header, sheets, list view, buttons
```

`triggers/` never imports `scene/`. `render/` never imports `store/`. `store/` talks to
persistence only through the `TaskStore` port, never to `localStorage` directly. The
tank is a projection of the task data and never a source of it. No creature position
is ever persisted.

**Stack:** TypeScript, SvelteKit with `adapter-static` and SSR disabled, Svelte 5 for
chrome only, a single `<canvas>` for the tank, `localStorage` behind a storage port,
Vitest for the pure layers.

v1 ships as a static local-first site — Kit's server half stays switched off:

```ts
// src/routes/+layout.ts
export const ssr = false;        // data is localStorage-only; SSR would paint an empty tank
export const prerender = true;
```

### Why SvelteKit

Svelte earns its place on the merits: its stores are readable outside components with
`get()`, which is exactly what the canvas loop needs — it reads the task list every
frame and must never trigger a re-render. In React that requires reaching for a store
library specifically to escape the framework; in Svelte it is the ordinary way to
read state. Fine-grained reactivity also means nothing diffs while the tank animates,
and scoped styles come built in.

Kit itself is not needed by v1 — there are no routes, no server, and SSR is actively
wrong for `localStorage`-only data. It is chosen for the roadmap: sync and
authentication are expected, and Kit keeps both paths open from the same repository.
Renting a backend (Supabase for auth, Postgres, and realtime) works from a static
site and needs nothing from Kit. Owning one later means `+server.ts` endpoints beside
the existing UI, session handling in `hooks.server.ts`, and an adapter swap — no
migration, no second service, no CORS. The cost today is one config file.

### Why this shape

The pure layers hold the risk, and this shape lets them be tested without pixels.
Trigger evaluation is a function over `(tasks, now)`. Scene building is a function
from tasks to creature descriptors. Both are checkable in plain assertions. The art
can be rewritten end to end without touching task logic, and sixty bubbles cost
nothing to draw.

The cost is hit-testing: canvas gives none, so pointer picking is hand-rolled
against a tap radius on each creature. See *Reaching tasks without a mouse*.

### Alternatives considered

**B — Each creature is a DOM or SVG element.** Every task becomes an absolutely
positioned SVG node animated with CSS transforms.

*Pros:* clicks, focus, and screen-reader access work with no extra code; every
creature is inspectable in devtools; no hit-testing to write; CSS transitions handle
easing for free.

*Cons:* forty simultaneously animated SVG nodes with filters stutter badly on mobile.
The water gradient, caustic light shafts, and the bubble burst all want per-pixel
drawing, so they end up on a canvas regardless — leaving two rendering systems to
keep in sync, which is worse than either alone. Rejected on performance and on the
duplicate-renderer risk.

**C — A simulation loop owns the state.** One game loop holds tasks and creatures
together in a single world object, persisted on a tick.

*Pros:* one place to reason about everything; physics and data can interact directly;
no reconciliation step between store and scene.

*Cons:* task data becomes entangled with animation state, so a change to how fish
swim can corrupt the to-do list. Persisting a live simulation means saving noisy,
constantly-changing data. Testing task logic requires standing up the whole world.
Rejected: the wrong trade for a tool the user depends on for real work.

### Framework alternatives considered

**React + Vite + Zustand.** *Pros:* the most familiar option; the largest ecosystem
for sheets and gesture handling.
*Cons:* a state library is needed purely so the canvas loop can read tasks without
re-rendering — work that Svelte stores do natively. Larger bundle, and a virtual DOM
running beside a render loop that ignores it. Rejected as more machinery for the
same result.

**Svelte 5 on plain Vite, no Kit.** *Pros:* the smallest possible build; no routing or
SSR to configure away for an app that is one screen.
*Cons:* adding a backend later means standing up a separate service and wiring CORS,
rather than adding a file to the existing repository. Rejected because sync and
authentication are on the roadmap; if they were not, this would be the right choice.

## Data model

```ts
type Condition =
  | { kind: "time"; at: string }                          // "18:00", local
  | { kind: "task"; taskId: string; before?: string }      // optional "17:00" cutoff
  | { kind: "text"; text: string };                        // manual release

type Task = {
  id: string;                // ULID, generated client-side
  title: string;
  date: string;              // "2026-08-08", local calendar date
  condition?: Condition;     // absent = plain task, born as a fish
  treatCost?: number;        // present = guilty pleasure, priced in pearls
  status: "waiting" | "open" | "done";
  createdAt: number;
  completedAt?: number;
  updatedAt: number;         // bumped on every mutation
  deletedAt?: number;        // soft delete; rows are never spliced out
};

type KoiRecord = { date: string; earnedAt: number };

type Settings = { environment: "progress" | "calm" };
```

One task type covers all three kinds of thing in the tank. A bubble is a task with a
condition and `status: "waiting"`. A lantern is a task with `treatCost` and
`status: "waiting"`. A ghost is a task with `status: "done"`. There are no parallel
type hierarchies to keep in step.

A treat counts as **claimed** once its status has left `"waiting"` — claiming is the
act of paying for it, which moves the lantern into the water as a fish.

Pearls are derived rather than stored:

```
earned = count(tasks where status === "done" and treatCost is absent)
spent  = sum(treatCost of tasks where treatCost is present and status !== "waiting")
pearls = earned − spent
```

Treats do not themselves earn pearls when completed — a reward you have already paid
for should not also pay you. Only ordinary and conditional tasks mint pearls.

A derived balance cannot drift out of sync with the tasks it came from.

### Worked examples

The two motivating cases from the original request:

```ts
// "if 6pm, I will do this"
{ title: "Call mum", date: "2026-08-08",
  condition: { kind: "time", at: "18:00" }, status: "waiting" }

// "if I finish work early, I do this"
{ title: "Go for a run", date: "2026-08-08",
  condition: { kind: "task", taskId: "<ship-pr>", before: "17:00" },
  status: "waiting" }

// a guilty pleasure
{ title: "2h gaming", date: "2026-08-08",
  treatCost: 5, status: "waiting" }
```

## Designed for sync later

Sync and authentication are not in v1, but four decisions are made now because they
are the ones that are expensive to retrofit once real data exists on more than one
device. Each is a few lines today.

**ULID identifiers, generated on the client.** Sortable by creation time and globally
unique without coordination. Per-device counters would collide the moment a second
device appeared.

**`updatedAt` on every mutation.** Two devices editing the same task can only be
reconciled if each edit is timestamped. Adding the field later would stamp every
existing task with the same instant, making the first reconciliation arbitrary.

**Soft deletes via `deletedAt`.** Tasks are never removed from the array. Without a
tombstone, a device that has not yet synced re-pushes a task the user deleted
elsewhere, and deleted tasks come back permanently. This is the single most painful
thing to add after the fact.

Because deletion is soft, **every derived read filters `deletedAt` first** — the tank
scene, the pearl balance, the koi rule, the trigger evaluator, and the list view. A
deleted task is invisible to all of them. This is stated once here and assumed
everywhere else in this document, including the pearl formula above.

**A storage port.** Persistence sits behind one interface:

```ts
interface TaskStore {
  load(): Promise<Snapshot>;
  save(snapshot: Snapshot): Promise<void>;
}
```

v1 ships `LocalTaskStore`. A future `RemoteTaskStore` and a `SyncingTaskStore` that
wraps both implement the same interface. Nothing above `persist/` ever learns which
one it is talking to. The interface is async from the start so that swapping in a
network-backed implementation is not a signature change.

`Snapshot` carries a schema version so that stored data can be migrated forward on
load rather than discarded.

A note on scope: adding authentication changes the threat model completely. Today the
data never leaves the machine and there is nothing to attack. Once there is a login,
the project owns credential storage, session lifetime, and per-user authorization on
every read and write. That is a deliberate project in its own right, not a v1.1
addition, and this design only commits to not blocking it.

## Triggers

A single pure function, called once a second and again on every wake:

```ts
evaluate(tasks: Task[], now: number): string[]   // ids to release
```

Rules:

- `time` fires when `now >= at` on the task's date.
- `task` fires when the referenced task is `done`; if `before` is set, it fires only
  if that task completed before that time, and is permanently missed otherwise.
- `text` never fires from evaluation. It is released only by tapping its bubble.

Evaluation compares against absolute `now`, never accumulated tick deltas. A machine
asleep from 17:00 to 22:00 therefore releases the 18:00 task on wake rather than
silently skipping it.

Two structural failures are prevented at creation time rather than handled at
evaluation time:

- A `task` condition whose target has been deleted degrades to manual release. The
  bubble switches to the dashed treatment and is labelled as having lost its trigger.
- Cycles (A waits on B, B waits on A) are rejected before the task is saved.

## The tank

### Creature lifecycle

```
conditional  ->  bubble   --trigger-->  fish  --complete-->  ghost   -> pearl
plain        ->  fish                         --complete-->  ghost   -> pearl
treat        ->  lantern  --pay pearls-->  amber fish  --complete-->  ghost
day cleared  ->  that day's ghosts merge into one golden koi (permanent)
```

### Composition

- **Bubbles** rest at a depth set by time-until-trigger and rise as it approaches.
  Auto-triggered bubbles are clean spheres; free-text bubbles are dashed.
- **Fish** swim the open water on loose sinusoidal paths with bubble trails.
- **Ghosts** are translucent outlines, drifting slower than live fish.
- **Pearls** settle among the plants on the tank floor.
- **Lanterns** sit on the waterline, dim while locked and bright once affordable.
  Visible lanterns are capped at four; the remainder collapse into a single
  overflow lantern.
- **Koi** swim slowly through every date's tank, gold and unmistakable.

### Environments

*Progress* interpolates the water gradient and planting between the loaded and calm
palettes on percent-done-today, and shows the mood number and word. *Calm* holds the
clear palette permanently and hides the number. Both render the same scene; only the
palette function and the number's visibility differ.

### Rendering

A single `<canvas>`, scaled for device pixel ratio, driven by `requestAnimationFrame`
and paused while the tab is hidden. Under `prefers-reduced-motion` the ambient drift
freezes while state changes (a bubble popping, a fish ghosting) still play, so no
information is lost to the reduced-motion path.

## Reaching tasks without a mouse

A canvas offers no hit-testing and nothing to a screen reader. Two mechanisms cover
this:

1. Each creature descriptor carries a tap radius. Pointer events pick the nearest
   creature within its radius.
2. A **List view**, reachable from the menu button, mirrors the tank as a genuine
   keyboard-navigable DOM list backed by the same store and the same actions. It is
   also the comfortable place to bulk-edit and to move tasks between dates.

The list view is not a fallback for a broken tank; it is a first-class second view of
the same data.

## Dates

The tank shows exactly one date at a time. The header arrows move to any past or
future date, including dates with no tasks yet, so tasks can be planned ahead. A task
can be moved to a different date from either the tank sheet or the list view — this is
how an unfinished task is pushed to tomorrow.

Dates are local calendar dates and times are local clock times throughout. A task set
for 18:00 means 18:00 where the user is.

## Failure handling

- **Storage unavailable or full.** `LocalTaskStore.save` rejects; the app continues to
  run from memory and shows a persistent banner stating that changes are not being
  saved on this device.
- **Corrupt saved data.** The unreadable blob is copied to a timestamped backup key
  before the app starts fresh, so nothing is destroyed without a copy remaining.
- **Snapshot from an older schema version.** Migrated forward on load. An unknown
  future version is treated as corrupt rather than guessed at.
- **Clock jumps and sleep.** Handled by absolute-time evaluation, described above.
- **Orphaned and cyclic conditions.** Handled at creation, described above.

## Testing

Vitest covers the pure layers, which is where the risk sits:

- Condition evaluation as a table: before, at, and after the trigger time; the
  dependency done and not done; the `before` cutoff met and missed.
- Missed-trigger catch-up after a simulated sleep.
- Cycle rejection at creation.
- Orphaned-condition degradation to manual.
- Pearl arithmetic across multiple claims, including an attempted claim that cannot
  be afforded, and confirming a completed treat mints no pearl.
- Koi awarded exactly once for a cleared day, not revoked when a task is later
  added to that day, not blocked by an unclaimed treat, and blocked by an
  unreleased free-text bubble.
- Date rollover and moving a task between dates.
- Soft-deleted tasks are excluded from the scene, the pearl balance, the koi rule,
  and trigger evaluation.
- `LocalTaskStore` round-trips a snapshot, migrates an older schema version forward,
  and rejects rather than corrupts when storage is unavailable.

Scene building is tested as `tasks -> creature descriptors`, asserting creature kind,
count, and resting depth. No pixel output is asserted. The rendered tank is verified
by eye.

## Out of scope for v1

Accounts, sync between devices, push notifications, recurring tasks, sound, and
native apps.

Sync and authentication are expected later and the design does not block them — see
*Designed for sync later* — but v1 ships no server, no login, and no network calls.
The rest are genuinely out: none is needed for a single-user local tool, and each
pulls in infrastructure this design deliberately avoids.

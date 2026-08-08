# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

**Pre-implementation.** The repository currently contains the design spec and nothing
else — no `package.json`, no `src/`, no toolchain. The spec is approved and is the
source of truth:

`docs/superpowers/specs/2026-08-08-fish-tank-todo-design.md`

Read it before writing code. Everything below is a summary of the decisions in it that
are easy to violate by accident; the spec has the reasoning.

`fish_tank_idea.mp4` is the visual reference the design is based on. Its analysis and
extracted palette are recorded in the spec, so the video does not need re-watching.

## Scaffolding

Not yet run. When it is:

```bash
npx sv create .          # SvelteKit, TypeScript, Vitest
```

Then set `adapter-static`, and in `src/routes/+layout.ts`:

```ts
export const ssr = false;      // data is localStorage-only
export const prerender = true;
```

SSR is not merely unused — it is wrong here. Store reads touch `localStorage`, and
server rendering would paint an empty tank before hydration.

## What this is

A personal to-do webapp whose entire interface is an aquarium. Every task is a
creature. There is no list on the main screen. Two mechanics beyond ordinary to-dos:

- **If–then tasks** wait inside a bubble until their condition is met.
- **Guilty pleasures** are treats priced in pearls, floating on the waterline as
  lanterns. Finishing a task drops a pearl.

Local-first: no backend, no accounts, no network calls in v1.

## Architecture

Six layers, one direction of dependency. Nothing below reaches up.

```
persist/    TaskStore port + LocalTaskStore   the only layer that knows where data lives
store/      tasks, settings, koi records      Svelte stores + reducers
triggers/   pure: (tasks, now) -> ids to release
scene/      tasks -> creature descriptors
render/     creature descriptors -> canvas pixels
ui/         Svelte components: date header, sheets, list view, buttons
```

Enforced rules:

- `triggers/` never imports `scene/`.
- `render/` never imports `store/`.
- `store/` reaches persistence only through the `TaskStore` interface, never
  `localStorage` directly.
- No creature position is ever persisted. The tank is a projection of task data and
  never a source of it.

Svelte handles chrome only. The tank is one `<canvas>` whose loop reads the store with
`get()` and never triggers a re-render — that property is why Svelte was chosen over
React, so do not replace store reads with reactive subscriptions inside the loop.

## Invariants that break quietly

These are the mistakes that will not throw, and will not be caught by types.

**Filter soft-deletes on every derived read.** Tasks carry `deletedAt` and are never
spliced from the array. The scene, the pearl balance, the koi rule, the trigger
evaluator, and the list view must each skip deleted tasks. Missing the filter in one
of five places produces a ghost task haunting a pearl count.

**Evaluate triggers against absolute `now`, never accumulated tick deltas.** A machine
asleep from 17:00 to 22:00 must release the 18:00 task on wake, not skip it.

**Pearls are derived, never stored.** `earned − spent`, recomputed. Completing a treat
mints no pearl — a reward already paid for should not also pay out.

**Koi are awarded once and never revoked.** A day clears when it has at least one
non-treat task and every non-treat task is `done`. Unclaimed treats never block a koi;
an unreleased free-text bubble does. Adding a task to an already-cleared past day does
not take the koi back — the koi records what happened, it is not a recomputed status.

**Free-text conditions never fire from `evaluate()`.** They are released only by tapping
the bubble, and the app never prompts about them.

**Bump `updatedAt` on every mutation**, and generate IDs as client-side ULIDs. Both
exist for a sync feature that does not exist yet; they are cheap now and expensive to
retrofit once real data lives on two devices.

## Testing

Vitest over the pure layers, which hold the risk. Scene building is tested as
`tasks -> creature descriptors`, asserting creature kind, count, and resting depth —
never pixel output. The rendered tank is verified by eye.

The spec's Testing section lists the required cases, including the ones that exist
purely to protect the invariants above.

## Prototypes

Two published artifacts, both self-contained HTML with no build step:

- Pending-task variants (comparison, superseded by the decision): `/artifact/d584a606-bd0c-4ab2-9a0c-f5bfdcd93e53`
- Working prototype, all v1 mechanics: `/artifact/ce25bc2d-302e-4d1c-8ae9-4dd969d4e4d3`

The working prototype implements `evaluate(tasks, now)` and the layer split as
specced, and is the visual and behavioural target. Its canvas drawing code (fish,
bubble, koi, lantern, plants, caustics) is worth porting rather than rewriting.

Both live in the session scratchpad, not this repository.

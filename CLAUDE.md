# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

**Built and merged.** v1 ships all the mechanics; the fish rendering was then rewritten
on top of it. The tree is a working SvelteKit app with 441 unit tests and a 57-check
end-to-end suite.

Two specs, both still the source of truth for *why*:

- `docs/superpowers/specs/2026-08-08-fish-tank-todo-design.md` — the app.
- `docs/superpowers/specs/2026-08-08-fish-anatomy-design.md` — how creatures are drawn.

Where the code and those specs disagree, the code won and the reason is recorded in
`docs/pending.md`. Two known divergences: treats are exotic **fish**, not lanterns
on the waterline; and a cleared day's ghosts are not deleted — they merge into the koi
implicitly, because ghosts only ever render on their own date.

**`docs/pending.md` is the live list of open items. Read it before picking up work.**
It tags each item **measured**, **looked at**, or **structural**, because visual claims
reasoned about rather than viewed have been wrong here more than once.
`docs/follow-ups.md` is the historical record of the v1.1 pass — useful for why
something closed, not for what is open.

`fish_tank_idea.mp4` is the visual reference. Its analysis and extracted palette are
recorded in the app spec, so the video does not need re-watching.

## Commands

```bash
npm run dev          # dev server on :5173 (scripts assume :5199 — see below)
npm test             # 441 unit tests (vitest) over the pure layers
npm run check        # svelte-check; must report 0 errors
npm run build        # static build via adapter-static
npm run screenshot   # PNG of the tank        (needs a dev server running)
npm run e2e          # 57 checks via Playwright (needs a dev server running)

npx vitest run src/lib/render/spine.test.ts     # one file
npx vitest run -t 'roots every fin on the body' # one test, by name
```

Both scripts expect a server on port 5199: `npx vite dev --port 5199 &`.

**Anything visual must be looked at, not reasoned about.** Art passes done blind have
shipped: a milky slab across the top of the tank, fins larger than the bodies they hung
off, six species that rendered as two, and fins joined to the body at a single point so
they read as gold needles. Every one would have been caught by a single screenshot.

The method that works: copy a scratch script into `scripts/` (Playwright must resolve
from the repo — a script run from `/tmp` cannot import it), seed `localStorage` with the
case you want, and screenshot with a **`clip` region at `deviceScaleFactor` 4–8**. A
full-tank shot is too small to judge a 40px fish, and fin-level defects only separate at
8×. Do not crop with `sips -c` afterwards: it crops from the centre and ignores
`--cropOffset`, which silently returns the wrong region.

## What this is

A personal to-do webapp whose entire interface is an aquarium. Every task is a
creature. There is no list on the main screen. Two mechanics beyond ordinary to-dos:

- **If–then tasks** wait inside a bubble until their condition is met.
- **Guilty pleasures** are treats priced in pearls — exotic fish cruising below the
  waterline, dim until you can afford them. Finishing a task drops a pearl.

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

`render/` is four modules, split so the testable half is not buried in drawing code:

```
render/rng.ts        hash + mix32          deterministic per-id randomness
render/spine.ts      pure geometry         centreline with a travelling wave, profile -> outline
render/species.ts    data only             per-species profiles, fins, palettes
render/creatures.ts  drawing + placement   consumes the three above
render/water.ts      tank, light, planting, air bubbles
render/palette.ts    every colour in the app
render/pick.ts       pointer hit-testing
render/loop.ts       requestAnimationFrame driver
```

`species.ts` holds 13 entries: 9 `SWIMMERS` (ordinary tasks), 3 `TREATS` (guilty
pleasures, picked by `treatSpeciesFor`), and the `koi`. A body is a `Profile` —
`[t, halfWidth][]` — offset along ±normal, so **every body is symmetric top-to-bottom**;
asymmetric species are not expressible without splitting that type.

All fins share one construction in `traceFin`. `FIN_SHAPE` varies only base length,
belly and waist; `finStyle: 'veil'` is a shorter base and fuller belly, not a separate
code path. Two couplings that are easy to break:

- **Caudals root on the axis** (`rootY = 0`), not on the body edge. They are drawn as
  two mirrored lobes, so basing them off-axis leaves a notch of water at the peduncle
  and the tail reads as two spikes.
- **`FIN_FORWARD_REACH` is derived from `FIN_SHAPE`**, and `speciesReach` uses it to
  keep fins inside the glass. Changing fin geometry without it lets fins clip the tank
  edge — this was a literal in two places and they drifted.

Enforced rules:

- `triggers/` never imports `scene/`.
- `render/` imports **nothing** outside itself, not even `../types`. Only
  `scene/types` (the creature descriptors) and its own siblings. A renderer whose
  whole vocabulary is `Creature` cannot couple pixels to task data by accident.
- `store/` reaches persistence only through the `TaskStore` interface, never
  `localStorage` directly.
- No creature position is ever persisted. The tank is a projection of task data and
  never a source of it.
- All per-creature variation comes from `hash(id)`, never `Math.random()` — the same
  task is the same fish on every reload.
- **Never `hash % n` or `hash >> k` on ids.** Sibling ids differ only in low bits, so
  both collapse to a couple of buckets; this shipped twice, once making six species
  render as two, once putting every fish on one line. Always mix through `mix32`.
- `place()` decides where a creature is; `pick()` shares it, so changing it moves
  taps as well as pixels. The drawing layer may inset from it, but must not redefine
  it.

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

**Every creature kind needs an upper bound.** Pearls (a running balance across all
dates) and koi (one per cleared day, visible forever) each grew without limit: measured
at 60 days of ordinary use, the tank held 399 creatures. `MAX_VISIBLE_PEARLS` and
`MAX_VISIBLE_KOI` cap what is *drawn* — `scene.pearls` stays exact and the pill shows
it, and no koi record is ever removed. A test replays that 60-day simulation and holds
the whole tank under a ceiling, so a third unbounded kind fails a test rather than
being noticed in a screenshot two months in.

**Nothing may allocate per frame inside the draw path.** `drawCreatures` runs in a
`requestAnimationFrame` loop; gradients are cached per context (`bodyGradient`,
`finGradient`) because they depend only on the species or the fin. A test asserts 30
frames cost no more gradients than one.

**Pearls are currency, so the balance is global, not per-date.** Saving across days for
a treat is the guilty-pleasure mechanic. Only the drawn count is date-independent —
do not "fix" this by scoping the balance to the viewed day.

## Testing

Vitest over the pure layers, which hold the risk. Scene building is tested as
`tasks -> creature descriptors`, asserting creature kind, count, and resting depth —
never pixel output. The rendered tank is verified by eye.

The spec's Testing section lists the required cases, including the ones that exist
purely to protect the invariants above.

Drawing is tested through `fakeCtx()` in `creatures.test.ts`, which records canvas
calls instead of painting — including the alpha and fill colour in force at each paint,
since `globalAlpha` is one mutable slot and a nested draw that *assigns* rather than
multiplies is only visible as a paint at the wrong alpha.

**Assert the property, not a proxy for it.** A test that counted `clip` calls and
expected zero was standing in for "this species draws no markings"; it broke the moment
fin rays started clipping, while the property it meant still held. Prefer asking
whether the marking colour was ever painted. When a test fails because of a change
like that, re-aim it — do not relax the number.

**Validate a strengthened test by mutation.** Break the thing on purpose and confirm
the test fails: freeze the spine, restore an alpha bug, anchor a dorsal at 0.01. A test
that cannot fail is worse than no test, because it reads as coverage.

## Prototypes

Two published artifacts, both self-contained HTML with no build step:

- Pending-task variants (comparison, superseded by the decision): `/artifact/d584a606-bd0c-4ab2-9a0c-f5bfdcd93e53`
- Working prototype, all v1 mechanics: `/artifact/ce25bc2d-302e-4d1c-8ae9-4dd969d4e4d3`

The working prototype implements `evaluate(tasks, now)` and the layer split as
specced, and is the visual and behavioural target. Its canvas drawing code (fish,
bubble, koi, lantern, plants, caustics) is worth porting rather than rewriting.

Both live in the session scratchpad, not this repository.

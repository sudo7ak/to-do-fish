# Legend sheet — design

2026-08-09

A permanent reference naming each creature kind, reachable forever from Settings and
shown once on a first visit.

## Why

The app's chrome is not the hard part. Someone landing on the tank can find the add
pill without help. What they cannot do is decode the vocabulary: a bubble is a task
waiting on a condition, a dim exotic fish is a treat they cannot yet afford, a koi is
a day they cleared, a pearl is what finishing something drops.

A coach-mark tour teaches buttons, which are the easy part, and has nothing to point
at on a first run — the tank starts empty. A reference has neither problem, and solves
one a tour cannot: three weeks later, when the user has forgotten what a dim fish
means, the reference is still there.

This is the smallest thing that teaches the metaphor. It is deliberately not a tour,
not a spotlight, and not a seeded demo tank. If discovery turns out to be the real
problem, a guided first task and just-in-time hints build on this rather than
replacing it.

## Scope

Seven entries — every `CreatureKind`, plus the one variant split that matters:

| Entry | Blurb |
| --- | --- |
| Fish | An open task. |
| Bubble | A task waiting for its condition. |
| Ghost | A task you finished today. |
| Treat (dim) | A reward you cannot afford yet. |
| Treat | Affordable — tap it to claim. |
| Koi | A day you cleared completely. |
| Pearl | Dropped by finishing a task. Treats are priced in these. |

The chest, the water colour in Progress mode, and the mood number are **out of
scope**. They are not creatures and would need a second visual treatment in the same
sheet.

## Approach

`ui/Legend.svelte`, a sibling sheet to `Settings.svelte`, using the same
`backdrop + .sheet` construction. `+page.svelte` owns `legendOpen` exactly as it owns
`settingsOpen`.

Two approaches were rejected:

- **A second panel inside `Settings.svelte`.** Fewer files, but it gives that
  component a second responsibility and forces its existing tests to care which panel
  is showing.
- **A `/legend` route.** Wrong shape. `ssr = false` and `prerender = true`, so a route
  is a second prerendered page that flashes an empty tank on the way in. Sheets are
  the established idiom.

## Entry point

A row at the foot of the Settings sheet: **"What am I looking at?"**.

Not a third corner button. `docs/pending.md` §5.2 records that the date header is inset
`4.25rem` to clear corner buttons fixed at `1rem` and `2.6rem` wide — three constants
across two files, agreeing by convention and enforced by nothing. Widening the right
cluster re-introduces the swallowed-arrow bug the E2E suite caught. The extra tap is
cheaper than that risk, and auto-open on first visit carries the discovery burden
anyway.

## Data

One new setting:

```ts
export type Settings = { environment: 'progress' | 'calm'; seenLegend: boolean };
```

`SCHEMA_VERSION` goes 1 → 2, with a `1 -> 2` step in `persist/migrate.ts`.

**The migration defaults `seenLegend: true`, not `false`.** A stored snapshot means
someone has already used the app; auto-opening a "what am I looking at" sheet at them
is noise. A fresh install has no snapshot to migrate, so it takes the `false` default
from the initial settings and gets the legend. That asymmetry is the entire purpose of
the flag and is commented as such at the migration step, because the obvious reading —
"new field, default false" — is the wrong one here.

### Four places spell out a default `Settings`, and they must not agree

The literal `{ environment: 'progress' }` appears in four places, and adding a field
means each one takes a side:

| Site | `seenLegend` | Why |
| --- | --- | --- |
| `persist/local.ts` — the empty snapshot | `false` | Nothing stored. A fresh install. |
| `store/tasks.ts:164` — empty snapshot | `false` | Same. |
| `store/tasks.ts:168` — initial store value | `false` | Same. |
| `persist/migrate.ts` — v0 fallback | `true` | Data exists, so the app has been used. |
| `persist/migrate.ts` — the new 1 → 2 step | `true` | Same. |

This is the invariant most likely to break quietly: every one of these compiles either
way, and getting one wrong shows up only as the legend appearing at a returning user
or never appearing for a new one. The migration tests pin the `true` side; a test that
an empty store starts with `seenLegend: false` pins the other.

Auto-open is a one-way latch. The flag is written to `true` the moment the legend is
shown, not when it is closed, so a reload mid-view does not show it again. The write
goes through the store like any other mutation and therefore through the existing
`Banner` save-failure path; the worst case of a failed write is the legend appearing
a second time.

`shouldAutoOpen(settings)` is a pure function so the rule is tested directly rather
than through the component.

## Entries as data

Following the `ENVIRONMENT_CHOICES` precedent, the entry list is plain exported data
in `<script module>` with its own test, and the component stays thin.

```ts
export type LegendEntry = {
	/** Stable row id: 'fish' | 'bubble' | 'ghost' | 'treat-locked' | 'treat' | 'koi' | 'pearl'. */
	id: string;
	title: string;
	blurb: string;
	/** Synthetic descriptor, handed to the real drawCreature. */
	creature: Creature;
};
```

The synthetic creatures carry **fixed literal ids**. Every visual property downstream
derives from `hash(id)` — species, size, phase — so a fixed id is what makes the
legend fish the same fish on every open, every reload, and every screenshot.

A consequence worth stating rather than discovering: the swimmer row shows one
deterministic species out of the nine. Showing all nine would turn a legend into a
catalogue. The blurb carries the meaning; the species does not.

## Rendering

Each row holds a small `<canvas>`, roughly 64×48 CSS px, backed at
`devicePixelRatio`, and marked `aria-hidden` — the row's text is the accessible
content.

On open, for each entry: construct a `Placement` centred in that canvas and call

```ts
const at: Placement = {
	x: width / 2,
	y: height / 2,
	flip: false,
	pitch: 0,
	// A legend fish is not going anywhere. `effort` is a multiple of the creature's
	// own average pace, so 1 is a fish holding station, not a fish frozen — 0 would
	// straighten the body wave out of existence and draw a stick.
	effort: 1,
	turn: 0
};

drawCreature(ctx, entry.creature, at, colors, LEGEND_TIME);
```

`drawCreature` already takes an explicit `Placement`, so `place()` is bypassed
entirely. That matters: `place()` is the single owner of where a creature is, shared
with `pick()`, and the legend must not become a third definition of it. Bypassing it
is not a workaround — it is why the seam exists.

`LEGEND_TIME` is a fixed constant, making each frame deterministic and therefore
comparable across screenshots.

One static frame, no `requestAnimationFrame`. Animated legend fish would be prettier
and would sell the metaphor, but they mean a second animation driver alongside
`render/loop.ts` and seven canvases running over a blurred tank on a phone — real cost
for a reference sheet.

The palette is whichever `Environment` is currently set, so the legend art matches the
tank the user is actually looking at.

### Two consequences to record

**`ui/` becomes a second consumer of `drawCreature`.** `Tank.svelte` was the only one.
The dependency direction is unchanged and legal — `ui/` may import from `render/`, and
`render/` still imports nothing outside itself — but a future change to
`drawCreature`'s signature now has two callers, and nothing but this note says so.

**Legend creatures draw at full brightness.** `drawDepth`'s wash is a function of tank
height and there is no tank here, so depth cannot be reproduced. A pearl in the legend
is brighter than a pearl on the sand. That is correct for a reference — the point is
to see the thing clearly — but it is a known mismatch, not an oversight.

## Testing

**`Legend.test.ts`** — over the entry list, not pixels:

- Seven entries, ids unique.
- Every `CreatureKind` in the union has an entry. A new kind added without one fails
  this test rather than being noticed later.
- Both treat states present, one `locked`, one not.
- Every entry has a non-empty title and blurb.

**Migration** — a v1 snapshot migrates to `seenLegend: true`; a v0 snapshot reaches v2
through both steps; a v2 snapshot round-trips unchanged.

**`shouldAutoOpen`** — true only when `seenLegend` is false.

**E2E** — open Settings, tap the row, seven rows appear, close returns to the tank.
Separately: a fresh `localStorage` auto-opens the legend once, and a reload does not
re-open it.

**By eye** — a screenshot of the sheet at `deviceScaleFactor` 4–8, per `CLAUDE.md`.
Seven canvases at 64px is exactly the scale at which fin defects have hidden before.
This gets looked at, not reasoned about.

## Out of scope

No tour, no spotlight, no pointing at live fish in the tank, no seeded demo tank. No
entry for the chest, the water colour, or the mood number. No animation.

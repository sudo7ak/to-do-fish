# Fish Anatomy — Design

**Date:** 2026-08-08
**Status:** Approved, ready for implementation planning
**Supersedes:** the fish drawing described in `2026-08-08-fish-tank-todo-design.md` §The tank

## What this is

A rewrite of how creatures are drawn, so the six species read as distinct fish rather
than one silhouette in six paint jobs.

Today every species shares the same almond body bezier; only colour and pattern
differ. At 4× magnification a clownfish and an angelfish are the same shape. Fins are
pale featureless lobes, patterns sit on the body like decals rather than wrapping it,
there is no mouth, and the eye is a white dot.

## The size constraint drives everything

Fish stay at their current size — roughly 32–44px long on a phone. That is a
deliberate decision, and it rules things out honestly:

**Will not read at 40px:** scale texture, iridescent sheen, fine speckling, subtle
gradients within a fin.

**Does read at 40px:** silhouette, colour blocking, the eye, and motion.

So the work goes into shape, palette, eyes and movement. Anything that depends on
per-pixel texture is out of scope, not because it is hard but because it would be
invisible.

## Decisions

| Area | Decision |
| --- | --- |
| Style | Naturalistic — each species gets its real silhouette and markings |
| Size | Unchanged (~32–44px) |
| Motion | Body flexes: a travelling wave down the spine, fins lagging behind it |
| Model | Spine + profile (see below) |
| Scope | Replaces the drawing for fish, ghosts, koi and treats — one code path, four data sets |

## Architecture

One new concept, in `render/creatures.ts`.

A **spine** is an array of points along the fish's centreline, computed fresh each
frame from position, heading and a phase. A travelling sine wave runs nose to tail:

```
spineFor(species, time, seed) -> Point[]
```

Every part of the fish is drawn *relative to the spine* rather than to a fixed origin.
Because fins anchor to spine positions, they inherit the body's bend for free, and the
caudal fin is simply the last segment — a tail beat falls out of the wave rather than
being animated separately.

A **profile** is a per-species table of `(t, halfHeight)` control points, `t` running
0 at the nose to 1 at the tail. The body outline is the spine offset by ±profile. This
makes the silhouette *data*: a new species is a table, not a function.

`SPECIES` therefore grows from styling data into a shape description:

```ts
type SpeciesSpec = {
  profile: [number, number][];   // (t, halfHeight ÷ length)
  fins: FinSpec[];
  palette: { back, belly, fin, marking };
  pattern: 'bands' | 'stripe' | 'spots' | 'none';
  wave: { amplitude, wavelength, speed };
};
```

`drawFish` becomes: build spine → build outline from profile → fill → pattern clipped
to the outline → fins at their anchors → head → trail.

Constraints unchanged: `render/` imports nothing outside itself, all variation derives
from `hash(id)`, no positions are persisted.

## Species

Silhouettes are chosen to be distinguishable in outline alone, which is what survives
at 40px.

| Species | Silhouette | Depth ÷ length |
| --- | --- | --- |
| Neon tetra | slim torpedo, small forked tail | 0.35 |
| Guppy | small slim body, fan tail larger than the body | 0.45 |
| Clownfish | rounded oval, blunt snout, round tail | 0.58 |
| Betta | compact body, enormous trailing veils | 0.60 |
| Blue tang | deep disc, pointed snout, thin peduncle, crescent tail | 0.78 |
| Angelfish | taller than long; dorsal and anal fins form a diamond, trailing pelvic filaments | 1.15 |

The spread from 0.35 to 1.15 is the point. A tang and a neon differ by shape, not
just colour, so they stay distinct when squinting or at a distance.

## Fins

Each fin is data:

```ts
type FinSpec = {
  anchor: number;    // spine fraction, 0 = nose, 1 = tail
  kind: 'dorsal' | 'anal' | 'pectoral' | 'pelvic' | 'caudal';
  span: number;      // length ÷ body length
  sweep: number;     // how far it rakes backward
  lag: number;       // phase offset in radians, behind the body wave
};
```

Drawn at the spine point for its `anchor`, rotated to the local tangent. `lag` is a phase offset in radians (not frames — frame rate varies), and makes
fins trail the body wave — the difference between "alive" and "a rigid shape
wobbling". Angelfish filaments and betta veils are ordinary fins with a long `span`
and a large `lag`; they need no special case.

## Head

- **Eye**: iris colour, pupil, catchlight, and a dark lid arc, sized off body depth at
  `t = 0.12`. Eyes read at any size and do more for life than anything else on the
  head.
- **Mouth**: a small notch at the nose that opens slightly on the swim cycle.

## Reuse

The spine model replaces bespoke drawing elsewhere rather than sitting beside it:

- **Ghosts** — same spine and profile, stroked rather than filled. A finished task
  drifts as an outline of its own species, still bending.
- **Koi** — becomes a species profile (long body, barbels, veil tail, slow wave)
  instead of hand-written code.
- **Treats** — an exotic profile with oversized sails. The claimed version is the same
  profile at 0.72 scale, as now.
- **Bubbles** — the sealed fish is the same call at small scale.

Four drawing functions collapse into one. That is worth doing independently of how it
looks.

## Draw order

Rear fins (caudal, trailing veils) → body fill → pattern clipped to the outline →
near pectoral → head → bubble trail. Rear fins first so they sit behind the body; the
near-side pectoral last so it overlaps it.

## Edge cases

- **Reduced motion.** The clock freezes, so the phase holds at a per-id constant and
  each fish sits in a natural mid-bend. Snapping to a straight line would read as a
  rendering fault.
- **Degenerate sizes.** Profiles are clamped so a very small tank cannot produce an
  inverted or self-intersecting outline.
- **Performance.** Eight spine points across a dozen fish is trivial per frame. No
  offscreen caching, because the body changes shape every frame and caching would
  forbid exactly the motion this design is for.

## Testing

Vitest over the pure parts:

- The spine keeps constant segment length — it bends, it does not stretch.
- The wave travels nose to tail, not the reverse.
- `spineFor` is deterministic for an id, and frozen when `animate` is false.
- Every fin anchors within the body outline for every species.
- Every species draws something and leaves the canvas context balanced.
- Profiles are positive along their whole length (no inverted outline).

Appearance is verified by eye from a 4× crop, as with the pearls — a full-tank
screenshot is too small to judge a 40px fish.

## Out of scope

Scale texture, iridescence, per-fin gradients, 3D banking or turning, schooling
behaviour, and any change to fish size or to the swim path (`place()` is untouched —
this design changes how a fish is *drawn*, not where it goes).

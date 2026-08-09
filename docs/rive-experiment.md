# Rive vs. the procedural renderer

Branch: `rive-comparison`. **Uncommitted by request.** Delete the branch when the
question is settled — this is an experiment, not a feature.

## The question

Does a hand-authored skeletal fish beat the code-drawn one **at the size the tank
actually draws fish** (30–86px, clown 42px)? Everything else about the library
trade-off follows from that answer, so it is worth a couple of hours to settle rather
than argue about.

## What is here

`/rive-compare` — a route that renders the procedural clown and tang beside a slot for
the Rive fish, at 1× and 4×. It is not linked from the tank and imports the render
layer read-only.

```bash
npx vite dev --port 5199 &
open http://localhost:5199/rive-compare
node scripts/_rive-shot.mjs out.png   # scratch capture script
```

The page works right now with the Rive slot empty, so the procedural side is already
measurable. `@rive-app/canvas@2.39.2` is installed and wired up.

## What needs a human

**I cannot author the `.riv`.** Rive is a GUI editor; there is no CLI or programmatic
path to produce one, and the runtime only plays them. This is the whole of the manual
step:

1. Author one fish in [rive.app](https://rive.app).
2. Export as `.riv` into `static/rive-fish.riv`.
3. Reload `/rive-compare`.

For the comparison to be fair, the authored fish should:

- fill roughly **42px** of a 120×90 artboard — the clown's real length, not a display
  size chosen to flatter it
- **swim in place with the body flexing.** A rigid sprite sliding sideways is the thing
  the procedural renderer was rewritten to stop doing; comparing against one would
  prove nothing
- sit on a transparent background — the page paints the tank's own water behind both,
  since contrast against the real background is half of whether a fish reads

## What is already measured

Gzipped, which is what the wire carries:

| | gzipped |
| --- | --- |
| Whole current app, all JS | **52 kB** |
| Rive runtime JS | 95 kB |
| Rive wasm | **743 kB** |

Adopting Rive is roughly a **16× increase** in what a local-first, offline app downloads
before it can draw anything — before a single `.riv` of artwork. That is the strongest
argument against, and it did not need the artwork to establish.

## How to judge

Look at the **1× row only**. The 4× row is for working out *why* one wins, never for
deciding which does — the anatomy spec already ruled scale texture, iridescence, and
within-fin gradients out of scope because they do not survive 40px, and a zoomed
comparison re-admits exactly the detail that gets thrown away.

Ask, in order:

1. **At 1×, is the Rive fish clearly better?** Not "more detailed" — *better*, at that
   size, against that water. If it is a draw, the size cost decides it and the answer is
   no.
2. **What would per-id variation become?** The current invariant is that every fish
   derives from `hash(id)`, so the same task is the same fish forever. Authored assets
   give N fixed fish plus tinting and skin selection — a much narrower axis. Decide
   whether that loss is acceptable *before* being persuaded by one good-looking fish.
3. **Who authors the other twelve?** One fish is the experiment. Thirteen species,
   each with ghost and claimed variants, is the project. If there is no artist, the
   honest comparison is "one Rive fish" against "thirteen working procedural ones".

## If the answer is no

Delete the branch and record the result in `docs/pending.md` §2 so the question is not
reopened from scratch. The colour-library idea is unaffected and is the better fit for
what is actually still broken there — the puffer's muddy palette and the angel washing
out against the koi are perceptual-colour problems, not rendering-primitive problems.

# Fish Realism Implementation Plan

**Goal:** Make the tank's creatures read as living animals rather than illustrations,
without losing the identity the app encodes in them.

**Target:** *Realistic* — not the reference video's look. `fish_tank_idea.mp4` reads calm
and painterly because it is muted, low-contrast and outline-free; that is a style, not
realism. Real tropical fish are vivid, so **species colour stays** and the tank remains
readable as a to-do list. What goes is the illustration grammar: drawn outlines, a
mascot eye, and uniform crispness at every depth.

**Architecture:** No new dependencies and no rendering-technology change. The Rive
experiment settled that (see `docs/rive-experiment.md`): 743 kB of wasm against a 52 kB
app, to buy detail that does not survive 40px. Everything here is canvas 2D inside the
existing `render/` layer.

## Global Constraints

- `render/` imports nothing outside itself — only `scene/types` and its own siblings.
- All per-creature variation derives from `hash(id)` through `mix32`. Never
  `hash % n`, never `hash >> k`, never `Math.random()`.
- Nothing allocates per frame inside the draw path. Gradients cache per context.
- No creature position is persisted. The tank is a projection of task data.
- 441 unit tests, 0 svelte-check errors, 57/57 E2E, clean build at the end of every
  phase. Tests that break get **re-aimed at the property they meant**, never relaxed.
- **Every phase is verified by looking**, at 1× and 4×, before the next one starts.
  Scratch capture scripts live in `scripts/` (Playwright cannot resolve from `/tmp`)
  and are deleted before committing.

## Why motion leads

At 30–86px, motion carries realism and detail does not. One measured finding sets the
order: `swimPosition` **already** warps the clock into burst-and-glide (derivative
swings ~0.46×–1.54×), but `spineFor` takes a **constant** per-species wave. Nothing
connects them, so a fish coasting slowly beats its tail exactly as hard as one bursting.
Fixing that coupling is the highest-value change in this plan and needs no new
machinery.

---

## Phase 0: Clear the decks

**Files:** `package.json`, `src/routes/rive-compare/`, `docs/pending.md`

- [ ] Remove `@rive-app/canvas` and delete `src/routes/rive-compare/`.
- [ ] Keep `docs/rive-experiment.md` — the size measurements are the evidence for not
      revisiting this.
- [ ] Record in `docs/pending.md` §2: the library question is answered, and *why*
      (style and motion, not rendering primitive), so it is not reopened from scratch.
- [ ] Branch `fish-realism` off `main`. Leave `rive-comparison` in place; deleting a
      branch is the user's call.

**Done when:** `npm run build` is clean with no Rive in the dependency tree.

---

## Phase 1: Motion

The phase that decides whether the rest is needed.

### 1.1 Couple tail beat to speed

**Files:** `src/lib/render/spine.ts`, `src/lib/render/creatures.ts`

`swimPosition` knows the instantaneous speed; `spineFor` does not. Thread it through so
wave amplitude (and mildly, frequency) scale with it: the body **straightens as it
glides and deepens as it bursts**.

- [ ] Derive normalised speed from the existing warp derivative rather than
      recomputing a second time-warp that would drift from the first — the same
      mistake `pitch` avoided by sampling the real path twice.
- [ ] Scale amplitude from roughly 0.35× at a glide to 1.4× at a burst, starting
      values, tuned by eye.
- [ ] Test: at a low speed sample the spine is measurably straighter than at a high
      one, for the same species and phase.

### 1.2 Bend into turns

**Files:** `src/lib/render/spine.ts`, `src/lib/render/creatures.ts`

Today the body carries a symmetric travelling ripple regardless of where the path goes.
A real fish turning left is *bent* left for the duration of the turn.

- [ ] Sample path curvature the way `pitch` already samples heading — from the path
      actually travelled, at two or three instants.
- [ ] Add a sustained bend term on top of the travelling wave, signed by turn
      direction.
- [ ] Test: a creature on a turning stretch has a spine whose net lateral offset is
      signed and non-zero, not merely oscillating about zero.

### 1.3 Pectorals scull

**Files:** `src/lib/render/species.ts`, `src/lib/render/creatures.ts`

Pectoral fins currently ride the body wave with a phase lag. Real ones beat on their own
tempo, most visibly when a fish is holding station.

- [ ] Give `FinSpec` an optional independent beat for `kind: 'pectoral'`.
- [ ] Beat harder as speed drops — the opposite of the body wave.

**Verify Phase 1:** capture the same fish across ~2 s at 4×; the body must visibly
straighten on the glide and deepen on the burst. **Risk:** a deeper bend sweeps a wider
envelope, so `speciesReach` will fight this. Remember `reach·cos θ + vertical·sin θ`
peaks *mid-range*, not at the maximum angle — lowering a clamp has made clipping worse
here before.

---

## Phase 2: Light and depth

### 2.1 Delete the body outline

**Files:** `src/lib/render/creatures.ts`

The drawn rim is the strongest illustration cue. Real silhouettes are value edges.

- [ ] Remove the body stroke; if edges go mushy against similar-valued water, recover
      separation with a slightly darker edge *in the body gradient*, not a line.
- [ ] Ghosts keep their stroke — that is what makes an unfilled ghost legible, and it
      is a deliberate state distinction, not decoration.

### 2.2 Depth attenuation

**Files:** `src/lib/render/creatures.ts`, `src/lib/render/palette.ts`

A creature at `depth` 0.9 currently renders exactly as crisply as one at 0.1.

- [ ] Fade contrast and blend toward the water colour with depth.
- [ ] Keep enough separation that a distant fish is still identifiable — this is the
      one change on the list that trades against readability, so tune it conservatively.

### 2.3 Eye

**Files:** `src/lib/render/creatures.ts`

Keep a defined eye — real fish eyes *are* prominent — but drop the mascot scale:
smaller, less sclera, a subtler catchlight.

**Verify Phase 2:** a busy tank at 1×. Every species still identifiable; no fish reads
as a sticker laid on the water.

---

## Phase 3: Fins

**Correction to earlier advice in this session:** softening fins was aimed at matching
the video. For realism the ray structure is *right* — real fins are rayed membranes. The
morning's fin work mostly stands.

- [ ] Increase translucency so water shows through the membrane, keeping the rays.
- [ ] Keep the root-to-tip opacity ramp; that is already the realistic behaviour.

---

## Phase 4: Behaviour (contingent)

Only if the tank still reads artificial after 1–3.

- [ ] Fish currently pass through each other. Add separation so they avoid rather than
      intersect.
- [ ] Possibly light steering — a wander target rather than a fixed sinusoid.

Deliberately last: it is the largest build, and if Phase 1 lands it may be unnecessary.

---

## Verification (every phase)

```bash
npx vitest run                    # 441+, all green
npm run check                     # 0 errors
npm run e2e                       # 57/57 (needs a server on :5199)
npm run build
npx vite dev --port 5199 &        # then capture at 1x and 4x
```

Judge at **1×** — that is what ships. The 4× crop is for diagnosing *why* something is
wrong, never for deciding whether it is.

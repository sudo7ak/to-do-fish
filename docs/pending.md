# Pending

Open work as of 2026-08-09. Everything here is **not done**; items are struck from
this file when they land rather than marked DONE, so the file stays short enough to
be read.

`docs/follow-ups.md` is the historical record of the v1.1 pass, including everything
that was closed. This file supersedes its open items — where the two disagree, this
one is current.

State at the time of writing: 456 unit tests, 57/57 E2E checks, 0 typecheck errors,
clean build.

Each item says whether it was **measured**, **looked at**, or **structural**, because
the ones reasoned about rather than looked at are the ones that have been wrong before.

---

## 1. Crowding — fixed 2026-08-09

**Was measured** at 60 days of steady use (6 tasks a day, all completed, a 3-pearl
treat each week): **399 creatures — 333 pearls, 60 koi, 6 ghosts.** Pearls and koi
were the only kinds with no upper bound, and ghosts, the intuitive culprit, were 1.5%
of it.

Now `MAX_VISIBLE_PEARLS = 9` and `MAX_VISIBLE_KOI = 3` cap what is drawn, and a test
holds the whole tank under a ceiling on that same 60-day simulation.

Three rulings worth keeping, since they are not obvious from the code:

- **Pearls stay a global running balance, not date-scoped.** Saving across days for a
  5-pearl treat *is* the guilty-pleasure mechanic; a per-date balance would break it.
  The caps change only what is drawn — `scene.pearls` is still exact, and the pill
  still shows it.
- **No overflow pearl**, unlike the overflow lantern. That one earns its place by
  opening the list when tapped; tapping a pearl does nothing, so an overflow pearl
  would only be a creature that misstates the count.
- **Koi are capped, not revoked.** The `KoiRecord` list is untouched; the scene draws
  the most recent three.

The cap of 9 was set by looking, not by arithmetic. Each pearl carries a ~39px bloom
and the placement bands are only ~92px per side (they avoid the centred add-pill), so
at 14 the blooms merged into a milky smear. At 9 they read as individual beads.

**Still open here:** ghosts are bounded per-date but a heavy day still puts ~20 in the
tank. If that needs addressing, fade the oldest progressively — do **not** remove
them. Removing was tried when ghosts were hidden on cleared days, and the immediate
reaction was that the fish had gone missing; the spec makes the drained ghost the
reward for finishing.

---

## 2. Fish appearance

### Tank pass 2 — landed 2026-08-09

Merged from `feeding-flourish`. Completing a task now feeds the tank: food scatters and
the shoal quickens for four seconds, derived from `completedAt` and never stored. The
prize patrols instead of hovering, and `pitch`/`turn` ignore sub-pixel travel — at the
prize's old speed the heading was noise multiplied by twelve. A leafy stem plant joins
the bed under weighted selection. Pearls rest on the sand rather than 30–55px beneath
it, and a chest sits in the middle holding gold and gemstones, carrying the balance
past the point the bed stops drawing beads.

The date header could lie: it read "Today" on a tank left open past midnight, filing new
tasks under yesterday. Today is now a live prop, and the label doubles as one tap back
to today.

**Still open from that work:**

- Fish still pass through one another (plan Phase 4), and pectorals do not scull.
- The **bushy** plant form is the weakest of the five.
- A date picker was deliberately deferred behind the Today control — see whether the
  cheap fix removed the need before adding the calendar.

### Realism pass — landed 2026-08-09

`docs/superpowers/plans/2026-08-09-fish-realism.md`, merged. Tail beat now follows how
hard the fish is working; bodies bend into turns; the drawn body outline is gone; the
mascot eye is a dark iris; creatures and planting fade with depth; fins are thinner at
the margin. The bed was rebuilt: planting roots in the sand's real surface, sway is a
current crossing the tank rather than one shared frequency, and there are four kinds of
plant instead of one repeated blade.

**Still open from that work:**

- **Pectoral sculling** (plan 1.3) and **separation/steering** (plan Phase 4) were not
  done. Fish still pass through one another.
- The **bushy** plant form is the weakest of the four — it reads as straw rather than
  as mass.
- The sand is a plain band. Leaf litter where blades meet it would soften the junction.
- Clumps can still read slightly as sheaves; widening the root spread would help.

### 2.0 The rendering-library question is answered — do not reopen

Rive was evaluated properly (harness built, runtime wired, `docs/rive-experiment.md`).
**No.** Two reasons, both measured rather than argued:

- **Cost.** The runtime is 743 kB of wasm plus 95 kB of JS, gzipped, against a whole
  app of 52 kB. Roughly a 16× download increase for something offline-first.
- **It solves the wrong problem.** Frames pulled from `fish_tank_idea.mp4` show the
  gap is *style and motion*, not rendering primitive: drawn outlines, a mascot eye,
  uniform crispness at every depth, and a body that ripples instead of bending. An
  authored asset would carry the same illustration grammar into a heavier runtime.

A colour library (`culori`/`chroma-js`, OKLCH) remains a plausible fit for the palette
items below — those are perceptual-contrast problems, not drawing problems.

Realism work is planned in
`docs/superpowers/plans/2026-08-09-fish-realism.md`.

### 2.1 Fin rework for the nine swimmers — done 2026-08-09

The blade branch is gone. Both styles now share one construction, differing only in
`FIN_SHAPE` (base length, belly, waist): every fin roots along a stretch of body and
bellies out to the tip. Four defects closed, three of which only showed at 8×:

- **Point roots.** Blades were joined at effectively one point, so they read as gold
  needles stuck into the body, and the long-finned species looked like a fish swimming
  beside its own fins.
- **Split tails.** The caudal is drawn as two mirrored lobes, each based `half*0.94`
  off the axis — leaving a notch of open water between them at the peduncle. The tail
  read as two spikes trailing the fish. Caudals now root on the axis, so the lobes
  share an edge and close into one shape.
- **Escaping rays.** Fanning the rays from across the base (instead of converging them
  on a point, which undid the base) let the longest ones shoot past the fin margin as
  loose hairs. They are now clipped to the traced fin, so no sweep/span combination can
  push one outside.
- **Opaque fins.** Flattening the whole fin to one alpha turned gold to khaki against
  the water. Opacity now ramps root-to-tip — full colour where it leaves the body,
  see-through at the margin — which is both how a real fin is built and how it stops
  reading as card.

Two guards fired and both were right: the per-fin gradient allocated on every frame
(the ramp is now cached per fin, like the body gradient), and the marking test's
`clip`-counting proxy broke once fins started clipping. That assertion now asks
whether the marking colour was ever painted, which is the property it always meant.

### 2.2 Puffer palette reads muddy

**Looked at.** Brown-heavy, reads dirty rather than sandy next to the brighter
species.

### 2.3 Eel dorsal is wrong for the body

**Looked at.** A single short dorsal on a long serpentine body looks like a mistake.
Eels want a fin running most of the length.

### 2.4 `Profile` is symmetric top-to-bottom

**Structural.** `export type Profile = [number, number][]` — one array, offset along
±normal, so every body is mirror-symmetric about its spine. Asymmetric species
(swordtail, catfish, hatchetfish) are unbuildable until it splits into top and bottom
profiles. Not a bug; a ceiling on which species can exist.

### 2.5 Angel fins wash out; koi no longer reads as special

**Looked at, from the anatomy pass.** The angel's `#fff0d2` fins disappear against
its own cream body and against the koi when the two overlap. The koi lost its bright
gold rim stroke in the spine port and now blends with the angel — both cream-orange,
both marked. Re-adding a distinguishing rim is the cheap fix.

### 2.6 A tail can still clip the tank edge at ~20 tasks

**Observed once.** Body stayed in bounds, caudal fin crossed the boundary. The
`speciesReach` pitch fix addressed rotation; this is a separate residual.

---

## 2b. Completion flourish — landed 2026-08-09

Finishing a task now scatters food and stirs the shoal for four seconds. Completion had
been the flattest beat in the app: the fish drains to a ghost, which is a *subtraction*,
and the pearl lands on the sand where you may not look.

**Deliberately not a mechanic.** No feeding action, nothing to maintain, and no
obligation created by not opening the app — a tank that needs tending would guilt you
for a bad week, which is the same reason ghosts are not deleted on a cleared day and
the grass idea has to ratchet rather than wither.

**Growth was considered and rejected**, on three grounds worth keeping: fish size
already encodes species identity (`speciesReach`, clipping and tap radii all derive from
length); a fish only lives while its task is open, so growth over that span is either
invisible or means the most-avoided task grows the handsomest fish; and a second
currency alongside pearls dilutes both. Tank-level growth (the grass ratchet) remains
the better home for long-term progress.

`Scene.feeding` is derived from `completedAt`, never stored, and decays to zero, so it
cannot accumulate or be missed. It rides the existing `effort` input rather than adding
a second animation path.

---

## 3. Correctness and data

### 3.1 Treats completed before the payment fix are recorded wrong

An unclaimed treat could once be marked Done, skipping `claimTreat` — the
affordability check never ran but the cost was still counted as spent. Fixed going
forward; **existing data is not repaired**, and the balance stays wrong until such a
task is edited or deleted.

No stored fact distinguishes "claimed then completed" from "completed without
claiming", so any repair is inference. Decide between a one-off repair and leaving
history alone.

### 3.2 Deleting a completed task silently removes a pearl

Correct behaviour for a derived total, and the spec is explicit. Recorded because it
will eventually surprise someone mid-save-up. If it does: either exclude soft-deleted
tasks from `earned` only (asymmetric, messy), or warn in the delete confirmation when
the task is a completed non-treat.

### 3.3 No undo, anywhere

Soft deletes mean the data is recoverable in principle (`deletedAt` is a tombstone),
but nothing in the UI exposes it. The list's bulk delete is immediate.

---

## 4. Test and verification gaps

| Gap | Why it matters |
| --- | --- |
| **Reduced motion** | `prefers-reduced-motion` is only unit-tested through the `animate: false` flag. Never exercised in a real browser. |
| **Many creatures** | Never run at 50+. Section 1 says this state is reachable in weeks; overflow, overlap and frame rate are all unmeasured there. |
| **Multi-day koi navigation** | The "visible on every date thereafter" rule is unit-tested, never driven through days of real navigation. |
| **Trigger catch-up after real sleep** | Fake-clock tested only. Never verified by suspending a machine. |
| **Small and notched screens** | Verified at 420×860 and 460×900 only. See 5.1. |
| **v0 migration** | `migrate()` is unit-tested but has never loaded genuinely old stored data. There has never been a v0 in the wild. |
| **Legend art at small sizes** | The seven thumbnails are drawn at fixed per-entry `zoom` values set by eye at 460px. Untested on a very narrow or a very wide viewport. |
| **Escape key on sheets** | `Settings.svelte:46` and `Legend.svelte:190` attach `onkeydown` Escape handlers to a `tabindex="-1"` div, which never receives focus — so Escape does not dismiss either sheet. Pre-existing pattern, fails safe (nothing dismisses unexpectedly). Both sheets are dismissible by backdrop click and by their own button. |
| **Legend thumbnails fitting their tiles** | Nothing tests it. `Legend.test.ts` bounds each `zoom` to `(0, 1.5]`, which is a sanity check on the constant and not a fit check — both fit defects this sheet has had (a treat's caudal clipped at `0.8`, the ghost overflowing at `0.9`) sat inside that range and passed. Fit is verified only by the `deviceScaleFactor` 4 screenshot step, by eye. Any change to creature geometry — `FIN_SHAPE`, `speciesReach`, a species `length` — silently invalidates all seven hand-tuned zooms with no automated signal. |

---

## 5. Layout and platform

### 5.0 Rolling the deploy back past the v2 schema bump empties every tank

`SCHEMA_VERSION` went 1 → 2 when `seenLegend` was added (commit `a003a59`). That is the
first bump since the app went live on Pages with real data, and it is the first time
this consequence is reachable outside a test.

`migrate()` refuses anything newer than it understands — a version from the future
cannot be migrated backward, and guessing would corrupt it — so a pre-`a003a59` build
reading a v2 blob takes the quarantine path: `LocalTaskStore` copies the blob to
`fish-tank-todo/snapshot.corrupt.<timestamp>` and returns an empty snapshot. The user
opens the app to an empty tank with every task and koi gone, and because
`emptySnapshot()` carries `seenLegend: false`, the legend opens on top of it. It reads
as a factory reset.

**Nothing is deleted.** Recovery is renaming that `.corrupt.<timestamp>` key back to
`fish-tank-todo/snapshot`. Worth knowing before someone reverts a deploy, re-publishes
an older ref, or hits a stale cached bundle — it is the difference between a
five-minute fix and a user believing a week of tasks is gone.

Bumping was still right by the repo's own convention. `seenLegend` is purely additive,
so an old build would have coped with the *shape*; it breaks only on the version check.

### 5.1 Waterline clearance is tight on notched phones

`WATERLINE = 128` clears a ~70px desktop header comfortably. With
`safe-area-inset-top ≈ 47px` the header is ~97px and the treat fish clears it by a few
pixels. **Untested on a real device.** If it collides, raise `WATERLINE`.

### 5.2 The header inset is a magic number

The date header is inset `4.25rem` to clear corner buttons fixed at `1rem` and 2.6rem
wide — three constants in two files that must agree, enforced by nothing. Resizing the
buttons re-introduces the swallowed-arrow bug the E2E suite caught.

### 5.3 The tank is pointer-only

By design: a canvas offers nothing to a keyboard or screen reader, which is why the
list is a first-class second view. But every tank interaction is unreachable without a
pointer. Worth a keyboard shortcut to the list, or a note in the UI.

---

## 6. Code and tooling debt

### 6.1 `palette.lantern` is a misleading name

The creature kind was renamed `lantern → treat` when treats became exotic fish. The
palette token kept the old name because it is spec-named and renaming churns the
reference tests. It tints the treat fish.

### 6.2 Screenshot and E2E scripts need a dev server started by hand

`npm run screenshot` and `npm run e2e` both assume something is serving on :5199.
They could start and stop Vite themselves.

### 6.3 The specs are behind the implementation — deliberate

`docs/superpowers/specs/2026-08-08-fish-tank-todo-design.md` still describes treats as
lanterns on the waterline and says the day's ghosts merge into the koi. Both changed.

**Decision: the specs stay as written.** They record the design as approved, which is
what makes them useful as evidence later. Both divergences are named at the top of
`CLAUDE.md`, which is what a new session reads first. Listed here so it is not
mistaken for an oversight.

---

## 6b. Sync's scope is deliberately narrow

**Structural.** Multi-device sync (`persist/sync/`) does last-write-wins per task on
whatever cadence the app happens to run its sync pass — there is no Supabase Realtime
subscription, so a second device does not learn about a change until it next runs.
There is no per-field merge: two devices editing different fields of the same task
still resolve as one whole record winning, not a combination of both edits. There is
no conflict UI — the loser of a last-write-wins race is silently discarded, not
surfaced for a person to choose between. Clock skew between devices is mitigated by
a banner (`SyncStatus['state'] === 'skewed'`) rather than repaired — the app does not
attempt to correct for or estimate the skew, only to say the sync it did may be
unreliable.

## 7. Out of scope for v1 (from the spec, unchanged)

Accounts, sync between devices, push notifications, recurring tasks, sound, native
apps. The data model deliberately does not block sync — ULIDs, `updatedAt`, soft
deletes and the `TaskStore` port are all in place — but authentication changes the
threat model entirely and is a project of its own.

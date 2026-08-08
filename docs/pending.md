# Pending

Open work as of 2026-08-09. Everything here is **not done**; items are struck from
this file when they land rather than marked DONE, so the file stays short enough to
be read.

`docs/follow-ups.md` is the historical record of the v1.1 pass, including everything
that was closed. This file supersedes its open items — where the two disagree, this
one is current.

State at the time of writing: 434 unit tests, 57/57 E2E checks, 0 typecheck errors,
clean build, `main` at `4509fba`.

Each item says whether it was **measured** or is **suspected**, because the ones that
were reasoned about rather than looked at are the ones that have been wrong before.

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

### 2.1 Fin rework for the nine swimmers

**Looked at.** Only the three prize species carry `finStyle: 'veil'` (the
ray-veined membrane rooted along a base). All nine swimmers still take the default
blade branch in `traceFin`, so for them: the fin root is a near-point rather than a
base, the caudal is the wrong size on several species, and fins are opaque where they
should read as membrane.

This is the largest remaining visual gap and it is already scoped — the veil path
exists and works; the work is extending it and tuning per-species roots and sizes.

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

---

## 5. Layout and platform

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

## 7. Out of scope for v1 (from the spec, unchanged)

Accounts, sync between devices, push notifications, recurring tasks, sound, native
apps. The data model deliberately does not block sync — ULIDs, `updatedAt`, soft
deletes and the `TaskStore` port are all in place — but authentication changes the
threat model entirely and is a project of its own.

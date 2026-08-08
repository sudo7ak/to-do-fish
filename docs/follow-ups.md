# Follow-ups

Open items after v1.1. Nothing here blocks using the app; each is a known gap, a
deferred decision, or a piece of debt with a named reason.

Ordered by how much it would cost to leave alone.

---

## 1. Correctness and data

### 1.1 Treats completed before the payment fix are still recorded wrong

**Was:** an unclaimed treat could be marked Done, skipping `claimTreat`. The
affordability check never ran, but `pearlBalance` still counted the price as spent.

Fixed going forward, but **existing data is not repaired**. Any treat finished that
way is stored `status: "done"` with its cost deducted, and the balance stays wrong
until the task is edited or deleted.

**To do:** decide between a one-off repair (find treats that went `waiting → done`
with no plausible claim and reset them) and leaving history alone. Repair needs care —
there is no record distinguishing "claimed then completed" from "completed without
claiming", so it can only be inferred.

### 1.2 Deleting a completed task silently removes a pearl

Pearls are derived (`earned − spent`), never stored. So tidying up an old completed
task reduces your balance, and can put it below a treat you were saving for.

Correct behaviour for a derived total, and the spec is explicit about it. Worth
knowing because it will eventually surprise someone. **Options if it does:** exclude
soft-deleted tasks from `earned` only (asymmetric, and messy), or show a note in the
delete confirmation when the task is a completed non-treat.

### 1.3 Claiming a treat is instant and irreversible — **DONE**

Tapping an affordable treat used to spend the pearls immediately. Now every treat
opens its sheet, and the confirm button states the price (`Claim it — 3 pearls`).
Releasing a free-text bubble still acts on one tap: it is free and reversible, and the
spec is explicit that the app never prompts about those.

### 1.4 No undo, anywhere

Delete is two-step in the tank sheet and immediate in the list's bulk action. Soft
deletes mean the data is recoverable in principle (`deletedAt` is a tombstone) but
nothing in the UI exposes it.

---

## 2. Test coverage gaps

The unit suite (358) covers the pure layers; `npm run e2e` (50 checks) covers the
mechanics through the real UI. Known blind spots:

| Gap | Why it matters |
| --- | --- |
| **Reduced motion** | `prefers-reduced-motion` freezes ambient drift while state changes still play. Never exercised in a browser — only the `animate: false` flag is unit-tested. |
| **Multi-day koi accumulation** | Koi across many dates, and the "visible on every date thereafter" rule, are unit-tested but never driven through several days of real navigation. |
| **Migration from a real v0 blob** | `migrate()` is unit-tested, but no test loads genuinely old stored data — there has never been a v0 in the wild. |
| **Small screens / notched devices** | Everything is verified at 420×860 and 460×900. See 3.1. |
| **Many tasks** | Never tried with 50+ creatures: overflow treat handling, bubble crowding, and frame rate are all unmeasured. |
| **Trigger catch-up after real sleep** | Unit-tested with a fake clock; never tested by actually suspending a machine. |

---

## 3. Layout and platform

### 3.1 Waterline clearance is tight on notched phones

`WATERLINE = 128` clears a ~70px desktop header comfortably. On a phone with
`safe-area-inset-top ≈ 47px` the header is ~97px and the treat fish clears it by only
a few pixels. **Untested on a real device.** If it collides, raise `WATERLINE`.

### 3.2 The header inset is a magic number

The date header is inset `4.25rem` to clear the corner glass buttons, which are fixed
at `1rem` and 2.6rem wide. Three constants in two files that must agree, enforced by
nothing. If someone resizes the corner buttons, the arrows get swallowed again — the
bug the E2E suite caught.

### 3.3 The tank is pointer-only

By design: a canvas offers nothing to a keyboard or screen reader, which is why the
list view is a first-class second view. But it does mean **every tank interaction is
unreachable without a pointer** — worth a note in the UI, or a keyboard shortcut to
open the list.

---

## 4. Visual polish — **DONE**

- **Caustics** were full-width sine rows, which the eye followed end to end like
  contour lines on a map. Replaced with 16 scattered segments of differing length,
  brightness, drift and curvature, fading with depth. Verified by screenshot.
- **Overflow treats** beyond four collapsed into a creature that belonged to no task
  and swallowed taps silently. **Tapping it now opens the list**, which is the view
  that can actually show them all.
- **Tap targets** were mouse-sized (fish 28px radius). Raised to ~34–38px — roughly
  the 44px touch floor — with ghosts kept smaller than live fish, so a finished task
  cannot steal a tap meant for work still to do, and pearls smallest since tapping one
  does nothing.

- **Pearls floated in mid-water.** Fixing "hidden behind the add-pill" by lifting them
  96px off the floor solved the wrong axis: they cleared the pill but read as bubbles,
  and the spec has them settling *among the plants on the tank floor*. The pill is a
  **centred** band, so the constraint is horizontal — pearls now rest on the sand to
  either side of it (`PILL_EDGE = 0.74`). Two tests: on the bed, and never centred.

Still unverified: ghosts against the busiest possible tank, and the claimed treat fish
in more than one arrangement.

### 4.1 Fish anatomy rewrite (spine + species profiles) — verified 2026-08-08

Every creature now derives from a spine (centreline + travelling wave) offset by a
per-species profile, with data-driven fins, eyes, mouths and markings; ghosts, koi and
treats all route through the same path. Full verification (414 unit tests, 0 typecheck
errors, clean build, 57/57 E2E, screenshots at normal and 4× zoom, a 20-task busy
tank) closed:

- The six swimmer species (`clown`, `tang`, `angel`, `guppy`, `neon`, `betta`) read as
  distinct silhouettes by outline alone — the tang's deep disc does not read as the
  clown's rounded oval.
- Bodies visibly flex frame to frame (confirmed by comparing two captures ~400ms
  apart); nothing slides as a rigid sprite.
- Fins stay anchored to the body edge through the swim cycle, including on the
  overlapping/clustered fish in a busy tank.
- Eyes render with a visible pupil and glint on every species checked.
- Ghosts (pale, unfilled outline) are legible as spent but still present, including
  in the 20-task busy tank.

Two things this rewrite did **not** close, found during this verification pass:

- **Angel fin colour is washed out.** The angel's fin palette (`#fff0d2`) is close to
  white/cream, and against its own cream-tan body (`back: #ffe9be`) and next to the
  similarly cream-and-orange koi, the fins nearly disappear into the surrounding
  shapes when the two overlap. This is the "washed out fins" concern the anatomy plan
  called out as a known risk, and it is still present. The other five species' fins
  (yellow, pink, red-striped) read fine.
- **The koi no longer reads as unmistakably special.** The explicit bright-gold rim
  stroke was dropped in the port in favour of the generic body outline every fish
  gets. In an open scene the koi's size and slow wave are enough to notice it, but
  when it swims near or overlaps the angel (both cream/orange, both spotted or
  banded) the two blend into one mass and the koi stops reading as "the special
  fish" — it reads as another orange fish. Re-adding a distinguishing rim or glow is
  worth doing.
- **A fish's tail can clip the tank's right edge in a busy tank.** In the 20-task
  scene, one clownfish's caudal fin was cut off by the canvas boundary — the body
  stayed in bounds but the fin trailed past it. Not a crash and not most fish, but
  "no fish leaves the tank" is not fully true at 20 tasks.

Confirmed still out of scope by design, not oversight: scale texture, iridescent
sheen, and gradients within a fin are all invisible at the ~40px fish size used here.

## 4b. UX added alongside

- **Empty days say so.** A date with nothing in it rendered an empty tank, which is
  indistinguishable from a broken one. It now reads "Nothing in the tank for Today —
  add a task and it will start swimming", gated on hydration so it never flashes on
  launch.

---

## 5. Code debt

### 5.1 `laneX()` is dead code

`src/lib/render/creatures.ts` — superseded by `spreadX()` and the per-fish lane
centre. Nothing calls it. Delete it.

### 5.2 `palette.lantern` is now a misleading name

The creature kind was renamed `lantern → treat` when treats became exotic fish, but
the palette token is still `lantern` because it is a spec-named colour and renaming it
would churn the reference tests. It now tints the treat fish.

### 5.3 `CLAUDE.md` is badly stale

It still says **"Pre-implementation. The repository currently contains the design spec
and nothing else — no `package.json`, no `src/`, no toolchain."** That is the first
thing a new session reads, and all of it is now false. It also documents the
scaffolding step as "not yet run".

**This is the highest-value item in this document** for anyone picking the project up.

### 5.4 The spec is now behind the implementation

`docs/superpowers/specs/2026-08-08-fish-tank-todo-design.md` still describes treats as
lanterns on the waterline and says the day's ghosts merge into the koi. Both changed:
treats are exotic fish, and the merge is implicit (ghosts are date-scoped) rather than
a deletion. The spec should either be updated or marked as the original design with
deltas recorded in `progress.md`.

### 5.5 Screenshot and E2E scripts need the dev server started by hand

`npm run screenshot` and `npm run e2e` both assume something is already serving on
:5199. Could start and stop Vite themselves.

---

## 6. Out of scope for v1 (from the spec, unchanged)

Accounts, sync between devices, push notifications, recurring tasks, sound, native
apps. The data model deliberately does not block sync — ULIDs, `updatedAt`, soft
deletes and the `TaskStore` port are all in place — but authentication changes the
threat model entirely and is a project of its own.

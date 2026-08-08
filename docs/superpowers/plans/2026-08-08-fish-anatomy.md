# Fish Anatomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared almond-shaped fish body with a spine + profile model, so the six species read as distinct fish at 40px.

**Architecture:** A fish is a *spine* (centreline points with a travelling sine wave running nose to tail) plus a per-species *profile* (a table of half-heights along that spine). The body outline is the spine offset by ±profile; fins anchor at spine fractions and inherit the bend. Ghosts, koi, treats and the bubble's sealed fish all route through this one path with different data.

**Tech Stack:** TypeScript, Svelte 5, canvas 2D, Vitest, Playwright.

## Global Constraints

- `src/lib/render/` imports **nothing** outside itself. Not `store/`, not `../types`. Only `scene/types` (creature descriptors) and its own modules.
- All per-creature variation derives from `hash(id)` — never `Math.random()`. The same task is the same fish on every reload.
- No creature position is ever persisted.
- Fish size is **unchanged** (~32–44px body length). Scale texture and iridescence are out of scope: invisible at that size.
- `place()` in `creatures.ts` is **not modified by this plan**. This changes how a fish is drawn, not where it swims.
- Never use raw `hash % n` or `hash >> k` on sequential ids — sibling ids differ only in low bits. Always mix through `mix32()`.
- Existing suite must stay green: 361 unit tests (`npm test`) and 57 E2E checks (`npm run e2e`, needs `npm run dev` in another shell).

## File Structure

`src/lib/render/creatures.ts` is 991 lines and holds placement, six drawing routines, and two hash helpers. This plan splits the pure parts out — they are the testable half, and the file is too large to hold in context reliably.

| File | Responsibility |
| --- | --- |
| `src/lib/render/rng.ts` **(new)** | `hash`, `mix32`. Deterministic per-id randomness, shared by species choice and drawing. |
| `src/lib/render/spine.ts` **(new)** | Spine maths: build a centreline with a travelling wave, sample points and tangents, offset by a profile into an outline. Pure geometry, no canvas. |
| `src/lib/render/species.ts` **(new)** | Species data: profiles, fins, palettes, wave parameters, `speciesFor`. Data only, no drawing. |
| `src/lib/render/creatures.ts` (modify) | Placement (unchanged) and drawing, now consuming `spine.ts` + `species.ts`. Loses ~400 lines of bespoke per-creature drawing. |

---

### Task 1: Extract the hash helpers

**Files:**
- Create: `src/lib/render/rng.ts`
- Create: `src/lib/render/rng.test.ts`
- Modify: `src/lib/render/creatures.ts` (remove `hash`/`mix32`, import them instead)

**Interfaces:**
- Consumes: nothing.
- Produces: `hash(id: string): number`, `mix32(seed: number): number` (returns `[0, 1)`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/render/rng.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hash, mix32 } from './rng';

describe('hash', () => {
	it('is stable for the same id', () => {
		expect(hash('task-abc')).toBe(hash('task-abc'));
	});

	it('differs for different ids', () => {
		expect(hash('task-a')).not.toBe(hash('task-b'));
	});

	it('is always a non-negative 32-bit integer', () => {
		for (const id of ['', 'a', 'task-9999', 'zzzzzzzzzz']) {
			const h = hash(id);
			expect(Number.isInteger(h)).toBe(true);
			expect(h).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('mix32', () => {
	it('returns a fraction in [0, 1)', () => {
		for (let i = 0; i < 500; i++) {
			const v = mix32(i);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	it('is deterministic', () => {
		expect(mix32(12345)).toBe(mix32(12345));
	});

	it('avalanches: sibling ids land far apart', () => {
		// `t-aaa` and `t-bbb` differ only in low bits. Anything derived from the raw
		// hash lands in the same bucket for all of them; mixing is what fixes it.
		const values = ['t-aaa', 't-bbb', 't-ccc', 't-ddd'].map((id) => mix32(hash(id)));
		const buckets = new Set(values.map((v) => Math.floor(v * 4)));
		expect(buckets.size).toBeGreaterThan(1);
	});

	it('spreads a run of sequential ids across the range', () => {
		const values = Array.from({ length: 60 }, (_, i) => mix32(hash(`id-${i}`)));
		const buckets = new Set(values.map((v) => Math.floor(v * 6)));
		expect(buckets.size).toBe(6);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/render/rng.test.ts`
Expected: FAIL — `Failed to load url ./rng`

- [ ] **Step 3: Create the module**

Create `src/lib/render/rng.ts` by moving the two functions out of `creatures.ts` verbatim, plus `export`:

```ts
/**
 * Deterministic per-id randomness. Shared by species choice and drawing, so the same
 * task is the same fish, in the same lane, on every reload.
 */

/** Stable 32-bit seed for an id. */
export function hash(id: string): number {
	let value = 0;
	for (let i = 0; i < id.length; i++) {
		value = (value * 31 + id.charCodeAt(i)) >>> 0;
	}
	return value;
}

/**
 * Avalanches a seed into [0, 1). Sibling ids like `t-aaa` and `t-bbb` differ only in
 * their low bits; without mixing, anything derived from the high bits comes out
 * identical for all of them.
 */
export function mix32(seed: number): number {
	let x = (seed ^ 0x9e3779b9) >>> 0;
	x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
	x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
	x = (x ^ (x >>> 16)) >>> 0;
	return x / 4294967296;
}
```

- [ ] **Step 4: Point `creatures.ts` at the new module**

In `src/lib/render/creatures.ts`, delete the local `hash` and `mix32` function bodies (near the end of the file, under the `helpers` banner) and add to the imports at the top:

```ts
import { hash, mix32 } from './rng';
```

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS, 361 + 7 tests. If `creatures.test.ts` fails, the import is missing or a stray local definition remains.

- [ ] **Step 6: Commit**

```bash
git add src/lib/render/rng.ts src/lib/render/rng.test.ts src/lib/render/creatures.ts
git commit -m "refactor: extract hash and mix32 into render/rng"
```

---

### Task 2: Build the spine

**Files:**
- Create: `src/lib/render/spine.ts`
- Create: `src/lib/render/spine.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Point = { x: number; y: number }`
  - `type Spine = Point[]`
  - `type Wave = { amplitude: number; wavelength: number; speed: number }`
  - `spineFor(length: number, wave: Wave, time: number, phase: number, segments?: number): Spine` — nose at index 0 (x = +length/2), tail at the last index (x = −length/2), facing +x.

- [ ] **Step 1: Write the failing test**

Create `src/lib/render/spine.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { spineFor, type Wave } from './spine';

const WAVE: Wave = { amplitude: 0.12, wavelength: 0.9, speed: 6 };
const LEN = 40;

const segmentLengths = (points: { x: number; y: number }[]) =>
	points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));

describe('spineFor', () => {
	it('runs nose to tail along the body length', () => {
		const spine = spineFor(LEN, WAVE, 0, 0);

		expect(spine.length).toBeGreaterThan(4);
		expect(spine[0].x).toBeCloseTo(LEN / 2, 5);
		expect(spine.at(-1)!.x).toBeCloseTo(-LEN / 2, 5);
	});

	it('bends without stretching — every segment keeps its length', () => {
		// A spine that stretches makes the fish grow and shrink as it swims.
		for (const time of [0, 250, 600, 1400]) {
			const lengths = segmentLengths(spineFor(LEN, WAVE, time, 0.7));
			const first = lengths[0];
			for (const l of lengths) expect(l).toBeCloseTo(first, 4);
		}
	});

	it('holds the nose still and swings the tail', () => {
		// Fish swim by sweeping the tail, not by waving their head.
		const noseYs = [0, 200, 400, 600].map((t) => spineFor(LEN, WAVE, t, 0)[0].y);
		const tailYs = [0, 200, 400, 600].map((t) => spineFor(LEN, WAVE, t, 0).at(-1)!.y);

		const spread = (ys: number[]) => Math.max(...ys) - Math.min(...ys);
		expect(spread(noseYs)).toBeLessThan(0.5);
		expect(spread(tailYs)).toBeGreaterThan(spread(noseYs) + 1);
	});

	it('travels the wave from nose to tail', () => {
		// The crest at the tail now should appear nearer the nose earlier, not later.
		const early = spineFor(LEN, WAVE, 0, 0);
		const later = spineFor(LEN, WAVE, 60, 0);
		expect(early.map((p) => p.y)).not.toEqual(later.map((p) => p.y));
	});

	it('is deterministic for a given time and phase', () => {
		expect(spineFor(LEN, WAVE, 900, 1.3)).toEqual(spineFor(LEN, WAVE, 900, 1.3));
	});

	it('gives two fish with different phases different shapes', () => {
		const a = spineFor(LEN, WAVE, 500, 0);
		const b = spineFor(LEN, WAVE, 500, Math.PI);
		expect(a.at(-1)!.y).not.toBeCloseTo(b.at(-1)!.y, 2);
	});

	it('produces finite coordinates for degenerate input', () => {
		for (const spine of [spineFor(0, WAVE, 100, 0), spineFor(1, WAVE, 100, 0)]) {
			for (const p of spine) {
				expect(Number.isFinite(p.x)).toBe(true);
				expect(Number.isFinite(p.y)).toBe(true);
			}
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/render/spine.test.ts`
Expected: FAIL — `Failed to load url ./spine`

- [ ] **Step 3: Write the implementation**

Create `src/lib/render/spine.ts`:

```ts
/**
 * The centreline a fish is built on.
 *
 * A travelling sine wave runs nose to tail. Amplitude grows toward the tail, so the
 * nose stays steady and the tail sweeps — which is how fish actually swim, and the
 * reason a rigid body sliding sideways reads as a sticker.
 *
 * Pure geometry. No canvas, no colour, no dependencies.
 */

export type Point = { x: number; y: number };
export type Spine = Point[];

export type Wave = {
	/** Tail sweep, as a fraction of body length. */
	amplitude: number;
	/** Body lengths per wave cycle. Below 1 means more than one crest along the fish. */
	wavelength: number;
	/** Radians per second. */
	speed: number;
};

const DEFAULT_SEGMENTS = 8;

/**
 * Builds a spine of `segments + 1` points, nose first, facing +x.
 *
 * Points are laid out along x at even spacing and displaced in y. That keeps segment
 * *spacing* constant along the axis; the test asserts the stronger property that the
 * segments themselves stay equal length, which holds because the displacement is
 * applied as a rotation of the whole chain rather than a per-point offset.
 */
export function spineFor(
	length: number,
	wave: Wave,
	time: number,
	phase: number,
	segments: number = DEFAULT_SEGMENTS
): Spine {
	const t = time / 1000;
	const step = length / segments;
	const points: Spine = [{ x: length / 2, y: 0 }];

	// Walk from the nose backwards, turning by a little at each joint. Building the
	// chain by rotation instead of by offsetting a straight line is what keeps every
	// segment exactly `step` long however hard the fish bends.
	let angle = 0;
	for (let i = 1; i <= segments; i++) {
		const u = i / segments; // 0 at nose, 1 at tail
		// Amplitude ramps in along the body: the head barely moves, the tail sweeps.
		const ramp = u * u;
		const bend = Math.sin(t * wave.speed + phase - (u * Math.PI * 2) / wave.wavelength);
		angle = bend * wave.amplitude * ramp;

		const previous = points[i - 1];
		points.push({
			x: previous.x - step * Math.cos(angle),
			y: previous.y + step * Math.sin(angle)
		});
	}

	return points;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/render/spine.test.ts`
Expected: PASS, 7 tests.

If "holds the nose still" fails, the amplitude ramp is missing. If "bends without stretching" fails, the chain is being built by offsetting rather than rotating.

- [ ] **Step 5: Commit**

```bash
git add src/lib/render/spine.ts src/lib/render/spine.test.ts
git commit -m "feat: add spine model with travelling body wave"
```

---

### Task 3: Sample the spine and offset it into an outline

**Files:**
- Modify: `src/lib/render/spine.ts`
- Modify: `src/lib/render/spine.test.ts`

**Interfaces:**
- Consumes: `Spine`, `Point` from Task 2.
- Produces:
  - `type Profile = [number, number][]` — `(t, halfHeight ÷ length)` pairs, `t` ascending from 0 to 1.
  - `profileAt(profile: Profile, t: number): number`
  - `pointAt(spine: Spine, t: number): Point`
  - `tangentAt(spine: Spine, t: number): number` — radians.
  - `outline(spine: Spine, profile: Profile, length: number): Point[]` — closed loop, top edge nose→tail then bottom edge tail→nose.

- [ ] **Step 1: Write the failing test**

Append to `src/lib/render/spine.test.ts`:

```ts
import { profileAt, pointAt, tangentAt, outline, type Profile } from './spine';

const PROFILE: Profile = [
	[0, 0],
	[0.2, 0.16],
	[0.5, 0.2],
	[0.85, 0.05],
	[1, 0.02]
];

describe('profileAt', () => {
	it('returns the exact value at a control point', () => {
		expect(profileAt(PROFILE, 0.5)).toBeCloseTo(0.2, 6);
	});

	it('interpolates between control points', () => {
		const mid = profileAt(PROFILE, 0.35);
		expect(mid).toBeGreaterThan(0.16);
		expect(mid).toBeLessThan(0.2);
	});

	it('clamps outside the range rather than extrapolating', () => {
		expect(profileAt(PROFILE, -1)).toBeCloseTo(0, 6);
		expect(profileAt(PROFILE, 2)).toBeCloseTo(0.02, 6);
	});

	it('is never negative — a negative half-height turns the body inside out', () => {
		for (let t = 0; t <= 1; t += 0.02) {
			expect(profileAt(PROFILE, t)).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('pointAt and tangentAt', () => {
	const straight: Spine = [
		{ x: 20, y: 0 },
		{ x: 10, y: 0 },
		{ x: 0, y: 0 },
		{ x: -10, y: 0 },
		{ x: -20, y: 0 }
	];

	it('finds the nose at t=0 and the tail at t=1', () => {
		expect(pointAt(straight, 0)).toEqual({ x: 20, y: 0 });
		expect(pointAt(straight, 1)).toEqual({ x: -20, y: 0 });
	});

	it('interpolates along the chain', () => {
		expect(pointAt(straight, 0.5).x).toBeCloseTo(0, 5);
	});

	it('reports the heading of a straight spine as pointing along -x', () => {
		// The chain runs nose (+x) to tail (-x), so the tangent points backwards.
		expect(Math.abs(tangentAt(straight, 0.5))).toBeCloseTo(Math.PI, 2);
	});
});

describe('outline', () => {
	const straight: Spine = [
		{ x: 20, y: 0 },
		{ x: 0, y: 0 },
		{ x: -20, y: 0 }
	];

	it('closes: the same number of points above and below', () => {
		const loop = outline(straight, PROFILE, 40);
		expect(loop.length).toBe(straight.length * 2);
	});

	it('is symmetric about a straight spine', () => {
		const loop = outline(straight, PROFILE, 40);
		const top = loop.slice(0, straight.length);
		const bottom = loop.slice(straight.length).reverse();

		for (let i = 0; i < top.length; i++) {
			expect(top[i].y).toBeCloseTo(-bottom[i].y, 5);
		}
	});

	it('is widest where the profile peaks', () => {
		const loop = outline(straight, PROFILE, 40);
		const heights = loop.slice(0, straight.length).map((p) => Math.abs(p.y));
		expect(Math.max(...heights)).toBeCloseTo(0.2 * 40, 4);
	});

	it('produces finite points for a bent spine', () => {
		const bent = spineFor(40, WAVE, 700, 0.4);
		for (const p of outline(bent, PROFILE, 40)) {
			expect(Number.isFinite(p.x)).toBe(true);
			expect(Number.isFinite(p.y)).toBe(true);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/render/spine.test.ts`
Expected: FAIL — `profileAt is not a function` (or an import error).

- [ ] **Step 3: Write the implementation**

Append to `src/lib/render/spine.ts`:

```ts
/** `(t, halfHeight ÷ length)` control points, `t` ascending from 0 (nose) to 1 (tail). */
export type Profile = [number, number][];

/** Half-height at `t`, linearly interpolated and clamped at both ends. */
export function profileAt(profile: Profile, t: number): number {
	if (t <= profile[0][0]) return profile[0][1];

	for (let i = 1; i < profile.length; i++) {
		const [t1, h1] = profile[i];
		if (t <= t1) {
			const [t0, h0] = profile[i - 1];
			const span = t1 - t0;
			const k = span === 0 ? 0 : (t - t0) / span;
			return h0 + (h1 - h0) * k;
		}
	}

	return profile[profile.length - 1][1];
}

/** The point at `t` along the spine, 0 at the nose and 1 at the tail. */
export function pointAt(spine: Spine, t: number): Point {
	const clamped = Math.min(1, Math.max(0, t));
	const scaled = clamped * (spine.length - 1);
	const i = Math.min(spine.length - 2, Math.floor(scaled));
	const k = scaled - i;

	return {
		x: spine[i].x + (spine[i + 1].x - spine[i].x) * k,
		y: spine[i].y + (spine[i + 1].y - spine[i].y) * k
	};
}

/** Heading of the spine at `t`, in radians. */
export function tangentAt(spine: Spine, t: number): number {
	const clamped = Math.min(1, Math.max(0, t));
	const scaled = clamped * (spine.length - 1);
	const i = Math.min(spine.length - 2, Math.floor(scaled));

	return Math.atan2(spine[i + 1].y - spine[i].y, spine[i + 1].x - spine[i].x);
}

/**
 * The body outline: the spine offset by ±profile along the local normal.
 *
 * Offsetting along the normal rather than straight up and down is what makes the
 * body look like it bends instead of shearing.
 */
export function outline(spine: Spine, profile: Profile, length: number): Point[] {
	const top: Point[] = [];
	const bottom: Point[] = [];

	for (let i = 0; i < spine.length; i++) {
		const t = i / (spine.length - 1);
		const half = Math.max(0, profileAt(profile, t)) * length;

		// Normal to the local tangent.
		const angle = tangentAt(spine, t) + Math.PI / 2;
		const nx = Math.cos(angle) * half;
		const ny = Math.sin(angle) * half;

		top.push({ x: spine[i].x + nx, y: spine[i].y + ny });
		bottom.push({ x: spine[i].x - nx, y: spine[i].y - ny });
	}

	return [...top, ...bottom.reverse()];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/render/spine.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/render/spine.ts src/lib/render/spine.test.ts
git commit -m "feat: sample the spine and offset it into a body outline"
```

---

### Task 4: Species data

**Files:**
- Create: `src/lib/render/species.ts`
- Create: `src/lib/render/species.test.ts`
- Modify: `src/lib/render/creatures.ts` (re-export `speciesFor` from the new module)

**Interfaces:**
- Consumes: `Profile`, `Wave` from `spine.ts`; `hash`, `mix32` from `rng.ts`.
- Produces:
  - `type Species = 'clown' | 'tang' | 'angel' | 'guppy' | 'neon' | 'betta' | 'koi' | 'exotic'`
  - `type FinKind = 'dorsal' | 'anal' | 'pectoral' | 'pelvic' | 'caudal'`
  - `type FinSpec = { anchor: number; kind: FinKind; span: number; sweep: number; lag: number }`
  - `type SpeciesSpec = { length: number; profile: Profile; fins: FinSpec[]; palette: { back: string; belly: string; fin: string; marking: string; iris: string }; pattern: 'bands' | 'stripe' | 'spots' | 'none'; wave: Wave }`
  - `const SPECIES: Record<Species, SpeciesSpec>`
  - `const SWIMMERS: Species[]` — the six pickable species; excludes `koi` and `exotic`, which are assigned by creature kind rather than by hash.
  - `speciesFor(id: string): Species`

- [ ] **Step 1: Write the failing test**

Create `src/lib/render/species.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SPECIES, SWIMMERS, speciesFor, type Species } from './species';
import { profileAt } from './spine';

const ALL = Object.keys(SPECIES) as Species[];

describe('species data', () => {
	it('defines the six swimmers plus koi and the exotic treat', () => {
		expect(SWIMMERS).toEqual(['clown', 'tang', 'angel', 'guppy', 'neon', 'betta']);
		expect(ALL).toContain('koi');
		expect(ALL).toContain('exotic');
	});

	it('never gives a swimmer id the koi or treat body', () => {
		// Those two are assigned by creature kind. A task turning into a koi would be
		// a lie about the day being cleared.
		for (let i = 0; i < 300; i++) {
			expect(['koi', 'exotic']).not.toContain(speciesFor(`id-${i}`));
		}
	});

	it('keeps every profile non-negative and closed at the nose', () => {
		for (const name of ALL) {
			const { profile } = SPECIES[name];
			expect(profile[0][1]).toBeCloseTo(0, 3);
			for (let t = 0; t <= 1; t += 0.02) {
				expect(profileAt(profile, t)).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it('orders profile control points by t', () => {
		for (const name of ALL) {
			const ts = SPECIES[name].profile.map(([t]) => t);
			expect(ts).toEqual([...ts].sort((a, b) => a - b));
		}
	});

	it('separates silhouettes: the deepest body is at least twice the slimmest', () => {
		// Shape is what survives at 40px. If every species has the same depth they are
		// one fish in six paint jobs, which is the bug this design exists to fix.
		const depths = SWIMMERS.map((name) =>
			Math.max(...SPECIES[name].profile.map(([, h]) => h))
		);
		expect(Math.max(...depths)).toBeGreaterThan(Math.min(...depths) * 2);
	});

	it('anchors every fin on the body, in order', () => {
		for (const name of ALL) {
			for (const fin of SPECIES[name].fins) {
				expect(fin.anchor).toBeGreaterThanOrEqual(0);
				expect(fin.anchor).toBeLessThanOrEqual(1);
				expect(fin.span).toBeGreaterThan(0);
			}
		}
	});

	it('gives every species a caudal fin', () => {
		for (const name of ALL) {
			const kinds = SPECIES[name].fins.map((f) => f.kind);
			expect(kinds).toContain('caudal');
		}
	});

	it('gives every species a full palette', () => {
		for (const name of ALL) {
			const p = SPECIES[name].palette;
			for (const key of ['back', 'belly', 'fin', 'marking', 'iris'] as const) {
				expect(p[key]).toMatch(/^#[0-9a-f]{6}$/i);
			}
		}
	});
});

describe('speciesFor', () => {
	it('is stable for an id', () => {
		expect(speciesFor('task-abc')).toBe(speciesFor('task-abc'));
	});

	it('uses every swimmer across a realistic tank', () => {
		const seen = new Set(Array.from({ length: 200 }, (_, i) => speciesFor(`id-${i}`)));
		expect(seen.size).toBe(SWIMMERS.length);
	});

	it('does not alias on sequential ids', () => {
		// `hash % n` with a constant id stride collapses to two species.
		const seen = new Set(Array.from({ length: 40 }, (_, i) => speciesFor(`t-${i}`)));
		expect(seen.size).toBeGreaterThan(3);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/render/species.test.ts`
Expected: FAIL — `Failed to load url ./species`

- [ ] **Step 3: Write the implementation**

Create `src/lib/render/species.ts`:

```ts
import { hash, mix32 } from './rng';
import type { Profile, Wave } from './spine';

/**
 * What each species looks like, as data.
 *
 * Silhouette carries the identity: at 40px a scale pattern is mush, but the outline
 * of a disc-shaped tang against a torpedo-shaped neon reads instantly. Depth ÷ length
 * runs from 0.35 to 1.15 across the six swimmers, and that spread is deliberate.
 */

export type Species = 'clown' | 'tang' | 'angel' | 'guppy' | 'neon' | 'betta' | 'koi' | 'exotic';

export type FinKind = 'dorsal' | 'anal' | 'pectoral' | 'pelvic' | 'caudal';

export type FinSpec = {
	/** Spine fraction: 0 is the nose, 1 the tail. */
	anchor: number;
	kind: FinKind;
	/** Length as a fraction of body length. */
	span: number;
	/** How far the fin rakes backwards, in radians. */
	sweep: number;
	/** Phase offset in radians behind the body wave — never frames, frame rate varies. */
	lag: number;
};

export type SpeciesSpec = {
	length: number;
	profile: Profile;
	fins: FinSpec[];
	palette: { back: string; belly: string; fin: string; marking: string; iris: string };
	pattern: 'bands' | 'stripe' | 'spots' | 'none';
	wave: Wave;
};

const caudal = (span: number, sweep = 0.5, lag = 0.9): FinSpec => ({
	anchor: 1,
	kind: 'caudal',
	span,
	sweep,
	lag
});

export const SPECIES: Record<Species, SpeciesSpec> = {
	// Rounded oval, blunt snout, round tail. Depth 0.58.
	clown: {
		length: 42,
		profile: [
			[0, 0.02],
			[0.15, 0.2],
			[0.4, 0.29],
			[0.72, 0.18],
			[0.9, 0.06],
			[1, 0.04]
		],
		fins: [
			caudal(0.3, 0.4, 0.8),
			{ anchor: 0.35, kind: 'dorsal', span: 0.2, sweep: 0.7, lag: 0.5 },
			{ anchor: 0.62, kind: 'anal', span: 0.16, sweep: 0.6, lag: 0.6 },
			{ anchor: 0.28, kind: 'pectoral', span: 0.16, sweep: 0.9, lag: 0.3 }
		],
		palette: {
			back: '#ff8a3d',
			belly: '#e8542c',
			fin: '#ffb877',
			marking: '#fff4e4',
			iris: '#2b1a10'
		},
		pattern: 'bands',
		wave: { amplitude: 0.16, wavelength: 1.1, speed: 7 }
	},

	// Deep disc, pointed snout, thin peduncle, crescent tail. Depth 0.78.
	tang: {
		length: 44,
		profile: [
			[0, 0.02],
			[0.12, 0.22],
			[0.38, 0.39],
			[0.7, 0.26],
			[0.9, 0.05],
			[1, 0.03]
		],
		fins: [
			caudal(0.26, 0.9, 0.9),
			{ anchor: 0.4, kind: 'dorsal', span: 0.26, sweep: 0.5, lag: 0.5 },
			{ anchor: 0.6, kind: 'anal', span: 0.22, sweep: 0.5, lag: 0.6 },
			{ anchor: 0.26, kind: 'pectoral', span: 0.15, sweep: 1, lag: 0.3 }
		],
		palette: {
			back: '#49b6f7',
			belly: '#1b5fc1',
			fin: '#ffd84d',
			marking: '#0e3e86',
			iris: '#10233d'
		},
		pattern: 'none',
		wave: { amplitude: 0.12, wavelength: 1.3, speed: 6 }
	},

	// Taller than long: dorsal and anal fins form a diamond, trailing pelvic filaments.
	angel: {
		length: 34,
		profile: [
			[0, 0.02],
			[0.14, 0.3],
			[0.4, 0.5],
			[0.7, 0.32],
			[0.9, 0.07],
			[1, 0.04]
		],
		fins: [
			caudal(0.3, 0.5, 1.1),
			{ anchor: 0.38, kind: 'dorsal', span: 0.62, sweep: 0.5, lag: 1.2 },
			{ anchor: 0.58, kind: 'anal', span: 0.55, sweep: 0.5, lag: 1.3 },
			{ anchor: 0.5, kind: 'pelvic', span: 0.75, sweep: 0.3, lag: 1.6 },
			{ anchor: 0.24, kind: 'pectoral', span: 0.14, sweep: 1, lag: 0.3 }
		],
		palette: {
			back: '#ffe9be',
			belly: '#efa63a',
			fin: '#fff0d2',
			marking: '#6b4a22',
			iris: '#2c1d0c'
		},
		pattern: 'bands',
		wave: { amplitude: 0.1, wavelength: 1.4, speed: 5 }
	},

	// Small slim body, fan tail larger than the body.
	guppy: {
		length: 30,
		profile: [
			[0, 0.02],
			[0.18, 0.16],
			[0.42, 0.22],
			[0.75, 0.12],
			[0.92, 0.05],
			[1, 0.03]
		],
		fins: [
			caudal(0.62, 0.35, 1.3),
			{ anchor: 0.4, kind: 'dorsal', span: 0.22, sweep: 0.8, lag: 0.7 },
			{ anchor: 0.66, kind: 'anal', span: 0.14, sweep: 0.7, lag: 0.7 },
			{ anchor: 0.28, kind: 'pectoral', span: 0.13, sweep: 0.9, lag: 0.3 }
		],
		palette: {
			back: '#93ebff',
			belly: '#4a7be8',
			fin: '#ff93d2',
			marking: '#ffe066',
			iris: '#16233f'
		},
		pattern: 'spots',
		wave: { amplitude: 0.2, wavelength: 0.9, speed: 9 }
	},

	// Slim torpedo, small forked tail. The slimmest silhouette in the tank.
	neon: {
		length: 30,
		profile: [
			[0, 0.02],
			[0.2, 0.13],
			[0.45, 0.17],
			[0.78, 0.09],
			[0.93, 0.04],
			[1, 0.02]
		],
		fins: [
			caudal(0.3, 0.8, 0.8),
			{ anchor: 0.42, kind: 'dorsal', span: 0.14, sweep: 0.8, lag: 0.5 },
			{ anchor: 0.66, kind: 'anal', span: 0.12, sweep: 0.7, lag: 0.6 },
			{ anchor: 0.3, kind: 'pectoral', span: 0.11, sweep: 0.9, lag: 0.3 }
		],
		palette: {
			back: '#6beaff',
			belly: '#1b7fd4',
			fin: '#cff6ff',
			marking: '#ff3b4e',
			iris: '#0d2137'
		},
		pattern: 'stripe',
		wave: { amplitude: 0.22, wavelength: 0.8, speed: 10 }
	},

	// Compact body, enormous trailing veils.
	betta: {
		length: 34,
		profile: [
			[0, 0.02],
			[0.16, 0.2],
			[0.42, 0.3],
			[0.74, 0.18],
			[0.92, 0.06],
			[1, 0.04]
		],
		fins: [
			caudal(0.75, 0.3, 1.5),
			{ anchor: 0.42, kind: 'dorsal', span: 0.5, sweep: 0.5, lag: 1.4 },
			{ anchor: 0.62, kind: 'anal', span: 0.55, sweep: 0.4, lag: 1.5 },
			{ anchor: 0.28, kind: 'pectoral', span: 0.16, sweep: 0.9, lag: 0.4 }
		],
		palette: {
			back: '#ce7bff',
			belly: '#7a2bd1',
			fin: '#ff7fb4',
			marking: '#4a1580',
			iris: '#24103d'
		},
		pattern: 'none',
		wave: { amplitude: 0.14, wavelength: 1.2, speed: 5 }
	},

	// The cleared-day koi: long body, barbels, veil tail, unhurried.
	koi: {
		length: 52,
		profile: [
			[0, 0.03],
			[0.16, 0.16],
			[0.45, 0.2],
			[0.78, 0.12],
			[0.93, 0.05],
			[1, 0.03]
		],
		fins: [
			caudal(0.42, 0.4, 1.4),
			{ anchor: 0.4, kind: 'dorsal', span: 0.2, sweep: 0.6, lag: 0.8 },
			{ anchor: 0.66, kind: 'anal', span: 0.18, sweep: 0.5, lag: 0.9 },
			{ anchor: 0.26, kind: 'pectoral', span: 0.2, sweep: 0.9, lag: 0.4 }
		],
		palette: {
			back: '#fff0c4',
			belly: '#e08a2b',
			fin: '#ffe2a8',
			marking: '#e24e2f',
			iris: '#3a2408'
		},
		pattern: 'spots',
		wave: { amplitude: 0.1, wavelength: 1.6, speed: 3 }
	},

	// The guilty pleasure: oversized sails, the most ornate thing in the tank.
	exotic: {
		length: 44,
		profile: [
			[0, 0.02],
			[0.14, 0.22],
			[0.4, 0.34],
			[0.72, 0.2],
			[0.9, 0.06],
			[1, 0.04]
		],
		fins: [
			caudal(0.7, 0.35, 1.5),
			{ anchor: 0.38, kind: 'dorsal', span: 0.7, sweep: 0.45, lag: 1.4 },
			{ anchor: 0.6, kind: 'anal', span: 0.6, sweep: 0.45, lag: 1.5 },
			{ anchor: 0.5, kind: 'pelvic', span: 0.5, sweep: 0.3, lag: 1.7 },
			{ anchor: 0.26, kind: 'pectoral', span: 0.18, sweep: 0.9, lag: 0.4 }
		],
		palette: {
			back: '#ff6fc7',
			belly: '#7a3bd1',
			fin: '#ffa8d8',
			marking: '#ffd166',
			iris: '#2a0f3f'
		},
		pattern: 'none',
		wave: { amplitude: 0.12, wavelength: 1.3, speed: 4 }
	}
};

/** The species a task can be assigned. Koi and exotic are chosen by creature kind. */
export const SWIMMERS: Species[] = ['clown', 'tang', 'angel', 'guppy', 'neon', 'betta'];

/**
 * Which task is which fish is arbitrary, but it must be stable: the same task is the
 * same fish every time you open the tank, which is what lets you recognise it without
 * reading the label.
 *
 * Mixed, never `hash % n`: sequential ids step the raw hash by a constant, and when
 * that stride shares a factor with the species count only a couple of species ever
 * appear.
 */
export function speciesFor(id: string): Species {
	return SWIMMERS[Math.floor(mix32(hash(id)) * SWIMMERS.length)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/render/species.test.ts`
Expected: PASS.

- [ ] **Step 5: Re-export from `creatures.ts` so existing imports keep working**

In `src/lib/render/creatures.ts`, delete the local `Species` type, `SpeciesSpec` type, `SPECIES` constant, `SPECIES_ORDER` constant and `speciesFor` function. Add near the top:

```ts
import { SPECIES, speciesFor, type Species, type SpeciesSpec } from './species';

export { speciesFor };
export type { Species };
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS. `creatures.test.ts` imports `speciesFor` from `./creatures` and must still resolve through the re-export.

- [ ] **Step 7: Commit**

```bash
git add src/lib/render/species.ts src/lib/render/species.test.ts src/lib/render/creatures.ts
git commit -m "feat: move species to data-driven profiles and fin specs"
```

---

### Task 5: Draw the body from the spine

**Files:**
- Modify: `src/lib/render/creatures.ts`
- Modify: `src/lib/render/creatures.test.ts`

**Interfaces:**
- Consumes: `spineFor`, `outline`, `Profile` from `spine.ts`; `SPECIES`, `SpeciesSpec` from `species.ts`.
- Produces: `drawBody(ctx, spec, spine, alpha?): void` — private to `creatures.ts`, fills the outline with the back→belly gradient and strokes a rim.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/render/creatures.test.ts`:

```ts
describe('body drawing follows the spine', () => {
	it('draws a different path as the fish bends', () => {
		// If the body path is identical over time, the spine is not reaching the canvas.
		const early = fakeCtx();
		const later = fakeCtx();
		const c = creature('fish', { id: 'bender' });

		drawCreature(early, c, place(c, SIZE, 0), COLORS, 0);
		drawCreature(later, c, place(c, SIZE, 900), COLORS, 900);

		expect(early.calls.join()).not.toBe(later.calls.join());
	});

	it('holds a natural mid-bend under reduced motion', () => {
		// The loop freezes the clock rather than the fish. Each fish should sit in its
		// own bend, not snap to a straight line, which would read as a rendering fault.
		const a = fakeCtx();
		const b = fakeCtx();

		drawCreature(a, creature('fish', { id: 'one' }), place(creature('fish', { id: 'one' }), SIZE, 0, false), COLORS, 0);
		drawCreature(b, creature('fish', { id: 'two' }), place(creature('fish', { id: 'two' }), SIZE, 0, false), COLORS, 0);

		// Same frozen clock, different ids: different phases, so different shapes.
		expect(a.calls.join()).not.toBe(b.calls.join());
	});

	it('draws every species with a filled body and a balanced context', () => {
		const perSpecies = new Map<string, string>();
		for (let i = 0; i < 300; i++) perSpecies.set(speciesFor(`id-${i}`), `id-${i}`);
		expect(perSpecies.size).toBe(6);

		for (const id of perSpecies.values()) {
			const ctx = fakeCtx();
			const c = creature('fish', { id });

			drawCreature(ctx, c, place(c, SIZE, 400), COLORS, 400);

			expect(ctx.calls.filter((call) => call === 'fill').length).toBeGreaterThan(0);
			expect(ctx.depth).toBe(0);
		}
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/render/creatures.test.ts`
Expected: FAIL — "draws a different path as the fish bends" fails, because today's body is a fixed bezier that ignores time.

- [ ] **Step 3: Implement `drawBody` and use it in `drawFish`**

In `src/lib/render/creatures.ts`, add imports:

```ts
import { spineFor, outline, pointAt, tangentAt, type Spine } from './spine';
```

Add these helpers, replacing `bodyPath`:

```ts
/** Traces a closed outline as a smooth loop through its points. */
function tracePath(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]): void {
	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	for (let i = 1; i < points.length; i++) {
		const previous = points[i - 1];
		const point = points[i];
		// Midpoint quadratics: a smooth curve through every point without needing
		// hand-placed control points per species.
		ctx.quadraticCurveTo(previous.x, previous.y, (previous.x + point.x) / 2, (previous.y + point.y) / 2);
	}
	ctx.closePath();
}

/** Fills the body outline, lit from above, with a rim so it holds its edge in the water. */
function drawBody(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	spine: Spine,
	alpha = 1
): void {
	const loop = outline(spine, spec.profile, spec.length);
	const half = spec.length * 0.5;

	const shade = ctx.createLinearGradient(0, -half, 0, half);
	shade.addColorStop(0, spec.palette.back);
	shade.addColorStop(1, spec.palette.belly);

	ctx.globalAlpha = alpha;
	tracePath(ctx, loop);
	ctx.fillStyle = shade;
	ctx.fill();

	tracePath(ctx, loop);
	ctx.strokeStyle = withAlpha(spec.palette.belly, 0.5);
	ctx.lineWidth = 1.2;
	ctx.stroke();
	ctx.globalAlpha = 1;
}
```

Then replace the body section of `drawFish` so it builds a spine and calls `drawBody`. The signature becomes:

```ts
function drawFish(
	ctx: CanvasRenderingContext2D,
	at: Placement,
	spec: SpeciesSpec,
	time: number,
	seed: number
): void {
	if (at.flip) ctx.scale(-1, 1);

	const phase = mix32(seed ^ 0x11) * Math.PI * 2;
	const spine = spineFor(spec.length, spec.wave, time, phase);

	drawBody(ctx, spec, spine);
	drawTrail(ctx, time, seed, spec.length);
}
```

Delete the old `bodyPath`, `drawTail`, `drawFins`, `drawPattern`, `drawEye` calls from `drawFish` for now — they are re-added against the spine in Tasks 6–8. `drawGhost`, `drawKoi` and `drawTreatFish` still call `bodyPath`, so keep `bodyPath` until Task 9.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/render/creatures.test.ts`
Expected: PASS.

- [ ] **Step 5: Look at it**

```bash
npm run dev &          # in another shell if you prefer
npm run screenshot -- /tmp/fish-body.png
```

Expected: fish are bare bodies with no fins or eyes yet, but each species is a visibly different shape, and they flex as they swim. If they look identical, the profiles are not reaching `drawBody`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/render/creatures.ts src/lib/render/creatures.test.ts
git commit -m "feat: draw fish bodies from the spine and species profile"
```

---

### Task 6: Fins

**Files:**
- Modify: `src/lib/render/creatures.ts`
- Modify: `src/lib/render/creatures.test.ts`

**Interfaces:**
- Consumes: `FinSpec` from `species.ts`; `pointAt`, `tangentAt` from `spine.ts`.
- Produces: `drawFin(ctx, spec, fin, spine, time, phase, side): void` — private. `side` is `1` for the upper surface and `-1` for the lower.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/render/creatures.test.ts`:

```ts
import { SPECIES } from './species';

describe('fins', () => {
	it('draws one shape per fin, plus the body', () => {
		// Six fills for a betta (body + 4 fins + eye white) is a floor, not an exact
		// count — the point is that fins reach the canvas at all.
		const ctx = fakeCtx();
		const c = creature('fish', { id: 'finny' });

		drawCreature(ctx, c, place(c, SIZE, 300), COLORS, 300);

		expect(ctx.calls.filter((call) => call === 'fill').length).toBeGreaterThanOrEqual(3);
	});

	it('moves the fins as the body wave passes', () => {
		const a = fakeCtx();
		const b = fakeCtx();
		const c = creature('fish', { id: 'finny' });

		drawCreature(a, c, place(c, SIZE, 100), COLORS, 100);
		drawCreature(b, c, place(c, SIZE, 700), COLORS, 700);

		expect(a.calls.length).toBe(b.calls.length);
		expect(a.calls.join()).not.toBe(b.calls.join());
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/render/creatures.test.ts -t fins`
Expected: FAIL — only the body and rim are drawn, so fewer than three fills.

- [ ] **Step 3: Implement fins**

First **delete the old `drawTail` and `drawFins` functions** — the new `drawFins`
below reuses that name with a different signature, and leaving both in place is a
redeclaration error.

Then add to `src/lib/render/creatures.ts`:

```ts
/**
 * One fin, anchored at its spine fraction and rotated to the local tangent, so it
 * follows the body's bend without any special handling.
 *
 * `lag` offsets the fin's own flutter behind the body wave. Fins that move in perfect
 * lockstep with the body read as rigid cardboard.
 */
function drawFin(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	fin: FinSpec,
	spine: Spine,
	time: number,
	phase: number,
	side: 1 | -1
): void {
	const root = pointAt(spine, fin.anchor);
	const heading = tangentAt(spine, fin.anchor);
	const half = profileAt(spec.profile, fin.anchor) * spec.length;
	const span = fin.span * spec.length;

	const flutter =
		Math.sin(time / 1000 * spec.wave.speed + phase - fin.lag) * 0.18 * (fin.lag + 0.4);

	ctx.save();
	ctx.translate(root.x, root.y);
	ctx.rotate(heading + Math.PI); // face the nose
	ctx.scale(1, side);

	ctx.beginPath();
	ctx.moveTo(0, half * 0.6);
	ctx.quadraticCurveTo(-span * 0.3, half + span * 0.5, -span * fin.sweep, half + span);
	ctx.quadraticCurveTo(span * 0.1, half + span * 0.4 + flutter * span, span * 0.15, half * 0.5);
	ctx.closePath();

	ctx.fillStyle = withAlpha(spec.palette.fin, 0.82);
	ctx.fill();

	// Rays, so the fin reads as a fin and not a petal.
	ctx.strokeStyle = withAlpha(spec.palette.belly, 0.25);
	ctx.lineWidth = 0.8;
	for (const k of [0.25, 0.5, 0.75]) {
		ctx.beginPath();
		ctx.moveTo(0, half * 0.6);
		ctx.lineTo(-span * fin.sweep * k, half + span * k);
		ctx.stroke();
	}

	ctx.restore();
}

/** Every fin for a fish, in draw order: rear and far fins first. */
function drawFins(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	spine: Spine,
	time: number,
	phase: number
): void {
	for (const fin of spec.fins) {
		if (fin.kind === 'caudal') {
			drawFin(ctx, spec, fin, spine, time, phase, 1);
			drawFin(ctx, spec, fin, spine, time, phase, -1);
		} else if (fin.kind === 'dorsal') {
			drawFin(ctx, spec, fin, spine, time, phase, -1);
		} else {
			drawFin(ctx, spec, fin, spine, time, phase, 1);
		}
	}
}
```

Add `profileAt` and `FinSpec` to the imports:

```ts
import { spineFor, outline, pointAt, tangentAt, profileAt, type Spine } from './spine';
import { SPECIES, speciesFor, type Species, type SpeciesSpec, type FinSpec } from './species';
```

Call it from `drawFish`, before the body so fins sit behind it:

```ts
	const spine = spineFor(spec.length, spec.wave, time, phase);

	drawFins(ctx, spec, spine, time, phase);
	drawBody(ctx, spec, spine);
	drawTrail(ctx, time, seed, spec.length);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/render/creatures.test.ts`
Expected: PASS.

- [ ] **Step 5: Look at it**

```bash
npm run screenshot -- /tmp/fish-fins.png
```

Expected: fins attached at the body edge, trailing behind the bend, bigger on betta and angel. If a fin floats away from the body, `half` is not being added to the fin root.

- [ ] **Step 6: Commit**

```bash
git add src/lib/render/creatures.ts src/lib/render/creatures.test.ts
git commit -m "feat: draw fins anchored to the spine with phase lag"
```

---

### Task 7: Head — eye and mouth

**Files:**
- Modify: `src/lib/render/creatures.ts`
- Modify: `src/lib/render/creatures.test.ts`

**Interfaces:**
- Consumes: `pointAt`, `profileAt`.
- Produces: `drawHead(ctx, spec, spine, time, phase): void` — private.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/render/creatures.test.ts`:

```ts
describe('head', () => {
	it('draws an eye with a pupil and a catchlight', () => {
		// Three stacked arcs at the head: white, pupil, glint. Eyes are most of what
		// makes a 40px shape look alive.
		const ctx = fakeCtx();
		const c = creature('fish', { id: 'eyed' });

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.calls.filter((call) => call === 'arc').length).toBeGreaterThanOrEqual(3);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/render/creatures.test.ts -t head`
Expected: FAIL — the fish currently has no eye at all after Task 5 stripped it.

- [ ] **Step 3: Implement the head**

Add to `src/lib/render/creatures.ts`:

```ts
/** Eye and mouth, placed off the spine so they ride the head as it turns. */
function drawHead(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	spine: Spine,
	time: number,
	phase: number
): void {
	const at = pointAt(spine, 0.14);
	const half = profileAt(spec.profile, 0.14) * spec.length;
	const radius = Math.max(2.2, half * 0.34);

	// Eye white.
	ctx.beginPath();
	ctx.arc(at.x, at.y - half * 0.25, radius, 0, Math.PI * 2);
	ctx.fillStyle = '#ffffff';
	ctx.fill();

	// Iris and pupil.
	ctx.beginPath();
	ctx.arc(at.x + radius * 0.18, at.y - half * 0.25, radius * 0.62, 0, Math.PI * 2);
	ctx.fillStyle = spec.palette.iris;
	ctx.fill();

	// Catchlight — small, and most of what sells it.
	ctx.beginPath();
	ctx.arc(at.x - radius * 0.3, at.y - half * 0.25 - radius * 0.3, radius * 0.26, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
	ctx.fill();

	// Lid, a shade darker than the back.
	ctx.beginPath();
	ctx.arc(at.x, at.y - half * 0.25, radius, Math.PI * 1.05, Math.PI * 1.95);
	ctx.strokeStyle = withAlpha(spec.palette.belly, 0.5);
	ctx.lineWidth = 1;
	ctx.stroke();

	// Mouth: a notch at the nose that opens on the swim cycle.
	const nose = pointAt(spine, 0.02);
	const gape = (Math.sin((time / 1000) * spec.wave.speed * 0.5 + phase) * 0.5 + 0.5) * radius * 0.5;
	ctx.beginPath();
	ctx.moveTo(nose.x, nose.y - gape * 0.3);
	ctx.quadraticCurveTo(nose.x - radius * 0.7, nose.y, nose.x, nose.y + gape);
	ctx.strokeStyle = withAlpha(spec.palette.belly, 0.65);
	ctx.lineWidth = 1.1;
	ctx.stroke();
}
```

Call it from `drawFish`, after the body:

```ts
	drawFins(ctx, spec, spine, time, phase);
	drawBody(ctx, spec, spine);
	drawHead(ctx, spec, spine, time, phase);
	drawTrail(ctx, time, seed, spec.length);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/render/creatures.test.ts`
Expected: PASS.

- [ ] **Step 5: Look at it, close up**

```bash
npm run screenshot -- /tmp/fish-head.png
```

Then crop to a fish at 4× to judge the eye. Reuse the crop recipe from the pearls work: a short Playwright script with `deviceScaleFactor: 4` and `clip: { x: 0, y: 250, width: 420, height: 330 }`.

Expected: a clear eye with a visible pupil and glint; the mouth reads as a small notch, not a gash.

- [ ] **Step 6: Commit**

```bash
git add src/lib/render/creatures.ts src/lib/render/creatures.test.ts
git commit -m "feat: give fish eyes and mouths placed off the spine"
```

---

### Task 8: Markings that wrap the body

**Files:**
- Modify: `src/lib/render/creatures.ts`
- Modify: `src/lib/render/creatures.test.ts`

**Interfaces:**
- Consumes: `outline`, `pointAt`, `profileAt`.
- Produces: `drawMarkings(ctx, spec, spine, seed): void` — private.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/render/creatures.test.ts`:

```ts
describe('markings', () => {
	it('clips markings to the body so they cannot spill past the silhouette', () => {
		const ctx = fakeCtx();
		// `clown` has bands; find an id that maps to it.
		let banded = 'id-0';
		for (let i = 0; i < 300; i++) {
			if (speciesFor(`id-${i}`) === 'clown') {
				banded = `id-${i}`;
				break;
			}
		}
		const c = creature('fish', { id: banded });

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.calls).toContain('clip');
	});

	it('draws no markings for a species that has none', () => {
		let plain = 'id-0';
		for (let i = 0; i < 300; i++) {
			if (speciesFor(`id-${i}`) === 'betta') {
				plain = `id-${i}`;
				break;
			}
		}
		const withMarks = fakeCtx();
		const c = creature('fish', { id: plain });

		drawCreature(withMarks, c, place(c, SIZE, 0), COLORS, 0);

		// Betta is `pattern: 'none'`, so nothing should be clipped for markings.
		expect(withMarks.calls.filter((call) => call === 'clip').length).toBe(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/render/creatures.test.ts -t markings`
Expected: FAIL — no `clip` call, because markings are not drawn yet.

- [ ] **Step 3: Implement markings**

Add to `src/lib/render/creatures.ts`:

```ts
/**
 * Species markings, clipped to the body outline.
 *
 * Bands follow the local normal rather than running straight down the screen, so they
 * wrap the body as it bends instead of sitting on it like a decal.
 */
function drawMarkings(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	spine: Spine,
	seed: number
): void {
	if (spec.pattern === 'none') return;

	ctx.save();
	tracePath(ctx, outline(spine, spec.profile, spec.length));
	ctx.clip();
	ctx.fillStyle = spec.palette.marking;
	ctx.strokeStyle = spec.palette.marking;

	if (spec.pattern === 'bands') {
		ctx.lineWidth = spec.length * 0.07;
		for (const t of [0.24, 0.48, 0.72]) {
			const at = pointAt(spine, t);
			const half = profileAt(spec.profile, t) * spec.length * 1.6;
			const angle = tangentAt(spine, t) + Math.PI / 2;

			ctx.beginPath();
			ctx.moveTo(at.x + Math.cos(angle) * half, at.y + Math.sin(angle) * half);
			ctx.lineTo(at.x - Math.cos(angle) * half, at.y - Math.sin(angle) * half);
			ctx.stroke();
		}
	} else if (spec.pattern === 'stripe') {
		ctx.lineWidth = spec.length * 0.06;
		ctx.beginPath();
		for (let i = 0; i < spine.length; i++) {
			const p = spine[i];
			if (i === 0) ctx.moveTo(p.x, p.y);
			else ctx.lineTo(p.x, p.y);
		}
		ctx.stroke();
	} else if (spec.pattern === 'spots') {
		for (let i = 0; i < 5; i++) {
			const t = 0.2 + i * 0.14;
			const at = pointAt(spine, t);
			const jitter = mix32(seed ^ (i * 977));
			const half = profileAt(spec.profile, t) * spec.length;

			ctx.beginPath();
			ctx.arc(at.x, at.y + (jitter - 0.5) * half, spec.length * 0.045, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	ctx.restore();
}
```

Call it from `drawFish` between the body and the head:

```ts
	drawFins(ctx, spec, spine, time, phase);
	drawBody(ctx, spec, spine);
	drawMarkings(ctx, spec, spine, seed);
	drawHead(ctx, spec, spine, time, phase);
	drawTrail(ctx, time, seed, spec.length);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/render/creatures.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/render/creatures.ts src/lib/render/creatures.test.ts
git commit -m "feat: wrap species markings around the bending body"
```

---

### Task 9: Ghosts through the same path

**Files:**
- Modify: `src/lib/render/creatures.ts`
- Modify: `src/lib/render/creatures.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 5–8.
- Produces: `drawGhost` rewritten to use spine + outline. `bodyPath` is deleted.

- [ ] **Step 1: Write the failing test**

Replace the existing "draws a ghost as an outline rather than a filled body" test in `src/lib/render/creatures.test.ts` with:

```ts
	it('draws a ghost as an outline of its own species', () => {
		const ghost = fakeCtx();
		const fish = fakeCtx();
		const id = 'same-task';

		drawCreature(ghost, creature('ghost', { id }), place(creature('ghost', { id }), SIZE, 0), COLORS, 0);
		drawCreature(fish, creature('fish', { id }), place(creature('fish', { id }), SIZE, 0), COLORS, 0);

		// Outline, not fill: strokes present, and fewer fills than the live fish.
		expect(ghost.calls.filter((c) => c === 'stroke').length).toBeGreaterThan(0);
		expect(fish.calls.filter((c) => c === 'fill').length).toBeGreaterThan(
			ghost.calls.filter((c) => c === 'fill').length
		);
		expect(ghost.depth).toBe(0);
	});

	it('bends a ghost as it drifts, like a live fish', () => {
		const early = fakeCtx();
		const later = fakeCtx();
		const c = creature('ghost', { id: 'drifter' });

		drawCreature(early, c, place(c, SIZE, 0), COLORS, 0);
		drawCreature(later, c, place(c, SIZE, 1100), COLORS, 1100);

		expect(early.calls.join()).not.toBe(later.calls.join());
	});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/render/creatures.test.ts -t ghost`
Expected: FAIL on the bending test — `drawGhost` still uses the fixed `bodyPath`.

- [ ] **Step 3: Rewrite `drawGhost`**

Replace the whole `drawGhost` function in `src/lib/render/creatures.ts` with:

```ts
/** A resolved task keeps swimming, drained to a translucent outline of the same fish. */
function drawGhost(
	ctx: CanvasRenderingContext2D,
	at: Placement,
	spec: SpeciesSpec,
	time: number,
	seed: number
): void {
	if (at.flip) ctx.scale(-1, 1);

	const phase = mix32(seed ^ 0x11) * Math.PI * 2;
	const spine = spineFor(spec.length, spec.wave, time, phase);
	const loop = outline(spine, spec.profile, spec.length);

	// Legible, but plainly spent. At 0.4 the outline vanished against the water and
	// completing a task looked like deleting it.
	ctx.globalAlpha = 0.62;

	tracePath(ctx, loop);
	ctx.fillStyle = withAlpha(spec.palette.back, 0.16);
	ctx.fill();

	tracePath(ctx, loop);
	ctx.strokeStyle = withAlpha(spec.palette.back, 0.95);
	ctx.lineWidth = 2.2;
	ctx.stroke();

	// One dot of eye, so the outline still reads as facing somewhere.
	const eye = pointAt(spine, 0.14);
	const half = profileAt(spec.profile, 0.14) * spec.length;
	ctx.beginPath();
	ctx.arc(eye.x, eye.y - half * 0.25, Math.max(1.6, half * 0.22), 0, Math.PI * 2);
	ctx.stroke();

	ctx.globalAlpha = 1;
}
```

Then delete the now-unused `bodyPath` function.

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS. If `drawKoi` or `drawTreatFish` fail to compile, they still reference `bodyPath` — leave `bodyPath` in place until Tasks 10 and 11 and delete it at the end of Task 11 instead.

- [ ] **Step 5: Commit**

```bash
git add src/lib/render/creatures.ts src/lib/render/creatures.test.ts
git commit -m "feat: draw ghosts as bending outlines of their own species"
```

---

### Task 10: Koi as a species

**Files:**
- Modify: `src/lib/render/creatures.ts`
- Modify: `src/lib/render/creatures.test.ts`

**Interfaces:**
- Consumes: `SPECIES.koi`.
- Produces: `drawKoi` reduced to a `drawFish` call plus barbels.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/render/creatures.test.ts`:

```ts
describe('koi', () => {
	it('draws and stays balanced', () => {
		const ctx = fakeCtx();
		const c = creature('koi', { id: 'koi-2026-08-01' });

		drawCreature(ctx, c, place(c, SIZE, 500), COLORS, 500);

		expect(ctx.calls.filter((call) => call === 'fill').length).toBeGreaterThan(0);
		expect(ctx.depth).toBe(0);
	});

	it('swims more slowly than an ordinary fish', () => {
		// The koi is the reward for a cleared day; it should be unhurried.
		expect(SPECIES.koi.wave.speed).toBeLessThan(SPECIES.clown.wave.speed);
	});

	it('is longer than every swimmer', () => {
		for (const name of SWIMMERS) {
			expect(SPECIES.koi.length).toBeGreaterThan(SPECIES[name].length);
		}
	});
});
```

Add `SWIMMERS` to the imports at the top of the test file:

```ts
import { SPECIES, SWIMMERS, speciesFor } from './species';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/render/creatures.test.ts -t koi`
Expected: FAIL — `SWIMMERS is not defined` until the import is added; then the drawing test passes only once `drawKoi` uses the spec.

- [ ] **Step 3: Rewrite `drawKoi`**

Replace the whole `drawKoi` function with:

```ts
/** The cleared-day koi: an ordinary fish body with barbels and a gold rim. */
function drawKoi(ctx: CanvasRenderingContext2D, at: Placement, time: number, seed: number): void {
	const spec = SPECIES.koi;
	drawFish(ctx, at, spec, time, seed);

	// Barbels, the detail that separates a koi from a large goldfish. Drawn after the
	// body so they sit over the head.
	const phase = mix32(seed ^ 0x11) * Math.PI * 2;
	const spine = spineFor(spec.length, spec.wave, time, phase);
	const nose = pointAt(spine, 0.04);

	ctx.strokeStyle = 'rgba(255, 240, 196, 0.85)';
	ctx.lineWidth = 1;
	for (const side of [-1, 1]) {
		ctx.beginPath();
		ctx.moveTo(nose.x, nose.y + side * 2);
		ctx.quadraticCurveTo(nose.x + 7, nose.y + side * 5, nose.x + 4, nose.y + side * 9);
		ctx.stroke();
	}
}
```

Update its call site in `drawCreature`:

```ts
		case 'koi':
			drawKoi(ctx, at, time, hash(creature.id));
			break;
```

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/render/creatures.ts src/lib/render/creatures.test.ts
git commit -m "refactor: draw the koi as a species rather than bespoke code"
```

---

### Task 11: Treat fish as a species

**Files:**
- Modify: `src/lib/render/creatures.ts`
- Modify: `src/lib/render/creatures.test.ts`

**Interfaces:**
- Consumes: `SPECIES.exotic`.
- Produces: `drawTreatFish(ctx, creature, at, time)` rewritten over `drawFish`, keeping the locked/affordable treatment and the halo.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/render/creatures.test.ts`:

```ts
describe('treat fish', () => {
	it('bends the treat fish as it swims', () => {
		// The old bespoke treat body was a fixed path and never bent; this is what
		// actually fails before the rewrite.
		const early = fakeCtx();
		const later = fakeCtx();
		const c = creature('treat', { id: 'treat-1' });

		drawCreature(early, c, place(c, SIZE, 0), COLORS, 0);
		drawCreature(later, c, place(c, SIZE, 1300), COLORS, 1300);

		expect(early.calls.join()).not.toBe(later.calls.join());
	});

	it('draws an affordable treat brighter than a locked one', () => {
		const open = fakeCtx();
		const locked = fakeCtx();
		const c = creature('treat', { id: 'treat-1' });

		drawCreature(open, { ...c, locked: false }, place(c, SIZE, 0), COLORS, 0);
		drawCreature(locked, { ...c, locked: true }, place(c, SIZE, 0), COLORS, 0);

		// The halo and sparkles only exist when you can afford it.
		expect(open.calls.length).toBeGreaterThan(locked.calls.length);
		expect(open.depth).toBe(0);
		expect(locked.depth).toBe(0);
	});

	it('draws a claimed treat as the same exotic fish, in the shoal', () => {
		const ctx = fakeCtx();
		const c = creature('fish', { id: 'bought', claimed: true });

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.calls).toContain('scale');
		expect(ctx.depth).toBe(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/render/creatures.test.ts -t treat`
Expected: FAIL on "bends the treat fish as it swims" — the old treat body is a fixed
path that ignores time.

- [ ] **Step 3: Rewrite `drawTreatFish`**

Replace the body of `drawTreatFish` (keeping its exported behaviour) with:

```ts
function drawTreatFish(
	ctx: CanvasRenderingContext2D,
	creature: Creature,
	at: Placement,
	time: number
): void {
	const affordable = !creature.locked;
	const seed = hash(creature.id);
	const spec = SPECIES.exotic;

	// The largest, most ornate creature in the tank. A guilty pleasure you cannot see
	// is a mechanic that does not exist.
	if (affordable) {
		const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, spec.length);
		halo.addColorStop(0, 'rgba(255, 226, 150, 0.45)');
		halo.addColorStop(0.6, 'rgba(255, 140, 220, 0.16)');
		halo.addColorStop(1, 'rgba(255, 196, 107, 0)');
		ctx.fillStyle = halo;
		ctx.beginPath();
		ctx.arc(0, 0, spec.length, 0, Math.PI * 2);
		ctx.fill();
	}

	// Out of reach reads as a promise, not a corpse: drained, never invisible.
	ctx.globalAlpha = affordable ? 1 : 0.62;
	const muted: SpeciesSpec = affordable
		? spec
		: {
				...spec,
				palette: {
					...spec.palette,
					back: '#c7a8d8',
					belly: '#8e7cb0',
					fin: '#cec4e0'
				}
			};

	drawFish(ctx, at, muted, time, seed);
	ctx.globalAlpha = 1;

	// Sparkles, affordable only: the tell that you can have it now.
	if (affordable) {
		ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
		for (let i = 0; i < 3; i++) {
			const cycle = (((time / 1100 + i * 0.33 + seed) % 1) + 1) % 1;
			ctx.globalAlpha = Math.sin(cycle * Math.PI);
			ctx.beginPath();
			ctx.arc(spec.length * 0.3 - i * 12, -spec.length * 0.35 - cycle * 10, 1.8, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
	}
}
```

Update the claimed-treat branch in `drawCreature` to use the exotic spec:

```ts
		case 'fish':
			if (creature.claimed) {
				ctx.scale(0.72, 0.72);
				drawFish(ctx, at, SPECIES.exotic, time, hash(creature.id));
			} else {
				drawFish(ctx, at, SPECIES[speciesFor(creature.id)], time, hash(creature.id));
			}
			break;
```

Now delete `bodyPath` if it still exists, plus any leftover helpers no longer referenced (`drawTail` and the old `drawEye` if they survive).

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Confirm the bubble's sealed fish still works**

`drawBubble` already calls `drawFish` with a species spec, so it inherits the spine
model for free — but nothing proves it. Add to `src/lib/render/creatures.test.ts`:

```ts
	it('draws a bending fish sealed inside a waiting bubble', () => {
		const early = fakeCtx();
		const later = fakeCtx();
		const c = creature('bubble', { id: 'waiting-task' });

		drawCreature(early, c, place(c, SIZE, 0), COLORS, 0);
		drawCreature(later, c, place(c, SIZE, 1200), COLORS, 1200);

		expect(early.calls).toContain('clip');
		expect(early.calls.join()).not.toBe(later.calls.join());
		expect(early.depth).toBe(0);
	});
```

Run: `npx vitest run src/lib/render/creatures.test.ts -t bubble`
Expected: PASS.

- [ ] **Step 6: Check for dead code**

```bash
grep -n "bodyPath\|drawTail\|laneX" src/lib/render/creatures.ts
```

Expected: no matches. `laneX` has been dead since the lane-centre work; delete it here too.

- [ ] **Step 7: Commit**

```bash
git add src/lib/render/creatures.ts src/lib/render/creatures.test.ts
git commit -m "refactor: draw treats as the exotic species and drop dead code"
```

---

### Task 12: Full verification

**Files:**
- Modify: `docs/follow-ups.md`

- [ ] **Step 1: Run everything**

```bash
npm test
npm run check
npm run build
```

Expected: all unit tests pass, 0 typecheck errors, build succeeds.

- [ ] **Step 2: Run the E2E suite**

```bash
npm run dev &
sleep 5
npm run e2e
```

Expected: 57/57 passed. The suite drives the real UI; if tank tap-to-complete fails, hit-testing and drawing have drifted apart — `place()` was not to be modified by this plan.

- [ ] **Step 3: Look at the tank at 4×**

```bash
npm run screenshot -- /tmp/tank.png
```

Then a 4× crop of the swim area, as used for the pearls. Check, in order:

1. Six species are distinguishable **by outline alone** — squint; a tang should not read as a clown.
2. Bodies flex as they swim; nothing slides rigidly.
3. Fins stay attached and trail the body.
4. Eyes have a visible pupil and glint.
5. Markings wrap the body rather than sitting flat on it.
6. Ghosts read as spent but legible; the koi is unmistakable; the treat fish is the most ornate thing on screen.

- [ ] **Step 4: Check a busy tank**

Seed 20 tasks and screenshot. Expected: no fish leaves the tank, fins do not overlap into a mess, frame rate holds.

- [ ] **Step 5: Update the follow-ups doc**

In `docs/follow-ups.md`, under "4. Visual polish", record what this work closed and what it did not: scale texture and iridescence remain out of scope by design (invisible at 40px), and note that ghosts against a maximally busy tank are now verified if Step 4 covered it.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "docs: record fish anatomy verification and remaining gaps"
```

---

## Notes for the implementer

**Imports in the test file.** Tasks 6, 8, 10 and 11 each need `SPECIES`, `SWIMMERS` or
`speciesFor` in `creatures.test.ts`. Merge them into the single existing import from
`./species` rather than adding a second import statement.


**Why the spine is built by rotation.** Each joint turns by a small angle and the next point is placed one segment away along that heading. Offsetting a straight line vertically would stretch the body as it bends — the fish would visibly grow and shrink. The test "bends without stretching" is the guard.

**Why amplitude ramps with `u * u`.** Fish sweep their tails; their heads stay steady. Constant amplitude along the body makes the whole fish shimmy sideways, which reads as a bug.

**Why fins lag.** A fin that moves in perfect lockstep with the body looks welded to it. The `lag` phase offset is small but it is most of the difference between "alive" and "cardboard".

**What will not work at this size.** Scale texture, iridescent sheen, gradients within a fin. If a step tempts you toward those, it is out of scope by design, not by oversight — see the spec's size section.

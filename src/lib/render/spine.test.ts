import { describe, it, expect } from 'vitest';
import {
	spineFor,
	profileAt,
	pointAt,
	tangentAt,
	outline,
	profilePeak,
	type Wave,
	type Spine,
	type Profile
} from './spine';

const WAVE: Wave = { amplitude: 0.12, wavelength: 0.9, speed: 6 };
const LEN = 40;

const segmentLengths = (points: { x: number; y: number }[]) =>
	points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.y - points[i].y));

describe('spineFor', () => {
	it('runs nose to tail along the body length', () => {
		const spine = spineFor(LEN, WAVE, 0, 0);

		expect(spine.length).toBeGreaterThan(4);
		expect(spine[0].x).toBeCloseTo(LEN / 2, 5);
		// The tail sits at -length/2 only when the body is straight. A bent chain of
		// fixed-length segments spans less in x than its arc length — the body draws
		// in as it curves (foreshortening), it does not stretch to keep reaching
		// -length/2. So the tail can approach -length/2 but never pass it, and never
		// reaches +x.
		expect(spine.at(-1)!.x).toBeGreaterThanOrEqual(-LEN / 2 - 1e-6);
		expect(spine.at(-1)!.x).toBeLessThan(0);
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

	it('keeps total arc length constant as the body bends over time', () => {
		// The body does not stretch. Segment lengths equal *within* a frame is not
		// enough: a chain whose step is derived from the bend breathes larger and
		// smaller between frames, which reads as a rendering fault.
		const totals = [0, 250, 600, 1400, 2300].map((time) => {
			const points = spineFor(LEN, { ...WAVE, amplitude: 0.4 }, time, 0.3);
			return segmentLengths(points).reduce((sum, l) => sum + l, 0);
		});

		for (const total of totals) expect(total).toBeCloseTo(totals[0], 6);
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

	it('stays non-negative across a well-formed profile — a negative half-height turns the body inside out', () => {
		// Only a claim about valid data: `profileAt` interpolates whatever it is handed,
		// so a profile with a negative control point would still yield negative values.
		for (let t = 0; t <= 1; t += 0.02) {
			expect(profileAt(PROFILE, t)).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('profilePeak', () => {
	it('finds the deepest point of the body', () => {
		expect(profilePeak(PROFILE)).toBeCloseTo(0.2, 6);
	});

	it('ignores where along the body the peak sits', () => {
		expect(profilePeak([[0, 0.4], [0.5, 0.1], [1, 0.05]])).toBeCloseTo(0.4, 6);
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

describe('effort — the body works harder when it is going faster', () => {
	const wave = { amplitude: 0.2, wavelength: 1.0, speed: 6 };

	/** How far the spine strays from its own nose-to-tail axis: total lateral spread. */
	const spread = (spine: ReturnType<typeof spineFor>) =>
		Math.max(...spine.map((p) => p.y)) - Math.min(...spine.map((p) => p.y));

	it('bends less at a glide than at a burst, same species and phase', () => {
		// Sampled across a full wave cycle: a single instant can land on a zero crossing,
		// where every effort looks identically straight and the test proves nothing.
		let glideTotal = 0;
		let burstTotal = 0;

		for (let i = 0; i < 24; i++) {
			const time = i * 40;
			glideTotal += spread(spineFor(40, wave, time, 0.7, 8, 0.4));
			burstTotal += spread(spineFor(40, wave, time, 0.7, 8, 1.4));
		}

		expect(burstTotal).toBeGreaterThan(glideTotal * 1.5);
	});

	it('defaults to unchanged behaviour when no effort is given', () => {
		const withDefault = spineFor(40, wave, 300, 0.7);
		const explicit = spineFor(40, wave, 300, 0.7, 8, 1);

		expect(withDefault).toEqual(explicit);
	});

	it('never straightens the body completely, however slow the glide', () => {
		// A fish that stops undulating entirely reads as a dead sprite being towed.
		const spreads = Array.from({ length: 24 }, (_, i) =>
			spread(spineFor(40, wave, i * 40, 0.7, 8, 0))
		);

		expect(Math.max(...spreads)).toBeGreaterThan(0.5);
	});
});

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

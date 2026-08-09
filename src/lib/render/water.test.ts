import { describe, it, expect } from 'vitest';
import { bedTopAt, drawAirBubbles, drawPlants, MAX_AIR_BUBBLE, PLANTS, WATERLINE } from './water';
import { palette } from './palette';

const SIZE = { w: 420, h: 860 };

/** Records every arc drawn, so the bubbles can be measured rather than eyeballed. */
function arcCtx() {
	const arcs: { x: number; y: number; r: number }[] = [];
	const ctx = {
		arcs,
		globalAlpha: 1,
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 0,
		save() {},
		restore() {},
		beginPath() {},
		fill() {},
		stroke() {},
		arc(x: number, y: number, r: number) {
			arcs.push({ x, y, r });
		}
	} as unknown as CanvasRenderingContext2D & { arcs: { x: number; y: number; r: number }[] };

	return ctx;
}

describe('air bubbles', () => {
	it('never approaches the size of a waiting-task bubble', () => {
		// A task bubble is a ~24px-radius sphere with a fish inside, and tapping it
		// releases the task. An ambient bubble at that size would read as a task you
		// cannot tap, so this is about the mechanic, not the styling.
		for (let frame = 0; frame < 240; frame++) {
			const ctx = arcCtx();
			drawAirBubbles(ctx, SIZE, frame * 137);

			for (const arc of ctx.arcs) expect(arc.r).toBeLessThanOrEqual(MAX_AIR_BUBBLE);
		}

		expect(MAX_AIR_BUBBLE).toBeLessThan(24 / 3);
	});

	it('keeps every bubble inside the water', () => {
		for (let frame = 0; frame < 240; frame++) {
			const ctx = arcCtx();
			drawAirBubbles(ctx, SIZE, frame * 137);

			for (const arc of ctx.arcs) {
				expect(arc.x).toBeGreaterThan(0);
				expect(arc.x).toBeLessThan(SIZE.w);
				// Below the surface and above the floor: bubbles do not fly out of the tank.
				expect(arc.y).toBeGreaterThan(WATERLINE - MAX_AIR_BUBBLE);
				expect(arc.y).toBeLessThanOrEqual(SIZE.h);
			}
		}
	});

	it('rises: a stream climbs over time rather than sitting still', () => {
		const heights = [0, 400, 800, 1200].map((time) => {
			const ctx = arcCtx();
			drawAirBubbles(ctx, SIZE, time);
			return Math.min(...ctx.arcs.map((a) => a.y));
		});

		expect(new Set(heights).size).toBeGreaterThan(1);
	});

	it('draws nothing when the water is too murky to carry light', () => {
		const ctx = arcCtx();
		drawAirBubbles(ctx, SIZE, 500, 0);

		expect(ctx.arcs).toEqual([]);
	});

	it('survives a tank shorter than the waterline without drawing below the floor', () => {
		const ctx = arcCtx();
		drawAirBubbles(ctx, { w: 300, h: WATERLINE - 20 }, 500);

		expect(ctx.arcs).toEqual([]);
	});
});

/** Records path coordinates and gradient allocations. */
function pathCtx() {
	const points: { x: number; y: number }[] = [];
	const gradients: string[] = [];
	const gradient = { addColorStop: () => {} };

	const ctx = {
		points,
		gradients,
		globalAlpha: 1,
		fillStyle: '' as unknown,
		strokeStyle: '',
		lineWidth: 0,
		lineCap: 'butt',
		save() {},
		restore() {},
		beginPath() {},
		closePath() {},
		fill() {},
		stroke() {},
		arc() {},
		createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
			gradients.push(`${x0},${y0},${x1},${y1}`);
			return gradient;
		},
		moveTo(x: number, y: number) {
			points.push({ x, y });
		},
		lineTo(x: number, y: number) {
			points.push({ x, y });
		},
		quadraticCurveTo(_cx: number, _cy: number, x: number, y: number) {
			points.push({ x, y });
		}
	} as unknown as CanvasRenderingContext2D & {
		points: { x: number; y: number }[];
		gradients: string[];
	};

	return ctx;
}

const COLORS = palette('calm', 1);

describe('the bed', () => {
	it('gives the sand one surface, shared by everything planted in it', () => {
		// Planting used to root on a flat line while the bed undulated separately, so the
		// blades grew out of nothing. Both now read this.
		const heights = [0, 40, 120, 260, 410].map((x) => bedTopAt(x, SIZE));

		expect(new Set(heights.map((h) => h.toFixed(2))).size).toBeGreaterThan(1);
		for (const h of heights) {
			expect(h).toBeGreaterThan(SIZE.h - 90);
			expect(h).toBeLessThan(SIZE.h);
		}
	});

	it('offers more than one kind of plant, and each is drawable', () => {
		expect(PLANTS.length).toBeGreaterThan(2);
		expect(new Set(PLANTS.map((p) => p.form)).size).toBeGreaterThan(1);

		for (const spec of PLANTS) {
			expect(spec.height).toBeGreaterThan(0);
			expect(spec.width).toBeGreaterThan(0);
			expect(spec.blades).toBeGreaterThan(0);
			expect(spec.stiffness).toBeGreaterThan(0);
		}
	});

	it('keeps the planting in the water, never above the surface', () => {
		const ctx = pathCtx();
		drawPlants(ctx, SIZE, COLORS, 4000);

		expect(ctx.points.length).toBeGreaterThan(50);
		for (const p of ctx.points) {
			expect(p.y).toBeGreaterThan(WATERLINE);
			expect(p.y).toBeLessThanOrEqual(SIZE.h + 8);
		}
	});

	it('sways as a current crossing the tank, not as one organism', () => {
		// Phase used to come from the blade's index, so the whole bed pulsed together.
		// Taken from x, blades far apart are at different points in the gust.
		const spread = (t: number) => {
			const ctx = pathCtx();
			drawPlants(ctx, SIZE, COLORS, t);
			const tips = ctx.points.filter((p) => p.y < SIZE.h - 90);
			return tips;
		};

		const early = spread(1000);
		const later = spread(4000);

		// The bed moves at all...
		expect(early.map((p) => p.x.toFixed(1)).join()).not.toEqual(
			later.map((p) => p.x.toFixed(1)).join()
		);
	});

	it('allocates no gradients per frame while the plants sway', () => {
		// drawPlants runs inside the rAF loop; a blade wash per blade per frame would be
		// hundreds of allocations a second.
		const ctx = pathCtx();

		drawPlants(ctx, SIZE, COLORS, 0);
		const afterOneFrame = ctx.gradients.length;

		for (let frame = 1; frame < 30; frame++) drawPlants(ctx, SIZE, COLORS, frame * 100);

		expect(afterOneFrame).toBeGreaterThan(0);
		expect(ctx.gradients.length).toBe(afterOneFrame);
	});
});

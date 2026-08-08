import { describe, it, expect } from 'vitest';
import { drawAirBubbles, MAX_AIR_BUBBLE, WATERLINE } from './water';

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

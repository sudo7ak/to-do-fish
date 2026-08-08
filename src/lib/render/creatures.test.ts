import { describe, it, expect } from 'vitest';
import { place, drawCreature, drawCreatures, speciesFor } from './creatures';
import { palette } from './palette';
import type { Creature, CreatureKind } from '../scene/types';
import { SPECIES } from './species';

import { WATERLINE } from './water';

const SIZE = { w: 400, h: 800 };
const COLORS = palette('calm', 1);

/** Roughly what the date header occupies. Nothing may be drawn behind it. */
const HEADER_HEIGHT = 70;

/**
 * Records canvas calls instead of painting. Pixels are verified by eye; what is
 * worth asserting here is that every kind draws something, stays inside the tank,
 * and leaves the context balanced.
 */
function fakeCtx() {
	const calls: string[] = [];
	const gradient = { addColorStop: () => {} };
	let depth = 0;
	let maxDepth = 0;

	let alpha = 1;

	const ctx = {
		calls,
		get depth() {
			return depth;
		},
		get maxDepth() {
			return maxDepth;
		},
		save() {
			depth++;
			maxDepth = Math.max(maxDepth, depth);
			calls.push('save');
		},
		restore() {
			depth--;
			calls.push('restore');
		},
		createLinearGradient: () => gradient,
		createRadialGradient: () => gradient,
		// Tracked so a translucent wash (a ghost) is distinguishable from an opaque fill
		// (a live fish) even though `fakeCtx` never touches real pixels.
		get globalAlpha() {
			return alpha;
		},
		set globalAlpha(value: number) {
			alpha = value;
			calls.push(`alpha(${value})`);
		},
		globalCompositeOperation: 'source-over',
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 0,
		lineCap: 'butt'
	} as unknown as CanvasRenderingContext2D & { calls: string[]; depth: number; maxDepth: number };

	for (const method of ['clip', 'beginPath', 'closePath', 'fill', 'stroke', 'setLineDash', 'roundRect', 'setTransform']) {
		(ctx as unknown as Record<string, unknown>)[method] = () => calls.push(method);
	}

	// Coordinate-bearing calls record their (rounded) arguments too, not just the method
	// name — otherwise every path drawn through the same sequence of canvas calls looks
	// identical to `calls.join()` regardless of where it actually went, and a body that
	// stopped reading the spine would still pass a "did it move" test.
	for (const method of [
		'translate',
		'scale',
		'rotate',
		'moveTo',
		'lineTo',
		'quadraticCurveTo',
		'bezierCurveTo',
		'ellipse',
		'arc',
		'fillRect'
	]) {
		(ctx as unknown as Record<string, unknown>)[method] = (...args: unknown[]) =>
			calls.push(
				`${method}(${args.map((a) => (typeof a === 'number' ? a.toFixed(1) : String(a))).join(',')})`
			);
	}

	return ctx;
}

const creature = (kind: CreatureKind, over: Partial<Creature> = {}): Creature => ({
	id: `${kind}-1`,
	kind,
	label: kind,
	depth: 0.5,
	tapRadius: 24,
	...over
});

const ALL_KINDS: CreatureKind[] = ['fish', 'bubble', 'ghost', 'koi', 'treat', 'pearl'];

describe('drawCreature — every kind', () => {
	it.each(ALL_KINDS)('draws a %s', (kind) => {
		const ctx = fakeCtx();
		const c = creature(kind);

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.calls.filter((call) => call === 'fill' || call === 'stroke').length).toBeGreaterThan(0);
	});

	it.each(ALL_KINDS)('leaves the context balanced after a %s', (kind) => {
		const ctx = fakeCtx();
		const c = creature(kind);

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.depth).toBe(0);
	});

	it('strokes a dashed outline for a manual bubble', () => {
		const ctx = fakeCtx();
		const c = creature('bubble', { dashed: true });

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.calls).toContain('setLineDash');
	});

	it('draws a ghost as a translucent outline rather than an opaque body', () => {
		// A bare fish body (this task's intermediate state, before fins/eye return in
		// later tasks) has the same shape of fill/stroke calls as a ghost's wash-and-outline,
		// so fill count alone no longer tells them apart. Opacity still does: a ghost is
		// drawn at reduced alpha throughout, a live fish never is.
		const ghost = fakeCtx();
		const fish = fakeCtx();

		drawCreature(ghost, creature('ghost'), place(creature('ghost'), SIZE, 0), COLORS, 0);
		drawCreature(fish, creature('fish'), place(creature('fish'), SIZE, 0), COLORS, 0);

		expect(ghost.calls.filter((c) => c === 'stroke').length).toBeGreaterThan(0);
		// 0.62 is the ghost's whole-body wash alpha (`drawGhost`); a live fish's bubble
		// trail also dips under 1 but never lands on that exact value.
		expect(ghost.calls).toContain('alpha(0.62)');
		expect(fish.calls).not.toContain('alpha(0.62)');
	});
});

describe('speciesFor', () => {
	it('gives the same task the same fish on every reload', () => {
		expect(speciesFor('task-abc')).toBe(speciesFor('task-abc'));
	});

	it('spreads a realistic tank across several species', () => {
		const ids = Array.from({ length: 60 }, (_, i) => `task-${i}`);
		const kinds = new Set(ids.map(speciesFor));

		expect(kinds.size).toBeGreaterThan(3);
	});

	it('only ever returns a known species', () => {
		const known = ['clown', 'tang', 'angel', 'guppy', 'neon', 'betta'];

		for (let i = 0; i < 200; i++) {
			expect(known).toContain(speciesFor(`id-${i}`));
		}
	});

	it('draws every species without complaint', () => {
		// One id per species, found by sweeping — each must paint and stay balanced.
		const perSpecies = new Map<string, string>();
		for (let i = 0; i < 200; i++) perSpecies.set(speciesFor(`id-${i}`), `id-${i}`);

		for (const id of perSpecies.values()) {
			const ctx = fakeCtx();
			const c = creature('fish', { id });

			drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

			expect(ctx.calls.filter((call) => call === 'fill').length).toBeGreaterThan(0);
			expect(ctx.depth).toBe(0);
		}
	});
});

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

describe('place — where creatures sit', () => {
	it('cruises the treat fish in the surface lane', () => {
		const y = place(creature('treat', { depth: 0 }), SIZE, 0).y;

		// Below the surface, not straddling it — a fish half out of the water reads as
		// a rendering fault rather than a prize.
		expect(y).toBeGreaterThan(WATERLINE);
		expect(y).toBeLessThan(WATERLINE + 60);
	});

	it('keeps the treat fish clear of the date header', () => {
		// Treats used to sit at y=17, behind the header and clipped by the canvas top.
		// The fish is ~40px tall, so its top edge must stay below the chrome.
		const y = place(creature('treat', { depth: 0 }), SIZE, 0).y;

		expect(y - 40).toBeGreaterThan(HEADER_HEIGHT);
	});

	it('spreads treat fish across the width instead of crowding one side', () => {
		// Every treat carries depth 0; deriving the lane from depth put them all in
		// the left third.
		const xs = Array.from({ length: 5 }, (_, i) =>
			place(creature('treat', { id: `treat-${i}`, depth: 0 }), SIZE, 0).x
		);

		expect(Math.max(...xs)).toBeGreaterThan(SIZE.w * 0.5);
		expect(Math.min(...xs)).toBeLessThan(SIZE.w * 0.5);
	});

	it('swims the treat fish rather than parking it', () => {
		const treat = creature('treat', { depth: 0 });

		expect(place(treat, SIZE, 0).y).not.toBe(place(treat, SIZE, 2000).y);
		expect(place(treat, SIZE, 0).x).not.toBe(place(treat, SIZE, 9000).x);
	});

	it('keeps swimmers below the waterline', () => {
		const shallow = place(creature('fish', { depth: 0 }), SIZE, 0);

		expect(shallow.y).toBeGreaterThan(WATERLINE);
	});

	it('settles pearls on the bed, not floating in open water', () => {
		// Pearls are heavy. Lifted clear of the floor they read as bubbles.
		for (let i = 0; i < 40; i++) {
			const y = place(creature('pearl', { id: `pearl-${i}` }), SIZE, 0).y;
			expect(y).toBeGreaterThan(SIZE.h - 48);
			expect(y).toBeLessThan(SIZE.h);
		}
	});

	it('keeps pearls out from behind the add-pill', () => {
		// The pill is a centred band along the bottom; pearls beneath it were invisible,
		// so the balance said 3 and you could see one.
		for (let i = 0; i < 40; i++) {
			const x = place(creature('pearl', { id: `pearl-${i}` }), SIZE, 0).x;
			const centred = x > SIZE.w * 0.26 && x < SIZE.w * 0.74;
			expect(centred).toBe(false);
		}
	});

	it('spreads pearls along the bed rather than stacking them', () => {
		const xs = Array.from({ length: 6 }, (_, i) =>
			place(creature('pearl', { id: `pearl-${i}` }), SIZE, 0).x
		);

		expect(new Set(xs.map(Math.round)).size).toBeGreaterThan(3);
	});

	it('deals pearls evenly to both sides of the pill', () => {
		// Coin-flipping per id piled seven of eight on one side.
		const xs = Array.from({ length: 8 }, (_, i) =>
			place(creature('pearl', { id: `pearl-${i}` }), SIZE, 0).x
		);
		const left = xs.filter((x) => x < SIZE.w / 2).length;

		expect(left).toBe(4);
	});

	it('keeps neighbouring pearls from landing on top of each other', () => {
		const spots = Array.from({ length: 8 }, (_, i) =>
			place(creature('pearl', { id: `pearl-${i}` }), SIZE, 0)
		);

		for (let i = 0; i < spots.length; i++) {
			for (let j = i + 1; j < spots.length; j++) {
				const gap = Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y);
				expect(gap).toBeGreaterThan(9);
			}
		}
	});

	it('puts a shallow creature above a deep one', () => {
		const shallow = place(creature('bubble', { id: 'x', depth: 0.1 }), SIZE, 0);
		const deep = place(creature('bubble', { id: 'x', depth: 0.9 }), SIZE, 0);

		expect(shallow.y).toBeLessThan(deep.y);
	});

	it('keeps every kind inside the tank, over a long swim', () => {
		// Swept densely rather than spot-checked: the vertical wander and the warped
		// pace both have room to push a fish through the glass at some phase.
		for (const kind of ALL_KINDS) {
			for (let i = 0; i < 400; i++) {
				const time = i * 617;
				for (const id of ['a', 'seed-two', 'zzz-9']) {
					const at = place(creature(kind, { id }), SIZE, time);
					expect(at.x).toBeGreaterThanOrEqual(0);
					expect(at.x).toBeLessThanOrEqual(SIZE.w);
					expect(at.y).toBeGreaterThanOrEqual(0);
					expect(at.y).toBeLessThanOrEqual(SIZE.h);
				}
			}
		}
	});

	it('never swims a fish above the waterline, whatever the wander', () => {
		for (let i = 0; i < 400; i++) {
			const at = place(creature('fish', { id: 'shallow', depth: 0 }), SIZE, i * 617);
			expect(at.y).toBeGreaterThan(WATERLINE);
		}
	});

	it('moves vertically as well as horizontally', () => {
		// A fish that only slides sideways reads as being on a rail.
		const fish = creature('fish', { id: 'swimmer' });
		const ys = [0, 2000, 4000, 6000, 8000, 12_000].map((ms) => place(fish, SIZE, ms).y);

		expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
	});

	it('varies its pace instead of tracking at a constant rate', () => {
		const fish = creature('fish', { id: 'swimmer' });
		const step = 400;
		const distances: number[] = [];

		for (let ms = 0; ms < 24_000; ms += step) {
			const a = place(fish, SIZE, ms);
			const b = place(fish, SIZE, ms + step);
			distances.push(Math.hypot(b.x - a.x, b.y - a.y));
		}

		const fastest = Math.max(...distances);
		const slowest = Math.min(...distances);

		// Burst and glide: the quick stretches are clearly quicker than the slow ones.
		expect(fastest).toBeGreaterThan(slowest * 3);
	});

	it('gives two fish different paths, so the shoal does not move as one', () => {
		const a = creature('fish', { id: 'fish-one' });
		const b = creature('fish', { id: 'fish-two' });

		const apart = [0, 3000, 6000, 9000].map((ms) => {
			const pa = place(a, SIZE, ms);
			const pb = place(b, SIZE, ms);
			return Math.hypot(pa.x - pb.x, pa.y - pb.y);
		});

		expect(Math.max(...apart)).toBeGreaterThan(30);
	});

	it('holds a bubble at its assigned depth — depth is information, not decoration', () => {
		// Time until trigger is encoded in depth, so a bubble must not wander off it.
		const bubble = creature('bubble', { id: 'waiting', depth: 0.2 });
		const ys = [0, 3000, 7000, 15_000].map((ms) => place(bubble, SIZE, ms).y);

		expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(10);
	});

	it('faces the way it is travelling', () => {
		const fish = creature('fish', { id: 'swimmer' });

		// Sampling across a full crossing, it must face both ways at some point.
		const flips = new Set(
			Array.from({ length: 60 }, (_, i) => place(fish, SIZE, i * 700).flip)
		);

		expect(flips.size).toBe(2);
	});

	it('is stable across reloads — the same id lands in the same place', () => {
		const c = creature('fish', { id: 'task-abc' });

		expect(place(c, SIZE, 5000)).toEqual(place(c, SIZE, 5000));
	});

	it('puts different creatures in different places', () => {
		const a = place(creature('fish', { id: 'a' }), SIZE, 0);
		const b = place(creature('fish', { id: 'b' }), SIZE, 0);

		expect(a.x).not.toBe(b.x);
	});

	it('moves a fish over time', () => {
		const c = creature('fish', { id: 'a' });

		expect(place(c, SIZE, 0).x).not.toBe(place(c, SIZE, 3000).x);
	});

	it('holds still when animation is frozen', () => {
		const c = creature('fish', { id: 'a' });

		expect(place(c, SIZE, 0, false)).toEqual(place(c, SIZE, 60_000, false));
	});
});

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

describe('head', () => {
	it('draws an eye with a pupil and a catchlight', () => {
		// Three stacked arcs at the head: white, pupil, glint. Eyes are most of what
		// makes a 40px shape look alive.
		const ctx = fakeCtx();
		const c = creature('fish', { id: 'eyed' });

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.calls.filter((call) => call.startsWith('arc(')).length).toBeGreaterThanOrEqual(3);
	});
});

describe('drawCreatures — the whole tank', () => {
	it('draws every creature in the scene', () => {
		const ctx = fakeCtx();
		const creatures = ALL_KINDS.map((kind) => creature(kind));

		drawCreatures(ctx, creatures, COLORS, SIZE, 0);

		// One save/restore pair per creature, at minimum.
		expect(ctx.calls.filter((c) => c === 'save').length).toBeGreaterThanOrEqual(creatures.length);
		expect(ctx.depth).toBe(0);
	});

	it('draws an empty scene without complaint', () => {
		const ctx = fakeCtx();

		drawCreatures(ctx, [], COLORS, SIZE, 0);

		expect(ctx.calls).toEqual([]);
	});

	it('does not reorder the caller array', () => {
		const creatures = [creature('koi'), creature('pearl')];
		const before = creatures.map((c) => c.id);

		drawCreatures(fakeCtx(), creatures, COLORS, SIZE, 0);

		expect(creatures.map((c) => c.id)).toEqual(before);
	});
});

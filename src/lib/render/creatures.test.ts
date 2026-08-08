import { describe, it, expect } from 'vitest';
import { place, drawCreature, drawCreatures, speciesFor } from './creatures';
import { palette } from './palette';
import type { Creature, CreatureKind } from '../scene/types';

const SIZE = { w: 400, h: 800 };
const COLORS = palette('calm', 1);

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
		globalAlpha: 1,
		globalCompositeOperation: 'source-over',
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 0,
		lineCap: 'butt'
	} as unknown as CanvasRenderingContext2D & { calls: string[]; depth: number; maxDepth: number };

	for (const method of [
		'translate',
		'scale',
		'rotate',
		'clip',
		'beginPath',
		'moveTo',
		'lineTo',
		'quadraticCurveTo',
		'bezierCurveTo',
		'ellipse',
		'closePath',
		'arc',
		'fill',
		'stroke',
		'setLineDash',
		'fillRect',
		'roundRect',
		'setTransform'
	]) {
		(ctx as unknown as Record<string, unknown>)[method] = () => calls.push(method);
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

const ALL_KINDS: CreatureKind[] = ['fish', 'bubble', 'ghost', 'koi', 'lantern', 'pearl'];

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

	it('draws a ghost as an outline rather than a filled body', () => {
		const ghost = fakeCtx();
		const fish = fakeCtx();

		drawCreature(ghost, creature('ghost'), place(creature('ghost'), SIZE, 0), COLORS, 0);
		drawCreature(fish, creature('fish'), place(creature('fish'), SIZE, 0), COLORS, 0);

		expect(ghost.calls.filter((c) => c === 'stroke').length).toBeGreaterThan(0);
		expect(fish.calls.filter((c) => c === 'fill').length).toBeGreaterThan(
			ghost.calls.filter((c) => c === 'fill').length
		);
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

describe('place — where creatures sit', () => {
	it('rests a lantern at the waterline', () => {
		expect(place(creature('lantern', { depth: 0 }), SIZE, 0).y).toBeLessThan(40);
	});

	it('settles a pearl on the floor', () => {
		expect(place(creature('pearl', { depth: 1 }), SIZE, 0).y).toBeGreaterThan(SIZE.h - 30);
	});

	it('puts a shallow creature above a deep one', () => {
		const shallow = place(creature('bubble', { id: 'x', depth: 0.1 }), SIZE, 0);
		const deep = place(creature('bubble', { id: 'x', depth: 0.9 }), SIZE, 0);

		expect(shallow.y).toBeLessThan(deep.y);
	});

	it('keeps every kind inside the tank', () => {
		for (const kind of ALL_KINDS) {
			for (const time of [0, 1234, 98_765]) {
				const at = place(creature(kind), SIZE, time);
				expect(at.x).toBeGreaterThanOrEqual(0);
				expect(at.x).toBeLessThanOrEqual(SIZE.w);
				expect(at.y).toBeGreaterThanOrEqual(0);
				expect(at.y).toBeLessThanOrEqual(SIZE.h);
			}
		}
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

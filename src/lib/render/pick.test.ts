import { describe, it, expect } from 'vitest';
import { pick, type Point } from './pick';
import { place } from './creatures';
import type { Creature, CreatureKind } from '../scene/types';

const SIZE = { w: 400, h: 800 };
const TIME = 0;

const creature = (id: string, kind: CreatureKind = 'fish', over: Partial<Creature> = {}): Creature => ({
	id,
	kind,
	taskId: id,
	label: id,
	depth: 0.5,
	tapRadius: 24,
	...over
});

/** Where the renderer actually put this creature — the only coordinates worth testing against. */
const at = (c: Creature) => place(c, SIZE, TIME);

describe('pick — hits and misses', () => {
	it('finds a creature tapped dead centre', () => {
		const fish = creature('a');
		const { x, y } = at(fish);

		expect(pick([fish], { x, y }, SIZE, TIME)).toBe(fish);
	});

	it('finds a creature tapped just inside its radius', () => {
		const fish = creature('a');
		const { x, y } = at(fish);

		expect(pick([fish], { x: x + 20, y }, SIZE, TIME)).toBe(fish);
	});

	it('misses a tap just outside the radius', () => {
		const fish = creature('a');
		const { x, y } = at(fish);

		expect(pick([fish], { x: x + 30, y }, SIZE, TIME)).toBeNull();
	});

	it('misses a tap in open water', () => {
		const fish = creature('a');
		const { x, y } = at(fish);

		expect(pick([fish], { x: x + 200, y: y + 200 }, SIZE, TIME)).toBeNull();
	});

	it('returns null for an empty tank', () => {
		expect(pick([], { x: 10, y: 10 }, SIZE, TIME)).toBeNull();
	});

	it('respects each creature own radius — a pearl is a smaller target than a koi', () => {
		const pearl = creature('p', 'pearl', { tapRadius: 8 });
		const { x, y } = at(pearl);

		expect(pick([pearl], { x: x + 6, y }, SIZE, TIME)).toBe(pearl);
		expect(pick([pearl], { x: x + 14, y }, SIZE, TIME)).toBeNull();
	});
});

describe('pick — overlapping creatures', () => {
	it('gives the tap to whichever centre is nearer', () => {
		// Radii wide enough that both genuinely contain the tap — otherwise this
		// would pass by one of them simply being out of range.
		const a = creature('a', 'fish', { tapRadius: 400 });
		const b = creature('b', 'fish', { tapRadius: 400 });
		const posA = at(a);
		const posB = at(b);

		const nearerA = { x: posA.x + (posB.x - posA.x) * 0.2, y: posA.y + (posB.y - posA.y) * 0.2 };

		const within = (p: Point, c: Creature) => Math.hypot(p.x - at(c).x, p.y - at(c).y) <= c.tapRadius;
		expect(within(nearerA, a)).toBe(true);
		expect(within(nearerA, b)).toBe(true);

		expect(pick([a, b], nearerA, SIZE, TIME)).toBe(a);
		expect(pick([b, a], nearerA, SIZE, TIME)).toBe(a);
	});

	it('prefers the creature drawn on top when two centres coincide', () => {
		// A pearl and a koi at the same point: the koi is drawn over the pearl, so
		// that is the one the user believes they are tapping.
		const pearl = creature('same', 'pearl', { tapRadius: 30 });
		const koi = creature('same', 'koi', { tapRadius: 30 });
		const { x, y } = at(koi);

		expect(pick([pearl, koi], { x, y }, SIZE, TIME)).toBe(koi);
		// Order in the array must not decide it.
		expect(pick([koi, pearl], { x, y }, SIZE, TIME)).toBe(koi);
	});
});

describe('pick — agreement with the renderer', () => {
	it('follows a creature as it swims', () => {
		const fish = creature('a');
		const early = place(fish, SIZE, 0);
		const later = place(fish, SIZE, 4000);

		expect(pick([fish], { x: early.x, y: early.y }, SIZE, 0)).toBe(fish);
		expect(pick([fish], { x: later.x, y: later.y }, SIZE, 4000)).toBe(fish);
	});

	it('uses the frozen position under reduced motion', () => {
		const fish = creature('a');
		const frozen = place(fish, SIZE, 0, false);

		expect(pick([fish], { x: frozen.x, y: frozen.y }, SIZE, 99_999, false)).toBe(fish);
	});

	it('never picks a creature the renderer put elsewhere', () => {
		// Sweeping the tank, every hit must be within the radius of where it was drawn.
		const creatures = [creature('a'), creature('b', 'koi'), creature('c', 'lantern')];

		for (let x = 0; x < SIZE.w; x += 20) {
			for (let y = 0; y < SIZE.h; y += 40) {
				const hit = pick(creatures, { x, y }, SIZE, TIME);
				if (!hit) continue;
				const pos = place(hit, SIZE, TIME);
				expect(Math.hypot(x - pos.x, y - pos.y)).toBeLessThanOrEqual(hit.tapRadius);
			}
		}
	});
});

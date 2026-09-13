import { describe, it, expect } from 'vitest';
import { labelable, clampLabelX, declutterLabels } from './reveal';
import type { Creature, CreatureKind } from '../scene/types';

const creature = (id: string, kind: CreatureKind, over: Partial<Creature> = {}): Creature => ({
	id,
	kind,
	label: id,
	depth: 0.5,
	tapRadius: 24,
	...over
});

describe('labelable', () => {
	it('keeps creatures that tapping would open a sheet for', () => {
		const fish = creature('a', 'fish', { taskId: 'a' });
		const bubble = creature('b', 'bubble', { taskId: 'b' });

		expect(labelable([fish, bubble])).toEqual([fish, bubble]);
	});

	it('drops pearls and koi — neither stands for a single task', () => {
		const pearl = creature('pearl-0', 'pearl');
		const koi = creature('koi-2026-08-08', 'koi');

		expect(labelable([pearl, koi])).toEqual([]);
	});

	it('keeps the sync fish even though it has no taskId of its own', () => {
		// Same carve-out as the hint fish: not a task, but its status is worth
		// reading on the same tap that reveals everything else, rather than only
		// living as a colour someone has to already know how to interpret.
		const sync = creature('sync', 'sync');

		expect(labelable([sync])).toEqual([sync]);
	});

	it('drops the treat overflow marker, which has no taskId of its own', () => {
		const overflow = creature('treat-overflow', 'treat');
		const realTreat = creature('t-1', 'treat', { taskId: 't-1' });

		expect(labelable([overflow, realTreat])).toEqual([realTreat]);
	});

	it('returns an empty list for an empty tank', () => {
		expect(labelable([])).toEqual([]);
	});

	it('keeps the hint fish even though it has no taskId of its own', () => {
		// Not a real task, so it fails the `taskId` test everything else in this
		// function goes by — but revealing it is the entire point of tapping water in
		// the first place, so it needs its own carve-out rather than the general rule.
		const hint = creature('hint', 'hint');

		expect(labelable([hint])).toEqual([hint]);
	});
});

describe('clampLabelX', () => {
	// The pill is centred on the fish, so a fish hard against the glass would
	// otherwise centre a ~120px-wide pill half off the edge, sliced by the
	// overlay's own clip — this is what actually happened in a screenshot.
	it('leaves a fish in open water untouched', () => {
		expect(clampLabelX(200, 400)).toBe(200);
	});

	it('pulls a label near the left glass in from the edge', () => {
		expect(clampLabelX(5, 400)).toBeGreaterThanOrEqual(62);
	});

	it('pulls a label near the right glass in from the edge', () => {
		expect(clampLabelX(395, 400)).toBeLessThanOrEqual(400 - 62);
	});
});

describe('declutterLabels', () => {
	// Regression: on a narrow phone screen a task's label landed directly on top
	// of the sync fish's own "Not signed in" label. Both axes have to be close for
	// two pills to actually overlap, so only a collision on both should move one.
	it('leaves labels alone when nothing overlaps', () => {
		const points = [
			{ id: 'a', x: 50, y: 100 },
			{ id: 'b', x: 300, y: 100 }
		];

		expect(declutterLabels(points)).toEqual(points);
	});

	it('pushes a colliding label down, away from the first', () => {
		const points = [
			{ id: 'sync', x: 60, y: 40 },
			{ id: 'task', x: 65, y: 45 }
		];

		const result = declutterLabels(points);
		expect(result[0]).toEqual({ id: 'sync', x: 60, y: 40 });
		expect(result[1].y).toBeGreaterThanOrEqual(40 + 22);
	});

	it('does not move labels that only share one axis', () => {
		const points = [
			{ id: 'a', x: 60, y: 40 },
			{ id: 'b', x: 60, y: 400 }
		];

		expect(declutterLabels(points)).toEqual(points);
	});

	it('keeps resolving a chain of collisions rather than stopping at the first', () => {
		const points = [
			{ id: 'a', x: 60, y: 40 },
			{ id: 'b', x: 60, y: 40 },
			{ id: 'c', x: 60, y: 40 }
		];

		const result = declutterLabels(points);
		const ys = result.map((p) => p.y);
		expect(new Set(ys).size).toBe(3);
	});
});

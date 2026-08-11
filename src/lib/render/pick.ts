import type { Creature } from '../scene/types';
import { place } from './creatures';
import type { Size } from './water';

/**
 * Pointer picking. A canvas offers no hit-testing, so this is hand-rolled against
 * each creature's own tap radius.
 *
 * Positions come from `place()` — the same function the renderer used. Deriving
 * coordinates independently here would let picking and drawing drift apart, and a
 * tap that misses the fish you can plainly see is worse than no tapping at all.
 *
 * The List view (S18) exists because this is still a pointer-only affordance: it
 * offers nothing to a keyboard or a screen reader.
 */

export type Point = { x: number; y: number };

/** Later in this order means drawn on top, so it wins a tie. Mirrors `drawCreatures`. */
const STACKING: Record<Creature['kind'], number> = {
	pearl: 0,
	bubble: 1,
	ghost: 2,
	fish: 3,
	koi: 4,
	treat: 5,
	sync: 6
};

export function pick(
	creatures: Creature[],
	point: Point,
	size: Size,
	time: number,
	animate = true
): Creature | null {
	let best: Creature | null = null;
	let bestDistance = Infinity;

	for (const creature of creatures) {
		const at = place(creature, size, time, animate);
		const distance = Math.hypot(point.x - at.x, point.y - at.y);

		if (distance > creature.tapRadius) continue;

		if (distance < bestDistance) {
			best = creature;
			bestDistance = distance;
			continue;
		}

		// Equal distance: the one painted on top is the one the user thinks they hit.
		if (distance === bestDistance && best && STACKING[creature.kind] > STACKING[best.kind]) {
			best = creature;
		}
	}

	return best;
}

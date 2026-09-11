import type { Creature } from '../scene/types';

/**
 * Which creatures get a title label when a tap on open water reveals the whole
 * tank at once — every creature that stands for a real task.
 *
 * `taskId` is absent on exactly the creatures a tap cannot open a sheet for: pearls,
 * koi, the sync prototype, and the treat overflow marker. Reusing that field keeps
 * this in step with `pick.ts`'s own reading of the same absence rather than
 * re-deriving "which creature is a task" a second way.
 */
export function labelable(creatures: Creature[]): Creature[] {
	return creatures.filter((creature) => creature.taskId);
}

/**
 * Keeps a label's centre far enough from the glass that its pill — centred on the
 * fish, up to ~120px wide — does not get sliced by the overlay's own edge clip. A
 * fish right against the wall would otherwise centre the pill half off-screen.
 */
export function clampLabelX(x: number, width: number, margin = 62): number {
	return Math.min(width - margin, Math.max(margin, x));
}

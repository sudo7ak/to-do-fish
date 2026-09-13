import type { Creature } from '../scene/types';

/**
 * Which creatures get a title label when a tap on open water reveals the whole
 * tank at once — every creature that stands for a real task, plus the hint fish
 * and the sync fish.
 *
 * `taskId` is absent on exactly the creatures a tap cannot open a sheet for: pearls,
 * koi, the sync prototype, and the treat overflow marker. Reusing that field keeps
 * this in step with `pick.ts`'s own reading of the same absence rather than
 * re-deriving "which creature is a task" a second way. The hint fish and the sync
 * fish are the deliberate exceptions — neither has a `taskId`, but both carry
 * information worth reading in words rather than only as a colour someone has to
 * already know how to interpret.
 */
export function labelable(creatures: Creature[]): Creature[] {
	return creatures.filter(
		(creature) => creature.taskId || creature.kind === 'hint' || creature.kind === 'sync'
	);
}

/**
 * Keeps a label's centre far enough from the glass that its pill — centred on the
 * fish, up to ~168px wide (`.reveal-label__pill`'s `max-width`) — does not get
 * sliced by the overlay's own edge clip. A fish right against the wall would
 * otherwise centre the pill half off-screen.
 */
export function clampLabelX(x: number, width: number, margin = 90): number {
	return Math.min(width - margin, Math.max(margin, x));
}

export type LabelPoint = { id: string; x: number; y: number };

/**
 * A pill is up to 120px wide and about 22px tall. Two labels whose centres land
 * closer than this on both axes read as stacked on top of each other — this is
 * what actually happened between a fish's label and the sync fish's own label on
 * a narrow phone screen, where the horizontal spread of `place()` is compressed.
 */
const MIN_GAP_X = 90;
const MIN_GAP_Y = 22;

/**
 * Pushes a label straight down, in input order, past any earlier label it would
 * otherwise overlap. Input order comes from `scene.creatures`, which is built
 * deterministically from task ids, so the same tank always resolves collisions
 * the same way rather than jittering between taps.
 */
export function declutterLabels(points: LabelPoint[]): LabelPoint[] {
	const placed: LabelPoint[] = [];

	for (const point of points) {
		let y = point.y;
		let collided = true;
		while (collided) {
			collided = false;
			for (const other of placed) {
				if (Math.abs(point.x - other.x) < MIN_GAP_X && Math.abs(y - other.y) < MIN_GAP_Y) {
					y = other.y + MIN_GAP_Y;
					collided = true;
				}
			}
		}
		placed.push({ id: point.id, x: point.x, y });
	}

	return placed;
}

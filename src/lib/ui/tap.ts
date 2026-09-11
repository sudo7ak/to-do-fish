import type { Point } from '../render/pick';

/**
 * Resolves a pointerdown/pointerup pair into the point and render time to hit-test
 * against, or null if the gesture was a scroll rather than a tap.
 *
 * Picking uses the point and time captured at pointerdown — the instant the user
 * aimed — rather than pointerup's. A fish keeps swimming for the length of the
 * gesture, so hit-testing against where it ended up, instead of where it was aimed
 * at, turns a tap on a moving fish into a near-miss.
 */
export type TapOrigin = {
	id: number;
	clientX: number;
	clientY: number;
	point: Point;
	time: number;
};

export function resolveTap(
	origin: TapOrigin | null,
	release: { id: number; clientX: number; clientY: number },
	slop: number
): { point: Point; time: number } | null {
	if (!origin || origin.id !== release.id) return null;

	const moved = Math.hypot(release.clientX - origin.clientX, release.clientY - origin.clientY);
	if (moved > slop) return null;

	return { point: origin.point, time: origin.time };
}

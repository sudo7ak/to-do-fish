/**
 * The centreline a fish is built on.
 *
 * A travelling sine wave runs nose to tail. Amplitude grows toward the tail, so the
 * nose stays steady and the tail sweeps — which is how fish actually swim, and the
 * reason a rigid body sliding sideways reads as a sticker.
 *
 * Pure geometry. No canvas, no colour, no dependencies.
 */

export type Point = { x: number; y: number };
export type Spine = Point[];

export type Wave = {
	/** Tail sweep, as a fraction of body length. */
	amplitude: number;
	/** Body lengths per wave cycle. Below 1 means more than one crest along the fish. */
	wavelength: number;
	/** Radians per second. */
	speed: number;
};

const DEFAULT_SEGMENTS = 8;

/**
 * Builds a spine of `segments + 1` points, nose first, facing +x.
 *
 * The chain is built by rotation, not by offsetting a straight line: each joint turns
 * by a per-segment angle and every segment uses the same fixed `step = length /
 * segments`. That keeps every segment the same length *within one call* — a bent
 * chain does not stretch or compress relative to itself in a single frame — but this
 * says nothing about frame-to-frame behaviour by itself; see below.
 *
 * `step` is fixed, not derived from the bend. A real fish's body does not stretch, so
 * its arc length is constant over time; deriving `step` from the instantaneous bend
 * (e.g. to pin the tail to exactly `-length/2`) would make arc length a function of
 * how much the fish is bending *right now*, so the body's total length would visibly
 * breathe in and out frame to frame as the wave animates — a subtler version of the
 * stretch bug this task exists to prevent. The nose is anchored at `+length/2`; the
 * tail is not pinned to `-length/2` — see the interface note in `spineFor`'s test file
 * for why that assertion was withdrawn.
 */
export function spineFor(
	length: number,
	wave: Wave,
	time: number,
	phase: number,
	segments: number = DEFAULT_SEGMENTS
): Spine {
	const t = time / 1000;
	const step = length / segments;

	const points: Spine = [{ x: length / 2, y: 0 }];
	for (let i = 1; i <= segments; i++) {
		const u = i / segments; // 0 at nose, 1 at tail
		// Amplitude ramps in along the body: the head barely moves, the tail sweeps.
		const ramp = u * u;
		const bend = Math.sin(t * wave.speed + phase - (u * Math.PI * 2) / wave.wavelength);
		const angle = bend * wave.amplitude * ramp;

		const previous = points[i - 1];
		points.push({
			x: previous.x - step * Math.cos(angle),
			y: previous.y + step * Math.sin(angle)
		});
	}

	return points;
}

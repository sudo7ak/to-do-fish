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
 * by a per-segment angle and every segment shares one length ("step"), so bending can
 * never stretch or compress a segment relative to its neighbours.
 *
 * The nose is anchored at `+length/2` and the tail must land on exactly `-length/2`
 * (see interface contract), but a bent chain's x-projection is shorter than its arc
 * length — `sum(cos(angle_i)) < segments` whenever any angle is non-zero, including at
 * `time = 0`, because the wave already varies over the body's length even before it
 * varies over time. Using `step = length / segments` would under-shoot the tail x by
 * exactly that shortfall. Instead `step` is solved for so the x-projections sum to
 * `length` — every segment is still equal length (they all use the same `step`), and
 * the nose/tail land exactly where the contract promises.
 */
export function spineFor(
	length: number,
	wave: Wave,
	time: number,
	phase: number,
	segments: number = DEFAULT_SEGMENTS
): Spine {
	const t = time / 1000;

	// Amplitude ramps in along the body: the head barely moves, the tail sweeps.
	const angles: number[] = [];
	for (let i = 1; i <= segments; i++) {
		const u = i / segments; // 0 at nose, 1 at tail
		const ramp = u * u;
		const bend = Math.sin(t * wave.speed + phase - (u * Math.PI * 2) / wave.wavelength);
		angles.push(bend * wave.amplitude * ramp);
	}

	const cosSum = angles.reduce((sum, angle) => sum + Math.cos(angle), 0);
	const step = cosSum !== 0 ? length / cosSum : 0;

	const points: Spine = [{ x: length / 2, y: 0 }];
	for (let i = 0; i < segments; i++) {
		const angle = angles[i];
		const previous = points[i];
		points.push({
			x: previous.x - step * Math.cos(angle),
			y: previous.y + step * Math.sin(angle)
		});
	}

	return points;
}

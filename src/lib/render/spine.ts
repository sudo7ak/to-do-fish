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

/** `(t, halfHeight ÷ length)` control points, `t` ascending from 0 (nose) to 1 (tail). */
export type Profile = [number, number][];

/** Half-height at `t`, linearly interpolated and clamped at both ends. */
export function profileAt(profile: Profile, t: number): number {
	if (t <= profile[0][0]) return profile[0][1];

	for (let i = 1; i < profile.length; i++) {
		const [t1, h1] = profile[i];
		if (t <= t1) {
			const [t0, h0] = profile[i - 1];
			const span = t1 - t0;
			const k = span === 0 ? 0 : (t - t0) / span;
			return h0 + (h1 - h0) * k;
		}
	}

	return profile[profile.length - 1][1];
}

/**
 * The largest half-height in a profile, as a fraction of length.
 *
 * This is the body's true half-depth — 0.17 for the neon, 0.5 for the angel — and it
 * is what a back-to-belly gradient has to span. Spanning `length/2` instead makes
 * every species but the angel sample the middle of the ramp and render flat.
 */
export function profilePeak(profile: Profile): number {
	let peak = 0;
	for (const [, half] of profile) peak = Math.max(peak, half);
	return peak;
}

/** The point at `t` along the spine, 0 at the nose and 1 at the tail. */
export function pointAt(spine: Spine, t: number): Point {
	const clamped = Math.min(1, Math.max(0, t));
	const scaled = clamped * (spine.length - 1);
	const i = Math.min(spine.length - 2, Math.floor(scaled));
	const k = scaled - i;

	return {
		x: spine[i].x + (spine[i + 1].x - spine[i].x) * k,
		y: spine[i].y + (spine[i + 1].y - spine[i].y) * k
	};
}

/** Heading of the spine at `t`, in radians. */
export function tangentAt(spine: Spine, t: number): number {
	const clamped = Math.min(1, Math.max(0, t));
	const scaled = clamped * (spine.length - 1);
	const i = Math.min(spine.length - 2, Math.floor(scaled));

	return Math.atan2(spine[i + 1].y - spine[i].y, spine[i + 1].x - spine[i].x);
}

/**
 * The body outline: the spine offset by ±profile along the local normal.
 *
 * Offsetting along the normal rather than straight up and down is what makes the
 * body look like it bends instead of shearing.
 */
export function outline(spine: Spine, profile: Profile, length: number): Point[] {
	const top: Point[] = [];
	const bottom: Point[] = [];

	for (let i = 0; i < spine.length; i++) {
		const t = i / (spine.length - 1);
		const half = Math.max(0, profileAt(profile, t)) * length;

		// Normal to the local tangent.
		const angle = tangentAt(spine, t) + Math.PI / 2;
		const nx = Math.cos(angle) * half;
		const ny = Math.sin(angle) * half;

		top.push({ x: spine[i].x + nx, y: spine[i].y + ny });
		bottom.push({ x: spine[i].x - nx, y: spine[i].y - ny });
	}

	return [...top, ...bottom.reverse()];
}

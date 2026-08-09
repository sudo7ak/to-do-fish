import type { Creature } from '../scene/types';
import type { Palette } from './palette';
import { WATERLINE, surfaceOffset, type Size } from './water';
import { hash, mix32 } from './rng';
import {
	speciesFor,
	treatSpeciesFor,
	SPECIES,
	TREATS,
	type Species,
	type SpeciesSpec,
	type FinSpec
} from './species';
import {
	spineFor,
	outline,
	pointAt,
	tangentAt,
	profileAt,
	profilePeak,
	TURN_LATERAL_REACH,
	type Point,
	type Spine
} from './spine';

export { speciesFor };
export type { Species };

/**
 * Drawing one creature at a time.
 *
 * Positions live here and nowhere else. They are derived every frame from the
 * creature's id and the clock — never stored, never persisted, and identical on
 * every reload because the seed is a hash of the id rather than a random number.
 * The tank is a projection of the task data; this file is the projection.
 *
 * `place` is exported because pointer picking needs the same answer the renderer
 * used. Two implementations of "where is this fish" would drift apart within a day.
 */

export type Placement = {
	x: number;
	y: number;
	flip: boolean;
	/**
	 * Nose-up/nose-down angle in radians, screen space (positive = nose down).
	 *
	 * Fish move vertically as well as horizontally, but until this existed they stayed
	 * rigidly level while doing it — a climbing fish read as a sprite sliding up rails
	 * rather than an animal going somewhere.
	 */
	pitch: number;
	/**
	 * How hard the fish is working, as a multiple of its own average pace. Drives the
	 * body wave, so a coasting fish straightens and a bursting one digs in.
	 *
	 * Computed here rather than in the renderer because `swimPosition` is what varies
	 * the speed; deriving it a second time from a separate formula is exactly how
	 * `pitch` would have drifted from the path it describes.
	 */
	effort: number;
	/**
	 * Signed turn rate, radians per second, from the path actually travelled.
	 *
	 * Positive is a turn toward increasing screen y. The renderer flips the sign when
	 * the fish faces left, for the same reason `pitch` does: the body is drawn in its
	 * own frame and then mirrored.
	 */
	turn: number;
};

/**
 * How far a fish will tip, in radians (~23 degrees).
 *
 * Unhurried fish barely tilt; steeper reads as purposeful diving, and a whole shoal
 * doing it at once looks agitated. Past ~35 degrees the silhouette also stops reading
 * side-on, which is where all the species identity lives.
 */
const MAX_PITCH = 0.4;

/** Seconds ahead used to sample velocity. Long enough to be stable, short enough to be current. */
const PITCH_LOOKAHEAD = 0.08;

/**
 * Pitch from two samples of the real path, rather than a second formula that would
 * drift out of step with it. `dx` is taken as a magnitude because left-and-right is
 * already carried by `flip`; this is only the climb angle.
 */
function pitchFrom(dx: number, dy: number): number {
	if (dx === 0 && dy === 0) return 0;
	return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(dy, Math.abs(dx))));
}

/**
 * Turn rate from three samples of the real path: the heading before and after `here`.
 *
 * Three samples rather than two because a turn is a *change* of heading, and two points
 * only give one heading. Same discipline as `pitch` — read the path that is actually
 * drawn rather than inventing a second formula alongside it.
 */
function turnFrom(behind: Point, here: Point, ahead: Point, dt: number): number {
	const before = Math.atan2(here.y - behind.y, here.x - behind.x);
	const after = Math.atan2(ahead.y - here.y, ahead.x - here.x);

	// Shortest way round, so passing through ±PI is not read as a violent turn.
	let delta = after - before;
	while (delta > Math.PI) delta -= Math.PI * 2;
	while (delta < -Math.PI) delta += Math.PI * 2;

	return delta / dt;
}

/** Water column available to swimmers, leaving the surface band and the planting alone. */
const TOP_MARGIN = WATERLINE + 26;
const BOTTOM_MARGIN = 40;

/**
 * Where the eye sits along the spine, as the spec specifies. Shared by the live head
 * and the ghost's single dot so the two cannot drift apart.
 */
const EYE_T = 0.12;

/** How far below the waterline the treat fish cruises. */
const TREAT_DRAFT = 34;

/**
 * Where the add-pill's shadow starts, as a fraction of width. Pearls stay outside
 * `[1 - PILL_EDGE, PILL_EDGE]` so the bottom button never covers them.
 */
const PILL_EDGE = 0.74;

/**
 * The exotic, drained of its colour: what a treat you cannot yet afford is drawn as.
 *
 * A module constant rather than a per-frame spread, so it is the same object on every
 * frame and the per-species caches below (gradient, half-height, drawn width) hit
 * instead of growing one entry per frame.
 */
/**
 * The out-of-reach version of each prize: drained toward violet-grey but never greyed
 * out. It has to read as "not yet", not as a dead fish.
 *
 * Built once per prize and cached, because the per-species draw caches are keyed on
 * the spec object — minting a fresh one each frame would grow them without bound.
 */
const LOCKED_TREATS: Record<string, SpeciesSpec> = Object.fromEntries(
	TREATS.map((name) => [
		name,
		{
			...SPECIES[name],
			palette: { ...SPECIES[name].palette, back: '#c7a8d8', belly: '#8e7cb0', fin: '#cec4e0' }
		}
	])
);

// ---------------------------------------------------------------- placement

export function place(creature: Creature, size: Size, time: number, animate = true): Placement {
	const seed = hash(creature.id);
	const t = animate ? time / 1000 : 0;

	// The treat fish cruises the surface lane and pearls rest on the floor.
	if (creature.kind === 'treat') {
		// A slow patrol just under the surface, wide of the swim area so it stays the
		// thing your eye lands on rather than another fish in the shoal. Same warped
		// clock as the shoal, so it saunters rather than tracking at a fixed rate.
		const phase = mix32(seed ^ 0x77) * Math.PI * 2;
		const cruise = (t + Math.sin(t * 0.29 + phase) * 1.2) * 0.1;

		const treatAt = (at: number) => {
			const c = (at + Math.sin(at * 0.29 + phase) * 1.2) * 0.1;
			const tx = spreadX(seed, size) + size.w * Math.sin(c) * 0.1;
			return {
				x: tx,
				y: WATERLINE + surfaceOffset(tx, at * 1000) + TREAT_DRAFT + Math.sin(c * 1.7 + phase) * 12
			};
		};

		const here = treatAt(t);
		const ahead = treatAt(t + PITCH_LOOKAHEAD);

		return {
			x: here.x,
			y: here.y,
			flip: Math.cos(cruise) < 0,
			pitch: pitchFrom(ahead.x - here.x, ahead.y - here.y),
			// The prize cruises on its own slow warp, so it eases rather than tracking.
			effort: 1 + Math.cos(t * 0.29 + phase) * 0.35,
			turn: turnFrom(treatAt(t - PITCH_LOOKAHEAD), here, ahead, PITCH_LOOKAHEAD)
		};
	}
	if (creature.kind === 'pearl') {
		/**
		 * Pearls settle on the bed, among the plants — they are heavy, and floating
		 * them in open water reads as bubbles rather than treasure.
		 *
		 * The add-pill is what used to hide them, and the pill is a *centred* band, so
		 * the fix is horizontal: pearls gather in the sand to either side of it rather
		 * than being lifted into the water column.
		 */
		// Pearls are the one creature the scene numbers (`pearl-0`, `pearl-1`, …), so
		// they can be dealt out evenly instead of each flipping its own coin — which
		// piled seven on the left and left one on the right.
		const index = Number(creature.id.slice(6));
		const n = Number.isFinite(index) ? index : Math.floor(mix32(seed) * 100);

		const rightSide = n % 2 === 1;
		const slot = Math.floor(n / 2);
		// Golden-ratio spacing along the band, and three shallow rows so a big balance
		// stacks up the beach instead of overlapping in a line.
		const along = (slot * 0.6180339887) % 1;
		const bandWidth = 1 - PILL_EDGE - 0.04;

		const x = rightSide
			? size.w * (PILL_EDGE + along * bandWidth)
			: size.w * (0.04 + along * bandWidth);

		return {
			x,
			y: size.h - 14 - (slot % 3) * 11 - mix32(seed ^ 0x5f5e) * 6,
			flip: false,
			pitch: 0,
			// A pearl has no body to undulate; the value is inert.
			effort: 1,
			turn: 0
		};
	}

	const kindSpeed = creature.kind === 'koi' ? 0.5 : creature.kind === 'ghost' ? 0.62 : 1;
	const phase = mix32(seed ^ 0x11) * Math.PI * 2;

	// Sampled at two instants so pitch comes from the path actually travelled.
	const swimAt = (at: number) => swimPosition(creature, size, at, seed, phase, kindSpeed);
	const here = swimAt(t);
	const ahead = swimAt(t + PITCH_LOOKAHEAD);
	const behind = swimAt(t - PITCH_LOOKAHEAD);

	return {
		x: here.x,
		y: here.y,
		flip: here.flip,
		// A frozen clock gives two identical samples, so a still fish sits level.
		pitch: pitchFrom(ahead.x - here.x, ahead.y - here.y),
		// Read off the warp's own derivative rather than measured from `here`/`ahead`:
		// the horizontal sweep reverses at each end of its lane, where the measured
		// speed collapses to nearly zero even though the fish is turning, not coasting.
		effort: animate ? glideRate(t, phase) : 1,
		turn: animate ? turnFrom(behind, here, ahead, PITCH_LOOKAHEAD) : 0
	};
}


/**
 * Burst and glide: the clock is warped instead of the path, so the same sinusoid is
 * traversed quickly in places and slowly in others.
 *
 * The two terms and their derivative live together because the body wave reads its
 * speed from `glideRate`. Written as two separate formulas they would drift, and the
 * fish would beat hardest at the moment it was actually coasting — the same class of
 * bug `FIN_FORWARD_REACH` exists to prevent.
 *
 * Strictly monotonic by construction: the derivative bottoms out at 1 - 0.541 and
 * peaks at 1 + 0.541, so it never goes negative and the fish never twitches backwards.
 */
const GLIDE_TERMS = [
	{ gain: 0.9, rate: 0.37, phaseMul: 1 },
	{ gain: 1.6, rate: 0.13, phaseMul: 1.7 }
] as const;

function glideWarp(t: number, phase: number): number {
	let sum = 0;
	for (const term of GLIDE_TERMS) sum += Math.sin(t * term.rate + phase * term.phaseMul) * term.gain;
	return sum;
}

/** d(t + glideWarp)/dt — the fish's speed as a multiple of its own average. */
function glideRate(t: number, phase: number): number {
	let sum = 1;
	for (const term of GLIDE_TERMS) {
		sum += Math.cos(t * term.rate + phase * term.phaseMul) * term.gain * term.rate;
	}
	return sum;
}

/** Where a swimmer is at time `t` (seconds). Split out so `place` can sample it twice. */
function swimPosition(
	creature: Creature,
	size: Size,
	t: number,
	seed: number,
	phase: number,
	kindSpeed: number
): { x: number; y: number; flip: boolean } {

	// Per-fish tempo, so a tank of six does not move as one organism.
	const pace = (0.17 + mix32(seed ^ 0x1f) * 0.2) * kindSpeed;

	/**
	 * Burst and glide, the way a real fish actually moves: warp the clock instead of
	 * the path, so the same sinusoid is traversed quickly in places and slowly in
	 * others. Kept strictly monotonic (the derivative bottoms out around 0.46 and
	 * peaks near 1.54) — if it ever went negative the fish would twitch backwards
	 * mid-stroke instead of easing.
	 */
	const warp = t + glideWarp(t, phase);
	const swim = warp * pace;

	// Horizontal sweep. Each fish gets its own lane centre as well as its own
	// amplitude — sweeping every one about the middle of the tank makes them all pass
	// through the centre together and bunch there.
	const centre = 0.5 + (mix32(seed ^ 0x5a) - 0.5) * 0.5;
	const ampX = 0.2 + mix32(seed ^ 0x2b) * 0.12;
	const across = Math.min(0.94, Math.max(0.06, centre + Math.sin(swim) * ampX));
	const x = size.w * across;

	const usable = Math.max(0, size.h - TOP_MARGIN - BOTTOM_MARGIN);

	// Swimmers all share one resting depth from the scene, which lined them up in a
	// single row like a conveyor. Scatter them within a band around it — depth still
	// means what the scene said, it just is not a hairline.
	// `seed >> 7` would drop exactly the low bits that differ between sibling ids, so
	// every fish landed on the same line. Mix the seed properly first.
	const isBubble = creature.kind === 'bubble';
	const scatter = isBubble ? 0 : (mix32(seed) - 0.5) * 0.5;

	/**
	 * Vertical wander on a different frequency from the horizontal sweep, which turns
	 * a flat rail into a lazy Lissajous loop — the fish climbs and dives as it
	 * crosses. Bubbles are exempt: their depth is information (time until trigger),
	 * so wandering it would be lying.
	 */
	const wanderRate = 0.55 + mix32(seed ^ 0x3c) * 0.6;
	const ampY = isBubble ? 0 : 0.09 + mix32(seed ^ 0x4d) * 0.11;
	const wander = Math.sin(swim * wanderRate + phase * 2.3) * ampY;

	const depth = Math.min(0.97, Math.max(0.03, creature.depth + scatter + wander));
	// A small fast bob on top of the slow wander, so it still looks alive when hovering.
	const bob = Math.sin(t * 1.6 + phase) * (isBubble ? 2 : 3.5);
	const y = TOP_MARGIN + depth * usable + bob;

	// Face the way it is travelling. `warp` is monotonic, so the sign of the sweep's
	// derivative is just the cosine.
	const flip = Math.cos(swim) < 0;

	return { x, y, flip };
}

/**
 * Golden-ratio spacing across the full width. Plain `hash % width` clumps badly at
 * four or five items; multiplying by the golden ratio is the standard trick for
 * spreading a small set of hashes evenly without knowing how many there are.
 *
 * `seed % 1000` is the one place in this file that uses the raw hash rather than
 * mixing it through `mix32`, and it stays that way on purpose. Taking the low bits of
 * a hash normally correlates sibling ids, which is why the rule exists — but here the
 * result is immediately multiplied by the golden ratio and wrapped, which is itself a
 * decorrelating step, and it only chooses which lane two or three treats cruise in.
 * Mixing it would be tidier and would also move every existing treat, and `place` is
 * shared with pointer hit-testing, so its output is not free to change.
 */
function spreadX(seed: number, size: Size): number {
	const position = ((seed % 1000) * 0.6180339887) % 1;
	return size.w * (0.14 + position * 0.72);
}

// ------------------------------------------------------------------ drawing

/**
 * The species a creature wears, and the scale it is drawn at — or `null` for the
 * creatures that have no fish body.
 *
 * One place, because `drawCreature` and the fin-clipping inset must agree about what
 * is on screen; deciding it twice is how the inset ends up sized for the wrong fish.
 */
function bodyOf(creature: Creature): { spec: SpeciesSpec; scale: number } | null {
	switch (creature.kind) {
		case 'fish':
			// A bought treat keeps its exotic look, at a size that sits in the shoal.
			// Turning it into an ordinary fish read as the prize vanishing on purchase.
			return creature.claimed
				? { spec: SPECIES[treatSpeciesFor(creature.id)], scale: 0.72 }
				: { spec: SPECIES[speciesFor(creature.id)], scale: 1 };
		case 'ghost':
			return { spec: SPECIES[speciesFor(creature.id)], scale: 1 };
		case 'koi':
			return { spec: SPECIES.koi, scale: 1 };
		case 'treat':
			return {
				spec: creature.locked
					? LOCKED_TREATS[treatSpeciesFor(creature.id)]
					: SPECIES[treatSpeciesFor(creature.id)],
				scale: 1
			};
		default:
			// A bubble's fish is clipped to the sphere; a pearl has no fins at all.
			return null;
	}
}

export function drawCreature(
	ctx: CanvasRenderingContext2D,
	creature: Creature,
	at: Placement,
	colors: Palette,
	time: number
): void {
	const body = bodyOf(creature);

	ctx.save();
	ctx.translate(at.x, at.y);
	// Point where it is going. The horizontal mirror is applied later, inside the body
	// drawing, and mirroring reverses the sense of a rotation set before it — so a
	// left-swimming fish takes the opposite sign to reach the same climb on screen.
	if (at.pitch) ctx.rotate(at.flip ? -at.pitch : at.pitch);
	if (body && body.scale !== 1) ctx.scale(body.scale, body.scale);

	// `bodyOf` returns a spec for every kind that has one, so the assertions below hold
	// by construction — the compiler just cannot see across the switch.
	switch (creature.kind) {
		case 'fish':
			drawFish(ctx, at, body!.spec, time, hash(creature.id));
			break;
		case 'ghost':
			drawGhost(ctx, at, body!.spec, time, hash(creature.id));
			break;
		case 'koi':
			drawKoi(ctx, at, time, hash(creature.id));
			break;
		case 'bubble':
			drawBubble(ctx, creature, time);
			break;
		case 'treat':
			drawTreatFish(ctx, creature, at, time);
			break;
		case 'pearl':
			drawPearl(ctx, colors, time, hash(creature.id));
			break;
	}

	ctx.restore();
}

/**
 * How far a species reaches horizontally from its own origin, in local pixels.
 *
 * `place` clamps the *body* centre to [0.06, 0.94] of the width, which leaves about
 * 24px of slack on a phone — but an exotic or betta caudal is 0.70–0.75 of body
 * length, over 30px, so the tail clipped through the glass in a busy tank. `place`
 * cannot grow the margin: pointer hit-testing shares it, and moving every fish inward
 * to suit the widest tail would waste the tank.
 *
 * So the drawing layer insets instead, and it insets by what each species actually
 * needs rather than one constant — a single margin either under-shoots the betta or
 * over-shoots the neon by 20px.
 *
 * On a straight spine the fin transform is the identity, a fin root sits at
 * `length * (0.5 - anchor)`, and the fin's own path runs from `-span * sweep` to
 * `+span * 0.15`. Bending only pulls the extremes inward, so this is an upper bound.
 */
function speciesReach(spec: SpeciesSpec): number {
	const cached = reachCache.get(spec);
	if (cached !== undefined) return cached;

	let reach = spec.length * 0.5; // nose and tail of the body itself

	for (const fin of spec.fins) {
		const root = spec.length * (0.5 - fin.anchor);
		const span = fin.span * spec.length;
		reach = Math.max(
			reach,
			Math.abs(root - span * fin.sweep),
			Math.abs(root + span * FIN_FORWARD_REACH)
		);
	}

	// Tilting swings the tail wider. A shape reaching `reach` along its own axis and
	// `vertical` across it occupies `reach·cos θ + vertical·sin θ` horizontally once
	// pitched — so a deep-bodied, long-finned fish needs more clearance nose-up than
	// it does level.
	let vertical = profilePeak(spec.profile) * spec.length;
	for (const fin of spec.fins) {
		// Every fin counts, the caudal included: tilted, a tail's vertical spread swings
		// into horizontal reach just as a dorsal's does.
		vertical = Math.max(
			vertical,
			profileAt(spec.profile, fin.anchor) * spec.length + fin.span * spec.length
		);
	}
	// The trail streams behind and above, so it rotates outward too.
	vertical = Math.max(vertical, TRAIL_DRIFT + TRAIL_RADIUS);
	// `reach·cos θ + vertical·sin θ` peaks at `θ = atan(vertical / reach)`, not at the
	// largest tilt — so evaluating at MAX_PITCH can *understate* the extent. Take the
	// worst angle the fish can actually reach.
	const worstTilt = Math.min(MAX_PITCH, Math.atan2(vertical, reach));
	const pitched = reach * Math.cos(worstTilt) + vertical * Math.sin(worstTilt);

	// The bubble trail streams further back than any tail, and the treat's halo is a
	// disc of one body length. Both are faint, but a hard vertical cut through a glow
	// at the edge of the glass is more obvious than the glow itself.
	// Curves bulge past their endpoints: a quadratic lies inside the hull of its control
	// points, and every measurement above samples endpoints only. The body is traced
	// over `SPINE_SEGMENTS` spans, so a control point sits at most about one span
	// outside the sampled extreme — scale the pad with the fish rather than pinning a
	// constant that a longer species would outgrow.
	// A turning body arcs off its own axis, so it needs more clearance than a straight
	// one. Measured from the spine itself rather than a pad picked by eye.
	const curvePad = spec.length / 6 + TURN_LATERAL_REACH * spec.length;

	const total =
		Math.max(
			reach,
			pitched,
			spec.length * TRAIL_ANCHOR + TRAIL_DRIFT + TRAIL_RADIUS,
			spec.length
		) + curvePad;

	reachCache.set(spec, total);
	return total;
}

/**
 * The placement to draw at: the body's own position, pulled in only far enough that
 * the fins stay inside the glass.
 *
 * This deliberately diverges from `place` at the very edges. `place` answers "where is
 * this creature", which hit-testing needs to keep agreeing with itself; this answers
 * "where can it be painted without clipping", and only differs for a fish already
 * pressed against the wall.
 */
function insetForFins(at: Placement, creature: Creature, size: Size): Placement {
	const body = bodyOf(creature);
	if (!body) return at;

	const margin = Math.min(size.w * 0.5, speciesReach(body.spec) * body.scale);
	const x = Math.min(size.w - margin, Math.max(margin, at.x));

	return x === at.x ? at : { ...at, x };
}

/**
 * Back to front: bubbles and pearls behind, koi in front. Module scope, because
 * `drawCreatures` runs inside a `requestAnimationFrame` loop and had been allocating
 * this record sixty times a second.
 */
const DRAW_ORDER: Record<Creature['kind'], number> = {
	pearl: 0,
	bubble: 1,
	ghost: 2,
	fish: 3,
	koi: 4,
	treat: 5
};

/** Paints every creature in one pass, back to front: bubbles and pearls behind, koi in front. */
export function drawCreatures(
	ctx: CanvasRenderingContext2D,
	creatures: Creature[],
	colors: Palette,
	size: Size,
	time: number,
	animate = true,
	feeding = 0
): void {
	// Food is in the water, so the shoal picks up. This rides the `effort` input the
	// body wave already reads rather than adding a second animation path: a fish working
	// harder bends harder, and it is already sampled from the path it swims.
	const stir = animate ? 1 + feeding * FEED_STIR : 1;

	for (const creature of [...creatures].sort((a, b) => DRAW_ORDER[a.kind] - DRAW_ORDER[b.kind])) {
		const placed = place(creature, size, time, animate);
		const at = insetForFins({ ...placed, effort: placed.effort * stir }, creature, size);

		// Water absorbs light, so a fish deep in the column is lower in contrast than one
		// near the surface. Without this every creature was equally crisp at every depth,
		// which is the flat-sticker look in one line.
		//
		// Applied here rather than inside `drawCreature` because this is where the tank's
		// height is known, and as a *multiplier* on whatever alpha the creature already
		// carries — a ghost is already faint and must not be reset to full.
		const outer = ctx.globalAlpha;
		ctx.globalAlpha = outer * hazeAt(creature, at, size);
		drawCreature(ctx, creature, at, colors, time);
		ctx.globalAlpha = outer;
	}
}

/**
 * How much of its contrast a creature keeps at its drawn depth.
 *
 * Pearls and bubbles are exempt. A pearl rests on the bed by design and is meant to
 * catch the light — hazing it would undo that on purpose — and a bubble is a task you
 * can tap, so dimming it with depth would make the furthest task the hardest to see.
 */
const MAX_DEPTH_HAZE = 0.3;

/**
 * How much harder the shoal works while there is food in the water.
 *
 * Deliberately modest. The flourish should read as the tank waking up for a few
 * seconds, not as every fish panicking.
 */
const FEED_STIR = 0.85;

function hazeAt(creature: Creature, at: Placement, size: Size): number {
	if (creature.kind === 'pearl' || creature.kind === 'bubble') return 1;

	const column = Math.max(1, size.h - WATERLINE);
	const depth = Math.min(1, Math.max(0, (at.y - WATERLINE) / column));

	return 1 - depth * MAX_DEPTH_HAZE;
}

// ------------------------------------------------------------------- shapes

/** Traces a closed outline as a smooth loop through its points. */
function tracePath(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]): void {
	ctx.beginPath();
	ctx.moveTo(points[0].x, points[0].y);
	for (let i = 1; i < points.length; i++) {
		const previous = points[i - 1];
		const point = points[i];
		// Midpoint quadratics: a smooth curve through every point without needing
		// hand-placed control points per species.
		ctx.quadraticCurveTo(previous.x, previous.y, (previous.x + point.x) / 2, (previous.y + point.y) / 2);
	}
	ctx.closePath();
}

/**
 * Per-species values that never change but were being recomputed for every fish on
 * every frame, sixty times a second: the body gradient, the profile's peak, and the
 * horizontal reach used to keep fins off the glass.
 *
 * Keyed by the spec object, and every spec is a module constant, so this is bounded by
 * the number of species. The gradient is additionally keyed by context, because a
 * `CanvasGradient` belongs to the canvas that made it.
 */
const gradientCache = new WeakMap<CanvasRenderingContext2D, Map<SpeciesSpec, CanvasGradient>>();
const peakCache = new Map<SpeciesSpec, number>();
const reachCache = new Map<SpeciesSpec, number>();

const finGradientCache = new WeakMap<CanvasRenderingContext2D, Map<FinSpec, CanvasGradient>>();

/**
 * The root-to-tip opacity ramp that makes a fin read as membrane rather than card.
 *
 * Cached per fin like the body gradient, and for the same reason: this is called for
 * every fin of every fish on every frame. It is drawn in the fin's own local
 * coordinates, where `half` and `span` are fixed by the species, so one gradient
 * serves the fin for the life of the context.
 */
function finGradient(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	fin: FinSpec,
	half: number,
	span: number
): CanvasGradient {
	let perFin = finGradientCache.get(ctx);
	if (!perFin) {
		perFin = new Map();
		finGradientCache.set(ctx, perFin);
	}

	const cached = perFin.get(fin);
	if (cached) return cached;

	const wash = ctx.createLinearGradient(0, half, -span * fin.sweep, half + span);
	// A fin is a membrane stretched over rays, and you can see water through it. The
	// ramp was already the right shape; these are simply thinner, so the margin reads as
	// tissue rather than as a painted edge.
	wash.addColorStop(0, withAlpha(spec.palette.fin, 0.82));
	wash.addColorStop(1, withAlpha(spec.palette.fin, 0.3));

	perFin.set(fin, wash);
	return wash;
}

function bodyGradient(ctx: CanvasRenderingContext2D, spec: SpeciesSpec): CanvasGradient {
	let perSpecies = gradientCache.get(ctx);
	if (!perSpecies) {
		perSpecies = new Map();
		gradientCache.set(ctx, perSpecies);
	}

	const cached = perSpecies.get(spec);
	if (cached) return cached;

	// The ramp has to span the body's real depth, not half its *length*. At `length/2`
	// every species but the angel — whose profile happens to peak at 0.5 — sampled only
	// the middle third of the gradient and came out a flat mid-tone.
	const half = bodyHalf(spec);
	const shade = ctx.createLinearGradient(0, -half, 0, half);
	shade.addColorStop(0, spec.palette.back);
	shade.addColorStop(1, spec.palette.belly);

	perSpecies.set(spec, shade);
	return shade;
}

/** The species' deepest half-height, in pixels. */
function bodyHalf(spec: SpeciesSpec): number {
	let half = peakCache.get(spec);
	if (half === undefined) {
		half = profilePeak(spec.profile) * spec.length;
		peakCache.set(spec, half);
	}
	return half;
}

/** Fills the body outline, lit from above, with a rim so it holds its edge in the water. */
function drawBody(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	loop: Point[],
	alpha = 1
): void {
	const shade = bodyGradient(ctx, spec);

	// Multiply, never assign: a caller may already have dimmed the context (a locked
	// treat, a ghost), and assigning would repaint the body at full brightness inside
	// an otherwise drained fish — leaving only the fins looking spent.
	const outer = ctx.globalAlpha;
	ctx.globalAlpha = outer * alpha;

	tracePath(ctx, loop);
	ctx.fillStyle = shade;
	ctx.fill();

	// No rim stroke. A drawn outline is the strongest cue that a shape is an
	// illustration laid on the water rather than an animal in it — real silhouettes are
	// value edges, not lines. The body gradient already darkens toward the back, which
	// is what separates the fish from the water; a line on top of that only ever read
	// as ink.
	//
	// Ghosts keep their stroke, in `drawGhost`: an unfilled outline is the whole of what
	// makes a spent task legible, and that is a state distinction rather than decoration.
	ctx.globalAlpha = outer;
}

/**
 * Which sides a fin is drawn on: a tail lobes both ways, a dorsal stands up, and
 * everything else hangs below.
 */
function finSides(fin: FinSpec): (1 | -1)[] {
	if (fin.kind === 'caudal') return [1, -1];
	return fin.kind === 'dorsal' ? [-1] : [1];
}

/**
 * Lays down one fin's path, anchored at its spine fraction and rotated to the local
 * tangent, so it follows the body's bend without any special handling.
 *
 * Leaves the path current and the fin's own transform in force: the caller decides
 * whether to fill it (a live fish) or merely stroke it (a ghost), and must `restore`.
 *
 * `lag` offsets the fin's own flutter behind the body wave — fins moving in perfect
 * lockstep with the body read as rigid cardboard — and doubles as the flutter's
 * amplitude, which is why long trailing veils ripple most. See `FinSpec.lag`.
 */
function traceFin(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	fin: FinSpec,
	spine: Spine,
	time: number,
	phase: number,
	side: 1 | -1
): { half: number; span: number; front: number; back: number; rootY: number } {
	const root = pointAt(spine, fin.anchor);
	const heading = tangentAt(spine, fin.anchor);
	const half = profileAt(spec.profile, fin.anchor) * spec.length;
	const span = fin.span * spec.length;

	const flutter =
		Math.sin((time / 1000) * spec.wave.speed + phase - fin.lag) * 0.18 * (fin.lag + 0.4);

	ctx.save();
	ctx.translate(root.x, root.y);
	ctx.rotate(heading + Math.PI); // face the nose
	ctx.scale(1, side);

	// Every fin roots along a stretch of the body rather than at a point, and bellies
	// out on the way to the tip. A fin joined at one point can only ever look stuck
	// on: it read as a gold needle on the swimmers and as a shape floating alongside
	// the body on the long-finned ones. The veil is the same construction with a
	// shorter base and a fuller belly, not a different idea.
	const { base: baseFrac, belly, waist } = FIN_SHAPE[spec.finStyle === 'veil' ? 'veil' : 'blade'];
	const base = span * baseFrac;
	const front = base * FIN_BASE_FRONT;
	const back = -base * FIN_BASE_BACK;
	// Sits on the body edge. Rooting inside the profile hid the join, so the visible
	// part started mid-body and looked detached from the fish.
	//
	// The caudal is the exception: it is drawn as two mirrored lobes (`finSides`), and
	// basing each one off the axis left a notch of open water between them at the
	// peduncle — the tail read as two spikes trailing the fish rather than as its tail.
	// Rooting on the axis makes the two lobes share an edge and close into one shape.
	const rootY = fin.kind === 'caudal' ? 0 : half * 0.94;

	ctx.beginPath();
	ctx.moveTo(front, rootY);
	ctx.quadraticCurveTo(-span * 0.36, half + span * belly, -span * fin.sweep, half + span);
	ctx.quadraticCurveTo(-span * 0.1, half + span * (waist + flutter), back, rootY);
	ctx.closePath();

	return { half, span, front, back, rootY };
}

/**
 * Fin outline, as fractions of the fin's own span.
 *
 * `base` is how much of the body the fin is joined along, `belly` how far it bows out
 * reaching the tip, `waist` how deeply the trailing edge cuts back in.
 */
const FIN_SHAPE = {
	blade: { base: 0.66, belly: 0.55, waist: 0.3 },
	veil: { base: 0.34, belly: 0.78, waist: 0.34 }
} as const;

/** Where the base sits relative to the anchor, forward and aft, as fractions of `base`. */
const FIN_BASE_FRONT = 0.55;
const FIN_BASE_BACK = 0.75;

/**
 * The furthest a fin reaches *ahead* of its anchor, as a fraction of span — the front
 * of its base. `speciesReach` needs this to keep fins inside the glass, so it lives
 * here rather than being written as a literal in two places that can drift apart.
 */
export const FIN_FORWARD_REACH = 0.66 * FIN_BASE_FRONT;

/** One fin, filled and rayed. */
function drawFin(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	fin: FinSpec,
	spine: Spine,
	time: number,
	phase: number,
	side: 1 | -1
): void {
	const { half, span, front, back, rootY } = traceFin(ctx, spec, fin, spine, time, phase, side);

	// Membrane, not sheet metal — but thinning the whole fin evenly just turned gold
	// to khaki against the water. Real fins are meatiest where they leave the body and
	// thin towards the edge, so the opacity ramps root-to-tip: full colour at the base,
	// see-through at the margin.
	ctx.fillStyle = finGradient(ctx, spec, fin, half, span);
	ctx.fill();

	// Rays, so the fin reads as a fin and not a petal. They fan out from across the
	// base — converging them on a single point undoes the base the outline just drew.
	//
	// Clipped to the fin. Fanned rays do not track the outline's curve, so the longest
	// ones shot past the margin and read as loose hairs; clipping to the shape that was
	// just traced means no ray can escape whatever the sweep and span happen to be.
	ctx.save();
	ctx.clip();
	ctx.strokeStyle = withAlpha(spec.palette.belly, spec.finStyle === 'veil' ? 0.34 : 0.28);
	ctx.lineWidth = 0.8;
	for (const k of spec.finStyle === 'veil' ? [0.2, 0.4, 0.6, 0.8] : [0.25, 0.5, 0.75]) {
		ctx.beginPath();
		ctx.moveTo(front + (back - front) * k, rootY);
		ctx.lineTo(-span * fin.sweep * k, half + span * k);
		ctx.stroke();
	}
	ctx.restore();

	ctx.restore();
}

/**
 * The fins behind the body: caudal, dorsal, anal, pelvic.
 *
 * Drawn before the body so the body's fill covers where they meet it — a fin whose
 * root is visible looks glued on.
 */
function drawRearFins(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	spine: Spine,
	time: number,
	phase: number
): void {
	for (const fin of spec.fins) {
		if (fin.kind === 'pectoral') continue;
		for (const side of finSides(fin)) drawFin(ctx, spec, fin, spine, time, phase, side);
	}
}

/**
 * The near-side pectoral, drawn *after* the body so it overlaps it.
 *
 * That overlap is the whole point: it is the one part of the fish that is nearer the
 * viewer than the flank, and drawing it underneath flattened the fish into a decal.
 */
function drawPectoral(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	spine: Spine,
	time: number,
	phase: number
): void {
	for (const fin of spec.fins) {
		if (fin.kind !== 'pectoral') continue;
		for (const side of finSides(fin)) drawFin(ctx, spec, fin, spine, time, phase, side);
	}
}

/** Eye and mouth, placed off the spine so they ride the head as it turns. */
function drawHead(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	spine: Spine,
	time: number,
	phase: number
): void {
	const at = pointAt(spine, EYE_T);
	const half = profileAt(spec.profile, EYE_T) * spec.length;
	/**
	 * A fish's eye is dark and nearly all pupil. The white sclera ring this used to draw
	 * is a mascot convention, not an anatomical one, and at 40px it was the loudest
	 * thing on the animal — the eye read before the species did.
	 *
	 * Kept prominent rather than shrunk to a speck: real fish eyes *are* large for the
	 * head. What changes is that the dark iris now fills it instead of ringing a white
	 * disc.
	 */
	const radius = Math.max(1.9, half * 0.26);

	// Iris, filling the eye.
	ctx.beginPath();
	ctx.arc(at.x, at.y - half * 0.25, radius, 0, Math.PI * 2);
	ctx.fillStyle = spec.palette.iris;
	ctx.fill();

	// Pupil: darker still, and slightly forward, so the fish reads as looking ahead.
	ctx.beginPath();
	ctx.arc(at.x + radius * 0.16, at.y - half * 0.25, radius * 0.55, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(12, 20, 28, 0.92)';
	ctx.fill();

	// Catchlight — one small wet highlight, which is what stops it reading as a hole.
	ctx.beginPath();
	ctx.arc(at.x - radius * 0.32, at.y - half * 0.25 - radius * 0.32, radius * 0.22, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
	ctx.fill();

	// Lid: the belly tone, which reads as shadow against the lit back.
	ctx.beginPath();
	ctx.arc(at.x, at.y - half * 0.25, radius, Math.PI * 1.05, Math.PI * 1.95);
	ctx.strokeStyle = withAlpha(spec.palette.belly, 0.5);
	ctx.lineWidth = 1;
	ctx.stroke();

	// Mouth: a notch at the nose that opens on the swim cycle.
	const nose = pointAt(spine, 0.02);
	const gape = (Math.sin((time / 1000) * spec.wave.speed * 0.5 + phase) * 0.5 + 0.5) * radius * 0.5;
	ctx.beginPath();
	ctx.moveTo(nose.x, nose.y - gape * 0.3);
	ctx.quadraticCurveTo(nose.x - radius * 0.7, nose.y, nose.x, nose.y + gape);
	ctx.strokeStyle = withAlpha(spec.palette.belly, 0.65);
	ctx.lineWidth = 1.1;
	ctx.stroke();
}

/**
 * Species markings, clipped to the body outline.
 *
 * Bands follow the local normal rather than running straight down the screen, so they
 * wrap the body as it bends instead of sitting on it like a decal.
 */
function drawMarkings(
	ctx: CanvasRenderingContext2D,
	spec: SpeciesSpec,
	spine: Spine,
	loop: Point[],
	seed: number
): void {
	if (spec.pattern === 'none') return;

	ctx.save();
	tracePath(ctx, loop);
	ctx.clip();
	ctx.fillStyle = spec.palette.marking;
	ctx.strokeStyle = spec.palette.marking;

	if (spec.pattern === 'bands') {
		ctx.lineWidth = spec.length * 0.07;
		for (const t of [0.24, 0.48, 0.72]) {
			const at = pointAt(spine, t);
			const half = profileAt(spec.profile, t) * spec.length * 1.6;
			const angle = tangentAt(spine, t) + Math.PI / 2;

			ctx.beginPath();
			ctx.moveTo(at.x + Math.cos(angle) * half, at.y + Math.sin(angle) * half);
			ctx.lineTo(at.x - Math.cos(angle) * half, at.y - Math.sin(angle) * half);
			ctx.stroke();
		}
	} else if (spec.pattern === 'stripe') {
		ctx.lineWidth = spec.length * 0.06;
		ctx.beginPath();
		for (let i = 0; i < spine.length; i++) {
			const p = spine[i];
			if (i === 0) ctx.moveTo(p.x, p.y);
			else ctx.lineTo(p.x, p.y);
		}
		ctx.stroke();
	} else if (spec.pattern === 'spots') {
		for (let i = 0; i < 5; i++) {
			const t = 0.2 + i * 0.14;
			const at = pointAt(spine, t);
			const jitter = mix32(seed ^ (i * 977));
			const half = profileAt(spec.profile, t) * spec.length;

			ctx.beginPath();
			ctx.arc(at.x, at.y + (jitter - 0.5) * half, spec.length * 0.045, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	ctx.restore();
}

/**
 * Returns the spine and outline it built, so a caller that needs to draw over the
 * finished fish — the koi's rim and barbels — does not rebuild them. Both were being
 * computed twice per koi per frame.
 */
function drawFish(
	ctx: CanvasRenderingContext2D,
	at: Placement,
	spec: SpeciesSpec,
	time: number,
	seed: number
): { spine: Spine; loop: Point[] } {
	if (at.flip) ctx.scale(-1, 1);

	const phase = mix32(seed ^ 0x11) * Math.PI * 2;
	const spine = spineFor(spec.length, spec.wave, time, phase, undefined, at.effort, at.flip ? -at.turn : at.turn);
	const loop = outline(spine, spec.profile, spec.length);

	drawRearFins(ctx, spec, spine, time, phase);
	drawBody(ctx, spec, loop);
	drawMarkings(ctx, spec, spine, loop, seed);
	drawPectoral(ctx, spec, spine, time, phase);
	drawHead(ctx, spec, spine, time, phase);
	drawTrail(ctx, time, seed, spec.length);

	return { spine, loop };
}

/** A resolved task keeps swimming, drained to a translucent outline of the same fish. */
function drawGhost(
	ctx: CanvasRenderingContext2D,
	at: Placement,
	spec: SpeciesSpec,
	time: number,
	seed: number
): void {
	if (at.flip) ctx.scale(-1, 1);

	const phase = mix32(seed ^ 0x11) * Math.PI * 2;
	const spine = spineFor(spec.length, spec.wave, time, phase, undefined, at.effort, at.flip ? -at.turn : at.turn);
	const loop = outline(spine, spec.profile, spec.length);

	// Legible, but plainly spent. At 0.4 the outline vanished against the water and
	// completing a task looked like deleting it.
	const outer = ctx.globalAlpha;
	ctx.globalAlpha = outer * 0.62;

	/**
	 * Fins first, and stroked rather than filled.
	 *
	 * A ghost is an outline of *its own* species, and for half the tank the species
	 * lives entirely in the fins: a guppy is a small body behind an oversized fan
	 * tail, a betta is trailing veils, an angel is a diamond of dorsal and anal. Body
	 * outline alone made those three indistinguishable from each other.
	 */
	ctx.strokeStyle = withAlpha(spec.palette.fin, 0.8);
	ctx.lineWidth = 1.4;
	for (const fin of spec.fins) {
		for (const side of finSides(fin)) {
			traceFin(ctx, spec, fin, spine, time, phase, side);
			ctx.stroke();
			ctx.restore();
		}
	}

	tracePath(ctx, loop);
	ctx.fillStyle = withAlpha(spec.palette.back, 0.16);
	ctx.fill();

	tracePath(ctx, loop);
	ctx.strokeStyle = withAlpha(spec.palette.back, 0.95);
	ctx.lineWidth = 2.2;
	ctx.stroke();

	// One dot of eye, so the outline still reads as facing somewhere.
	const eye = pointAt(spine, EYE_T);
	const half = profileAt(spec.profile, EYE_T) * spec.length;
	ctx.beginPath();
	ctx.arc(eye.x, eye.y - half * 0.25, Math.max(1.6, half * 0.22), 0, Math.PI * 2);
	ctx.stroke();

	ctx.globalAlpha = outer;
}

/**
 * Where the bubble trail sits behind the tail, as a fraction of body length, how far
 * it drifts back over its cycle, and the largest bubble radius. Named because
 * `speciesReach` has to know how far a fish's drawn geometry actually extends.
 */
const TRAIL_ANCHOR = 0.75;
const TRAIL_DRIFT = 10;
const TRAIL_RADIUS = 2.4;

/** The bubble trail behind a live fish. Three bubbles rising and fading on a loop. */
function drawTrail(ctx: CanvasRenderingContext2D, time: number, seed: number, len: number): void {
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
	ctx.lineWidth = 0.8;

	const outer = ctx.globalAlpha;
	for (let i = 0; i < 3; i++) {
		const cycle = (((time / 900 + seed + i * 0.33) % 1) + 1) % 1;
		ctx.globalAlpha = outer * 0.45 * (1 - cycle);
		ctx.beginPath();
		// Behind the tail, not off the nose: a fish does not breathe backwards.
		ctx.arc(-len * TRAIL_ANCHOR - cycle * TRAIL_DRIFT, -cycle * 20, 1.4 + i * 0.5, 0, Math.PI * 2);
		ctx.stroke();
	}

	ctx.globalAlpha = outer;
}

/** The cleared-day koi: an ordinary fish body with barbels and a gold rim. */
function drawKoi(ctx: CanvasRenderingContext2D, at: Placement, time: number, seed: number): void {
	const spec = SPECIES.koi;
	const { spine, loop } = drawFish(ctx, at, spec, time, seed);

	/**
	 * A bright gold rim with a soft bloom behind it.
	 *
	 * The koi is what you get for clearing a whole day, so it has to be unmistakable —
	 * but it shares its cream and gold with the angel, and once the two overlapped the
	 * generic body outline was not enough to tell them apart. Stroked twice through the
	 * shadow so the bloom builds without a second path.
	 */
	ctx.save();
	ctx.shadowColor = 'rgba(255, 206, 94, 0.9)';
	ctx.shadowBlur = 9;
	ctx.strokeStyle = 'rgba(255, 233, 156, 0.95)';
	ctx.lineWidth = 1.8;
	tracePath(ctx, loop);
	ctx.stroke();
	ctx.stroke();
	ctx.restore();

	// Barbels, the detail that separates a koi from a large goldfish. Drawn after the
	// body so they sit over the head.
	const nose = pointAt(spine, 0.04);

	ctx.strokeStyle = 'rgba(255, 240, 196, 0.85)';
	ctx.lineWidth = 1;
	for (const side of [-1, 1]) {
		ctx.beginPath();
		ctx.moveTo(nose.x, nose.y + side * 2);
		ctx.quadraticCurveTo(nose.x + 7, nose.y + side * 5, nose.x + 4, nose.y + side * 9);
		ctx.stroke();
	}
}

function drawBubble(ctx: CanvasRenderingContext2D, creature: Creature, time: number): void {
	const seed = hash(creature.id);
	const radius = 24;
	const wobble = Math.sin(time / 700 + seed) * 1.5;
	const r = radius + wobble;

	// Glassy interior: a little brighter towards the top-left, like a real bubble.
	const glass = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
	glass.addColorStop(0, 'rgba(255, 255, 255, 0.38)');
	glass.addColorStop(0.6, 'rgba(255, 255, 255, 0.10)');
	glass.addColorStop(1, 'rgba(255, 255, 255, 0.02)');

	ctx.beginPath();
	ctx.arc(0, 0, r, 0, Math.PI * 2);
	ctx.fillStyle = glass;
	ctx.fill();

	// The waiting task itself, sealed inside and nudging the wall.
	ctx.save();
	ctx.beginPath();
	ctx.arc(0, 0, r, 0, Math.PI * 2);
	ctx.clip();
	ctx.scale(0.62, 0.62);
	ctx.translate(Math.sin(time / 800 + seed) * 7, Math.cos(time / 1100 + seed) * 4);
	drawFish(
		ctx,
		// Sealed in, so it nudges the wall rather than swimming: a low, steady effort.
		{ x: 0, y: 0, flip: false, pitch: 0, effort: 0.85, turn: 0 },
		SPECIES[speciesFor(creature.id)],
		time,
		seed
	);
	ctx.restore();

	ctx.beginPath();
	ctx.arc(0, 0, r, 0, Math.PI * 2);
	if (creature.dashed) {
		// Free text, or a trigger that lost its target: released by hand, so the
		// outline is broken rather than a sealed sphere.
		ctx.setLineDash([5, 5]);
	}
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
	ctx.lineWidth = 2;
	ctx.stroke();
	ctx.setLineDash([]);

	// Specular arc along the top-left, the thing that sells it as glass.
	ctx.beginPath();
	ctx.arc(0, 0, r * 0.82, Math.PI * 1.05, Math.PI * 1.45);
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
	ctx.lineWidth = 2.4;
	ctx.stroke();
}

function drawTreatFish(
	ctx: CanvasRenderingContext2D,
	creature: Creature,
	at: Placement,
	time: number
): void {
	const affordable = !creature.locked;
	const seed = hash(creature.id);
	const spec = SPECIES[treatSpeciesFor(creature.id)];

	// The largest, most ornate creature in the tank. A guilty pleasure you cannot see
	// is a mechanic that does not exist.
	if (affordable) {
		const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, spec.length);
		halo.addColorStop(0, 'rgba(255, 226, 150, 0.45)');
		halo.addColorStop(0.6, 'rgba(255, 140, 220, 0.16)');
		halo.addColorStop(1, 'rgba(255, 196, 107, 0)');
		ctx.fillStyle = halo;
		ctx.beginPath();
		ctx.arc(0, 0, spec.length, 0, Math.PI * 2);
		ctx.fill();
	}

	// Out of reach reads as a promise, not a corpse: drained, never invisible. The dim
	// is multiplied in and put back rather than assigned, so every layer of the fish —
	// body, markings, eye, fins — drains together.
	const outer = ctx.globalAlpha;
	ctx.globalAlpha = outer * (affordable ? 1 : 0.62);

	drawFish(ctx, at, affordable ? spec : LOCKED_TREATS[treatSpeciesFor(creature.id)], time, seed);
	ctx.globalAlpha = outer;

	// Sparkles, affordable only: the tell that you can have it now.
	if (affordable) {
		ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
		for (let i = 0; i < 3; i++) {
			const cycle = (((time / 1100 + i * 0.33 + seed) % 1) + 1) % 1;
			ctx.globalAlpha = outer * Math.sin(cycle * Math.PI);
			ctx.beginPath();
			ctx.arc(spec.length * 0.3 - i * 12, -spec.length * 0.35 - cycle * 10, 1.8, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = outer;
	}
}

/**
 * A pearl: the thing you earned. Worth more pixels than its size suggests — it is the
 * only currency in the app, and a dull grey bead on sand is easy to miss entirely.
 *
 * Built in layers: a breathing halo, an iridescent body, a rim fringe, a hard
 * catchlight, and a twinkle that crosses it every few seconds.
 */
function drawPearl(ctx: CanvasRenderingContext2D, colors: Palette, time: number, seed: number): void {
	const r = 7.5;
	const t = time / 1000;
	const phase = mix32(seed) * Math.PI * 2;
	// Slow breathing, so a bed of pearls glimmers out of step rather than pulsing as one.
	const pulse = 0.5 + 0.5 * Math.sin(t * 1.1 + phase);

	// Halo on the sand beneath.
	const bloom = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 2.6);
	bloom.addColorStop(0, `rgba(255, 255, 255, ${0.5 + pulse * 0.32})`);
	bloom.addColorStop(0.5, `rgba(248, 253, 255, ${0.16 + pulse * 0.12})`);
	bloom.addColorStop(1, 'rgba(255, 255, 255, 0)');
	ctx.fillStyle = bloom;
	ctx.beginPath();
	ctx.arc(0, 0, r * 2.6, 0, Math.PI * 2);
	ctx.fill();

	// Body: lit from the upper left, shading to a cool underside.
	const shine = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
	shine.addColorStop(0, '#FFFFFF');
	shine.addColorStop(0.55, '#FFFFFF');
	shine.addColorStop(0.82, colors.pearl);
	// Pale, not slate: a dark underside was reading as a blue-grey bead.
	shine.addColorStop(1, '#CFE2EC');

	ctx.beginPath();
	ctx.arc(0, 0, r, 0, Math.PI * 2);
	ctx.fillStyle = shine;
	ctx.fill();

	// Iridescence: a faint pink and cyan fringe around the lower rim, which is what
	// makes nacre look like nacre rather than a white ball.
	ctx.lineWidth = 1.4;
	ctx.strokeStyle = `rgba(255, 190, 230, ${0.18 + pulse * 0.14})`;
	ctx.beginPath();
	ctx.arc(0, 0, r - 0.7, Math.PI * 0.15, Math.PI * 0.75);
	ctx.stroke();

	ctx.strokeStyle = `rgba(190, 246, 255, ${0.16 + pulse * 0.14})`;
	ctx.beginPath();
	ctx.arc(0, 0, r - 0.7, Math.PI * 0.8, Math.PI * 1.3);
	ctx.stroke();

	// Bounce light off the sand along the bottom edge.
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
	ctx.lineWidth = 1.2;
	ctx.beginPath();
	ctx.arc(0, 0, r - 1.4, Math.PI * 0.25, Math.PI * 0.7);
	ctx.stroke();

	// Hard catchlight.
	ctx.beginPath();
	ctx.arc(-r * 0.3, -r * 0.34, 2.4, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(255, 255, 255, 0.98)';
	ctx.fill();

	// A four-point sparkle that crosses every few seconds — the difference between a
	// bead that sits there and one that catches the light.
	const twinkle = Math.max(0, Math.sin(t * 0.9 + phase * 2));
	if (twinkle > 0.55) {
		const glint = (twinkle - 0.55) / 0.45;
		const arm = r * (1.1 + glint * 1.5);

		ctx.save();
		ctx.globalCompositeOperation = 'lighter';
		ctx.strokeStyle = `rgba(255, 255, 255, ${glint * 0.9})`;
		ctx.lineWidth = 1.1;
		ctx.beginPath();
		ctx.moveTo(-arm, 0);
		ctx.lineTo(arm, 0);
		ctx.moveTo(0, -arm);
		ctx.lineTo(0, arm);
		ctx.stroke();
		ctx.restore();
	}
}

// ------------------------------------------------------------------ helpers

/** `#RRGGBB` plus an alpha, without pulling in a colour library. */
function withAlpha(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

import type { Creature } from '../scene/types';
import type { Palette } from './palette';
import { WATERLINE, surfaceOffset, type Size } from './water';
import { hash, mix32 } from './rng';
import { speciesFor, SPECIES, type Species, type SpeciesSpec, type FinSpec } from './species';
import {
	spineFor,
	outline,
	pointAt,
	tangentAt,
	profileAt,
	profilePeak,
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

export type Placement = { x: number; y: number; flip: boolean };

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
const LOCKED_EXOTIC: SpeciesSpec = {
	...SPECIES.exotic,
	palette: { ...SPECIES.exotic.palette, back: '#c7a8d8', belly: '#8e7cb0', fin: '#cec4e0' }
};

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

		const x = spreadX(seed, size) + size.w * Math.sin(cruise) * 0.1;
		const y =
			WATERLINE +
			surfaceOffset(x, t * 1000) +
			TREAT_DRAFT +
			Math.sin(cruise * 1.7 + phase) * 12;

		return { x, y, flip: Math.cos(cruise) < 0 };
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

		return { x, y: size.h - 14 - (slot % 3) * 11 - mix32(seed ^ 0x5f5e) * 6, flip: false };
	}

	const kindSpeed = creature.kind === 'koi' ? 0.5 : creature.kind === 'ghost' ? 0.62 : 1;
	const phase = mix32(seed ^ 0x11) * Math.PI * 2;

	// Per-fish tempo, so a tank of six does not move as one organism.
	const pace = (0.17 + mix32(seed ^ 0x1f) * 0.2) * kindSpeed;

	/**
	 * Burst and glide, the way a real fish actually moves: warp the clock instead of
	 * the path, so the same sinusoid is traversed quickly in places and slowly in
	 * others. Kept strictly monotonic (the derivative bottoms out around 0.46 and
	 * peaks near 1.54) — if it ever went negative the fish would twitch backwards
	 * mid-stroke instead of easing.
	 */
	const warp = t + Math.sin(t * 0.37 + phase) * 0.9 + Math.sin(t * 0.13 + phase * 1.7) * 1.6;
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
 */
function spreadX(seed: number, size: Size): number {
	const position = ((seed % 1000) * 0.6180339887) % 1;
	return size.w * (0.14 + position * 0.72);
}

// ------------------------------------------------------------------ drawing

export function drawCreature(
	ctx: CanvasRenderingContext2D,
	creature: Creature,
	at: Placement,
	colors: Palette,
	time: number
): void {
	ctx.save();
	ctx.translate(at.x, at.y);

	switch (creature.kind) {
		case 'fish':
			// A bought treat keeps its exotic look, at a size that sits in the shoal.
			// Turning it into an ordinary fish read as the prize vanishing on purchase.
			if (creature.claimed) {
				ctx.scale(0.72, 0.72);
				drawFish(ctx, at, SPECIES.exotic, time, hash(creature.id));
			} else {
				drawFish(ctx, at, SPECIES[speciesFor(creature.id)], time, hash(creature.id));
			}
			break;
		case 'ghost':
			drawGhost(ctx, at, SPECIES[speciesFor(creature.id)], time, hash(creature.id));
			break;
		case 'koi':
			drawKoi(ctx, at, time, hash(creature.id));
			break;
		case 'bubble':
			drawBubble(ctx, creature, colors, time);
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

/** Paints every creature in one pass, back to front: bubbles and pearls behind, koi in front. */
export function drawCreatures(
	ctx: CanvasRenderingContext2D,
	creatures: Creature[],
	colors: Palette,
	size: Size,
	time: number,
	animate = true
): void {
	const order: Record<Creature['kind'], number> = {
		pearl: 0,
		bubble: 1,
		ghost: 2,
		fish: 3,
		koi: 4,
		treat: 5
	};

	for (const creature of [...creatures].sort((a, b) => order[a.kind] - order[b.kind])) {
		drawCreature(ctx, creature, place(creature, size, time, animate), colors, time);
	}
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

/** Fills the body outline, lit from above, with a rim so it holds its edge in the water. */
function drawBody(ctx: CanvasRenderingContext2D, spec: SpeciesSpec, spine: Spine, alpha = 1): void {
	const loop = outline(spine, spec.profile, spec.length);

	// The ramp has to span the body's real depth, not half its *length*. At `length/2`
	// every species but the angel — whose profile happens to peak at 0.5 — sampled only
	// the middle third of the gradient and came out a flat mid-tone.
	const half = profilePeak(spec.profile) * spec.length;

	const shade = ctx.createLinearGradient(0, -half, 0, half);
	shade.addColorStop(0, spec.palette.back);
	shade.addColorStop(1, spec.palette.belly);

	// Multiply, never assign: a caller may already have dimmed the context (a locked
	// treat, a ghost), and assigning would repaint the body at full brightness inside
	// an otherwise drained fish — leaving only the fins looking spent.
	const outer = ctx.globalAlpha;
	ctx.globalAlpha = outer * alpha;

	tracePath(ctx, loop);
	ctx.fillStyle = shade;
	ctx.fill();

	tracePath(ctx, loop);
	ctx.strokeStyle = withAlpha(spec.palette.belly, 0.5);
	ctx.lineWidth = 1.2;
	ctx.stroke();
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
): { half: number; span: number } {
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

	ctx.beginPath();
	ctx.moveTo(0, half * 0.6);
	ctx.quadraticCurveTo(-span * 0.3, half + span * 0.5, -span * fin.sweep, half + span);
	ctx.quadraticCurveTo(span * 0.1, half + span * 0.4 + flutter * span, span * 0.15, half * 0.5);
	ctx.closePath();

	return { half, span };
}

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
	const { half, span } = traceFin(ctx, spec, fin, spine, time, phase, side);

	ctx.fillStyle = withAlpha(spec.palette.fin, 0.82);
	ctx.fill();

	// Rays, so the fin reads as a fin and not a petal.
	ctx.strokeStyle = withAlpha(spec.palette.belly, 0.25);
	ctx.lineWidth = 0.8;
	for (const k of [0.25, 0.5, 0.75]) {
		ctx.beginPath();
		ctx.moveTo(0, half * 0.6);
		ctx.lineTo(-span * fin.sweep * k, half + span * k);
		ctx.stroke();
	}

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
	const radius = Math.max(2.2, half * 0.34);

	// Eye white.
	ctx.beginPath();
	ctx.arc(at.x, at.y - half * 0.25, radius, 0, Math.PI * 2);
	ctx.fillStyle = '#ffffff';
	ctx.fill();

	// Iris and pupil.
	ctx.beginPath();
	ctx.arc(at.x + radius * 0.18, at.y - half * 0.25, radius * 0.62, 0, Math.PI * 2);
	ctx.fillStyle = spec.palette.iris;
	ctx.fill();

	// Catchlight — small, and most of what sells it.
	ctx.beginPath();
	ctx.arc(at.x - radius * 0.3, at.y - half * 0.25 - radius * 0.3, radius * 0.26, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
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
	seed: number
): void {
	if (spec.pattern === 'none') return;

	ctx.save();
	tracePath(ctx, outline(spine, spec.profile, spec.length));
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

function drawFish(
	ctx: CanvasRenderingContext2D,
	at: Placement,
	spec: SpeciesSpec,
	time: number,
	seed: number
): void {
	if (at.flip) ctx.scale(-1, 1);

	const phase = mix32(seed ^ 0x11) * Math.PI * 2;
	const spine = spineFor(spec.length, spec.wave, time, phase);

	drawRearFins(ctx, spec, spine, time, phase);
	drawBody(ctx, spec, spine);
	drawMarkings(ctx, spec, spine, seed);
	drawPectoral(ctx, spec, spine, time, phase);
	drawHead(ctx, spec, spine, time, phase);
	drawTrail(ctx, time, seed, spec.length);
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
	const spine = spineFor(spec.length, spec.wave, time, phase);
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
		ctx.arc(-len * 0.75 - cycle * 10, -cycle * 20, 1.4 + i * 0.5, 0, Math.PI * 2);
		ctx.stroke();
	}

	ctx.globalAlpha = outer;
}

/** The cleared-day koi: an ordinary fish body with barbels and a gold rim. */
function drawKoi(ctx: CanvasRenderingContext2D, at: Placement, time: number, seed: number): void {
	const spec = SPECIES.koi;
	drawFish(ctx, at, spec, time, seed);

	// Barbels, the detail that separates a koi from a large goldfish. Drawn after the
	// body so they sit over the head.
	const phase = mix32(seed ^ 0x11) * Math.PI * 2;
	const spine = spineFor(spec.length, spec.wave, time, phase);
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

function drawBubble(
	ctx: CanvasRenderingContext2D,
	creature: Creature,
	colors: Palette,
	time: number
): void {
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
	drawFish(ctx, { x: 0, y: 0, flip: false }, SPECIES[speciesFor(creature.id)], time, seed);
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

	void colors;
}

function drawTreatFish(
	ctx: CanvasRenderingContext2D,
	creature: Creature,
	at: Placement,
	time: number
): void {
	const affordable = !creature.locked;
	const seed = hash(creature.id);
	const spec = SPECIES.exotic;

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

	drawFish(ctx, at, affordable ? spec : LOCKED_EXOTIC, time, seed);
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

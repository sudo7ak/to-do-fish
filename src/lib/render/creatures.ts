import type { Creature } from '../scene/types';
import type { Palette } from './palette';
import { WATERLINE, surfaceOffset, type Size } from './water';
import { hash, mix32 } from './rng';
import { speciesFor, SPECIES, type Species, type SpeciesSpec } from './species';
import { spineFor, outline, type Spine } from './spine';

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

/** How far below the waterline the treat fish cruises. */
const TREAT_DRAFT = 34;

/**
 * Where the add-pill's shadow starts, as a fraction of width. Pearls stay outside
 * `[1 - PILL_EDGE, PILL_EDGE]` so the bottom button never covers them.
 */
const PILL_EDGE = 0.74;

// ----------------------------------------------------------------- species
//
// Species *selection* (the `Species` union and `speciesFor`) now lives in
// `species.ts`, imported and re-exported above. What remains here is the legacy
// per-species drawing spec (flat colours, canned tail shapes) that the shape
// functions below still consume. It is keyed on the six swimmer species only —
// `species.ts` additionally carries `koi` and `exotic`, which are drawn by their
// own dedicated functions (`drawKoi`, `drawTreatFish`) and never indexed through
// this table.

/** The six species this legacy drawing table has entries for. */
type Swimmer = Exclude<Species, 'koi' | 'exotic'>;

type LegacySpeciesSpec = {
	length: number;
	height: number;
	/** Body gradient, back to belly. */
	body: [string, string];
	fin: string;
	tail: 'fan' | 'forked' | 'veil' | 'round';
	pattern: 'bands' | 'stripe' | 'spots' | 'none';
	patternColor: string;
	/**
	 * Fin size, as a fraction of body length. Kept well under 1: fins larger than the
	 * body stop reading as fins and start reading as debris floating alongside it.
	 */
	flow: number;
};

const LEGACY_SPECIES: Record<Swimmer, LegacySpeciesSpec> = {
	clown: {
		length: 42,
		height: 24,
		body: ['#FF9A4D', '#E85A2C'],
		fin: '#FFB877',
		tail: 'round',
		pattern: 'bands',
		patternColor: '#FFF4E4',
		flow: 0.3
	},
	tang: {
		length: 44,
		height: 28,
		body: ['#49B6F7', '#1B5FC1'],
		fin: '#FFD84D',
		tail: 'forked',
		pattern: 'none',
		patternColor: '#0E3E86',
		flow: 0.3
	},
	angel: {
		length: 36,
		height: 32,
		body: ['#FFE9BE', '#EFA63A'],
		fin: '#FFF0D2',
		tail: 'veil',
		pattern: 'bands',
		patternColor: '#6B4A22',
		flow: 0.42
	},
	guppy: {
		length: 34,
		height: 19,
		body: ['#93EBFF', '#4A7BE8'],
		fin: '#FF93D2',
		tail: 'fan',
		pattern: 'spots',
		patternColor: '#FFE066',
		flow: 0.38
	},
	neon: {
		length: 32,
		height: 15,
		body: ['#6BEAFF', '#1B7FD4'],
		fin: '#CFF6FF',
		tail: 'forked',
		pattern: 'stripe',
		patternColor: '#FF3B4E',
		flow: 0.26
	},
	betta: {
		length: 36,
		height: 24,
		body: ['#CE7BFF', '#7A2BD1'],
		fin: '#FF7FB4',
		tail: 'veil',
		pattern: 'none',
		patternColor: '#4A1580',
		flow: 0.45
	}
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

/** Spreads same-depth creatures across the width so they do not stack in one column. */
function laneX(seed: number, size: Size, spread: number): number {
	const jitter = (seed % 1000) / 1000;
	return size.w * (0.1 + jitter * 0.8 * Math.max(spread, 0.4));
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
				drawTreatFish(ctx, { ...creature, locked: false }, at, time);
			} else {
				drawFish(ctx, at, SPECIES[speciesFor(creature.id)], time, hash(creature.id));
			}
			break;
		case 'ghost':
			drawGhost(ctx, at, LEGACY_SPECIES[speciesFor(creature.id) as Swimmer], time, hash(creature.id));
			break;
		case 'koi':
			drawKoi(ctx, at, time);
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

/** The body outline, shared by every species so the silhouette family stays coherent. */
function bodyPath(ctx: CanvasRenderingContext2D, len: number, hgt: number): void {
	const half = len / 2;
	ctx.beginPath();
	ctx.moveTo(half, 0);
	// Back: nose up over the dorsal line to the tail root.
	ctx.bezierCurveTo(half * 0.5, -hgt, -half * 0.5, -hgt * 0.9, -half, 0);
	// Belly: fuller than the back, which is what makes it read as a fish.
	ctx.bezierCurveTo(-half * 0.5, hgt * 0.95, half * 0.5, hgt, half, 0);
	ctx.closePath();
}

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
	const half = spec.length * 0.5;

	const shade = ctx.createLinearGradient(0, -half, 0, half);
	shade.addColorStop(0, spec.palette.back);
	shade.addColorStop(1, spec.palette.belly);

	ctx.globalAlpha = alpha;
	tracePath(ctx, loop);
	ctx.fillStyle = shade;
	ctx.fill();

	tracePath(ctx, loop);
	ctx.strokeStyle = withAlpha(spec.palette.belly, 0.5);
	ctx.lineWidth = 1.2;
	ctx.stroke();
	ctx.globalAlpha = 1;
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

	drawBody(ctx, spec, spine);
	drawTrail(ctx, time, seed, spec.length);
}

/** A resolved task keeps swimming, drained to a translucent outline of the same fish. */
function drawGhost(
	ctx: CanvasRenderingContext2D,
	at: Placement,
	spec: LegacySpeciesSpec,
	time: number,
	seed: number
): void {
	if (at.flip) ctx.scale(-1, 1);

	const { length: len, height: hgt } = spec;
	const beat = Math.sin(time / 200 + seed);

	// A finished task should still be legible as one. At 0.4 the outline all but
	// vanished against the water, so completing something looked like it deleted it.
	ctx.globalAlpha = 0.62;
	ctx.strokeStyle = withAlpha(spec.body[0], 0.95);
	ctx.lineWidth = 2.2;

	// A faint wash inside the outline, so the shape reads as a body rather than wire.
	bodyPath(ctx, len, hgt);
	ctx.fillStyle = withAlpha(spec.body[0], 0.16);
	ctx.fill();

	// Tail, outlined.
	ctx.beginPath();
	ctx.moveTo(-len / 2, 0);
	ctx.quadraticCurveTo(-len * 0.8, -hgt * 0.7 + beat * 3, -len, -hgt * 0.5 + beat * 4);
	ctx.quadraticCurveTo(-len * 0.7, 0, -len, hgt * 0.5 + beat * 4);
	ctx.quadraticCurveTo(-len * 0.8, hgt * 0.7 + beat * 3, -len / 2, 0);
	ctx.stroke();

	bodyPath(ctx, len, hgt);
	ctx.stroke();

	// Dorsal, outlined.
	ctx.beginPath();
	ctx.moveTo(len * 0.2, -hgt * 0.85);
	ctx.quadraticCurveTo(0, -hgt * 1.5, -len * 0.3, -hgt * 0.8);
	ctx.stroke();

	// One dot of eye, so the outline still reads as facing somewhere.
	ctx.beginPath();
	ctx.arc(len * 0.3, -hgt * 0.18, 1.6, 0, Math.PI * 2);
	ctx.stroke();

	ctx.globalAlpha = 1;
}

/**
 * The caudal fin, rooted exactly at the tail of the body so it reads as attached.
 * Sized off `flow` as a fraction of body length — never longer than the fish.
 */
function drawTail(ctx: CanvasRenderingContext2D, spec: LegacySpeciesSpec, beat: number): void {
	const { length: len, height: hgt, flow } = spec;
	const root = -len / 2 + 1;
	const reach = len * flow;
	const spread = hgt * (0.45 + flow * 0.7);
	const sway = beat * 4;

	// The root is a short vertical edge on the body, not a single point — a tail
	// pinched to one vertex reads as a leaf stuck on the back.
	const rootHalf = hgt * 0.22;

	ctx.fillStyle = withAlpha(spec.fin, 0.8);
	ctx.beginPath();
	ctx.moveTo(root, -rootHalf);

	switch (spec.tail) {
		case 'forked':
			ctx.lineTo(root - reach, -spread + sway);
			ctx.quadraticCurveTo(root - reach * 0.5, 0, root - reach, spread + sway);
			ctx.lineTo(root, rootHalf);
			break;
		case 'fan':
			ctx.quadraticCurveTo(root - reach * 0.8, -spread * 0.95 + sway, root - reach, -spread * 0.5 + sway);
			ctx.quadraticCurveTo(root - reach * 1.1, sway, root - reach, spread * 0.5 + sway);
			ctx.quadraticCurveTo(root - reach * 0.8, spread * 0.95 + sway, root, rootHalf);
			break;
		case 'veil':
			ctx.quadraticCurveTo(root - reach * 0.7, -spread * 0.85 + sway, root - reach * 1.1, -spread * 0.1 + sway * 1.6);
			ctx.quadraticCurveTo(root - reach * 0.9, spread * 0.7 + sway * 1.4, root - reach * 0.45, spread * 0.55 + sway);
			ctx.quadraticCurveTo(root - reach * 0.3, spread * 0.3, root, rootHalf);
			break;
		case 'round':
			ctx.quadraticCurveTo(root - reach * 0.9, -spread * 0.9 + sway, root - reach, sway);
			ctx.quadraticCurveTo(root - reach * 0.9, spread * 0.9 + sway, root, rootHalf);
			break;
	}

	ctx.closePath();
	ctx.fill();

	// Fin rays, fanning from the root. Cheap, and it stops the tail reading as a
	// flat paper cut-out.
	ctx.strokeStyle = withAlpha(spec.body[1], 0.28);
	ctx.lineWidth = 0.9;
	for (const f of [-0.6, 0, 0.6]) {
		ctx.beginPath();
		ctx.moveTo(root, 0);
		ctx.lineTo(root - reach * 0.85, spread * f + sway);
		ctx.stroke();
	}
}

/**
 * Dorsal and anal fins, drawn as low ridges sitting *on* the body outline rather
 * than as separate shapes hovering near it.
 */
function drawFins(ctx: CanvasRenderingContext2D, spec: LegacySpeciesSpec, beat: number): void {
	const { length: len, height: hgt, flow } = spec;
	ctx.fillStyle = withAlpha(spec.fin, 0.85);

	// Dorsal: rises from the shoulder, peaks mid-back, settles at the tail root.
	const peak = hgt * (0.55 + flow * 0.9);
	ctx.beginPath();
	ctx.moveTo(len * 0.2, -hgt * 0.62);
	ctx.quadraticCurveTo(len * 0.02, -peak + beat * 1.5, -len * 0.3, -hgt * 0.5);
	ctx.quadraticCurveTo(-len * 0.05, -hgt * 0.72, len * 0.2, -hgt * 0.62);
	ctx.closePath();
	ctx.fill();

	// Anal fin, shallower, mirroring below.
	ctx.beginPath();
	ctx.moveTo(-len * 0.02, hgt * 0.66);
	ctx.quadraticCurveTo(-len * 0.18, hgt * (0.78 + flow * 0.5) - beat, -len * 0.36, hgt * 0.5);
	ctx.quadraticCurveTo(-len * 0.16, hgt * 0.66, -len * 0.02, hgt * 0.66);
	ctx.closePath();
	ctx.fill();
}

/** Markings, clipped to the body so nothing spills over the silhouette. */
function drawPattern(ctx: CanvasRenderingContext2D, spec: LegacySpeciesSpec, seed: number): void {
	if (spec.pattern === 'none') return;

	const { length: len, height: hgt } = spec;

	ctx.save();
	bodyPath(ctx, len, hgt);
	ctx.clip();
	ctx.fillStyle = spec.patternColor;

	if (spec.pattern === 'bands') {
		// Slim, slightly raked bands. Thick bars turn a fish into a bee.
		ctx.globalAlpha = 0.85;
		for (let i = 0; i < 3; i++) {
			const x = len * 0.26 - i * len * 0.26;
			ctx.save();
			ctx.translate(x, 0);
			ctx.rotate(-0.14);
			ctx.beginPath();
			ctx.moveTo(-len * 0.035, -hgt);
			ctx.quadraticCurveTo(0, 0, -len * 0.035, hgt);
			ctx.lineTo(len * 0.035, hgt);
			ctx.quadraticCurveTo(len * 0.012, 0, len * 0.035, -hgt);
			ctx.closePath();
			ctx.fill();
			ctx.restore();
		}
		ctx.globalAlpha = 1;
	} else if (spec.pattern === 'stripe') {
		// Neon: a bright lateral line rather than a slab across the whole flank.
		ctx.globalAlpha = 0.9;
		ctx.fillRect(-len * 0.45, -hgt * 0.06, len * 0.85, hgt * 0.18);
		ctx.globalAlpha = 1;
	} else if (spec.pattern === 'spots') {
		for (let i = 0; i < 5; i++) {
			const jitter = ((seed >> (i * 3)) % 100) / 100;
			ctx.beginPath();
			ctx.arc(len * 0.3 - i * len * 0.14, (jitter - 0.5) * hgt, 1.5 + jitter, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	ctx.restore();
}

function drawEye(ctx: CanvasRenderingContext2D, spec: LegacySpeciesSpec): void {
	const x = spec.length * 0.3;
	const y = -spec.height * 0.18;

	ctx.beginPath();
	ctx.arc(x, y, 3.1, 0, Math.PI * 2);
	ctx.fillStyle = '#FFFFFF';
	ctx.fill();

	ctx.beginPath();
	ctx.arc(x + 0.5, y, 1.7, 0, Math.PI * 2);
	ctx.fillStyle = '#12222B';
	ctx.fill();

	// Catchlight. Small, but it is most of what makes the fish look alive.
	ctx.beginPath();
	ctx.arc(x - 0.7, y - 1, 0.7, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
	ctx.fill();
}

/** The bubble trail behind a live fish. Three bubbles rising and fading on a loop. */
function drawTrail(ctx: CanvasRenderingContext2D, time: number, seed: number, len: number): void {
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
	ctx.lineWidth = 0.8;

	for (let i = 0; i < 3; i++) {
		const cycle = (((time / 900 + seed + i * 0.33) % 1) + 1) % 1;
		ctx.globalAlpha = 0.45 * (1 - cycle);
		ctx.beginPath();
		// Behind the tail, not off the nose: a fish does not breathe backwards.
		ctx.arc(-len * 0.75 - cycle * 10, -cycle * 20, 1.4 + i * 0.5, 0, Math.PI * 2);
		ctx.stroke();
	}

	ctx.globalAlpha = 1;
}

function drawKoi(ctx: CanvasRenderingContext2D, at: Placement, time: number): void {
	if (at.flip) ctx.scale(-1, 1);

	const len = 46;
	const hgt = 17;
	const beat = Math.sin(time / 300);

	// Trailing veil fins first, so the body sits over them.
	ctx.fillStyle = 'rgba(255, 226, 168, 0.75)';
	ctx.beginPath();
	ctx.moveTo(-len / 2, 0);
	ctx.quadraticCurveTo(-len * 0.85, -hgt * 1.1 + beat * 6, -len * 1.05, -hgt * 0.3 + beat * 8);
	ctx.quadraticCurveTo(-len * 0.7, 0, -len * 1.05, hgt * 0.5 + beat * 8);
	ctx.quadraticCurveTo(-len * 0.85, hgt * 1.1 + beat * 6, -len / 2, 0);
	ctx.closePath();
	ctx.fill();

	const gradient = ctx.createLinearGradient(0, -hgt, 0, hgt);
	gradient.addColorStop(0, '#FFF0C4');
	gradient.addColorStop(0.45, '#FFC46B');
	gradient.addColorStop(1, '#E08A2B');

	bodyPath(ctx, len, hgt);
	ctx.fillStyle = gradient;
	ctx.fill();

	// The red kohaku blotches that make a koi a koi.
	ctx.save();
	bodyPath(ctx, len, hgt);
	ctx.clip();
	ctx.fillStyle = 'rgba(226, 78, 47, 0.85)';
	ctx.beginPath();
	ctx.arc(len * 0.16, -hgt * 0.35, 7, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.arc(-len * 0.2, hgt * 0.1, 5.5, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();

	// Gold rim, which is what separates it from an ordinary orange fish.
	bodyPath(ctx, len, hgt);
	ctx.strokeStyle = 'rgba(255, 240, 196, 0.9)';
	ctx.lineWidth = 1.4;
	ctx.stroke();

	// Barbels.
	ctx.beginPath();
	ctx.moveTo(len * 0.46, hgt * 0.1);
	ctx.quadraticCurveTo(len * 0.58, hgt * 0.3, len * 0.52, hgt * 0.5);
	ctx.strokeStyle = 'rgba(255, 240, 196, 0.8)';
	ctx.lineWidth = 1;
	ctx.stroke();

	drawEye(ctx, { ...LEGACY_SPECIES.clown, length: len, height: hgt });
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
	const len = 58;
	const hgt = 40;
	const beat = Math.sin(time / 220 + seed);

	// Deliberately the largest and most ornate creature in the tank. A guilty
	// pleasure has to be the thing your eye lands on first, or the whole mechanic
	// is invisible — it is the only creature you buy rather than do.
	if (affordable) {
		const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, len);
		halo.addColorStop(0, 'rgba(255, 226, 150, 0.45)');
		halo.addColorStop(0.6, 'rgba(255, 140, 220, 0.16)');
		halo.addColorStop(1, 'rgba(255, 196, 107, 0)');
		ctx.fillStyle = halo;
		ctx.beginPath();
		ctx.arc(0, 0, len, 0, Math.PI * 2);
		ctx.fill();
	}

	// Out of reach: drained towards the water, so it reads as a promise rather than
	// a fish you already own. Never invisible — you should still want it.
	ctx.globalAlpha = affordable ? 1 : 0.62;
	if (at.flip) ctx.scale(-1, 1);

	// Trailing filaments from the tail, drifting behind the beat.
	ctx.strokeStyle = affordable ? 'rgba(255, 208, 120, 0.85)' : 'rgba(206, 190, 222, 0.65)';
	ctx.lineWidth = 1.6;
	for (const f of [-0.5, 0, 0.5]) {
		ctx.beginPath();
		ctx.moveTo(-len * 0.42, hgt * 0.06 * f);
		ctx.quadraticCurveTo(
			-len * 0.75,
			hgt * (0.35 * f) + beat * 5,
			-len * 0.98,
			hgt * (0.55 * f) + beat * 9
		);
		ctx.stroke();
	}

	// Veil tail.
	ctx.fillStyle = affordable ? 'rgba(255, 168, 214, 0.72)' : 'rgba(214, 190, 226, 0.45)';
	ctx.beginPath();
	ctx.moveTo(-len * 0.4, -hgt * 0.2);
	ctx.quadraticCurveTo(-len * 0.68, -hgt * 0.5 + beat * 4, -len * 0.84, beat * 7);
	ctx.quadraticCurveTo(-len * 0.66, hgt * 0.5 + beat * 5, -len * 0.4, hgt * 0.2);
	ctx.closePath();
	ctx.fill();

	// Tall sail fins, above and below — the silhouette that says "not an ordinary fish".
	const dorsal = () => {
		ctx.beginPath();
		ctx.moveTo(len * 0.24, -hgt * 0.46);
		ctx.quadraticCurveTo(len * 0.02, -hgt * 0.92 + beat * 3, -len * 0.28, -hgt * 0.44);
		ctx.quadraticCurveTo(-len * 0.04, -hgt * 0.56, len * 0.24, -hgt * 0.46);
		ctx.closePath();
	};
	const anal = () => {
		ctx.beginPath();
		ctx.moveTo(len * 0.14, hgt * 0.46);
		ctx.quadraticCurveTo(-len * 0.06, hgt * 0.82 - beat * 3, -len * 0.32, hgt * 0.42);
		ctx.quadraticCurveTo(-len * 0.06, hgt * 0.54, len * 0.14, hgt * 0.46);
		ctx.closePath();
	};

	ctx.fillStyle = affordable ? 'rgba(255, 190, 120, 0.8)' : 'rgba(206, 196, 224, 0.5)';
	dorsal();
	ctx.fill();
	anal();
	ctx.fill();

	// Rays, clipped to each sail. Unclipped they shoot past the fin edges and read as
	// scratches on the glass.
	ctx.strokeStyle = affordable ? 'rgba(214, 120, 40, 0.35)' : 'rgba(150, 150, 180, 0.3)';
	ctx.lineWidth = 0.9;
	for (const [shape, dir] of [
		[dorsal, -1],
		[anal, 1]
	] as const) {
		ctx.save();
		shape();
		ctx.clip();
		for (let i = 0; i < 5; i++) {
			const rx = len * 0.2 - i * len * 0.11;
			ctx.beginPath();
			ctx.moveTo(rx, dir * hgt * 0.4);
			ctx.lineTo(rx - len * 0.03, dir * hgt);
			ctx.stroke();
		}
		ctx.restore();
	}

	// Iridescent body: magenta shoulder into gold into deep violet.
	const body = ctx.createLinearGradient(0, -hgt * 0.4, 0, hgt * 0.4);
	if (affordable) {
		body.addColorStop(0, '#FF6FC7');
		body.addColorStop(0.42, '#FFD166');
		body.addColorStop(1, '#7A3BD1');
	} else {
		body.addColorStop(0, '#C7A8D8');
		body.addColorStop(0.45, '#D9CBE4');
		body.addColorStop(1, '#8E7CB0');
	}

	bodyPath(ctx, len * 0.86, hgt * 0.56);
	ctx.fillStyle = body;
	ctx.fill();

	// Scale shimmer, clipped to the body.
	ctx.save();
	bodyPath(ctx, len * 0.86, hgt * 0.56);
	ctx.clip();
	ctx.strokeStyle = affordable ? 'rgba(255, 255, 255, 0.32)' : 'rgba(255, 255, 255, 0.16)';
	ctx.lineWidth = 1;
	for (let i = -2; i < 4; i++) {
		ctx.beginPath();
		ctx.arc(len * 0.1 - i * 7, 0, 9, -0.9, 0.9);
		ctx.stroke();
	}
	ctx.restore();

	bodyPath(ctx, len * 0.86, hgt * 0.56);
	ctx.strokeStyle = affordable ? 'rgba(122, 59, 209, 0.55)' : 'rgba(126, 110, 156, 0.5)';
	ctx.lineWidth = 1.2;
	ctx.stroke();

	drawEye(ctx, { ...LEGACY_SPECIES.betta, length: len * 0.86, height: hgt * 0.56 });

	// Sparkles, affordable only: the tell that you can have it now.
	if (affordable) {
		ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
		for (let i = 0; i < 3; i++) {
			const cycle = (((time / 1100 + i * 0.33 + seed) % 1) + 1) % 1;
			ctx.globalAlpha = Math.sin(cycle * Math.PI);
			const sx = len * 0.42 - i * 12;
			const sy = -hgt * 0.5 - cycle * 10;
			ctx.beginPath();
			ctx.arc(sx, sy, 1.8, 0, Math.PI * 2);
			ctx.fill();
		}
	}

	ctx.globalAlpha = 1;
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

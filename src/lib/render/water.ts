import type { Palette } from './palette';

/**
 * The tank itself: water, light, substrate, planting, surface.
 *
 * Everything here is per-pixel work — gradients, light shafts, a wavy top edge,
 * drifting motes — which is why the tank is one canvas rather than forty animated
 * SVG nodes.
 *
 * Positions are derived from `time` and a deterministic per-element hash on every
 * frame, and never stored. Under reduced motion the caller passes a frozen `time`
 * and the same code draws a still tank.
 */

export type Size = { w: number; h: number };

/**
 * Where the water surface sits, in CSS pixels from the top.
 *
 * Deep enough to clear the date header, because the lanterns rest *on* this line and
 * would otherwise be drawn behind the chrome and clipped by the top of the canvas.
 * Exported so `creatures.ts` floats them on the same line this file draws — two
 * numbers would drift apart the first time either changed.
 */
export const WATERLINE = 128;

/** Amplitude of the surface wave, so callers can sit something on the moving line. */
export function surfaceOffset(x: number, time: number): number {
	const t = time / 1000;
	return Math.sin(x / 90 + t * 0.9) * 5 + Math.sin(x / 37 - t * 1.4) * 2.5;
}

/** Deterministic pseudo-random in [0, 1) for element `i`. Same tank on every reload. */
function noise(i: number, salt = 0): number {
	const value = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
	return value - Math.floor(value);
}

/** Paints the water column. Everything else is drawn over this. */
export function drawWater(ctx: CanvasRenderingContext2D, size: Size, colors: Palette): void {
	// Three stops, not two: real water darkens fastest just below the surface, and a
	// linear fade reads as a flat backdrop instead of depth.
	const gradient = ctx.createLinearGradient(0, 0, 0, size.h);
	gradient.addColorStop(0, colors.waterTop);
	gradient.addColorStop(0.45, colors.waterMid);
	gradient.addColorStop(1, colors.waterBottom);

	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size.w, size.h);
}

/**
 * The animated wavy surface, which gives the tank a real top edge. Two offset sine
 * waves so the crests never line up into an obvious repeat, plus a bright meniscus
 * line where the light catches.
 */
export function drawSurface(
	ctx: CanvasRenderingContext2D,
	size: Size,
	colors: Palette,
	time: number
): void {
	const waveAt = (x: number) => WATERLINE + surfaceOffset(x, time);

	// The bright band is a shallow lip just above the wave, NOT a fill from the top of
	// the canvas: the tank is full-bleed water, and filling to y=0 turns the whole
	// upper screen into a milky slab once the waterline sits deep enough to clear the
	// header.
	const lip = 26;

	ctx.beginPath();
	ctx.moveTo(0, WATERLINE - lip);
	for (let x = 0; x <= size.w; x += 4) ctx.lineTo(x, waveAt(x));
	ctx.lineTo(size.w, WATERLINE - lip);
	ctx.closePath();

	const band = ctx.createLinearGradient(0, WATERLINE - lip, 0, WATERLINE + 6);
	band.addColorStop(0, 'rgba(255, 255, 255, 0)');
	band.addColorStop(1, 'rgba(255, 255, 255, 0.22)');
	ctx.fillStyle = band;
	ctx.fill();

	// Meniscus: the bright line at the waterline itself.
	ctx.beginPath();
	for (let x = 0; x <= size.w; x += 4) {
		if (x === 0) ctx.moveTo(x, waveAt(x));
		else ctx.lineTo(x, waveAt(x));
	}
	ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 * colors.light + 0.25})`;
	ctx.lineWidth = 2;
	ctx.stroke();
}

/**
 * Caustic light shafts falling from the surface, drawn with `lighter` so they add
 * light rather than painting over the creatures beneath them.
 */
export function drawCaustics(
	ctx: CanvasRenderingContext2D,
	size: Size,
	time: number,
	strength = 1
): void {
	if (strength <= 0) return;
	const t = time / 1000;

	ctx.save();
	ctx.globalCompositeOperation = 'lighter';

	// Broad god rays.
	for (let i = 0; i < 6; i++) {
		const drift = Math.sin(t * 0.25 + i * 1.7) * size.w * 0.08;
		const x = ((i + 0.5) / 6) * size.w + drift;
		const width = size.w * 0.05;
		const sway = Math.sin(t * 0.4 + i) * 0.35;

		const shaft = ctx.createLinearGradient(x, 0, x + width, size.h);
		shaft.addColorStop(0, `rgba(255, 253, 235, ${0.2 * strength})`);
		shaft.addColorStop(0.5, `rgba(220, 250, 255, ${0.07 * strength})`);
		shaft.addColorStop(1, 'rgba(255, 255, 255, 0)');

		ctx.fillStyle = shaft;
		ctx.beginPath();
		ctx.moveTo(x - width, 0);
		ctx.lineTo(x + width, 0);
		ctx.lineTo(x + width * (2.6 + sway), size.h);
		ctx.lineTo(x - width * (1.6 - sway), size.h);
		ctx.closePath();
		ctx.fill();
	}

	/**
	 * Dappled caustics: short, scattered arcs rather than full-width sine rows.
	 *
	 * Continuous lines across the whole tank read as contour lines on a map — the eye
	 * follows them end to end. Real caustics are broken lace, so these are cut into
	 * segments of differing length, brightness and drift, and they fade out with
	 * depth because the light does.
	 */
	ctx.lineCap = 'round';
	for (let i = 0; i < 16; i++) {
		const depth = noise(i, 21);
		const y = WATERLINE + 20 + depth * size.h * 0.55;
		const span = 30 + noise(i, 22) * 90;
		// Drift sideways, wrapping, so the pattern never sits still or repeats cleanly.
		const x0 = ((noise(i, 23) * size.w + t * (6 + noise(i, 24) * 10)) % (size.w + span)) - span;

		// Dimmer further down, and never uniform.
		const fade = (1 - depth * 0.75) * (0.5 + noise(i, 25) * 0.5);
		ctx.strokeStyle = `rgba(255, 255, 255, ${0.07 * strength * fade})`;
		ctx.lineWidth = 2 + noise(i, 26) * 3;

		ctx.beginPath();
		for (let x = 0; x <= span; x += 6) {
			const wave =
				Math.sin((x0 + x) / 38 + t * 0.9 + i) * 5 + Math.sin((x0 + x) / 90 - t * 0.4 + i) * 7;
			if (x === 0) ctx.moveTo(x0, y + wave);
			else ctx.lineTo(x0 + x, y + wave);
		}
		ctx.stroke();
	}

	ctx.restore();
}

/** Sand bed and a couple of rounded stones, so the tank has a floor to sit on. */
/**
 * The sand's top surface at `x`.
 *
 * One formula, used by the bed and by everything planted in it. Planting used to root
 * on a flat `size.h - 6` while the bed undulated independently, so the blades grew out
 * of a line hanging in the sand rather than out of the sand itself — subtle per blade,
 * and the main reason the bottom read as a pasted-on layer.
 */
export function bedTopAt(x: number, size: Size): number {
	const bedHeight = Math.min(70, size.h * 0.12);
	return size.h - bedHeight + Math.sin(x / 70) * 6 + Math.sin(x / 23) * 2;
}

export function drawSubstrate(ctx: CanvasRenderingContext2D, size: Size, colors: Palette): void {
	const bedHeight = Math.min(70, size.h * 0.12);
	const top = size.h - bedHeight;

	// Dune profile rather than a straight edge.
	ctx.beginPath();
	ctx.moveTo(0, size.h);
	ctx.lineTo(0, top + 10);
	for (let x = 0; x <= size.w; x += 12) ctx.lineTo(x, bedTopAt(x, size));
	ctx.lineTo(size.w, size.h);
	ctx.closePath();

	const bed = ctx.createLinearGradient(0, top - 10, 0, size.h);
	bed.addColorStop(0, colors.sand);
	bed.addColorStop(1, shade(colors.sand, 0.55));
	ctx.fillStyle = bed;
	ctx.fill();

	// Grain.
	ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
	for (let i = 0; i < 60; i++) {
		const x = noise(i) * size.w;
		const y = bedTopAt(x, size) + 6 + noise(i, 3) * (bedHeight - 8);
		ctx.beginPath();
		ctx.arc(x, y, 0.8, 0, Math.PI * 2);
		ctx.fill();
	}

	// Stones. Asymmetric and partly buried: three identical domes read as geometry, and
	// a stone sitting *on* the sand reads as an object placed there rather than one the
	// substrate has settled around.
	for (let i = 0; i < 3; i++) {
		const x = (0.2 + i * 0.3) * size.w + noise(i, 7) * 40;
		const r = 12 + noise(i, 11) * 14;
		const bed = bedTopAt(x, size);
		// Sits *on* the sand. Stones are drawn after the bed is filled, so extending one
		// below the surface does not bury it — it paints a dark wedge over the sand.
		const buried = 4;
		const lean = (noise(i, 17) - 0.5) * r * 0.4;

		const stone = ctx.createLinearGradient(x, bed - r, x, bed + r * 0.4);
		stone.addColorStop(0, colors.rock);
		stone.addColorStop(1, shade(colors.rock, 0.6));

		ctx.beginPath();
		ctx.moveTo(x - r, bed + buried);
		ctx.quadraticCurveTo(x - r * 0.9, bed - r * (0.6 + noise(i, 19) * 0.5), x + lean, bed - r * 0.8);
		ctx.quadraticCurveTo(x + r * (0.7 + noise(i, 23) * 0.5), bed - r * 0.7, x + r, bed + buried);
		ctx.closePath();
		ctx.fillStyle = stone;
		ctx.fill();
	}
}

/**
 * What grows in the bed.
 *
 * Data only, like `species.ts` for fish. One repeated blade shape is what made the bed
 * read as clipart however well it was drawn, so the variation lives here rather than in
 * the drawing code.
 *
 * `stiffness` resists the current: eelgrass streams, a fern barely moves.
 */
export type PlantSpec = {
	form: 'ribbon' | 'broadleaf' | 'bushy';
	/** Height as a fraction of tank height, before per-clump jitter. */
	height: number;
	/** Blade half-width in px, at layer scale 1. */
	width: number;
	/** Blades in one clump. */
	blades: number;
	stiffness: number;
};

export const PLANTS: PlantSpec[] = [
	// Tall, narrow, floppy: the classic aquarium ribbon that streams in the current.
	{ form: 'ribbon', height: 0.2, width: 2.8, blades: 5, stiffness: 0.5 },
	// Shorter and broader, with a midrib. Stiffer, so it lags the ribbons.
	{ form: 'broadleaf', height: 0.14, width: 5.5, blades: 3, stiffness: 0.8 },
	// A low bushy stand of fine leaflets — reads as mass rather than as blades.
	{ form: 'bushy', height: 0.1, width: 1.8, blades: 7, stiffness: 0.95 },
	// Foreground carpet: short, dense, and it hides where the taller stands meet sand.
	{ form: 'ribbon', height: 0.075, width: 2.2, blades: 7, stiffness: 0.7 }
];

/**
 * A gust travelling across the tank, in radians at `x`.
 *
 * Phase comes from **x**, not from the blade's index. Indexing by `i` made the whole bed
 * oscillate at one frequency — it breathed as a single organism, which is precisely the
 * artificiality the fish's per-creature `pace` exists to avoid. A current crosses the
 * water, so blades downstream lag the ones upstream.
 */
const CURRENT_RATE = 0.55;
const CURRENT_WAVELENGTH = 260;

function currentAt(x: number, t: number): number {
	return Math.sin(t * CURRENT_RATE - x / CURRENT_WAVELENGTH) * 0.7 + Math.sin(t * 0.23 + x / 90) * 0.3;
}

/**
 * Planting in two layers: a hazed background stand and a saturated foreground one.
 * Depth is what stops a tank looking like a sticker on a gradient.
 */
export function drawPlants(
	ctx: CanvasRenderingContext2D,
	size: Size,
	colors: Palette,
	time: number
): void {
	drawPlantLayer(ctx, size, colors.plantsDeep, time, { scale: 0.72, alpha: 0.45, salt: 5 });
	drawPlantLayer(ctx, size, colors.plants, time, { scale: 1, alpha: 0.85, salt: 0 });
}

function drawPlantLayer(
	ctx: CanvasRenderingContext2D,
	size: Size,
	color: string,
	time: number,
	opts: { scale: number; alpha: number; salt: number }
): void {
	const t = time / 1000;
	const clumps = Math.max(7, Math.round(size.w / 46));

	ctx.save();
	ctx.lineCap = 'round';

	for (let i = 0; i < clumps; i++) {
		const jitter = noise(i, opts.salt);
		const x = (i / clumps) * size.w + jitter * 30;
		// Deterministic, and never `i % PLANTS.length`: a stride that shares a factor
		// with the table length collapses the bed to one or two species, the same way
		// `hash % 6` once made six fish species render as two.
		const spec = PLANTS[Math.floor(noise(i, opts.salt + 31) * PLANTS.length)];

		drawClump(ctx, size, color, spec, x, jitter, t, opts);
	}

	ctx.restore();
}

function drawClump(
	ctx: CanvasRenderingContext2D,
	size: Size,
	color: string,
	spec: PlantSpec,
	x: number,
	jitter: number,
	t: number,
	opts: { scale: number; alpha: number; salt: number }
): void {
	for (let b = 0; b < spec.blades; b++) {
		const spread = (b / Math.max(1, spec.blades - 1) - 0.5) * (14 + jitter * 10) * opts.scale;
		const bx = x + spread;
		// Rooted in the sand's real surface, and sunk a little below it.
		const base = bedTopAt(bx, size) + 4;
		const grow = 0.75 + noise(i2(bx, b), opts.salt + 3) * 0.5;
		const height = size.h * spec.height * grow * opts.scale;
		const width = spec.width * opts.scale * (0.8 + noise(i2(bx, b), 9) * 0.4);

		// Per-blade offset as well as per-clump: blades in one stand do not all catch the
		// current at the same instant, and without this a clump moves as a rigid fan.
		const drift = currentAt(bx + b * 26, t);
		const lean = drift * (19 / spec.stiffness) * opts.scale * (0.7 + jitter * 0.6);
		// Blades in a stand splay outward from the crown instead of standing parallel.
		// Without it a clump reads as a bundle of upright swords however well each blade
		// is drawn, because every tip points the same way.
		const splay = spread * 2.4;

		// Fades with depth like everything else in the water: the bed had been left out
		// of the haze, so the planting stayed perfectly crisp while the fish softened.
		const depth = Math.min(1, Math.max(0, (base - WATERLINE) / Math.max(1, size.h - WATERLINE)));
		ctx.globalAlpha = opts.alpha * (1 - depth * 0.18);
		// A stand of one flat green reads as a cut-out however well it is shaped.
		const tone = shade(color, 0.82 + noise(i2(bx, b), 41) * 0.36);
		ctx.fillStyle = tone;
		ctx.strokeStyle = tone;

		if (spec.form === 'bushy') {
			drawBushy(ctx, bx, base, height, width, lean + splay);
		} else {
			drawBlade(ctx, bx, base, height, width, lean, splay, spec.form === 'broadleaf', tone);
		}
	}
}

/** A stable index from a blade's position, so its jitter does not change as it sways. */
function i2(x: number, b: number): number {
	return Math.round(x) * 7 + b * 13;
}

/**
 * One ribbon or broadleaf.
 *
 * Built from segments with a `u * u` ramp so the bend accumulates toward the tip: the
 * base barely moves and the tip trails, which is how a real blade behaves and the same
 * ramp the fish spine uses. The old shape was a single quadratic whose tip offset
 * changed, so the whole leaf pivoted in lockstep.
 *
 * The tip is rounded rather than tapered to a point. A pointed blade is the single
 * clearest tell of vector clipart.
 */
function drawBlade(
	ctx: CanvasRenderingContext2D,
	x: number,
	base: number,
	height: number,
	width: number,
	lean: number,
	splay: number,
	broad: boolean,
	color: string
): void {
	// Enough segments that the tip *rounds*. At 6 the last span was a straight taper
	// from 0.86 width to zero, which reads as a chisel however smooth the profile is.
	const SEGMENTS = 14;
	const left: { x: number; y: number }[] = [];
	const right: { x: number; y: number }[] = [];

	for (let s = 0; s <= SEGMENTS; s++) {
		const u = s / SEGMENTS;
		const cx = x + lean * u * u + splay * u ** 1.4;
		const cy = base - height * u;
		// Near-constant width, rounding off only at the very top. One continuous curve,
		// not two branches: the piecewise version stepped from 0.79 to 1.0 at the join
		// and every blade came out with a notch cut into its tip.
		const w = width * Math.sqrt(Math.max(0, 1 - u ** 6));
		left.push({ x: cx - w, y: cy });
		right.push({ x: cx + w, y: cy });
	}

	ctx.beginPath();
	ctx.moveTo(left[0].x, left[0].y);
	for (const p of left) ctx.lineTo(p.x, p.y);
	for (let s = right.length - 1; s >= 0; s--) ctx.lineTo(right[s].x, right[s].y);
	ctx.closePath();
	ctx.fillStyle = bladeWash(ctx, color, base, height);
	ctx.fill();

	if (broad) {
		// Midrib, and a paler wash toward the tip so the leaf reads as translucent tissue
		// rather than as a flat cut-out.
		const outer = ctx.globalAlpha;
		ctx.globalAlpha = outer * 0.45;
		ctx.strokeStyle = shade(color, 1.25);
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.moveTo(x, base);
		for (let s = 1; s <= SEGMENTS; s++) {
			const u = s / SEGMENTS;
			ctx.lineTo(x + lean * u * u + splay * u ** 1.4, base - height * u);
		}
		ctx.stroke();
		ctx.globalAlpha = outer;
		ctx.strokeStyle = color;
	}
}

const bladeWashCache = new WeakMap<CanvasRenderingContext2D, Map<string, CanvasGradient>>();

/**
 * Base-to-tip wash: a submerged leaf is thin tissue, and thinnest at the margin, so the
 * water shows through more the further up you look. Flat opaque green was half of why
 * the bed read as cut paper.
 *
 * Cached. This runs for every blade of every clump on every frame, and the gradient is
 * vertical in absolute coordinates — `lean` moves the blade sideways but not the ramp —
 * so a blade's wash is the same object for the life of the context.
 */
function bladeWash(
	ctx: CanvasRenderingContext2D,
	color: string,
	base: number,
	height: number
): CanvasGradient {
	let perCtx = bladeWashCache.get(ctx);
	if (!perCtx) {
		perCtx = new Map();
		bladeWashCache.set(ctx, perCtx);
	}

	const key = `${color}|${Math.round(base)}|${Math.round(height)}`;
	const cached = perCtx.get(key);
	if (cached) return cached;

	const wash = ctx.createLinearGradient(0, base, 0, base - height);
	wash.addColorStop(0, withAlpha(color, 0.95));
	wash.addColorStop(1, withAlpha(color, 0.5));

	perCtx.set(key, wash);
	return wash;
}

/** A low stand of fine leaflets: mass rather than blades. */
function drawBushy(
	ctx: CanvasRenderingContext2D,
	x: number,
	base: number,
	height: number,
	width: number,
	lean: number
): void {
	ctx.lineWidth = width;
	for (let s = 0; s < 4; s++) {
		const u = 0.4 + s * 0.2;
		const tipX = x + lean * u * u + (s - 1.5) * width * 2.2;
		ctx.beginPath();
		ctx.moveTo(x, base);
		ctx.quadraticCurveTo(x + lean * 0.3, base - height * 0.5, tipX, base - height * u);
		ctx.stroke();
	}
}

/**
 * Food scattered on the surface, sinking and fading.
 *
 * Capped well under the ambient bubble size for the same reason those are: a waiting
 * task *is* a ~24px bubble you can tap, and anything approaching it reads as a control.
 * Flakes are smaller still, and they are never interactive.
 */
export const MAX_FLAKE = 3.4;

const FLAKES = 44;

export function drawFeed(
	ctx: CanvasRenderingContext2D,
	size: Size,
	time: number,
	feeding: number
): void {
	if (feeding <= 0) return;

	const t = time / 1000;
	// `feeding` runs 1 -> 0 over the window, so this is how far through it we are.
	const progress = 1 - feeding;

	ctx.save();
	for (let i = 0; i < FLAKES; i++) {
		const x = noise(i, 61) * size.w;
		// Scattered on the surface and sinking. Each flake falls at its own rate, so the
		// scatter spreads out as it descends instead of dropping as a sheet.
		const fall = 90 + noise(i, 67) * 220;
		const y = WATERLINE + 8 + progress * fall;
		if (y > size.h - 30) continue;

		// Fade in fast, out slowly: the arrival is the moment worth seeing.
		const life = Math.min(1, progress * 6) * feeding;
		const r = MAX_FLAKE * (0.45 + noise(i, 71) * 0.55);

		ctx.globalAlpha = life * 0.92;
		// Amber, not cream: at flake size a pale tint is indistinguishable from the
		// ambient motes already drifting in the water, and the food read as dust.
		ctx.fillStyle = 'rgba(252, 205, 128, 1)';
		ctx.beginPath();
		ctx.arc(x + Math.sin(t * 1.4 + i) * 4, y, r, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

/** Fine particulate drifting in the light. Cheap, and it makes the water feel occupied. */
export function drawMotes(
	ctx: CanvasRenderingContext2D,
	size: Size,
	time: number,
	strength = 1
): void {
	if (strength <= 0) return;
	const t = time / 1000;

	ctx.save();
	for (let i = 0; i < 18; i++) {
		const speed = 4 + noise(i, 2) * 10;
		const x = (noise(i) * size.w + Math.sin(t * 0.2 + i) * 20) % size.w;
		// Motes rise slowly and wrap, so the field never empties.
		const y = (size.h - ((t * speed + noise(i, 4) * size.h) % size.h)) % size.h;

		ctx.globalAlpha = (0.1 + noise(i, 6) * 0.22) * strength;
		ctx.fillStyle = '#FFFFFF';
		ctx.beginPath();
		ctx.arc(x, y, 0.6 + noise(i, 8) * 1.2, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

/**
 * The largest a decorative bubble may be.
 *
 * A waiting task is drawn as a ~24px-radius sphere with a fish sealed inside, and
 * tapping it releases the task. Ambient bubbles have to stay unmistakably smaller than
 * that or they read as tasks you cannot tap — so this is a correctness constraint on
 * the mechanic, not a style choice.
 */
export const MAX_AIR_BUBBLE = 3.6;

/** Where the airstones sit, as fractions of width. Off-centre, clear of the add-pill. */
const VENTS = [0.14, 0.52, 0.87];

/**
 * Streams of small bubbles rising from the substrate, wobbling as they go and thinning
 * out near the surface.
 *
 * Deliberately fast and small: aeration reads as background life, where the slow,
 * fat, fish-bearing task bubbles read as content.
 */
export function drawAirBubbles(
	ctx: CanvasRenderingContext2D,
	size: Size,
	time: number,
	strength = 1
): void {
	if (strength <= 0) return;
	const t = time / 1000;
	const floor = size.h - 8;
	const travel = floor - WATERLINE;
	if (travel <= 0) return;

	ctx.save();
	for (let v = 0; v < VENTS.length; v++) {
		// Each vent puffs in bursts rather than metronomically, so three streams do not
		// pulse in lockstep.
		const gust = 0.65 + 0.35 * Math.sin(t * 0.35 + v * 2.1);
		const perVent = 7;

		for (let i = 0; i < perVent; i++) {
			const seed = v * 31 + i;
			const speed = (26 + noise(seed, 12) * 26) * gust;

			// Rise, wrap, repeat. The offset spreads the stream out along its climb.
			const climbed = (t * speed + noise(seed, 13) * travel) % travel;
			const y = floor - climbed;
			const progress = climbed / travel;

			// Bubbles wobble more as they rise and slow, and swell very slightly.
			const wobble = Math.sin(t * 2.2 + seed + progress * 6) * (2 + progress * 7);
			const x = size.w * VENTS[v] + (noise(seed, 14) - 0.5) * 16 + wobble;

			const r = Math.min(
				MAX_AIR_BUBBLE,
				(0.9 + noise(seed, 15) * 1.7) * (1 + progress * 0.45)
			);

			// Fade in off the sand and out again at the surface, so none pops into being.
			const fade = Math.min(1, progress * 6) * (1 - Math.max(0, progress - 0.82) / 0.18);
			ctx.globalAlpha = 0.5 * fade * strength;

			ctx.beginPath();
			ctx.arc(x, y, r, 0, Math.PI * 2);
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
			ctx.lineWidth = 0.9;
			ctx.stroke();

			// A highlight only on the bigger ones; below that it is a smudge.
			if (r > 2) {
				ctx.beginPath();
				ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.28, 0, Math.PI * 2);
				ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
				ctx.fill();
			}
		}
	}
	ctx.restore();
}

/**
 * Depth haze at the bottom and a soft vignette at the edges. Both push the middle
 * of the tank forward, which is where the fish are.
 */
export function drawDepth(ctx: CanvasRenderingContext2D, size: Size, colors: Palette): void {
	// Light touch: haze and vignette are there to seat the fish in depth, not to grey
	// the tank down. Stacked at full strength they read as dirt on the glass.
	const haze = ctx.createLinearGradient(0, size.h * 0.62, 0, size.h);
	haze.addColorStop(0, 'rgba(0, 0, 0, 0)');
	haze.addColorStop(1, withAlpha(colors.waterBottom, 0.3));
	ctx.fillStyle = haze;
	ctx.fillRect(0, size.h * 0.62, size.w, size.h * 0.38);

	const vignette = ctx.createRadialGradient(
		size.w / 2,
		size.h / 2,
		Math.min(size.w, size.h) * 0.35,
		size.w / 2,
		size.h / 2,
		Math.max(size.w, size.h) * 0.75
	);
	vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
	vignette.addColorStop(1, 'rgba(3, 32, 48, 0.18)');
	ctx.fillStyle = vignette;
	ctx.fillRect(0, 0, size.w, size.h);
}

/** Paints the whole tank background in the right order, back to front. */
export function drawTank(
	ctx: CanvasRenderingContext2D,
	size: Size,
	colors: Palette,
	time: number
): void {
	drawWater(ctx, size, colors);
	drawCaustics(ctx, size, time, colors.light);
	drawSubstrate(ctx, size, colors);
	drawPlants(ctx, size, colors, time);
	drawMotes(ctx, size, time, colors.light);
	drawAirBubbles(ctx, size, time, colors.light);
	drawSurface(ctx, size, colors, time);
}

/** Drawn after the creatures, so haze and vignette sit over everything. */
export function drawForeground(
	ctx: CanvasRenderingContext2D,
	size: Size,
	colors: Palette
): void {
	drawDepth(ctx, size, colors);
}

// ------------------------------------------------------------------ helpers

function withAlpha(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Darkens a hex colour towards black by `factor` (1 = unchanged). */
function shade(hex: string, factor: number): string {
	const to = (i: number) =>
		Math.round(parseInt(hex.slice(i, i + 2), 16) * factor)
			.toString(16)
			.padStart(2, '0');
	return `#${to(1)}${to(3)}${to(5)}`;
}

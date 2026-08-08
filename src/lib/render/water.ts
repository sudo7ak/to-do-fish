import type { Palette } from './palette';

/**
 * The tank itself: water, surface, caustics, planting.
 *
 * Everything here is per-pixel work — a gradient, light shafts, a wavy top edge —
 * which is why the tank is one canvas rather than forty animated SVG nodes.
 *
 * Positions are derived from `time` on every frame and never stored, so nothing
 * here holds state between calls. Under reduced motion the caller passes a frozen
 * `time`, and the same code draws a still tank.
 */

export type Size = { w: number; h: number };

/** Height of the wavy surface band, in CSS pixels. */
const SURFACE_HEIGHT = 18;

/** Paints the water column. Everything else is drawn over this. */
export function drawWater(ctx: CanvasRenderingContext2D, size: Size, colors: Palette): void {
	const gradient = ctx.createLinearGradient(0, 0, 0, size.h);
	gradient.addColorStop(0, colors.waterTop);
	gradient.addColorStop(1, colors.waterBottom);

	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, size.w, size.h);
}

/**
 * The animated wavy surface under the status bar, which gives the tank a real top
 * edge. Two offset sine waves so the crests never line up into an obvious pattern.
 */
export function drawSurface(
	ctx: CanvasRenderingContext2D,
	size: Size,
	colors: Palette,
	time: number
): void {
	const t = time / 1000;

	ctx.save();
	ctx.beginPath();
	ctx.moveTo(0, 0);

	for (let x = 0; x <= size.w; x += 4) {
		const y =
			SURFACE_HEIGHT +
			Math.sin(x / 90 + t * 0.9) * 5 +
			Math.sin(x / 37 - t * 1.4) * 2.5;
		ctx.lineTo(x, y);
	}

	ctx.lineTo(size.w, 0);
	ctx.closePath();

	ctx.fillStyle = colors.glass;
	ctx.fill();
	ctx.restore();
}

/**
 * Caustic light shafts falling from the surface. Drawn with `lighter` so they add
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

	for (let i = 0; i < 5; i++) {
		const drift = Math.sin(t * 0.25 + i * 1.7) * size.w * 0.08;
		const x = ((i + 0.5) / 5) * size.w + drift;
		const width = size.w * 0.06;

		const shaft = ctx.createLinearGradient(x, 0, x + width, size.h);
		shaft.addColorStop(0, `rgba(255, 255, 255, ${0.16 * strength})`);
		shaft.addColorStop(1, 'rgba(255, 255, 255, 0)');

		ctx.fillStyle = shaft;
		ctx.beginPath();
		ctx.moveTo(x - width, 0);
		ctx.lineTo(x + width, 0);
		ctx.lineTo(x + width * 2.6, size.h);
		ctx.lineTo(x - width * 1.6, size.h);
		ctx.closePath();
		ctx.fill();
	}

	ctx.restore();
}

/**
 * Foreground planting along the tank floor, swaying with the current. Lush in the
 * calm palette and faded in the loaded one — the colour does that work, so the same
 * geometry serves both.
 */
export function drawPlants(
	ctx: CanvasRenderingContext2D,
	size: Size,
	colors: Palette,
	time: number
): void {
	const t = time / 1000;
	const base = size.h;
	const blades = Math.max(8, Math.round(size.w / 28));

	ctx.save();
	ctx.strokeStyle = colors.plants;
	ctx.lineCap = 'round';

	for (let i = 0; i < blades; i++) {
		// Deterministic per-blade variation: the same tank every time, no stored state.
		const seed = Math.sin(i * 12.9898) * 43758.5453;
		const jitter = seed - Math.floor(seed);

		const x = (i / blades) * size.w + jitter * 12;
		const height = size.h * (0.12 + jitter * 0.16);
		const sway = Math.sin(t * 0.8 + i) * (6 + jitter * 6);

		ctx.lineWidth = 3 + jitter * 3;
		ctx.beginPath();
		ctx.moveTo(x, base);
		ctx.quadraticCurveTo(x + sway * 0.4, base - height * 0.6, x + sway, base - height);
		ctx.stroke();
	}

	ctx.restore();
}

/** Paints the whole tank background in the right order, back to front. */
export function drawTank(
	ctx: CanvasRenderingContext2D,
	size: Size,
	colors: Palette,
	time: number
): void {
	drawWater(ctx, size, colors);
	drawCaustics(ctx, size, time);
	drawPlants(ctx, size, colors, time);
	drawSurface(ctx, size, colors, time);
}

import type { Creature } from '../scene/types';
import type { Palette } from './palette';
import type { Size } from './water';

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
const TOP_MARGIN = 28;
const BOTTOM_MARGIN = 40;

export function place(creature: Creature, size: Size, time: number, animate = true): Placement {
	const seed = hash(creature.id);
	const t = animate ? time / 1000 : 0;

	// Lanterns rest on the waterline and pearls on the floor; neither swims.
	if (creature.kind === 'lantern') {
		return { x: laneX(seed, size, creature.depth), y: TOP_MARGIN * 0.6, flip: false };
	}
	if (creature.kind === 'pearl') {
		return { x: laneX(seed, size, 0.5), y: size.h - 12 - (seed % 7), flip: false };
	}

	const speed = creature.kind === 'koi' ? 0.16 : creature.kind === 'ghost' ? 0.22 : 0.35;
	const phase = seed % 1000;

	// A loose sinusoidal path: horizontal drift wrapping the tank, vertical bob
	// around the resting depth the scene assigned.
	const sweep = Math.sin(t * speed + phase);
	const x = size.w * (0.5 + sweep * 0.42);
	const bob = Math.sin(t * speed * 2.3 + phase) * 10;

	const usable = Math.max(0, size.h - TOP_MARGIN - BOTTOM_MARGIN);
	const y = TOP_MARGIN + creature.depth * usable + bob;

	// Fish flip to face the way they are travelling: the derivative of the sweep.
	const flip = Math.cos(t * speed + phase) < 0;

	return { x, y, flip };
}

/** Spreads same-depth creatures across the width so they do not stack in one column. */
function laneX(seed: number, size: Size, spread: number): number {
	const jitter = (seed % 1000) / 1000;
	return size.w * (0.1 + jitter * 0.8 * Math.max(spread, 0.4));
}

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
			drawFish(ctx, at, colors.fish, 1, time, hash(creature.id));
			break;
		case 'ghost':
			drawFish(ctx, at, colors.fish, 0.28, time, hash(creature.id), true);
			break;
		case 'koi':
			drawKoi(ctx, at, time);
			break;
		case 'bubble':
			drawBubble(ctx, creature, colors, time);
			break;
		case 'lantern':
			drawLantern(ctx, creature, colors);
			break;
		case 'pearl':
			drawPearl(ctx, colors);
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
		lantern: 5
	};

	for (const creature of [...creatures].sort((a, b) => order[a.kind] - order[b.kind])) {
		drawCreature(ctx, creature, place(creature, size, time, animate), colors, time);
	}
}

// ------------------------------------------------------------------ shapes

function drawFish(
	ctx: CanvasRenderingContext2D,
	at: Placement,
	color: string,
	alpha: number,
	time: number,
	seed: number,
	outlineOnly = false
): void {
	const length = 26;
	const height = 13;

	ctx.globalAlpha = alpha;
	if (at.flip) ctx.scale(-1, 1);

	// Body: a leaf shape, two curves meeting at nose and tail.
	ctx.beginPath();
	ctx.moveTo(length / 2, 0);
	ctx.quadraticCurveTo(0, -height, -length / 2, 0);
	ctx.quadraticCurveTo(0, height, length / 2, 0);
	ctx.closePath();

	if (outlineOnly) {
		// A resolved task keeps swimming, drained to a translucent outline.
		ctx.strokeStyle = color;
		ctx.lineWidth = 2;
		ctx.stroke();
	} else {
		ctx.fillStyle = color;
		ctx.fill();
	}

	// Tail, beating with the swim cycle.
	const beat = Math.sin(time / 120 + seed) * 4;
	ctx.beginPath();
	ctx.moveTo(-length / 2, 0);
	ctx.lineTo(-length / 2 - 9, -7 + beat);
	ctx.lineTo(-length / 2 - 9, 7 + beat);
	ctx.closePath();
	if (outlineOnly) ctx.stroke();
	else ctx.fill();

	if (!outlineOnly) drawTrail(ctx, time, seed);
	ctx.globalAlpha = 1;
}

/** The bubble trail behind a live fish. Three bubbles rising and fading on a loop. */
function drawTrail(ctx: CanvasRenderingContext2D, time: number, seed: number): void {
	ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';

	for (let i = 0; i < 3; i++) {
		const cycle = ((time / 900 + seed + i * 0.33) % 1 + 1) % 1;
		ctx.globalAlpha = 0.35 * (1 - cycle);
		ctx.beginPath();
		ctx.arc(-20 - cycle * 14, -cycle * 18, 1.6 + i * 0.5, 0, Math.PI * 2);
		ctx.fill();
	}
}

function drawKoi(ctx: CanvasRenderingContext2D, at: Placement, time: number): void {
	if (at.flip) ctx.scale(-1, 1);

	const gradient = ctx.createLinearGradient(-22, 0, 22, 0);
	gradient.addColorStop(0, '#FFD98A');
	gradient.addColorStop(0.5, '#FFC46B');
	gradient.addColorStop(1, '#E9A23B');

	ctx.beginPath();
	ctx.moveTo(22, 0);
	ctx.quadraticCurveTo(0, -16, -22, 0);
	ctx.quadraticCurveTo(0, 16, 22, 0);
	ctx.closePath();
	ctx.fillStyle = gradient;
	ctx.fill();

	// Trailing fins, slower than a fish's beat — the koi is unhurried.
	const beat = Math.sin(time / 260) * 6;
	ctx.beginPath();
	ctx.moveTo(-22, 0);
	ctx.quadraticCurveTo(-34, beat, -40, beat * 1.6);
	ctx.quadraticCurveTo(-30, 0, -22, 0);
	ctx.fillStyle = 'rgba(255, 214, 138, 0.8)';
	ctx.fill();
}

function drawBubble(
	ctx: CanvasRenderingContext2D,
	creature: Creature,
	colors: Palette,
	time: number
): void {
	const radius = 22;
	const wobble = Math.sin(time / 700 + hash(creature.id)) * 1.5;

	ctx.beginPath();
	ctx.arc(0, 0, radius + wobble, 0, Math.PI * 2);

	if (creature.dashed) {
		// Free text, or a trigger that lost its target: released by hand, so the
		// outline is broken rather than a sealed sphere.
		ctx.setLineDash([5, 5]);
	}
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
	ctx.lineWidth = 2;
	ctx.stroke();
	ctx.setLineDash([]);

	ctx.fillStyle = colors.glass;
	ctx.fill();

	// The waiting task itself, sealed inside and nudging the wall.
	ctx.save();
	ctx.scale(0.55, 0.55);
	ctx.translate(Math.sin(time / 800 + hash(creature.id)) * 6, 0);
	drawFish(ctx, { x: 0, y: 0, flip: false }, colors.fish, 0.9, time, hash(creature.id));
	ctx.restore();
}

function drawLantern(ctx: CanvasRenderingContext2D, creature: Creature, colors: Palette): void {
	const lit = !creature.locked;
	ctx.globalAlpha = lit ? 1 : 0.45;

	// Glow, only once it can be afforded.
	if (lit) {
		const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 34);
		glow.addColorStop(0, 'rgba(255, 196, 107, 0.55)');
		glow.addColorStop(1, 'rgba(255, 196, 107, 0)');
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(0, 0, 34, 0, Math.PI * 2);
		ctx.fill();
	}

	ctx.fillStyle = colors.lantern;
	ctx.beginPath();
	ctx.roundRect(-11, -14, 22, 26, 5);
	ctx.fill();

	ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
	ctx.fillRect(-13, -17, 26, 4);
	ctx.globalAlpha = 1;
}

function drawPearl(ctx: CanvasRenderingContext2D, colors: Palette): void {
	const shine = ctx.createRadialGradient(-2, -2, 1, 0, 0, 6);
	shine.addColorStop(0, '#FFFFFF');
	shine.addColorStop(1, colors.pearl);

	ctx.beginPath();
	ctx.arc(0, 0, 6, 0, Math.PI * 2);
	ctx.fillStyle = shine;
	ctx.fill();
}

/** Stable per-id seed: the same creature sits in the same lane on every reload. */
function hash(id: string): number {
	let value = 0;
	for (let i = 0; i < id.length; i++) {
		value = (value * 31 + id.charCodeAt(i)) >>> 0;
	}
	return value;
}

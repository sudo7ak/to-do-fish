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

// ----------------------------------------------------------------- species

export type Species = 'clown' | 'tang' | 'angel' | 'guppy' | 'neon' | 'betta';

type SpeciesSpec = {
	length: number;
	height: number;
	/** Body gradient, back to belly. */
	body: [string, string];
	fin: string;
	tail: 'fan' | 'forked' | 'veil' | 'round';
	pattern: 'bands' | 'stripe' | 'spots' | 'none';
	patternColor: string;
	/** Fin size multiplier — a betta's veils are the point of a betta. */
	flow: number;
};

/**
 * Which task is which fish is arbitrary, but it must be *stable*: the same task is
 * the same fish every time you open the tank, because that is what lets you
 * recognise it without reading the label.
 */
const SPECIES: Record<Species, SpeciesSpec> = {
	clown: {
		length: 30,
		height: 17,
		body: ['#FF8A3D', '#E8543C'],
		fin: '#FFB067',
		tail: 'round',
		pattern: 'bands',
		patternColor: '#FFF6E9',
		flow: 1
	},
	tang: {
		length: 32,
		height: 21,
		body: ['#3FA9F5', '#1B5FC1'],
		fin: '#FFD84D',
		tail: 'forked',
		pattern: 'none',
		patternColor: '#0E3E86',
		flow: 1
	},
	angel: {
		length: 26,
		height: 26,
		body: ['#FFE1A8', '#F0A93C'],
		fin: '#FFEFC9',
		tail: 'veil',
		pattern: 'bands',
		patternColor: '#3D2A18',
		flow: 1.7
	},
	guppy: {
		length: 22,
		height: 13,
		body: ['#8BE8FF', '#4A7BE8'],
		fin: '#FF8FD0',
		tail: 'fan',
		pattern: 'spots',
		patternColor: '#FFE066',
		flow: 1.4
	},
	neon: {
		length: 20,
		height: 10,
		body: ['#5FE6FF', '#1B7FD4'],
		fin: '#BFF3FF',
		tail: 'forked',
		pattern: 'stripe',
		patternColor: '#FF3B4E',
		flow: 0.9
	},
	betta: {
		length: 26,
		height: 19,
		body: ['#C86BFF', '#7A2BD1'],
		fin: '#FF6FA8',
		tail: 'veil',
		pattern: 'none',
		patternColor: '#4A1580',
		flow: 2
	}
};

const SPECIES_ORDER: Species[] = ['clown', 'tang', 'angel', 'guppy', 'neon', 'betta'];

export function speciesFor(id: string): Species {
	return SPECIES_ORDER[hash(id) % SPECIES_ORDER.length];
}

// ---------------------------------------------------------------- placement

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
			drawFish(ctx, at, SPECIES[speciesFor(creature.id)], time, hash(creature.id));
			break;
		case 'ghost':
			drawGhost(ctx, at, SPECIES[speciesFor(creature.id)], time, hash(creature.id));
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

function drawFish(
	ctx: CanvasRenderingContext2D,
	at: Placement,
	spec: SpeciesSpec,
	time: number,
	seed: number
): void {
	if (at.flip) ctx.scale(-1, 1);

	const { length: len, height: hgt } = spec;
	const beat = Math.sin(time / 130 + seed);

	drawTail(ctx, spec, beat);
	drawFins(ctx, spec, beat);

	// Body, lit from above: back saturated, belly pale.
	const shade = ctx.createLinearGradient(0, -hgt, 0, hgt);
	shade.addColorStop(0, spec.body[0]);
	shade.addColorStop(1, spec.body[1]);

	bodyPath(ctx, len, hgt);
	ctx.fillStyle = shade;
	ctx.fill();

	drawPattern(ctx, spec, seed);

	// Belly highlight, a soft crescent along the underside.
	ctx.save();
	bodyPath(ctx, len, hgt);
	ctx.clip();
	const belly = ctx.createLinearGradient(0, hgt * 0.1, 0, hgt);
	belly.addColorStop(0, 'rgba(255, 255, 255, 0)');
	belly.addColorStop(1, 'rgba(255, 255, 255, 0.45)');
	ctx.fillStyle = belly;
	ctx.fillRect(-len, -hgt, len * 2, hgt * 2);
	ctx.restore();

	// Gill arc.
	ctx.beginPath();
	ctx.moveTo(len * 0.16, -hgt * 0.45);
	ctx.quadraticCurveTo(len * 0.06, 0, len * 0.16, hgt * 0.45);
	ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
	ctx.lineWidth = 1.2;
	ctx.stroke();

	// Pectoral fin, fanning with the swim cycle.
	ctx.save();
	ctx.translate(len * 0.08, hgt * 0.12);
	ctx.rotate(beat * 0.25);
	ctx.beginPath();
	ctx.moveTo(0, 0);
	ctx.quadraticCurveTo(-len * 0.2, hgt * 0.5, -len * 0.05, hgt * 0.62);
	ctx.quadraticCurveTo(len * 0.04, hgt * 0.3, 0, 0);
	ctx.fillStyle = withAlpha(spec.fin, 0.85);
	ctx.fill();
	ctx.restore();

	drawEye(ctx, spec);
	drawTrail(ctx, time, seed, len);
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

	const { length: len, height: hgt } = spec;
	const beat = Math.sin(time / 200 + seed);

	ctx.globalAlpha = 0.4;
	ctx.strokeStyle = withAlpha(spec.body[0], 0.9);
	ctx.lineWidth = 1.6;

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

function drawTail(ctx: CanvasRenderingContext2D, spec: SpeciesSpec, beat: number): void {
	const { length: len, height: hgt, flow } = spec;
	const root = -len / 2;
	const sway = beat * 5 * flow;

	ctx.fillStyle = withAlpha(spec.fin, 0.9);
	ctx.beginPath();
	ctx.moveTo(root, 0);

	switch (spec.tail) {
		case 'forked':
			ctx.lineTo(root - len * 0.5, -hgt * 0.9 + sway);
			ctx.quadraticCurveTo(root - len * 0.25, 0, root - len * 0.5, hgt * 0.9 + sway);
			break;
		case 'fan':
			ctx.quadraticCurveTo(root - len * 0.7, -hgt * 1.3 + sway, root - len * 0.75, sway * 0.6);
			ctx.quadraticCurveTo(root - len * 0.7, hgt * 1.3 + sway, root, 0);
			break;
		case 'veil':
			ctx.quadraticCurveTo(root - len * 0.9, -hgt * 1.1 + sway, root - len * 1.1, hgt * 0.2 + sway);
			ctx.quadraticCurveTo(root - len * 0.6, hgt * 1.1 + sway, root, 0);
			break;
		case 'round':
			ctx.quadraticCurveTo(root - len * 0.4, -hgt * 0.8 + sway, root - len * 0.45, sway);
			ctx.quadraticCurveTo(root - len * 0.4, hgt * 0.8 + sway, root, 0);
			break;
	}

	ctx.closePath();
	ctx.fill();
}

function drawFins(ctx: CanvasRenderingContext2D, spec: SpeciesSpec, beat: number): void {
	const { length: len, height: hgt, flow } = spec;
	ctx.fillStyle = withAlpha(spec.fin, 0.8);

	// Dorsal.
	ctx.beginPath();
	ctx.moveTo(len * 0.22, -hgt * 0.8);
	ctx.quadraticCurveTo(len * 0.02, -hgt * (0.9 + 0.55 * flow) + beat, -len * 0.34, -hgt * 0.75);
	ctx.quadraticCurveTo(-len * 0.1, -hgt * 0.6, len * 0.22, -hgt * 0.8);
	ctx.closePath();
	ctx.fill();

	// Anal fin, mirroring below.
	ctx.beginPath();
	ctx.moveTo(-len * 0.05, hgt * 0.8);
	ctx.quadraticCurveTo(-len * 0.2, hgt * (0.9 + 0.4 * flow) - beat, -len * 0.4, hgt * 0.7);
	ctx.quadraticCurveTo(-len * 0.22, hgt * 0.6, -len * 0.05, hgt * 0.8);
	ctx.closePath();
	ctx.fill();
}

/** Markings, clipped to the body so nothing spills over the silhouette. */
function drawPattern(ctx: CanvasRenderingContext2D, spec: SpeciesSpec, seed: number): void {
	if (spec.pattern === 'none') return;

	const { length: len, height: hgt } = spec;

	ctx.save();
	bodyPath(ctx, len, hgt);
	ctx.clip();
	ctx.fillStyle = spec.patternColor;

	if (spec.pattern === 'bands') {
		for (let i = 0; i < 3; i++) {
			const x = len * 0.3 - i * len * 0.28;
			ctx.save();
			ctx.translate(x, 0);
			ctx.rotate(-0.18);
			ctx.fillRect(-len * 0.055, -hgt * 1.2, len * 0.11, hgt * 2.4);
			ctx.restore();
		}
	} else if (spec.pattern === 'stripe') {
		ctx.fillRect(-len, -hgt * 0.12, len * 2, hgt * 0.3);
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

function drawEye(ctx: CanvasRenderingContext2D, spec: SpeciesSpec): void {
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
		ctx.globalAlpha = 0.5 * (1 - cycle);
		ctx.beginPath();
		ctx.arc(len * 0.55 + cycle * 12, -cycle * 20, 1.4 + i * 0.5, 0, Math.PI * 2);
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

	drawEye(ctx, { ...SPECIES.clown, length: len, height: hgt });
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

function drawLantern(ctx: CanvasRenderingContext2D, creature: Creature, colors: Palette): void {
	const lit = !creature.locked;
	ctx.globalAlpha = lit ? 1 : 0.4;

	// Glow, only once it can be afforded.
	if (lit) {
		const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 40);
		glow.addColorStop(0, 'rgba(255, 214, 140, 0.6)');
		glow.addColorStop(1, 'rgba(255, 196, 107, 0)');
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(0, 0, 40, 0, Math.PI * 2);
		ctx.fill();
	}

	// Paper body.
	const body = ctx.createLinearGradient(-12, 0, 12, 0);
	body.addColorStop(0, lit ? '#FFB347' : '#B9A88C');
	body.addColorStop(0.45, lit ? '#FFE6A8' : '#D8CCB4');
	body.addColorStop(1, lit ? '#F0932B' : '#A89778');

	ctx.beginPath();
	ctx.moveTo(-11, -12);
	ctx.quadraticCurveTo(-15, 0, -11, 13);
	ctx.lineTo(11, 13);
	ctx.quadraticCurveTo(15, 0, 11, -12);
	ctx.closePath();
	ctx.fillStyle = body;
	ctx.fill();

	// Ribs.
	ctx.strokeStyle = 'rgba(120, 70, 20, 0.28)';
	ctx.lineWidth = 0.9;
	for (const y of [-5, 1, 7]) {
		ctx.beginPath();
		ctx.moveTo(-12.5, y);
		ctx.lineTo(12.5, y);
		ctx.stroke();
	}

	// Cap and base.
	ctx.fillStyle = 'rgba(60, 40, 25, 0.75)';
	ctx.fillRect(-13, -16, 26, 4);
	ctx.fillRect(-9, 13, 18, 3);

	ctx.globalAlpha = 1;
	void colors;
}

function drawPearl(ctx: CanvasRenderingContext2D, colors: Palette): void {
	// Soft bloom on the sand beneath it.
	const bloom = ctx.createRadialGradient(0, 0, 1, 0, 0, 11);
	bloom.addColorStop(0, 'rgba(234, 246, 248, 0.55)');
	bloom.addColorStop(1, 'rgba(234, 246, 248, 0)');
	ctx.fillStyle = bloom;
	ctx.beginPath();
	ctx.arc(0, 0, 11, 0, Math.PI * 2);
	ctx.fill();

	const shine = ctx.createRadialGradient(-2.2, -2.4, 0.5, 0, 0, 6.5);
	shine.addColorStop(0, '#FFFFFF');
	shine.addColorStop(0.55, colors.pearl);
	shine.addColorStop(1, '#A9C6D2');

	ctx.beginPath();
	ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
	ctx.fillStyle = shine;
	ctx.fill();

	ctx.beginPath();
	ctx.arc(-2, -2.4, 1.5, 0, Math.PI * 2);
	ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
	ctx.fill();
}

// ------------------------------------------------------------------ helpers

/** `#RRGGBB` plus an alpha, without pulling in a colour library. */
function withAlpha(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Stable per-id seed: the same creature is the same fish, in the same lane, on every reload. */
function hash(id: string): number {
	let value = 0;
	for (let i = 0; i < id.length; i++) {
		value = (value * 31 + id.charCodeAt(i)) >>> 0;
	}
	return value;
}

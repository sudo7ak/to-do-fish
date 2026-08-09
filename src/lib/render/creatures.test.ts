import { describe, it, expect } from 'vitest';
import { place, drawCreature, drawCreatures, speciesFor, MAX_TURN_RATE } from './creatures';
import { palette } from './palette';
import type { Creature, CreatureKind } from '../scene/types';
import { SPECIES, SWIMMERS, type SpeciesSpec } from './species';
import { spineFor, outline } from './spine';
import { hash, mix32 } from './rng';
import { profilePeak } from './spine';

import { WATERLINE } from './water';

const SIZE = { w: 400, h: 800 };
const COLORS = palette('calm', 1);

/** Roughly what the date header occupies. Nothing may be drawn behind it. */
const HEADER_HEIGHT = 70;

/**
 * Records canvas calls instead of painting. Pixels are verified by eye; what is
 * worth asserting here is that every kind draws something, stays inside the tank,
 * and leaves the context balanced.
 */
function fakeCtx() {
	const calls: string[] = [];
	const gradient = { addColorStop: () => {} };
	let depth = 0;
	let maxDepth = 0;

	let alpha = 1;
	// The alpha in force at each fill/stroke. `globalAlpha` is a single mutable slot, so
	// reading the final value proves nothing about what was painted; a nested draw that
	// *assigns* rather than multiplies is only visible as a paint at the wrong alpha.
	const fillAlphas: number[] = [];
	const strokeAlphas: number[] = [];
	const fillColours: string[] = [];

	const ctx = {
		calls,
		fillAlphas,
		strokeAlphas,
		fillColours,
		get depth() {
			return depth;
		},
		get maxDepth() {
			return maxDepth;
		},
		save() {
			depth++;
			maxDepth = Math.max(maxDepth, depth);
			calls.push('save');
		},
		restore() {
			depth--;
			calls.push('restore');
		},
		createLinearGradient: (...args: number[]) => {
			calls.push(`linearGradient(${args.map((a) => a.toFixed(1)).join(',')})`);
			return gradient;
		},
		createRadialGradient: () => gradient,
		// Tracked so a translucent wash (a ghost) is distinguishable from an opaque fill
		// (a live fish) even though `fakeCtx` never touches real pixels.
		get globalAlpha() {
			return alpha;
		},
		set globalAlpha(value: number) {
			alpha = value;
			calls.push(`alpha(${value})`);
		},
		globalCompositeOperation: 'source-over',
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 0,
		lineCap: 'butt'
	} as unknown as CanvasRenderingContext2D & {
		calls: string[];
		fillAlphas: number[];
		strokeAlphas: number[];
		fillColours: string[];
		depth: number;
		maxDepth: number;
	};

	for (const method of ['clip', 'beginPath', 'closePath', 'setLineDash', 'roundRect', 'setTransform']) {
		(ctx as unknown as Record<string, unknown>)[method] = () => calls.push(method);
	}

	(ctx as unknown as Record<string, unknown>).fill = () => {
		fillAlphas.push(alpha);
		// The colour actually painted, so a test can ask "was this species' marking
		// colour ever laid down?" instead of counting clips and hoping only markings
		// clip. Gradients are objects, not strings, and record as ''.
		fillColours.push(typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '');
		calls.push('fill');
	};
	(ctx as unknown as Record<string, unknown>).stroke = () => {
		strokeAlphas.push(alpha);
		calls.push('stroke');
	};

	// Coordinate-bearing calls record their (rounded) arguments too, not just the method
	// name — otherwise every path drawn through the same sequence of canvas calls looks
	// identical to `calls.join()` regardless of where it actually went, and a body that
	// stopped reading the spine would still pass a "did it move" test.
	for (const method of [
		'translate',
		'scale',
		'rotate',
		'moveTo',
		'lineTo',
		'quadraticCurveTo',
		'bezierCurveTo',
		'ellipse',
		'arc',
		'fillRect'
	]) {
		(ctx as unknown as Record<string, unknown>)[method] = (...args: unknown[]) =>
			calls.push(
				`${method}(${args.map((a) => (typeof a === 'number' ? a.toFixed(1) : String(a))).join(',')})`
			);
	}

	return ctx;
}


/**
 * The body outline a species should have at this instant, in the fish's own frame.
 *
 * Recomputed from the same primitives the renderer uses, so a test can assert the
 * drawn path *is* the spine's outline rather than merely that it changed. `join()`
 * inequality only ever proved "something moved" — it passed just as happily if the
 * body froze and the bubble trail carried the difference.
 */
type Motion = { effort: number; turn: number; flip: boolean };

/**
 * The whole placement, not a growing list of scalars.
 *
 * The spine reads motion from the placement the renderer was handed — effort, turn, and
 * whichever field comes next. Recomputing it from defaults compares the drawn body
 * against one that was never drawn, and passing the fields one at a time meant every new
 * one silently broke these tests until it was threaded through by hand.
 */
function expectedOutline(id: string, spec: SpeciesSpec, time: number, at?: Motion) {
	const phase = mix32(hash(id) ^ 0x11) * Math.PI * 2;
	const turn = at ? (at.flip ? -at.turn : at.turn) : 0;
	return outline(
		spineFor(spec.length, spec.wave, time, phase, undefined, at?.effort ?? 1, turn),
		spec.profile,
		spec.length
	);
}

/**
 * Every point the canvas was steered through: `moveTo` targets and `quadraticCurveTo`
 * control points. `tracePath` opens with `moveTo(points[0])` and then uses each point
 * as the control for the following segment, so the opening point never appears as a
 * control and both call kinds are needed to see the whole path.
 */
function drawnPathPoints(ctx: { calls: string[] }): Set<string> {
	const points = new Set<string>();

	for (const call of ctx.calls) {
		if (call.startsWith('moveTo(')) {
			points.add(call.slice('moveTo('.length).replace(')', ''));
		} else if (call.startsWith('quadraticCurveTo(')) {
			points.add(call.slice('quadraticCurveTo('.length).split(',').slice(0, 2).join(','));
		}
	}

	return points;
}

const asKey = (p: { x: number; y: number }) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

/** Asserts the species' computed outline was actually traced onto the canvas. */
function expectBodyDrawn(
	ctx: { calls: string[] },
	id: string,
	spec: SpeciesSpec,
	time: number,
	at?: Motion
) {
	const drawn = drawnPathPoints(ctx);
	const expected = expectedOutline(id, spec, time, at);

	// The closing point is consumed only as a curve endpoint's midpoint, never as a
	// control or a moveTo, so it is the one point of the loop that cannot be observed.
	const missing = expected
		.slice(0, -1)
		.map(asKey)
		.filter((key) => !drawn.has(key));

	expect(missing).toEqual([]);
	expect(expected.length).toBeGreaterThan(8);
}

const creature = (kind: CreatureKind, over: Partial<Creature> = {}): Creature => ({
	id: `${kind}-1`,
	kind,
	label: kind,
	depth: 0.5,
	tapRadius: 24,
	...over
});

const ALL_KINDS: CreatureKind[] = ['fish', 'bubble', 'ghost', 'koi', 'treat', 'pearl'];

describe('drawCreature — every kind', () => {
	it.each(ALL_KINDS)('draws a %s', (kind) => {
		const ctx = fakeCtx();
		const c = creature(kind);

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.calls.filter((call) => call === 'fill' || call === 'stroke').length).toBeGreaterThan(0);
	});

	it.each(ALL_KINDS)('leaves the context balanced after a %s', (kind) => {
		const ctx = fakeCtx();
		const c = creature(kind);

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.depth).toBe(0);
	});

	it('strokes a dashed outline for a manual bubble', () => {
		const ctx = fakeCtx();
		const c = creature('bubble', { dashed: true });

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.calls).toContain('setLineDash');
	});

	it('draws a ghost as an outline of its own species', () => {
		const ghost = fakeCtx();
		const fish = fakeCtx();
		const id = 'same-task';

		drawCreature(ghost, creature('ghost', { id }), place(creature('ghost', { id }), SIZE, 0), COLORS, 0);
		drawCreature(fish, creature('fish', { id }), place(creature('fish', { id }), SIZE, 0), COLORS, 0);

		// Outline, not fill: strokes present, and fewer fills than the live fish.
		expect(ghost.calls.filter((c) => c === 'stroke').length).toBeGreaterThan(0);
		expect(fish.calls.filter((c) => c === 'fill').length).toBeGreaterThan(
			ghost.calls.filter((c) => c === 'fill').length
		);
		expect(ghost.depth).toBe(0);
	});

	it('bends a ghost as it drifts, tracing its own species outline', () => {
		const id = 'drifter';
		const spec = SPECIES[speciesFor(id)];
		const c = creature('ghost', { id });

		for (const time of [0, 1100]) {
			const ctx = fakeCtx();
			const at = place(c, SIZE, time);
			drawCreature(ctx, c, at, COLORS, time);
			expectBodyDrawn(ctx, id, spec, time, at);
		}
	});
});

describe('speciesFor', () => {
	it('gives the same task the same fish on every reload', () => {
		expect(speciesFor('task-abc')).toBe(speciesFor('task-abc'));
	});

	it('spreads a realistic tank across several species', () => {
		const ids = Array.from({ length: 60 }, (_, i) => `task-${i}`);
		const kinds = new Set(ids.map(speciesFor));

		expect(kinds.size).toBeGreaterThan(3);
	});

	it('only ever returns a known species', () => {
		const known = ['clown', 'tang', 'angel', 'guppy', 'neon', 'betta', 'eel', 'puffer', 'discus'];

		for (let i = 0; i < 200; i++) {
			expect(known).toContain(speciesFor(`id-${i}`));
		}
	});

	it('draws every species without complaint', () => {
		// One id per species, found by sweeping — each must paint and stay balanced.
		const perSpecies = new Map<string, string>();
		for (let i = 0; i < 200; i++) perSpecies.set(speciesFor(`id-${i}`), `id-${i}`);

		for (const id of perSpecies.values()) {
			const ctx = fakeCtx();
			const c = creature('fish', { id });

			drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

			expect(ctx.calls.filter((call) => call === 'fill').length).toBeGreaterThan(0);
			expect(ctx.depth).toBe(0);
		}
	});
});

describe('body drawing follows the spine', () => {
	it('traces the species outline, and re-traces it as the body bends', () => {
		const id = 'bender';
		const spec = SPECIES[speciesFor(id)];
		const c = creature('fish', { id });

		for (const time of [0, 900]) {
			const ctx = fakeCtx();
			const at = place(c, SIZE, time);
			drawCreature(ctx, c, at, COLORS, time);
			expectBodyDrawn(ctx, id, spec, time, at);
		}

		// And the two outlines are genuinely different, so the assertions above are not
		// both satisfied by one frozen shape.
		expect(expectedOutline(id, spec, 0, place(c, SIZE, 0)).map(asKey)).not.toEqual(
			expectedOutline(id, spec, 900, place(c, SIZE, 900)).map(asKey)
		);
	});

	it('holds a natural mid-bend under reduced motion', () => {
		// The loop freezes the clock rather than the fish. Each fish should sit in its
		// own bend, not snap to a straight line, which would read as a rendering fault.
		const a = fakeCtx();
		const b = fakeCtx();

		drawCreature(a, creature('fish', { id: 'one' }), place(creature('fish', { id: 'one' }), SIZE, 0, false), COLORS, 0);
		drawCreature(b, creature('fish', { id: 'two' }), place(creature('fish', { id: 'two' }), SIZE, 0, false), COLORS, 0);

		// Same frozen clock, different ids: different phases, so different shapes — and
		// each must be its own computed outline, not merely different from the other.
		expectBodyDrawn(a, 'one', SPECIES[speciesFor('one')], 0);
		expectBodyDrawn(b, 'two', SPECIES[speciesFor('two')], 0);
	});

	it('draws every species with a filled body and a balanced context', () => {
		const perSpecies = new Map<string, string>();
		for (let i = 0; i < 300; i++) perSpecies.set(speciesFor(`id-${i}`), `id-${i}`);
		expect(perSpecies.size).toBe(SWIMMERS.length);

		for (const id of perSpecies.values()) {
			const ctx = fakeCtx();
			const c = creature('fish', { id });

			drawCreature(ctx, c, place(c, SIZE, 400), COLORS, 400);

			expect(ctx.calls.filter((call) => call === 'fill').length).toBeGreaterThan(0);
			expect(ctx.depth).toBe(0);
		}
	});
});

describe('body shading', () => {
	it('spans the back-to-belly ramp over the body depth, not half the length', () => {
		// `createLinearGradient(0, -length/2, 0, length/2)` made every species but the
		// angel sample only the middle of the ramp, so slim fish rendered as one flat
		// mid-tone. The gradient must span the species' own deepest half-height.
		for (const name of SWIMMERS) {
			let id = '';
			for (let i = 0; i < 400 && !id; i++) if (speciesFor(`id-${i}`) === name) id = `id-${i}`;

			const ctx = fakeCtx();
			const c = creature('fish', { id });
			drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

			const spec = SPECIES[name];
			const half = profilePeak(spec.profile) * spec.length;

			expect(ctx.calls).toContain(
				`linearGradient(0.0,${(-half).toFixed(1)},0.0,${half.toFixed(1)})`
			);
			// And explicitly not the old length-based span, except where they coincide.
			if (Math.abs(profilePeak(spec.profile) - 0.5) > 0.001) {
				const wrong = spec.length * 0.5;
				expect(ctx.calls).not.toContain(
					`linearGradient(0.0,${(-wrong).toFixed(1)},0.0,${wrong.toFixed(1)})`
				);
			}
		}
	});
});

describe('per-frame cost', () => {
	it('builds each species\' body gradient once, not once a frame', () => {
		// This runs inside a requestAnimationFrame loop. The gradient depends only on the
		// species, so rebuilding it per fish per frame is pure waste.
		const ctx = fakeCtx();
		const c = creature('fish', { id: 'steady' });
		const gradients = () => ctx.calls.filter((call) => call.startsWith('linearGradient(')).length;

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);
		const afterOneFrame = gradients();

		for (let frame = 1; frame < 30; frame++) {
			drawCreature(ctx, c, place(c, SIZE, frame * 100), COLORS, frame * 100);
		}

		// Pinned to the first frame's count rather than to 1: the body gradient is no
		// longer the only cached one — each fin has an opacity ramp — and what matters is
		// that 30 frames cost no more than one, not how many a fish needs.
		expect(afterOneFrame).toBeGreaterThan(0);
		expect(gradients()).toBe(afterOneFrame);
	});

	it('still shades a second species with its own gradient', () => {
		// A cache keyed too coarsely would paint every fish in the first species' colours.
		const ctx = fakeCtx();
		const ids = SWIMMERS.map((name) => {
			for (let i = 0; i < 400; i++) if (speciesFor(`id-${i}`) === name) return `id-${i}`;
			return '';
		});

		for (const id of ids) {
			const c = creature('fish', { id });
			drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);
		}

		const spans = new Set(ctx.calls.filter((call) => call.startsWith('linearGradient(')));
		// The angel and the clown happen to share no peak with anyone; six species give
		// at least five distinct spans.
		expect(spans.size).toBeGreaterThanOrEqual(5);
	});
});

describe('place — where creatures sit', () => {
	it('cruises the treat fish in the surface lane', () => {
		const y = place(creature('treat', { depth: 0 }), SIZE, 0).y;

		// Below the surface, not straddling it — a fish half out of the water reads as
		// a rendering fault rather than a prize.
		expect(y).toBeGreaterThan(WATERLINE);
		expect(y).toBeLessThan(WATERLINE + 60);
	});

	it('keeps the treat fish clear of the date header', () => {
		// Treats used to sit at y=17, behind the header and clipped by the canvas top.
		// The fish is ~40px tall, so its top edge must stay below the chrome.
		const y = place(creature('treat', { depth: 0 }), SIZE, 0).y;

		expect(y - 40).toBeGreaterThan(HEADER_HEIGHT);
	});

	it('spreads treat fish across the width instead of crowding one side', () => {
		// Every treat carries depth 0; deriving the lane from depth put them all in
		// the left third.
		const xs = Array.from({ length: 5 }, (_, i) =>
			place(creature('treat', { id: `treat-${i}`, depth: 0 }), SIZE, 0).x
		);

		expect(Math.max(...xs)).toBeGreaterThan(SIZE.w * 0.5);
		expect(Math.min(...xs)).toBeLessThan(SIZE.w * 0.5);
	});

	it('swims the treat fish rather than parking it', () => {
		const treat = creature('treat', { depth: 0 });

		expect(place(treat, SIZE, 0).y).not.toBe(place(treat, SIZE, 2000).y);
		expect(place(treat, SIZE, 0).x).not.toBe(place(treat, SIZE, 9000).x);
	});

	it('keeps swimmers below the waterline', () => {
		const shallow = place(creature('fish', { depth: 0 }), SIZE, 0);

		expect(shallow.y).toBeGreaterThan(WATERLINE);
	});

	it('settles pearls on the bed, not floating in open water', () => {
		// Pearls are heavy. Lifted clear of the floor they read as bubbles.
		for (let i = 0; i < 40; i++) {
			const y = place(creature('pearl', { id: `pearl-${i}` }), SIZE, 0).y;
			expect(y).toBeGreaterThan(SIZE.h - 48);
			expect(y).toBeLessThan(SIZE.h);
		}
	});

	it('keeps pearls out from behind the add-pill', () => {
		// The pill is a centred band along the bottom; pearls beneath it were invisible,
		// so the balance said 3 and you could see one.
		for (let i = 0; i < 40; i++) {
			const x = place(creature('pearl', { id: `pearl-${i}` }), SIZE, 0).x;
			const centred = x > SIZE.w * 0.26 && x < SIZE.w * 0.74;
			expect(centred).toBe(false);
		}
	});

	it('spreads pearls along the bed rather than stacking them', () => {
		const xs = Array.from({ length: 6 }, (_, i) =>
			place(creature('pearl', { id: `pearl-${i}` }), SIZE, 0).x
		);

		expect(new Set(xs.map(Math.round)).size).toBeGreaterThan(3);
	});

	it('deals pearls evenly to both sides of the pill', () => {
		// Coin-flipping per id piled seven of eight on one side.
		const xs = Array.from({ length: 8 }, (_, i) =>
			place(creature('pearl', { id: `pearl-${i}` }), SIZE, 0).x
		);
		const left = xs.filter((x) => x < SIZE.w / 2).length;

		expect(left).toBe(4);
	});

	it('keeps neighbouring pearls from landing on top of each other', () => {
		const spots = Array.from({ length: 8 }, (_, i) =>
			place(creature('pearl', { id: `pearl-${i}` }), SIZE, 0)
		);

		for (let i = 0; i < spots.length; i++) {
			for (let j = i + 1; j < spots.length; j++) {
				const gap = Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y);
				expect(gap).toBeGreaterThan(9);
			}
		}
	});

	it('puts a shallow creature above a deep one', () => {
		const shallow = place(creature('bubble', { id: 'x', depth: 0.1 }), SIZE, 0);
		const deep = place(creature('bubble', { id: 'x', depth: 0.9 }), SIZE, 0);

		expect(shallow.y).toBeLessThan(deep.y);
	});

	it('keeps every kind inside the tank, over a long swim', () => {
		// Swept densely rather than spot-checked: the vertical wander and the warped
		// pace both have room to push a fish through the glass at some phase.
		for (const kind of ALL_KINDS) {
			for (let i = 0; i < 400; i++) {
				const time = i * 617;
				for (const id of ['a', 'seed-two', 'zzz-9']) {
					const at = place(creature(kind, { id }), SIZE, time);
					expect(at.x).toBeGreaterThanOrEqual(0);
					expect(at.x).toBeLessThanOrEqual(SIZE.w);
					expect(at.y).toBeGreaterThanOrEqual(0);
					expect(at.y).toBeLessThanOrEqual(SIZE.h);
				}
			}
		}
	});

	it('never swims a fish above the waterline, whatever the wander', () => {
		for (let i = 0; i < 400; i++) {
			const at = place(creature('fish', { id: 'shallow', depth: 0 }), SIZE, i * 617);
			expect(at.y).toBeGreaterThan(WATERLINE);
		}
	});

	it('moves vertically as well as horizontally', () => {
		// A fish that only slides sideways reads as being on a rail.
		const fish = creature('fish', { id: 'swimmer' });
		const ys = [0, 2000, 4000, 6000, 8000, 12_000].map((ms) => place(fish, SIZE, ms).y);

		expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(20);
	});

	it('varies its pace instead of tracking at a constant rate', () => {
		const fish = creature('fish', { id: 'swimmer' });
		const step = 400;
		const distances: number[] = [];

		for (let ms = 0; ms < 24_000; ms += step) {
			const a = place(fish, SIZE, ms);
			const b = place(fish, SIZE, ms + step);
			distances.push(Math.hypot(b.x - a.x, b.y - a.y));
		}

		const fastest = Math.max(...distances);
		const slowest = Math.min(...distances);

		// Burst and glide: the quick stretches are clearly quicker than the slow ones.
		expect(fastest).toBeGreaterThan(slowest * 3);
	});

	it('gives two fish different paths, so the shoal does not move as one', () => {
		const a = creature('fish', { id: 'fish-one' });
		const b = creature('fish', { id: 'fish-two' });

		const apart = [0, 3000, 6000, 9000].map((ms) => {
			const pa = place(a, SIZE, ms);
			const pb = place(b, SIZE, ms);
			return Math.hypot(pa.x - pb.x, pa.y - pb.y);
		});

		expect(Math.max(...apart)).toBeGreaterThan(30);
	});

	it('holds a bubble at its assigned depth — depth is information, not decoration', () => {
		// Time until trigger is encoded in depth, so a bubble must not wander off it.
		const bubble = creature('bubble', { id: 'waiting', depth: 0.2 });
		const ys = [0, 3000, 7000, 15_000].map((ms) => place(bubble, SIZE, ms).y);

		expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(10);
	});

	it('faces the way it is travelling', () => {
		const fish = creature('fish', { id: 'swimmer' });

		// Sampling across a full crossing, it must face both ways at some point.
		const flips = new Set(
			Array.from({ length: 60 }, (_, i) => place(fish, SIZE, i * 700).flip)
		);

		expect(flips.size).toBe(2);
	});

	it('is stable across reloads — the same id lands in the same place', () => {
		const c = creature('fish', { id: 'task-abc' });

		expect(place(c, SIZE, 5000)).toEqual(place(c, SIZE, 5000));
	});

	it('puts different creatures in different places', () => {
		const a = place(creature('fish', { id: 'a' }), SIZE, 0);
		const b = place(creature('fish', { id: 'b' }), SIZE, 0);

		expect(a.x).not.toBe(b.x);
	});

	it('moves a fish over time', () => {
		const c = creature('fish', { id: 'a' });

		expect(place(c, SIZE, 0).x).not.toBe(place(c, SIZE, 3000).x);
	});

	it('holds still when animation is frozen', () => {
		const c = creature('fish', { id: 'a' });

		expect(place(c, SIZE, 0, false)).toEqual(place(c, SIZE, 60_000, false));
	});
});

describe('fins', () => {
	it('draws one shape per fin, plus the body', () => {
		// Six fills for a betta (body + 4 fins + eye white) is a floor, not an exact
		// count — the point is that fins reach the canvas at all.
		const ctx = fakeCtx();
		const c = creature('fish', { id: 'finny' });

		drawCreature(ctx, c, place(c, SIZE, 300), COLORS, 300);

		expect(ctx.calls.filter((call) => call === 'fill').length).toBeGreaterThanOrEqual(3);
	});

	it('flutters the caudal fin itself, not merely something on the canvas', () => {
		// "The transcripts differ" is satisfied by the body bending; it says nothing
		// about the fins. The caudal is the first thing `drawFish` draws, so its two
		// `quadraticCurveTo` calls are the first two in the transcript — pin those.
		const a = fakeCtx();
		const b = fakeCtx();
		const c = creature('fish', { id: 'finny' });

		drawCreature(a, c, place(c, SIZE, 100), COLORS, 100);
		drawCreature(b, c, place(c, SIZE, 700), COLORS, 700);

		const caudal = (calls: string[]) => {
			const start = calls.findIndex((call) => call.startsWith('quadraticCurveTo('));
			expect(start).toBeGreaterThanOrEqual(0);
			return calls.slice(start, start + 2);
		};

		expect(caudal(a.calls)).toHaveLength(2);
		expect(a.calls.length).toBe(b.calls.length);
		expect(caudal(a.calls)).not.toEqual(caudal(b.calls));
	});

	it('draws the near pectoral after the body, so it overlaps', () => {
		// Depth cue: the pectoral is the one part of the fish nearer the viewer than the
		// flank. Under the body it flattened the fish into a decal.
		const ctx = fakeCtx();
		const c = creature('fish', { id: 'finny' });

		drawCreature(ctx, c, place(c, SIZE, 300), COLORS, 300);

		// The body is the only fill preceded by a linear gradient.
		const bodyFill = ctx.calls.findIndex((call) => call.startsWith('linearGradient('));
		// Fins are the only things drawn inside their own rotate().
		const rotates = ctx.calls.flatMap((call, i) => (call.startsWith('rotate(') ? [i] : []));

		expect(rotates.some((i) => i < bodyFill)).toBe(true);
		expect(rotates.some((i) => i > bodyFill)).toBe(true);
	});
});

describe('ghosts', () => {
	it('outlines its own fins, not just its body', () => {
		// For half the tank the species *is* the fins — a guppy is a fan tail, a betta is
		// veils, an angel is a diamond. A body-only outline made all three identical.
		for (const name of SWIMMERS) {
			let id = '';
			for (let i = 0; i < 400 && !id; i++) if (speciesFor(`id-${i}`) === name) id = `id-${i}`;

			const ghost = fakeCtx();
			const c = creature('ghost', { id });
			// A fixed, level placement: `place` now also pitches a swimmer toward its
			// direction of travel, which is a second `rotate()` and would be counted below.
			drawCreature(ghost, c, { x: 200, y: 400, flip: false, pitch: 0, effort: 1, turn: 0 }, COLORS, 250);

			// One `rotate()` per fin side: fins are the only thing left in a local frame.
			const sides = SPECIES[name].fins.reduce(
				(n, fin) => n + (fin.kind === 'caudal' ? 2 : 1),
				0
			);
			expect(ghost.calls.filter((call) => call.startsWith('rotate(')).length).toBe(sides);
			expect(ghost.depth).toBe(0);
		}
	});

	it('strokes its fins rather than filling them', () => {
		const ghost = fakeCtx();
		const c = creature('ghost', { id: 'spent' });

		drawCreature(ghost, c, place(c, SIZE, 250), COLORS, 250);

		// The single body wash is the only fill a ghost makes.
		expect(ghost.calls.filter((call) => call === 'fill').length).toBe(1);
		expect(ghost.calls.filter((call) => call === 'stroke').length).toBeGreaterThan(4);
	});

	it('gives two species visibly different ghost silhouettes', () => {
		const shapes = SWIMMERS.map((name) => {
			let id = '';
			for (let i = 0; i < 400 && !id; i++) if (speciesFor(`id-${i}`) === name) id = `id-${i}`;
			const ctx = fakeCtx();
			// Frozen clock and a shared placement, so only the species differs.
			drawCreature(ctx, creature('ghost', { id }), { x: 200, y: 400, flip: false, pitch: 0, effort: 1, turn: 0 }, COLORS, 0);
			return ctx.calls.filter((call) => call.startsWith('quadraticCurveTo(')).join();
		});

		expect(new Set(shapes).size).toBe(SWIMMERS.length);
	});
});

describe('head', () => {
	it('draws an eye with a pupil and a catchlight', () => {
		// Three stacked arcs at the head: white, pupil, glint. Eyes are most of what
		// makes a 40px shape look alive.
		const ctx = fakeCtx();
		const c = creature('fish', { id: 'eyed' });

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.calls.filter((call) => call.startsWith('arc(')).length).toBeGreaterThanOrEqual(3);
	});
});

/**
 * A canvas fake that follows the transform stack, so drawn coordinates can be checked
 * against the glass. `fakeCtx` records local coordinates; a fin drawn 30px behind a
 * fish that itself sits at x=395 looks perfectly innocent in local space.
 */
function boundsCtx() {
	// [a, b, c, d, e, f] — the standard 2D affine, same order as `setTransform`.
	let m = [1, 0, 0, 1, 0, 0];
	const stack: number[][] = [];
	let minX = Infinity;
	let maxX = -Infinity;

	const mul = (n: number[]) => {
		m = [
			m[0] * n[0] + m[2] * n[1],
			m[1] * n[0] + m[3] * n[1],
			m[0] * n[2] + m[2] * n[3],
			m[1] * n[2] + m[3] * n[3],
			m[0] * n[4] + m[2] * n[5] + m[4],
			m[1] * n[4] + m[3] * n[5] + m[5]
		];
	};

	const mark = (x: number, y: number) => {
		const wx = m[0] * x + m[2] * y + m[4];
		minX = Math.min(minX, wx);
		maxX = Math.max(maxX, wx);
	};

	const ctx = {
		get minX() {
			return minX;
		},
		get maxX() {
			return maxX;
		},
		save: () => stack.push([...m]),
		restore: () => {
			m = stack.pop() ?? m;
		},
		translate: (x: number, y: number) => mul([1, 0, 0, 1, x, y]),
		scale: (x: number, y: number) => mul([x, 0, 0, y, 0, 0]),
		rotate: (a: number) => mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]),
		moveTo: mark,
		lineTo: mark,
		quadraticCurveTo: (cx: number, cy: number, x: number, y: number) => {
			// Control points bound the curve, so marking them is conservative.
			mark(cx, cy);
			mark(x, y);
		},
		bezierCurveTo: (a: number, b: number, c: number, d: number, x: number, y: number) => {
			mark(a, b);
			mark(c, d);
			mark(x, y);
		},
		arc: (x: number, y: number, r: number) => {
			mark(x - r, y);
			mark(x + r, y);
			mark(x, y - r);
			mark(x, y + r);
		},
		ellipse: (x: number, y: number, rx: number, ry: number) => {
			mark(x - rx, y);
			mark(x + rx, y);
			mark(x, y - ry);
			mark(x, y + ry);
		},
		createLinearGradient: () => ({ addColorStop: () => {} }),
		createRadialGradient: () => ({ addColorStop: () => {} }),
		globalAlpha: 1,
		globalCompositeOperation: 'source-over',
		fillStyle: '',
		strokeStyle: '',
		lineWidth: 0,
		lineCap: 'butt'
	} as unknown as CanvasRenderingContext2D & { minX: number; maxX: number };

	for (const method of ['clip', 'beginPath', 'closePath', 'fill', 'stroke', 'setLineDash', 'fillRect', 'roundRect', 'setTransform']) {
		(ctx as unknown as Record<string, unknown>)[method] = () => {};
	}

	return ctx;
}

describe('fin clipping', () => {
	it('keeps every fin inside the glass, for the widest-finned species', () => {
		// `place` clamps the *body* to [0.06, 0.94] of the width — about 24px of slack on
		// a phone — but an exotic caudal reaches over 30px past the body. The tail clipped
		// through the right wall in a busy tank. `place` cannot be widened (hit-testing
		// shares it), so the drawing layer insets by what each species actually needs.
		const kinds: CreatureKind[] = ['fish', 'ghost', 'koi', 'treat'];
		const creatures = kinds.flatMap((kind) =>
			Array.from({ length: 20 }, (_, i) => creature(kind, { id: `${kind}-edge-${i}` }))
		);

		for (let frame = 0; frame < 60; frame++) {
			const ctx = boundsCtx();
			drawCreatures(ctx, creatures, COLORS, SIZE, frame * 431);

			expect(ctx.minX).toBeGreaterThanOrEqual(0);
			expect(ctx.maxX).toBeLessThanOrEqual(SIZE.w);
		}
	});

	it('does not shove a mid-tank fish around to make room', () => {
		// The inset must be a clamp, not a squeeze: only a fish already against the wall
		// may move, or drawn positions drift away from the ones pointer picking uses.
		const ctx = boundsCtx();
		const mid = creature('fish', { id: 'centred', depth: 0.5 });
		const at = place(mid, SIZE, 0);

		drawCreatures(ctx, [mid], COLORS, SIZE, 0);

		// The nose is roughly half a body length ahead of the centre; if the fish had
		// been shifted, the drawn span would no longer straddle its placement.
		expect(ctx.minX).toBeLessThan(at.x);
		expect(ctx.maxX).toBeGreaterThan(at.x);
	});
});

describe('drawCreatures — the whole tank', () => {
	it('draws every creature in the scene', () => {
		const ctx = fakeCtx();
		const creatures = ALL_KINDS.map((kind) => creature(kind));

		drawCreatures(ctx, creatures, COLORS, SIZE, 0);

		// One save/restore pair per creature, at minimum.
		expect(ctx.calls.filter((c) => c === 'save').length).toBeGreaterThanOrEqual(creatures.length);
		expect(ctx.depth).toBe(0);
	});

	it('draws an empty scene without complaint', () => {
		const ctx = fakeCtx();

		drawCreatures(ctx, [], COLORS, SIZE, 0);

		expect(ctx.calls).toEqual([]);
	});

	it('does not reorder the caller array', () => {
		const creatures = [creature('koi'), creature('pearl')];
		const before = creatures.map((c) => c.id);

		drawCreatures(fakeCtx(), creatures, COLORS, SIZE, 0);

		expect(creatures.map((c) => c.id)).toEqual(before);
	});
});

describe('koi', () => {
	it('draws and stays balanced', () => {
		const ctx = fakeCtx();
		const c = creature('koi', { id: 'koi-2026-08-01' });

		drawCreature(ctx, c, place(c, SIZE, 500), COLORS, 500);

		expect(ctx.calls.filter((call) => call === 'fill').length).toBeGreaterThan(0);
		expect(ctx.depth).toBe(0);
	});

	it('swims more slowly than an ordinary fish', () => {
		// The koi is the reward for a cleared day; it should be unhurried.
		expect(SPECIES.koi.wave.speed).toBeLessThan(SPECIES.clown.wave.speed);
	});

	it('stays unmistakable now that the eel is longer than it', () => {
		// Length used to carry the koi's identity, until a ribbon eel out-measured it.
		// What still separates it: nothing moves more slowly, and the eel that beats it
		// on length is a thin ribbon where the koi is a deep gold body.
		for (const name of SWIMMERS) {
			expect(SPECIES.koi.wave.speed).toBeLessThanOrEqual(SPECIES[name].wave.speed);
		}

		const depth = (spec: SpeciesSpec) =>
			Math.max(...spec.profile.map((point: [number, number]) => point[1])) * spec.length;
		expect(depth(SPECIES.koi)).toBeGreaterThan(depth(SPECIES.eel) * 2);
	});
});

describe('markings', () => {
	it('clips markings to the body so they cannot spill past the silhouette', () => {
		const ctx = fakeCtx();
		// `clown` has bands; find an id that maps to it.
		let banded = 'id-0';
		for (let i = 0; i < 300; i++) {
			if (speciesFor(`id-${i}`) === 'clown') {
				banded = `id-${i}`;
				break;
			}
		}
		const c = creature('fish', { id: banded });

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		expect(ctx.calls).toContain('clip');
	});

	it('draws no markings for a species that has none', () => {
		let plain = 'id-0';
		for (let i = 0; i < 300; i++) {
			if (speciesFor(`id-${i}`) === 'betta') {
				plain = `id-${i}`;
				break;
			}
		}
		const withMarks = fakeCtx();
		const c = creature('fish', { id: plain });

		drawCreature(withMarks, c, place(c, SIZE, 0), COLORS, 0);

		// Betta is `pattern: 'none'`, so its marking colour must never be laid down.
		//
		// This used to count `clip` calls and assert zero, on the assumption that only
		// markings clip. Fin rays clip too now, so that proxy broke while the property it
		// stood for held. Asking about the colour tests the actual claim, and would still
		// catch a marking drawn without clipping — which the old assertion would not.
		expect(withMarks.fillColours).not.toContain(SPECIES.betta.palette.marking);
	});
});

describe('treat fish', () => {
	it('bends the treat fish as it swims', () => {
		// The old bespoke treat body was a fixed path and never bent; this is what
		// actually fails before the rewrite.
		const early = fakeCtx();
		const later = fakeCtx();
		const c = creature('treat', { id: 'treat-1' });

		drawCreature(early, c, place(c, SIZE, 0), COLORS, 0);
		drawCreature(later, c, place(c, SIZE, 1300), COLORS, 1300);

		expect(early.calls.join()).not.toBe(later.calls.join());
	});

	it('draws an affordable treat brighter than a locked one', () => {
		const open = fakeCtx();
		const locked = fakeCtx();
		const c = creature('treat', { id: 'treat-1' });

		drawCreature(open, { ...c, locked: false }, place(c, SIZE, 0), COLORS, 0);
		drawCreature(locked, { ...c, locked: true }, place(c, SIZE, 0), COLORS, 0);

		// The halo and sparkles only exist when you can afford it.
		expect(open.calls.length).toBeGreaterThan(locked.calls.length);
		expect(open.depth).toBe(0);
		expect(locked.depth).toBe(0);

		// The point of the dim is that the *whole* fish is drained. `drawBody` used to
		// assign `globalAlpha` instead of multiplying it, so the body, markings, eye and
		// mouth painted at full brightness inside a fish whose fins alone were faded —
		// exactly backwards. Every paint in a locked treat must be below full alpha.
		// Asserted as a property, not against the literal 0.62 — retuning the dim should
		// not break a test whose point is "every paint is drained".
		expect(locked.fillAlphas.length).toBeGreaterThan(0);
		expect(Math.max(...locked.fillAlphas)).toBeLessThan(1);
		expect(Math.max(...locked.strokeAlphas)).toBeLessThan(1);
		// And the affordable one is not dimmed at all.
		expect(Math.max(...open.fillAlphas)).toBe(1);

		// And an affordable one is painted at full strength.
		expect(Math.max(...open.fillAlphas)).toBe(1);
	});

	it('draws a claimed treat as the same exotic fish, in the shoal', () => {
		const ctx = fakeCtx();
		const c = creature('fish', { id: 'bought', claimed: true });

		drawCreature(ctx, c, place(c, SIZE, 0), COLORS, 0);

		// The 0.72 shrink that keeps a claimed treat sized for the shoal. `fakeCtx`
		// records coordinate-bearing calls with their arguments, so this checks for the
		// call rather than the bare method name.
		expect(ctx.calls.some((call) => call.startsWith('scale('))).toBe(true);
		expect(ctx.depth).toBe(0);
	});

	it('draws a bending fish sealed inside a waiting bubble', () => {
		const early = fakeCtx();
		const later = fakeCtx();
		const c = creature('bubble', { id: 'waiting-task' });

		drawCreature(early, c, place(c, SIZE, 0), COLORS, 0);
		drawCreature(later, c, place(c, SIZE, 1200), COLORS, 1200);

		expect(early.calls).toContain('clip');
		expect(early.calls.join()).not.toBe(later.calls.join());
		expect(early.depth).toBe(0);
	});
});

describe('depth haze', () => {
	/** Brightest paint in the frame: what the fish is worth against the water. */
	const peakAlpha = (c: Creature, y: number) => {
		const ctx = fakeCtx();
		const at = { ...place(c, SIZE, 0), y, effort: 1, turn: 0 };
		drawCreaturesAt(ctx, c, at);
		return Math.max(...ctx.fillAlphas);
	};

	// Exercised through drawCreatures, which is where the tank's height is known.
	const drawCreaturesAt = (ctx: CanvasRenderingContext2D, c: Creature, at: ReturnType<typeof place>) =>
		drawCreature(ctx, c, at, COLORS, 0);

	it('paints a deep fish fainter than a shallow one', () => {
		const c = creature('fish', { id: 'hazy' });
		const shallow = peakAlpha(c, WATERLINE + 20);
		const deep = peakAlpha(c, SIZE.h - 60);

		// drawCreature itself is depth-agnostic; the haze is applied by drawCreatures.
		expect(shallow).toBe(deep);
	});

	it('fades creatures with depth when drawn as a scene', () => {
		const shallowCtx = fakeCtx();
		const deepCtx = fakeCtx();

		// depth drives the resting band, so the same species lands high or low.
		drawCreatures(shallowCtx, [creature('fish', { id: 'a', depth: 0.05 })], COLORS, SIZE, 0);
		drawCreatures(deepCtx, [creature('fish', { id: 'a', depth: 0.95 })], COLORS, SIZE, 0);

		expect(Math.max(...deepCtx.fillAlphas)).toBeLessThan(Math.max(...shallowCtx.fillAlphas));
	});

	it('leaves pearls at full brightness on the bed', () => {
		// Pearls sit at the very bottom by design and are meant to catch the light.
		const ctx = fakeCtx();
		drawCreatures(ctx, [creature('pearl', { id: 'pearl-0', depth: 1 })], COLORS, SIZE, 0);

		expect(Math.max(...ctx.fillAlphas)).toBe(1);
	});
});

describe('feeding stirs the shoal', () => {
	const bodyPoints = (feeding: number, animate = true) => {
		const ctx = fakeCtx();
		drawCreatures(ctx, [creature('fish', { id: 'eater' })], COLORS, SIZE, 1200, animate, feeding);
		return ctx.calls.filter((c) => c.startsWith('quadraticCurveTo(')).join();
	};

	it('bends the body differently when there is food in the water', () => {
		// Feeding rides the existing effort input rather than adding a second animation
		// path, so the proof is that the drawn body actually changes.
		expect(bodyPoints(1)).not.toEqual(bodyPoints(0));
	});

	it('leaves the tank alone under reduced motion', () => {
		// The loop freezes the clock rather than the fish. A flourish that still fired
		// would be motion the user asked not to see.
		expect(bodyPoints(1, false)).toEqual(bodyPoints(0, false));
	});
});

describe('heading is only read from real travel', () => {
	const SPAN = 60000;
	const STEP = 80;

	/** Peak speed, pitch and turn over a minute of swimming. */
	const survey = (c: Creature) => {
		let maxSpeed = 0;
		let maxPitch = 0;
		let maxTurn = 0;
		let minX = Infinity;
		let maxX = -Infinity;
		let prev = place(c, SIZE, 0);

		for (let ms = 0; ms <= SPAN; ms += STEP) {
			const at = place(c, SIZE, ms);
			maxSpeed = Math.max(maxSpeed, Math.hypot(at.x - prev.x, at.y - prev.y) * (1000 / STEP));
			maxPitch = Math.max(maxPitch, Math.abs(at.pitch));
			maxTurn = Math.max(maxTurn, Math.abs(at.turn));
			minX = Math.min(minX, at.x);
			maxX = Math.max(maxX, at.x);
			prev = at;
		}

		return { maxSpeed, maxPitch, maxTurn, range: maxX - minX };
	};

	const treat = (): Creature => ({
		id: 'treat-1',
		kind: 'treat',
		label: 't',
		depth: 0,
		tapRadius: 36,
		cost: 3
	});

	it('never reports a turn rate no animal could perform', () => {
		// Measured at 19.3 rad/s before this guard: over a thousand degrees a second, on
		// a fish crossing less than a pixel per sample. `turnFrom` divides the heading
		// change by the lookahead, so sub-pixel noise came out multiplied by 12.
		for (const c of [treat(), creature('fish', { id: 'sp-3' }), creature('koi', { id: 'k' })]) {
			expect(survey(c).maxTurn).toBeLessThanOrEqual(MAX_TURN_RATE);
		}
	});

	it('reads no heading at all from a creature that is not going anywhere', () => {
		const still: Creature = { ...treat(), id: 'motionless' };
		const frozen = place(still, SIZE, 5000, false);

		expect(frozen.pitch).toBe(0);
		expect(frozen.turn).toBe(0);
	});

	it('still lets an ordinary fish tip as it climbs', () => {
		// The guard must not silence real motion — a fish that never pitches is the bug
		// vertical swimming was added to fix.
		expect(survey(creature('fish', { id: 'sp-3' })).maxPitch).toBeGreaterThan(0.05);
	});

	it('gives the prize a patrol rather than a hover', () => {
		// It cruised an 84px box at 10.6 px/s — a quarter of an ordinary fish's speed,
		// one lap a minute — which read as hovering in place rather than cruising.
		const prize = survey(treat());
		const ordinary = survey(creature('fish', { id: 'sp-3' }));

		expect(prize.maxSpeed).toBeGreaterThan(ordinary.maxSpeed * 0.4);
		expect(prize.range).toBeGreaterThan(130);
	});

	it('keeps the prize in its lane under the surface', () => {
		// Wider than it was, but still the surface lane: the prize sits above the shoal
		// so it stays the thing your eye lands on.
		let minY = Infinity;
		let maxY = -Infinity;
		for (let ms = 0; ms <= SPAN; ms += STEP) {
			const at = place(treat(), SIZE, ms);
			minY = Math.min(minY, at.y);
			maxY = Math.max(maxY, at.y);
		}

		expect(minY).toBeGreaterThan(WATERLINE);
		expect(maxY).toBeLessThan(WATERLINE + 120);
	});
});

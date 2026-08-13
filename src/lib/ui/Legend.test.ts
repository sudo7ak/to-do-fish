import { describe, it, expect } from 'vitest';
import { LEGEND_ENTRIES } from './Legend.svelte';
import type { CreatureKind } from '../scene/types';

/**
 * Every kind, spelled out. This is a Record rather than an array so that adding a
 * member to `CreatureKind` breaks `npm run check` here — a compile error naming the
 * missing kind beats a test asserting a count that someone will relax.
 */
const ALL_KINDS: Record<CreatureKind, true> = {
	fish: true,
	bubble: true,
	ghost: true,
	koi: true,
	treat: true,
	pearl: true,
	sync: true,
	shark: true
};

describe('legend entries', () => {
	it('covers every creature kind the tank can draw', () => {
		const covered = new Set(LEGEND_ENTRIES.map((e) => e.creature.kind));
		expect([...Object.keys(ALL_KINDS)].filter((k) => !covered.has(k as CreatureKind))).toEqual([]);
	});

	it('has nine rows — the eight kinds plus the treat split', () => {
		expect(LEGEND_ENTRIES).toHaveLength(9);
	});

	it('gives every row a unique id', () => {
		const ids = LEGEND_ENTRIES.map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('explains both treat states, because the dim one is what people ask about', () => {
		const treats = LEGEND_ENTRIES.filter((e) => e.creature.kind === 'treat');
		expect(treats).toHaveLength(2);
		expect(treats.filter((t) => t.creature.locked)).toHaveLength(1);
		expect(treats.filter((t) => !t.creature.locked)).toHaveLength(1);
	});

	it('says something in every row', () => {
		for (const entry of LEGEND_ENTRIES) {
			expect(entry.title).toMatch(/\S/);
			expect(entry.blurb.length).toBeGreaterThan(15);
		}
	});

	// Every visual property downstream comes from hash(id). A generated id would make
	// the legend fish a different fish on every open, and every screenshot a new one.
	it('uses fixed literal creature ids so the art is stable', () => {
		for (const entry of LEGEND_ENTRIES) {
			expect(entry.creature.id).toMatch(/^legend-/);
		}
	});

	// Whether a creature actually FITS its tile is not covered by any test, and this
	// one does not pretend to: it is a sanity bound on the constant, nothing more.
	// Both fit defects this sheet has had — a treat's caudal clipped at the tile edge
	// at 0.8, the ghost overflowing at 0.9 — sit inside this range and passed it. Fit
	// is verified by the deviceScaleFactor 4 screenshot step in CLAUDE.md, by eye.
	// Changing creature geometry (FIN_SHAPE, speciesReach, a species `length`)
	// silently invalidates all seven hand-tuned zooms with no automated signal.
	it('gives every row a positive draw scale within a sane bound', () => {
		for (const entry of LEGEND_ENTRIES) {
			expect(entry.zoom).toBeGreaterThan(0);
			expect(entry.zoom).toBeLessThanOrEqual(1.5);
		}
	});
});

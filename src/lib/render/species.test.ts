import { describe, it, expect } from 'vitest';
import { SPECIES, SWIMMERS, TREATS, speciesFor, treatSpeciesFor, type Species } from './species';
import { profileAt } from './spine';

const ALL = Object.keys(SPECIES) as Species[];

describe('species data', () => {
	it('defines the swimmers plus koi and the exotic treat', () => {
		expect(SWIMMERS).toEqual([
			'clown',
			'tang',
			'angel',
			'guppy',
			'neon',
			'betta',
			'eel',
			'puffer',
			'discus'
		]);
		expect(ALL).toContain('koi');
		expect(ALL).toContain('exotic');
	});

	it('never gives a swimmer id a koi or a prize body', () => {
		// Those are assigned by creature kind. A task turning into a koi would be a lie
		// about the day being cleared; one turning into a prize would be a lie about
		// having paid for it. Derived from TREATS so adding a prize cannot slip past.
		const reserved = ['koi', ...TREATS];

		for (let i = 0; i < 300; i++) {
			expect(reserved).not.toContain(speciesFor(`id-${i}`));
		}
	});

	it('gives the prizes their own bodies, none of them a swimmer', () => {
		for (const name of TREATS) {
			expect(SWIMMERS).not.toContain(name);
			expect(SPECIES[name].finStyle).toBe('veil');
		}
	});

	it('keeps every profile non-negative and narrow at the nose', () => {
		// Not *closed*: a pufferfish's snout is genuinely blunt. What matters is that the
		// nose is far narrower than the body, so the fish has a front rather than a wall.
		for (const name of ALL) {
			const { profile } = SPECIES[name];
			const peak = Math.max(...profile.map(([, h]) => h));
			expect(profile[0][1]).toBeLessThan(peak * 0.35);
			for (let t = 0; t <= 1; t += 0.02) {
				expect(profileAt(profile, t)).toBeGreaterThanOrEqual(0);
			}
		}
	});

	it('orders profile control points by t', () => {
		for (const name of ALL) {
			const ts = SPECIES[name].profile.map(([t]) => t);
			expect(ts).toEqual([...ts].sort((a, b) => a - b));
		}
	});

	it('separates silhouettes: the deepest body is at least twice the slimmest', () => {
		// Shape is what survives at 40px. If every species has the same depth they are
		// one fish in six paint jobs, which is the bug this design exists to fix.
		const depths = SWIMMERS.map((name) =>
			Math.max(...SPECIES[name].profile.map(([, h]) => h))
		);
		expect(Math.max(...depths)).toBeGreaterThan(Math.min(...depths) * 2);
	});

	it('roots every fin on the body, not in open water', () => {
		// `0 <= anchor <= 1` only says the fin is somewhere along the spine's parameter
		// range. What matters is that the root lands on a part of the body with actual
		// depth: a fin anchored where the profile has tapered to nothing hangs off the
		// snout or the tail tip with no body to attach to.
		for (const name of ALL) {
			for (const fin of SPECIES[name].fins) {
				expect(fin.anchor).toBeGreaterThanOrEqual(0);
				expect(fin.anchor).toBeLessThanOrEqual(1);
				expect(fin.span).toBeGreaterThan(0);

				const peak = Math.max(...SPECIES[name].profile.map(([, h]) => h));
				const atRoot = profileAt(SPECIES[name].profile, fin.anchor);

				// The caudal roots at the tail, where the body has deliberately tapered.
				if (fin.kind !== 'caudal') {
					expect(atRoot).toBeGreaterThan(peak * 0.25);
				}
			}
		}
	});

	it('gives every species a caudal fin', () => {
		for (const name of ALL) {
			const kinds = SPECIES[name].fins.map((f) => f.kind);
			expect(kinds).toContain('caudal');
		}
	});

	it('gives every species a full palette', () => {
		for (const name of ALL) {
			const p = SPECIES[name].palette;
			for (const key of ['back', 'belly', 'fin', 'marking', 'iris'] as const) {
				expect(p[key]).toMatch(/^#[0-9a-f]{6}$/i);
			}
		}
	});
});

describe('treatSpeciesFor', () => {
	it('is stable for a task — the treat you are saving for looks the same tomorrow', () => {
		expect(treatSpeciesFor('treat-abc')).toBe(treatSpeciesFor('treat-abc'));
	});

	it('only ever returns a prize', () => {
		for (let i = 0; i < 200; i++) expect(TREATS).toContain(treatSpeciesFor(`t-${i}`));
	});

	it('uses every prize, so a day of treats is not a row of clones', () => {
		// The complaint that prompted this: several treats all rendered as one fish.
		const seen = new Set(Array.from({ length: 120 }, (_, i) => treatSpeciesFor(`treat-${i}`)));
		expect(seen.size).toBe(TREATS.length);
	});
});

describe('speciesFor', () => {
	it('is stable for an id', () => {
		expect(speciesFor('task-abc')).toBe(speciesFor('task-abc'));
	});

	it('uses every swimmer across a realistic tank', () => {
		const seen = new Set(Array.from({ length: 200 }, (_, i) => speciesFor(`id-${i}`)));
		expect(seen.size).toBe(SWIMMERS.length);
	});

	it('does not alias on sequential ids', () => {
		// `hash % n` with a constant id stride collapses to two species.
		const seen = new Set(Array.from({ length: 40 }, (_, i) => speciesFor(`t-${i}`)));
		expect(seen.size).toBeGreaterThan(3);
	});
});

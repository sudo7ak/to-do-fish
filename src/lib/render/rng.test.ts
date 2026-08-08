import { describe, it, expect } from 'vitest';
import { hash, mix32 } from './rng';

describe('hash', () => {
	it('is stable for the same id', () => {
		expect(hash('task-abc')).toBe(hash('task-abc'));
	});

	it('differs for different ids', () => {
		expect(hash('task-a')).not.toBe(hash('task-b'));
	});

	it('is always a non-negative 32-bit integer', () => {
		for (const id of ['', 'a', 'task-9999', 'zzzzzzzzzz']) {
			const h = hash(id);
			expect(Number.isInteger(h)).toBe(true);
			expect(h).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('mix32', () => {
	it('returns a fraction in [0, 1)', () => {
		for (let i = 0; i < 500; i++) {
			const v = mix32(i);
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(1);
		}
	});

	it('is deterministic', () => {
		expect(mix32(12345)).toBe(mix32(12345));
	});

	it('avalanches: sibling ids land far apart', () => {
		// `t-aaa` and `t-bbb` differ only in low bits. Anything derived from the raw
		// hash lands in the same bucket for all of them; mixing is what fixes it.
		const values = ['t-aaa', 't-bbb', 't-ccc', 't-ddd'].map((id) => mix32(hash(id)));
		const buckets = new Set(values.map((v) => Math.floor(v * 4)));
		expect(buckets.size).toBeGreaterThan(1);
	});

	it('spreads a run of sequential ids across the range', () => {
		const values = Array.from({ length: 60 }, (_, i) => mix32(hash(`id-${i}`)));
		const buckets = new Set(values.map((v) => Math.floor(v * 6)));
		expect(buckets.size).toBe(6);
	});
});

import { describe, it, expect } from 'vitest';
import { palette, moodWord, moodPercent, CALM, LOADED } from './palette';

describe('palette — Progress', () => {
	it('is fully loaded at the start of the day', () => {
		expect(palette('progress', 0)).toMatchObject({
			waterTop: LOADED.waterTop,
			waterBottom: LOADED.waterBottom,
			plants: LOADED.plants
		});
	});

	it('is fully calm once the day is cleared', () => {
		expect(palette('progress', 1)).toMatchObject({
			waterTop: CALM.waterTop,
			waterBottom: CALM.waterBottom,
			plants: CALM.plants
		});
	});

	it('lands between the two halfway through', () => {
		const half = palette('progress', 0.5);

		expect(half.waterTop).not.toBe(LOADED.waterTop);
		expect(half.waterTop).not.toBe(CALM.waterTop);
		expect(half.waterTop).toMatch(/^#[0-9a-f]{6}$/i);
	});

	it('clears the water monotonically as work is finished', () => {
		const brightness = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16);
		const steps = [0, 0.25, 0.5, 0.75, 1].map((pct) => brightness(palette('progress', pct).waterTop));

		expect(steps).toEqual([...steps].sort((a, b) => a - b));
	});

	it('clamps a percentage below zero', () => {
		expect(palette('progress', -1).waterTop).toBe(LOADED.waterTop);
	});

	it('clamps a percentage above one', () => {
		expect(palette('progress', 5).waterTop).toBe(CALM.waterTop);
	});
});

describe('palette — Calm', () => {
	it('holds the clear palette at the start of the day', () => {
		expect(palette('calm', 0)).toMatchObject({
			waterTop: CALM.waterTop,
			waterBottom: CALM.waterBottom,
			plants: CALM.plants
		});
	});

	it('does not change as the day progresses', () => {
		expect(palette('calm', 0)).toEqual(palette('calm', 1));
	});
});

describe('palette — fixed tokens', () => {
	it('keeps creature colours steady across both environments', () => {
		const loaded = palette('progress', 0);
		const clear = palette('calm', 1);

		expect(loaded.fish).toBe(clear.fish);
		expect(loaded.lantern).toBe(clear.lantern);
		expect(loaded.pearl).toBe(clear.pearl);
	});

	it('matches the reference palette', () => {
		const p = palette('calm', 1);

		expect(p.fish).toBe('#E8543C');
		expect(p.lantern).toBe('#FFC46B');
		expect(p.pearl).toBe('#EAF6F8');
	});
});

describe('mood', () => {
	it('reports a whole percentage', () => {
		expect(moodPercent(0.5)).toBe(50);
		expect(moodPercent(0.333)).toBe(33);
	});

	it('reads zero as untouched and one as cleared', () => {
		expect(moodPercent(0)).toBe(0);
		expect(moodPercent(1)).toBe(100);
	});

	it('gives every point on the scale a word', () => {
		for (const pct of [0, 0.1, 0.25, 0.5, 0.75, 0.99, 1]) {
			expect(moodWord(pct)).toMatch(/\S/);
		}
	});

	it('says something different when cleared than when untouched', () => {
		expect(moodWord(1)).not.toBe(moodWord(0));
	});
});

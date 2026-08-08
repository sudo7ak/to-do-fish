import { describe, it, expect } from 'vitest';
import { ENVIRONMENT_CHOICES, blurbFor } from './Settings.svelte';
import { palette, CALM } from '../render/palette';

describe('environment choices', () => {
	it('offers exactly the two environments the design settled on', () => {
		expect(ENVIRONMENT_CHOICES.map((c) => c.value)).toEqual(['progress', 'calm']);
	});

	it('describes each one without jargon', () => {
		for (const choice of ENVIRONMENT_CHOICES) {
			expect(choice.label).toMatch(/\S/);
			expect(choice.blurb.length).toBeGreaterThan(20);
		}
	});

	it('lists Progress first, matching the stored default', () => {
		expect(ENVIRONMENT_CHOICES[0].value).toBe('progress');
	});

	it('finds a blurb for either value', () => {
		expect(blurbFor('progress')).toMatch(/clears/i);
		expect(blurbFor('calm')).toMatch(/bright/i);
	});
});

describe('what the choice actually changes', () => {
	it('Calm ignores how the day is going', () => {
		expect(palette('calm', 0)).toEqual(palette('calm', 1));
	});

	it('Progress does not', () => {
		expect(palette('progress', 0)).not.toEqual(palette('progress', 1));
	});

	it('the two agree once the day is cleared', () => {
		expect(palette('progress', 1).waterTop).toBe(CALM.waterTop);
	});
});

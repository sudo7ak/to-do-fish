import { describe, it, expect } from 'vitest';
import { shouldAutoOpen, shouldShowRevealHint, showsMoodNumber } from './settings';
import type { Settings } from '../types';

const settings = (over: Partial<Settings> = {}): Settings => ({
	environment: 'progress',
	seenLegend: false,
	seenRevealHint: false,
	updatedAt: 0,
	...over
});

describe('shouldAutoOpen', () => {
	it('opens the legend for someone who has never seen it', () => {
		expect(shouldAutoOpen(settings())).toBe(true);
	});

	it('stays shut once it has been seen', () => {
		expect(shouldAutoOpen(settings({ seenLegend: true }))).toBe(false);
	});

	it('does not care which environment is chosen', () => {
		expect(shouldAutoOpen(settings({ environment: 'calm' }))).toBe(true);
		expect(shouldAutoOpen(settings({ environment: 'calm', seenLegend: true }))).toBe(false);
	});
});

describe('shouldShowRevealHint', () => {
	it('shows the hint fish for someone who has never tapped it', () => {
		expect(shouldShowRevealHint(settings())).toBe(true);
	});

	it('stays gone once it has been popped', () => {
		expect(shouldShowRevealHint(settings({ seenRevealHint: true }))).toBe(false);
	});

	it('is independent of the legend flag', () => {
		expect(shouldShowRevealHint(settings({ seenLegend: true }))).toBe(true);
	});
});

describe('showsMoodNumber is unaffected', () => {
	it('still keys off the environment alone', () => {
		expect(showsMoodNumber(settings())).toBe(true);
		expect(showsMoodNumber(settings({ environment: 'calm' }))).toBe(false);
	});
});

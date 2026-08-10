import { describe, it, expect } from 'vitest';
import { syncLine } from './sync-line';

const NOW = 1_700_000_000_000;
const minutes = (n: number) => n * 60_000;

describe('syncLine', () => {
	it('says nothing has synced yet when idle with no prior success', () => {
		expect(syncLine({ state: 'idle' }, NOW)).toBe('Not synced yet');
	});

	it('says syncing while a sync is in flight', () => {
		expect(syncLine({ state: 'syncing' }, NOW)).toBe('Syncing…');
	});

	it('reports the relative time of the last success', () => {
		expect(syncLine({ state: 'idle', at: NOW - minutes(3) }, NOW)).toBe('Synced 3 minutes ago');
	});

	it('names the trouble and the last success together on a failure with prior history', () => {
		expect(syncLine({ state: 'denied', at: NOW - minutes(20) }, NOW)).toBe(
			'Not syncing — sign in again. Last synced 20 minutes ago.'
		);
	});

	it('names the trouble alone on a failure with no prior success', () => {
		expect(syncLine({ state: 'offline' }, NOW)).toBe('Not syncing — offline');
	});
});

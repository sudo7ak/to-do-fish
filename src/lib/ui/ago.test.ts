import { describe, it, expect } from 'vitest';
import { ago } from './ago';

const NOW = 1_700_000_000_000;
const seconds = (n: number) => n * 1000;
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;

describe('ago', () => {
	it('calls anything under a minute "just now"', () => {
		expect(ago(NOW, NOW)).toBe('just now');
		expect(ago(NOW - seconds(59), NOW)).toBe('just now');
	});

	it('switches to minutes exactly on the minute', () => {
		// The boundary, because this is where relative-time code always breaks.
		expect(ago(NOW - minutes(1), NOW)).toBe('1 minute ago');
	});

	it('does not pluralise a single minute or hour', () => {
		expect(ago(NOW - minutes(1), NOW)).toBe('1 minute ago');
		expect(ago(NOW - hours(1), NOW)).toBe('1 hour ago');
	});

	it('counts whole minutes, rounding down', () => {
		expect(ago(NOW - minutes(3) - seconds(59), NOW)).toBe('3 minutes ago');
	});

	it('switches to hours exactly on the hour', () => {
		expect(ago(NOW - minutes(59), NOW)).toBe('59 minutes ago');
		expect(ago(NOW - hours(1), NOW)).toBe('1 hour ago');
	});

	it('switches to days exactly on the day', () => {
		expect(ago(NOW - hours(23), NOW)).toBe('23 hours ago');
		expect(ago(NOW - hours(24), NOW)).toBe('1 day ago');
	});

	it('treats a future timestamp as just now rather than printing a negative', () => {
		// A device whose clock is behind the server's can produce this, and
		// "-4 minutes ago" is worse than a harmless rounding to now.
		expect(ago(NOW + minutes(5), NOW)).toBe('just now');
	});
});

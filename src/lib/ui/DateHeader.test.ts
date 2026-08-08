import { describe, it, expect } from 'vitest';
import { shiftDate, formatDay, toDateString, parseDate, today } from './DateHeader.svelte';

describe('shiftDate', () => {
	it('moves forward a day', () => {
		expect(shiftDate('2026-08-08', 1)).toBe('2026-08-09');
	});

	it('moves back a day', () => {
		expect(shiftDate('2026-08-08', -1)).toBe('2026-08-07');
	});

	it('rolls over the end of a month', () => {
		expect(shiftDate('2026-08-31', 1)).toBe('2026-09-01');
	});

	it('rolls back over the start of a month', () => {
		expect(shiftDate('2026-09-01', -1)).toBe('2026-08-31');
	});

	it('rolls over the end of a year', () => {
		expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
	});

	it('handles a leap day', () => {
		expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29');
		expect(shiftDate('2028-02-29', 1)).toBe('2028-03-01');
	});

	it('skips 29 February in a common year', () => {
		expect(shiftDate('2026-02-28', 1)).toBe('2026-03-01');
	});

	it('crosses a spring DST boundary without losing a day', () => {
		// The day the clocks go forward is 23 hours long; millisecond arithmetic
		// would land on the wrong date here.
		expect(shiftDate('2026-03-28', 1)).toBe('2026-03-29');
		expect(shiftDate('2026-03-29', 1)).toBe('2026-03-30');
	});

	it('crosses an autumn DST boundary without repeating a day', () => {
		expect(shiftDate('2026-10-24', 1)).toBe('2026-10-25');
		expect(shiftDate('2026-10-25', 1)).toBe('2026-10-26');
	});

	it('moves several days at once', () => {
		expect(shiftDate('2026-08-08', 7)).toBe('2026-08-15');
		expect(shiftDate('2026-08-08', -30)).toBe('2026-07-09');
	});

	it('is its own inverse', () => {
		for (const date of ['2026-01-01', '2026-03-29', '2026-10-25', '2028-02-29']) {
			expect(shiftDate(shiftDate(date, 1), -1)).toBe(date);
		}
	});
});

describe('toDateString', () => {
	it('zero-pads month and day', () => {
		expect(toDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
	});

	it('round-trips through parseDate', () => {
		expect(toDateString(parseDate('2026-08-08'))).toBe('2026-08-08');
	});

	it('uses local time, not UTC — a late evening does not become tomorrow', () => {
		expect(toDateString(new Date(2026, 7, 8, 23, 30))).toBe('2026-08-08');
	});
});

describe('formatDay', () => {
	const now = '2026-08-08';

	it('names today', () => {
		expect(formatDay(now, now)).toBe('Today');
	});

	it('names yesterday and tomorrow', () => {
		expect(formatDay('2026-08-07', now)).toBe('Yesterday');
		expect(formatDay('2026-08-09', now)).toBe('Tomorrow');
	});

	it('spells out any other date', () => {
		const label = formatDay('2026-08-20', now);
		expect(label).not.toBe('Today');
		expect(label).toMatch(/\d/);
	});

	it('includes the year when it is not the current one', () => {
		expect(formatDay('2027-08-20', now)).toMatch(/2027/);
	});

	it('leaves the year off within the current one', () => {
		expect(formatDay('2026-08-20', now)).not.toMatch(/2026/);
	});
});

describe('today', () => {
	it('formats the given instant as a local date string', () => {
		expect(today(new Date(2026, 7, 8, 9, 0))).toBe('2026-08-08');
	});
});

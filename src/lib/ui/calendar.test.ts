import { describe, it, expect } from 'vitest';
import { monthGrid, shiftMonth, monthLabel, taskDatesOf, koiDatesOf } from './calendar';
import { parseDate } from './DateHeader.svelte';
import type { Task, KoiRecord } from '../types';

const task = (over: Partial<Task> = {}): Task => ({
	id: 't',
	title: 'Task',
	date: '2026-08-08',
	status: 'open',
	createdAt: 0,
	updatedAt: 0,
	...over
});

describe('monthGrid', () => {
	it('always returns six full weeks', () => {
		expect(monthGrid('2026-08-08')).toHaveLength(42);
	});

	it('starts the grid on a Sunday', () => {
		const grid = monthGrid('2026-08-08');
		expect(parseDate(grid[0]).getDay()).toBe(0);
	});

	it('contains every day of the target month exactly once', () => {
		const grid = monthGrid('2026-08-08');
		const augustDays = grid.filter((d) => d.startsWith('2026-08-'));
		expect(augustDays).toHaveLength(31);
		expect(new Set(augustDays).size).toBe(31);
	});

	it('does not depend on which day of the month it is asked from', () => {
		expect(monthGrid('2026-08-01')).toEqual(monthGrid('2026-08-31'));
	});

	it('leads with the trailing days of the previous month', () => {
		// August 2026 starts on a Saturday, so the grid opens with six days of July.
		const grid = monthGrid('2026-08-08');
		expect(grid[0]).toBe('2026-07-26');
	});
});

describe('shiftMonth', () => {
	it('moves forward a month', () => {
		expect(shiftMonth('2026-08-08', 1)).toBe('2026-09-01');
	});

	it('moves back a month', () => {
		expect(shiftMonth('2026-08-08', -1)).toBe('2026-07-01');
	});

	it('rolls over a year boundary', () => {
		expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-01');
		expect(shiftMonth('2026-01-15', -1)).toBe('2025-12-01');
	});

	it('normalises to the first of the month regardless of the input day', () => {
		expect(shiftMonth('2026-08-31', 0)).toBe('2026-08-01');
	});
});

describe('monthLabel', () => {
	it('names the month and year', () => {
		const label = monthLabel('2026-08-08');
		expect(label).toMatch(/2026/);
		expect(label).toMatch(/august/i);
	});
});

describe('taskDatesOf', () => {
	it('collects the dates of live tasks', () => {
		const dates = taskDatesOf([task({ date: '2026-08-08' }), task({ date: '2026-08-09' })]);
		expect(dates).toEqual(new Set(['2026-08-08', '2026-08-09']));
	});

	it('excludes soft-deleted tasks', () => {
		const dates = taskDatesOf([task({ date: '2026-08-08', deletedAt: 1 })]);
		expect(dates.has('2026-08-08')).toBe(false);
	});

	it('treats deletedAt: 0 as deleted, matching isLive', () => {
		// The one weird case the domain type calls out by name: presence, not
		// truthiness, is what marks a row deleted.
		const dates = taskDatesOf([task({ date: '2026-08-08', deletedAt: 0 })]);
		expect(dates.has('2026-08-08')).toBe(false);
	});

	it('a day with only a soft-deleted task has no marker at all', () => {
		const dates = taskDatesOf([task({ id: 'a', date: '2026-08-08', deletedAt: 1 })]);
		expect(dates.size).toBe(0);
	});
});

describe('koiDatesOf', () => {
	it('collects koi record dates', () => {
		const koi: KoiRecord[] = [
			{ date: '2026-08-01', earnedAt: 1 },
			{ date: '2026-08-05', earnedAt: 2 }
		];
		expect(koiDatesOf(koi)).toEqual(new Set(['2026-08-01', '2026-08-05']));
	});

	it('returns an empty set for no koi', () => {
		expect(koiDatesOf([])).toEqual(new Set());
	});
});

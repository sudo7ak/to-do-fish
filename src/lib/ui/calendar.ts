import { parseDate, toDateString } from './DateHeader.svelte';
import { isLive, type Task, type KoiRecord } from '../types';

/**
 * Pure calendar-sheet logic: which dates fill a month's grid, moving between
 * months, and which dates get a marker. Kept out of `Calendar.svelte` so it can be
 * tested without rendering anything — the sheet itself is verified by eye, same as
 * every other sheet in this app.
 */

/**
 * Always six full weeks (42 days), Sunday first, regardless of which day of the
 * given month is passed in. A fixed 42 keeps the grid the same height across every
 * month rather than jumping between five and six rows.
 */
export function monthGrid(date: string): string[] {
	const d = parseDate(date);
	const first = new Date(d.getFullYear(), d.getMonth(), 1);
	const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - first.getDay());

	return Array.from({ length: 42 }, (_, i) =>
		toDateString(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
	);
}

/** Moves by whole calendar months, landing on the 1st — the grid only cares which month. */
export function shiftMonth(date: string, months: number): string {
	const d = parseDate(date);
	return toDateString(new Date(d.getFullYear(), d.getMonth() + months, 1));
}

export function monthLabel(date: string): string {
	return parseDate(date).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/** Dates carrying at least one live (non-deleted) task — see `isLive` for why presence, not truthiness. */
export function taskDatesOf(tasks: Task[]): Set<string> {
	return new Set(tasks.filter(isLive).map((t) => t.date));
}

/** Dates that earned a koi — a cleared day. */
export function koiDatesOf(koi: KoiRecord[]): Set<string> {
	return new Set(koi.map((k) => k.date));
}

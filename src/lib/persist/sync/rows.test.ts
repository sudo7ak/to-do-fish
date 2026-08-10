import { describe, it, expect } from 'vitest';
import {
	toTaskRow,
	fromTaskRow,
	toKoiRow,
	fromKoiRow,
	toSettingsRow,
	fromSettingsRow
} from './rows';
import { SCHEMA_VERSION, isLive, type Task } from '../../types';

const USER = '00000000-0000-0000-0000-000000000001';

const task = (over: Partial<Task> = {}): Task => ({
	id: '01J0000000000000000000000A',
	title: 'Call mum',
	date: '2026-08-10',
	status: 'open',
	createdAt: 1,
	updatedAt: 2,
	...over
});

describe('task rows', () => {
	it('round-trips a plain task unchanged', () => {
		const original = task();
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('round-trips a timed condition through jsonb', () => {
		const original = task({ condition: { kind: 'time', at: '18:00' }, status: 'waiting' });
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('round-trips a dependency condition, cutoff and all', () => {
		const original = task({
			condition: { kind: 'task', taskId: 'other', before: '17:00' },
			status: 'waiting'
		});
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('round-trips a treat', () => {
		const original = task({ treatCost: 3, status: 'waiting' });
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('round-trips a completed task', () => {
		const original = task({ status: 'done', completedAt: 500 });
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('round-trips a tombstone', () => {
		const original = task({ deletedAt: 900 });
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('brings absent optionals back absent, never null', () => {
		// `isLive` tests for the field's presence, so `deletedAt: null` would read as a
		// live task while still being a tombstone in the database.
		const restored = fromTaskRow(toTaskRow(task(), USER));

		expect('deletedAt' in restored).toBe(false);
		expect('completedAt' in restored).toBe(false);
		expect('condition' in restored).toBe(false);
		expect('treatCost' in restored).toBe(false);
		expect(isLive(restored)).toBe(true);
	});

	it('reads a null column from the database back as absent', () => {
		// Postgres returns null for an unset column; the domain says undefined.
		const row = { ...toTaskRow(task(), USER), deleted_at: null, condition: null };

		expect('deletedAt' in fromTaskRow(row)).toBe(false);
		expect('condition' in fromTaskRow(row)).toBe(false);
	});

	it('keeps deletedAt: 0 as a deletion', () => {
		// Zero is a valid epoch and must not be mistaken for absent anywhere in the
		// mapping. This is the same trap `isLive` exists to avoid.
		const restored = fromTaskRow(toTaskRow(task({ deletedAt: 0 }), USER));

		expect(restored.deletedAt).toBe(0);
		expect(isLive(restored)).toBe(false);
	});

	it('stamps the user on the row', () => {
		expect(toTaskRow(task(), USER).user_id).toBe(USER);
	});
});

describe('koi rows', () => {
	it('round-trips a koi record', () => {
		const original = { date: '2026-08-09', earnedAt: 42 };
		expect(fromKoiRow(toKoiRow(original, USER))).toEqual(original);
	});
});

describe('settings rows', () => {
	it('round-trips settings', () => {
		const original = { environment: 'calm' as const, seenLegend: true, updatedAt: 7 };
		expect(fromSettingsRow(toSettingsRow(original, USER, SCHEMA_VERSION))).toEqual(original);
	});

	it('carries the writing client schema version', () => {
		const row = toSettingsRow(
			{ environment: 'calm', seenLegend: true, updatedAt: 7 },
			USER,
			SCHEMA_VERSION
		);

		expect(row.version).toBe(SCHEMA_VERSION);
	});
});

describe('task rows — the conditions with no test until now', () => {
	it('round-trips a free-text condition', () => {
		// `condition` is the one column whose mapping is not provably total: it is a
		// jsonb blob of a union, so a kind with no round-trip test is a kind that has
		// never been proved to survive the database.
		const original = task({ condition: { kind: 'text', text: 'when it stops raining' }, status: 'waiting' });
		expect(fromTaskRow(toTaskRow(original, USER))).toEqual(original);
	});

	it('round-trips a dependency condition with no cutoff, leaving `before` absent', () => {
		const original = task({ condition: { kind: 'task', taskId: 'other' }, status: 'waiting' });
		const restored = fromTaskRow(toTaskRow(original, USER));

		expect(restored).toEqual(original);
		expect('before' in (restored.condition as object)).toBe(false);
	});
});

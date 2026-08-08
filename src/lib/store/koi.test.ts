import { describe, it, expect } from 'vitest';
import { isDayCleared, awardKoi } from './koi';
import type { KoiRecord, Task } from '../types';

const DAY = '2026-08-08';

function task(over: Partial<Task> = {}): Task {
	return {
		id: 't',
		title: 'Task',
		date: DAY,
		status: 'open',
		createdAt: 0,
		updatedAt: 0,
		...over
	};
}

const done = (id: string, over: Partial<Task> = {}) => task({ id, status: 'done', ...over });

describe('isDayCleared', () => {
	it('is false for a day with no tasks at all — nothing happened, nothing was cleared', () => {
		expect(isDayCleared([], DAY)).toBe(false);
	});

	it('is true when the only task is done', () => {
		expect(isDayCleared([done('a')], DAY)).toBe(true);
	});

	it('is true when every task is done', () => {
		expect(isDayCleared([done('a'), done('b'), done('c')], DAY)).toBe(true);
	});

	it('is false while any task is still open', () => {
		expect(isDayCleared([done('a'), task({ id: 'b' })], DAY)).toBe(false);
	});

	it('ignores tasks belonging to other dates', () => {
		const tasks = [done('a'), task({ id: 'tomorrow', date: '2026-08-09' })];
		expect(isDayCleared(tasks, DAY)).toBe(true);
	});

	it('is not blocked by an unclaimed treat — a treat you chose not to buy is not unfinished work', () => {
		const tasks = [done('a'), task({ id: 'gaming', treatCost: 5, status: 'waiting' })];
		expect(isDayCleared(tasks, DAY)).toBe(true);
	});

	it('is not blocked by a claimed but unfinished treat either', () => {
		const tasks = [done('a'), task({ id: 'gaming', treatCost: 5, status: 'open' })];
		expect(isDayCleared(tasks, DAY)).toBe(true);
	});

	it('is false for a day holding only treats — a treat alone is not a cleared day', () => {
		expect(isDayCleared([task({ id: 'gaming', treatCost: 5, status: 'done' })], DAY)).toBe(false);
	});

	it('is blocked by an unreleased free-text bubble — that is genuinely still open', () => {
		const bubble = task({
			id: 'maybe',
			status: 'waiting',
			condition: { kind: 'text', text: 'if I feel rested' }
		});
		expect(isDayCleared([done('a'), bubble], DAY)).toBe(false);
	});

	it('is blocked by a waiting timed bubble', () => {
		const bubble = task({ id: 'later', status: 'waiting', condition: { kind: 'time', at: '18:00' } });
		expect(isDayCleared([done('a'), bubble], DAY)).toBe(false);
	});

	it('ignores soft-deleted tasks when judging the day', () => {
		const tasks = [done('a'), task({ id: 'b', deletedAt: 1 })];
		expect(isDayCleared(tasks, DAY)).toBe(true);
	});

	it('is false when every remaining task on the day is deleted', () => {
		expect(isDayCleared([done('a', { deletedAt: 1 })], DAY)).toBe(false);
	});
});

describe('awardKoi', () => {
	it('awards a koi for a cleared day', () => {
		const koi = awardKoi([], [done('a')], DAY, 1000);
		expect(koi).toEqual([{ date: DAY, earnedAt: 1000 }]);
	});

	it('awards nothing for a day that is not cleared', () => {
		expect(awardKoi([], [task({ id: 'a' })], DAY, 1000)).toEqual([]);
	});

	it('is idempotent — a day already recorded is not recorded twice', () => {
		const existing: KoiRecord[] = [{ date: DAY, earnedAt: 500 }];
		expect(awardKoi(existing, [done('a')], DAY, 1000)).toEqual(existing);
	});

	it('keeps the original earnedAt on a repeat call', () => {
		const existing: KoiRecord[] = [{ date: DAY, earnedAt: 500 }];
		expect(awardKoi(existing, [done('a')], DAY, 9999)[0].earnedAt).toBe(500);
	});

	it('never revokes a koi when the day stops being cleared', () => {
		// Adding a task to an already-cleared past day does not take the koi back.
		const existing: KoiRecord[] = [{ date: DAY, earnedAt: 500 }];
		const nowUnfinished = [done('a'), task({ id: 'late-addition' })];
		expect(awardKoi(existing, nowUnfinished, DAY, 1000)).toEqual(existing);
	});

	it('keeps koi earned on other dates untouched', () => {
		const existing: KoiRecord[] = [{ date: '2026-08-07', earnedAt: 1 }];
		const koi = awardKoi(existing, [done('a')], DAY, 1000);
		expect(koi).toEqual([{ date: '2026-08-07', earnedAt: 1 }, { date: DAY, earnedAt: 1000 }]);
	});

	it('does not mutate the array it was given', () => {
		const existing: KoiRecord[] = [];
		awardKoi(existing, [done('a')], DAY, 1000);
		expect(existing).toEqual([]);
	});
});

import { describe, it, expect } from 'vitest';
import { groupTasks, describeSelection, pearlsAtStake } from './ListView.svelte';
import type { Task } from '../types';

const DAY = '2026-08-08';

const task = (over: Partial<Task> = {}): Task => ({
	id: 'a',
	title: 'Task',
	date: DAY,
	status: 'open',
	createdAt: 0,
	updatedAt: 0,
	...over
});

const keys = (tasks: Task[]) => groupTasks(tasks, DAY).map((g) => g.key);
const group = (tasks: Task[], key: string) => groupTasks(tasks, DAY).find((g) => g.key === key);

describe('groupTasks — what appears', () => {
	it('shows nothing for an empty day', () => {
		expect(groupTasks([], DAY)).toEqual([]);
	});

	it('omits empty groups rather than showing bare headings', () => {
		expect(keys([task({ id: 'a' })])).toEqual(['open']);
	});

	it('separates swimming, waiting, treats and done', () => {
		const tasks = [
			task({ id: 'open' }),
			task({ id: 'waiting', status: 'waiting', condition: { kind: 'time', at: '18:00' } }),
			task({ id: 'treat', treatCost: 5, status: 'waiting' }),
			task({ id: 'done', status: 'done' })
		];

		expect(keys(tasks)).toEqual(['open', 'waiting', 'treats', 'done']);
	});

	it('excludes soft-deleted tasks', () => {
		expect(groupTasks([task({ id: 'gone', deletedAt: 1 })], DAY)).toEqual([]);
	});

	it('excludes other dates', () => {
		expect(groupTasks([task({ id: 'x', date: '2026-08-09' })], DAY)).toEqual([]);
	});

	it('files a claimed treat as swimming, not as a guilty pleasure', () => {
		const claimed = task({ id: 'claimed', treatCost: 5, status: 'open' });

		expect(group([claimed], 'open')?.tasks).toHaveLength(1);
		expect(group([claimed], 'treats')).toBeUndefined();
	});

	it('files a completed treat under done', () => {
		const finished = task({ id: 'x', treatCost: 5, status: 'done' });

		expect(group([finished], 'done')?.tasks).toHaveLength(1);
	});

	it('keeps a waiting free-text bubble in waiting', () => {
		const bubble = task({ id: 'x', status: 'waiting', condition: { kind: 'text', text: 'later' } });

		expect(group([bubble], 'waiting')?.tasks).toHaveLength(1);
	});
});

describe('groupTasks — ordering', () => {
	it('orders open tasks by creation', () => {
		const tasks = [
			task({ id: 'second', createdAt: 200 }),
			task({ id: 'first', createdAt: 100 }),
			task({ id: 'third', createdAt: 300 })
		];

		expect(group(tasks, 'open')?.tasks.map((t) => t.id)).toEqual(['first', 'second', 'third']);
	});

	it('breaks a creation tie on id, so the order never wobbles between renders', () => {
		const tasks = [task({ id: 'b', createdAt: 1 }), task({ id: 'a', createdAt: 1 })];

		expect(group(tasks, 'open')?.tasks.map((t) => t.id)).toEqual(['a', 'b']);
	});

	it('orders done tasks most recently finished first', () => {
		const tasks = [
			task({ id: 'early', status: 'done', completedAt: 100 }),
			task({ id: 'late', status: 'done', completedAt: 300 }),
			task({ id: 'middle', status: 'done', completedAt: 200 })
		];

		expect(group(tasks, 'done')?.tasks.map((t) => t.id)).toEqual(['late', 'middle', 'early']);
	});

	it('does not mutate the array it was given', () => {
		const tasks = [task({ id: 'b', createdAt: 2 }), task({ id: 'a', createdAt: 1 })];
		const before = tasks.map((t) => t.id);

		groupTasks(tasks, DAY);

		expect(tasks.map((t) => t.id)).toEqual(before);
	});
});

describe('describeSelection', () => {
	it('reports an empty selection', () => {
		expect(describeSelection(0)).toBe('Nothing selected');
	});

	it('uses the singular for one', () => {
		expect(describeSelection(1)).toBe('1 task selected');
	});

	it('uses the plural for more', () => {
		expect(describeSelection(4)).toBe('4 tasks selected');
	});
});

describe('pearlsAtStake', () => {
	it('counts a selected done non-treat task', () => {
		const tasks = [task({ id: 'a', status: 'done' })];
		expect(pearlsAtStake(tasks, ['a'])).toBe(1);
	});

	it('ignores tasks not in the selection', () => {
		const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'done' })];
		expect(pearlsAtStake(tasks, ['a'])).toBe(1);
	});

	it('ignores a selected open task — nothing earned yet', () => {
		const tasks = [task({ id: 'a', status: 'open' })];
		expect(pearlsAtStake(tasks, ['a'])).toBe(0);
	});

	it('ignores a completed treat — its cost was spent, not earned', () => {
		const tasks = [task({ id: 'a', status: 'done', treatCost: 5 })];
		expect(pearlsAtStake(tasks, ['a'])).toBe(0);
	});

	it('sums across a multi-task selection', () => {
		const tasks = [
			task({ id: 'a', status: 'done' }),
			task({ id: 'b', status: 'done' }),
			task({ id: 'c', status: 'open' })
		];
		expect(pearlsAtStake(tasks, ['a', 'b', 'c'])).toBe(2);
	});
});

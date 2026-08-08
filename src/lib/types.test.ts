import { describe, it, expect } from 'vitest';
import { isLive, type Task } from './types';

function task(over: Partial<Task> = {}): Task {
	return {
		id: '01J000000000000000000000',
		title: 'Call mum',
		date: '2026-08-08',
		status: 'open',
		createdAt: 0,
		updatedAt: 0,
		...over
	};
}

describe('isLive', () => {
	it('is true for a task with no deletedAt', () => {
		expect(isLive(task())).toBe(true);
	});

	it('is false for a soft-deleted task', () => {
		expect(isLive(task({ deletedAt: 1_700_000_000_000 }))).toBe(false);
	});

	it('treats a deletedAt of 0 as deleted', () => {
		// Epoch 0 is falsy; a truthiness check here would resurrect the task.
		expect(isLive(task({ deletedAt: 0 }))).toBe(false);
	});

	it('filters a mixed array down to live tasks only', () => {
		const tasks = [task({ id: 'a' }), task({ id: 'b', deletedAt: 1 }), task({ id: 'c' })];
		expect(tasks.filter(isLive).map((t) => t.id)).toEqual(['a', 'c']);
	});
});

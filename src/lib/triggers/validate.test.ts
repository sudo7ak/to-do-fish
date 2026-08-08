import { describe, it, expect } from 'vitest';
import { validateCondition, isOrphaned } from './validate';
import type { Condition, Task } from '../types';

function task(id: string, condition?: Condition, over: Partial<Task> = {}): Task {
	return {
		id,
		title: id,
		date: '2026-08-08',
		status: 'waiting',
		createdAt: 0,
		updatedAt: 0,
		...(condition ? { condition } : {}),
		...over
	};
}

const waitsOn = (taskId: string): Condition => ({ kind: 'task', taskId });

describe('validateCondition — cycles', () => {
	it('accepts a condition on an unrelated task', () => {
		const tasks = [task('a'), task('b')];
		expect(validateCondition(tasks, { id: 'a', condition: waitsOn('b') })).toEqual({ ok: true });
	});

	it('rejects a task waiting on itself', () => {
		const tasks = [task('a')];
		expect(validateCondition(tasks, { id: 'a', condition: waitsOn('a') })).toEqual({
			ok: false,
			reason: 'cycle'
		});
	});

	it('rejects a direct cycle: B waits on A while A already waits on B', () => {
		const tasks = [task('a', waitsOn('b')), task('b')];
		expect(validateCondition(tasks, { id: 'b', condition: waitsOn('a') })).toEqual({
			ok: false,
			reason: 'cycle'
		});
	});

	it('rejects a transitive cycle: C waits on B, B on A, A on C', () => {
		const tasks = [task('a', waitsOn('c')), task('b', waitsOn('a')), task('c')];
		expect(validateCondition(tasks, { id: 'c', condition: waitsOn('b') })).toEqual({
			ok: false,
			reason: 'cycle'
		});
	});

	it('accepts a long chain that never closes', () => {
		const tasks = [task('a'), task('b', waitsOn('a')), task('c', waitsOn('b')), task('d')];
		expect(validateCondition(tasks, { id: 'd', condition: waitsOn('c') })).toEqual({ ok: true });
	});

	it('accepts a new task with no id yet — nothing can point back at it', () => {
		const tasks = [task('a', waitsOn('b')), task('b')];
		expect(validateCondition(tasks, { condition: waitsOn('a') })).toEqual({ ok: true });
	});

	it('ignores a chain that runs through a deleted task', () => {
		// a -> b is severed because b is deleted, so b -> a closes no loop.
		const tasks = [task('a', waitsOn('b'), { deletedAt: 1 }), task('b')];
		expect(validateCondition(tasks, { id: 'b', condition: waitsOn('a') })).toEqual({ ok: true });
	});

	it('accepts time and free-text conditions, which cannot cycle', () => {
		const tasks = [task('a', waitsOn('b')), task('b')];
		expect(validateCondition(tasks, { id: 'b', condition: { kind: 'time', at: '18:00' } })).toEqual({
			ok: true
		});
		expect(
			validateCondition(tasks, { id: 'b', condition: { kind: 'text', text: 'if rested' } })
		).toEqual({ ok: true });
	});

	it('accepts a draft with no condition at all', () => {
		expect(validateCondition([task('a')], { id: 'a' })).toEqual({ ok: true });
	});

	it('terminates on pre-existing cyclic data rather than hanging', () => {
		// Should never occur, but a stored cycle must not spin the validator forever.
		const tasks = [task('a', waitsOn('b')), task('b', waitsOn('a')), task('c')];
		expect(validateCondition(tasks, { id: 'c', condition: waitsOn('a') })).toEqual({ ok: true });
	});
});

describe('isOrphaned', () => {
	it('is true when the target has been deleted', () => {
		const tasks = [task('dep', undefined, { deletedAt: 1 }), task('a', waitsOn('dep'))];
		expect(isOrphaned(tasks, task('a', waitsOn('dep')))).toBe(true);
	});

	it('is true when the target never existed', () => {
		expect(isOrphaned([task('a', waitsOn('nobody'))], task('a', waitsOn('nobody')))).toBe(true);
	});

	it('is false when the target is present and live', () => {
		const tasks = [task('dep'), task('a', waitsOn('dep'))];
		expect(isOrphaned(tasks, task('a', waitsOn('dep')))).toBe(false);
	});

	it('is false for time and free-text conditions, which have no target', () => {
		expect(isOrphaned([], task('a', { kind: 'time', at: '18:00' }))).toBe(false);
		expect(isOrphaned([], task('a', { kind: 'text', text: 'if rested' }))).toBe(false);
	});

	it('is false for a plain task with no condition', () => {
		expect(isOrphaned([], task('a'))).toBe(false);
	});
});

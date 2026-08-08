import { describe, it, expect } from 'vitest';
import { evaluate } from './evaluate';
import type { Task } from '../types';

const DAY = '2026-08-08';

/** Local wall-clock instant on DAY, matching how the app reads dates and times. */
function at(hh: number, mm = 0, date = DAY): number {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

function task(over: Partial<Task> = {}): Task {
	return {
		id: 't',
		title: 'Task',
		date: DAY,
		status: 'waiting',
		createdAt: 0,
		updatedAt: 0,
		...over
	};
}

describe('evaluate — time conditions', () => {
	const t = task({ id: 'call-mum', condition: { kind: 'time', at: '18:00' } });

	it('does not fire before the trigger time', () => {
		expect(evaluate([t], at(17, 59))).toEqual([]);
	});

	it('fires exactly at the trigger time', () => {
		expect(evaluate([t], at(18, 0))).toEqual(['call-mum']);
	});

	it('fires after the trigger time', () => {
		expect(evaluate([t], at(18, 1))).toEqual(['call-mum']);
	});

	it('is scoped to the task own date, not the clock alone', () => {
		const tomorrow = task({ id: 'tomorrow', date: '2026-08-09', condition: { kind: 'time', at: '18:00' } });
		// 18:00 today is still before 18:00 tomorrow.
		expect(evaluate([tomorrow], at(18, 30))).toEqual([]);
	});

	it('releases a missed trigger on wake rather than skipping it', () => {
		// Machine asleep 17:00 -> 22:00. The 18:00 task must still be released.
		expect(evaluate([t], at(22, 0))).toEqual(['call-mum']);
	});
});

describe('evaluate — task conditions', () => {
	const dep = task({ id: 'ship-pr', status: 'open' });
	const run = task({ id: 'go-run', condition: { kind: 'task', taskId: 'ship-pr' } });

	it('does not fire while the dependency is unfinished', () => {
		expect(evaluate([dep, run], at(12))).toEqual([]);
	});

	it('fires once the dependency is done', () => {
		const done = { ...dep, status: 'done' as const, completedAt: at(11) };
		expect(evaluate([done, run], at(12))).toEqual(['go-run']);
	});

	it('fires when the dependency completed before the cutoff', () => {
		const done = { ...dep, status: 'done' as const, completedAt: at(16, 30) };
		const capped = { ...run, condition: { kind: 'task' as const, taskId: 'ship-pr', before: '17:00' } };
		expect(evaluate([done, capped], at(18))).toEqual(['go-run']);
	});

	it('is permanently missed when the dependency completed after the cutoff', () => {
		const done = { ...dep, status: 'done' as const, completedAt: at(17, 30) };
		const capped = { ...run, condition: { kind: 'task' as const, taskId: 'ship-pr', before: '17:00' } };
		expect(evaluate([done, capped], at(18))).toEqual([]);
		// Still missed much later — the window does not reopen.
		expect(evaluate([done, capped], at(23, 59))).toEqual([]);
	});

	it('does not fire when the dependency is done but carries no completion time', () => {
		// Cannot prove the cutoff was met, so it must not release.
		const done = { ...dep, status: 'done' as const };
		const capped = { ...run, condition: { kind: 'task' as const, taskId: 'ship-pr', before: '17:00' } };
		expect(evaluate([done, capped], at(18))).toEqual([]);
	});
});

describe('evaluate — free-text conditions', () => {
	it('never fires, at any time', () => {
		const t = task({ id: 'feel-like-it', condition: { kind: 'text', text: 'if I feel rested' } });
		expect(evaluate([t], at(0))).toEqual([]);
		expect(evaluate([t], at(23, 59))).toEqual([]);
	});
});

describe('evaluate — soft deletes', () => {
	it('ignores a deleted waiting task', () => {
		const t = task({ id: 'gone', condition: { kind: 'time', at: '18:00' }, deletedAt: 1 });
		expect(evaluate([t], at(19))).toEqual([]);
	});

	it('does not fire when the dependency has been deleted', () => {
		// Orphaned condition degrades to manual release; it must not auto-fire.
		const dep = task({ id: 'ship-pr', status: 'done', completedAt: at(11), deletedAt: 1 });
		const run = task({ id: 'go-run', condition: { kind: 'task', taskId: 'ship-pr' } });
		expect(evaluate([dep, run], at(12))).toEqual([]);
	});

	it('does not fire when the dependency does not exist at all', () => {
		const run = task({ id: 'go-run', condition: { kind: 'task', taskId: 'nobody' } });
		expect(evaluate([run], at(12))).toEqual([]);
	});
});

describe('evaluate — what is eligible at all', () => {
	it('ignores tasks that are already open or done', () => {
		const open = task({ id: 'open', status: 'open', condition: { kind: 'time', at: '09:00' } });
		const done = task({ id: 'done', status: 'done', condition: { kind: 'time', at: '09:00' } });
		expect(evaluate([open, done], at(19))).toEqual([]);
	});

	it('ignores plain tasks with no condition', () => {
		expect(evaluate([task({ id: 'plain', status: 'open' })], at(19))).toEqual([]);
	});

	it('never releases a waiting treat — lanterns are bought with pearls, not triggered', () => {
		const treat = task({ id: 'gaming', treatCost: 5 });
		expect(evaluate([treat], at(19))).toEqual([]);
	});

	it('returns every due task, in task order', () => {
		const a = task({ id: 'a', condition: { kind: 'time', at: '08:00' } });
		const b = task({ id: 'b', condition: { kind: 'time', at: '09:00' } });
		const c = task({ id: 'c', condition: { kind: 'time', at: '23:00' } });
		expect(evaluate([a, b, c], at(12))).toEqual(['a', 'b']);
	});
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writable, get } from 'svelte/store';
import { createTicker, type TickerStore } from './ticker';
import type { Task } from '../types';

const DAY = '2026-08-08';

function at(hh: number, mm = 0): number {
	const [y, m, d] = DAY.split('-').map(Number);
	return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

function task(over: Partial<Task> = {}): Task {
	return {
		id: 'a',
		title: 'Task',
		date: DAY,
		status: 'waiting',
		createdAt: 0,
		updatedAt: 0,
		...over
	};
}

/** Records what the ticker asked to release, and applies it like the real store would. */
function fakeStore(initial: Task[]) {
	const tasks = writable(initial);
	const released: string[][] = [];

	const store: TickerStore = {
		tasks,
		async release(ids) {
			released.push(ids);
			tasks.update((current) =>
				current.map((t) => (ids.includes(t.id) ? { ...t, status: 'open' } : t))
			);
		}
	};

	return { store, released, tasks };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ticker — polling', () => {
	it('releases a task whose time has come', () => {
		const timed = task({ id: 'call-mum', condition: { kind: 'time', at: '18:00' } });
		const { store, released } = fakeStore([timed]);
		let clock = at(17, 59);

		const ticker = createTicker(store, { now: () => clock });
		ticker.start();

		vi.advanceTimersByTime(1000);
		expect(released).toEqual([]);

		clock = at(18, 0);
		vi.advanceTimersByTime(1000);
		expect(released).toEqual([['call-mum']]);

		ticker.stop();
	});

	it('does not touch the store when nothing is due', () => {
		const { store, released } = fakeStore([task({ condition: { kind: 'time', at: '18:00' } })]);
		const ticker = createTicker(store, { now: () => at(12) });
		ticker.start();

		vi.advanceTimersByTime(10_000);

		expect(released).toEqual([]);
		ticker.stop();
	});

	it('releases each due task only once', () => {
		const timed = task({ id: 'call-mum', condition: { kind: 'time', at: '18:00' } });
		const { store, released } = fakeStore([timed]);
		const ticker = createTicker(store, { now: () => at(19) });
		ticker.start();

		vi.advanceTimersByTime(5000);

		expect(released).toEqual([['call-mum']]);
		ticker.stop();
	});

	it('releases several due tasks in one batch', () => {
		const tasks = [
			task({ id: 'a', condition: { kind: 'time', at: '08:00' } }),
			task({ id: 'b', condition: { kind: 'time', at: '09:00' } })
		];
		const { store, released } = fakeStore(tasks);
		const ticker = createTicker(store, { now: () => at(12) });
		ticker.start();

		vi.advanceTimersByTime(1000);

		expect(released).toEqual([['a', 'b']]);
		ticker.stop();
	});

	it('stops polling once stopped', () => {
		const { store, released } = fakeStore([task({ condition: { kind: 'time', at: '08:00' } })]);
		const ticker = createTicker(store, { now: () => at(12) });

		ticker.start();
		ticker.stop();
		vi.advanceTimersByTime(10_000);

		expect(released).toEqual([]);
	});
});

describe('ticker — sleep and clock jumps', () => {
	it('releases a missed trigger on wake rather than skipping it', () => {
		// Asleep from 17:00 to 22:00: one tick, five hours later.
		const timed = task({ id: 'call-mum', condition: { kind: 'time', at: '18:00' } });
		const { store, released } = fakeStore([timed]);
		let clock = at(17, 0);

		const ticker = createTicker(store, { now: () => clock });
		ticker.start();
		vi.advanceTimersByTime(1000);
		expect(released).toEqual([]);

		clock = at(22, 0);
		vi.advanceTimersByTime(1000);

		expect(released).toEqual([['call-mum']]);
		ticker.stop();
	});

	it('evaluates on wake even before the next interval fires', () => {
		const timed = task({ id: 'call-mum', condition: { kind: 'time', at: '18:00' } });
		const { store, released } = fakeStore([timed]);
		let clock = at(17, 0);
		const target = new EventTarget();

		const ticker = createTicker(store, { now: () => clock, wakeTarget: target });
		ticker.start();

		clock = at(22, 0);
		target.dispatchEvent(new Event('visibilitychange'));

		expect(released).toEqual([['call-mum']]);
		ticker.stop();
	});

	it('stops listening for wakes once stopped', () => {
		const timed = task({ id: 'call-mum', condition: { kind: 'time', at: '18:00' } });
		const { store, released } = fakeStore([timed]);
		const target = new EventTarget();

		const ticker = createTicker(store, { now: () => at(22), wakeTarget: target });
		ticker.start();
		ticker.stop();

		target.dispatchEvent(new Event('visibilitychange'));

		expect(released).toEqual([]);
	});
});

describe('ticker — what it will not release', () => {
	it('never releases a free-text bubble', () => {
		const text = task({ id: 'maybe', condition: { kind: 'text', text: 'if rested' } });
		const { store, released } = fakeStore([text]);
		const ticker = createTicker(store, { now: () => at(23, 59) });
		ticker.start();

		vi.advanceTimersByTime(10_000);

		expect(released).toEqual([]);
		ticker.stop();
	});

	it('never releases a waiting treat', () => {
		const { store, released } = fakeStore([task({ id: 'gaming', treatCost: 5 })]);
		const ticker = createTicker(store, { now: () => at(23) });
		ticker.start();

		vi.advanceTimersByTime(10_000);

		expect(released).toEqual([]);
		ticker.stop();
	});

	it('ignores a soft-deleted task', () => {
		const gone = task({ id: 'gone', condition: { kind: 'time', at: '08:00' }, deletedAt: 1 });
		const { store, released } = fakeStore([gone]);
		const ticker = createTicker(store, { now: () => at(12) });
		ticker.start();

		vi.advanceTimersByTime(2000);

		expect(released).toEqual([]);
		ticker.stop();
	});
});

describe('ticker — chained releases', () => {
	it('releases a dependant on the tick after its dependency completes', () => {
		const dep = task({ id: 'ship-pr', status: 'done', completedAt: at(11) });
		const run = task({ id: 'go-run', condition: { kind: 'task', taskId: 'ship-pr' } });
		const { store, released, tasks } = fakeStore([dep, run]);
		const ticker = createTicker(store, { now: () => at(12) });
		ticker.start();

		vi.advanceTimersByTime(1000);

		expect(released).toEqual([['go-run']]);
		expect(get(tasks).find((t) => t.id === 'go-run')!.status).toBe('open');
		ticker.stop();
	});
});

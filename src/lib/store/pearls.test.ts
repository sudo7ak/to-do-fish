import { describe, it, expect } from 'vitest';
import { pearlBalance, canAfford } from './pearls';
import type { Task } from '../types';

function task(over: Partial<Task> = {}): Task {
	return {
		id: 't',
		title: 'Task',
		date: '2026-08-08',
		status: 'open',
		createdAt: 0,
		updatedAt: 0,
		...over
	};
}

const done = (id: string, over: Partial<Task> = {}) => task({ id, status: 'done', ...over });
const treat = (id: string, cost: number, over: Partial<Task> = {}) =>
	task({ id, treatCost: cost, status: 'waiting', ...over });

describe('pearlBalance — earning', () => {
	it('is zero with no tasks', () => {
		expect(pearlBalance([])).toBe(0);
	});

	it('mints one pearl per completed ordinary task', () => {
		expect(pearlBalance([done('a'), done('b'), done('c')])).toBe(3);
	});

	it('mints nothing for tasks that are open or waiting', () => {
		expect(pearlBalance([task({ id: 'a' }), task({ id: 'b', status: 'waiting' })])).toBe(0);
	});

	it('mints a pearl for a completed conditional task', () => {
		expect(pearlBalance([done('a', { condition: { kind: 'time', at: '18:00' } })])).toBe(1);
	});

	it('counts across dates — the balance is a running total, not a daily one', () => {
		expect(pearlBalance([done('a', { date: '2026-08-07' }), done('b', { date: '2026-08-08' })])).toBe(2);
	});
});

describe('pearlBalance — spending', () => {
	it('does not charge for a treat still waiting on the waterline', () => {
		expect(pearlBalance([done('a'), done('b'), treat('gaming', 5)])).toBe(2);
	});

	it('charges once a treat is claimed', () => {
		const claimed = treat('gaming', 5, { status: 'open' });
		expect(pearlBalance([done('a'), done('b'), done('c'), done('d'), done('e'), done('f'), claimed])).toBe(1);
	});

	it('mints no pearl when a claimed treat is completed — a reward already paid for does not also pay out', () => {
		const completed = treat('gaming', 5, { status: 'done', completedAt: 1 });
		const sixEarned = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => done(id));
		// 6 earned, 5 spent, and the finished treat itself adds nothing.
		expect(pearlBalance([...sixEarned, completed])).toBe(1);
	});

	it('sums multiple claims', () => {
		const earned = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => done(id));
		const claims = [treat('x', 5, { status: 'open' }), treat('y', 3, { status: 'done' })];
		expect(pearlBalance([...earned, ...claims])).toBe(2);
	});

	it('can go negative only if data says so — it never clamps silently', () => {
		// Not reachable through the UI (S9 refuses unaffordable claims), but the
		// arithmetic must report the truth rather than hide a bug behind a floor.
		expect(pearlBalance([treat('x', 5, { status: 'open' })])).toBe(-5);
	});
});

describe('pearlBalance — soft deletes', () => {
	it('a deleted completed task mints nothing', () => {
		expect(pearlBalance([done('a'), done('b', { deletedAt: 1 })])).toBe(1);
	});

	it('a deleted claimed treat costs nothing', () => {
		const claims = [treat('x', 5, { status: 'open', deletedAt: 1 })];
		expect(pearlBalance([done('a'), done('b'), ...claims])).toBe(2);
	});
});

describe('canAfford', () => {
	it('is true when the balance covers the price', () => {
		const tasks = [done('a'), done('b'), done('c'), treat('gaming', 3)];
		expect(canAfford(tasks, treat('gaming', 3))).toBe(true);
	});

	it('is true at exactly the price', () => {
		expect(canAfford([done('a'), done('b')], treat('x', 2))).toBe(true);
	});

	it('is false when the balance falls short', () => {
		expect(canAfford([done('a')], treat('x', 2))).toBe(false);
	});

	it('is false with no pearls at all', () => {
		expect(canAfford([], treat('x', 1))).toBe(false);
	});

	it('is false for a task that is not a treat — there is nothing to buy', () => {
		expect(canAfford([done('a')], task({ id: 'plain' }))).toBe(false);
	});

	it('is true for a free treat', () => {
		expect(canAfford([], treat('x', 0))).toBe(true);
	});
});

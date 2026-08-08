import { describe, it, expect } from 'vitest';
import { tapAction, actionsFor, describeCondition } from './CreatureSheet.svelte';
import type { Task } from '../types';

const task = (over: Partial<Task> = {}): Task => ({
	id: 'a',
	title: 'Call mum',
	date: '2026-08-08',
	status: 'open',
	createdAt: 0,
	updatedAt: 0,
	...over
});

const bubble = (over: Partial<Task> = {}) =>
	task({ status: 'waiting', condition: { kind: 'time', at: '18:00' }, ...over });

const freeText = () =>
	task({ status: 'waiting', condition: { kind: 'text', text: 'if I feel rested' } });

const lantern = (cost = 5) => task({ treatCost: cost, status: 'waiting' });

describe('tapAction', () => {
	it('releases a free-text bubble on the spot — the app never prompts about one', () => {
		expect(tapAction(freeText(), false)).toBe('release');
	});

	it('opens the sheet for an affordable treat rather than spending on one tap', () => {
		// Spending pearls cannot be undone anywhere in the app, and a treat drifting
		// under your thumb is easy to hit by accident.
		expect(tapAction(lantern(), true)).toBe('sheet');
	});

	it('opens the sheet for a treat that cannot be afforded, so the price is visible', () => {
		expect(tapAction(lantern(), false)).toBe('sheet');
	});

	it('opens the sheet for a timed bubble — releasing it early is a decision, not a tap', () => {
		expect(tapAction(bubble(), true)).toBe('sheet');
	});

	it('opens the sheet for a dependency bubble', () => {
		const dependent = task({ status: 'waiting', condition: { kind: 'task', taskId: 'dep' } });
		expect(tapAction(dependent, true)).toBe('sheet');
	});

	it('opens the sheet for a swimming fish', () => {
		expect(tapAction(task(), true)).toBe('sheet');
	});

	it('opens the sheet for a ghost', () => {
		expect(tapAction(task({ status: 'done' }), true)).toBe('sheet');
	});

	it('opens the sheet for a claimed treat rather than claiming it twice', () => {
		expect(tapAction(task({ treatCost: 5, status: 'open' }), true)).toBe('sheet');
	});
});

describe('actionsFor', () => {
	it('offers the everyday actions on an open task', () => {
		expect(actionsFor(task(), false)).toEqual(['complete', 'edit', 'move', 'delete']);
	});

	it('does not offer to complete something already done', () => {
		expect(actionsFor(task({ status: 'done' }), false)).not.toContain('complete');
	});

	it('still offers edit, move and delete on a ghost', () => {
		expect(actionsFor(task({ status: 'done' }), false)).toEqual(['edit', 'move', 'delete']);
	});

	it('offers release on a waiting bubble', () => {
		expect(actionsFor(bubble(), false)).toContain('release');
	});

	it('offers claim on an affordable lantern', () => {
		expect(actionsFor(lantern(), true)).toContain('claim');
	});

	it('offers no claim when the lantern cannot be afforded', () => {
		expect(actionsFor(lantern(), false)).not.toContain('claim');
	});

	it('never offers to complete an unclaimed treat — that would skip paying for it', () => {
		// Completing a waiting treat bypasses claimTreat, so the affordability guard
		// never runs and the price is still deducted: a free treat and a negative balance.
		expect(actionsFor(lantern(), true)).not.toContain('complete');
		expect(actionsFor(lantern(), false)).not.toContain('complete');
	});

	it('offers to complete a treat once it has been claimed', () => {
		const claimed = task({ treatCost: 5, status: 'open' });
		expect(actionsFor(claimed, false)).toContain('complete');
	});

	it('never offers release on a lantern — a treat is bought, not let out', () => {
		expect(actionsFor(lantern(), true)).not.toContain('release');
		expect(actionsFor(lantern(), false)).not.toContain('release');
	});

	it('always offers a way to delete', () => {
		for (const t of [task(), task({ status: 'done' }), bubble(), lantern()]) {
			expect(actionsFor(t, true)).toContain('delete');
		}
	});
});

describe('describeCondition', () => {
	it('says nothing about a plain task', () => {
		expect(describeCondition(task())).toBeNull();
	});

	it('names the time a bubble is waiting for', () => {
		expect(describeCondition(bubble())).toBe('Waiting until 18:00');
	});

	it('names a dependency', () => {
		const dependent = task({ status: 'waiting', condition: { kind: 'task', taskId: 'dep' } });
		expect(describeCondition(dependent)).toMatch(/waiting on another task/i);
	});

	it('includes a cutoff when there is one', () => {
		const capped = task({
			status: 'waiting',
			condition: { kind: 'task', taskId: 'dep', before: '17:00' }
		});
		expect(describeCondition(capped)).toMatch(/17:00/);
	});

	it('shows the free-text condition in the user own words', () => {
		expect(describeCondition(freeText())).toBe('if I feel rested');
	});

	it('prices an unclaimed treat', () => {
		expect(describeCondition(lantern(5))).toBe('Costs 5 pearls');
	});

	it('says pearl, singular, for a one-pearl treat', () => {
		expect(describeCondition(lantern(1))).toBe('Costs 1 pearl');
	});

	it('reports a claimed treat as claimed rather than priced', () => {
		expect(describeCondition(task({ treatCost: 5, status: 'open' }))).toBe('Claimed');
	});

	it('says nothing about waiting once the task is done', () => {
		// A finished task listed under Done reading "Waiting until 15:00" is a
		// contradiction on screen.
		const wasTimed = task({ status: 'done', condition: { kind: 'time', at: '15:00' } });
		const wasDependent = task({ status: 'done', condition: { kind: 'task', taskId: 'dep' } });

		expect(describeCondition(wasTimed)).toBeNull();
		expect(describeCondition(wasDependent)).toBeNull();
	});
});

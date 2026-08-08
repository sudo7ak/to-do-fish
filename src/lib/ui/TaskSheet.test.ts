import { describe, it, expect } from 'vitest';
import { emptyForm, formFor, toDraft, formError, describeRefusal } from './TaskSheet.svelte';
import type { Task } from '../types';

const DAY = '2026-08-08';

const task = (over: Partial<Task> = {}): Task => ({
	id: 'a',
	title: 'Call mum',
	date: DAY,
	status: 'open',
	createdAt: 0,
	updatedAt: 0,
	...over
});

const filled = (over: Partial<ReturnType<typeof emptyForm>> = {}) => ({
	...emptyForm(DAY),
	title: 'Call mum',
	...over
});

describe('toDraft', () => {
	it('builds a plain task', () => {
		expect(toDraft(filled())).toEqual({ title: 'Call mum', date: DAY });
	});

	it('trims the title', () => {
		expect(toDraft(filled({ title: '  Call mum  ' })).title).toBe('Call mum');
	});

	it('builds a timed condition', () => {
		expect(toDraft(filled({ kind: 'time', at: '18:00' })).condition).toEqual({
			kind: 'time',
			at: '18:00'
		});
	});

	it('builds a dependency without a cutoff', () => {
		expect(toDraft(filled({ kind: 'task', dependsOn: 'ship-pr' })).condition).toEqual({
			kind: 'task',
			taskId: 'ship-pr'
		});
	});

	it('includes the cutoff only when one was given', () => {
		const withCutoff = toDraft(filled({ kind: 'task', dependsOn: 'ship-pr', before: '17:00' }));
		expect(withCutoff.condition).toEqual({ kind: 'task', taskId: 'ship-pr', before: '17:00' });
	});

	it('omits an empty cutoff rather than storing a blank string', () => {
		const draft = toDraft(filled({ kind: 'task', dependsOn: 'ship-pr', before: '' }));
		expect(draft.condition).not.toHaveProperty('before');
	});

	it('builds a free-text condition', () => {
		expect(toDraft(filled({ kind: 'text', text: ' if rested ' })).condition).toEqual({
			kind: 'text',
			text: 'if rested'
		});
	});

	it('builds a treat with no condition — a treat is never also conditional', () => {
		const draft = toDraft(filled({ kind: 'treat', treatCost: 5 }));

		expect(draft.treatCost).toBe(5);
		expect(draft.condition).toBeUndefined();
	});

	it('rounds a fractional cost and refuses a negative one', () => {
		expect(toDraft(filled({ kind: 'treat', treatCost: 2.6 })).treatCost).toBe(3);
		expect(toDraft(filled({ kind: 'treat', treatCost: -4 })).treatCost).toBe(0);
	});
});

describe('formFor — reading a task back', () => {
	it('round-trips a plain task', () => {
		expect(toDraft(formFor(task()))).toEqual({ title: 'Call mum', date: DAY });
	});

	it('round-trips a timed condition', () => {
		const t = task({ condition: { kind: 'time', at: '09:30' } });
		expect(toDraft(formFor(t)).condition).toEqual({ kind: 'time', at: '09:30' });
	});

	it('round-trips a dependency with a cutoff', () => {
		const t = task({ condition: { kind: 'task', taskId: 'dep', before: '17:00' } });
		expect(toDraft(formFor(t)).condition).toEqual({
			kind: 'task',
			taskId: 'dep',
			before: '17:00'
		});
	});

	it('round-trips a free-text condition', () => {
		const t = task({ condition: { kind: 'text', text: 'if rested' } });
		expect(toDraft(formFor(t)).condition).toEqual({ kind: 'text', text: 'if rested' });
	});

	it('round-trips a treat', () => {
		expect(toDraft(formFor(task({ treatCost: 7 }))).treatCost).toBe(7);
	});

	it('keeps the task own date rather than today', () => {
		expect(formFor(task({ date: '2026-01-01' })).date).toBe('2026-01-01');
	});
});

describe('formError', () => {
	it('accepts a complete form', () => {
		expect(formError(filled())).toBeNull();
	});

	it('rejects an empty title', () => {
		expect(formError(filled({ title: '   ' }))).toMatch(/name/i);
	});

	it('rejects a dependency with nothing chosen', () => {
		expect(formError(filled({ kind: 'task', dependsOn: '' }))).toMatch(/waits on/i);
	});

	it('rejects an empty free-text condition', () => {
		expect(formError(filled({ kind: 'text', text: '  ' }))).toMatch(/condition/i);
	});

	it('rejects a negative treat cost', () => {
		expect(formError(filled({ kind: 'treat', treatCost: -1 }))).toMatch(/less than nothing/i);
	});

	it('accepts a free treat', () => {
		expect(formError(filled({ kind: 'treat', treatCost: 0 }))).toBeNull();
	});
});

describe('describeRefusal', () => {
	it('explains a cycle in plain words, without the word cycle', () => {
		const message = describeRefusal({ ok: false, reason: 'cycle' });

		expect(message).toMatch(/wait on each other/i);
		expect(message).not.toMatch(/cycle/i);
	});

	it('explains an unaffordable claim', () => {
		expect(describeRefusal({ ok: false, reason: 'unaffordable' })).toMatch(/pearls/i);
	});

	it('explains an already-claimed treat', () => {
		expect(describeRefusal({ ok: false, reason: 'claimed' })).toMatch(/claimed/i);
	});
});

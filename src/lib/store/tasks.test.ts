import { describe, it, expect } from 'vitest';
import { get } from 'svelte/store';
import {
	addTask,
	editTask,
	moveToDate,
	completeTask,
	softDelete,
	releaseBubble,
	claimTreat,
	setEnvironment,
	markLegendSeen,
	createTaskStore,
	type State
} from './tasks';
import { ulid } from '../ulid';
import type { Snapshot, Task } from '../types';
import { emptySnapshot } from '../persist/local';
import type { TaskStore } from '../persist/port';
import { StorageUnavailableError } from '../persist/port';

const DAY = '2026-08-08';

function state(tasks: Task[] = [], over: Partial<State> = {}): State {
	return { tasks, koi: [], settings: { environment: 'progress', seenLegend: false }, ...over };
}

function task(over: Partial<Task> = {}): Task {
	return {
		id: 'a',
		title: 'Call mum',
		date: DAY,
		status: 'open',
		createdAt: 1,
		updatedAt: 1,
		...over
	};
}

const only = (s: State) => s.tasks[0];

describe('addTask', () => {
	it('adds a plain task as an open fish', () => {
		const result = addTask(state(), { title: 'Call mum', date: DAY }, 100, 'id-1');

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(only(result.state)).toMatchObject({ id: 'id-1', title: 'Call mum', status: 'open' });
	});

	it('adds a conditional task as waiting', () => {
		const result = addTask(
			state(),
			{ title: 'Later', date: DAY, condition: { kind: 'time', at: '18:00' } },
			100,
			'id-1'
		);

		expect(result.ok && only(result.state).status).toBe('waiting');
	});

	it('adds a treat as waiting', () => {
		const result = addTask(state(), { title: '2h gaming', date: DAY, treatCost: 5 }, 100, 'id-1');

		expect(result.ok && only(result.state).status).toBe('waiting');
	});

	it('stamps createdAt and updatedAt', () => {
		const result = addTask(state(), { title: 'x', date: DAY }, 100, 'id-1');

		expect(result.ok && only(result.state)).toMatchObject({ createdAt: 100, updatedAt: 100 });
	});

	it('rejects a condition that would close a cycle', () => {
		const existing = [task({ id: 'a', condition: { kind: 'task', taskId: 'b' } }), task({ id: 'b' })];
		const result = addTask(
			state(existing),
			{ title: 'x', date: DAY, condition: { kind: 'task', taskId: 'a' } },
			100,
			'b'
		);

		expect(result).toEqual({ ok: false, reason: 'cycle' });
	});
});

describe('editTask', () => {
	it('changes the title and bumps updatedAt', () => {
		const result = editTask(state([task()]), 'a', { title: 'Call dad' }, 500);

		expect(result.ok && only(result.state)).toMatchObject({ title: 'Call dad', updatedAt: 500 });
	});

	it('leaves createdAt alone', () => {
		const result = editTask(state([task()]), 'a', { title: 'x' }, 500);

		expect(result.ok && only(result.state).createdAt).toBe(1);
	});

	it('rejects an edit that would close a cycle', () => {
		const tasks = [task({ id: 'a', condition: { kind: 'task', taskId: 'b' } }), task({ id: 'b' })];
		const result = editTask(state(tasks), 'b', { condition: { kind: 'task', taskId: 'a' } }, 500);

		expect(result).toEqual({ ok: false, reason: 'cycle' });
	});

	it('leaves other tasks untouched', () => {
		const result = editTask(state([task({ id: 'a' }), task({ id: 'b' })]), 'a', { title: 'x' }, 500);

		expect(result.ok && result.state.tasks[1].updatedAt).toBe(1);
	});
});

describe('moveToDate', () => {
	it('moves a task to another date and bumps updatedAt', () => {
		const moved = moveToDate(state([task()]), 'a', '2026-08-09', 500);

		expect(only(moved)).toMatchObject({ date: '2026-08-09', updatedAt: 500 });
	});

	it('pushes an unfinished task to tomorrow without touching its status', () => {
		const moved = moveToDate(state([task({ status: 'waiting' })]), 'a', '2026-08-09', 500);

		expect(only(moved).status).toBe('waiting');
	});
});

describe('completeTask', () => {
	it('marks the task done and stamps completedAt and updatedAt', () => {
		const done = completeTask(state([task()]), 'a', 500);

		expect(only(done)).toMatchObject({ status: 'done', completedAt: 500, updatedAt: 500 });
	});

	it('awards a koi when the day is now cleared', () => {
		const done = completeTask(state([task()]), 'a', 500);

		expect(done.koi).toEqual([{ date: DAY, earnedAt: 500 }]);
	});

	it('awards no koi while work remains on the day', () => {
		const done = completeTask(state([task({ id: 'a' }), task({ id: 'b' })]), 'a', 500);

		expect(done.koi).toEqual([]);
	});

	it('does not revoke a koi when a task is added to a cleared day afterwards', () => {
		const cleared = completeTask(state([task()]), 'a', 500);
		const added = addTask(cleared, { title: 'late', date: DAY }, 600, 'b');

		expect(added.ok && added.state.koi).toEqual([{ date: DAY, earnedAt: 500 }]);
	});
});

describe('softDelete', () => {
	it('sets deletedAt rather than removing the row', () => {
		const deleted = softDelete(state([task()]), 'a', 500);

		expect(deleted.tasks).toHaveLength(1);
		expect(only(deleted).deletedAt).toBe(500);
	});

	it('bumps updatedAt so the deletion itself can be reconciled later', () => {
		expect(only(softDelete(state([task()]), 'a', 500)).updatedAt).toBe(500);
	});
});

describe('releaseBubble', () => {
	it('moves a waiting task into the water', () => {
		const t = task({ status: 'waiting', condition: { kind: 'text', text: 'if rested' } });
		const released = releaseBubble(state([t]), 'a', 500);

		expect(only(released)).toMatchObject({ status: 'open', updatedAt: 500 });
	});

	it('leaves a task that is already open alone', () => {
		const released = releaseBubble(state([task()]), 'a', 500);

		expect(only(released).updatedAt).toBe(1);
	});
});

describe('claimTreat', () => {
	const earned = (n: number) =>
		Array.from({ length: n }, (_, i) => task({ id: `e${i}`, status: 'done' }));
	const treat = task({ id: 'gaming', treatCost: 5, status: 'waiting' });

	it('claims an affordable treat, moving the lantern into the water', () => {
		const result = claimTreat(state([...earned(5), treat]), 'gaming', 500);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.state.tasks.find((t) => t.id === 'gaming')).toMatchObject({
			status: 'open',
			updatedAt: 500
		});
	});

	it('refuses a treat the balance cannot afford', () => {
		const result = claimTreat(state([...earned(4), treat]), 'gaming', 500);

		expect(result).toEqual({ ok: false, reason: 'unaffordable' });
	});

	it('refuses to claim the same treat twice — the cost is already spent', () => {
		const claimed = claimTreat(state([...earned(5), treat]), 'gaming', 500);
		expect(claimed.ok).toBe(true);
		if (!claimed.ok) return;

		// The balance is now 0, but the guard that matters is the status, not the sum.
		expect(claimTreat(claimed.state, 'gaming', 600)).toEqual({ ok: false, reason: 'claimed' });
	});

	it('refuses a task that is not a treat', () => {
		expect(claimTreat(state([task()]), 'a', 500)).toEqual({ ok: false, reason: 'claimed' });
	});
});

describe('setEnvironment', () => {
	it('switches the environment', () => {
		expect(setEnvironment(state(), 'calm').settings.environment).toBe('calm');
	});
});

describe('ulid', () => {
	it('generates 26-character ids', () => {
		expect(ulid()).toHaveLength(26);
	});

	it('generates unique ids within the same millisecond', () => {
		const ids = Array.from({ length: 500 }, () => ulid(1_700_000_000_000));
		expect(new Set(ids).size).toBe(500);
	});

	it('sorts lexicographically in creation order', () => {
		const early = ulid(1_700_000_000_000);
		const late = ulid(1_700_000_001_000);
		expect([late, early].sort()).toEqual([early, late]);
	});

	it('stays ordered within a single millisecond', () => {
		const first = ulid(1_700_000_000_000);
		const second = ulid(1_700_000_000_000);
		expect(second > first).toBe(true);
	});
});

describe('createTaskStore', () => {
	class FakeStore implements TaskStore {
		saved: Snapshot[] = [];
		constructor(private initial: Snapshot = emptySnapshot()) {}
		async load() {
			return this.initial;
		}
		async save(snapshot: Snapshot) {
			this.saved.push(snapshot);
		}
	}

	class FailingStore extends FakeStore {
		async save(): Promise<void> {
			throw new StorageUnavailableError('nope');
		}
	}

	it('hydrates from the persistence port', async () => {
		const initial = { ...emptySnapshot(), tasks: [task()] };
		const store = createTaskStore(new FakeStore(initial));

		await store.hydrate();

		expect(get(store.tasks)).toEqual([task()]);
	});

	it('persists after a mutation', async () => {
		const port = new FakeStore();
		const store = createTaskStore(port);
		await store.hydrate();

		await store.addTask({ title: 'x', date: DAY });

		expect(port.saved.at(-1)!.tasks).toHaveLength(1);
	});

	it('raises the save-failed flag when persistence rejects', async () => {
		const store = createTaskStore(new FailingStore());
		await store.hydrate();

		await store.addTask({ title: 'x', date: DAY });

		expect(get(store.saveFailed)).toBe(true);
	});

	it('keeps the change in memory even when the save fails', async () => {
		const store = createTaskStore(new FailingStore());
		await store.hydrate();

		await store.addTask({ title: 'x', date: DAY });

		expect(get(store.tasks)).toHaveLength(1);
	});

	it('reports a refused claim without persisting', async () => {
		const port = new FakeStore();
		const store = createTaskStore(port);
		await store.hydrate();
		await store.addTask({ title: 'treat', date: DAY, treatCost: 99 });
		const savesBefore = port.saved.length;

		const result = await store.claimTreat(get(store.tasks)[0].id);

		expect(result).toEqual({ ok: false, reason: 'unaffordable' });
		expect(port.saved).toHaveLength(savesBefore);
	});
});

describe('markLegendSeen', () => {
	it('latches the flag on', () => {
		const state = {
			tasks: [],
			koi: [],
			settings: { environment: 'progress' as const, seenLegend: false }
		};

		expect(markLegendSeen(state).settings.seenLegend).toBe(true);
	});

	it('is idempotent — showing the legend twice is not an error', () => {
		const state = {
			tasks: [],
			koi: [],
			settings: { environment: 'calm' as const, seenLegend: true }
		};

		expect(markLegendSeen(state)).toEqual(state);
	});

	it('leaves the environment alone', () => {
		const state = {
			tasks: [],
			koi: [],
			settings: { environment: 'calm' as const, seenLegend: false }
		};

		expect(markLegendSeen(state).settings.environment).toBe('calm');
	});
});

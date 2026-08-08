import { describe, it, expect } from 'vitest';
import { buildScene, MAX_VISIBLE_LANTERNS } from './build';
import type { CreatureKind } from './types';
import type { KoiRecord, Task } from '../types';

const DAY = '2026-08-08';

function at(hh: number, mm = 0, date = DAY): number {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

const NOON = at(12);

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

const kinds = (tasks: Task[], koi: KoiRecord[] = [], now = NOON): CreatureKind[] =>
	buildScene(tasks, koi, DAY, now).creatures.map((c) => c.kind);

const countOf = (tasks: Task[], kind: CreatureKind, koi: KoiRecord[] = [], now = NOON): number =>
	kinds(tasks, koi, now).filter((k) => k === kind).length;

const find = (tasks: Task[], id: string, now = NOON) =>
	buildScene(tasks, [], DAY, now).creatures.find((c) => c.taskId === id);

describe('buildScene — creature kinds', () => {
	it('an empty day builds an empty tank', () => {
		expect(buildScene([], [], DAY, NOON).creatures).toEqual([]);
	});

	it('an open plain task is a fish', () => {
		expect(countOf([task({ id: 'a' })], 'fish')).toBe(1);
	});

	it('a waiting conditional task is a bubble', () => {
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'time', at: '18:00' } });
		expect(countOf([t], 'bubble')).toBe(1);
	});

	it('a done task is a ghost', () => {
		expect(countOf([task({ id: 'a', status: 'done' })], 'ghost')).toBe(1);
	});

	it('a waiting treat is a lantern', () => {
		expect(countOf([task({ id: 'a', treatCost: 3, status: 'waiting' })], 'lantern')).toBe(1);
	});

	it('a claimed treat is a fish, not a lantern — paying moves it into the water', () => {
		const claimed = task({ id: 'a', treatCost: 3, status: 'open' });
		expect(kinds([claimed])).toContain('fish');
		expect(kinds([claimed])).not.toContain('lantern');
	});

	it('a completed treat is a ghost', () => {
		expect(countOf([task({ id: 'a', treatCost: 3, status: 'done' })], 'ghost')).toBe(1);
	});

	it('shows only the given date', () => {
		const tasks = [task({ id: 'today' }), task({ id: 'tomorrow', date: '2026-08-09' })];
		expect(buildScene(tasks, [], DAY, NOON).creatures.filter((c) => c.taskId)).toHaveLength(1);
	});

	it('a soft-deleted task produces no creature', () => {
		expect(buildScene([task({ id: 'a', deletedAt: 1 })], [], DAY, NOON).creatures).toEqual([]);
	});
});

describe('buildScene — bubble treatment', () => {
	it('an auto-triggered bubble is a clean sphere', () => {
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'time', at: '18:00' } });
		expect(find([t], 'a')?.dashed).toBeFalsy();
	});

	it('a free-text bubble is dashed', () => {
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'text', text: 'if rested' } });
		expect(find([t], 'a')?.dashed).toBe(true);
	});

	it('a bubble whose trigger target is gone is dashed', () => {
		const dep = task({ id: 'dep', status: 'done', deletedAt: 1 });
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'task', taskId: 'dep' } });
		expect(find([dep, t], 'a')?.dashed).toBe(true);
	});

	it('a bubble with a live trigger target is not dashed', () => {
		const dep = task({ id: 'dep' });
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'task', taskId: 'dep' } });
		expect(find([dep, t], 'a')?.dashed).toBeFalsy();
	});
});

describe('buildScene — resting depth encodes imminence', () => {
	const waiting = (atTime: string) =>
		task({ id: 'a', status: 'waiting', condition: { kind: 'time', at: atTime } });

	it('floats a bubble firing within the hour at eye level', () => {
		expect(find([waiting('12:30')], 'a')!.depth).toBeCloseTo(0.2, 1);
	});

	it('rests a bubble a week out down in the plants', () => {
		const nextWeek = task({
			id: 'a',
			status: 'waiting',
			date: '2026-08-15',
			condition: { kind: 'time', at: '12:00' }
		});
		expect(buildScene([nextWeek], [], '2026-08-15', NOON).creatures[0].depth).toBeCloseTo(0.8, 1);
	});

	it('puts a mid-range bubble between the two', () => {
		const depth = find([waiting('20:00')], 'a')!.depth;
		expect(depth).toBeGreaterThan(0.2);
		expect(depth).toBeLessThan(0.8);
	});

	it('rises as the moment approaches', () => {
		const soon = find([waiting('13:00')], 'a')!.depth;
		const later = find([waiting('22:00')], 'a')!.depth;
		expect(soon).toBeLessThan(later);
	});

	it('floats an overdue bubble at the top rather than sinking it', () => {
		expect(find([waiting('09:00')], 'a')!.depth).toBeCloseTo(0.2, 1);
	});

	it('sits a free-text bubble on the floor', () => {
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'text', text: 'if rested' } });
		expect(find([t], 'a')!.depth).toBe(1);
	});

	it('sits an undated task-dependency bubble on the floor', () => {
		const dep = task({ id: 'dep' });
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'task', taskId: 'dep' } });
		expect(find([dep, t], 'a')!.depth).toBe(1);
	});

	it('uses the cutoff as the moment when a dependency carries one', () => {
		const dep = task({ id: 'dep' });
		const t = task({
			id: 'a',
			status: 'waiting',
			condition: { kind: 'task', taskId: 'dep', before: '12:30' }
		});
		expect(find([dep, t], 'a')!.depth).toBeCloseTo(0.2, 1);
	});
});

describe('buildScene — lanterns', () => {
	const treat = (id: string, cost: number) => task({ id, treatCost: cost, status: 'waiting' });
	const earned = (n: number) =>
		Array.from({ length: n }, (_, i) => task({ id: `e${i}`, status: 'done' }));

	it('locks a lantern the balance cannot afford', () => {
		expect(find([treat('x', 5)], 'x')?.locked).toBe(true);
	});

	it('unlocks a lantern once it is affordable', () => {
		expect(find([...earned(5), treat('x', 5)], 'x')?.locked).toBe(false);
	});

	it('carries the price', () => {
		expect(find([treat('x', 7)], 'x')?.cost).toBe(7);
	});

	it('shows every lantern up to the cap', () => {
		const treats = Array.from({ length: MAX_VISIBLE_LANTERNS }, (_, i) => treat(`t${i}`, 1));
		expect(countOf(treats, 'lantern')).toBe(MAX_VISIBLE_LANTERNS);
	});

	it('collapses the remainder into a single overflow lantern', () => {
		const treats = Array.from({ length: MAX_VISIBLE_LANTERNS + 3 }, (_, i) => treat(`t${i}`, 1));
		expect(countOf(treats, 'lantern')).toBe(MAX_VISIBLE_LANTERNS + 1);
	});

	it('the overflow lantern belongs to no single task', () => {
		const treats = Array.from({ length: MAX_VISIBLE_LANTERNS + 3 }, (_, i) => treat(`t${i}`, 1));
		const lanterns = buildScene(treats, [], DAY, NOON).creatures.filter((c) => c.kind === 'lantern');
		expect(lanterns.at(-1)!.taskId).toBeUndefined();
	});

	it('rests lanterns on the waterline', () => {
		expect(find([treat('x', 5)], 'x')!.depth).toBe(0);
	});
});

describe('buildScene — pearls', () => {
	it('settles one pearl per pearl in the balance', () => {
		const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'done' })];
		expect(countOf(tasks, 'pearl')).toBe(2);
	});

	it('draws no pearls on a negative balance rather than a negative count', () => {
		const overdrawn = [task({ id: 'x', treatCost: 5, status: 'open' })];
		expect(countOf(overdrawn, 'pearl')).toBe(0);
	});

	it('counts pearls earned on other dates — the balance is a running total', () => {
		const yesterday = [task({ id: 'a', status: 'done', date: '2026-08-07' })];
		expect(countOf(yesterday, 'pearl')).toBe(1);
	});

	it('rests pearls on the tank floor', () => {
		const tasks = [task({ id: 'a', status: 'done' })];
		const pearl = buildScene(tasks, [], DAY, NOON).creatures.find((c) => c.kind === 'pearl');
		expect(pearl!.depth).toBe(1);
	});
});

describe('buildScene — koi', () => {
	it('shows a koi earned on this date', () => {
		expect(countOf([], 'koi', [{ date: DAY, earnedAt: 1 }])).toBe(1);
	});

	it('shows a koi earned earlier — it swims through every date thereafter', () => {
		expect(countOf([], 'koi', [{ date: '2026-08-01', earnedAt: 1 }])).toBe(1);
	});

	it('does not show a koi from a future date', () => {
		expect(countOf([], 'koi', [{ date: '2026-08-09', earnedAt: 1 }])).toBe(0);
	});

	it('shows one koi per cleared day', () => {
		const koi: KoiRecord[] = [
			{ date: '2026-08-06', earnedAt: 1 },
			{ date: '2026-08-07', earnedAt: 2 }
		];
		expect(countOf([], 'koi', koi)).toBe(2);
	});
});

describe('buildScene — scene totals', () => {
	it('reports the pearl balance', () => {
		const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'done' })];
		expect(buildScene(tasks, [], DAY, NOON).pearls).toBe(2);
	});

	it('reports zero cleared on an empty day', () => {
		expect(buildScene([], [], DAY, NOON).clearedPct).toBe(0);
	});

	it('reports half cleared when one of two is done', () => {
		const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'b' })];
		expect(buildScene(tasks, [], DAY, NOON).clearedPct).toBe(0.5);
	});

	it('reports fully cleared when every task is done', () => {
		expect(buildScene([task({ id: 'a', status: 'done' })], [], DAY, NOON).clearedPct).toBe(1);
	});

	it('excludes treats from the cleared figure, matching the koi rule', () => {
		const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'x', treatCost: 5, status: 'waiting' })];
		expect(buildScene(tasks, [], DAY, NOON).clearedPct).toBe(1);
	});

	it('excludes deleted tasks from the cleared figure', () => {
		const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'b', deletedAt: 1 })];
		expect(buildScene(tasks, [], DAY, NOON).clearedPct).toBe(1);
	});
});

describe('buildScene — pointer picking', () => {
	it('gives every creature a positive tap radius', () => {
		const tasks = [
			task({ id: 'fish' }),
			task({ id: 'ghost', status: 'done' }),
			task({ id: 'treat', treatCost: 9, status: 'waiting' }),
			task({ id: 'bubble', status: 'waiting', condition: { kind: 'time', at: '18:00' } })
		];
		const scene = buildScene(tasks, [{ date: DAY, earnedAt: 1 }], DAY, NOON);
		expect(scene.creatures.length).toBeGreaterThan(0);
		expect(scene.creatures.every((c) => c.tapRadius > 0)).toBe(true);
	});

	it('gives every creature a unique id', () => {
		const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'done' })];
		const scene = buildScene(tasks, [{ date: DAY, earnedAt: 1 }], DAY, NOON);
		const ids = scene.creatures.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

import { describe, it, expect } from 'vitest';
import {
	buildScene,
	FEED_WINDOW_MS,
	MAX_VISIBLE_KOI,
	MAX_VISIBLE_PEARLS,
	MAX_VISIBLE_TREATS
} from './build';
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
		expect(countOf([task({ id: 'a', treatCost: 3, status: 'waiting' })], 'treat')).toBe(1);
	});

	it('a claimed treat is a fish, not a lantern — paying moves it into the water', () => {
		const claimed = task({ id: 'a', treatCost: 3, status: 'open' });
		expect(kinds([claimed])).toContain('fish');
		expect(kinds([claimed])).not.toContain('treat');
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

	// A clockless bubble used to be parked at depth 1. Nothing schedules it, so that
	// height reported nothing -- it just piled every free-text task on the sand.
	it('gives a free-text bubble the open water rather than the floor', () => {
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'text', text: 'if rested' } });
		const depth = find([t], 'a')!.depth;

		expect(depth).toBeGreaterThan(0.2);
		expect(depth).toBeLessThan(0.8);
	});

	it('gives an undated task-dependency bubble the open water too', () => {
		const dep = task({ id: 'dep' });
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'task', taskId: 'dep' } });
		const depth = find([dep, t], 'a')!.depth;

		expect(depth).toBeGreaterThan(0.2);
		expect(depth).toBeLessThan(0.8);
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

/**
 * `untimed` is what lets `place()` know the depth is a parking spot rather than a
 * reading. A bubble on a clock must stay pinned, because moving it would misreport
 * when the task fires; a bubble with no clock is telling you nothing by its height,
 * so it is free to drift.
 */
describe('buildScene — a bubble says whether its depth means anything', () => {
	const waiting = (atTime: string) =>
		task({ id: 'a', status: 'waiting', condition: { kind: 'time', at: atTime } });

	it('marks a free-text bubble untimed', () => {
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'text', text: 'if rested' } });
		expect(find([t], 'a')!.untimed).toBe(true);
	});

	it('marks an undated task-dependency bubble untimed', () => {
		const dep = task({ id: 'dep' });
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'task', taskId: 'dep' } });
		expect(find([dep, t], 'a')!.untimed).toBe(true);
	});

	it('marks a bubble whose trigger target is gone untimed', () => {
		const t = task({ id: 'a', status: 'waiting', condition: { kind: 'task', taskId: 'missing' } });
		expect(find([t], 'a')!.untimed).toBe(true);
	});

	it('leaves a bubble on a clock timed', () => {
		expect(find([waiting('20:00')], 'a')!.untimed).toBeFalsy();
	});

	it('leaves a dependency with a cutoff timed — the cutoff is a clock', () => {
		const dep = task({ id: 'dep' });
		const t = task({
			id: 'a',
			status: 'waiting',
			condition: { kind: 'task', taskId: 'dep', before: '12:30' }
		});
		expect(find([dep, t], 'a')!.untimed).toBeFalsy();
	});

	it('never marks a swimming fish untimed', () => {
		expect(find([task({ id: 'a' })], 'a')!.untimed).toBeFalsy();
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
		const treats = Array.from({ length: MAX_VISIBLE_TREATS }, (_, i) => treat(`t${i}`, 1));
		expect(countOf(treats, 'treat')).toBe(MAX_VISIBLE_TREATS);
	});

	it('collapses the remainder into a single overflow lantern', () => {
		const treats = Array.from({ length: MAX_VISIBLE_TREATS + 3 }, (_, i) => treat(`t${i}`, 1));
		expect(countOf(treats, 'treat')).toBe(MAX_VISIBLE_TREATS + 1);
	});

	it('the overflow lantern belongs to no single task', () => {
		const treats = Array.from({ length: MAX_VISIBLE_TREATS + 3 }, (_, i) => treat(`t${i}`, 1));
		const lanterns = buildScene(treats, [], DAY, NOON).creatures.filter((c) => c.kind === 'treat');
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

describe('buildScene — a cleared day keeps its ghosts, and gains a koi', () => {
	const cleared = [{ date: DAY, earnedAt: 1 }];

	it('keeps the day own ghosts once it has cleared', () => {
		// Deleting them on the day itself emptied the tank the moment you finished:
		// the reward for clearing a day was watching your work vanish.
		const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'done' })];

		expect(countOf(tasks, 'ghost', cleared)).toBe(2);
		expect(countOf(tasks, 'koi', cleared)).toBe(1);
	});

	it('shows only the koi on a later date — ghosts are date-scoped, so they merge on their own', () => {
		const tasks = [task({ id: 'a', status: 'done', date: DAY })];
		const later = buildScene(tasks, cleared, '2026-08-09', NOON).creatures;

		expect(later.filter((c) => c.kind === 'ghost')).toHaveLength(0);
		expect(later.filter((c) => c.kind === 'koi')).toHaveLength(1);
	});

	it('still shows a task added to an already-cleared day', () => {
		const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'late' })];

		expect(countOf(tasks, 'fish', cleared)).toBe(1);
		expect(countOf(tasks, 'koi', cleared)).toBe(1);
	});

	it('mints pearls regardless of the koi', () => {
		const tasks = [task({ id: 'a', status: 'done' }), task({ id: 'b', status: 'done' })];

		expect(buildScene(tasks, cleared, DAY, NOON).pearls).toBe(2);
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

describe('buildScene — the tank has an upper bound', () => {
	const done = (id: string, date = DAY) => task({ id, date, status: 'done', completedAt: 1 });

	it('draws one pearl each while the balance is small', () => {
		const tasks = Array.from({ length: 3 }, (_, i) => done(`d${i}`));
		expect(countOf(tasks, 'pearl')).toBe(3);
	});

	it('stops adding pearls past the cap, however large the balance', () => {
		const tasks = Array.from({ length: 200 }, (_, i) => done(`d${i}`));
		expect(countOf(tasks, 'pearl')).toBe(MAX_VISIBLE_PEARLS);
	});

	it('reports the true balance even when it draws far fewer pearls', () => {
		// The pill shows this number, which is why capping the creatures loses nothing.
		const tasks = Array.from({ length: 200 }, (_, i) => done(`d${i}`));
		expect(buildScene(tasks, [], DAY, NOON).pearls).toBe(200);
	});

	it('stops adding koi past the cap', () => {
		const koi = Array.from({ length: 40 }, (_, i) => ({
			date: `2026-07-${String(i + 1).padStart(2, '0')}`,
			earnedAt: 1
		}));
		expect(countOf([], 'koi', koi)).toBe(MAX_VISIBLE_KOI);
	});

	it('keeps the most recently earned koi, not the first ones recorded', () => {
		const koi = [
			{ date: '2026-07-01', earnedAt: 1 },
			{ date: '2026-08-07', earnedAt: 1 },
			{ date: '2026-07-02', earnedAt: 1 },
			{ date: '2026-08-06', earnedAt: 1 },
			{ date: '2026-07-03', earnedAt: 1 }
		];
		const ids = buildScene([], koi, DAY, NOON).creatures.map((c) => c.id);
		expect(ids).toContain('koi-2026-08-07');
		expect(ids).toContain('koi-2026-08-06');
		expect(ids).not.toContain('koi-2026-07-01');
	});

	it('still hides koi earned after the date being viewed', () => {
		const koi = [
			{ date: '2026-08-09', earnedAt: 1 },
			{ date: '2026-08-10', earnedAt: 1 },
			{ date: DAY, earnedAt: 1 }
		];
		const ids = buildScene([], koi, DAY, NOON).creatures.map((c) => c.id);
		expect(ids).toEqual([`koi-${DAY}`]);
	});

	it('holds the whole tank under a ceiling after two months of steady use', () => {
		// Measured before the caps existed: 399 creatures, of which 333 were pearls and
		// 60 koi. Both grew without limit; this is the guard against a third kind doing
		// the same. The bound is the caps plus one heavy day's fish and ghosts.
		const day = (n: number) => {
			const d = new Date(2026, 5, 1 + n);
			const p = (x: number) => String(x).padStart(2, '0');
			return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
		};

		const tasks: Task[] = [];
		const koi: KoiRecord[] = [];
		for (let d = 0; d < 60; d++) {
			for (let i = 0; i < 6; i++) tasks.push(done(`t-${d}-${i}`, day(d)));
			koi.push({ date: day(d), earnedAt: 1 });
		}

		const scene = buildScene(tasks, koi, day(59), at(12, 0, day(59)));
		expect(scene.creatures.length).toBeLessThanOrEqual(
			MAX_VISIBLE_PEARLS + MAX_VISIBLE_KOI + MAX_VISIBLE_TREATS + 1 + 6
		);
	});
});

describe('buildScene — the feeding flourish', () => {
	const justDone = (over: Partial<Task> = {}) =>
		task({ id: 'a', status: 'done', completedAt: NOON, ...over });

	it('is quiet when nothing has been finished', () => {
		expect(buildScene([task({ id: 'a' })], [], DAY, NOON).feeding).toBe(0);
	});

	it('is at full strength the instant a task is finished', () => {
		expect(buildScene([justDone()], [], DAY, NOON).feeding).toBe(1);
	});

	it('fades to nothing over the window, and stays there', () => {
		const midway = buildScene([justDone()], [], DAY, NOON + FEED_WINDOW_MS / 2).feeding;
		expect(midway).toBeGreaterThan(0);
		expect(midway).toBeLessThan(1);

		expect(buildScene([justDone()], [], DAY, NOON + FEED_WINDOW_MS).feeding).toBe(0);
		expect(buildScene([justDone()], [], DAY, NOON + FEED_WINDOW_MS * 5).feeding).toBe(0);
	});

	it('follows the most recent completion, not the first', () => {
		const old = task({ id: 'old', status: 'done', completedAt: NOON - FEED_WINDOW_MS * 3 });
		const fresh = task({ id: 'fresh', status: 'done', completedAt: NOON });

		expect(buildScene([old, fresh], [], DAY, NOON).feeding).toBe(1);
	});

	it('ignores a deleted task, however recently it was finished', () => {
		// Soft deletes are filtered on every derived read. Missing it here would leave a
		// deleted task feeding the tank.
		const deleted = justDone({ deletedAt: NOON });
		expect(buildScene([deleted], [], DAY, NOON).feeding).toBe(0);
	});

	it('ignores a completion stamped in the future', () => {
		// Clock skew, or a machine that woke with the wrong time. Feeding on a negative
		// age would run the flourish backwards and never end.
		const ahead = justDone({ completedAt: NOON + 60_000 });
		expect(buildScene([ahead], [], DAY, NOON).feeding).toBe(0);
	});

	it('feeds from a task finished on another date', () => {
		// You can complete yesterday's task while looking at yesterday; the tank you are
		// looking at should react. The creature list is date-scoped, the flourish is not.
		const yesterday = task({ id: 'y', date: '2026-08-07', status: 'done', completedAt: NOON });
		expect(buildScene([yesterday], [], DAY, NOON).feeding).toBe(1);
	});

	it('does not feed for an unclaimed treat, which is a reward rather than work', () => {
		const treat = task({ id: 't', treatCost: 3, status: 'done', completedAt: NOON });
		expect(buildScene([treat], [], DAY, NOON).feeding).toBe(0);
	});
});

describe('buildScene — priority / shark', () => {
	it('a priority open task is a shark', () => {
		expect(countOf([task({ id: 'p', priority: true })], 'shark')).toBe(1);
	});

	it('a priority open task is NOT also a fish', () => {
		expect(countOf([task({ id: 'p', priority: true })], 'fish')).toBe(0);
	});

	it('a priority done task becomes a ghost, not a shark', () => {
		expect(countOf([task({ id: 'p', priority: true, status: 'done' })], 'ghost')).toBe(1);
		expect(countOf([task({ id: 'p', priority: true, status: 'done' })], 'shark')).toBe(0);
	});

	it('a priority waiting task becomes a bubble, not a shark', () => {
		const waiting = task({
			id: 'p',
			priority: true,
			status: 'waiting',
			condition: { kind: 'time', at: '18:00' }
		});
		expect(countOf([waiting], 'bubble')).toBe(1);
		expect(countOf([waiting], 'shark')).toBe(0);
	});

	it('a priority treat stays a treat, not a shark', () => {
		const treat = task({ id: 'p', priority: true, treatCost: 3, status: 'waiting' });
		expect(countOf([treat], 'treat')).toBe(1);
		expect(countOf([treat], 'shark')).toBe(0);
	});

	it('shark has a positive tapRadius', () => {
		const creature = find([task({ id: 'p', priority: true })], 'p');
		expect(creature?.tapRadius).toBeGreaterThan(0);
	});

	it('shark taskId matches the task id', () => {
		const creature = find([task({ id: 'p', priority: true })], 'p');
		expect(creature?.kind).toBe('shark');
		expect(creature?.taskId).toBe('p');
	});

	it('non-priority task is not a shark', () => {
		expect(countOf([task({ id: 'n' })], 'shark')).toBe(0);
	});
});

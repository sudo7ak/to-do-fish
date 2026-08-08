import { isLive, type KoiRecord, type Task } from '../types';
import { isOrphaned } from '../triggers/validate';
import { pearlBalance } from '../store/pearls';
import type { Creature, CreatureKind, Scene } from './types';

/**
 * Builds the tank for one date: tasks in, creature descriptors out.
 *
 * Pure. No positions, no velocities, no animation state — those live in the render
 * loop and are never persisted. The tank is a projection of the task data and never
 * a source of it, which is why this can be tested by asserting kind, count, and
 * resting depth rather than pixels.
 */

/** Beyond this many lanterns, the remainder collapses into one overflow lantern. */
export const MAX_VISIBLE_TREATS = 4;

/** Depth of a bubble about to fire, and of one still a week away. 0 = waterline, 1 = floor. */
const DEPTH_IMMINENT = 0.2;
const DEPTH_DISTANT = 0.8;
const IMMINENT_MS = 60 * 60 * 1000; // within the hour: eye level
const DISTANT_MS = 7 * 24 * 60 * 60 * 1000; // a week out: down in the plants

const TAP_RADIUS: Record<CreatureKind, number> = {
	fish: 28,
	bubble: 26,
	ghost: 24,
	koi: 34,
	treat: 30,
	pearl: 14
};

export function buildScene(tasks: Task[], koi: KoiRecord[], date: string, now: number): Scene {
	const live = tasks.filter(isLive);
	const today = live.filter((t) => t.date === date);

	const waitingTreats = today.filter((t) => t.treatCost !== undefined && t.status === 'waiting');
	const inWater = today.filter((t) => !(t.treatCost !== undefined && t.status === 'waiting'));

	const balance = pearlBalance(live);

	/**
	 * The spec's "that day's ghosts merge into one golden koi" is already satisfied by
	 * ghosts being date-scoped: on every later date you see the koi and none of that
	 * day's ghosts, because ghosts only ever appear on their own date.
	 *
	 * Deleting the ghosts on the day itself was tried and was wrong — finishing
	 * everything emptied the tank, so the reward for clearing a day was watching your
	 * work disappear.
	 */
	const creatures: Creature[] = [
		...inWater.map((task) => toCreature(task, live, now)),
		...treats(waitingTreats, balance),
		...pearls(balance),
		// A koi swims through every date from the day it was earned onward.
		...koi.filter((record) => record.date <= date).map(toKoi)
	];

	return { creatures, clearedPct: clearedPct(today), pearls: balance };
}

/** Everything in the water: bubbles, fish, and ghosts. */
function toCreature(task: Task, live: Task[], now: number): Creature {
	if (task.status === 'done') {
		return base(task, 'ghost', 0.45);
	}

	if (task.status === 'waiting') {
		// A free-text condition, or one that has lost its target, is released by hand.
		// Both get the dashed treatment and rest on the floor: neither has a moment
		// coming that would float it upward.
		const manual = task.condition?.kind === 'text' || isOrphaned(live, task);
		return {
			...base(task, 'bubble', manual ? 1 : bubbleDepth(task, now)),
			...(manual ? { dashed: true } : {})
		};
	}

	// Open: a plain task, a released bubble, or a claimed treat swimming as an amber fish.
	const fish = base(task, 'fish', 0.5);
	return task.treatCost !== undefined ? { ...fish, claimed: true, cost: task.treatCost } : fish;
}

/**
 * Depth encodes imminence, so that twenty waiting tasks stay readable — nineteen of
 * them stacked out of the swim area. A task with no clock attached has no moment to
 * approach, and sits on the floor.
 */
function bubbleDepth(task: Task, now: number): number {
	const moment = triggerMoment(task);
	if (moment === undefined) return 1;

	const remaining = moment - now;
	if (remaining <= IMMINENT_MS) return DEPTH_IMMINENT; // includes overdue
	if (remaining >= DISTANT_MS) return DEPTH_DISTANT;

	const progress = (remaining - IMMINENT_MS) / (DISTANT_MS - IMMINENT_MS);
	return DEPTH_IMMINENT + progress * (DEPTH_DISTANT - DEPTH_IMMINENT);
}

/** The instant a bubble is due, or undefined when nothing schedules it. */
function triggerMoment(task: Task): number | undefined {
	const condition = task.condition;
	if (condition?.kind === 'time') return localInstant(task.date, condition.at);
	// A dependency with a cutoff is on a clock; one without waits on an event.
	if (condition?.kind === 'task' && condition.before !== undefined) {
		return localInstant(task.date, condition.before);
	}
	return undefined;
}

function treats(waitingTreats: Task[], balance: number): Creature[] {
	const visible = waitingTreats.slice(0, MAX_VISIBLE_TREATS).map(
		(task): Creature => ({
			...base(task, 'treat', 0),
			// Affordability against the same balance the scene reports, rather than
			// recomputing it per lantern — this runs every frame.
			locked: balance < task.treatCost!,
			cost: task.treatCost
		})
	);

	const hidden = waitingTreats.length - visible.length;
	if (hidden === 0) return visible;

	// The overflow lantern stands for several treats, so it belongs to no single task
	// and cannot be claimed by tapping it.
	return [
		...visible,
		{
			id: 'treat-overflow',
			kind: 'treat',
			label: `+${hidden} more`,
			depth: 0,
			locked: true,
			tapRadius: TAP_RADIUS.treat
		}
	];
}

function pearls(balance: number): Creature[] {
	// A negative balance means a bug upstream, not a negative pile of pearls.
	return Array.from({ length: Math.max(0, balance) }, (_, i) => ({
		id: `pearl-${i}`,
		kind: 'pearl' as const,
		label: 'Pearl',
		depth: 1,
		tapRadius: TAP_RADIUS.pearl
	}));
}

function toKoi(record: KoiRecord): Creature {
	return {
		id: `koi-${record.date}`,
		kind: 'koi',
		label: `Cleared ${record.date}`,
		depth: 0.6,
		tapRadius: TAP_RADIUS.koi
	};
}

/** Share of the day's real work that is done. Treats are rewards, not work — as in the koi rule. */
function clearedPct(today: Task[]): number {
	const work = today.filter((t) => t.treatCost === undefined);
	if (work.length === 0) return 0;
	return work.filter((t) => t.status === 'done').length / work.length;
}

function base(task: Task, kind: CreatureKind, depth: number): Creature {
	return { id: task.id, kind, taskId: task.id, label: task.title, depth, tapRadius: TAP_RADIUS[kind] };
}

function localInstant(date: string, time: string): number {
	const [year, month, day] = date.split('-').map(Number);
	const [hours, minutes] = time.split(':').map(Number);
	return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
}

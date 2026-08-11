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

/**
 * Pearls and koi are the two creatures whose count is not bounded by a single day's
 * tasks, so without a cap the tank fills up and never empties again.
 *
 * Measured on 60 days of steady use — six tasks a day, all finished, a treat a week —
 * the tank held 399 creatures: 333 pearls, 60 koi, and 6 ghosts. The pearl balance is
 * a running `earned − spent` across every date, and a koi swims on every date after
 * the one it was earned on, so both grow for as long as the app is used. Ghosts, the
 * intuitive culprit, are bounded by one day's work and are not the problem.
 *
 * These cap what is *drawn*. Neither the balance nor the koi records change: the pill
 * still shows the exact pearl count, and a koi that scrolls out of view has not been
 * revoked.
 *
 * Unlike the overflow lantern there is no overflow pearl. That one earns its place by
 * opening the list when tapped; tapping a pearl does nothing, so an overflow pearl
 * would only be a creature that misstates the count.
 */
export const MAX_VISIBLE_PEARLS = 9;
export const MAX_VISIBLE_KOI = 3;

/**
 * How long the flourish runs after a task is finished.
 *
 * Feeding is the moment a real aquarium comes alive, and completion was this app's
 * flattest beat — the fish drains to a ghost, which is a subtraction. This is the
 * reward, and deliberately *not* a mechanic: nothing to feed, nothing to maintain, and
 * no obligation created by not opening the app.
 */
export const FEED_WINDOW_MS = 4000;

/** Depth of a bubble about to fire, and of one still a week away. 0 = waterline, 1 = floor. */
const DEPTH_IMMINENT = 0.2;
const DEPTH_DISTANT = 0.8;
/**
 * A bubble nothing schedules. It has no moment to approach, so it has no imminence to
 * report and no business claiming a depth that means one — it swims mid-water like an
 * open task instead. It used to be parked on the floor, which read as a fault: every
 * free-text task in one motionless row on the sand, sliding sideways.
 */
const DEPTH_UNTIMED = 0.5;
const IMMINENT_MS = 60 * 60 * 1000; // within the hour: eye level
const DISTANT_MS = 7 * 24 * 60 * 60 * 1000; // a week out: down in the plants

/**
 * Sized for a fingertip, not a mouse pointer: ~44px across is the usual floor for a
 * touch target, and these creatures are moving while you aim at them.
 *
 * Ghosts stay smaller than live fish so a finished task cannot steal a tap meant for
 * work you still have to do; pearls are smallest because tapping one does nothing.
 */
const TAP_RADIUS: Record<CreatureKind, number> = {
	fish: 34,
	bubble: 32,
	ghost: 26,
	koi: 38,
	treat: 36,
	pearl: 16
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
		// A koi swims through every date from the day it was earned onward — but only
		// the most recent few are drawn, since a wall of gold stops reading as "I
		// cleared a day". Sorted here rather than trusting the stored order.
		...koi
			.filter((record) => record.date <= date)
			.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
			.slice(0, MAX_VISIBLE_KOI)
			.map(toKoi)
	];

	return {
		creatures,
		clearedPct: clearedPct(today),
		pearls: balance,
		feeding: feeding(live, now)
	};
}

/** Everything in the water: bubbles, fish, and ghosts. */
function toCreature(task: Task, live: Task[], now: number): Creature {
	if (task.status === 'done') {
		return base(task, 'ghost', 0.45);
	}

	if (task.status === 'waiting') {
		// A free-text condition, or one that has lost its target, is released by hand,
		// and gets the dashed treatment to say so.
		const manual = task.condition?.kind === 'text' || isOrphaned(live, task);
		// Depth is a reading only when something schedules the task. A manual bubble has
		// no moment, and neither does a dependency with no cutoff — in both cases the
		// height reports nothing, and the renderer is told so rather than having to
		// infer it from the value.
		const moment = manual ? undefined : triggerMoment(task);
		return {
			...base(task, 'bubble', moment === undefined ? DEPTH_UNTIMED : bubbleDepth(task, now, moment)),
			...(moment === undefined ? { untimed: true } : {}),
			...(manual ? { dashed: true } : {})
		};
	}

	// Open: a plain task, a released bubble, or a claimed treat swimming as an amber fish.
	const fish = base(task, 'fish', 0.5);
	return task.treatCost !== undefined ? { ...fish, claimed: true, cost: task.treatCost } : fish;
}

/**
 * Depth encodes imminence, so that twenty waiting tasks stay readable — the ones with
 * hours to run sit below the ones about to fire.
 *
 * Only ever called for a bubble that has a moment; a clockless one takes
 * `DEPTH_UNTIMED` at the call site, because there is no imminence to encode.
 */
function bubbleDepth(task: Task, now: number, moment: number): number {
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
	const drawn = Math.min(Math.max(0, balance), MAX_VISIBLE_PEARLS);
	return Array.from({ length: drawn }, (_, i) => ({
		id: `pearl-${i}`,
		kind: 'pearl' as const,
		label: 'Pearl',
		depth: 1,
		tapRadius: TAP_RADIUS.pearl
	}));
}

/**
 * How much flourish is owed right now, from the most recent completion.
 *
 * Reads `live`, so a deleted task cannot feed the tank — the soft-delete filter has to
 * appear on every derived read, and this is one. Treats are excluded for the same
 * reason they do not mint pearls: claiming a reward you already paid for is not work.
 *
 * Not date-scoped, unlike the creature list. Finishing yesterday's task while looking
 * at yesterday should stir the tank you are actually looking at.
 */
function feeding(live: Task[], now: number): number {
	let freshest = 0;

	for (const task of live) {
		if (task.status !== 'done' || task.treatCost !== undefined) continue;
		const at = task.completedAt;
		// A completion stamped in the future is clock skew; treat it as not yet happened
		// rather than running the flourish on a negative age, which would never end.
		if (at === undefined || at > now) continue;
		freshest = Math.max(freshest, at);
	}

	if (freshest === 0) return 0;

	const age = now - freshest;
	return age >= FEED_WINDOW_MS ? 0 : 1 - age / FEED_WINDOW_MS;
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

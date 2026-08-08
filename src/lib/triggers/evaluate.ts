import { isLive, type Task } from '../types';

/**
 * Pure trigger evaluation: which waiting tasks are now due for release.
 *
 * Called once a second and again on every wake. Compares against absolute `now`,
 * never accumulated tick deltas — a machine asleep from 17:00 to 22:00 releases the
 * 18:00 task on wake rather than silently skipping it.
 *
 * Imports nothing from `scene/`. This layer knows about tasks and time, and nothing
 * about how any of it is drawn.
 */
export function evaluate(tasks: Task[], now: number): string[] {
	const live = tasks.filter(isLive);
	const byId = new Map(live.map((t) => [t.id, t]));

	return live.filter((task) => isDue(task, byId, now)).map((task) => task.id);
}

function isDue(task: Task, byId: Map<string, Task>, now: number): boolean {
	if (task.status !== 'waiting') return false;

	// A waiting treat is a lantern. It leaves the waterline by being paid for in
	// pearls, never by a trigger firing.
	if (task.treatCost !== undefined) return false;

	const condition = task.condition;
	if (!condition) return false;

	switch (condition.kind) {
		case 'time':
			return now >= localInstant(task.date, condition.at);

		case 'task': {
			// An orphaned target — deleted or never existing — degrades the bubble to
			// manual release. `byId` holds only live tasks, so both cases land here.
			const target = byId.get(condition.taskId);
			if (!target || target.status !== 'done') return false;
			if (condition.before === undefined) return true;

			// Without a completion time the cutoff cannot be shown to have been met,
			// so the window counts as missed rather than assumed.
			if (target.completedAt === undefined) return false;
			return target.completedAt < localInstant(task.date, condition.before);
		}

		// Free-text conditions are released only by tapping the bubble. The app never
		// prompts about one, and evaluation never fires one.
		case 'text':
			return false;
	}
}

/** "2026-08-08" + "18:00" -> the local wall-clock instant. Dates and times are local throughout. */
function localInstant(date: string, time: string): number {
	const [year, month, day] = date.split('-').map(Number);
	const [hours, minutes] = time.split(':').map(Number);
	return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
}

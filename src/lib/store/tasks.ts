import { writable, get, type Readable } from 'svelte/store';
import { SCHEMA_VERSION, type Condition, type KoiRecord, type Settings, type Task } from '../types';
import type { TaskStore } from '../persist/port';
import { validateCondition } from '../triggers/validate';
import { canAfford } from './pearls';
import { awardKoi } from './koi';
import { ulid } from '../ulid';
import type { Environment } from './settings';

/**
 * Task state and the actions over it.
 *
 * The reducers below are pure and exported so the rules can be tested without a
 * store or a browser. `createTaskStore` is the thin part: hold state, apply a
 * reducer, persist through the `TaskStore` port. Persistence is reached only
 * through that port — this layer never touches `localStorage`.
 */

export type State = { tasks: Task[]; koi: KoiRecord[]; settings: Settings };

export type TaskDraft = {
	title: string;
	date: string;
	condition?: Condition;
	treatCost?: number;
};

export type Refusal = { ok: false; reason: 'cycle' | 'unaffordable' | 'claimed' };
export type Outcome = { ok: true; state: State } | Refusal;

// ---------------------------------------------------------------- reducers

export function addTask(state: State, draft: TaskDraft, now: number, id = ulid(now)): Outcome {
	const check = validateCondition(state.tasks, { id, condition: draft.condition });
	if (!check.ok) return { ok: false, reason: 'cycle' };

	const task: Task = {
		id,
		title: draft.title,
		date: draft.date,
		status: draft.condition || draft.treatCost !== undefined ? 'waiting' : 'open',
		createdAt: now,
		updatedAt: now,
		...(draft.condition ? { condition: draft.condition } : {}),
		...(draft.treatCost !== undefined ? { treatCost: draft.treatCost } : {})
	};

	return { ok: true, state: { ...state, tasks: [...state.tasks, task] } };
}

export function editTask(
	state: State,
	id: string,
	patch: Partial<Pick<Task, 'title' | 'date' | 'condition' | 'treatCost'>>,
	now: number
): Outcome {
	if (patch.condition) {
		const check = validateCondition(state.tasks, { id, condition: patch.condition });
		if (!check.ok) return { ok: false, reason: 'cycle' };
	}

	return { ok: true, state: mutate(state, id, (task) => ({ ...task, ...patch }), now) };
}

export function moveToDate(state: State, id: string, date: string, now: number): State {
	return mutate(state, id, (task) => ({ ...task, date }), now);
}

export function completeTask(state: State, id: string, now: number): State {
	const completed = mutate(
		state,
		id,
		(task) => ({ ...task, status: 'done', completedAt: now }),
		now
	);

	const task = completed.tasks.find((t) => t.id === id);
	if (!task) return completed;

	return { ...completed, koi: awardKoi(completed.koi, completed.tasks, task.date, now) };
}

export function softDelete(state: State, id: string, now: number): State {
	// Never spliced. A device that has not yet synced would otherwise re-push a task
	// deleted elsewhere, and deleted tasks would come back permanently.
	return mutate(state, id, (task) => ({ ...task, deletedAt: now }), now);
}

export function releaseBubble(state: State, id: string, now: number): State {
	return mutate(
		state,
		id,
		(task) => (task.status === 'waiting' ? { ...task, status: 'open' } : task),
		now,
		{ onlyIfChanged: true }
	);
}

export function claimTreat(state: State, id: string, now: number): Outcome {
	const task = state.tasks.find((t) => t.id === id);

	// The status guard is the one that matters: a claimed treat's cost is already
	// counted as spent, so checking affordability alone would let a second claim
	// through whenever the balance had recovered.
	if (!task || task.treatCost === undefined || task.status !== 'waiting') {
		return { ok: false, reason: 'claimed' };
	}
	if (!canAfford(state.tasks, task)) return { ok: false, reason: 'unaffordable' };

	return { ok: true, state: mutate(state, id, (t) => ({ ...t, status: 'open' }), now) };
}

export function setEnvironment(state: State, environment: Environment, now: number): State {
	// Only stamp on an actual change. `updatedAt` is the input to last-write-wins
	// across devices, so a no-op call would make the record look newer than it is
	// and cause a settings push next sync for a change that never happened.
	if (state.settings.environment === environment) return state;
	return { ...state, settings: { ...state.settings, environment, updatedAt: now } };
}

/**
 * Records that the legend has been shown. Settings now carry their own `updatedAt`
 * as the unit of sync, so this stamps it like any other settings change — unlike a
 * task's `updatedAt`, it has no bearing on task reconciliation. Guarded the same way
 * as `setEnvironment`: calling it again once the flag is already set must not move
 * the timestamp.
 */
export function markLegendSeen(state: State, now: number): State {
	if (state.settings.seenLegend) return state;
	return { ...state, settings: { ...state.settings, seenLegend: true, updatedAt: now } };
}

/**
 * Applies a change to one task and bumps `updatedAt`. Every mutation goes through
 * here, which is what keeps the timestamp from being forgotten on a new action —
 * two devices can only be reconciled if each edit is stamped.
 */
function mutate(
	state: State,
	id: string,
	change: (task: Task) => Task,
	now: number,
	options: { onlyIfChanged?: boolean } = {}
): State {
	return {
		...state,
		tasks: state.tasks.map((task) => {
			if (task.id !== id) return task;
			const changed = change(task);
			if (options.onlyIfChanged && changed === task) return task;
			return { ...changed, updatedAt: now };
		})
	};
}

// ------------------------------------------------------------------ store

export type TaskStoreFacade = {
	tasks: Readable<Task[]>;
	koi: Readable<KoiRecord[]>;
	settings: Readable<Settings>;
	saveFailed: Readable<boolean>;
	hydrate(): Promise<void>;
	addTask(draft: TaskDraft): Promise<Outcome>;
	editTask(id: string, patch: Parameters<typeof editTask>[2]): Promise<Outcome>;
	moveToDate(id: string, date: string): Promise<void>;
	completeTask(id: string): Promise<void>;
	softDelete(id: string): Promise<void>;
	releaseBubble(id: string): Promise<void>;
	release(ids: string[]): Promise<void>;
	claimTreat(id: string): Promise<Outcome>;
	setEnvironment(environment: Environment): Promise<void>;
	markLegendSeen(): Promise<void>;
	snapshot(): State;
};

export function createTaskStore(port: TaskStore, clock: () => number = Date.now): TaskStoreFacade {
	const state = writable<State>({
		tasks: [],
		koi: [],
		settings: { environment: 'progress', seenLegend: false, updatedAt: 0 }
	});
	const tasks = writable<Task[]>([]);
	const koi = writable<KoiRecord[]>([]);
	const settings = writable<Settings>({ environment: 'progress', seenLegend: false, updatedAt: 0 });
	const saveFailed = writable(false);

	function publish(next: State) {
		state.set(next);
		tasks.set(next.tasks);
		koi.set(next.koi);
		settings.set(next.settings);
	}

	async function commit(next: State): Promise<void> {
		// In memory first. A failed write must not cost the user their edit — the app
		// keeps running and the banner says changes are not being saved.
		publish(next);
		try {
			await port.save({ version: SCHEMA_VERSION, ...next });
			saveFailed.set(false);
		} catch {
			saveFailed.set(true);
		}
	}

	async function apply(outcome: Outcome): Promise<Outcome> {
		if (outcome.ok) await commit(outcome.state);
		return outcome;
	}

	return {
		tasks,
		koi,
		settings,
		saveFailed,
		snapshot: () => get(state),

		async hydrate() {
			const { tasks, koi, settings } = await port.load();
			publish({ tasks, koi, settings });
		},

		addTask: (draft) => apply(addTask(get(state), draft, clock())),
		editTask: (id, patch) => apply(editTask(get(state), id, patch, clock())),
		claimTreat: (id) => apply(claimTreat(get(state), id, clock())),

		moveToDate: (id, date) => commit(moveToDate(get(state), id, date, clock())),
		completeTask: (id) => commit(completeTask(get(state), id, clock())),
		softDelete: (id) => commit(softDelete(get(state), id, clock())),
		releaseBubble: (id) => commit(releaseBubble(get(state), id, clock())),
		setEnvironment: (environment) => commit(setEnvironment(get(state), environment, clock())),
		markLegendSeen: () => commit(markLegendSeen(get(state), clock())),

		/** Bulk release for the ticker: one commit for a whole batch of due triggers. */
		release(ids) {
			const now = clock();
			const next = ids.reduce((acc, id) => releaseBubble(acc, id, now), get(state));
			return commit(next);
		}
	};
}

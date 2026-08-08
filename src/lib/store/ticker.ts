import { get, type Readable } from 'svelte/store';
import type { Task } from '../types';
import { evaluate } from '../triggers/evaluate';

/**
 * Drives trigger evaluation: once a second, and again whenever the tab wakes.
 *
 * Every tick asks `evaluate` about absolute `now` rather than accumulating deltas
 * between ticks. That is the whole reason a machine asleep from 17:00 to 22:00
 * releases the 18:00 task on wake instead of silently skipping it — the ticks that
 * never happened do not matter, only the current time does.
 */

/** The slice of the task store the ticker needs. Narrow on purpose: it reads and releases, nothing else. */
export type TickerStore = {
	tasks: Readable<Task[]>;
	release(ids: string[]): Promise<void>;
};

export type TickerOptions = {
	now?: () => number;
	intervalMs?: number;
	/** Where to listen for wakes. Defaults to `document`; absent on the server and in tests. */
	wakeTarget?: EventTarget;
};

export type Ticker = { start(): void; stop(): void; tick(): void };

export function createTicker(store: TickerStore, options: TickerOptions = {}): Ticker {
	const now = options.now ?? Date.now;
	const intervalMs = options.intervalMs ?? 1000;
	const wakeTarget = options.wakeTarget ?? defaultWakeTarget();

	let timer: ReturnType<typeof setInterval> | undefined;

	function tick() {
		const due = evaluate(get(store.tasks), now());

		// No due triggers means no write. Persisting every second would churn storage
		// for nothing, and the tank reads state directly rather than waiting on a save.
		if (due.length > 0) void store.release(due);
	}

	// Evaluating on wake matters more than the interval: a laptop reopened at 22:00
	// gets its releases immediately, not up to a second later.
	const onWake = () => tick();

	return {
		tick,

		start() {
			if (timer !== undefined) return;
			timer = setInterval(tick, intervalMs);
			wakeTarget?.addEventListener('visibilitychange', onWake);
		},

		stop() {
			if (timer !== undefined) clearInterval(timer);
			timer = undefined;
			wakeTarget?.removeEventListener('visibilitychange', onWake);
		}
	};
}

function defaultWakeTarget(): EventTarget | undefined {
	return typeof document === 'undefined' ? undefined : document;
}

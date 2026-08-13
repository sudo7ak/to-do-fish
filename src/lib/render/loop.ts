/**
 * The animation loop that drives the tank.
 *
 * Framework-free and dependency-injected so its awkward cases — a hidden tab, a
 * resumed tab, reduced motion, a throwing draw — can be tested without a browser.
 * Imports nothing from `store/`: this layer is handed a `draw` callback and knows
 * only about time.
 */

export type Frame = {
	/** Timestamp handed over by requestAnimationFrame. */
	time: number;
	/** Milliseconds since the previous frame, clamped. Zero on the first frame. */
	dt: number;
	/** False under prefers-reduced-motion: hold ambient drift still, but keep drawing. */
	animate: boolean;
};

export type RenderLoopOptions = {
	draw: (frame: Frame) => void;
	/** Called when draw throws. Receives the caught value so the caller can report it. */
	onError?: (error: unknown) => void;
	raf?: (cb: FrameRequestCallback) => number;
	cancelRaf?: (handle: number) => void;
	isHidden?: () => boolean;
	prefersReducedMotion?: () => boolean;
	/** Everything the wake events are listened for on. Defaults to document and window. */
	wakeTargets?: EventTarget[];
	/** Wall clock, in milliseconds, used only by the watchdog. */
	now?: () => number;
	startWatchdog?: (tick: () => void, everyMs: number) => number;
	stopWatchdog?: (handle: number) => void;
};

export type RenderLoop = { start(): void; stop(): void };

/**
 * A resumed tab reports a gap as wide as the time it spent hidden. Clamping keeps
 * every creature's drift proportional to a plausible frame rather than teleporting
 * it across the tank on the first visible frame.
 */
const MAX_FRAME_MS = 100;

/**
 * The wake-ups a backgrounded tab can come back through. `visibilitychange` alone is
 * not enough on mobile: a frozen tab (Page Lifecycle) is thawed with `resume`, and a
 * tab restored from the back/forward cache only gets `pageshow`. Missing those left
 * the tank dead until reload.
 */
const WAKE_EVENTS = ['visibilitychange', 'pageshow', 'resume', 'focus'] as const;

/** How often the watchdog looks, and how long a visible-but-silent tank may go unnoticed. */
const WATCHDOG_EVERY_MS = 1000;
const STALL_MS = 2000;

export function createRenderLoop(options: RenderLoopOptions): RenderLoop {
	const raf = options.raf ?? defaultRaf;
	const cancelRaf = options.cancelRaf ?? defaultCancelRaf;
	const isHidden = options.isHidden ?? defaultIsHidden;
	const prefersReducedMotion = options.prefersReducedMotion ?? defaultReducedMotion;
	const wakeTargets = options.wakeTargets ?? defaultWakeTargets();
	const now = options.now ?? (() => Date.now());
	const startWatchdog = options.startWatchdog ?? defaultStartWatchdog;
	const stopWatchdog = options.stopWatchdog ?? defaultStopWatchdog;

	let handle: number | undefined;
	let watchdog: number | undefined;
	let running = false;
	let lastTime: number | undefined;
	let lastFrameAt = 0;

	function frame(time: number) {
		handle = undefined;

		// `lastTime` is cleared whenever the loop pauses, so the frame after a resume
		// starts fresh instead of inheriting the gap.
		const dt = lastTime === undefined ? 0 : Math.min(time - lastTime, MAX_FRAME_MS);
		lastTime = time;
		lastFrameAt = now();

		try {
			options.draw({ time, dt, animate: !prefersReducedMotion() });
		} catch (error) {
			// A single bad frame must not end the session. Report and keep going.
			console.error('Tank draw failed', error);
			options.onError?.(error);
		}

		schedule();
	}

	function schedule() {
		if (!running || isHidden() || handle !== undefined) return;
		handle = raf(frame);
	}

	function pause() {
		if (handle !== undefined) cancelRaf(handle);
		handle = undefined;
		lastTime = undefined;
	}

	/**
	 * A backgrounded tab's pending frame is dropped without the callback ever running,
	 * so `handle` still holds a number that will never come back and `schedule()` — which
	 * refuses to double-book — would return early forever. Clearing it first is what makes
	 * the wake-up actually wake anything.
	 */
	const wake = () => {
		if (!running) return;
		pause();
		schedule();
	};

	const tick = () => {
		if (!running || isHidden()) return;
		if (now() - lastFrameAt < STALL_MS) return;
		wake();
	};

	return {
		start() {
			if (running) return;
			running = true;
			lastFrameAt = now();
			for (const target of wakeTargets) {
				for (const event of WAKE_EVENTS) target.addEventListener(event, wake);
			}
			watchdog = startWatchdog(tick, WATCHDOG_EVERY_MS);
			schedule();
		},

		stop() {
			running = false;
			pause();
			for (const target of wakeTargets) {
				for (const event of WAKE_EVENTS) target.removeEventListener(event, wake);
			}
			if (watchdog !== undefined) stopWatchdog(watchdog);
			watchdog = undefined;
		}
	};
}

const defaultRaf: (cb: FrameRequestCallback) => number = (cb) => requestAnimationFrame(cb);
const defaultCancelRaf = (handle: number) => cancelAnimationFrame(handle);

function defaultIsHidden(): boolean {
	return typeof document !== 'undefined' && document.hidden;
}

function defaultReducedMotion(): boolean {
	if (typeof window === 'undefined' || !window.matchMedia) return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function defaultWakeTargets(): EventTarget[] {
	// `visibilitychange` and `resume` land on the document, `pageshow` and `focus` on
	// the window. Listening to both on both is harmless and saves a per-event table.
	const targets: EventTarget[] = [];
	if (typeof document !== 'undefined') targets.push(document);
	if (typeof window !== 'undefined') targets.push(window);
	return targets;
}

const defaultStartWatchdog = (tick: () => void, everyMs: number) =>
	setInterval(tick, everyMs) as unknown as number;

const defaultStopWatchdog = (handle: number) => clearInterval(handle);

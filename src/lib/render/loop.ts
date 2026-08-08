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
	raf?: (cb: FrameRequestCallback) => number;
	cancelRaf?: (handle: number) => void;
	isHidden?: () => boolean;
	prefersReducedMotion?: () => boolean;
	wakeTarget?: EventTarget;
};

export type RenderLoop = { start(): void; stop(): void };

/**
 * A resumed tab reports a gap as wide as the time it spent hidden. Clamping keeps
 * every creature's drift proportional to a plausible frame rather than teleporting
 * it across the tank on the first visible frame.
 */
const MAX_FRAME_MS = 100;

export function createRenderLoop(options: RenderLoopOptions): RenderLoop {
	const raf = options.raf ?? defaultRaf;
	const cancelRaf = options.cancelRaf ?? defaultCancelRaf;
	const isHidden = options.isHidden ?? defaultIsHidden;
	const prefersReducedMotion = options.prefersReducedMotion ?? defaultReducedMotion;
	const wakeTarget = options.wakeTarget ?? defaultWakeTarget();

	let handle: number | undefined;
	let running = false;
	let lastTime: number | undefined;

	function frame(time: number) {
		handle = undefined;

		// `lastTime` is cleared whenever the loop pauses, so the frame after a resume
		// starts fresh instead of inheriting the gap.
		const dt = lastTime === undefined ? 0 : Math.min(time - lastTime, MAX_FRAME_MS);
		lastTime = time;

		try {
			options.draw({ time, dt, animate: !prefersReducedMotion() });
		} catch (error) {
			// A single bad frame must not end the session. Report and keep going.
			console.error('Tank draw failed', error);
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

	const onVisibilityChange = () => {
		if (isHidden()) pause();
		else schedule();
	};

	return {
		start() {
			if (running) return;
			running = true;
			wakeTarget?.addEventListener('visibilitychange', onVisibilityChange);
			schedule();
		},

		stop() {
			running = false;
			pause();
			wakeTarget?.removeEventListener('visibilitychange', onVisibilityChange);
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

function defaultWakeTarget(): EventTarget | undefined {
	return typeof document === 'undefined' ? undefined : document;
}

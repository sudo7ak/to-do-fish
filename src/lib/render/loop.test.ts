import { describe, it, expect, vi } from 'vitest';
import { createRenderLoop, type Frame } from './loop';

/** Drives frames by hand so the loop can be tested without a browser. */
function fakeRaf() {
	let next = 1;
	const pending = new Map<number, FrameRequestCallback>();

	return {
		raf: (cb: FrameRequestCallback) => {
			const id = next++;
			pending.set(id, cb);
			return id;
		},
		cancel: (id: number) => pending.delete(id),
		/**
		 * Throws away scheduled callbacks without running them — what a mobile browser
		 * does to a frozen tab. The loop is never told.
		 */
		drop: () => pending.clear(),
		/** Runs whatever is currently scheduled, at the given timestamp. */
		flush(time: number) {
			const callbacks = [...pending.entries()];
			pending.clear();
			for (const [, cb] of callbacks) cb(time);
		},
		get scheduled() {
			return pending.size;
		}
	};
}

/** A hand-driven stand-in for setInterval, so the watchdog can be ticked on demand. */
function fakeTimer() {
	let cb: (() => void) | undefined;
	return {
		start: (fn: () => void) => {
			cb = fn;
			return 1;
		},
		stop: () => {
			cb = undefined;
		},
		tick() {
			cb?.();
		},
		get armed() {
			return cb !== undefined;
		}
	};
}

function setup(over: Parameters<typeof createRenderLoop>[0] extends never ? never : object = {}) {
	const clock = fakeRaf();
	const frames: Frame[] = [];
	const wakeTarget = new EventTarget();
	const timer = fakeTimer();
	let hidden = false;
	let now = 0;

	const loop = createRenderLoop({
		draw: (frame) => frames.push(frame),
		raf: clock.raf,
		cancelRaf: clock.cancel,
		isHidden: () => hidden,
		wakeTargets: [wakeTarget],
		startWatchdog: timer.start,
		stopWatchdog: timer.stop,
		now: () => now,
		...over
	});

	return {
		loop,
		clock,
		frames,
		wakeTarget,
		timer,
		advance(ms: number) {
			now += ms;
		},
		/** Backgrounds the tab the way a browser that still reports visibility does. */
		hide() {
			hidden = true;
			wakeTarget.dispatchEvent(new Event('visibilitychange'));
		},
		show() {
			hidden = false;
			wakeTarget.dispatchEvent(new Event('visibilitychange'));
		},
		/** Backgrounds the tab silently: the scheduled frame is dropped, no event fires. */
		dropFrames() {
			clock.drop();
		},
		wake(event: string) {
			wakeTarget.dispatchEvent(new Event(event));
		}
	};
}

describe('render loop — running', () => {
	it('draws a frame once started', () => {
		const { loop, clock, frames } = setup();

		loop.start();
		clock.flush(16);

		expect(frames).toHaveLength(1);
		loop.stop();
	});

	it('keeps drawing frame after frame', () => {
		const { loop, clock, frames } = setup();

		loop.start();
		clock.flush(16);
		clock.flush(32);
		clock.flush(48);

		expect(frames).toHaveLength(3);
		loop.stop();
	});

	it('reports elapsed time between frames', () => {
		const { loop, clock, frames } = setup();

		loop.start();
		clock.flush(100);
		clock.flush(116);

		expect(frames[1].dt).toBe(16);
		loop.stop();
	});

	it('starts the first frame at zero elapsed rather than the epoch', () => {
		const { loop, clock, frames } = setup();

		loop.start();
		clock.flush(5000);

		expect(frames[0].dt).toBe(0);
		loop.stop();
	});

	it('ignores a second start — one loop, not two', () => {
		const { loop, clock, frames } = setup();

		loop.start();
		loop.start();
		clock.flush(16);

		expect(frames).toHaveLength(1);
		loop.stop();
	});

	it('schedules nothing more once stopped', () => {
		const { loop, clock, frames } = setup();

		loop.start();
		clock.flush(16);
		loop.stop();
		clock.flush(32);

		expect(frames).toHaveLength(1);
		expect(clock.scheduled).toBe(0);
	});
});

describe('render loop — hidden tab', () => {
	it('pauses while the tab is hidden', () => {
		const { loop, clock, frames, hide } = setup();

		loop.start();
		clock.flush(16);
		hide();
		clock.flush(32);

		expect(frames).toHaveLength(1);
		loop.stop();
	});

	it('resumes when the tab comes back', () => {
		const { loop, clock, frames, hide, show } = setup();

		loop.start();
		clock.flush(16);
		hide();
		show();
		clock.flush(5000);

		expect(frames).toHaveLength(2);
		loop.stop();
	});

	it('does not report the whole hidden stretch as one enormous frame', () => {
		// A tab hidden for an hour must not resume with dt = 3,600,000ms, or every
		// drifting creature teleports across the tank on the first visible frame.
		const { loop, clock, frames, hide, show } = setup();

		loop.start();
		clock.flush(16);
		hide();
		show();
		clock.flush(3_600_000);

		expect(frames[1].dt).toBeLessThanOrEqual(100);
		loop.stop();
	});

	it('never starts while already hidden', () => {
		const { loop, clock, frames, hide } = setup();

		hide();
		loop.start();
		clock.flush(16);

		expect(frames).toHaveLength(0);
		loop.stop();
	});

	it('stops listening for visibility once stopped', () => {
		const { loop, clock, frames, hide, show } = setup();

		loop.start();
		loop.stop();
		hide();
		show();
		clock.flush(16);

		expect(frames).toHaveLength(0);
	});

	it('stops listening for every other wake event once stopped', () => {
		const { loop, clock, frames, wake } = setup();

		loop.start();
		loop.stop();
		for (const event of ['pageshow', 'resume', 'focus']) wake(event);
		clock.flush(16);

		expect(frames).toHaveLength(0);
	});
});

describe('render loop — a frozen tab', () => {
	// Mobile Chrome freezes a backgrounded tab: the scheduled frame is dropped and
	// no `visibilitychange` need ever fire. The loop must not be left believing a
	// frame is still in flight, or every later wake-up is a no-op and the tank is
	// dead until reload. This shipped.
	it('recovers when the frame in flight was dropped and only pageshow fires', () => {
		const { loop, clock, frames, dropFrames, wake } = setup();

		loop.start();
		clock.flush(16);
		dropFrames();
		wake('pageshow');
		clock.flush(32);

		expect(frames).toHaveLength(2);
		loop.stop();
	});

	it('recovers on resume, which is all a thawed tab gets', () => {
		const { loop, clock, frames, dropFrames, wake } = setup();

		loop.start();
		clock.flush(16);
		dropFrames();
		wake('resume');
		clock.flush(32);

		expect(frames).toHaveLength(2);
		loop.stop();
	});

	it('recovers on focus', () => {
		const { loop, clock, frames, dropFrames, wake } = setup();

		loop.start();
		clock.flush(16);
		dropFrames();
		wake('focus');
		clock.flush(32);

		expect(frames).toHaveLength(2);
		loop.stop();
	});

	it('restarts a visible tank that has gone quiet, with no wake event at all', () => {
		// The watchdog is the backstop: timers survive where requestAnimationFrame
		// does not, so a tank that stopped drawing while visible comes back by itself.
		const { loop, clock, frames, dropFrames, timer, advance } = setup();

		loop.start();
		clock.flush(16);
		dropFrames();
		advance(5000);
		timer.tick();
		clock.flush(32);

		expect(frames).toHaveLength(2);
		loop.stop();
	});

	it('leaves a healthy loop alone', () => {
		const { loop, clock, frames, timer, advance } = setup();

		loop.start();
		clock.flush(16);
		advance(200);
		timer.tick();
		clock.flush(32);

		expect(frames).toHaveLength(2);
		expect(clock.scheduled).toBe(1);
		loop.stop();
	});

	it('does not revive a hidden tab', () => {
		const { loop, clock, frames, hide, timer, advance } = setup();

		loop.start();
		clock.flush(16);
		hide();
		advance(5000);
		timer.tick();
		clock.flush(32);

		expect(frames).toHaveLength(1);
		loop.stop();
	});

	it('stops the watchdog when the loop stops', () => {
		const { loop, timer } = setup();

		loop.start();
		expect(timer.armed).toBe(true);
		loop.stop();

		expect(timer.armed).toBe(false);
	});

	it('does not report the frozen stretch as one enormous frame', () => {
		const { loop, clock, frames, dropFrames, wake } = setup();

		loop.start();
		clock.flush(16);
		dropFrames();
		wake('resume');
		clock.flush(3_600_000);

		expect(frames[1].dt).toBeLessThanOrEqual(100);
		loop.stop();
	});
});

describe('render loop — reduced motion', () => {
	it('animates by default', () => {
		const { loop, clock, frames } = setup();

		loop.start();
		clock.flush(16);

		expect(frames[0].animate).toBe(true);
		loop.stop();
	});

	it('freezes ambient drift when reduced motion is preferred', () => {
		const { loop, clock, frames } = setup({ prefersReducedMotion: () => true });

		loop.start();
		clock.flush(16);

		expect(frames[0].animate).toBe(false);
		loop.stop();
	});

	it('still draws frames under reduced motion, so state changes can play', () => {
		// The bubble pop and the fish ghosting are information, not decoration.
		const { loop, clock, frames } = setup({ prefersReducedMotion: () => true });

		loop.start();
		clock.flush(16);
		clock.flush(32);

		expect(frames).toHaveLength(2);
		loop.stop();
	});
});

describe('render loop — draw errors', () => {
	it('keeps running when a draw throws', () => {
		// One bad frame must not kill the tank for the rest of the session.
		const draw = vi
			.fn()
			.mockImplementationOnce(() => {
				throw new Error('bad frame');
			})
			.mockImplementation(() => {});
		const { loop, clock } = setup({ draw });

		loop.start();
		clock.flush(16);
		clock.flush(32);

		expect(draw).toHaveBeenCalledTimes(2);
		loop.stop();
	});
});

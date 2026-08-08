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

function setup(over: Parameters<typeof createRenderLoop>[0] extends never ? never : object = {}) {
	const clock = fakeRaf();
	const frames: Frame[] = [];
	const wakeTarget = new EventTarget();
	let hidden = false;

	const loop = createRenderLoop({
		draw: (frame) => frames.push(frame),
		raf: clock.raf,
		cancelRaf: clock.cancel,
		isHidden: () => hidden,
		wakeTarget,
		...over
	});

	return {
		loop,
		clock,
		frames,
		wakeTarget,
		hide() {
			hidden = true;
			wakeTarget.dispatchEvent(new Event('visibilitychange'));
		},
		show() {
			hidden = false;
			wakeTarget.dispatchEvent(new Event('visibilitychange'));
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

import { describe, it, expect } from 'vitest';
import { resolveTap, type TapOrigin } from './tap';

const origin = (over: Partial<TapOrigin> = {}): TapOrigin => ({
	id: 1,
	clientX: 100,
	clientY: 100,
	point: { x: 40, y: 60 },
	time: 1234,
	...over
});

describe('resolveTap', () => {
	it('resolves to the origin point and time for a tap that does not move', () => {
		const result = resolveTap(origin(), { id: 1, clientX: 100, clientY: 100 }, 20);

		expect(result).toEqual({ point: { x: 40, y: 60 }, time: 1234 });
	});

	it('still resolves to the origin when the release drifts within slop', () => {
		const result = resolveTap(origin(), { id: 1, clientX: 112, clientY: 100 }, 20);

		expect(result).toEqual({ point: { x: 40, y: 60 }, time: 1234 });
	});

	it('treats movement past slop as a scroll, not a tap', () => {
		const result = resolveTap(origin(), { id: 1, clientX: 130, clientY: 100 }, 20);

		expect(result).toBeNull();
	});

	it('rejects a release from a different pointer id', () => {
		const result = resolveTap(origin({ id: 1 }), { id: 2, clientX: 100, clientY: 100 }, 20);

		expect(result).toBeNull();
	});

	it('rejects a release with no active gesture', () => {
		const result = resolveTap(null, { id: 1, clientX: 100, clientY: 100 }, 20);

		expect(result).toBeNull();
	});
});

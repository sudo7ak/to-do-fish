/**
 * Deterministic per-id randomness. Shared by species choice and drawing, so the same
 * task is the same fish, in the same lane, on every reload.
 */

/** Stable 32-bit seed for an id. */
export function hash(id: string): number {
	let value = 0;
	for (let i = 0; i < id.length; i++) {
		value = (value * 31 + id.charCodeAt(i)) >>> 0;
	}
	return value;
}

/**
 * Avalanches a seed into [0, 1). Sibling ids like `t-aaa` and `t-bbb` differ only in
 * their low bits; without mixing, anything derived from the high bits comes out
 * identical for all of them.
 */
export function mix32(seed: number): number {
	let x = (seed ^ 0x9e3779b9) >>> 0;
	x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
	x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
	x = (x ^ (x >>> 16)) >>> 0;
	return x / 4294967296;
}

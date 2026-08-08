/**
 * ULIDs, generated client-side. Sortable by creation time and globally unique
 * without coordination — per-device counters would collide the moment a second
 * device appeared, and that is expensive to retrofit once real data exists.
 *
 * 26 characters: 10 of millisecond timestamp, 16 of randomness, Crockford base32.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // no I, L, O, U — unambiguous when read aloud
const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTime = -1;
let lastRandom: number[] = [];

export function ulid(now: number = Date.now()): string {
	if (now === lastTime) {
		// Same millisecond: increment the previous randomness so ids stay strictly
		// ordered rather than shuffling within the tie.
		lastRandom = increment(lastRandom);
	} else {
		lastTime = now;
		lastRandom = randomChars();
	}

	return encodeTime(now) + lastRandom.map((i) => ENCODING[i]).join('');
}

function encodeTime(now: number): string {
	let out = '';
	let remaining = now;
	for (let i = 0; i < TIME_LEN; i++) {
		out = ENCODING[remaining % 32] + out;
		remaining = Math.floor(remaining / 32);
	}
	return out;
}

function randomChars(): number[] {
	const bytes = new Uint8Array(RANDOM_LEN);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b % 32);
}

/** Carries left through the base32 digits, as ULID's monotonic rule requires. */
function increment(chars: number[]): number[] {
	const out = [...chars];
	for (let i = out.length - 1; i >= 0; i--) {
		if (out[i] < 31) {
			out[i]++;
			return out;
		}
		out[i] = 0;
	}
	// Overflowed all 80 bits within one millisecond. Not reachable in practice.
	return randomChars();
}

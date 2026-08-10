/**
 * How long ago, in words — the relative part only, so callers can compose it into
 * "Synced 3 minutes ago" or "Last synced 3 minutes ago".
 *
 * `now` is a parameter rather than a `Date.now()` call so the whole thing is a pure
 * function of two numbers and its boundaries can be tested exactly.
 */
export function ago(at: number, now: number): string {
	// A clock behind the server's produces a future timestamp. "-4 minutes ago" reads
	// as a bug; rounding it to now is a harmless lie about a few seconds.
	const elapsed = Math.max(0, now - at);

	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 1) return 'just now';
	if (minutes < 60) return count(minutes, 'minute');

	const hours = Math.floor(minutes / 60);
	if (hours < 24) return count(hours, 'hour');

	return count(Math.floor(hours / 24), 'day');
}

const count = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

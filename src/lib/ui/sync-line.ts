import type { SyncStatus } from '$lib/persist/sync/syncing';
import { ago } from './ago';

/** Failures that will never fix themselves say so; `offline` will, and stays mild. */
const TROUBLE: Record<SyncStatus['state'], string> = {
	idle: '',
	syncing: '',
	offline: 'Not syncing — offline',
	denied: 'Not syncing — sign in again',
	stale: 'Not syncing — this device is out of date',
	rejected: 'Not syncing — the server refused this data',
	skewed: "Syncing, but this device's clock looks wrong",
	storage: 'Not syncing — local storage is unavailable'
};

/**
 * The one line SyncPanel shows for the state of sync, as a pure function of props
 * so its five shapes (nothing yet, syncing, success, failure with a prior success,
 * failure with none) can be tested by string equality rather than by rendering.
 */
export function syncLine(status: SyncStatus, now: number): string {
	const trouble = TROUBLE[status.state];
	const last = status.at === undefined ? undefined : ago(status.at, now);

	// A failure still reports the last success: knowing sync is broken matters
	// less than knowing how stale the tank is because of it.
	if (trouble) return last ? `${trouble}. Last synced ${last}.` : trouble;
	if (status.state === 'syncing') return 'Syncing…';
	return last ? `Synced ${last}` : 'Not synced yet';
}

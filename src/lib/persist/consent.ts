/**
 * Cookie consent flag for non-essential third-party scripts (Carbon Ads).
 *
 * Stored separately from the task snapshot so it survives a snapshot quarantine
 * and is not touched by the sync merge. UK PECR requires explicit opt-in before
 * non-essential cookies are set; this is the single source of truth for that
 * decision.
 *
 * Values:
 *   'granted'  — user accepted; Carbon Ads may load.
 *   'denied'   — user declined; Carbon Ads must not load.
 *   null       — no decision yet; consent banner must be shown.
 */

const KEY = 'fish-tank-todo/cookie-consent';

export type ConsentState = 'granted' | 'denied';

export function readConsent(): ConsentState | null {
	try {
		const raw = localStorage.getItem(KEY);
		if (raw === 'granted' || raw === 'denied') return raw;
		return null;
	} catch {
		// localStorage unavailable — treat as denied to be safe.
		return 'denied';
	}
}

export function writeConsent(state: ConsentState): void {
	try {
		localStorage.setItem(KEY, state);
	} catch {
		// Ignore — if storage is unavailable we simply won't remember the choice.
	}
}

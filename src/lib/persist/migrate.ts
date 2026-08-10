import { SCHEMA_VERSION, type Snapshot } from '../types';

/**
 * Stored data is migrated forward on load rather than discarded. Each step takes
 * the shape at version N and returns the shape at N + 1, so a snapshot from any
 * past version reaches the current one by running the steps in order.
 *
 * A blob with no `version` field is version 0 — written before versioning existed.
 */
type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

const migrations: Record<number, Migration> = {
	// 0 -> 1: `koi` and `settings` did not exist yet.
	0: (data) => ({
		...data,
		koi: Array.isArray(data.koi) ? data.koi : [],
		settings:
			typeof data.settings === 'object' && data.settings !== null
				? data.settings
				: { environment: 'progress' }
	}),

	// 1 -> 2: `seenLegend` did not exist yet.
	//
	// TRUE, not false. The obvious reading of a new boolean field is "default it off",
	// and that is wrong here: reaching this step at all means there was stored data,
	// which means the app has been used. Only a fresh install — which has no snapshot
	// to migrate and takes `emptySnapshot()` instead — should be shown the legend.
	//
	// A v0 blob reaches `true` through this step as well, so the v0 fallback above
	// needs no change.
	1: (data) => {
		const settings =
			typeof data.settings === 'object' && data.settings !== null
				? (data.settings as Record<string, unknown>)
				: {};
		return { ...data, settings: { ...settings, seenLegend: true } };
	},

	// 2 -> 3: settings gained their own `updatedAt`, because the whole record is the
	// unit of last-write-wins once a second device exists.
	//
	// ZERO, not the current time. Stored settings predate sync, so they must lose to
	// anything a synced device has actually chosen. Stamping them "now" would let a
	// device that has never been configured overwrite one that has.
	2: (data) => {
		const settings =
			typeof data.settings === 'object' && data.settings !== null
				? (data.settings as Record<string, unknown>)
				: {};
		return { ...data, settings: { ...settings, updatedAt: 0 } };
	}
};

export type MigrationResult =
	| { ok: true; snapshot: Snapshot }
	/** Unreadable, wrongly shaped, or from a version this build does not know. */
	| { ok: false };

export function migrate(parsed: unknown): MigrationResult {
	if (typeof parsed !== 'object' || parsed === null) return { ok: false };

	const data = parsed as Record<string, unknown>;
	const version = typeof data.version === 'number' ? data.version : 0;

	// A version from the future cannot be migrated backward, and guessing at its
	// shape would corrupt it. Treat it as unreadable and preserve the original.
	if (version > SCHEMA_VERSION || version < 0) return { ok: false };

	let current = data;
	for (let v = version; v < SCHEMA_VERSION; v++) {
		const step = migrations[v];
		if (!step) return { ok: false };
		current = step(current);
	}

	const snapshot = { ...current, version: SCHEMA_VERSION };
	return isSnapshot(snapshot) ? { ok: true, snapshot } : { ok: false };
}

/**
 * Structural check only. Guards against a blob that parsed but is not ours; it does
 * not validate every task field, which would reject data a future version could
 * still read.
 */
function isSnapshot(value: Record<string, unknown>): value is Snapshot {
	return (
		Array.isArray(value.tasks) &&
		Array.isArray(value.koi) &&
		typeof value.settings === 'object' &&
		value.settings !== null
	);
}

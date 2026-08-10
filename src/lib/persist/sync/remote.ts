import { SCHEMA_VERSION, type Snapshot } from '../../types';
import type { Push } from './merge';
import {
	fromKoiRow,
	fromSettingsRow,
	fromTaskRow,
	toKoiRow,
	toSettingsRow,
	toTaskRow,
	type KoiRow,
	type SettingsRow,
	type TaskRow
} from './rows';

/**
 * The only file in the app that talks to Supabase.
 *
 * It reads and writes and classifies its failures; it decides nothing. Every rule
 * about which side wins lives in `merge.ts`, which has no idea this file exists.
 */

/** The slice of the Supabase client actually used, so a test can supply a fake. */
export type SupabaseLike = {
	from(table: string): {
		select(columns?: string): Promise<{ data: unknown[] | null; error: unknown }>;
		upsert(rows: unknown[], options?: { onConflict: string }): Promise<{ error: unknown }>;
	};
};

export interface Remote {
	pull(): Promise<Snapshot>;
	push(push: Push): Promise<void>;
}

/**
 * Sync failed. `reason` exists because the three cases want three different
 * sentences: network is "we will retry", denied is "something is wrong with this
 * account", schema is "this device is out of date".
 */
export class SyncUnavailableError extends Error {
	readonly reason: 'network' | 'denied' | 'schema';

	constructor(reason: SyncUnavailableError['reason'], message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'SyncUnavailableError';
		this.reason = reason;
	}
}

export class SupabaseRemote implements Remote {
	#client: SupabaseLike;
	#userId: string;

	/**
	 * The schema version last seen on the server. Remembered from the pull so a push
	 * can refuse rather than overwrite rows a newer client wrote.
	 */
	#remoteVersion = SCHEMA_VERSION;

	constructor(client: SupabaseLike, userId: string) {
		this.#client = client;
		this.#userId = userId;
	}

	async pull(): Promise<Snapshot> {
		const [tasks, koi, settings] = await Promise.all([
			this.#select<TaskRow>('tasks'),
			this.#select<KoiRow>('koi'),
			this.#select<SettingsRow>('settings')
		]);

		const row = settings[0];
		this.#remoteVersion = row?.version ?? SCHEMA_VERSION;

		return {
			version: SCHEMA_VERSION,
			tasks: tasks.map(fromTaskRow),
			koi: koi.map(fromKoiRow),
			// An account with no settings row yet is not an error; it is a first sync.
			settings: row
				? fromSettingsRow(row)
				: { environment: 'progress', seenLegend: false, updatedAt: 0 }
		};
	}

	async push(snapshot: Push): Promise<void> {
		if (this.#remoteVersion > SCHEMA_VERSION) {
			throw new SyncUnavailableError(
				'schema',
				'This device is out of date and will not overwrite newer data'
			);
		}

		await this.#upsert(
			'tasks',
			snapshot.tasks.map((task) => toTaskRow(task, this.#userId)),
			'user_id,id'
		);
		await this.#upsert(
			'koi',
			snapshot.koi.map((record) => toKoiRow(record, this.#userId)),
			'user_id,date'
		);
		if (snapshot.settings) {
			await this.#upsert(
				'settings',
				[toSettingsRow(snapshot.settings, this.#userId, SCHEMA_VERSION)],
				'user_id'
			);
		}
	}

	async #select<T>(table: string): Promise<T[]> {
		const { data, error } = await this.#client.from(table).select('*');
		if (error) throw classify(error, `Could not read ${table}`);
		return (data ?? []) as T[];
	}

	async #upsert(table: string, rows: unknown[], onConflict: string): Promise<void> {
		// Zero rows is the quiet-sync case and worth not sending.
		if (rows.length === 0) return;

		const { error } = await this.#client.from(table).upsert(rows, { onConflict });
		if (error) throw classify(error, `Could not write ${table}`);
	}
}

/**
 * Postgres `42501` is insufficient_privilege, which here means RLS refused — a
 * broken account or a missing policy, not a flaky connection, so it must not be
 * retried in a loop.
 */
function classify(error: unknown, message: string): SyncUnavailableError {
	const code = (error as { code?: string })?.code;
	const reason = code === '42501' ? 'denied' : 'network';
	return new SyncUnavailableError(reason, message, { cause: error });
}

import { SCHEMA_VERSION } from '../../types';
import type { Push, RemoteSnapshot } from './merge';
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
		select(columns?: string): {
			eq(column: string, value: string): Promise<{ data: unknown[] | null; error: unknown }>;
		};
		upsert(rows: unknown[], options?: { onConflict: string }): Promise<{ error: unknown }>;
	};
};

export interface Remote {
	pull(): Promise<RemoteSnapshot>;
	push(push: Push): Promise<void>;
}

/**
 * Sync failed. `reason` exists because the three cases want three different
 * sentences: network is "we will retry", denied is "something is wrong with this
 * account", schema is "this device is out of date".
 */
export class SyncUnavailableError extends Error {
	readonly reason: 'network' | 'denied' | 'schema' | 'rejected';

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
	 * The schema version last seen on the server. `undefined` means "never pulled",
	 * which must refuse a push exactly like an out-of-date server does — a push
	 * before any pull has no idea what it would be overwriting.
	 */
	#remoteVersion: number | undefined;

	constructor(client: SupabaseLike, userId: string) {
		this.#client = client;
		this.#userId = userId;
	}

	async pull(): Promise<RemoteSnapshot> {
		const [tasks, koi, settings] = await Promise.all([
			this.#select<TaskRow>('tasks'),
			this.#select<KoiRow>('koi'),
			this.#select<SettingsRow>('settings')
		]);

		const row = settings[0];
		this.#remoteVersion = row?.version ?? SCHEMA_VERSION;

		return {
			// The version actually found, not this build's. The caller has to be able to
			// tell that the rows it just read were written by a newer client, or it will
			// store them under a version number that is a lie and they will never be
			// migrated.
			version: this.#remoteVersion,
			tasks: tasks.map(fromTaskRow),
			koi: koi.map(fromKoiRow),
			// An account with no settings row yet is not an error; it is a first sync,
			// and `undefined` says so. Synthesising a default here would manufacture a
			// record that competes with the local one and, on a tie, beats it.
			...(row ? { settings: fromSettingsRow(row) } : {})
		};
	}

	async push(snapshot: Push): Promise<void> {
		if (this.#remoteVersion === undefined) {
			throw new SyncUnavailableError(
				'schema',
				'The remote schema version has not been read yet; pull before pushing'
			);
		}
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

	/**
	 * Filtered by `user_id` even though RLS already scopes the read. RLS is the
	 * boundary and stays it; this is the second line. Without it a policy typo does
	 * not degrade gracefully — `fromTaskRow` drops `user_id`, so a row belonging to
	 * someone else becomes indistinguishable from your own the moment it is mapped,
	 * and the next push re-homes it under your id.
	 */
	async #select<T>(table: string): Promise<T[]> {
		const { data, error } = await this.#client.from(table).select('*').eq('user_id', this.#userId);
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
 *
 * The integrity codes matter for the same reason and fail differently: the server
 * understood the write and refused the data. Retrying sends the identical rows to
 * the identical rejection forever, and calling that "offline" points the user at
 * their signal when the truth is that this build and the database disagree about
 * what a task looks like. `23514` is a violated check constraint — the shape rules
 * in `supabase/constraints.sql` — and `23505` / `23503` are a broken key.
 */
const REJECTED = new Set(['23514', '23505', '23503', '22P02']);

function classify(error: unknown, message: string): SyncUnavailableError {
	const code = (error as { code?: string })?.code;
	if (code === '42501') return new SyncUnavailableError('denied', message, { cause: error });
	if (code && REJECTED.has(code)) {
		return new SyncUnavailableError('rejected', message, { cause: error });
	}
	return new SyncUnavailableError('network', message, { cause: error });
}

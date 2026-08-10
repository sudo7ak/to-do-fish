import type { Condition, KoiRecord, Settings, Task, TaskStatus } from '../../types';

/**
 * The row shapes, and the translation to and from the domain.
 *
 * Kept apart from the Supabase client so the one genuinely dangerous rule here —
 * absent stays absent, and never becomes null — can be tested without a network.
 * `isLive()` asks whether `deletedAt` is present, so a `null` leaking into the
 * domain would make a deleted task swim again.
 */

export type TaskRow = {
	user_id: string;
	id: string;
	title: string;
	date: string;
	condition: Condition | null;
	treat_cost: number | null;
	status: TaskStatus;
	created_at: number;
	completed_at: number | null;
	updated_at: number;
	deleted_at: number | null;
};

export type KoiRow = { user_id: string; date: string; earned_at: number };

export type SettingsRow = {
	user_id: string;
	environment: Settings['environment'];
	seen_legend: boolean;
	version: number;
	updated_at: number;
};

/** Present stays present, absent becomes null. The inverse of `optional`. */
const nullable = <T>(value: T | undefined): T | null => (value === undefined ? null : value);

/**
 * Spreads to `{}` when the column is null, so the key is genuinely absent rather
 * than present-and-undefined. `{ deletedAt: undefined }` fails an `'in'` check but
 * passes a truthiness check, and the two would disagree.
 */
const optional = <K extends string, T>(key: K, value: T | null) =>
	value === null ? {} : ({ [key]: value } as Record<K, T>);

export function toTaskRow(task: Task, userId: string): TaskRow {
	return {
		user_id: userId,
		id: task.id,
		title: task.title,
		date: task.date,
		condition: nullable(task.condition),
		treat_cost: nullable(task.treatCost),
		status: task.status,
		created_at: task.createdAt,
		completed_at: nullable(task.completedAt),
		updated_at: task.updatedAt,
		deleted_at: nullable(task.deletedAt)
	};
}

export function fromTaskRow(row: TaskRow): Task {
	return {
		id: row.id,
		title: row.title,
		date: row.date,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		...optional('condition', row.condition),
		...optional('treatCost', row.treat_cost),
		...optional('completedAt', row.completed_at),
		...optional('deletedAt', row.deleted_at)
	};
}

export function toKoiRow(record: KoiRecord, userId: string): KoiRow {
	return { user_id: userId, date: record.date, earned_at: record.earnedAt };
}

export function fromKoiRow(row: KoiRow): KoiRecord {
	return { date: row.date, earnedAt: row.earned_at };
}

export function toSettingsRow(settings: Settings, userId: string, version: number): SettingsRow {
	return {
		user_id: userId,
		environment: settings.environment,
		seen_legend: settings.seenLegend,
		version,
		updated_at: settings.updatedAt
	};
}

export function fromSettingsRow(row: SettingsRow): Settings {
	return {
		environment: row.environment,
		seenLegend: row.seen_legend,
		updatedAt: row.updated_at
	};
}

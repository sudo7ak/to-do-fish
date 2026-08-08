import type { Settings } from '../types';

/**
 * Both environments render the same scene. Only the palette function and the mood
 * number's visibility differ, so this is a single flag rather than two code paths.
 */
export type Environment = Settings['environment'];

export const ENVIRONMENTS: readonly Environment[] = ['progress', 'calm'] as const;

/** Progress shows a mood number and clears the water as the day is finished; Calm holds one bright palette. */
export function showsMoodNumber(settings: Settings): boolean {
	return settings.environment === 'progress';
}

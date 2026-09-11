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

/**
 * Whether to show the legend unasked.
 *
 * A pure predicate rather than a condition inline in the page, so the rule is
 * testable without mounting anything. One-way: the flag is written the moment the
 * legend is shown, not when it is closed, so a reload mid-view does not re-open it.
 */
export function shouldAutoOpen(settings: Settings): boolean {
	return !settings.seenLegend;
}

/**
 * Whether the hint fish still swims — the one-time onboarding creature that teaches
 * "tap open water to see every task's name." One-way, same as `shouldAutoOpen`: the
 * flag is written the moment it is popped, not before, so a reload mid-session does
 * not make it vanish before it was ever tapped.
 */
export function shouldShowRevealHint(settings: Settings): boolean {
	return !settings.seenRevealHint;
}

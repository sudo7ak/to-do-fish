/**
 * The tank's colours, taken from the reference frames.
 *
 * Both environments render the same scene; only this function and the mood number's
 * visibility differ. Progress interpolates between the loaded and calm palettes on
 * percent-done-today, so the water clears as the day is finished. Calm pins the
 * clear palette permanently.
 *
 * This is the one file in `render/` that knows a colour, so retinting the app means
 * editing here rather than hunting through drawing code.
 */

/**
 * Declared here rather than imported from the domain model: `render/` stays free of
 * any dependency on task data, structurally and not by convention.
 */
export type Environment = 'progress' | 'calm';

export type Palette = {
	waterTop: string;
	/** Mid-water, so the column is a three-stop gradient rather than a flat wash. */
	waterMid: string;
	waterBottom: string;
	plants: string;
	/** Second planting tone, for the layer sitting further back. */
	plantsDeep: string;
	sand: string;
	rock: string;
	/** Strength of the caustics and god rays, 0–1. Murky water scatters less light. */
	light: number;
	fish: string;
	lantern: string;
	pearl: string;
	glass: string;
};

/**
 * The two ends of the Progress interpolation.
 *
 * Calm is deliberately saturated: this is a lit aquarium, not a pond. Loaded keeps
 * the same hues but drains them towards slate, so the shift reads as the water
 * clouding rather than as a different tank.
 */
export const CALM = {
	waterTop: '#8FE3F2',
	waterMid: '#43C4E0',
	waterBottom: '#1E86AE',
	plants: '#5FD16B',
	plantsDeep: '#2F9E62',
	sand: '#F0DFB4',
	rock: '#6E8A94',
	light: 1
} as const;

export const LOADED = {
	waterTop: '#5A7A85',
	waterMid: '#47646F',
	waterBottom: '#2C4450',
	plants: '#4A7A4E',
	plantsDeep: '#2E5540',
	sand: '#9A9078',
	rock: '#4A5A62',
	light: 0.35
} as const;

/** Creature colours hold steady — a fish is the same red whether the day is loaded or clear. */
const FIXED = {
	fish: '#E8543C',
	lantern: '#FFC46B',
	pearl: '#EAF6F8',
	glass: 'rgba(255, 255, 255, 0.15)'
} as const;

export function palette(environment: Environment, clearedPct: number): Palette {
	// Calm holds one bright palette regardless of how the day is going.
	const t = environment === 'calm' ? 1 : clamp01(clearedPct);

	return {
		waterTop: mix(LOADED.waterTop, CALM.waterTop, t),
		waterMid: mix(LOADED.waterMid, CALM.waterMid, t),
		waterBottom: mix(LOADED.waterBottom, CALM.waterBottom, t),
		plants: mix(LOADED.plants, CALM.plants, t),
		plantsDeep: mix(LOADED.plantsDeep, CALM.plantsDeep, t),
		sand: mix(LOADED.sand, CALM.sand, t),
		rock: mix(LOADED.rock, CALM.rock, t),
		light: LOADED.light + (CALM.light - LOADED.light) * t,
		...FIXED
	};
}

/** The number shown beside the date in Progress. Hidden entirely in Calm. */
export function moodPercent(clearedPct: number): number {
	return Math.round(clamp01(clearedPct) * 100);
}

/** The word beside the number. Reads the day back to you rather than scoring you. */
export function moodWord(clearedPct: number): string {
	const pct = clamp01(clearedPct);
	if (pct >= 1) return 'Clear';
	if (pct >= 0.75) return 'Clearing';
	if (pct >= 0.4) return 'Settling';
	if (pct > 0) return 'Murky';
	return 'Silted';
}

function clamp01(value: number): number {
	if (Number.isNaN(value)) return 0;
	return Math.min(1, Math.max(0, value));
}

/** Interpolates two hex colours. `t` of 0 is `from`, 1 is `to`. */
function mix(from: string, to: string, t: number): string {
	if (t <= 0) return from;
	if (t >= 1) return to;

	const a = rgb(from);
	const b = rgb(to);
	const channel = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t);

	return `#${[channel(0), channel(1), channel(2)].map(hex).join('')}`;
}

function rgb(color: string): [number, number, number] {
	return [
		parseInt(color.slice(1, 3), 16),
		parseInt(color.slice(3, 5), 16),
		parseInt(color.slice(5, 7), 16)
	];
}

function hex(value: number): string {
	return value.toString(16).padStart(2, '0');
}

import { hash, mix32 } from './rng';
import type { Profile, Wave } from './spine';

/**
 * What each species looks like, as data.
 *
 * Silhouette carries the identity: at 40px a scale pattern is mush, but the outline
 * of a disc-shaped tang against a torpedo-shaped neon reads instantly. Depth ÷ length
 * runs from 0.35 to 1.15 across the six swimmers, and that spread is deliberate.
 */

export type Species =
	| 'clown'
	| 'tang'
	| 'angel'
	| 'guppy'
	| 'neon'
	| 'betta'
	| 'eel'
	| 'puffer'
	| 'discus'
	| 'koi'
	| 'exotic';

export type FinKind = 'dorsal' | 'anal' | 'pectoral' | 'pelvic' | 'caudal';

export type FinSpec = {
	/** Spine fraction: 0 is the nose, 1 the tail. */
	anchor: number;
	kind: FinKind;
	/** Length as a fraction of body length. */
	span: number;
	/**
	 * How far the fin rakes backwards, as a multiple of `span` — dimensionless, not an
	 * angle. The fin's tip lands `span * sweep` behind its root.
	 */
	sweep: number;
	/**
	 * Phase offset in radians behind the body wave — never frames, frame rate varies.
	 *
	 * It also scales the fin's flutter amplitude (see `traceFin`). That is deliberate
	 * rather than accidental reuse: the fins that trail furthest behind the wave are
	 * the long soft veils, and those are exactly the fins that ripple most. One number
	 * says "this fin is floppy" and both behaviours follow from it.
	 */
	lag: number;
};

export type SpeciesSpec = {
	length: number;
	profile: Profile;
	fins: FinSpec[];
	palette: { back: string; belly: string; fin: string; marking: string; iris: string };
	pattern: 'bands' | 'stripe' | 'spots' | 'none';
	wave: Wave;
};

const caudal = (span: number, sweep = 0.5, lag = 0.9): FinSpec => ({
	anchor: 1,
	kind: 'caudal',
	span,
	sweep,
	lag
});

export const SPECIES: Record<Species, SpeciesSpec> = {
	// Rounded oval, blunt snout, round tail. Depth 0.58.
	clown: {
		length: 42,
		profile: [
			[0, 0.02],
			[0.15, 0.2],
			[0.4, 0.29],
			[0.72, 0.18],
			[0.9, 0.06],
			[1, 0.04]
		],
		fins: [
			caudal(0.3, 0.4, 0.8),
			{ anchor: 0.35, kind: 'dorsal', span: 0.2, sweep: 0.7, lag: 0.5 },
			{ anchor: 0.62, kind: 'anal', span: 0.16, sweep: 0.6, lag: 0.6 },
			{ anchor: 0.28, kind: 'pectoral', span: 0.16, sweep: 0.9, lag: 0.3 }
		],
		palette: {
			back: '#ff8a3d',
			belly: '#e8542c',
			fin: '#ffb877',
			marking: '#fff4e4',
			iris: '#2b1a10'
		},
		pattern: 'bands',
		wave: { amplitude: 0.16, wavelength: 1.1, speed: 7 }
	},

	// Deep disc, pointed snout, thin peduncle, crescent tail. Depth 0.78.
	tang: {
		length: 44,
		profile: [
			[0, 0.02],
			[0.12, 0.22],
			[0.38, 0.39],
			[0.7, 0.26],
			[0.9, 0.05],
			[1, 0.03]
		],
		fins: [
			caudal(0.26, 0.9, 0.9),
			{ anchor: 0.4, kind: 'dorsal', span: 0.26, sweep: 0.5, lag: 0.5 },
			{ anchor: 0.6, kind: 'anal', span: 0.22, sweep: 0.5, lag: 0.6 },
			{ anchor: 0.26, kind: 'pectoral', span: 0.15, sweep: 1, lag: 0.3 }
		],
		palette: {
			back: '#49b6f7',
			belly: '#1b5fc1',
			fin: '#ffd84d',
			marking: '#0e3e86',
			iris: '#10233d'
		},
		pattern: 'none',
		wave: { amplitude: 0.12, wavelength: 1.3, speed: 6 }
	},

	// Taller than long: dorsal and anal fins form a diamond, trailing pelvic filaments.
	angel: {
		length: 34,
		profile: [
			[0, 0.02],
			[0.14, 0.3],
			[0.4, 0.5],
			[0.7, 0.32],
			[0.9, 0.07],
			[1, 0.04]
		],
		fins: [
			caudal(0.3, 0.5, 1.1),
			{ anchor: 0.38, kind: 'dorsal', span: 0.62, sweep: 0.5, lag: 1.2 },
			{ anchor: 0.58, kind: 'anal', span: 0.55, sweep: 0.5, lag: 1.3 },
			{ anchor: 0.5, kind: 'pelvic', span: 0.75, sweep: 0.3, lag: 1.6 },
			{ anchor: 0.24, kind: 'pectoral', span: 0.14, sweep: 1, lag: 0.3 }
		],
		palette: {
			// Cream flank, dusky bronze fins. The fin was `#fff0d2`, a cream lighter than
			// the body's own back, so the diamond that *is* an angelfish disappeared into
			// it — and next to the cream-and-orange koi the whole fish read as a small
			// koi. Real angelfish carry darker, translucent fins than their flanks, so
			// darkening them separates the silhouette and stays naturalistic.
			back: '#ffe9be',
			belly: '#efa63a',
			fin: '#8f6a3a',
			marking: '#6b4a22',
			iris: '#2c1d0c'
		},
		pattern: 'bands',
		wave: { amplitude: 0.1, wavelength: 1.4, speed: 5 }
	},

	// Small slim body, fan tail larger than the body.
	guppy: {
		length: 30,
		profile: [
			[0, 0.02],
			[0.18, 0.16],
			[0.42, 0.22],
			[0.75, 0.12],
			[0.92, 0.05],
			[1, 0.03]
		],
		fins: [
			caudal(0.62, 0.35, 1.3),
			{ anchor: 0.4, kind: 'dorsal', span: 0.22, sweep: 0.8, lag: 0.7 },
			{ anchor: 0.66, kind: 'anal', span: 0.14, sweep: 0.7, lag: 0.7 },
			{ anchor: 0.28, kind: 'pectoral', span: 0.13, sweep: 0.9, lag: 0.3 }
		],
		palette: {
			back: '#93ebff',
			belly: '#4a7be8',
			fin: '#ff93d2',
			marking: '#ffe066',
			iris: '#16233f'
		},
		pattern: 'spots',
		wave: { amplitude: 0.2, wavelength: 0.9, speed: 9 }
	},

	// Slim torpedo, small forked tail. The slimmest silhouette in the tank.
	neon: {
		length: 30,
		profile: [
			[0, 0.02],
			[0.2, 0.13],
			[0.45, 0.17],
			[0.78, 0.09],
			[0.93, 0.04],
			[1, 0.02]
		],
		fins: [
			caudal(0.3, 0.8, 0.8),
			{ anchor: 0.42, kind: 'dorsal', span: 0.14, sweep: 0.8, lag: 0.5 },
			{ anchor: 0.66, kind: 'anal', span: 0.12, sweep: 0.7, lag: 0.6 },
			{ anchor: 0.3, kind: 'pectoral', span: 0.11, sweep: 0.9, lag: 0.3 }
		],
		palette: {
			back: '#6beaff',
			belly: '#1b7fd4',
			fin: '#cff6ff',
			marking: '#ff3b4e',
			iris: '#0d2137'
		},
		pattern: 'stripe',
		wave: { amplitude: 0.22, wavelength: 0.8, speed: 10 }
	},

	// Compact body, enormous trailing veils.
	betta: {
		length: 34,
		profile: [
			[0, 0.02],
			[0.16, 0.2],
			[0.42, 0.3],
			[0.74, 0.18],
			[0.92, 0.06],
			[1, 0.04]
		],
		fins: [
			caudal(0.75, 0.3, 1.5),
			{ anchor: 0.42, kind: 'dorsal', span: 0.5, sweep: 0.5, lag: 1.4 },
			{ anchor: 0.62, kind: 'anal', span: 0.55, sweep: 0.4, lag: 1.5 },
			{ anchor: 0.28, kind: 'pectoral', span: 0.16, sweep: 0.9, lag: 0.4 }
		],
		palette: {
			back: '#ce7bff',
			belly: '#7a2bd1',
			fin: '#ff7fb4',
			marking: '#4a1580',
			iris: '#24103d'
		},
		pattern: 'none',
		wave: { amplitude: 0.14, wavelength: 1.2, speed: 5 }
	},

	// Nearly three times the neon's length and a tenth its depth: the longest, thinnest
	// silhouette in the tank. A short wavelength puts more than one crest along the
	// body, so it ripples end to end instead of sweeping like a fish.
	eel: {
		length: 86,
		profile: [
			[0, 0.012],
			[0.1, 0.04],
			[0.45, 0.045],
			[0.82, 0.034],
			[1, 0.012]
		],
		fins: [
			caudal(0.1, 0.5, 1.2),
			{ anchor: 0.45, kind: 'dorsal', span: 0.05, sweep: 0.5, lag: 1 },
			{ anchor: 0.2, kind: 'pectoral', span: 0.05, sweep: 0.9, lag: 0.4 }
		],
		palette: {
			back: '#3f6fe0',
			belly: '#12246b',
			fin: '#ffd84d',
			marking: '#0b1436',
			iris: '#0b1436'
		},
		pattern: 'none',
		wave: { amplitude: 0.3, wavelength: 0.5, speed: 5 }
	},

	// Round. Nothing else in the tank is, which is the whole point — it reads at a
	// glance even against a crowd. Barely bends, and drifts rather than swims.
	puffer: {
		length: 38,
		profile: [
			[0, 0.05],
			[0.18, 0.33],
			[0.45, 0.4],
			[0.75, 0.27],
			[1, 0.05]
		],
		fins: [
			caudal(0.22, 0.5, 1.1),
			{ anchor: 0.4, kind: 'dorsal', span: 0.13, sweep: 0.6, lag: 0.7 },
			{ anchor: 0.63, kind: 'anal', span: 0.11, sweep: 0.6, lag: 0.8 },
			{ anchor: 0.26, kind: 'pectoral', span: 0.12, sweep: 0.9, lag: 0.3 }
		],
		palette: {
			back: '#f0c96a',
			belly: '#c9832b',
			fin: '#ffe7b0',
			marking: '#7a4a12',
			iris: '#2a1a06'
		},
		pattern: 'spots',
		wave: { amplitude: 0.05, wavelength: 1.8, speed: 3 }
	},

	// Taller than it is long, and vertically barred: the deepest body in the tank, and
	// the counterweight to the eel at the other end of the range.
	discus: {
		length: 32,
		profile: [
			[0, 0.03],
			[0.12, 0.32],
			[0.42, 0.5],
			[0.75, 0.3],
			[1, 0.04]
		],
		fins: [
			caudal(0.24, 0.5, 1),
			{ anchor: 0.4, kind: 'dorsal', span: 0.32, sweep: 0.45, lag: 1.1 },
			{ anchor: 0.6, kind: 'anal', span: 0.3, sweep: 0.45, lag: 1.2 },
			{ anchor: 0.24, kind: 'pectoral', span: 0.13, sweep: 0.9, lag: 0.3 }
		],
		palette: {
			back: '#5ad2c0',
			belly: '#1d7fa8',
			fin: '#bff3ea',
			marking: '#0e4a5e',
			iris: '#0d2a33'
		},
		pattern: 'bands',
		wave: { amplitude: 0.07, wavelength: 1.6, speed: 4 }
	},

	// The cleared-day koi: long body, barbels, veil tail, unhurried.
	koi: {
		length: 52,
		profile: [
			[0, 0.03],
			[0.16, 0.16],
			[0.45, 0.2],
			[0.78, 0.12],
			[0.93, 0.05],
			[1, 0.03]
		],
		fins: [
			caudal(0.42, 0.4, 1.4),
			{ anchor: 0.4, kind: 'dorsal', span: 0.2, sweep: 0.6, lag: 0.8 },
			{ anchor: 0.66, kind: 'anal', span: 0.18, sweep: 0.5, lag: 0.9 },
			{ anchor: 0.26, kind: 'pectoral', span: 0.2, sweep: 0.9, lag: 0.4 }
		],
		palette: {
			back: '#fff0c4',
			belly: '#e08a2b',
			fin: '#ffe2a8',
			marking: '#e24e2f',
			iris: '#3a2408'
		},
		pattern: 'spots',
		wave: { amplitude: 0.1, wavelength: 1.6, speed: 3 }
	},

	// The guilty pleasure: oversized sails, the most ornate thing in the tank.
	exotic: {
		length: 44,
		profile: [
			[0, 0.02],
			[0.14, 0.22],
			[0.4, 0.34],
			[0.72, 0.2],
			[0.9, 0.06],
			[1, 0.04]
		],
		fins: [
			caudal(0.7, 0.35, 1.5),
			{ anchor: 0.38, kind: 'dorsal', span: 0.7, sweep: 0.45, lag: 1.4 },
			{ anchor: 0.6, kind: 'anal', span: 0.6, sweep: 0.45, lag: 1.5 },
			{ anchor: 0.5, kind: 'pelvic', span: 0.5, sweep: 0.3, lag: 1.7 },
			{ anchor: 0.26, kind: 'pectoral', span: 0.18, sweep: 0.9, lag: 0.4 }
		],
		palette: {
			back: '#ff6fc7',
			belly: '#7a3bd1',
			fin: '#ffa8d8',
			marking: '#ffd166',
			iris: '#2a0f3f'
		},
		pattern: 'none',
		wave: { amplitude: 0.12, wavelength: 1.3, speed: 4 }
	}
};

/** The species a task can be assigned. Koi and exotic are chosen by creature kind. */
export const SWIMMERS: Species[] = [
	'clown',
	'tang',
	'angel',
	'guppy',
	'neon',
	'betta',
	'eel',
	'puffer',
	'discus'
];

/**
 * Which task is which fish is arbitrary, but it must be stable: the same task is the
 * same fish every time you open the tank, which is what lets you recognise it without
 * reading the label.
 *
 * Mixed, never `hash % n`: sequential ids step the raw hash by a constant, and when
 * that stride shares a factor with the species count only a couple of species ever
 * appear.
 */
export function speciesFor(id: string): Species {
	return SWIMMERS[Math.floor(mix32(hash(id)) * SWIMMERS.length)];
}

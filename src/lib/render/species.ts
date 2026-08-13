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
	| 'exotic'
	| 'lionfish'
	| 'mandarin'
	| 'reef'
	| 'hammerhead'
	| 'whale'
	| 'nurse'
	| 'thresher';

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
	/**
	 * `veil` widens the fins into ray-veined membranes instead of the default narrow
	 * blade. Reserved for the treats: a guilty pleasure has to look like a prize, and
	 * ornate fins are what separate one from an ordinary fish wearing a bright colour.
	 */
	finStyle?: 'blade' | 'veil';
	profile: Profile;
	fins: FinSpec[];
	palette: { back: string; belly: string; fin: string; marking: string; iris: string };
	pattern: 'bands' | 'stripe' | 'spots' | 'none';
	wave: Wave;
	/**
	 * Sharks. Draws gill slashes on the flank, a serrated tooth-line at the mouth, and a
	 * narrow slit pupil instead of the round mascot eye — the menace lives in the face,
	 * not the body colour.
	 */
	predator?: boolean;
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

	// Prize #2. Banded, with a crown of long rays — the most obviously "do not touch"
	// silhouette available, and nothing like the magenta exotic beside it.
	lionfish: {
		length: 40,
		finStyle: 'veil',
		profile: [
			[0, 0.03],
			[0.16, 0.2],
			[0.42, 0.26],
			[0.74, 0.16],
			[1, 0.04]
		],
		fins: [
			caudal(0.4, 0.4, 1.3),
			{ anchor: 0.3, kind: 'dorsal', span: 0.72, sweep: 0.25, lag: 1.5 },
			{ anchor: 0.46, kind: 'dorsal', span: 0.8, sweep: 0.3, lag: 1.7 },
			{ anchor: 0.62, kind: 'anal', span: 0.66, sweep: 0.3, lag: 1.6 },
			{ anchor: 0.34, kind: 'pectoral', span: 0.6, sweep: 0.5, lag: 1.2 }
		],
		palette: {
			back: '#ff7a4d',
			belly: '#8c1f14',
			fin: '#ffd9c2',
			marking: '#fff1e4',
			iris: '#2b0a05'
		},
		pattern: 'bands',
		wave: { amplitude: 0.07, wavelength: 1.7, speed: 3 }
	},

	// Prize #3. Small, round and electric — the colour does the work here rather than
	// the fins, so the three prizes do not all read as "fish with big fins".
	mandarin: {
		length: 34,
		finStyle: 'veil',
		profile: [
			[0, 0.04],
			[0.2, 0.24],
			[0.48, 0.3],
			[0.78, 0.18],
			[1, 0.05]
		],
		fins: [
			caudal(0.42, 0.45, 1.2),
			{ anchor: 0.38, kind: 'dorsal', span: 0.42, sweep: 0.4, lag: 1.3 },
			{ anchor: 0.62, kind: 'anal', span: 0.36, sweep: 0.4, lag: 1.4 },
			{ anchor: 0.28, kind: 'pectoral', span: 0.34, sweep: 0.6, lag: 0.9 }
		],
		palette: {
			back: '#2fd0c8',
			belly: '#1b4fa8',
			fin: '#ffb03a',
			marking: '#ff5a2b',
			iris: '#07202e'
		},
		pattern: 'spots',
		wave: { amplitude: 0.1, wavelength: 1.5, speed: 5 }
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

	// ── Sharks ───────────────────────────────────────────────────────────────
	//
	// All five share the same structural grammar: pointed snout [0, 0.01], a
	// well-developed crescent caudal (large span, high sweep), a tall triangular
	// dorsal sitting forward on the back, and stiff blade fins (no veil). They
	// are larger than ordinary fish and swim with a slower, more deliberate wave.
	//
	// The five breeds are differentiated by silhouette, not colour — just as the
	// tank's reef fish are. A side-by-side of outlines should make all five
	// immediately distinguishable.

	// Classic torpedo. The mental image everyone reaches for when they think "shark":
	// long, lean, pointed at both ends. Depth/length ≈ 0.28 — the most elongated.
	reef: {
		length: 56,
		profile: [
			[0, 0.004],
			[0.07, 0.08],
			[0.35, 0.16],
			[0.65, 0.14],
			[0.85, 0.06],
			[1, 0.02]
		],
		fins: [
			caudal(0.38, 1.1, 0.5),
			{ anchor: 0.3, kind: 'dorsal', span: 0.32, sweep: 0.6, lag: 0.2 },
			{ anchor: 0.6, kind: 'dorsal', span: 0.1, sweep: 0.5, lag: 0.2 },
			{ anchor: 0.65, kind: 'anal', span: 0.14, sweep: 0.6, lag: 0.3 },
			{ anchor: 0.22, kind: 'pectoral', span: 0.24, sweep: 1.1, lag: 0.2 }
		],
		palette: {
			back: '#2f6f8f',
			belly: '#e8f4f8',
			fin: '#1f4f68',
			marking: '#e8f4f8',
			iris: '#081218'
		},
		pattern: 'none',
		predator: true,
		wave: { amplitude: 0.09, wavelength: 1.6, speed: 6 }
	},

	// The unmistakeable wide, flat cephalofoil head. Profile widens sharply at the
	// snout then narrows to a slender body — that contrast is what reads as hammerhead
	// even at 40 px. Depth/length ≈ 0.46 at the head, 0.20 at mid-body.
	hammerhead: {
		length: 52,
		profile: [
			[0, 0.01],
			[0.06, 0.24],
			[0.14, 0.22],
			[0.38, 0.15],
			[0.68, 0.12],
			[0.86, 0.05],
			[1, 0.02]
		],
		fins: [
			caudal(0.34, 1.0, 0.5),
			{ anchor: 0.28, kind: 'dorsal', span: 0.35, sweep: 0.55, lag: 0.2 },
			{ anchor: 0.62, kind: 'dorsal', span: 0.09, sweep: 0.5, lag: 0.2 },
			{ anchor: 0.66, kind: 'anal', span: 0.13, sweep: 0.6, lag: 0.3 },
			{ anchor: 0.2, kind: 'pectoral', span: 0.22, sweep: 1.0, lag: 0.2 }
		],
		palette: {
			back: '#1f7a52',
			belly: '#d8ecd0',
			fin: '#12583a',
			marking: '#d8ecd0',
			iris: '#061a10'
		},
		pattern: 'none',
		predator: true,
		wave: { amplitude: 0.08, wavelength: 1.7, speed: 5 }
	},

	// The gentle giant: broad, blunt-nosed, enormous — length 72 makes it visibly
	// the largest animal in the tank. Wide flat body (depth/length ≈ 0.36) and
	// spots mark it as something categorically different.
	whale: {
		length: 72,
		profile: [
			[0, 0.012],
			[0.08, 0.15],
			[0.35, 0.36],
			[0.62, 0.3],
			[0.82, 0.14],
			[1, 0.03]
		],
		fins: [
			caudal(0.44, 1.0, 0.5),
			{ anchor: 0.32, kind: 'dorsal', span: 0.26, sweep: 0.5, lag: 0.2 },
			{ anchor: 0.62, kind: 'anal', span: 0.16, sweep: 0.5, lag: 0.3 },
			{ anchor: 0.2, kind: 'pectoral', span: 0.28, sweep: 1.0, lag: 0.2 }
		],
		palette: {
			back: '#12324f',
			belly: '#5a8aa0',
			fin: '#0c2438',
			marking: '#f0d060',
			iris: '#050f18'
		},
		pattern: 'spots',
		predator: true,
		wave: { amplitude: 0.07, wavelength: 1.8, speed: 4 }
	},

	// Stocky, bottom-hugging — shorter body but wide mid-section gives it a slug-like
	// silhouette (depth/length ≈ 0.38). Swims slowly, close to the floor (depth 0.75
	// in build.ts is handled by the scene; the species itself is just the outline).
	nurse: {
		length: 48,
		profile: [
			[0, 0.008],
			[0.09, 0.13],
			[0.38, 0.28],
			[0.66, 0.22],
			[0.88, 0.08],
			[1, 0.03]
		],
		fins: [
			caudal(0.28, 0.7, 0.6),
			{ anchor: 0.36, kind: 'dorsal', span: 0.22, sweep: 0.5, lag: 0.3 },
			{ anchor: 0.6, kind: 'dorsal', span: 0.18, sweep: 0.5, lag: 0.3 },
			{ anchor: 0.62, kind: 'anal', span: 0.16, sweep: 0.5, lag: 0.4 },
			{ anchor: 0.22, kind: 'pectoral', span: 0.2, sweep: 1.0, lag: 0.2 }
		],
		palette: {
			back: '#a5723c',
			belly: '#f0d4a0',
			fin: '#7a4e24',
			marking: '#f0d4a0',
			iris: '#2a1608'
		},
		pattern: 'none',
		predator: true,
		wave: { amplitude: 0.1, wavelength: 1.5, speed: 5 }
	},

	// Dramatic elongated upper caudal lobe — roughly as long as the body itself.
	// The slender body with that exaggerated tail is the whole identity. At 40 px the
	// upper lobe reads as a spike extending well behind the fish.
	thresher: {
		length: 50,
		profile: [
			[0, 0.004],
			[0.07, 0.07],
			[0.34, 0.16],
			[0.62, 0.12],
			[0.84, 0.04],
			[1, 0.01]
		],
		fins: [
			// Elongated upper lobe: large span, strong sweep, placed at the tail root.
			// `caudal` always anchors at 1; the long sweep pushes the tip far behind.
			caudal(0.85, 1.3, 0.4),
			{ anchor: 0.28, kind: 'dorsal', span: 0.3, sweep: 0.55, lag: 0.2 },
			{ anchor: 0.64, kind: 'anal', span: 0.1, sweep: 0.6, lag: 0.3 },
			{ anchor: 0.2, kind: 'pectoral', span: 0.22, sweep: 1.1, lag: 0.2 }
		],
		palette: {
			back: '#3f5aa8',
			belly: '#dbe2f4',
			fin: '#2c3f80',
			marking: '#dbe2f4',
			iris: '#0a1230'
		},
		pattern: 'none',
		predator: true,
		wave: { amplitude: 0.1, wavelength: 1.5, speed: 7 }
	},

	// The guilty pleasure: oversized sails, the most ornate thing in the tank.
	exotic: {
		length: 44,
		finStyle: 'veil',
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

/** The five shark breeds, one per priority task. Stable per task id like speciesFor. */
export const SHARKS: Species[] = ['reef', 'hammerhead', 'whale', 'nurse', 'thresher'];

/** The prizes. Chosen by task id, so two treats on one day are not clones. */
export const TREATS: Species[] = ['exotic', 'lionfish', 'mandarin'];

/**
 * Which prize a treat is. Stable per task, like `speciesFor` — the guilty pleasure you
 * are saving up for should look the same tomorrow.
 */
export function treatSpeciesFor(id: string): Species {
	return TREATS[Math.floor(mix32(hash(id) ^ 0x5eed) * TREATS.length)];
}

export function speciesFor(id: string): Species {
	return SWIMMERS[Math.floor(mix32(hash(id)) * SWIMMERS.length)];
}

/**
 * Which of the five shark breeds a priority task wears. Stable per task id —
 * toggling priority off and on again gives you the same shark. Uses a different
 * hash mix than speciesFor so a task is not the same breed as its fish species.
 */
export function sharkSpeciesFor(id: string): Species {
	return SHARKS[Math.floor(mix32(hash(id) ^ 0x5a4b) * SHARKS.length)];
}

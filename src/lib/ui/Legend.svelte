<script module lang="ts">
	import type { Creature } from '../scene/types';

	/**
	 * The reference for what lives in the tank.
	 *
	 * The app teaches its chrome fine and its vocabulary not at all: a bubble, a dim
	 * exotic fish and a koi each mean something specific and nothing on screen says
	 * what. This is a key, not a tour — it is here on the first day and on the
	 * hundredth, when the meaning of a dim fish has been forgotten.
	 */
	export type LegendEntry = {
		/** Stable row id, independent of the creature's own id. */
		id: string;
		title: string;
		blurb: string;
		/**
		 * Draw scale for this row's thumbnail. A pearl and an angelfish differ by
		 * roughly four times in natural size, and a legend wants them the same size on
		 * the page. Set by looking at the rendered sheet, not by arithmetic.
		 */
		zoom: number;
		/** Synthetic descriptor, handed to the real `drawCreature`. */
		creature: Creature;
	};

	/**
	 * The instant every legend creature is drawn at.
	 *
	 * Fixed so each thumbnail is the same frame on every open and every screenshot.
	 * Non-zero because the body wave is a function of time: at 0 every fish is drawn
	 * mid-stroke at phase zero, which is the one pose that looks posed.
	 */
	export const LEGEND_TIME = 3.2;

	export const LEGEND_ENTRIES: LegendEntry[] = [
		{
			id: 'fish',
			title: 'Fish',
			blurb: 'An ordinary task, swimming until you finish it.',
			zoom: 0.85,
			creature: { id: 'legend-fish', kind: 'fish', label: 'Fish', depth: 0.4, tapRadius: 34 }
		},
		{
			id: 'bubble',
			title: 'Bubble',
			blurb: 'A task waiting for its moment — a time, another task, or your say-so.',
			zoom: 1,
			creature: { id: 'legend-bubble', kind: 'bubble', label: 'Bubble', depth: 0.3, tapRadius: 32 }
		},
		{
			id: 'ghost',
			title: 'Ghost',
			blurb: 'A task you finished today. It stays, faintly, so the day shows its work.',
			zoom: 0.65,
			creature: { id: 'legend-ghost', kind: 'ghost', label: 'Ghost', depth: 0.5, tapRadius: 26 }
		},
		{
			id: 'treat-locked',
			title: 'Treat, out of reach',
			blurb: 'A reward you have not earned yet. Dim until you can afford it.',
			zoom: 0.72,
			// Same creature id as the affordable row below: `treatSpeciesFor` hashes the
			// id to pick a species, so two different ids would render as two different
			// animals here, and a reader would learn "different species" instead of the
			// intended "same fish, dim vs bright." `locked` is the only difference.
			creature: {
				id: 'legend-treat',
				kind: 'treat',
				label: 'Treat',
				depth: 0.2,
				locked: true,
				cost: 3,
				tapRadius: 36
			}
		},
		{
			id: 'treat',
			title: 'Treat, affordable',
			blurb: 'Bright once you have the pearls. Tap it to claim it.',
			zoom: 0.8,
			creature: {
				id: 'legend-treat',
				kind: 'treat',
				label: 'Treat',
				depth: 0.2,
				cost: 3,
				tapRadius: 36
			}
		},
		{
			id: 'koi',
			title: 'Koi',
			blurb: 'A day you cleared completely. It keeps swimming from then on.',
			zoom: 0.7,
			creature: { id: 'legend-koi', kind: 'koi', label: 'Koi', depth: 0.6, tapRadius: 38 }
		},
		{
			id: 'pearl',
			title: 'Pearl',
			blurb: 'Dropped on the sand each time you finish an ordinary task. Treats are priced in these.',
			zoom: 1.4,
			creature: { id: 'legend-pearl', kind: 'pearl', label: 'Pearl', depth: 1, tapRadius: 16 }
		}
	];
</script>

<script lang="ts">
	import { drawCreature, type Placement } from '../render/creatures';
	import { palette, type Environment } from '../render/palette';

	type Props = {
		open: boolean;
		/** Matches the tank the user is actually looking at. */
		environment: Environment;
		onClose: () => void;
	};

	const { open, environment, onClose }: Props = $props();

	/** Thumbnail size in CSS pixels. */
	const THUMB = { w: 72, h: 52 };

	/**
	 * Drawn at a cleared day's palette regardless of progress.
	 *
	 * A reference wants its subjects legible, and the Progress palette at 0 is
	 * deliberately murky — the legend would open dimmest exactly when a new user first
	 * sees it, which is the worst possible moment for it.
	 */
	const LEGEND_CLEARED = 1;

	let canvases = $state<(HTMLCanvasElement | undefined)[]>([]);

	/**
	 * One static frame per row, drawn when the sheet opens or the palette changes.
	 *
	 * No requestAnimationFrame: seven animating canvases over a blurred tank is real
	 * cost on a phone for a sheet nobody watches. Nothing here allocates repeatedly —
	 * it runs on open, not per frame.
	 */
	$effect(() => {
		if (!open) return;

		const colors = palette(environment, LEGEND_CLEARED);
		const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;

		LEGEND_ENTRIES.forEach((entry, i) => {
			const canvas = canvases[i];
			if (!canvas) return;

			canvas.width = THUMB.w * dpr;
			canvas.height = THUMB.h * dpr;

			const ctx = canvas.getContext('2d');
			if (!ctx) return;

			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, THUMB.w, THUMB.h);

			// Centre the row, then scale, then draw at the origin — so the placement
			// carries no layout maths of its own and `place()` stays uninvolved.
			ctx.translate(THUMB.w / 2, THUMB.h / 2);
			ctx.scale(entry.zoom, entry.zoom);

			const at: Placement = {
				x: 0,
				y: 0,
				flip: false,
				pitch: 0,
				// `effort` is a multiple of the creature's own average pace, so 1 is a fish
				// holding station. 0 would flatten the body wave and draw a stick.
				effort: 1,
				turn: 0
			};

			drawCreature(ctx, entry.creature, at, colors, LEGEND_TIME);
			ctx.setTransform(1, 0, 0, 1, 0, 0);
		});
	});
</script>

{#if open}
	<div
		class="backdrop"
		role="button"
		tabindex="-1"
		aria-label="Close"
		onclick={onClose}
		onkeydown={(e) => e.key === 'Escape' && onClose()}
	></div>

	<section class="sheet" aria-label="What am I looking at?">
		<h2>What am I looking at?</h2>

		<ul>
			{#each LEGEND_ENTRIES as entry, i (entry.id)}
				<li>
					<!-- Decorative: the row's text is the accessible content, and a canvas
					     offers a screen reader nothing. -->
					<canvas
						bind:this={canvases[i]}
						aria-hidden="true"
						style="width: {THUMB.w}px; height: {THUMB.h}px"
					></canvas>
					<span class="text">
						<strong>{entry.title}</strong>
						<small>{entry.blurb}</small>
					</span>
				</li>
			{/each}
		</ul>

		<div class="actions">
			<!-- Not "Back to the tank": ListView.svelte:123 already uses that label, and
			     two buttons with one accessible name make every E2E selector ambiguous. -->
			<button type="button" onclick={onClose}>Got it</button>
		</div>
	</section>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 22;
		border: 0;
		padding: 0;
		background: rgba(10, 30, 40, 0.35);
		backdrop-filter: blur(6px);
	}

	/* Above Settings (21), because it opens from inside that sheet. */
	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 23;
		max-width: 34rem;
		max-height: 82vh;
		overflow-y: auto;
		margin: 0 auto;
		padding: 1.5rem 1.5rem calc(1.5rem + env(safe-area-inset-bottom));
		border-radius: 1.25rem 1.25rem 0 0;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(18px);
		box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.25);
		color: #12303a;
	}

	@media (min-width: 40rem) {
		.sheet {
			inset: auto 0 2rem 0;
			border-radius: 1.25rem;
			box-shadow: 0 18px 60px rgba(0, 0, 0, 0.3);
		}
	}

	h2 {
		margin: 0 0 1rem;
		font-size: 1.15rem;
		font-weight: 600;
	}

	ul {
		display: grid;
		gap: 0.9rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		align-items: center;
		gap: 0.9rem;
	}

	canvas {
		flex: none;
		border-radius: 0.6rem;
		/* A hint of water behind each subject: the creatures are drawn for a tank and
		   read as cut-outs on plain white. */
		background: rgba(79, 195, 217, 0.18);
	}

	.text {
		display: grid;
		gap: 0.15rem;
	}

	strong {
		font-size: 0.95rem;
		font-weight: 600;
	}

	small {
		font-size: 0.82rem;
		line-height: 1.35;
		opacity: 0.75;
	}

	.actions {
		margin-top: 1.25rem;
	}

	button {
		padding: 0.6rem 1.1rem;
		border: 0;
		border-radius: 999px;
		background: #12303a;
		color: #fff;
		font-size: 0.95rem;
		cursor: pointer;
	}

	button:focus-visible {
		outline: 2px solid #12303a;
		outline-offset: 2px;
	}
</style>

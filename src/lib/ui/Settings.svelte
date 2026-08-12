<script module lang="ts">
	import type { Environment } from '../render/palette';

	/**
	 * Both environments render the same scene. Only the palette function and the
	 * mood number's visibility differ, so this is one choice rather than a screen of
	 * toggles.
	 */
	export const ENVIRONMENT_CHOICES: { value: Environment; label: string; blurb: string }[] = [
		{
			value: 'progress',
			label: 'Progress',
			blurb: 'The water starts murky and clears as you finish. Shows how the day is going.'
		},
		{
			value: 'calm',
			label: 'Calm',
			blurb: 'One bright tank, always. No number, no score.'
		}
	];

	export function blurbFor(environment: Environment): string {
		return ENVIRONMENT_CHOICES.find((c) => c.value === environment)!.blurb;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { base } from '$app/paths';

	type Props = {
		open: boolean;
		environment: Environment;
		onChange: (environment: Environment) => void;
		onOpenLegend: () => void;
		onClose: () => void;
		/**
		 * The sync section. Absent when Supabase is not configured, in which case no
		 * heading renders either — an empty "Sync" section would be worse than none.
		 */
		sync?: Snippet;
	};

	const { open, environment, onChange, onOpenLegend, onClose, sync }: Props = $props();
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

	<section class="sheet" aria-label="Settings">
		<h2>Tank</h2>

		<fieldset>
			<legend class="visually-hidden">Environment</legend>
			{#each ENVIRONMENT_CHOICES as choice (choice.value)}
				<label class="choice" class:selected={environment === choice.value}>
					<input
						type="radio"
						name="environment"
						value={choice.value}
						checked={environment === choice.value}
						onchange={() => onChange(choice.value)}
					/>
					<span class="text">
						<strong>{choice.label}</strong>
						<small>{choice.blurb}</small>
					</span>
				</label>
			{/each}
		</fieldset>

		<button type="button" class="row" onclick={onOpenLegend}>
			<span>What am I looking at?</span>
			<span class="chevron" aria-hidden="true">›</span>
		</button>

		{#if sync}
			{@render sync()}
		{/if}

		<div class="actions">
			<a href="{base}/privacy" class="privacy-link">Privacy policy</a>
			<button type="button" onclick={onClose}>Done</button>
		</div>
	</section>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		border: 0;
		padding: 0;
		background: rgba(10, 30, 40, 0.35);
		backdrop-filter: blur(6px);
	}

	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 21;
		/* Capped and centred: full-bleed on a desktop leaves the content stranded at
		   one edge of a 2000px bar. */
		max-width: 34rem;
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

	fieldset {
		display: grid;
		gap: 0.5rem;
		margin: 0;
		padding: 0;
		border: 0;
	}

	.choice {
		display: flex;
		gap: 0.7rem;
		align-items: flex-start;
		padding: 0.9rem 1rem;
		border: 1px solid rgba(18, 48, 58, 0.14);
		border-radius: 0.85rem;
		background: rgba(255, 255, 255, 0.6);
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
	}

	.choice:hover {
		border-color: rgba(18, 48, 58, 0.32);
	}

	.choice.selected {
		border-color: #12303a;
		background: rgba(18, 48, 58, 0.07);
		box-shadow: inset 0 0 0 1px #12303a;
	}

	.choice input {
		margin-top: 0.15rem;
		width: 1.05rem;
		height: 1.05rem;
		accent-color: #12303a;
	}

	.choice strong {
		font-size: 0.98rem;
	}

	.choice small {
		line-height: 1.4;
	}

	.text {
		display: grid;
		gap: 0.15rem;
	}

	small {
		opacity: 0.7;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		margin-top: 1rem;
		padding: 0.75rem 0.9rem;
		border: 0;
		border-radius: 0.75rem;
		background: rgba(18, 48, 58, 0.08);
		color: #12303a;
		font-size: 0.95rem;
		text-align: left;
		cursor: pointer;
	}

	.row:hover {
		background: rgba(18, 48, 58, 0.14);
	}

	.chevron {
		opacity: 0.5;
	}

	.actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 1rem;
	}

	.privacy-link {
		font-size: 0.78rem;
		color: rgba(18, 48, 58, 0.5);
		text-decoration: none;
	}

	.privacy-link:hover {
		color: #12303a;
		text-decoration: underline;
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

	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
</style>

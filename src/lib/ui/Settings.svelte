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
	type Props = {
		open: boolean;
		environment: Environment;
		onChange: (environment: Environment) => void;
		onClose: () => void;
	};

	const { open, environment, onChange, onClose }: Props = $props();
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

		<div class="actions">
			<button type="button" onclick={onClose}>Done</button>
		</div>
	</section>
{/if}

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		border: 0;
		padding: 0;
		background: rgba(10, 30, 40, 0.35);
		backdrop-filter: blur(6px);
	}

	.sheet {
		position: fixed;
		inset: auto 0 0 0;
		padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
		border-radius: 1.25rem 1.25rem 0 0;
		background: rgba(255, 255, 255, 0.85);
		backdrop-filter: blur(18px);
		box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.25);
		color: #12303a;
	}

	h2 {
		margin: 0 0 0.75rem;
		font-size: 1.1rem;
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
		gap: 0.6rem;
		align-items: flex-start;
		padding: 0.75rem;
		border: 1px solid rgba(18, 48, 58, 0.15);
		border-radius: 0.75rem;
		cursor: pointer;
	}

	.choice.selected {
		border-color: #12303a;
		background: rgba(18, 48, 58, 0.06);
	}

	.text {
		display: grid;
		gap: 0.15rem;
	}

	small {
		opacity: 0.7;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 1rem;
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

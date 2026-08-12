<script lang="ts">
	import { base } from '$app/paths';

	type Props = {
		onAccept: () => void;
		onDecline: () => void;
	};

	const { onAccept, onDecline }: Props = $props();
</script>

<div class="consent" role="dialog" aria-label="Cookie consent" aria-modal="false">
	<p class="text">
		The task list shows a sponsored ad from
		<a href="https://carbonads.net" target="_blank" rel="noopener noreferrer">Carbon Ads</a>
		which uses cookies. Do you want to allow it?
		<a href="{base}/privacy" target="_blank" rel="noopener noreferrer">Privacy policy</a>
	</p>
	<div class="actions">
		<button type="button" class="decline" onclick={onDecline}>No thanks</button>
		<button type="button" class="accept" onclick={onAccept}>Allow ads</button>
	</div>
</div>

<style>
	.consent {
		display: grid;
		gap: 0.75rem;
		margin-top: 2.5rem;
		padding: 1rem 1.1rem;
		border-radius: 0.85rem;
		background: rgba(18, 48, 58, 0.06);
		border: 1px solid rgba(18, 48, 58, 0.1);
		font-size: 0.85rem;
		color: #12303a;
	}

	.text {
		margin: 0;
		line-height: 1.55;
	}

	a {
		color: #1a7a9a;
		text-underline-offset: 2px;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
		justify-content: flex-end;
	}

	button {
		padding: 0.4rem 0.9rem;
		border: 0;
		border-radius: 999px;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.accept {
		background: #12303a;
		color: #fff;
	}

	.accept:hover {
		background: #1a4a5a;
	}

	.decline {
		background: rgba(18, 48, 58, 0.1);
		color: #12303a;
	}

	.decline:hover {
		background: rgba(18, 48, 58, 0.18);
	}

	button:focus-visible {
		outline: 2px solid #12303a;
		outline-offset: 2px;
	}
</style>

<script lang="ts">
	/**
	 * Shown when `LocalTaskStore.save` rejects — storage full, disabled, or otherwise
	 * unreachable — and for persistent sync error states.
	 *
	 * The save-failure banner is not dismissible: the condition has not gone away just
	 * because the message was acknowledged, and the user needs a standing reminder.
	 *
	 * Sync error banners (denied, stale, rejected) accept an `onDismiss` callback so
	 * the user can clear them after reading — the error is already visible in Settings
	 * and the banner blocking the tank is worse than forgetting it.
	 */
	type Props = {
		visible: boolean;
		/** Defaults to the save failure this banner was built for. */
		title?: string;
		detail?: string;
		/**
		 * When provided, renders a dismiss (✕) button. Omit for persistent banners
		 * (e.g. save failure) where the condition is still active.
		 */
		onDismiss?: () => void;
	};

	const {
		visible,
		title = 'Changes are not being saved on this device.',
		detail = 'Your tasks are still here for now, but they will be lost if you reload.',
		onDismiss
	}: Props = $props();
</script>

{#if visible}
	<div class="banner" role="status" aria-live="polite">
		<div class="text">
			<strong>{title}</strong>
			<span>{detail}</span>
		</div>
		{#if onDismiss}
			<button type="button" class="dismiss" onclick={onDismiss} aria-label="Dismiss">✕</button>
		{/if}
	</div>
{/if}

<style>
	.banner {
		position: fixed;
		inset: max(3.5rem, calc(env(safe-area-inset-top) + 3.5rem)) 0.75rem auto 0.75rem;
		z-index: 30; /* above every sheet: it must never be covered */
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding: 0.7rem 0.9rem;
		border-radius: 0.75rem;
		background: rgba(160, 51, 37, 0.92);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
		color: #fff;
		font-size: 0.85rem;
	}

	.text {
		display: grid;
		gap: 0.15rem;
		flex: 1;
	}

	strong {
		font-weight: 600;
	}

	span {
		opacity: 0.9;
	}

	.dismiss {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 1.5rem;
		height: 1.5rem;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.2);
		color: #fff;
		font-size: 0.75rem;
		line-height: 1;
		cursor: pointer;
		transition: background 0.12s;
	}

	.dismiss:hover {
		background: rgba(255, 255, 255, 0.35);
	}
</style>

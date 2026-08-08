<script lang="ts">
	/**
	 * Shown when `LocalTaskStore.save` rejects — storage full, disabled, or otherwise
	 * unreachable.
	 *
	 * Persistent by design. The app keeps running from memory, so everything looks
	 * normal; without a standing banner the user works for an hour and loses it all
	 * on reload. It is not dismissible for the same reason: the condition has not
	 * gone away just because the message was acknowledged.
	 */
	type Props = { visible: boolean };

	const { visible }: Props = $props();
</script>

{#if visible}
	<div class="banner" role="status" aria-live="polite">
		<strong>Changes are not being saved on this device.</strong>
		<span>Your tasks are still here for now, but they will be lost if you reload.</span>
	</div>
{/if}

<style>
	.banner {
		position: fixed;
		inset: max(3.5rem, calc(env(safe-area-inset-top) + 3.5rem)) 0.75rem auto 0.75rem;
		z-index: 30; /* above every sheet: it must never be covered */
		display: grid;
		gap: 0.15rem;
		padding: 0.7rem 0.9rem;
		border-radius: 0.75rem;
		background: rgba(160, 51, 37, 0.92);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
		color: #fff;
		font-size: 0.85rem;
	}

	strong {
		font-weight: 600;
	}

	span {
		opacity: 0.9;
	}
</style>

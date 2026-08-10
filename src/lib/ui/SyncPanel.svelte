<script lang="ts">
	import type { Account } from '$lib/auth/session';
	import type { SyncStatus } from '$lib/persist/sync/syncing';
	import { ago } from './ago';

	/**
	 * Everything sync offers the user, in one place behind the gear.
	 *
	 * The timestamp is the point, not the button. A tank that agrees with the server
	 * and one that has been failing for two days look identical; this is the only
	 * thing that tells them apart, and it answers the question before you tap.
	 */
	type Props = {
		account: Account | null;
		status: SyncStatus;
		/** Passed in rather than read here, so the line is a pure function of props. */
		now: number;
		onSignIn: () => void;
		onSignOut: () => void;
		onSyncNow: () => void;
	};

	const { account, status, now, onSignIn, onSignOut, onSyncNow }: Props = $props();

	/** Failures that will never fix themselves say so; `offline` will, and stays mild. */
	const TROUBLE: Record<SyncStatus['state'], string> = {
		idle: '',
		syncing: '',
		offline: 'Not syncing — offline',
		denied: 'Not syncing — sign in again',
		stale: 'Not syncing — this device is out of date',
		rejected: 'Not syncing — the server refused this data',
		skewed: "Syncing, but this device's clock looks wrong",
		storage: 'Not syncing — local storage is unavailable'
	};

	const line = $derived.by(() => {
		const trouble = TROUBLE[status.state];
		const last = status.at === undefined ? undefined : ago(status.at, now);

		// A failure still reports the last success: knowing sync is broken matters
		// less than knowing how stale the tank is because of it.
		if (trouble) return last ? `${trouble}. Last synced ${last}.` : trouble;
		if (status.state === 'syncing') return 'Syncing…';
		return last ? `Synced ${last}` : 'Not synced yet';
	});
</script>

<h2>Sync</h2>

{#if account}
	<p class="who">{account.email ?? 'Signed in'}</p>

	<div class="status">
		<span aria-live="polite">{line}</span>
		<button type="button" onclick={onSyncNow} disabled={status.state === 'syncing'}>
			Sync now
		</button>
	</div>

	<button type="button" class="row" onclick={onSignOut}>Sign out</button>
{:else}
	<button type="button" class="row" onclick={onSignIn}>Sign in to sync</button>
{/if}

<style>
	h2 {
		margin: 1.5rem 0 1rem;
		font-size: 1.15rem;
		font-weight: 600;
	}

	.who {
		margin: 0 0 0.35rem;
		font-size: 0.9rem;
		/* An address can be longer than the sheet; truncate rather than widen it. */
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.status {
		display: flex;
		gap: 0.75rem;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
		opacity: 0.8;
	}

	.status span {
		/* The longest line wraps inside its own column instead of pushing the button
		   off the sheet. */
		min-width: 0;
	}

	.status button {
		flex: none;
		font: inherit;
		padding: 0.4rem 0.8rem;
		border: 1px solid rgba(18, 48, 58, 0.2);
		border-radius: 0.6rem;
		background: rgba(255, 255, 255, 0.6);
		color: inherit;
		cursor: pointer;
	}

	.status button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>

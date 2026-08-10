<script lang="ts">
	import type { Account } from '$lib/auth/session';
	import type { SyncStatus } from '$lib/persist/sync/syncing';

	/**
	 * The whole of sync's interface: one control in the date header.
	 *
	 * Signed out it offers sign-in; signed in it shows the account and the state of
	 * the last sync. There is deliberately no settings screen — sync has one switch
	 * and it is this one.
	 */
	type Props = {
		account: Account | null;
		status: SyncStatus['state'];
		onSignIn: () => void;
		onSignOut: () => void;
	};

	const { account, status, onSignIn, onSignOut }: Props = $props();

	/**
	 * Not saving and not syncing are different sentences, and the second is far less
	 * alarming: the tank on this device is fine either way.
	 *
	 * 'storage' names a local write failure, not a network one — the existing save
	 * banner already says the tank couldn't be saved, so this line's job is only to
	 * make clear that sync isn't the cause and retrying a connection won't help.
	 */
	const TROUBLE: Record<SyncStatus['state'], string> = {
		idle: '',
		syncing: '',
		offline: 'Not syncing — offline',
		denied: 'Not syncing — sign in again',
		stale: 'Not syncing — this device is out of date',
		skewed: "Not syncing reliably — this device's clock looks wrong",
		storage: 'Not syncing — local storage is unavailable'
	};

	const trouble = $derived(TROUBLE[status]);
</script>

{#if account}
	<button class="account" onclick={onSignOut} title={account.email ?? 'Signed in'}>
		<span class="dot" class:trouble={trouble !== ''}></span>
		Sign out
	</button>
{:else}
	<button class="account" onclick={onSignIn}>Sign in to sync</button>
{/if}

{#if trouble}
	<p class="trouble-text" role="status">{trouble}</p>
{/if}

<style>
	.account {
		font: inherit;
		background: none;
		border: 0;
		color: inherit;
		opacity: 0.75;
		padding: 0.4rem 0.6rem;
		cursor: pointer;
	}

	.dot {
		display: inline-block;
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.5;
		margin-right: 0.35rem;
	}

	.dot.trouble {
		background: #e8a33d;
		opacity: 1;
	}

	.trouble-text {
		margin: 0;
		font-size: 0.75rem;
		opacity: 0.7;
	}
</style>

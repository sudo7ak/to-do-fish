<script lang="ts">
	/**
	 * The tank's only permanent chrome: a bottom pill to add a task, and two corner
	 * glass buttons for the list view and settings.
	 *
	 * The pearl count sits on the pill because it is the one number that changes as
	 * you work, and the tank has no other place to put a figure.
	 */
	type Props = {
		pearls: number;
		onAdd: () => void;
		onOpenList: () => void;
		onOpenSettings: () => void;
	};

	const { pearls, onAdd, onOpenList, onOpenSettings }: Props = $props();
</script>

<div class="corner left">
	<button type="button" class="glass" aria-label="Task list" onclick={onOpenList}>☰</button>
</div>

<div class="corner right">
	<button type="button" class="glass" aria-label="Settings" onclick={onOpenSettings}>⚙</button>
</div>

<div class="pill-wrap">
	<button type="button" class="pill" onclick={onAdd}>
		<span aria-hidden="true">＋</span>
		Add a task
		<span class="pearls" aria-label="{pearls} pearls">
			<span class="bead" aria-hidden="true"></span>{pearls}
		</span>
	</button>
</div>

<style>
	.corner {
		position: fixed;
		top: max(0.75rem, env(safe-area-inset-top));
	}

	.left {
		left: 1rem;
	}

	.right {
		right: 1rem;
	}

	.glass {
		display: grid;
		place-items: center;
		width: 2.6rem;
		height: 2.6rem;
		border: 0;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
		backdrop-filter: blur(10px);
		color: #fff;
		font-size: 1.1rem;
		cursor: pointer;
	}

	.glass:hover {
		background: rgba(255, 255, 255, 0.28);
	}

	.pill-wrap {
		position: fixed;
		inset: auto 0 max(1rem, env(safe-area-inset-bottom)) 0;
		display: flex;
		justify-content: center;
		pointer-events: none;
	}

	.pill {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 1.2rem;
		border: 0;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.22);
		backdrop-filter: blur(14px);
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
		color: #fff;
		font-size: 0.95rem;
		cursor: pointer;
		pointer-events: auto;
	}

	.pearls {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		margin-left: 0.4rem;
		padding-left: 0.7rem;
		border-left: 1px solid rgba(255, 255, 255, 0.35);
		font-variant-numeric: tabular-nums;
	}

	.bead {
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 50%;
		background: #eaf6f8;
		box-shadow: 0 0 6px rgba(234, 246, 248, 0.8);
	}

	button:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}
</style>

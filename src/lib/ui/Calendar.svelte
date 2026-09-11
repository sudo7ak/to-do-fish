<script lang="ts">
	import { monthGrid, shiftMonth, monthLabel } from './calendar';
	import { parseDate, today } from './DateHeader.svelte';

	/**
	 * Jump to any date in a couple of taps instead of walking the day arrows one at
	 * a time. Opens from the date label in `DateHeader`; picking a day calls the
	 * same `onNavigate` the arrows already use, so nothing downstream of `date`
	 * knows or cares how it changed.
	 */
	type Props = {
		open: boolean;
		date: string;
		now: string;
		/** Dates carrying a live task — see `calendar.ts#taskDatesOf`. */
		taskDates: Set<string>;
		/** Dates that earned a koi — see `calendar.ts#koiDatesOf`. */
		koiDates: Set<string>;
		onNavigate: (date: string) => void;
		onClose: () => void;
	};

	const { open, date, now, taskDates, koiDates, onNavigate, onClose }: Props = $props();

	// Seeded from the real clock, not the `date`/`now` props — the effect below is
	// what actually keeps it in sync, and it only matters once `open` is true,
	// before which nothing renders.
	let viewMonth = $state(today());

	// Reopens on the month holding the currently viewed date rather than wherever
	// the grid was last scrolled — the app already knows which day you're on.
	$effect(() => {
		if (open) viewMonth = date;
	});

	const grid = $derived(monthGrid(viewMonth));
	const label = $derived(monthLabel(viewMonth));
	const viewedMonth = $derived(parseDate(viewMonth).getMonth());

	function pick(day: string) {
		onNavigate(day);
		onClose();
	}

	function jumpToday() {
		onNavigate(now);
		onClose();
	}

	/**
	 * The full explicit date, not `formatDay`'s "Today"/"Yesterday" shorthand — the
	 * grid shows a whole month, most of it nowhere near `now`, and relative naming
	 * would also collide with the Today button's own accessible name for the one
	 * cell where it applies.
	 */
	function dayLabel(day: string, cleared: boolean, hasTasks: boolean): string {
		const base = parseDate(day).toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
		if (cleared) return `${base}, cleared`;
		if (hasTasks) return `${base}, has tasks`;
		return base;
	}

	const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
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

	<section class="sheet" aria-label="Calendar">
		<div class="head">
			<button
				type="button"
				class="arrow"
				aria-label="Previous month"
				onclick={() => (viewMonth = shiftMonth(viewMonth, -1))}
			>
				‹
			</button>

			<div class="month">
				<h2>{label}</h2>
				<button type="button" class="today" onclick={jumpToday}>Today</button>
			</div>

			<button
				type="button"
				class="arrow"
				aria-label="Next month"
				onclick={() => (viewMonth = shiftMonth(viewMonth, 1))}
			>
				›
			</button>
		</div>

		<div class="weekdays" aria-hidden="true">
			{#each WEEKDAYS as w, i (i)}<span>{w}</span>{/each}
		</div>

		<div class="grid">
			{#each grid as day (day)}
				{@const inMonth = parseDate(day).getMonth() === viewedMonth}
				{@const cleared = koiDates.has(day)}
				{@const hasTasks = taskDates.has(day)}
				<button
					type="button"
					class="day"
					class:dim={!inMonth}
					class:selected={day === date}
					class:today={day === now}
					aria-label={dayLabel(day, cleared, hasTasks)}
					aria-current={day === date ? 'date' : undefined}
					onclick={() => pick(day)}
				>
					<span class="num">{parseDate(day).getDate()}</span>
					{#if cleared}
						<span class="mark koi" aria-hidden="true">🐟</span>
					{:else if hasTasks}
						<span class="mark dot" aria-hidden="true"></span>
					{/if}
				</button>
			{/each}
		</div>

		<div class="actions">
			<!-- Not "Close": the backdrop already carries that as its own accessible
			     name, and two controls sharing one name make every selector ambiguous
			     (Settings.svelte's "Done" is the precedent this follows). -->
			<button type="button" class="ghost" onclick={onClose}>Done</button>
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
		max-width: 26rem;
		margin: 0 auto;
		max-height: 85dvh;
		overflow-y: auto;
		padding: 1.25rem 1.25rem calc(1.25rem + env(safe-area-inset-bottom));
		border-radius: 1.25rem 1.25rem 0 0;
		background: rgba(255, 255, 255, 0.9);
		backdrop-filter: blur(20px);
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

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.month {
		text-align: center;
	}

	h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
	}

	.today {
		border: 0;
		background: none;
		padding: 0.1rem 0.5rem;
		margin-top: 0.1rem;
		font: inherit;
		font-size: 0.75rem;
		color: #2f7d99;
		cursor: pointer;
		border-radius: 0.5rem;
	}

	.today:hover,
	.today:focus-visible {
		background: rgba(47, 125, 153, 0.12);
	}

	.arrow {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		flex: none;
		border: 0;
		border-radius: 50%;
		background: rgba(18, 48, 58, 0.08);
		color: inherit;
		font-size: 1.3rem;
		line-height: 1;
		cursor: pointer;
	}

	.arrow:hover {
		background: rgba(18, 48, 58, 0.14);
	}

	.arrow:focus-visible {
		outline: 2px solid #2f7d99;
		outline-offset: 2px;
	}

	.weekdays {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		text-align: center;
		font-size: 0.7rem;
		opacity: 0.6;
		margin-bottom: 0.3rem;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 0.2rem;
	}

	.day {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		aspect-ratio: 1;
		border: 0;
		border-radius: 0.6rem;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.day:hover,
	.day:focus-visible {
		background: rgba(18, 48, 58, 0.08);
	}

	.day:focus-visible {
		outline: 2px solid #2f7d99;
		outline-offset: -2px;
	}

	.day.dim {
		opacity: 0.35;
	}

	.day.today .num {
		font-weight: 700;
		color: #2f7d99;
	}

	.day.selected {
		background: rgba(47, 125, 153, 0.16);
	}

	.day.selected .num {
		font-weight: 700;
	}

	.mark.dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #2f7d99;
	}

	.mark.koi {
		font-size: 0.7rem;
		line-height: 1;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		margin-top: 0.85rem;
	}

	.ghost {
		border: 0;
		background: none;
		font: inherit;
		color: inherit;
		opacity: 0.7;
		padding: 0.5rem 0.9rem;
		cursor: pointer;
		border-radius: 0.6rem;
	}

	.ghost:hover {
		background: rgba(18, 48, 58, 0.08);
	}
</style>

<script module lang="ts">
	/**
	 * Local calendar date helpers, exported so the sheets and the list view share one
	 * implementation rather than each rolling their own.
	 *
	 * Dates are local throughout, and arithmetic goes through the Date constructor's
	 * calendar overflow rather than adding milliseconds — a day is not always 86.4
	 * million milliseconds long, and adding one across a DST boundary lands an hour
	 * out, which is enough to name the wrong day.
	 */

	export function parseDate(date: string): Date {
		const [year, month, day] = date.split('-').map(Number);
		return new Date(year, month - 1, day);
	}

	export function toDateString(date: Date): string {
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	}

	/** Moves by whole calendar days. Month and year roll over on their own. */
	export function shiftDate(date: string, days: number): string {
		const d = parseDate(date);
		return toDateString(new Date(d.getFullYear(), d.getMonth(), d.getDate() + days));
	}

	export function today(now: Date = new Date()): string {
		return toDateString(now);
	}

	/** "Today", "Yesterday", "Tomorrow", or "Sat 8 Aug" — with the year when it is not this one. */
	export function formatDay(date: string, now: string = today()): string {
		if (date === now) return 'Today';
		if (date === shiftDate(now, -1)) return 'Yesterday';
		if (date === shiftDate(now, 1)) return 'Tomorrow';

		const d = parseDate(date);
		const sameYear = d.getFullYear() === parseDate(now).getFullYear();

		return d.toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			...(sameYear ? {} : { year: 'numeric' })
		});
	}
</script>

<script lang="ts">
	import { moodPercent, moodWord, type Environment } from '../render/palette';

	/**
	 * Date, prev/next arrows, and the Progress mood reading.
	 *
	 * Navigation is unbounded in both directions, including to dates with no tasks —
	 * that is how a task gets planned ahead.
	 */
	type Props = {
		date: string;
		environment: Environment;
		clearedPct: number;
		onNavigate: (date: string) => void;
	};

	const { date, environment, clearedPct, onNavigate }: Props = $props();

	const label = $derived(formatDay(date));
	// Calm hides the number entirely; there is nothing to score.
	const showsMood = $derived(environment === 'progress');
</script>

<header>
	<button
		type="button"
		class="arrow"
		aria-label="Previous day"
		onclick={() => onNavigate(shiftDate(date, -1))}
	>
		‹
	</button>

	<div class="day">
		<h1>{label}</h1>
		{#if showsMood}
			<p class="mood">{moodPercent(clearedPct)}% · {moodWord(clearedPct)}</p>
		{/if}
	</div>

	<button
		type="button"
		class="arrow"
		aria-label="Next day"
		onclick={() => onNavigate(shiftDate(date, 1))}
	>
		›
	</button>
</header>

<style>
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		padding-top: max(0.75rem, env(safe-area-inset-top));
		color: #fff;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
	}

	.day {
		text-align: center;
	}

	h1 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		letter-spacing: 0.01em;
	}

	.mood {
		margin: 0.15rem 0 0;
		font-size: 0.8rem;
		opacity: 0.85;
	}

	.arrow {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border: 0;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
		backdrop-filter: blur(8px);
		color: inherit;
		font-size: 1.4rem;
		line-height: 1;
		cursor: pointer;
	}

	.arrow:hover {
		background: rgba(255, 255, 255, 0.25);
	}

	.arrow:focus-visible {
		outline: 2px solid #fff;
		outline-offset: 2px;
	}
</style>

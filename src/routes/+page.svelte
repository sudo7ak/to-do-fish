<script lang="ts">
	import { onMount } from 'svelte';

	import { LocalTaskStore } from '$lib/persist/local';
	import { createTaskStore, type TaskDraft } from '$lib/store/tasks';
	import { createTicker } from '$lib/store/ticker';
	import { pearlBalance, canAfford } from '$lib/store/pearls';
	import { buildScene } from '$lib/scene/build';
	import { palette } from '$lib/render/palette';
	import { drawTank, drawForeground, drawFeed } from '$lib/render/water';
	import { drawCreatures } from '$lib/render/creatures';
	import { pick } from '$lib/render/pick';
	import type { Frame } from '$lib/render/loop';
	import type { Task } from '$lib/types';

	import Tank from '$lib/ui/Tank.svelte';
	import DateHeader, { today, formatDay } from '$lib/ui/DateHeader.svelte';
	import TaskSheet from '$lib/ui/TaskSheet.svelte';
	import CreatureSheet, { tapAction } from '$lib/ui/CreatureSheet.svelte';
	import ListView from '$lib/ui/ListView.svelte';
	import Controls from '$lib/ui/Controls.svelte';
	import Banner from '$lib/ui/Banner.svelte';
	import Settings from '$lib/ui/Settings.svelte';
	import Legend from '$lib/ui/Legend.svelte';
	import { shouldAutoOpen } from '$lib/store/settings';

	const store = createTaskStore(new LocalTaskStore());
	const { tasks, koi, settings, saveFailed } = store;

	let date = $state(today());

	/**
	 * Today, kept current while the app is open.
	 *
	 * Polled rather than derived: nothing else changes at midnight, so there is no
	 * reactive source to hang this off. Cheap — a string comparison a few times a
	 * minute — and it also catches a laptop waking on a different day, which is the
	 * case a single timer set at load would miss.
	 *
	 * The viewed date is deliberately *not* moved when this rolls over. Yanking someone
	 * to a new day mid-sentence is worse than letting the header say "Yesterday" and
	 * offer the way back.
	 */
	let now = $state(today());
	let selected = $state<Task | null>(null);
	let editing = $state<Task | undefined>(undefined);
	let sheetOpen = $state(false);
	let listOpen = $state(false);
	let settingsOpen = $state(false);
	let legendOpen = $state(false);

	/**
	 * The last frame the tank painted. Picking must answer against exactly what was
	 * drawn, so it reuses this rather than the wall clock.
	 */
	let lastFrame = { time: 0, size: { w: 0, h: 0 }, animate: true };

	const pearls = $derived(pearlBalance($tasks));
	const scene = $derived(buildScene($tasks, $koi, date, Date.now()));
	const clearedPct = $derived(scene.clearedPct);

	// Only after hydrating: before the store loads, every day looks empty, and a
	// message that flashes on every launch is worse than none.
	let hydrated = $state(false);
	const emptyDay = $derived(hydrated && scene.creatures.length === 0);

	onMount(() => {
		const ticker = createTicker(store);
		store.hydrate().then(() => {
			hydrated = true;
			ticker.start();

			// Written the moment it is shown, not when it is closed: a reload mid-view
			// must not bring it back. The write goes through `commit` like any other
			// mutation, so a storage failure surfaces on the existing banner.
			if (shouldAutoOpen(store.snapshot().settings)) {
				legendOpen = true;
				store.markLegendSeen();
			}
		});

		const rollover = () => (now = today());
		const clock = setInterval(rollover, 20_000);
		// A sleeping machine runs no timers, so the wake is where the day usually turns.
		// A phone gives back more than one kind of wake: a frozen tab thaws with
		// `resume` and a back/forward-cache restore only fires `pageshow`.
		const wakeEvents = ['visibilitychange', 'pageshow', 'resume', 'focus'];
		for (const event of wakeEvents) {
			document.addEventListener(event, rollover);
			window.addEventListener(event, rollover);
		}

		// Both the interval and the wake listeners leak without this.
		return () => {
			ticker.stop();
			clearInterval(clock);
			for (const event of wakeEvents) {
				document.removeEventListener(event, rollover);
				window.removeEventListener(event, rollover);
			}
		};
	});

	/**
	 * Paints one frame.
	 *
	 * Reads the store with `snapshot()` — a `get()` underneath — rather than
	 * subscribing. That is the property Svelte was chosen for: the loop runs sixty
	 * times a second and must never trigger a component re-render.
	 */
	function draw(ctx: CanvasRenderingContext2D, frame: Frame, size: { w: number; h: number }) {
		const state = store.snapshot();
		const scene = buildScene(state.tasks, state.koi, date, Date.now());
		const colors = palette(state.settings.environment, scene.clearedPct);

		// Under reduced motion the clock is pinned, so ambient drift holds still
		// while state changes still repaint.
		const time = frame.animate ? frame.time : 0;
		lastFrame = { time, size, animate: frame.animate };

		drawTank(ctx, size, colors, time, scene.pearls);
		// Behind the creatures: the fish rise through the food, not under it.
		drawFeed(ctx, size, time, frame.animate ? scene.feeding : 0);
		drawCreatures(ctx, scene.creatures, colors, size, time, frame.animate, scene.feeding);
		// Haze and vignette last, so they sit over the creatures and give the tank depth.
		drawForeground(ctx, size, colors);
	}

	function tapTank(event: PointerEvent) {
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };

		const state = store.snapshot();
		const scene = buildScene(state.tasks, state.koi, date, Date.now());
		const hit = pick(scene.creatures, point, lastFrame.size, lastFrame.time, lastFrame.animate);

		// The overflow treat stands for several tasks at once, so it cannot open a
		// sheet — it opens the list, which is the view that can show them all.
		if (hit && !hit.taskId && hit.kind === 'treat') {
			listOpen = true;
			return;
		}

		// Pearls stand for no task at all.
		const task = hit?.taskId ? state.tasks.find((t) => t.id === hit.taskId) : undefined;
		if (!task) return;

		switch (tapAction(task, canAfford(state.tasks, task))) {
			case 'release':
				store.releaseBubble(task.id);
				break;
			case 'claim':
				store.claimTreat(task.id);
				break;
			case 'sheet':
				selected = task;
				break;
		}
	}

	function openAdd() {
		editing = undefined;
		sheetOpen = true;
	}

	function openEdit(task: Task) {
		editing = task;
		selected = null;
		sheetOpen = true;
	}

	function save(draft: TaskDraft) {
		return editing
			? store.editTask(editing.id, draft)
			: store.addTask(draft);
	}
</script>

<svelte:head>
	<title>Fish Tank</title>
</svelte:head>

<main>
	<!-- Pointer picking lives on the wrapper. A canvas offers nothing to a keyboard or
	     a screen reader, so no ARIA role here would be honest: the List view is the
	     genuine keyboard-reachable route to every one of these actions, backed by the
	     same store. That is why it is a first-class second view rather than a fallback. -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="tank" onpointerdown={tapTank}>
		<Tank {draw} />
	</div>

	<div class="chrome">
		<DateHeader
			{date}
			environment={$settings.environment}
			{clearedPct}
			{now}
			onNavigate={(next) => (date = next)}
		/>
	</div>

	{#if emptyDay}
		<p class="empty">
			<span>Nothing in the tank for {formatDay(date)}.</span>
			<small>Add a task and it will start swimming.</small>
		</p>
	{/if}

	<Banner visible={$saveFailed} />

	<Controls
		{pearls}
		onAdd={openAdd}
		onOpenList={() => (listOpen = true)}
		onOpenSettings={() => (settingsOpen = true)}
	/>

	<CreatureSheet
		task={selected}
		affordable={selected ? canAfford($tasks, selected) : false}
		onComplete={(id) => store.completeTask(id)}
		onRelease={(id) => store.releaseBubble(id)}
		onClaim={(id) => store.claimTreat(id)}
		onEdit={openEdit}
		onMove={(id, to) => store.moveToDate(id, to)}
		onDelete={(id) => store.softDelete(id)}
		onClose={() => (selected = null)}
	/>

	<TaskSheet
		open={sheetOpen}
		{date}
		tasks={$tasks}
		task={editing}
		onSave={save}
		onClose={() => (sheetOpen = false)}
	/>

	<ListView
		open={listOpen}
		{date}
		tasks={$tasks}
		onComplete={(id) => store.completeTask(id)}
		onRelease={(id) => store.releaseBubble(id)}
		onClaim={(id) => store.claimTreat(id)}
		onEdit={openEdit}
		onMove={(id, to) => store.moveToDate(id, to)}
		onDelete={(id) => store.softDelete(id)}
		onClose={() => (listOpen = false)}
	/>

	<Settings
		open={settingsOpen}
		environment={$settings.environment}
		onChange={(environment) => store.setEnvironment(environment)}
		onOpenLegend={() => (legendOpen = true)}
		onClose={() => (settingsOpen = false)}
	/>

	<Legend
		open={legendOpen}
		environment={$settings.environment}
		onClose={() => (legendOpen = false)}
	/>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #4fc3d9;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
		overscroll-behavior: none;
	}

	main {
		position: relative;
		height: 100dvh;
		overflow: hidden;
	}

	.tank {
		position: absolute;
		inset: 0;
	}

	.chrome {
		position: relative;
		pointer-events: none;
	}

	.chrome :global(button) {
		pointer-events: auto;
	}

	.empty {
		position: absolute;
		top: 45%;
		left: 0;
		right: 0;
		display: grid;
		gap: 0.35rem;
		margin: 0;
		text-align: center;
		color: #fff;
		text-shadow: 0 1px 6px rgba(0, 0, 0, 0.3);
		pointer-events: none;
	}

	.empty span {
		font-size: 1rem;
	}

	.empty small {
		font-size: 0.85rem;
		opacity: 0.8;
	}
</style>

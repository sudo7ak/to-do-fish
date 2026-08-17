<script lang="ts">
	import { base } from '$app/paths';
</script>

<svelte:head>
	<title>About — Fish Tank To-Do</title>
	<meta
		name="description"
		content="Fish Tank To-Do turns your task list into an aquarium. Every task is a fish, finishing one feeds the tank, and guilty pleasures are treats you buy with pearls."
	/>
	<link rel="canonical" href="https://to-do-fish.com/about" />

	<meta property="og:type" content="article" />
	<meta property="og:url" content="https://to-do-fish.com/about" />
	<meta property="og:title" content="About — Fish Tank To-Do" />
	<meta
		property="og:description"
		content="Fish Tank To-Do turns your task list into an aquarium. Every task is a fish, finishing one feeds the tank, and guilty pleasures are treats you buy with pearls."
	/>
	<meta property="og:image" content="https://to-do-fish.com/og-image.png" />
</svelte:head>

<div class="page">
	<header class="site-header">
		<a href="{base}/" class="back">← Back to the tank</a>
	</header>

	<main class="content">
		<h1>A to-do list where every task is a fish</h1>
		<p class="lede">
			Fish Tank To-Do is a free, local-first to-do app. There's no list on the main
			screen — the whole interface is an aquarium, and every task you add swims in it
			until it's done.
		</p>

		<h2>How it works</h2>
		<p>
			Add a task and a fish joins the tank. Finish it and the tank gets fed — food
			scatters, the shoal quickens for a moment, and the fish that was waiting settles
			in. Nothing about the tank is decoration layered on top of a list; the tank
			<em>is</em> the list.
		</p>

		<h2>If-then tasks</h2>
		<p>
			Some tasks shouldn't nag you before they're relevant. An if-then task — "if it
			rains, then bring in the washing" — waits inside a bubble until its condition is
			met, instead of sitting in your face from the moment you write it down.
		</p>

		<h2>Guilty pleasures, priced in pearls</h2>
		<p>
			Guilty pleasures are treats: the things you want to let yourself have, but only
			after you've earned them. They're exotic fish cruising below the waterline, dim
			until you can afford them. Every task you finish drops a pearl, and pearls are a
			running balance — save across days for something bigger, the way the mechanic is
			meant to work.
		</p>

		<h2>Koi, for the days you clear</h2>
		<p>
			Clear every task on a day — at least one task, all of them done — and a koi joins
			the tank for good. It's not a streak that resets if you slip; it's a record of
			the days you actually cleared.
		</p>

		<h2>Local-first, sign-in optional</h2>
		<p>
			The app works completely with no account and no network — your tasks live in
			your browser and never leave your device unless you choose otherwise. Signing in
			with Google adds sync across your devices; it's an addition, not a requirement.
			See the <a href="{base}/privacy">privacy policy</a> for exactly what that syncs
			and what it doesn't.
		</p>

		<p class="cta"><a href="{base}/">Open the tank →</a></p>
	</main>
</div>

<style>
	.page {
		min-height: 100dvh;
		background: #f5fcfd;
		color: #12303a;
		font-family:
			system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
	}

	.site-header {
		padding: 1.25rem 1.5rem;
		border-bottom: 1px solid rgba(18, 48, 58, 0.08);
	}

	.back {
		color: #12303a;
		text-decoration: none;
		font-size: 0.9rem;
		opacity: 0.7;
		transition: opacity 0.12s;
	}

	.back:hover {
		opacity: 1;
	}

	.content {
		max-width: 42rem;
		margin: 0 auto;
		padding: 2.5rem 1.5rem 4rem;
	}

	h1 {
		margin: 0 0 0.6rem;
		font-size: 1.75rem;
		font-weight: 700;
		line-height: 1.25;
	}

	.lede {
		font-size: 1.05rem;
		line-height: 1.7;
		opacity: 0.85;
	}

	h2 {
		margin: 2.25rem 0 0.6rem;
		font-size: 1.1rem;
		font-weight: 600;
		border-bottom: 1px solid rgba(18, 48, 58, 0.1);
		padding-bottom: 0.35rem;
	}

	p {
		margin: 0.6rem 0;
		font-size: 0.95rem;
		line-height: 1.7;
	}

	a {
		color: #1a7a9a;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	a:hover {
		color: #12303a;
	}

	.cta {
		margin-top: 2rem;
		font-size: 1.05rem;
		font-weight: 600;
	}
</style>

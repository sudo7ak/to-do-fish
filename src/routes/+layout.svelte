<script lang="ts">
	import { onMount } from 'svelte';

	let { children } = $props();

	// The one network call in the app. Everything else is localStorage, and the tank
	// keeps working with this blocked -- the script is `defer` and nothing reads it.
	const UMAMI_SRC = 'https://cloud.umami.is/script.js';
	const UMAMI_WEBSITE_ID = '95339bea-458c-446c-9c19-865b93ee5bfa';

	onMount(() => {
		// Two gates, because the counts are only worth having if they are honest.
		// `import.meta.env.PROD` keeps the dev server and the 62-check E2E sweep out of
		// the numbers; the hostname check catches `npm run preview`, which is a
		// production build served at localhost and would otherwise report as real use.
		const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
		if (!import.meta.env.PROD || local) return;

		const script = document.createElement('script');
		script.defer = true;
		script.src = UMAMI_SRC;
		script.dataset.websiteId = UMAMI_WEBSITE_ID;
		document.head.appendChild(script);
	});
</script>

{@render children()}

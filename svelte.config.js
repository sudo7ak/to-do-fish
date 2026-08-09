import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * GitHub Pages serves a project site from `/<repo>/`, not from the domain root, so
 * every built asset URL needs that prefix. Empty locally and in CI's own checks —
 * only the Pages build sets it — because a base path would break the dev server and
 * the E2E sweep, which both talk to `/`.
 */
const base = process.env.BASE_PATH ?? '';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			fallback: undefined,
			strict: true
		}),
		paths: { base }
	}
};

export default config;

import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { sentryVitePlugin } from '@sentry/vite-plugin';

export default defineConfig({
	plugins: [
		sveltekit(),
		// Upload source maps to Sentry during production builds only.
		// SENTRY_AUTH_TOKEN must be set in the build environment (GitHub Actions secret).
		// Skipped silently when the token is absent (local dev, preview builds).
		sentryVitePlugin({
			org: 'sudo-labs-1i',
			project: 'javascript-sveltekit',
			// Token is injected at build time via env var — never committed.
			authToken: process.env.SENTRY_AUTH_TOKEN,
			// Only upload during a real CI build, not local dev.
			disable: !process.env.SENTRY_AUTH_TOKEN,
			telemetry: false,
			sourcemaps: {
				// The static build output.
				assets: ['./build/**']
			}
		})
	],
	build: {
		// Required for Sentry to correlate source maps with minified bundles.
		sourcemap: true
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});

import * as Sentry from '@sentry/sveltekit';

/**
 * Client-side Sentry initialisation.
 *
 * Only loads in production — the hostname check matches the Umami guard so
 * both analytics tools stay out of dev and the E2E sweep.
 *
 * adapter-static produces no server, so there is no hooks.server.ts.
 * Error events go directly from the browser to Sentry's ingest.
 */
Sentry.init({
	dsn: 'https://83eb6e14e2dfad1be5d35a3d46818812@o4511898992115712.ingest.de.sentry.io/4511898998931536',

	// Only report in production — not dev, not preview, not the E2E sweep.
	enabled: import.meta.env.PROD && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname),

	environment: 'production',

	// 10 % of sessions get a performance trace — enough to catch regressions
	// without burning through the free quota.
	tracesSampleRate: 0.1,

	// No replays — users' task titles are personal data.
	replaysSessionSampleRate: 0,
	replaysOnErrorSampleRate: 0
});

export const handleError = Sentry.handleErrorWithSentry();

/**
 * A tab left open across a deploy still has the old `index.html`, whose links point at
 * hashed chunk filenames a new build has already dropped from the CDN. The next
 * client-side navigation then fails to fetch its route module and the app is stuck on
 * a dead page — the fix is just a reload, so `index.html` picks up the new build.
 *
 * `sessionStorage`, not a module-level flag: a flag survives only until the reload
 * this handler itself triggers, so a second genuine failure right after would loop.
 * The key is cleared once a navigation actually succeeds, so a later deploy can still
 * trigger one reload rather than being silently swallowed by a stale guard.
 */
if (typeof window !== 'undefined') {
	// Reaching this line at all means the current load already succeeded, so any guard
	// set by a previous load has done its job.
	sessionStorage.removeItem('reloaded-after-preload-error');

	window.addEventListener('vite:preloadError', (event) => {
		event.preventDefault();
		if (sessionStorage.getItem('reloaded-after-preload-error')) return;
		sessionStorage.setItem('reloaded-after-preload-error', '1');
		window.location.reload();
	});
}

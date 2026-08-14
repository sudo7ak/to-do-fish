/**
 * Thin wrapper over the umami global. The script is loaded lazily (and skipped
 * entirely in dev/localhost, see +layout.svelte), so `window.umami` may not exist
 * yet or ever -- every call here must no-op rather than throw.
 */
declare global {
	interface Window {
		umami?: { track: (name: string, data?: Record<string, unknown>) => void };
	}
}

export function track(name: string, data?: Record<string, unknown>): void {
	if (typeof window === 'undefined') return;
	window.umami?.track(name, data);
}

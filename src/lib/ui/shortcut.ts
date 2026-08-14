/**
 * A device-local keyboard shortcut for opening the list view. Deliberately not part
 * of `Settings`/`Snapshot`: a shortcut is bound to one physical keyboard on one
 * machine — a phone has none, and a combo picked on a desktop means nothing synced
 * to a tablet. It lives in its own `localStorage` key, read fresh on every keydown,
 * and never goes through the `TaskStore` port or sync.
 *
 * Blank (no key stored) is the default. A bare, unmodified letter is exactly what
 * Vim-style browser extensions bind, and they intercept the keydown before the page
 * ever sees it — shipping a default collided with one of those live. Leaving it
 * unset and letting each person pick their own combo sidesteps that permanently:
 * whatever they choose, they chose it knowing what else is bound on their machine.
 */

export type Shortcut = {
	/** KeyboardEvent.code — the physical key, independent of Caps Lock, Option/Alt
	 *  character composition, and keyboard layout. */
	code: string;
	shift: boolean;
	ctrl: boolean;
	alt: boolean;
	meta: boolean;
};

const STORAGE_KEY = 'fish-tank-todo/list-shortcut';

/** Reading `localStorage` itself can throw where storage is disabled outright. */
function safeLocalStorage(): Storage | undefined {
	try {
		return typeof localStorage === 'undefined' ? undefined : localStorage;
	} catch {
		return undefined;
	}
}

/**
 * `storage` is injected — same reason as `LocalTaskStore`: the failure and
 * corrupt-data paths need to be tested without a browser, and storage may be
 * absent entirely (Safari private mode, disabled storage).
 */
export function loadShortcut(storage: Storage | undefined = safeLocalStorage()): Shortcut | null {
	if (!storage) return null;
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		if (typeof parsed?.code !== 'string') return null;
		return {
			code: parsed.code,
			shift: !!parsed.shift,
			ctrl: !!parsed.ctrl,
			alt: !!parsed.alt,
			meta: !!parsed.meta
		};
	} catch {
		return null;
	}
}

export function saveShortcut(
	shortcut: Shortcut | null,
	storage: Storage | undefined = safeLocalStorage()
): void {
	if (!storage) return;
	if (shortcut === null) {
		storage.removeItem(STORAGE_KEY);
		return;
	}
	storage.setItem(STORAGE_KEY, JSON.stringify(shortcut));
}

/** A shortcut can't be "just Shift" — these codes only ever combine with a real key. */
const BARE_MODIFIER_CODES = new Set([
	'ShiftLeft',
	'ShiftRight',
	'ControlLeft',
	'ControlRight',
	'AltLeft',
	'AltRight',
	'MetaLeft',
	'MetaRight'
]);

/** Builds a `Shortcut` from a captured keydown, or `null` if the key alone can't be one. */
export function fromEvent(e: KeyboardEvent): Shortcut | null {
	if (BARE_MODIFIER_CODES.has(e.code)) return null;
	return { code: e.code, shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey };
}

/** Whether a keydown exactly matches a stored shortcut — every modifier, not just the key. */
export function matches(e: KeyboardEvent, shortcut: Shortcut | null): boolean {
	if (!shortcut) return false;
	return (
		e.code === shortcut.code &&
		e.shiftKey === shortcut.shift &&
		e.ctrlKey === shortcut.ctrl &&
		e.altKey === shortcut.alt &&
		e.metaKey === shortcut.meta
	);
}

/** Human-readable label, e.g. "Shift + L". `null` reads as "Not set". */
export function describe(shortcut: Shortcut | null): string {
	if (!shortcut) return 'Not set';
	const parts: string[] = [];
	if (shortcut.ctrl) parts.push('Ctrl');
	if (shortcut.alt) parts.push('Alt');
	if (shortcut.shift) parts.push('Shift');
	if (shortcut.meta) parts.push('Cmd');
	parts.push(shortcut.code.replace(/^Key|^Digit/, ''));
	return parts.join(' + ');
}

import { describe as suite, it, expect } from 'vitest';
import { loadShortcut, saveShortcut, fromEvent, matches, describe } from './shortcut';

const key = (over: Partial<KeyboardEvent> = {}): KeyboardEvent =>
	({
		code: 'KeyL',
		shiftKey: false,
		ctrlKey: false,
		altKey: false,
		metaKey: false,
		...over
	}) as KeyboardEvent;

/** Minimal in-memory stand-in for the Web Storage API, same as persist/local.test.ts. */
class FakeStorage {
	map = new Map<string, string>();
	getItem(key: string) {
		return this.map.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.map.set(key, value);
	}
	removeItem(key: string) {
		this.map.delete(key);
	}
}

suite('loadShortcut / saveShortcut', () => {
	it('is blank by default', () => {
		expect(loadShortcut(new FakeStorage() as unknown as Storage)).toBeNull();
	});

	it('is blank with no storage at all', () => {
		expect(loadShortcut(undefined)).toBeNull();
	});

	it('round-trips what it saved', () => {
		const storage = new FakeStorage() as unknown as Storage;
		const shortcut = { code: 'KeyL', shift: true, ctrl: false, alt: false, meta: false };
		saveShortcut(shortcut, storage);
		expect(loadShortcut(storage)).toEqual(shortcut);
	});

	it('clears back to blank on a null save', () => {
		const storage = new FakeStorage() as unknown as Storage;
		saveShortcut({ code: 'KeyL', shift: true, ctrl: false, alt: false, meta: false }, storage);
		saveShortcut(null, storage);
		expect(loadShortcut(storage)).toBeNull();
	});

	it('treats corrupt stored JSON as blank rather than throwing', () => {
		const storage = new FakeStorage() as unknown as Storage;
		storage.setItem('fish-tank-todo/list-shortcut', '{not json');
		expect(loadShortcut(storage)).toBeNull();
	});

	it('treats a stored value with no code as blank', () => {
		const storage = new FakeStorage() as unknown as Storage;
		storage.setItem('fish-tank-todo/list-shortcut', JSON.stringify({ shift: true }));
		expect(loadShortcut(storage)).toBeNull();
	});
});

suite('fromEvent', () => {
	it('captures the physical key and every modifier', () => {
		expect(fromEvent(key({ shiftKey: true }))).toEqual({
			code: 'KeyL',
			shift: true,
			ctrl: false,
			alt: false,
			meta: false
		});
	});

	it('refuses a bare modifier as its own shortcut', () => {
		expect(fromEvent(key({ code: 'ShiftLeft', shiftKey: true }))).toBeNull();
		expect(fromEvent(key({ code: 'ControlLeft', ctrlKey: true }))).toBeNull();
	});
});

suite('matches', () => {
	it('is false against a blank shortcut', () => {
		expect(matches(key(), null)).toBe(false);
	});

	it('requires every modifier to agree, not just the key', () => {
		const shortcut = { code: 'KeyL', shift: true, ctrl: false, alt: false, meta: false };
		expect(matches(key({ shiftKey: true }), shortcut)).toBe(true);
		expect(matches(key({ shiftKey: false }), shortcut)).toBe(false);
		expect(matches(key({ shiftKey: true, ctrlKey: true }), shortcut)).toBe(false);
	});

	it('is case/layout independent — matches on code, not key', () => {
		const shortcut = { code: 'KeyL', shift: true, ctrl: false, alt: false, meta: false };
		// Caps Lock or a non-US layout can change `key` without changing `code`.
		expect(matches(key({ shiftKey: true, key: 'L' } as Partial<KeyboardEvent>), shortcut)).toBe(
			true
		);
	});
});

suite('describe', () => {
	it('reads "Not set" for blank', () => {
		expect(describe(null)).toBe('Not set');
	});

	it('lists modifiers before the key, in a fixed order', () => {
		expect(describe({ code: 'KeyL', shift: true, ctrl: true, alt: false, meta: false })).toBe(
			'Ctrl + Shift + L'
		);
	});

	it('strips the Key/Digit code prefix', () => {
		expect(describe({ code: 'Digit3', shift: false, ctrl: false, alt: false, meta: false })).toBe(
			'3'
		);
	});
});

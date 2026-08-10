import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { createAuth, type AuthClient } from './session';

const USER = { id: 'user-1', email: 'someone@example.com' };

function fakeClient(session: { user: typeof USER } | null = null) {
	const listeners: ((session: { user: typeof USER } | null) => void)[] = [];
	const state = { signedIn: false, signedOut: false };

	return {
		get signedIn() {
			return state.signedIn;
		},
		get signedOut() {
			return state.signedOut;
		},
		auth: {
			getSession: async () => ({ data: { session }, error: null }),
			onAuthStateChange(callback: (event: string, s: { user: typeof USER } | null) => void) {
				listeners.push((s) => callback('x', s));
				return { data: { subscription: { unsubscribe() {} } } };
			},
			async signInWithOAuth() {
				state.signedIn = true;
				return { error: null };
			},
			async signOut() {
				state.signedOut = true;
				return { error: null };
			}
		},
		emit(next: { user: typeof USER } | null) {
			for (const listener of listeners) listener(next);
		}
	} as unknown as AuthClient & { signedIn: boolean; signedOut: boolean; emit: (s: unknown) => void };
}

describe('createAuth', () => {
	it('has no account before anyone signs in', async () => {
		const auth = createAuth(fakeClient(null));
		await auth.ready;

		expect(get(auth.account)).toBeNull();
	});

	it('picks up a session that already exists', async () => {
		const auth = createAuth(fakeClient({ user: USER }));
		await auth.ready;

		expect(get(auth.account)).toEqual({ id: 'user-1', email: 'someone@example.com' });
	});

	it('follows a sign-in that happens later', async () => {
		const client = fakeClient(null);
		const auth = createAuth(client);
		await auth.ready;

		client.emit({ user: USER });

		expect(get(auth.account)?.id).toBe('user-1');
	});

	it('clears the account on sign-out', async () => {
		const client = fakeClient({ user: USER });
		const auth = createAuth(client);
		await auth.ready;

		client.emit(null);

		expect(get(auth.account)).toBeNull();
	});

	it('asks the client to sign out rather than only forgetting locally', async () => {
		const client = fakeClient({ user: USER });
		const auth = createAuth(client);
		await auth.ready;

		await auth.signOut();

		expect(client.signedOut).toBe(true);
	});
});

describe('createAuth — unconfigured', () => {
	it('reports no account and no client when Supabase is not configured', async () => {
		// The app must build and run with no cloud project at all: this is how the E2E
		// sweep and the screenshot scripts run.
		const auth = createAuth(null);
		await auth.ready;

		expect(get(auth.account)).toBeNull();
		expect(auth.client).toBeNull();
	});

	it('does not throw when signIn is called with no client', async () => {
		const auth = createAuth(null);

		await expect(auth.signIn()).resolves.toBeUndefined();
	});
});

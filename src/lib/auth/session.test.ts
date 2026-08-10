import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { createAuth, type AuthClient } from './session';

const USER = { id: 'user-1', email: 'someone@example.com' };

function fakeClient(session: { user: typeof USER } | null = null) {
	const listeners: ((session: { user: typeof USER } | null) => void)[] = [];
	const state = {
		signedIn: false,
		signedOut: false,
		signInCalls: [] as { provider: string; options?: { redirectTo?: string } }[]
	};

	return {
		get signedIn() {
			return state.signedIn;
		},
		get signedOut() {
			return state.signedOut;
		},
		get signInCalls() {
			return state.signInCalls;
		},
		auth: {
			getSession: async () => ({ data: { session }, error: null }),
			onAuthStateChange(callback: (event: string, s: { user: typeof USER } | null) => void) {
				listeners.push((s) => callback('x', s));
				return { data: { subscription: { unsubscribe() {} } } };
			},
			async signInWithOAuth(options: { provider: string; options?: { redirectTo?: string } }) {
				state.signedIn = true;
				state.signInCalls.push(options);
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
	} as unknown as AuthClient & {
		signedIn: boolean;
		signedOut: boolean;
		signInCalls: { provider: string; options?: { redirectTo?: string } }[];
		emit: (s: unknown) => void;
	};
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

	it('asks the client to sign in with Google, redirecting without a query string', async () => {
		// The test environment is plain node, with no `window`; signIn() reads
		// window.location.href, so a fake stands in for the address bar here.
		vi.stubGlobal('window', { location: { href: 'https://example.com/app?code=abc123' } });

		const client = fakeClient(null);
		const auth = createAuth(client);
		await auth.ready;

		await auth.signIn();

		expect(client.signInCalls).toHaveLength(1);
		expect(client.signInCalls[0].provider).toBe('google');
		// A shared or bookmarked link must never carry someone's auth code back in.
		expect(client.signInCalls[0].options?.redirectTo).toBe('https://example.com/app');

		vi.unstubAllGlobals();
	});

	it('strips a fragment as well as a query string', async () => {
		// `redirectTo` is matched against an exact allowlist. A deep link leaves a
		// fragment on the address bar, and a fragment the allowlist has never seen
		// fails the match with a message that says nothing useful.
		vi.stubGlobal('window', { location: { href: 'https://example.com/app#legend' } });

		const client = fakeClient(null);
		const auth = createAuth(client);
		await auth.ready;

		await auth.signIn();

		expect(client.signInCalls[0].options?.redirectTo).toBe('https://example.com/app');

		vi.unstubAllGlobals();
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

import { createClient } from '@supabase/supabase-js';
import { writable, type Readable } from 'svelte/store';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import type { SupabaseLike } from '../persist/sync/remote';

/**
 * Who is signed in, if anyone.
 *
 * Absent configuration is a supported state, not an error: with no project URL the
 * app runs exactly as it did before sync existed, which is what lets the E2E sweep
 * and the screenshot scripts work without a cloud account.
 */

export type Account = { id: string; email: string | null };

/** The slice of the Supabase client used here, so a test can supply a fake. */
export type AuthClient = {
	auth: {
		getSession(): Promise<{ data: { session: { user: { id: string; email?: string } } | null } }>;
		onAuthStateChange(
			callback: (event: string, session: { user: { id: string; email?: string } } | null) => void
		): { data: { subscription: { unsubscribe(): void } } };
		signInWithOAuth(options: {
			provider: 'google';
			options?: { redirectTo?: string };
		}): Promise<{ error: unknown }>;
		signOut(): Promise<{ error: unknown }>;
	};
};

export type Auth = {
	account: Readable<Account | null>;
	/** Resolves once the existing session, if any, has been read. */
	ready: Promise<void>;
	signIn(): Promise<void>;
	signOut(): Promise<void>;
	/** The client to hand to `SupabaseRemote`, or null when unconfigured. */
	client: SupabaseLike | null;
};

export function isSyncConfigured(): boolean {
	return Boolean(PUBLIC_SUPABASE_URL && PUBLIC_SUPABASE_ANON_KEY);
}

export function defaultClient(): (AuthClient & SupabaseLike) | null {
	if (!isSyncConfigured()) return null;

	return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
		auth: {
			persistSession: true,
			autoRefreshToken: true,
			// The OAuth return lands back on the app URL carrying a code. This exchanges
			// it and then clears it from the address bar, so a shared or bookmarked link
			// never carries someone's auth code.
			detectSessionInUrl: true,
			flowType: 'pkce'
		}
	}) as unknown as AuthClient & SupabaseLike;
}

export function createAuth(client: (AuthClient & Partial<SupabaseLike>) | null = defaultClient()): Auth {
	const account = writable<Account | null>(null);

	const toAccount = (session: { user: { id: string; email?: string } } | null): Account | null =>
		session ? { id: session.user.id, email: session.user.email ?? null } : null;

	const ready = (async () => {
		if (!client) return;
		const { data } = await client.auth.getSession();
		account.set(toAccount(data.session));
		client.auth.onAuthStateChange((_event, session) => account.set(toAccount(session)));
	})();

	return {
		account,
		ready,
		client: (client as SupabaseLike | null) ?? null,

		async signIn() {
			// Unconfigured is not an error: the control that calls this is not rendered,
			// and a throw here would only turn a missing feature into a crash.
			if (!client) return;
			await client.auth.signInWithOAuth({
				provider: 'google',
				options: { redirectTo: window.location.href.split('?')[0] }
			});
		},

		async signOut() {
			// The local snapshot is deliberately left alone. Signing out is not a delete.
			if (!client) return;
			await client.auth.signOut();
		}
	};
}

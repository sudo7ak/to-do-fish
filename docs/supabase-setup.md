# Supabase setup

What has to exist outside this repository for sync to work. Everything here is a
one-time manual step in a dashboard; none of it is automated, because it is done
once per project and a script would be read less often than this file.

## 1. Project

Create a Supabase project. Note the project URL and the **publishable** key
(`sb_publishable_…`), both offered by the Copy menu on the project home, or under
Settings → API. Supabase used to call this the *anon* key and still issues legacy
JWT-shaped ones under Settings → API → Legacy API keys; either works, and the
publishable key is the current form.

It is public by design and ships in the built JavaScript — row-level security is the
boundary, not the key. What must never appear in this repository, in a build, or in
`.env.local` is the **secret** key (`sb_secret_…`, formerly the service role key):
it bypasses RLS entirely.

## 2. Schema

Run `supabase/schema.sql` in the SQL Editor. It is idempotent — re-running it is
safe.

Verify RLS refuses an anonymous read before going further:

    set role anon;
    select count(*) from public.tasks;  -- must be 0
    reset role;

## 3. Google sign-in

In Google Cloud, create an OAuth 2.0 Client ID of type "Web application":

- Authorized JavaScript origins: `https://sudo7ak.github.io`
- Authorized redirect URI: `https://<project>.supabase.co/auth/v1/callback`

In Supabase, Authentication → Providers → Google: paste the client ID and secret.

In Supabase, Authentication → URL Configuration:

- Site URL: `https://sudo7ak.github.io/to-do-fish/`
- Additional redirect URLs: `http://localhost:5173/`, `http://localhost:5199/`

Both localhost entries matter — 5173 is `npm run dev` and 5199 is what the
screenshot and E2E scripts expect.

## 4. Build configuration

Add two **repository variables** (not secrets — they are public and secrets are
awkward to read in a build) under Settings → Secrets and variables → Actions →
Variables:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Locally, put the same two in `.env.local`, which is gitignored.

With both absent the app builds and runs local-only with sign-in hidden. That is a
supported state, not a broken one: it is how the E2E sweep and the screenshot
scripts run without a cloud account.

## 5. Manual verification checklist

None of this is covered by `npm test` or `npm run e2e`, which run against fakes and
against an unconfigured build. Every item below needs a real project and a real
Google account, and each one guards something that fails silently rather than
loudly.

- [ ] **`schema.sql` executes.** Nothing proves the DDL parses, that the `check`
      constraints match what `toTaskRow` emits, or that `on delete cascade` against
      `auth.users` resolves, until it has been run once.
- [ ] **Anonymous reads return nothing.** The `set role anon` check in section 2.
- [ ] **RLS actually isolates two accounts.** Sign in as one, create a task, sign in
      as a second on another device, and confirm the first account's task is not
      visible. No automated test involves two user ids.
- [ ] **The OAuth round trip completes.** PKCE exchanges, and the session persists
      across a reload.
- [ ] **The address bar is clean afterwards.** Immediately after the redirect back,
      the URL must carry no `code=` and no `access_token`. `detectSessionInUrl` is
      supposed to strip it; nothing in this repository verifies that it does, and an
      auth code sitting in a bookmarked or shared URL is a real leak. Check the bar,
      then check the history entry.
- [ ] **A deep link still signs in.** Open the app with a fragment in the URL and
      sign in from there: `redirectTo` strips both the query and the fragment, and a
      URL that is not on the allowlist fails with a message that explains nothing.
- [ ] **A second account on the same device does not inherit the first one's tank.**
      Sign in as A, sign out, sign in as B on the same browser profile. B must see
      an empty tank, and A's tasks must not appear in B's rows.

# Supabase setup

What has to exist outside this repository for sync to work. Everything here is a
one-time manual step in a dashboard; none of it is automated, because it is done
once per project and a script would be read less often than this file.

## 1. Project

Create a Supabase project. Note the project URL and the **anon** key from
Settings → API. The anon key is public by design and ships in the built JavaScript;
row-level security is the boundary, not the key. The **service role** key must never
appear in this repository or in a build.

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
- `PUBLIC_SUPABASE_ANON_KEY`

Locally, put the same two in `.env.local`, which is gitignored.

With both absent the app builds and runs local-only with sign-in hidden. That is a
supported state, not a broken one: it is how the E2E sweep and the screenshot
scripts run without a cloud account.

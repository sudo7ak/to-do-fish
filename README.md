# fish tank todo

A personal to-do app whose entire interface is an aquarium. Every task is a
creature. There is no list on the main screen.

Live: https://sudo7ak.github.io/to-do-fish/

## What makes it different

- **No list view by default.** Tasks swim as fish. Done tasks become food, sink,
  and eventually surface as a pearl.
- **If-then tasks** wait inside a bubble until their condition is met.
- **Guilty pleasures** are treats priced in pearls — exotic fish cruising below
  the waterline, dim until you can afford them. Finishing a task drops a pearl.
- **Local-first.** Works fully offline with no account. Signing in with Google
  adds multi-device sync on top of the same local store.

## Stack

SvelteKit + Canvas 2D, static build via `adapter-static`, deployed to GitHub
Pages. Optional Supabase backend for auth + sync — the app is feature-complete
without it.

## Commands

```bash
npm run dev          # dev server on :5173
npm test             # unit tests (vitest)
npm run check        # svelte-check, must report 0 errors
npm run build        # static build
npm run screenshot   # PNG of the tank (needs a dev server running)
npm run e2e          # Playwright end-to-end sweep (needs a dev server running)
```

`screenshot` and `e2e` expect a server on port 5199:
`npx vite dev --port 5199 &`.

## Supabase sync (optional)

Copy `.env.local.example`-style vars into `.env.local`:

```
PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

With both unset the app runs local-only and sign-in is hidden — a supported
state, not a broken one. Setup details: `docs/supabase-setup.md`.

## Docs

- `docs/superpowers/specs/2026-08-08-fish-tank-todo-design.md` — app design,
  the source of truth for *why*.
- `docs/superpowers/specs/2026-08-08-fish-anatomy-design.md` — how creatures
  are drawn.
- `docs/pending.md` — live list of open items, tagged by how they were
  verified.
- `CLAUDE.md` — architecture, invariants, and testing conventions for anyone
  (human or agent) working on the code.

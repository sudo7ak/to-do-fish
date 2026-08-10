# Supabase sync — design

**Date:** 2026-08-10
**Status:** approved, not implemented
**Supersedes:** nothing. Extends the app spec
(`2026-08-08-fish-tank-todo-design.md`), whose v1 promise of "no backend, no
accounts, no network calls" holds for every signed-out session and is deliberately
still true of the local path after this lands.

## Goal

The same tank on more than one device. A task added on the phone is in the laptop's
tank; a task ticked on the laptop is a ghost on the phone.

Nothing else. Not sharing, not collaboration, not a server-rendered anything.

## Decisions

Five choices frame everything below. They were made deliberately and the reasoning
is worth more than the choice.

**Multi-device sync, not backup.** Backup would have been a tenth of the work and
would not have answered the actual complaint, which is that the tank on the phone is
a different tank.

**Google OAuth.** One tap on Android, which is where this app is used.

**The app stays fully usable signed out and offline.** This is the constraint that
rules out the simple designs. Ticking a task on the Underground must work, and the
tick must survive to the other device. Local-first is not a fallback path here — it
is the primary path, and sync is an addition to it.

**Last write wins, per task.** `updatedAt` already exists on every task and IDs are
already client-side ULIDs; both were put there for exactly this and cost nothing
until now. Per-field merge was rejected as complexity out of proportion to a
single-user to-do list.

**Sync on wake and after each write.** No Realtime subscription. Mobile freezes
websockets anyway — the wake events wired for the frozen-tab fix are a better
trigger than a connection the OS is going to sever.

## Architecture

The existing `TaskStore` port was written for this and does not change:

```ts
export interface TaskStore {
  load(): Promise<Snapshot>;
  save(snapshot: Snapshot): Promise<void>;
}
```

Four new files, one changed:

```
persist/port.ts          unchanged
persist/local.ts         unchanged
persist/sync/merge.ts    PURE: (local, remote) -> merged + what to push
persist/sync/remote.ts   the only file that imports @supabase/supabase-js
persist/sync/syncing.ts  SyncingTaskStore implements TaskStore, owns both sides
auth/session.ts          Google sign-in, session, config detection
ui/AccountButton.svelte  one control in the date header
```

Signed out, the app constructs `createTaskStore(new LocalTaskStore(...))` — the same
call as today, byte for byte. Sync exists only when a session does. `store/`,
`triggers/`, `scene/`, and `render/` are untouched, and `render/` in particular still
imports nothing outside itself.

### Dependency direction

`merge.ts` imports only `../../types`. It has no idea Supabase exists, which is what
makes the merge rules testable as data in and data out. `remote.ts` knows Supabase
and decides nothing. `syncing.ts` is the only place where a policy and a network meet,
and it is thin because the policy lives next door.

## Data model

Three tables, all keyed by `user_id`, all with RLS `user_id = auth.uid()`. No service
key, no server-side code, no edge functions. The anon key plus RLS is the whole
security model.

```sql
create table tasks (
  user_id      uuid   not null references auth.users on delete cascade,
  id           text   not null,          -- client ULID
  title        text   not null,
  date         text   not null,          -- "2026-08-10", local calendar date
  condition    jsonb,                    -- the discriminated union, intact
  treat_cost   int,
  status       text   not null,          -- waiting | open | done
  created_at   bigint not null,
  completed_at bigint,
  updated_at   bigint not null,
  deleted_at   bigint,                   -- tombstone; rows are never deleted
  primary key (user_id, id)
);

create table koi (
  user_id   uuid   not null references auth.users on delete cascade,
  date      text   not null,
  earned_at bigint not null,
  primary key (user_id, date)
);

create table settings (
  user_id     uuid primary key references auth.users on delete cascade,
  environment text   not null,
  seen_legend bool   not null,
  version     int    not null,           -- SCHEMA_VERSION of the writing client
  updated_at  bigint not null
);
```

Five things about this shape are load-bearing.

**Timestamps are client epoch milliseconds, not `timestamptz`.** `updatedAt` is the
input to last-write-wins and the domain already owns it. A server-generated column
would introduce a second clock that disagrees with the first, and merge would then
depend on which one a given code path happened to read.

**Tombstones replicate.** `deleted_at` rows push and pull like any other row. A
delete that does not replicate is a task that comes back from the dead on the other
device, which is the same class of bug as forgetting the soft-delete filter on a
derived read.

**Koi have no id, and no delete path.** `(user_id, date)` is the natural key. The
merge is a union and the schema offers no way to revoke one, which is the invariant
"koi are awarded once and never revoked" expressed in the storage layer rather than
trusted to callers.

**`condition` stays `jsonb`.** Flattening the union into columns would make invalid
combinations representable — a row with both `at` and `taskId` set. The type has one
shape; so does the column.

**Schema version lives on the settings row, not per task.** One version per user's
data, matching `SCHEMA_VERSION` in `types.ts`.

## Sync

### merge.ts — the pure core

```ts
merge(local: Snapshot, remote: Snapshot): { merged: Snapshot; push: Snapshot }
```

- **Tasks:** union by `id`. Same id on both sides, the higher `updatedAt` replaces
  the row wholesale. On a tie, **the deleted side wins**; failing that, remote wins.
  A tie means clock skew, and resurrecting a deleted task is the worse of the two
  failures.
- **Koi:** union by `date`, keeping the earlier `earnedAt`. Never removed.
- **Settings:** whole-record last-write-wins on its own `updatedAt`.
- **`push`** is exactly the rows remote is missing or stale on. A sync that changes
  nothing pushes nothing and costs one read.

### remote.ts

Rows to `Snapshot` and back: snake_case to camelCase, one upsert batch per table.
Absent optionals must survive the round trip as absent — `treatCost`, `completedAt`,
`condition`, and `deletedAt` must come back `undefined`, never `null`, because
`isLive()` tests for the field's presence and `deletedAt: null` would read as live
while `deletedAt: 0` correctly reads as deleted.

Throws typed errors. Makes no decisions.

### syncing.ts

- **`load()`** returns the local snapshot immediately and kicks off a pull in the
  background. The tank never waits on a network to paint.
- **`save(snapshot)`** writes locally and awaits that — the write that must not fail.
  It then enqueues a push, debounced about two seconds.
- **Pull triggers:** sign-in, launch, and the wake events (`visibilitychange`,
  `pageshow`, `resume`, `focus`) already wired for the frozen-tab fix.
- **A pull that changed something** must reach the UI. `syncing.ts` calls an
  `onExternalChange` callback, and the page re-runs `hydrate()`. This is the only
  addition above `persist/`, and it is one optional callback on the constructor.
- **No durable outbox.** A push sends the whole current snapshot, so a failed push
  needs no record — the next one carries everything. There is no queue file to
  corrupt, and retry is idempotent by construction.
- **Failure is a distinct state from `saveFailed`.** "Not syncing" and "not saving"
  are different sentences and the second one is much more alarming. Local saved fine.

## Auth, config, deployment

**Google OAuth through Supabase**, PKCE, session in localStorage with auto-refresh.

Redirect back to `https://sudo7ak.github.io/to-do-fish/`. Two allowlists need
setting, and forgetting either produces the same opaque failure: the Supabase Auth
redirect URL list, and the Google Cloud OAuth client's authorized origins plus the
`https://<project>.supabase.co/auth/v1/callback` redirect.

GitHub Pages serves no SPA fallback and `adapter-static` runs with
`fallback: undefined`. The OAuth return lands on the base path, which is a real
file, so there is no 404 — but `detectSessionInUrl` has to run before anything
rewrites the URL, and the URL must be cleaned after the code exchange so that a
shared or bookmarked link never carries an auth code.

**Config** is `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_ANON_KEY`, baked at build
time from GitHub Actions repository variables. The anon key is public by design; RLS
is the boundary, not the key.

**Missing config is not an error.** With the variables absent — local dev, a fork, a
CI run — the app builds and runs local-only and the sign-in control is not rendered.
This keeps `npm run e2e` and the screenshot scripts working with no Supabase account,
which matters because the E2E sweep is this project's real safety net and a sweep
that needs cloud credentials is a sweep that stops being run.

**UI is one control:** a sign-in / account button in the date header. Signed out it
reads "Sign in to sync". Signed in it shows the account and offers sign-out. No new
screen and no settings page.

**First sign-in on a device that already has local data merges; it does not ask.**
The local snapshot is pushed and the remote pulled through the same `merge()`. A
week of offline use survives signing in, and because tasks are ULID-keyed there is
nothing to collide.

**Signing out leaves the local snapshot alone.** Sign-out is not a delete. A "sign
out and wipe this device" affordance is out of scope.

## Testing

Vitest over the pure layers, as everywhere else in this project.

**`merge.ts`** carries nearly all the risk and gets the coverage to match: disjoint
sets on both sides; same-id last-write-wins in both directions; the tie going to the
deleted side; a tombstone never resurrecting whatever the other side says; koi as a
union that keeps the earlier `earnedAt` and can never shrink; settings
last-write-wins; and a no-op sync yielding an empty `push`.

Each of those is **validated by mutation** — flip the tie rule to prefer live, drop
the tombstone precedence, make the koi merge a replace — and confirm a test fails. A
merge test that cannot fail is worse than none, because merge bugs are invisible
until data is already gone.

**`syncing.ts`** against a fake remote: the local write is awaited and survives a
throwing push; a failing pull leaves local untouched; several rapid writes debounce
into one push; a pull landing mid-write does not clobber the newer local value.

**`remote.ts`**: the row/`Snapshot` mapping round-trips, including `condition` jsonb
and every absent optional staying absent rather than becoming `null`.

**E2E:** the existing 68 checks must pass with Supabase unconfigured. That is the
regression guard on the claim that local-first is untouched. One check is added for
the sign-in control's presence, and its absence when unconfigured.

Real Google OAuth is not automated. It is a manual checklist: sign in on two devices,
add on one, confirm on the other; go offline, tick, come back, confirm; delete on
one, confirm it stays deleted on the other.

## Failure modes

Each gets a decision. None gets a bare `catch {}`.

| Failure | Behaviour |
| --- | --- |
| Offline | Local works; the next successful push carries everything |
| Token expired, refresh fails | Drop to local-only, offer sign-in, never lose a write |
| RLS rejection | Not-syncing banner, keep local, do not retry in a loop |
| Remote schema newer than this client | Refuse to push, allow reads, banner "this device is out of date" |
| Push partially applied | Whole-snapshot push is idempotent; retry is safe |
| Device clock badly skewed | See below |

**Clock skew is the one that cannot be fully solved.** Last-write-wins on a
client timestamp means a phone whose clock is hours fast makes edits that
permanently win, and one hours slow makes edits that permanently lose. The
mitigation is bounded and honest: on pull, if the remote's maximum `updatedAt`
exceeds local `Date.now()` by more than a threshold, show a skew banner rather than
merging silently. It does not repair the ordering; it stops the user being lied to.

## Out of scope

Realtime subscriptions. Per-field merge. A conflict-resolution UI. Sharing between
users. Server functions of any kind. Storing anything beyond these three tables.
Account deletion.

## Accepted risks

**Per-task last-write-wins can lose a concurrent edit.** Two devices editing the
same task offline — one retitling, one completing — resolve to whichever has the
higher `updatedAt`, and the other change is gone. Accepted knowingly for a
single-user app.

**Clock skew corrupts merge ordering**, mitigated by a banner and nothing stronger.

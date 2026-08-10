-- The whole server side of the fish tank. Three tables, RLS on all of them, and no
-- server-side code: the anon key plus these policies are the entire security model.
--
-- Timestamps are client epoch milliseconds, deliberately. `updated_at` is the input
-- to last-write-wins and the client owns it; a database default would introduce a
-- second clock that disagrees with the first.

create table if not exists public.tasks (
  user_id      uuid   not null references auth.users on delete cascade,
  id           text   not null,
  title        text   not null,
  date         text   not null,
  condition    jsonb,
  treat_cost   int,
  status       text   not null check (status in ('waiting', 'open', 'done')),
  created_at   bigint not null,
  completed_at bigint,
  updated_at   bigint not null,
  -- A soft delete. Rows are never removed: a deletion that does not replicate is a
  -- task that comes back from the dead on the other device.
  deleted_at   bigint,
  primary key (user_id, id)
);

create table if not exists public.koi (
  user_id   uuid   not null references auth.users on delete cascade,
  date      text   not null,
  earned_at bigint not null,
  primary key (user_id, date)
);

create table if not exists public.settings (
  user_id     uuid primary key references auth.users on delete cascade,
  environment text   not null check (environment in ('progress', 'calm')),
  seen_legend boolean not null,
  version     int    not null,
  updated_at  bigint not null
);

alter table public.tasks    enable row level security;
alter table public.koi      enable row level security;
alter table public.settings enable row level security;

-- One policy per table covering every verb. There is no sharing in this app: a row
-- belongs to exactly one account and is invisible to every other.
--
-- `CREATE POLICY` has no `IF NOT EXISTS` form, so re-running this file against a
-- database where it already succeeded would otherwise abort here with "policy
-- already exists" and never reach the statements below. The drop makes a re-run
-- safe; it is a no-op on a clean database, where the policy does not exist yet.
drop policy if exists "own tasks"    on public.tasks;
drop policy if exists "own koi"      on public.koi;
drop policy if exists "own settings" on public.settings;
create policy "own tasks"    on public.tasks    for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own koi"      on public.koi      for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own settings" on public.settings for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Note what `for all` does *not* do: it grants DELETE as well. "Koi are awarded once
-- and never revoked" is therefore still a client-side invariant, honoured by the
-- merge being a union, and not something this schema enforces. Splitting koi into
-- separate for select / for insert / for update policies would make it enforced.

-- Deliberately absent: any trigger, default, or generated column touching
-- `updated_at`. The merge depends on the client's number arriving unmodified.

-- The tank is only ever read a whole account at a time, so this is the only index
-- worth having beyond the primary keys.
create index if not exists tasks_user_updated on public.tasks (user_id, updated_at);

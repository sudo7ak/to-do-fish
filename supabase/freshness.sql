-- One question instead of three table reads: what is the newest timestamp this
-- account holds? A wake sync that gets the same answer as last time can skip the
-- pull entirely, because nothing on the server has moved.
--
-- `security invoker` matters: the function runs as the caller, so the row-level
-- security policies still apply and `auth.uid()` is the signed-in user. A
-- `security definer` function here would read every account's rows.
create or replace function public.sync_freshness()
returns bigint
language sql
stable
security invoker
set search_path = public
as $$
  select greatest(
    coalesce((select max(updated_at) from public.tasks    where user_id = auth.uid()), 0),
    coalesce((select max(earned_at)  from public.koi      where user_id = auth.uid()), 0),
    coalesce((select max(updated_at) from public.settings where user_id = auth.uid()), 0)
  );
$$;

grant execute on function public.sync_freshness() to authenticated;

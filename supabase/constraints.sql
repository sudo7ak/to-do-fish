-- Shape constraints, kept apart from schema.sql so they can be applied and dropped
-- without touching the tables.
--
-- schema.sql constrains `status` and `environment` but leaves `condition` free, which
-- makes an invalid task representable in the database while being unrepresentable in
-- the app's own types: `{"kind":"time"}` with no `at` inserts happily today. These
-- close that gap.
--
-- RUN THE AUDIT BELOW FIRST. A constraint added to a table that already violates it
-- fails outright, and a constraint stricter than what the client actually sends turns
-- every future sync into a rejected write.

-- ── Audit: every query must return zero rows before you apply anything ──────────

-- Conditions that would fail the shape check.
select id, condition from public.tasks
where condition is not null and not (
  jsonb_typeof(condition) = 'object' and (
    (condition->>'kind' = 'time'
     and condition->>'at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     and condition - 'kind' - 'at' = '{}'::jsonb)
    or (condition->>'kind' = 'task'
        and jsonb_typeof(condition->'taskId') = 'string'
        and (not condition ? 'before'
             or condition->>'before' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
        and condition - 'kind' - 'taskId' - 'before' = '{}'::jsonb)
    or (condition->>'kind' = 'text'
        and jsonb_typeof(condition->'text') = 'string'
        and condition - 'kind' - 'text' = '{}'::jsonb)
  )
);

-- Dates that are not a plain local calendar day.
select id, date from public.tasks
where date !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$';
select date from public.koi
where date !~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$';

-- Completed tasks with no completion time, and non-positive numbers.
select id from public.tasks where status = 'done' and completed_at is null;
select id from public.tasks where treat_cost is not null and treat_cost <= 0;
select id from public.tasks where created_at <= 0 or updated_at <= 0;
select date from public.koi where earned_at <= 0;

-- ── The constraints ────────────────────────────────────────────────────────────

alter table public.tasks drop constraint if exists tasks_condition_shape;
alter table public.tasks add constraint tasks_condition_shape check (
  condition is null
  or (
    jsonb_typeof(condition) = 'object'
    and (
      -- {kind:'time', at:'HH:MM'}
      (condition->>'kind' = 'time'
       and condition->>'at' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       -- Subtracting the known keys and requiring nothing remains is what makes this
       -- exhaustive rather than permissive: a time condition cannot also carry a
       -- taskId. A subquery over jsonb_object_keys would say the same thing and is
       -- not allowed inside a check constraint.
       and condition - 'kind' - 'at' = '{}'::jsonb)

      -- {kind:'task', taskId, before?:'HH:MM'}
      or (condition->>'kind' = 'task'
          and jsonb_typeof(condition->'taskId') = 'string'
          and (not condition ? 'before'
               or condition->>'before' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
          and condition - 'kind' - 'taskId' - 'before' = '{}'::jsonb)

      -- {kind:'text', text}
      or (condition->>'kind' = 'text'
          and jsonb_typeof(condition->'text') = 'string'
          and condition - 'kind' - 'text' = '{}'::jsonb)
    )
  )
);

-- A local calendar day, deliberately text rather than `date`: a date column is
-- coerced by drivers into an instant, and "the 10th" becomes the 9th at 18:30 for
-- anyone east of UTC. The regex catches malformed and out-of-range values. It does
-- not catch the 30th of February — that needs a cast whose result depends on
-- DateStyle, which has no business inside a constraint.
alter table public.tasks drop constraint if exists tasks_date_shape;
alter table public.tasks add constraint tasks_date_shape
  check (date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$');

alter table public.koi drop constraint if exists koi_date_shape;
alter table public.koi add constraint koi_date_shape
  check (date ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$');

-- One place in store/tasks.ts assigns `status: 'done'`, and it stamps `completedAt`
-- in the same object. The converse is deliberately NOT asserted: a future undo that
-- reopened a task while keeping its completion time would be legitimate.
alter table public.tasks drop constraint if exists tasks_done_has_completed_at;
alter table public.tasks add constraint tasks_done_has_completed_at
  check (status <> 'done' or completed_at is not null);

-- A treat costs pearls; zero or negative is not a price. Timestamps are epoch
-- milliseconds and the epoch itself predates the app.
alter table public.tasks drop constraint if exists tasks_positive_numbers;
alter table public.tasks add constraint tasks_positive_numbers
  check ((treat_cost is null or treat_cost > 0) and created_at > 0 and updated_at > 0);

alter table public.koi drop constraint if exists koi_positive_earned_at;
alter table public.koi add constraint koi_positive_earned_at check (earned_at > 0);

-- Deliberately absent: any constraint on `deleted_at`. Zero is a valid deletion
-- timestamp and the client tests for the field's presence, not its truthiness.

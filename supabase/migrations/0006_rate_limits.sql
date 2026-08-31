-- =============================================================================
-- 0006_rate_limits.sql
--
-- Rate limiting for operations that reach Google.
--
-- In-process counters were the obvious cheaper option and are the wrong one
-- here: they reset on every deploy, and two server instances would each grant a
-- full allowance. The limit exists to protect a shared, quota-metered resource
-- (our Google project), so it has to live somewhere shared.
--
-- Fixed-window counter rather than a sliding window or token bucket. A fixed
-- window can allow up to 2x the limit across a boundary, which is a real but
-- acceptable imprecision for "stop a student hammering sync" -- and it is one
-- row and one statement, where the alternatives are materially more machinery
-- for a bound that does not need to be exact.
-- =============================================================================

create table rate_limit_buckets (
  user_id      uuid not null references user_profiles (id) on delete cascade,
  -- Named operation, e.g. 'sync' or 'course_discovery'. Kept as text rather
  -- than an enum so adding a limit is application-side, not a migration.
  bucket       text not null,
  window_start timestamptz not null,
  count        integer not null default 0,

  primary key (user_id, bucket),
  constraint rate_limit_count_sane check (count >= 0)
);

alter table rate_limit_buckets enable row level security;

-- No client policies. This table is written only through the SECURITY DEFINER
-- function below, so a user cannot reset their own counter by deleting a row --
-- which they could trivially do if the usual "own rows" policies applied.
-- Reading it is not useful to a client either; the API returns the decision.

/**
 * Consumes one unit of allowance. Returns true when the caller may proceed.
 *
 * SECURITY DEFINER because the table denies everyone: the whole point is that
 * the counter is not under the caller's control. p_user_id is checked against
 * auth.uid() so a signed-in user can only ever spend their own allowance.
 *
 * The upsert is atomic, so two simultaneous requests cannot both read a stale
 * count and both decide they are under the limit.
 */
create or replace function app_consume_rate_limit(
  p_user_id uuid,
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_now timestamptz := now();
begin
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'cross-user access denied' using errcode = '42501';
  end if;

  insert into rate_limit_buckets (user_id, bucket, window_start, count)
  values (p_user_id, p_bucket, v_now, 1)
  on conflict (user_id, bucket) do update
    set
      -- Window expired: start a fresh one rather than accumulating forever.
      window_start = case
        when rate_limit_buckets.window_start < v_now - make_interval(secs => p_window_seconds)
          then v_now
        else rate_limit_buckets.window_start
      end,
      count = case
        when rate_limit_buckets.window_start < v_now - make_interval(secs => p_window_seconds)
          then 1
        else rate_limit_buckets.count + 1
      end
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke all on function app_consume_rate_limit(uuid, text, integer, integer) from public;
grant execute on function app_consume_rate_limit(uuid, text, integer, integer) to authenticated;

/**
 * Seconds until the current window resets. Used to populate Retry-After, so a
 * client is told when to come back rather than left to guess.
 */
create or replace function app_rate_limit_retry_after(
  p_user_id uuid,
  p_bucket text,
  p_window_seconds integer
)
returns integer
language sql
security definer
set search_path = public
stable
as $$
  select greatest(
    0,
    ceil(
      extract(epoch from (window_start + make_interval(secs => p_window_seconds) - now()))
    )::integer
  )
  from rate_limit_buckets
  where user_id = p_user_id and bucket = p_bucket;
$$;

revoke all on function app_rate_limit_retry_after(uuid, text, integer) from public;
grant execute on function app_rate_limit_retry_after(uuid, text, integer) to authenticated;

-- Old buckets are dead weight once their window has long passed. Called
-- opportunistically rather than on a schedule; the table stays tiny either way
-- since it holds at most one row per user per bucket.
create or replace function app_prune_rate_limits(p_older_than_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with removed as (
    delete from rate_limit_buckets
     where window_start < now() - make_interval(hours => p_older_than_hours)
    returning 1
  )
  select count(*) into v_deleted from removed;
  return v_deleted;
end;
$$;

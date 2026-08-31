-- =============================================================================
-- 0010_sync_retention.sql
--
-- Bounds the three tables that grew forever.
--
-- `sync_runs` gained a row on every sync, and `sync_course_results` and
-- `sync_errors` gained one per course and per failure beneath it. Nothing ever
-- removed them. A student syncing hourly writes roughly nine thousand runs a
-- year and several times that in course results, none of which anyone reads
-- after the day it happened.
--
-- That is a privacy problem as much as a storage one: an unbounded log of when
-- somebody used the product, retained for no stated period, is exactly what the
-- privacy policy has to describe and what a retention policy exists to stop.
--
-- WHAT IS DELIBERATELY NEVER DELETED
--
-- Freshness is computed from two queries: the most recent run of any status,
-- and the most recent SUCCESS or PARTIAL_SUCCESS. If retention removed either,
-- the app would tell a student their data had never synced, which is worse than
-- the disk cost. Both are preserved per user regardless of age.
--
-- A RUNNING row is never touched either. Deleting an in-flight run would free
-- the single-active-sync slot while the process still holds it, and the next
-- trigger would start a second concurrent sync.
--
-- The two dependent tables carry ON DELETE CASCADE from sync_runs, so removing
-- a run removes its course results and errors with it. Nothing needs to delete
-- them separately, and nothing can orphan them.
-- =============================================================================

/**
 * Deletes sync history older than the cutoff, preserving what freshness needs.
 *
 * SECURITY DEFINER, unlike almost everything else here. Retention is an
 * operator task that runs across every user, so it cannot be scoped to
 * `auth.uid()`. It is deliberately not granted to `authenticated`: only the
 * service role and the scheduler can execute it, so a student cannot trigger
 * a bulk delete over other people's rows.
 *
 * Returns the number of runs removed, so a scheduled invocation logs something
 * meaningful rather than succeeding silently.
 */
create or replace function app_prune_sync_history(p_keep_days integer default 90)
returns integer
language plpgsql
security definer
-- Pinned so a caller cannot shadow `sync_runs` with a table of their own on a
-- search path this function then trusts.
set search_path = public, pg_temp
as $$
declare
  v_cutoff timestamptz;
  v_deleted integer;
begin
  if p_keep_days is null or p_keep_days < 7 then
    -- A week is the floor. Anything shorter would start deleting history a
    -- student can still remember, and makes an accidental 0 destructive.
    raise exception 'retention window must be at least 7 days' using errcode = '22023';
  end if;

  v_cutoff := now() - make_interval(days => p_keep_days);

  with keep as (
    -- The most recent run per user, whatever its status. Freshness reads this
    -- as "last attempted".
    select distinct on (user_id) id
      from sync_runs
     order by user_id, started_at desc
  ),
  keep_successful as (
    -- The most recent run per user that actually completed. Freshness reads
    -- this as "showing data from", and losing it would report a synced account
    -- as never synced.
    select distinct on (user_id) id
      from sync_runs
     where status in ('SUCCESS', 'PARTIAL_SUCCESS')
       and finished_at is not null
     order by user_id, finished_at desc
  ),
  deleted as (
    delete from sync_runs r
     where r.started_at < v_cutoff
       and r.status <> 'RUNNING'
       and r.id not in (select id from keep)
       and r.id not in (select id from keep_successful)
    returning 1
  )
  select count(*)::integer into v_deleted from deleted;

  return v_deleted;
end;
$$;

revoke execute on function app_prune_sync_history(integer) from public;
revoke execute on function app_prune_sync_history(integer) from authenticated;

-- Retention scans by age, and without this the delete is a sequential scan over
-- the whole table every time it runs.
create index if not exists sync_runs_started_at_idx on sync_runs (started_at);

-- -----------------------------------------------------------------------------
-- Scheduling.
--
-- A retention function nothing calls is not a retention policy, and the privacy
-- policy now states a 90-day window in front of students. That claim is only
-- true once this schedule exists, which is why it ships in the same migration
-- rather than as a follow-up someone remembers later.
--
-- pg_cron is available on Supabase but is not enabled by default. If the
-- extension cannot be created the whole migration fails rather than silently
-- installing an unscheduled function, because a silent failure here means the
-- privacy policy is making a promise the database is not keeping.
-- -----------------------------------------------------------------------------

create extension if not exists pg_cron with schema extensions;

-- Idempotent: re-running the migration replaces the schedule instead of
-- stacking a second copy of the same job.
select cron.unschedule('lockin-prune-sync-history')
 where exists (select 1 from cron.job where jobname = 'lockin-prune-sync-history');

-- 03:20 UTC daily. Off the hour deliberately: everything scheduled on the hour
-- contends with everything else scheduled on the hour.
select cron.schedule(
  'lockin-prune-sync-history',
  '20 3 * * *',
  $$select app_prune_sync_history(90)$$
);

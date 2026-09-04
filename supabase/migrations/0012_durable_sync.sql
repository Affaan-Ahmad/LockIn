-- =============================================================================
-- 0012_durable_sync.sql
--
-- Makes synchronisation survive losing the process that started it.
--
-- The previous model ran an entire multi-course sync inside one HTTP request.
-- When the platform terminated that request -- which it will, because a sync is
-- minutes of paginated Google calls and a serverless invocation is bounded --
-- nothing was finalised: the row stayed RUNNING until its lease expired, every
-- course already imported was invisible to the next attempt, and the next
-- attempt started from nothing.
--
-- Three changes fix that, and none of them destroy existing history:
--
--   1. A WORK QUEUE. sync_course_results gains PENDING/RUNNING, so the set of
--      unfinished rows *is* the checkpoint. Progress is normalised rows, not a
--      blob, and a resumed run skips what is already SUCCESS.
--
--   2. A FENCED LEASE. sync_runs gains an owner token. Every mutation a worker
--      makes is conditional on still holding it, so a worker that was declared
--      dead cannot wake up and overwrite the state of the worker that replaced
--      it. A short TTL plus heartbeat renewal means a dead worker's run becomes
--      resumable in seconds rather than locking the account out for minutes.
--
--   3. DERIVED FINALISATION. The final status is computed by the database from
--      the work queue, not asserted by the application. It is therefore not
--      possible for a run with a failed course to be recorded as SUCCESS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Run-level durability
-- -----------------------------------------------------------------------------

alter table sync_runs
  -- Fencing token. Held by exactly one worker at a time; every state-changing
  -- function below requires it and silently does nothing without it.
  add column if not exists lease_owner uuid,
  -- Discovery is one Google call that enumerates courses. Recording when it
  -- finished stops every continuation from paying for it again.
  add column if not exists discovery_completed_at timestamptz,
  -- How many times this run has been picked up after losing its worker. Bounded
  -- so a run that dies repeatedly becomes ABANDONED instead of resuming forever.
  add column if not exists resume_attempts integer not null default 0;

-- The single-active-run index covers RUNNING only. A QUEUED run is also an
-- active run -- it holds unfinished work -- so it must be equally exclusive, or
-- a second trigger would create a parallel run for the same user.
drop index if exists sync_runs_single_active_idx;
create unique index sync_runs_single_active_idx
  on sync_runs (user_id)
  where status in ('QUEUED', 'RUNNING');

-- Finding resumable work: either unowned, or owned by a worker that stopped
-- heartbeating.
create index if not exists sync_runs_resumable_idx
  on sync_runs (lease_expires_at)
  where status in ('QUEUED', 'RUNNING');

-- The consistency constraint predates QUEUED, which like RUNNING has no
-- finished_at. Widened rather than dropped.
alter table sync_runs drop constraint if exists sync_runs_finished_consistency;
alter table sync_runs add constraint sync_runs_finished_consistency
  check (status in ('QUEUED', 'RUNNING') or finished_at is not null);

-- -----------------------------------------------------------------------------
-- Per-course work queue
-- -----------------------------------------------------------------------------

alter table sync_course_results
  add column if not exists attempts integer not null default 0,
  add column if not exists last_error_code text,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;

-- Existing rows were written only at completion, so their status is terminal
-- and the new columns are correctly null for them. Nothing to backfill.

-- completeness is not known until a course has actually been listed. It was
-- NOT NULL because rows only ever existed after the fact; a PENDING row has no
-- answer yet, and inventing 'FAILED' for one would make an unstarted course
-- look like a failed one.
alter table sync_course_results alter column completeness drop not null;

create index if not exists sync_course_results_pending_idx
  on sync_course_results (sync_run_id)
  where status in ('PENDING', 'RUNNING');

-- -----------------------------------------------------------------------------
-- Per-course freshness
--
-- A PARTIAL run must not make the whole dataset look current. Recording success
-- per course lets the UI say "these three courses are current, that one is two
-- days old" instead of averaging a lie across all of them.
-- -----------------------------------------------------------------------------

alter table courses
  add column if not exists last_successful_sync_at timestamptz;

-- -----------------------------------------------------------------------------
-- Claiming work
--
-- Two entry points with deliberately different answers to "a run already
-- exists". Starting is a user action and must say so; resuming is the worker
-- continuing something already promised, and must adopt it.
-- -----------------------------------------------------------------------------

/**
 * Reclaims runs whose worker stopped heartbeating.
 *
 * Back to QUEUED, not ABANDONED: the work queue still holds every course this
 * run completed, so the run is genuinely resumable and throwing it away would
 * discard real progress. Only a run that has already been resumed too many
 * times is given up on.
 */
create or replace function app_reclaim_expired_sync_runs(p_user_id uuid, p_max_resumes integer default 5)
returns void
language plpgsql
as $$
begin
  update sync_runs
     set status = case
           when resume_attempts >= p_max_resumes then 'ABANDONED'::sync_status
           else 'QUEUED'::sync_status
         end,
         finished_at = case
           when resume_attempts >= p_max_resumes then now()
           else null
         end,
         error_summary = case
           when resume_attempts >= p_max_resumes
             then coalesce(error_summary, 'Lease expired repeatedly without completion')
           else error_summary
         end,
         lease_owner = null
   where user_id = p_user_id
     and status = 'RUNNING'
     and lease_expires_at < now();

  -- A course left RUNNING by a dead worker goes back on the queue. Its work was
  -- idempotent, so re-running it is safe; leaving it RUNNING would strand it.
  update sync_course_results r
     set status = 'PENDING'::course_sync_status,
         started_at = null
    from sync_runs s
   where r.sync_run_id = s.id
     and s.user_id = p_user_id
     and s.status = 'QUEUED'
     and r.status = 'RUNNING';
end;
$$;

/**
 * Starts a new run, or refuses because one is already live.
 *
 * Returns the run with the caller recorded as lease owner. The advisory lock
 * covers reclaim-then-insert so two callers cannot both decide the old lease is
 * theirs; the partial unique index is the real guarantee underneath.
 */
create or replace function app_start_sync_run(
  p_user_id uuid,
  p_trigger sync_trigger,
  p_mode sync_mode,
  p_lease_ttl_seconds integer,
  p_owner uuid
)
returns sync_runs
language plpgsql
as $$
declare
  v_run sync_runs;
begin
  perform app_assert_self(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  perform app_reclaim_expired_sync_runs(p_user_id);

  if exists (
    select 1 from sync_runs
     where user_id = p_user_id and status in ('QUEUED', 'RUNNING')
  ) then
    raise exception 'a synchronisation is already running for this user'
      using errcode = '55006';
  end if;

  insert into sync_runs (user_id, trigger, mode, status, lease_expires_at, lease_owner)
  values (
    p_user_id, p_trigger, p_mode, 'RUNNING',
    now() + make_interval(secs => p_lease_ttl_seconds), p_owner
  )
  returning * into v_run;

  return v_run;
end;
$$;

/**
 * Adopts a resumable run, or returns nothing.
 *
 * This is what makes the architecture independent of any single request: the
 * work is in the database, and whichever invocation gets here next picks it up.
 */
create or replace function app_resume_sync_run(
  p_user_id uuid,
  p_lease_ttl_seconds integer,
  p_owner uuid
)
returns sync_runs
language plpgsql
as $$
declare
  v_run sync_runs;
begin
  perform app_assert_self(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  perform app_reclaim_expired_sync_runs(p_user_id);

  update sync_runs
     set status = 'RUNNING',
         lease_owner = p_owner,
         lease_expires_at = now() + make_interval(secs => p_lease_ttl_seconds),
         heartbeat_at = now(),
         resume_attempts = resume_attempts + 1
   where id = (
     select id from sync_runs
      where user_id = p_user_id and status = 'QUEUED'
      order by started_at asc
      limit 1
   )
  returning * into v_run;

  return v_run;
end;
$$;

/**
 * Renews a lease, but only for the worker that still owns it.
 *
 * The owner check is the entire point. Without it a worker that was declared
 * dead, then came back -- a paused container, a slow network call that finally
 * returned -- would extend a lease now held by somebody else and two workers
 * would sync the same account at once.
 */
create or replace function app_renew_sync_lease(
  p_sync_run_id uuid,
  p_owner uuid,
  p_lease_ttl_seconds integer
)
returns boolean
language plpgsql
as $$
declare
  v_updated integer;
begin
  update sync_runs
     set heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_ttl_seconds)
   where id = p_sync_run_id
     and lease_owner = p_owner
     and status = 'RUNNING';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

/**
 * Hands a run back for someone else to continue.
 *
 * Called when a worker reaches its internal deadline with work still queued.
 * The run returns to QUEUED with no owner, which is exactly the state
 * app_resume_sync_run looks for -- so a clean handover and a crash converge on
 * the same recovery path, and only one of them has to be tested carefully.
 */
create or replace function app_release_sync_lease(p_sync_run_id uuid, p_owner uuid)
returns boolean
language plpgsql
as $$
declare
  v_updated integer;
begin
  update sync_runs
     set status = 'QUEUED',
         lease_owner = null,
         lease_expires_at = now()
   where id = p_sync_run_id
     and lease_owner = p_owner
     and status = 'RUNNING';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- -----------------------------------------------------------------------------
-- Work queue operations
-- -----------------------------------------------------------------------------

/**
 * Puts the tracked courses on the queue, once.
 *
 * ON CONFLICT DO NOTHING against the existing (sync_run_id, source_course_id)
 * unique constraint makes this idempotent: a continuation that re-enqueues
 * cannot duplicate a work item or reset one that already succeeded.
 */
create or replace function app_enqueue_sync_courses(
  p_sync_run_id uuid,
  p_owner uuid,
  p_courses jsonb
)
returns integer
language plpgsql
as $$
declare
  v_user_id uuid;
  v_count integer;
begin
  select user_id into v_user_id
    from sync_runs
   where id = p_sync_run_id and lease_owner = p_owner and status = 'RUNNING';

  if v_user_id is null then
    return 0;
  end if;

  with incoming as (
    select distinct on (item.source_course_id)
           item.source_course_id, item.course_id, item.course_name
      from jsonb_to_recordset(p_courses) as item (
        source_course_id text,
        course_id uuid,
        course_name text
      )
     order by item.source_course_id
  ),
  inserted as (
    insert into sync_course_results (
      sync_run_id, user_id, course_id, source_course_id, course_name, status, completeness
    )
    select p_sync_run_id, v_user_id, i.course_id, i.source_course_id, i.course_name,
           'PENDING'::course_sync_status, null
      from incoming i
    on conflict (sync_run_id, source_course_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;

  update sync_runs set discovery_completed_at = now() where id = p_sync_run_id;

  return v_count;
end;
$$;

/**
 * Claims the next queued course for this worker.
 *
 * FOR UPDATE SKIP LOCKED so two workers -- which should not happen, but the
 * lease is a lease and not a proof -- cannot claim the same course.
 */
create or replace function app_claim_next_sync_course(p_sync_run_id uuid, p_owner uuid)
returns sync_course_results
language plpgsql
as $$
declare
  v_row sync_course_results;
begin
  if not exists (
    select 1 from sync_runs
     where id = p_sync_run_id and lease_owner = p_owner and status = 'RUNNING'
  ) then
    return null;
  end if;

  update sync_course_results
     set status = 'RUNNING'::course_sync_status,
         started_at = now(),
         attempts = attempts + 1
   where id = (
     select r.id from sync_course_results r
      where r.sync_run_id = p_sync_run_id
        and r.status = 'PENDING'
      order by r.created_at asc
      for update skip locked
      limit 1
   )
  returning * into v_row;

  return v_row;
end;
$$;

/**
 * Records the outcome of one course, and stamps per-course freshness.
 *
 * courses.last_successful_sync_at moves only on SUCCESS. That is what lets the
 * UI distinguish a course that is current from one that failed in the same run
 * -- rather than presenting a partial sync as if every course were fresh.
 */
create or replace function app_complete_sync_course(
  p_sync_run_id uuid,
  p_owner uuid,
  p_source_course_id text,
  p_status course_sync_status,
  p_completeness listing_completeness,
  p_counts jsonb,
  p_error_code text
)
returns boolean
language plpgsql
as $$
declare
  v_user_id uuid;
  v_course_id uuid;
begin
  select user_id into v_user_id
    from sync_runs
   where id = p_sync_run_id and lease_owner = p_owner and status = 'RUNNING';

  if v_user_id is null then
    return false;
  end if;

  update sync_course_results
     set status = p_status,
         completeness = p_completeness,
         counts = coalesce(p_counts, '{}'::jsonb),
         last_error_code = p_error_code,
         finished_at = now()
   where sync_run_id = p_sync_run_id
     and source_course_id = p_source_course_id
  returning course_id into v_course_id;

  if p_status = 'SUCCESS' and v_course_id is not null then
    update courses
       set last_successful_sync_at = now()
     where id = v_course_id and user_id = v_user_id;
  end if;

  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Finalisation
-- -----------------------------------------------------------------------------

/**
 * Closes a run, deriving its status from the work actually done.
 *
 * The status is computed here rather than passed in, so there is no code path
 * -- present or future -- by which an application bug reports SUCCESS for a run
 * that had a failed course. The frontend's most dangerous possible mistake is
 * calling incomplete data current; this makes the database the thing that
 * decides.
 *
 * Refuses while work is still queued, so a worker cannot finalise a run it has
 * merely stopped working on. That case must go through app_release_sync_lease.
 */
create or replace function app_finalize_sync_run(
  p_sync_run_id uuid,
  p_owner uuid,
  p_error_summary text default null
)
returns sync_status
language plpgsql
as $$
declare
  v_total integer;
  v_failed integer;
  v_pending integer;
  v_status sync_status;
  v_discovered timestamptz;
  v_counts jsonb;
begin
  if not exists (
    select 1 from sync_runs
     where id = p_sync_run_id and lease_owner = p_owner and status = 'RUNNING'
  ) then
    return null;
  end if;

  select count(*) filter (where true),
         count(*) filter (where status = 'FAILED'),
         count(*) filter (where status in ('PENDING', 'RUNNING'))
    into v_total, v_failed, v_pending
    from sync_course_results
   where sync_run_id = p_sync_run_id;

  if v_pending > 0 then
    return null;
  end if;

  select discovery_completed_at into v_discovered from sync_runs where id = p_sync_run_id;

  v_status := case
    -- Discovery never completed, so we do not know what we were meant to sync.
    -- Zero work items here means "we learned nothing", not "there was nothing".
    when v_discovered is null then 'FAILED'::sync_status
    when v_total = 0 then 'SUCCESS'::sync_status
    when v_failed = 0 then 'SUCCESS'::sync_status
    when v_failed = v_total then 'FAILED'::sync_status
    else 'PARTIAL_SUCCESS'::sync_status
  end;

  -- Totals are summed from the work items, not supplied by the caller.
  --
  -- A run can span several invocations, and no single worker sees more than the
  -- courses it personally handled. Adding up whatever the last worker happened
  -- to do would under-report every resumed run. The rows already hold the truth.
  select jsonb_object_agg(k, total)
    into v_counts
    from (
      select e.key as k, sum(e.value::numeric) as total
        from sync_course_results r
        cross join lateral jsonb_each_text(coalesce(r.counts, '{}'::jsonb)) as e(key, value)
       where r.sync_run_id = p_sync_run_id
       group by e.key
    ) totals;

  update sync_runs
     set status = v_status,
         counts = coalesce(v_counts, '{}'::jsonb),
         error_summary = p_error_summary,
         finished_at = now(),
         lease_owner = null
   where id = p_sync_run_id;

  return v_status;
end;
$$;

/**
 * Fails a run outright, for faults that no amount of resuming can fix.
 *
 * A revoked Google grant or an unreadable credential is not a course-level
 * failure and must not be retried course by course.
 */
create or replace function app_fail_sync_run(
  p_sync_run_id uuid,
  p_owner uuid,
  p_error_summary text
)
returns boolean
language plpgsql
as $$
declare
  v_updated integer;
begin
  update sync_runs
     set status = 'FAILED',
         finished_at = now(),
         error_summary = p_error_summary,
         lease_owner = null
   where id = p_sync_run_id
     and lease_owner = p_owner
     and status = 'RUNNING';

  get diagnostics v_updated = row_count;

  update sync_course_results
     set status = 'FAILED'::course_sync_status,
         finished_at = now()
   where sync_run_id = p_sync_run_id
     and status in ('PENDING', 'RUNNING');

  return v_updated > 0;
end;
$$;

-- The old three-argument signature is replaced by the owner-fenced version
-- above. Dropped explicitly so a stale deployment calling it fails loudly
-- rather than silently finalising without holding the lease.
drop function if exists app_finalize_sync_run(uuid, sync_status, jsonb, text);

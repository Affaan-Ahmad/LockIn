-- =============================================================================
-- 0013_fail_run_fencing.sql
--
-- Closes a hole in app_fail_sync_run: the fence guarded the run row and nothing
-- else.
--
-- 0012 made every state-changing function conditional on holding the lease, and
-- app_fail_sync_run did check the owner on its UPDATE of sync_runs. It even read
-- the row count in the right place -- immediately after that UPDATE, before
-- touching anything else. What it never did was *act* on the count: it fell
-- straight through to marking every PENDING and RUNNING work item FAILED,
-- unconditionally, for any caller that knew a run id, and only then returned
-- `v_updated > 0`. The check existed and was used solely as a return value.
--
-- So the one caller the fence exists for -- a worker that stalled, was declared
-- dead, and came back -- did exactly the damage the fence was meant to prevent.
-- It returned false, correctly, and reported that it had not failed the run;
-- meanwhile the successor now holding the lease found its queue emptied, every
-- course it had not yet reached marked FAILED, and finalised a run that had
-- never actually attempted them. A revoked-grant fault in one invocation could
-- therefore turn a healthy resumed sync into a FAILED one, and the student was
-- told their coursework could not be read when nothing had tried to read it.
--
-- The fix is one `if`: the count that was already being read now short-circuits
-- before the work queue is touched. Nothing else changes -- same signature, same
-- behaviour for the rightful owner, same preservation of courses that already
-- reached a terminal state.
--
-- Because the signature is unchanged, code written against 0013 does not fail
-- against a database still on 0012. It runs, and the race stays open. There is
-- no error to notice, which is the reason to apply this deliberately rather than
-- to rely on a deployment breaking loudly.
-- =============================================================================

/**
 * Fails a run outright, for faults that no amount of resuming can fix.
 *
 * A revoked Google grant or an unreadable credential is not a course-level
 * failure and must not be retried course by course.
 *
 * Returns false and changes nothing at all when the caller does not hold the
 * lease -- including when the run has already been reclaimed to QUEUED, which
 * is the same statement: a run nobody owns is not this worker's to fail.
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

  -- The fence. 0012 read this same count in this same place and then ignored it
  -- until the return statement; a check whose result arrives after the damage is
  -- a report, not a fence.
  if v_updated = 0 then
    return false;
  end if;

  -- Only unfinished work. A course that already reached SUCCESS, FAILED or
  -- SKIPPED keeps its outcome: it was really attempted, and rewriting it would
  -- lose the one record of what this run actually managed to import.
  update sync_course_results
     set status = 'FAILED'::course_sync_status,
         finished_at = now()
   where sync_run_id = p_sync_run_id
     and status in ('PENDING', 'RUNNING');

  return true;
end;
$$;

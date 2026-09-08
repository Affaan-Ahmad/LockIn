-- =============================================================================
-- 0014_override_ownership.sql
--
-- Closes an assignment-existence oracle on the manual-override write, and makes
-- it behave like its sibling.
--
-- `classification_overrides` writes went straight to PostgREST as an upsert.
-- Row-level security governed the row being written -- WITH CHECK forced
-- user_id = auth.uid(), so nobody could ever write an override *for* somebody
-- else -- but the assignment_id was only ever validated by the foreign key. And
-- a foreign key is verified by the system, as the table owner, outside the
-- caller's policies.
--
-- So the two failure modes diverged. An assignment_id belonging to another user
-- satisfied the constraint and the upsert succeeded, storing an inert row in the
-- caller's own partition; an id belonging to nobody raised 23503 and failed.
-- Same request, two answers, and the difference was "does this identifier exist
-- somewhere in the system".
--
-- The practical severity was low and is worth stating honestly: assignment ids
-- are gen_random_uuid(), so there is nothing to enumerate, and a confirmed hit
-- named no owner, no course and no title. It was still a distinction the caller
-- had no business being able to draw.
--
-- The fix is not new. `app_set_assignment_ignored` in 0007 already had exactly
-- the right shape for exactly this problem -- assert the caller is who they say,
-- then require the assignment to be *theirs*, and raise P0002 when it is not, so
-- "not yours" and "not real" are one answer. This gives the override write the
-- same treatment, in one statement, so there is no window between the check and
-- the write.
--
-- The route is unchanged for a legitimate caller: their own assignment still
-- upserts and still returns the stored row.
-- =============================================================================

/**
 * Records the student's own decision about one of their own assignments.
 *
 * Raises P0002 when the assignment is not the caller's -- whether because it
 * belongs to someone else or because it does not exist. Those are deliberately
 * the same answer; telling them apart is the oracle this function removes.
 */
create or replace function app_set_override(
  p_user_id uuid,
  p_assignment_id uuid,
  p_relevance relevance,
  p_note text default null
)
returns classification_overrides
language plpgsql
as $$
declare
  v_row classification_overrides;
begin
  perform app_assert_self(p_user_id);

  -- Ownership, not mere existence. The foreign key would accept any assignment
  -- in the table; this accepts only one the caller can already see.
  if not exists (
    select 1 from assignments a where a.id = p_assignment_id and a.user_id = p_user_id
  ) then
    raise exception 'assignment not found' using errcode = 'P0002';
  end if;

  -- updated_at is left to the classification_overrides_touch trigger rather than
  -- set here, so there is one definition of when a row was last written.
  insert into classification_overrides (user_id, assignment_id, relevance, note)
  values (p_user_id, p_assignment_id, p_relevance, p_note)
  on conflict (user_id, assignment_id)
    do update set relevance = excluded.relevance,
                  note      = excluded.note
  returning * into v_row;

  return v_row;
end;
$$;

-- SECURITY INVOKER, like every other app_* function except the three that must
-- reach a deny-all table. RLS still applies inside it, so the ownership check
-- above is the second lock rather than the only one.
grant execute on function app_set_override(uuid, uuid, relevance, text) to authenticated;

-- =============================================================================
-- 0009_drop_grades.sql
--
-- Stops storing grades.
--
-- `assigned_grade` and `draft_grade` were ingested from Classroom submissions
-- and written on every sync, and nothing in the product has ever read them.
-- They were collected because the Google payload offered them, which is not a
-- purpose.
--
-- Grades are the most sensitive thing this database held. Keeping them meant a
-- privacy policy that had to disclose grade storage, a heavier Google OAuth
-- review, and a breach that would have exposed academic results rather than a
-- list of deadlines. Deleting data is a stronger privacy control than
-- disclosing it, and no feature loses anything.
--
-- The submission scope is deliberately unchanged. LockIn still needs
-- `student-submissions.me.readonly` to know whether work is turned in, which is
-- what hides completed coursework from the feed. Google still sends the grade
-- fields in that payload; they are now discarded on arrival instead of stored.
--
-- Irreversible for existing rows. That is the intent: this is a deletion, not a
-- migration to somewhere else.
-- =============================================================================

alter table submissions
  drop column if exists assigned_grade,
  drop column if exists draft_grade;

-- The upsert has to be replaced in the same transaction as the columns, or the
-- next sync runs against a function referencing columns that no longer exist.
create or replace function app_upsert_submissions(
  p_user_id uuid,
  p_course_id uuid,
  p_items jsonb,
  p_synced_at timestamptz
)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform app_assert_self(p_user_id);

  with incoming as (
    select distinct on (item.source_item_id) *
      from jsonb_to_recordset(p_items) as item (
        source_submission_id text,
        source_item_id text,
        state submission_state,
        late boolean,
        alternate_link text,
        source_created_at timestamptz,
        source_updated_at timestamptz
      )
      order by item.source_item_id
  ),
  resolved as (
    select i.*, a.id as assignment_id
      from incoming i
      join assignments a
        on a.user_id = p_user_id
       and a.source = 'GOOGLE_CLASSROOM'
       and a.source_item_id = i.source_item_id
  ),
  upserted as (
    insert into submissions (
      user_id, course_id, assignment_id, source, source_submission_id,
      state, late, alternate_link,
      source_created_at, source_updated_at, last_synced_at
    )
    select
      p_user_id, p_course_id, r.assignment_id, 'GOOGLE_CLASSROOM'::academic_source,
      r.source_submission_id, r.state, r.late, r.alternate_link,
      r.source_created_at, r.source_updated_at, p_synced_at
    from resolved r
    on conflict (assignment_id) do update
      set source_submission_id = excluded.source_submission_id,
          state                = excluded.state,
          late                 = excluded.late,
          alternate_link       = excluded.alternate_link,
          source_created_at    = excluded.source_created_at,
          source_updated_at    = excluded.source_updated_at,
          last_synced_at       = excluded.last_synced_at
    returning 1
  )
  select count(*)::integer into v_count from upserted;

  return v_count;
end;
$$;

grant execute on function app_upsert_submissions(uuid, uuid, jsonb, timestamptz) to authenticated;

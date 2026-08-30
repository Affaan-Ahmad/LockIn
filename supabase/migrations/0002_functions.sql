-- =============================================================================
-- 0002_functions.sql
--
-- Transactional batch operations.
--
-- These exist for three reasons that a plain PostgREST call cannot satisfy:
--
--   1. TRANSACTIONS. Several writes that form one consistency boundary must
--      succeed or fail together. PostgREST gives one statement per request, so
--      a multi-statement boundary has to live in the database.
--
--   2. NO N+1. Upserting five hundred coursework items is one call with one
--      jsonb payload, not five hundred round trips, and the caller is told per
--      item whether it was created, changed, or identical.
--
--   3. NO LONG-HELD TRANSACTIONS. Each function is short and holds no network
--      call. Google is contacted before these run, never during.
--
-- All functions are SECURITY INVOKER (the default): row-level security still
-- applies inside them, so a caller holding a user's JWT can only ever touch
-- that user's rows. The explicit guard below turns a silent no-op into a loud
-- error, which is easier to debug and harder to misread.
-- =============================================================================

create or replace function app_assert_self(p_user_id uuid)
returns void
language plpgsql
stable
as $$
begin
  -- auth.uid() is null for the service role, which is used only by the token
  -- service and the OAuth callback. Everything else runs as the signed-in user.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'cross-user access denied' using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Sync lease
--
-- Two simultaneous syncs for one user must not both proceed. The partial unique
-- index on sync_runs is the real guarantee; this function adds crash recovery
-- and turns the raw unique violation into a meaningful error.
--
-- The advisory lock covers the read-expire-insert sequence so two callers
-- cannot both observe a stale lease, both expire it, and both insert.
-- -----------------------------------------------------------------------------
create or replace function app_acquire_sync_run(
  p_user_id uuid,
  p_trigger sync_trigger,
  p_mode sync_mode,
  p_lease_ttl_seconds integer
)
returns sync_runs
language plpgsql
as $$
declare
  v_run sync_runs;
begin
  perform app_assert_self(p_user_id);

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  -- Reclaim leases whose owner died without finalising. Marked ABANDONED rather
  -- than deleted so the record of the failed attempt survives for debugging.
  update sync_runs
     set status = 'ABANDONED',
         finished_at = now(),
         error_summary = coalesce(error_summary, 'Lease expired without completion')
   where user_id = p_user_id
     and status = 'RUNNING'
     and lease_expires_at < now();

  if exists (select 1 from sync_runs where user_id = p_user_id and status = 'RUNNING') then
    raise exception 'a synchronisation is already running for this user'
      using errcode = '55006';
  end if;

  insert into sync_runs (user_id, trigger, mode, status, lease_expires_at)
  values (
    p_user_id,
    p_trigger,
    p_mode,
    'RUNNING',
    now() + make_interval(secs => p_lease_ttl_seconds)
  )
  returning * into v_run;

  return v_run;
end;
$$;

create or replace function app_heartbeat_sync_run(
  p_sync_run_id uuid,
  p_lease_ttl_seconds integer
)
returns void
language plpgsql
as $$
begin
  update sync_runs
     set heartbeat_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_ttl_seconds)
   where id = p_sync_run_id
     and status = 'RUNNING';
end;
$$;

create or replace function app_finalize_sync_run(
  p_sync_run_id uuid,
  p_status sync_status,
  p_counts jsonb,
  p_error_summary text
)
returns void
language plpgsql
as $$
begin
  if p_status = 'RUNNING' then
    raise exception 'cannot finalise a run to RUNNING' using errcode = '22023';
  end if;

  update sync_runs
     set status = p_status,
         counts = coalesce(p_counts, '{}'::jsonb),
         error_summary = p_error_summary,
         finished_at = now()
   where id = p_sync_run_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Assignment batch upsert
--
-- Conflict target is the (user_id, source, source_item_id) unique constraint, so
-- a repeated or concurrent sync updates rather than duplicating. Idempotency is
-- a property of the schema here, not of the calling code.
--
-- `changed` is derived from source_fingerprint. An item Google did not modify
-- performs no column update at all beyond last_synced_at, which keeps a routine
-- sync of a large course cheap and keeps updated_at meaningful.
-- -----------------------------------------------------------------------------
create or replace function app_upsert_assignments(
  p_user_id uuid,
  p_course_id uuid,
  p_items jsonb,
  p_synced_at timestamptz
)
returns table (
  assignment_id uuid,
  source_item_id text,
  created boolean,
  changed boolean
)
language plpgsql
as $$
begin
  perform app_assert_self(p_user_id);

  return query
  with incoming as (
    -- DISTINCT ON: a duplicated source_item_id in one payload would make
    -- ON CONFLICT DO UPDATE raise "cannot affect row a second time" and abort
    -- the entire course. Last one wins, matching upsert semantics.
    select distinct on (item.source_item_id)
      item.source_item_id,
      item.title,
      item.description,
      item.work_type,
      item.source_state,
      item.max_points,
      item.alternate_link,
      item.source_topic_id,
      item.assignee_mode,
      item.individual_student_ids,
      item.due_date_raw,
      item.due_time_raw,
      item.due_at,
      item.due_precision,
      item.source_created_at,
      item.source_updated_at,
      item.source_fingerprint
    from jsonb_to_recordset(p_items) as item (
      source_item_id text,
      title text,
      description text,
      work_type work_type,
      source_state source_state,
      max_points numeric,
      alternate_link text,
      source_topic_id text,
      assignee_mode assignee_mode,
      individual_student_ids text[],
      due_date_raw date,
      due_time_raw time,
      due_at timestamptz,
      due_precision due_precision,
      source_created_at timestamptz,
      source_updated_at timestamptz,
      source_fingerprint text
    )
    order by item.source_item_id
  ),
  resolved as (
    select
      i.*,
      t.id as topic_id
    from incoming i
    left join topics t
      on t.course_id = p_course_id
     and t.source_topic_id = i.source_topic_id
  ),
  existing as (
    select a.source_item_id, a.source_fingerprint
      from assignments a
     where a.user_id = p_user_id
       and a.source = 'GOOGLE_CLASSROOM'
       and a.source_item_id in (select r.source_item_id from resolved r)
  ),
  upserted as (
    insert into assignments (
      user_id, course_id, source, source_item_id,
      title, description, work_type, source_state, max_points, alternate_link,
      topic_id, source_topic_id, assignee_mode, individual_student_ids,
      due_date_raw, due_time_raw, due_at, due_precision,
      source_created_at, source_updated_at,
      lifecycle_status, missing_streak, first_missing_at,
      source_fingerprint, last_synced_at
    )
    select
      p_user_id, p_course_id, 'GOOGLE_CLASSROOM', r.source_item_id,
      r.title, r.description, r.work_type, r.source_state, r.max_points, r.alternate_link,
      r.topic_id, r.source_topic_id, r.assignee_mode, r.individual_student_ids,
      r.due_date_raw, r.due_time_raw, r.due_at, r.due_precision,
      r.source_created_at, r.source_updated_at,
      'ACTIVE', 0, null,
      r.source_fingerprint, p_synced_at
    from resolved r
    on conflict (user_id, source, source_item_id) do update
      set course_id              = excluded.course_id,
          title                  = excluded.title,
          description            = excluded.description,
          work_type              = excluded.work_type,
          source_state           = excluded.source_state,
          max_points             = excluded.max_points,
          alternate_link         = excluded.alternate_link,
          topic_id               = excluded.topic_id,
          source_topic_id        = excluded.source_topic_id,
          assignee_mode          = excluded.assignee_mode,
          individual_student_ids = excluded.individual_student_ids,
          due_date_raw           = excluded.due_date_raw,
          due_time_raw           = excluded.due_time_raw,
          due_at                 = excluded.due_at,
          due_precision          = excluded.due_precision,
          source_created_at      = excluded.source_created_at,
          source_updated_at      = excluded.source_updated_at,
          source_fingerprint     = excluded.source_fingerprint,
          last_synced_at         = excluded.last_synced_at,
          -- The item is present again, so any missing streak is cleared. An
          -- ARCHIVED item stays archived: that is a deliberate user/system
          -- decision, not a consequence of Google's listing.
          lifecycle_status = case
            when assignments.lifecycle_status = 'ARCHIVED' then 'ARCHIVED'
            else 'ACTIVE'
          end,
          missing_streak   = 0,
          first_missing_at = null
    returning assignments.id, assignments.source_item_id
  )
  select
    u.id,
    u.source_item_id,
    e.source_item_id is null as created,
    e.source_item_id is null
      or e.source_fingerprint is distinct from r.source_fingerprint as changed
  from upserted u
  join resolved r on r.source_item_id = u.source_item_id
  left join existing e on e.source_item_id = u.source_item_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Disappearance reconciliation
--
-- Never deletes. An item absent from a listing accrues a missing streak, and
-- only reaches SOURCE_REMOVED after MISSING_STREAK_THRESHOLD consecutive
-- complete listings. A caller that passes a non-complete listing must not call
-- this at all; the application enforces that, and this function's contract
-- documents it.
-- -----------------------------------------------------------------------------
create or replace function app_reconcile_missing_assignments(
  p_user_id uuid,
  p_course_id uuid,
  p_seen_item_ids text[],
  p_at timestamptz,
  p_threshold integer default 2
)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform app_assert_self(p_user_id);

  with updated as (
    update assignments a
       set missing_streak   = a.missing_streak + 1,
           first_missing_at = coalesce(a.first_missing_at, p_at),
           lifecycle_status = case
             when a.lifecycle_status = 'ARCHIVED' then 'ARCHIVED'
             when a.missing_streak + 1 >= p_threshold then 'SOURCE_REMOVED'
             else 'SOURCE_MISSING'
           end,
           last_synced_at   = p_at
     where a.user_id = p_user_id
       and a.course_id = p_course_id
       and a.lifecycle_status <> 'SOURCE_REMOVED'
       and not (a.source_item_id = any (p_seen_item_ids))
    returning 1
  )
  select count(*) into v_count from updated;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Submission batch upsert
-- -----------------------------------------------------------------------------
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
    -- One submission per coursework item per student; a duplicate would collide
    -- on the assignment_id conflict target below.
    select distinct on (item.source_item_id) *
      from jsonb_to_recordset(p_items) as item (
        source_submission_id text,
        source_item_id text,
        state submission_state,
        late boolean,
        assigned_grade numeric,
        draft_grade numeric,
        alternate_link text,
        source_created_at timestamptz,
        source_updated_at timestamptz
      )
      order by item.source_item_id
  ),
  resolved as (
    -- A submission for coursework we did not ingest is dropped rather than
    -- orphaned: without the assignment row it has nothing to describe.
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
      state, late, assigned_grade, draft_grade, alternate_link,
      source_created_at, source_updated_at, last_synced_at
    )
    select
      p_user_id, p_course_id, r.assignment_id, 'GOOGLE_CLASSROOM', r.source_submission_id,
      r.state, r.late, r.assigned_grade, r.draft_grade, r.alternate_link,
      r.source_created_at, r.source_updated_at, p_synced_at
    from resolved r
    on conflict (assignment_id) do update
      set source_submission_id = excluded.source_submission_id,
          state                = excluded.state,
          late                 = excluded.late,
          assigned_grade       = excluded.assigned_grade,
          draft_grade          = excluded.draft_grade,
          alternate_link       = excluded.alternate_link,
          source_created_at    = excluded.source_created_at,
          source_updated_at    = excluded.source_updated_at,
          last_synced_at       = excluded.last_synced_at
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Classification batch upsert
--
-- Writes only to assignment_classifications. There is deliberately no statement
-- in this function that touches classification_overrides: the student's own
-- decisions are not this function's business, and keeping it that way is what
-- makes "sync cannot erase my override" a structural property.
-- -----------------------------------------------------------------------------
create or replace function app_upsert_classifications(
  p_user_id uuid,
  p_rows jsonb
)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform app_assert_self(p_user_id);

  with incoming as (
    select distinct on (row_in.assignment_id) *
      from jsonb_to_recordset(p_rows) as row_in (
        assignment_id uuid,
        relevance relevance,
        confidence numeric,
        decided_by_rule text,
        reason text,
        evidence jsonb,
        conflicted boolean,
        ruleset_version text,
        input_fingerprint text
      )
      order by row_in.assignment_id
  ),
  -- Only classify assignments that belong to this user. Without this join a
  -- crafted payload could attach a verdict to somebody else's row; RLS would
  -- reject the write, but failing early with a clear join is better than
  -- depending on a policy to catch a bug.
  owned as (
    select i.*
      from incoming i
      join assignments a on a.id = i.assignment_id and a.user_id = p_user_id
  ),
  upserted as (
    insert into assignment_classifications (
      assignment_id, user_id, relevance, confidence, decided_by_rule,
      reason, evidence, conflicted, ruleset_version, input_fingerprint, classified_at
    )
    select
      o.assignment_id, p_user_id, o.relevance, o.confidence, o.decided_by_rule,
      o.reason, coalesce(o.evidence, '[]'::jsonb), coalesce(o.conflicted, false),
      o.ruleset_version, o.input_fingerprint, now()
    from owned o
    on conflict (assignment_id) do update
      set relevance         = excluded.relevance,
          confidence        = excluded.confidence,
          decided_by_rule   = excluded.decided_by_rule,
          reason            = excluded.reason,
          evidence          = excluded.evidence,
          conflicted        = excluded.conflicted,
          ruleset_version   = excluded.ruleset_version,
          input_fingerprint = excluded.input_fingerprint,
          classified_at     = excluded.classified_at
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Course batch upsert
--
-- coursework_watermark is deliberately absent from the update list: it is local
-- sync bookkeeping, and a course refresh must not reset the incremental cursor.
-- -----------------------------------------------------------------------------
create or replace function app_upsert_courses(
  p_user_id uuid,
  p_items jsonb,
  p_synced_at timestamptz
)
returns setof courses
language plpgsql
as $$
begin
  perform app_assert_self(p_user_id);

  return query
  with incoming as (
    select distinct on (item.source_course_id) *
      from jsonb_to_recordset(p_items) as item (
        source_course_id text,
        name text,
        section text,
        description_heading text,
        room text,
        course_state text,
        alternate_link text,
        source_created_at timestamptz,
        source_updated_at timestamptz
      )
      order by item.source_course_id
  )
  insert into courses (
    user_id, source, source_course_id, name, section, description_heading,
    room, course_state, alternate_link, source_created_at, source_updated_at,
    last_synced_at, lifecycle_status
  )
  select
    p_user_id, 'GOOGLE_CLASSROOM', i.source_course_id, i.name, i.section,
    i.description_heading, i.room, i.course_state, i.alternate_link,
    i.source_created_at, i.source_updated_at, p_synced_at, 'ACTIVE'
  from incoming i
  on conflict (user_id, source, source_course_id) do update
    set name                = excluded.name,
        section             = excluded.section,
        description_heading = excluded.description_heading,
        room                = excluded.room,
        course_state        = excluded.course_state,
        alternate_link      = excluded.alternate_link,
        source_created_at   = excluded.source_created_at,
        source_updated_at   = excluded.source_updated_at,
        last_synced_at      = excluded.last_synced_at,
        lifecycle_status    = case
          when courses.lifecycle_status = 'ARCHIVED' then 'ARCHIVED'
          else 'ACTIVE'
        end
  returning *;
end;
$$;

create or replace function app_upsert_topics(
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
    select distinct on (item.source_topic_id) *
      from jsonb_to_recordset(p_items) as item (
        source_topic_id text,
        name text,
        source_updated_at timestamptz
      )
      order by item.source_topic_id
  ),
  upserted as (
    insert into topics (
      user_id, course_id, source, source_topic_id, name, source_updated_at, last_synced_at
    )
    select p_user_id, p_course_id, 'GOOGLE_CLASSROOM', i.source_topic_id, i.name,
           i.source_updated_at, p_synced_at
    from incoming i
    on conflict (course_id, source_topic_id) do update
      set name              = excluded.name,
          source_updated_at = excluded.source_updated_at,
          last_synced_at    = excluded.last_synced_at
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Read model: upcoming work
--
-- One query, three tables, no N+1. The override is resolved here rather than in
-- application code so that every consumer -- API route, future notification
-- job, debug endpoint -- sees the same precedence. `effective_relevance`
-- prefers the student's decision over the classifier, always.
-- -----------------------------------------------------------------------------
create or replace function app_upcoming_assignments(
  p_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_relevance relevance[],
  p_include_submitted boolean,
  p_limit integer
)
returns table (
  assignment_id uuid,
  course_id uuid,
  course_name text,
  title text,
  due_date_raw date,
  due_time_raw time,
  due_at timestamptz,
  due_precision due_precision,
  due_sort_at timestamptz,
  effective_relevance relevance,
  confidence numeric,
  has_manual_override boolean,
  submission_state submission_state,
  last_synced_at timestamptz,
  alternate_link text
)
language sql
stable
as $$
  select
    a.id,
    a.course_id,
    c.name,
    a.title,
    a.due_date_raw,
    a.due_time_raw,
    a.due_at,
    a.due_precision,
    a.due_sort_at,
    coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance),
    case when o.relevance is not null then 1.0 else coalesce(cl.confidence, 0) end,
    o.relevance is not null,
    s.state,
    a.last_synced_at,
    a.alternate_link
  from assignments a
  join courses c on c.id = a.course_id
  left join assignment_classifications cl on cl.assignment_id = a.id
  left join classification_overrides o on o.assignment_id = a.id and o.user_id = a.user_id
  left join submissions s on s.assignment_id = a.id
  where a.user_id = p_user_id
    and a.lifecycle_status in ('ACTIVE', 'SOURCE_MISSING')
    and a.source_state = 'PUBLISHED'
    -- Work with no due date at all is not "upcoming"; it is listed separately.
    and a.due_sort_at is not null
    and a.due_sort_at >= p_from
    and (p_to is null or a.due_sort_at <= p_to)
    and coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance) = any (p_relevance)
    and (p_include_submitted or s.state is null or s.state not in ('TURNED_IN', 'RETURNED'))
  order by a.due_sort_at asc, a.title asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

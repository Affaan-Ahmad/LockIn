-- =============================================================================
-- 0004_course_tracking_and_scope.sql
--
-- Two additions, both of which move a decision out of inference and into data.
--
--   COURSE TRACKING. A Google Classroom account accumulates courses; last
--   semester's are still ACTIVE and still enrolled. Which subjects belong in a
--   student's deadline feed is their decision, not something derivable from
--   Google's course state. Modelled like classification_overrides: a user
--   decision, in its own table, with no write path from the sync pipeline.
--
--   SECTION SCOPE. Previously a classification stored only the conclusion
--   ("relevant to you"). It now also stores what the coursework targeted
--   ("Sections F and G") as a separate, student-independent fact -- so the two
--   questions stay auditable apart, and a wrong verdict can be traced to
--   whichever half was wrong.
-- =============================================================================

create type section_scope_type as enum (
  'ALL_SECTIONS',
  'ALL_SECTIONS_EXCEPT',
  'SPECIFIC_SECTIONS',
  'UNCERTAIN'
);

-- -----------------------------------------------------------------------------
-- Course tracking
--
-- A separate table rather than a column on `courses`, for the same reason
-- overrides are separate from classifications: `courses` is rewritten wholesale
-- by every discovery pass, and a student's choice must not live anywhere a sync
-- can overwrite it. The absence of a row means "not chosen yet", which is
-- distinct from a row saying is_tracked = false ("chosen, declined").
-- -----------------------------------------------------------------------------
create table course_tracking (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references user_profiles (id) on delete cascade,
  course_id   uuid not null references courses (id) on delete cascade,
  is_tracked  boolean not null,
  -- When the student first decided about this course; preserved across changes.
  selected_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint course_tracking_unique unique (user_id, course_id)
);

create trigger course_tracking_touch
  before update on course_tracking
  for each row execute function app_touch_updated_at();

-- The hot filter. Partial, because every query that reads this table is asking
-- for the tracked ones -- typically three to six rows out of however many
-- courses the account has accumulated.
create index course_tracking_active_idx
  on course_tracking (user_id, course_id)
  where is_tracked;

alter table course_tracking enable row level security;

create policy course_tracking_select_own on course_tracking
  for select to authenticated using (user_id = (select auth.uid()));
create policy course_tracking_insert_own on course_tracking
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy course_tracking_update_own on course_tracking
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy course_tracking_delete_own on course_tracking
  for delete to authenticated using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Scope on classifications
-- -----------------------------------------------------------------------------

alter table assignment_classifications
  add column scope_type section_scope_type not null default 'UNCERTAIN',
  -- For SPECIFIC_SECTIONS these are the targeted sections; for
  -- ALL_SECTIONS_EXCEPT they are the excluded ones. Empty otherwise.
  add column scope_sections text[] not null default '{}',
  add column scope_rule text,
  add column scope_confidence numeric(4, 3);

alter table assignment_classifications
  add constraint classifications_scope_coherent check (
    (scope_type in ('ALL_SECTIONS', 'UNCERTAIN') and cardinality(scope_sections) = 0)
    or (scope_type in ('ALL_SECTIONS_EXCEPT', 'SPECIFIC_SECTIONS') and cardinality(scope_sections) > 0)
  );

alter table assignment_classifications
  add constraint classifications_scope_confidence_range
    check (scope_confidence is null or (scope_confidence >= 0 and scope_confidence <= 1));

-- An unrestricted assignment can never be hidden from anyone. Enforced here
-- because it is the single most dangerous mistake the classifier could make:
-- the default scope for unlabelled coursework is ALL_SECTIONS, so a bug that
-- paired it with NOT_RELEVANT would hide most of a course from every student.
alter table assignment_classifications
  add constraint classifications_all_sections_is_relevant
    check (scope_type <> 'ALL_SECTIONS' or relevance <> 'NOT_RELEVANT');

-- Serves the "which of my assignments need review, and why" screen.
create index classifications_scope_idx
  on assignment_classifications (user_id, scope_type)
  where scope_type = 'UNCERTAIN';

-- -----------------------------------------------------------------------------
-- Batch upsert, now carrying scope
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
        input_fingerprint text,
        scope_type section_scope_type,
        scope_sections text[],
        scope_rule text,
        scope_confidence numeric
      )
      order by row_in.assignment_id
  ),
  owned as (
    select i.*
      from incoming i
      join assignments a on a.id = i.assignment_id and a.user_id = p_user_id
  ),
  upserted as (
    insert into assignment_classifications (
      assignment_id, user_id, relevance, confidence, decided_by_rule,
      reason, evidence, conflicted, ruleset_version, input_fingerprint,
      scope_type, scope_sections, scope_rule, scope_confidence, classified_at
    )
    select
      o.assignment_id, p_user_id, o.relevance, o.confidence, o.decided_by_rule,
      o.reason, coalesce(o.evidence, '[]'::jsonb), coalesce(o.conflicted, false),
      o.ruleset_version, o.input_fingerprint,
      coalesce(o.scope_type, 'UNCERTAIN'), coalesce(o.scope_sections, '{}'),
      o.scope_rule, o.scope_confidence, now()
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
          scope_type        = excluded.scope_type,
          scope_sections    = excluded.scope_sections,
          scope_rule        = excluded.scope_rule,
          scope_confidence  = excluded.scope_confidence,
          classified_at     = excluded.classified_at
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- Course discovery read model
--
-- Every course the account can see, with the student's decision attached. This
-- is what the "choose your subjects" screen reads; it deliberately does NOT
-- filter by tracking, because its whole job is to show the untracked ones too.
-- -----------------------------------------------------------------------------
create or replace function app_list_discovered_courses(p_user_id uuid)
returns table (
  course_id uuid,
  source_course_id text,
  name text,
  section text,
  course_state text,
  is_tracked boolean,
  decided_at timestamptz,
  last_synced_at timestamptz,
  tracked_assignment_count bigint
)
language sql
stable
as $$
  select
    c.id,
    c.source_course_id,
    c.name,
    c.section,
    c.course_state,
    coalesce(t.is_tracked, false),
    t.updated_at,
    c.last_synced_at,
    (
      select count(*)
        from assignments a
       where a.course_id = c.id
         and a.lifecycle_status in ('ACTIVE', 'SOURCE_MISSING')
    )
  from courses c
  left join course_tracking t
    on t.course_id = c.id
   and t.user_id = c.user_id
  where c.user_id = p_user_id
    and c.lifecycle_status <> 'SOURCE_REMOVED'
  order by coalesce(t.is_tracked, false) desc, c.name asc;
$$;

/**
 * Sets tracking for one or more courses in a single statement.
 */
create or replace function app_set_course_tracking(
  p_user_id uuid,
  p_items jsonb
)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform app_assert_self(p_user_id);

  with incoming as (
    select distinct on (item.course_id) *
      from jsonb_to_recordset(p_items) as item (
        course_id uuid,
        is_tracked boolean
      )
      order by item.course_id
  ),
  -- Only courses that belong to this user. RLS would reject the write anyway;
  -- the join makes the intent explicit and fails early rather than obscurely.
  owned as (
    select i.*
      from incoming i
      join courses c on c.id = i.course_id and c.user_id = p_user_id
  ),
  upserted as (
    insert into course_tracking (user_id, course_id, is_tracked)
    select p_user_id, o.course_id, o.is_tracked from owned o
    on conflict (user_id, course_id) do update
      set is_tracked = excluded.is_tracked
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- The deadline feed
--
-- Replaced rather than altered because the return signature changes. The added
-- conditions are the two the product depends on:
--
--   join course_tracking ... where is_tracked  -- untracked subjects never appear
--   and a.due_sort_at is not null              -- undated coursework never appears
--
-- Both live here rather than in a caller, so every consumer -- this API, a
-- future notification job, a debug script -- applies them identically.
-- -----------------------------------------------------------------------------
drop function if exists app_upcoming_assignments(uuid, timestamptz, timestamptz, relevance[], boolean, integer);

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
  scope_type section_scope_type,
  scope_sections text[],
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
    coalesce(cl.scope_type, 'UNCERTAIN'::section_scope_type),
    coalesce(cl.scope_sections, '{}'),
    s.state,
    a.last_synced_at,
    a.alternate_link
  from assignments a
  -- INNER JOIN, not LEFT: an assignment whose course the student is not
  -- tracking has no business in the feed at all.
  join course_tracking t
    on t.course_id = a.course_id
   and t.user_id = a.user_id
   and t.is_tracked
  join courses c on c.id = a.course_id
  left join assignment_classifications cl on cl.assignment_id = a.id
  left join classification_overrides o on o.assignment_id = a.id and o.user_id = a.user_id
  left join submissions s on s.assignment_id = a.id
  where a.user_id = p_user_id
    and a.lifecycle_status in ('ACTIVE', 'SOURCE_MISSING')
    and a.source_state = 'PUBLISHED'
    -- Coursework with no Google-provided due date is preserved but excluded:
    -- this is a deadline feed, and it must not invent one to fill the gap.
    and a.due_sort_at is not null
    and a.due_sort_at >= p_from
    and (p_to is null or a.due_sort_at <= p_to)
    and coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance) = any (p_relevance)
    and (p_include_submitted or s.state is null or s.state not in ('TURNED_IN', 'RETURNED'))
  order by a.due_sort_at asc, a.title asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- -----------------------------------------------------------------------------
-- The companion query: tracked coursework with no deadline.
--
-- A first-class backend query, not a frontend filter over a feed that should
-- never have contained these rows. Same tracking and relevance conditions,
-- inverted only on the due date.
-- -----------------------------------------------------------------------------
create or replace function app_undated_assignments(
  p_user_id uuid,
  p_relevance relevance[],
  p_limit integer
)
returns table (
  assignment_id uuid,
  course_id uuid,
  course_name text,
  title text,
  effective_relevance relevance,
  has_manual_override boolean,
  scope_type section_scope_type,
  submission_state submission_state,
  source_created_at timestamptz,
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
    coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance),
    o.relevance is not null,
    coalesce(cl.scope_type, 'UNCERTAIN'::section_scope_type),
    s.state,
    a.source_created_at,
    a.last_synced_at,
    a.alternate_link
  from assignments a
  join course_tracking t
    on t.course_id = a.course_id
   and t.user_id = a.user_id
   and t.is_tracked
  join courses c on c.id = a.course_id
  left join assignment_classifications cl on cl.assignment_id = a.id
  left join classification_overrides o on o.assignment_id = a.id and o.user_id = a.user_id
  left join submissions s on s.assignment_id = a.id
  where a.user_id = p_user_id
    and a.lifecycle_status in ('ACTIVE', 'SOURCE_MISSING')
    and a.source_state = 'PUBLISHED'
    and a.due_sort_at is null
    and coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance) = any (p_relevance)
  order by a.source_created_at desc nulls last, a.title asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

-- Supports the undated query, which the partial index on due_sort_at cannot:
-- that one deliberately excludes exactly these rows.
create index assignments_undated_idx
  on assignments (user_id, course_id)
  where due_sort_at is null
    and lifecycle_status in ('ACTIVE', 'SOURCE_MISSING')
    and source_state = 'PUBLISHED';

grant execute on function app_list_discovered_courses(uuid) to authenticated;
grant execute on function app_set_course_tracking(uuid, jsonb) to authenticated;
grant execute on function app_upcoming_assignments(uuid, timestamptz, timestamptz, relevance[], boolean, integer) to authenticated;
grant execute on function app_undated_assignments(uuid, relevance[], integer) to authenticated;

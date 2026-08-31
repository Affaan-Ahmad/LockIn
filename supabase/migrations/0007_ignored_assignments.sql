-- =============================================================================
-- 0007_ignored_assignments.sql
--
-- "I know about this one. Stop showing it to me."
--
-- Distinct from a classification override, and deliberately not folded into it.
-- An override answers "is this mine?" -- a statement about the coursework.
-- Ignoring answers "do I still need to see it?" -- a statement about the
-- student's own attention. Overloading NOT_RELEVANT to mean both would corrupt
-- the classification record: a missed lab that genuinely was for section G
-- would end up stored as evidence that it was not.
--
-- The distinction matters for a feature that does not exist yet. When LockIn
-- eventually learns from overrides, it must learn from "wrong section" and not
-- from "I gave up on this one".
--
-- Same shape as course_tracking and classification_overrides: a user decision,
-- in its own table, with no write path from the sync pipeline. Nothing is
-- deleted, and un-ignoring restores the item exactly.
-- =============================================================================

create table ignored_assignments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references user_profiles (id) on delete cascade,
  assignment_id uuid not null references assignments (id) on delete cascade,
  -- Optional. Present so a future "why did I hide this?" can be answered
  -- without guessing, and so the row is self-explanatory in a support context.
  note          text,
  ignored_at    timestamptz not null default now(),

  constraint ignored_unique_per_assignment unique (user_id, assignment_id)
);

-- Every feed query joins through this to exclude, so the lookup is on the hot
-- path. Partial is pointless here -- a row's existence *is* the flag.
create index ignored_assignments_user_idx on ignored_assignments (user_id, assignment_id);

alter table ignored_assignments enable row level security;

create policy ignored_select_own on ignored_assignments
  for select to authenticated using (user_id = (select auth.uid()));
create policy ignored_insert_own on ignored_assignments
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy ignored_delete_own on ignored_assignments
  for delete to authenticated using (user_id = (select auth.uid()));

/**
 * Hides or restores one assignment.
 *
 * Idempotent in both directions: ignoring something already ignored, or
 * restoring something that was never hidden, is a no-op rather than an error.
 * A double-tap on a phone must not produce a failure dialog.
 */
create or replace function app_set_assignment_ignored(
  p_user_id uuid,
  p_assignment_id uuid,
  p_ignored boolean,
  p_note text default null
)
returns boolean
language plpgsql
as $$
begin
  perform app_assert_self(p_user_id);

  -- Ownership is checked explicitly rather than left to RLS. The policy would
  -- reject the write anyway, but failing on a clear join is easier to debug
  -- than a silent zero-row result.
  if not exists (
    select 1 from assignments a where a.id = p_assignment_id and a.user_id = p_user_id
  ) then
    raise exception 'assignment not found' using errcode = 'P0002';
  end if;

  if p_ignored then
    insert into ignored_assignments (user_id, assignment_id, note)
    values (p_user_id, p_assignment_id, p_note)
    on conflict (user_id, assignment_id) do update set note = excluded.note;
  else
    delete from ignored_assignments
     where user_id = p_user_id and assignment_id = p_assignment_id;
  end if;

  return p_ignored;
end;
$$;

grant execute on function app_set_assignment_ignored(uuid, uuid, boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- The three feeds now exclude ignored work.
--
-- Replaced rather than filtered in the application, so every consumer -- this
-- API, a future notification job, a debug script -- hides the same set. A
-- filter applied in one caller is a filter the next caller forgets.
-- -----------------------------------------------------------------------------

drop function if exists app_upcoming_assignments(uuid, timestamptz, relevance[], boolean, integer);
drop function if exists app_overdue_assignments(uuid, timestamptz, relevance[], boolean, integer);
drop function if exists app_undated_assignments(uuid, relevance[], integer);

create or replace function app_upcoming_assignments(
  p_user_id uuid,
  p_to timestamptz,
  p_relevance relevance[],
  p_include_submitted boolean,
  p_limit integer
)
returns table (
  assignment_id uuid, course_id uuid, course_name text, title text,
  due_date_raw date, due_time_raw time, due_at timestamptz,
  due_precision due_precision, due_sort_at timestamptz,
  effective_relevance relevance, confidence numeric, has_manual_override boolean,
  scope_type section_scope_type, scope_sections text[],
  submission_state submission_state, last_synced_at timestamptz, alternate_link text
)
language sql
stable
as $$
  select
    a.id, a.course_id, c.name, a.title,
    a.due_date_raw, a.due_time_raw, a.due_at, a.due_precision, a.due_sort_at,
    coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance),
    case when o.relevance is not null then 1.0 else coalesce(cl.confidence, 0) end,
    o.relevance is not null,
    coalesce(cl.scope_type, 'UNCERTAIN'::section_scope_type),
    coalesce(cl.scope_sections, '{}'),
    s.state, a.last_synced_at, a.alternate_link
  from assignments a
  join course_tracking t on t.course_id = a.course_id and t.user_id = a.user_id and t.is_tracked
  join courses c on c.id = a.course_id
  left join academic_profiles ap on ap.user_id = a.user_id
  left join assignment_classifications cl on cl.assignment_id = a.id
  left join classification_overrides o on o.assignment_id = a.id and o.user_id = a.user_id
  left join submissions s on s.assignment_id = a.id
  left join ignored_assignments ig on ig.assignment_id = a.id and ig.user_id = a.user_id
  where a.user_id = p_user_id
    and ig.assignment_id is null
    and a.lifecycle_status in ('ACTIVE', 'SOURCE_MISSING')
    and a.source_state = 'PUBLISHED'
    and a.due_sort_at is not null
    and not app_is_past_due(a.due_precision, a.due_at, a.due_date_raw, ap.time_zone)
    and (p_to is null or a.due_sort_at <= p_to)
    and coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance) = any (p_relevance)
    and (p_include_submitted or s.state is null or s.state not in ('TURNED_IN', 'RETURNED'))
  order by a.due_sort_at asc, a.title asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

create or replace function app_overdue_assignments(
  p_user_id uuid,
  p_since timestamptz,
  p_relevance relevance[],
  p_include_submitted boolean,
  p_limit integer
)
returns table (
  assignment_id uuid, course_id uuid, course_name text, title text,
  due_date_raw date, due_time_raw time, due_at timestamptz,
  due_precision due_precision, due_sort_at timestamptz,
  effective_relevance relevance, confidence numeric, has_manual_override boolean,
  scope_type section_scope_type, scope_sections text[],
  submission_state submission_state, last_synced_at timestamptz, alternate_link text
)
language sql
stable
as $$
  select
    a.id, a.course_id, c.name, a.title,
    a.due_date_raw, a.due_time_raw, a.due_at, a.due_precision, a.due_sort_at,
    coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance),
    case when o.relevance is not null then 1.0 else coalesce(cl.confidence, 0) end,
    o.relevance is not null,
    coalesce(cl.scope_type, 'UNCERTAIN'::section_scope_type),
    coalesce(cl.scope_sections, '{}'),
    s.state, a.last_synced_at, a.alternate_link
  from assignments a
  join course_tracking t on t.course_id = a.course_id and t.user_id = a.user_id and t.is_tracked
  join courses c on c.id = a.course_id
  left join academic_profiles ap on ap.user_id = a.user_id
  left join assignment_classifications cl on cl.assignment_id = a.id
  left join classification_overrides o on o.assignment_id = a.id and o.user_id = a.user_id
  left join submissions s on s.assignment_id = a.id
  left join ignored_assignments ig on ig.assignment_id = a.id and ig.user_id = a.user_id
  where a.user_id = p_user_id
    and ig.assignment_id is null
    and a.lifecycle_status in ('ACTIVE', 'SOURCE_MISSING')
    and a.source_state = 'PUBLISHED'
    and a.due_sort_at is not null
    and app_is_past_due(a.due_precision, a.due_at, a.due_date_raw, ap.time_zone)
    and (p_since is null or a.due_sort_at >= p_since)
    and coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance) = any (p_relevance)
    and (p_include_submitted or s.state is null or s.state not in ('TURNED_IN', 'RETURNED'))
  order by a.due_sort_at desc, a.title asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

create or replace function app_undated_assignments(
  p_user_id uuid,
  p_relevance relevance[],
  p_limit integer
)
returns table (
  assignment_id uuid, course_id uuid, course_name text, title text,
  effective_relevance relevance, has_manual_override boolean,
  scope_type section_scope_type, submission_state submission_state,
  source_created_at timestamptz, last_synced_at timestamptz, alternate_link text
)
language sql
stable
as $$
  select
    a.id, a.course_id, c.name, a.title,
    coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance),
    o.relevance is not null,
    coalesce(cl.scope_type, 'UNCERTAIN'::section_scope_type),
    s.state, a.source_created_at, a.last_synced_at, a.alternate_link
  from assignments a
  join course_tracking t on t.course_id = a.course_id and t.user_id = a.user_id and t.is_tracked
  join courses c on c.id = a.course_id
  left join assignment_classifications cl on cl.assignment_id = a.id
  left join classification_overrides o on o.assignment_id = a.id and o.user_id = a.user_id
  left join submissions s on s.assignment_id = a.id
  left join ignored_assignments ig on ig.assignment_id = a.id and ig.user_id = a.user_id
  where a.user_id = p_user_id
    and ig.assignment_id is null
    and a.lifecycle_status in ('ACTIVE', 'SOURCE_MISSING')
    and a.source_state = 'PUBLISHED'
    and a.due_sort_at is null
    and coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance) = any (p_relevance)
  order by a.source_created_at desc nulls last, a.title asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

/**
 * What the student has hidden.
 *
 * A real list, not a void. Anything hideable must be findable again, or the
 * control is a delete button wearing a friendlier label.
 */
create or replace function app_ignored_assignments(
  p_user_id uuid,
  p_limit integer
)
returns table (
  assignment_id uuid, course_id uuid, course_name text, title text,
  due_date_raw date, due_time_raw time, due_at timestamptz,
  due_precision due_precision, due_sort_at timestamptz,
  effective_relevance relevance, confidence numeric, has_manual_override boolean,
  scope_type section_scope_type, scope_sections text[],
  submission_state submission_state, last_synced_at timestamptz, alternate_link text,
  ignored_at timestamptz
)
language sql
stable
as $$
  select
    a.id, a.course_id, c.name, a.title,
    a.due_date_raw, a.due_time_raw, a.due_at, a.due_precision, a.due_sort_at,
    coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance),
    case when o.relevance is not null then 1.0 else coalesce(cl.confidence, 0) end,
    o.relevance is not null,
    coalesce(cl.scope_type, 'UNCERTAIN'::section_scope_type),
    coalesce(cl.scope_sections, '{}'),
    s.state, a.last_synced_at, a.alternate_link,
    ig.ignored_at
  from ignored_assignments ig
  join assignments a on a.id = ig.assignment_id
  join courses c on c.id = a.course_id
  left join assignment_classifications cl on cl.assignment_id = a.id
  left join classification_overrides o on o.assignment_id = a.id and o.user_id = a.user_id
  left join submissions s on s.assignment_id = a.id
  where ig.user_id = p_user_id
  order by ig.ignored_at desc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

grant execute on function app_upcoming_assignments(uuid, timestamptz, relevance[], boolean, integer) to authenticated;
grant execute on function app_overdue_assignments(uuid, timestamptz, relevance[], boolean, integer) to authenticated;
grant execute on function app_undated_assignments(uuid, relevance[], integer) to authenticated;
grant execute on function app_ignored_assignments(uuid, integer) to authenticated;

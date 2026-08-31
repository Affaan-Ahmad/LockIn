-- =============================================================================
-- 0005_overdue.sql
--
-- Overdue coursework as its own view.
--
-- The upcoming feed previously started at "now", so anything already past due
-- silently disappeared. For a deadline tracker that is backwards: unsubmitted
-- overdue work is the most urgent thing a student has, and dropping it is a
-- quieter version of the failure this project exists to prevent.
--
-- Tracked, relevant coursework now partitions exactly three ways, with no item
-- in two buckets and none in none:
--
--   UPCOMING   has a deadline, not yet past
--   OVERDUE    has a deadline, past, not submitted
--   UNDATED    Google gave no due date at all
--
-- (Past and submitted is in no bucket: it is finished.)
-- =============================================================================

/**
 * Whether a deadline has actually passed.
 *
 * The DATE_ONLY branch is the reason this is a function rather than an inline
 * `due_sort_at < now()`. A date with no time sorts at 00:00 UTC, so a naive
 * comparison marks work overdue the instant the day begins -- for a student in
 * UTC+5, five hours before their day has even started, and a full day before
 * the deadline they were actually given.
 *
 * Comparing calendar dates in the student's own timezone is the honest reading:
 * work due "on the 14th" is late on the 15th, not at midnight UTC on the 14th.
 */
create or replace function app_is_past_due(
  p_due_precision due_precision,
  p_due_at timestamptz,
  p_due_date_raw date,
  p_time_zone text
)
returns boolean
language sql
stable
as $$
  select case
    when p_due_precision = 'EXACT' then p_due_at < now()
    when p_due_precision = 'DATE_ONLY'
      then p_due_date_raw < (now() at time zone coalesce(p_time_zone, 'UTC'))::date
    else false
  end;
$$;

-- -----------------------------------------------------------------------------
-- Upcoming: replaced so the boundary is shared with overdue rather than
-- duplicated. p_from is gone -- "not past due" is the condition, and a caller
-- passing its own start time was how the overdue gap appeared in the first
-- place.
-- -----------------------------------------------------------------------------
drop function if exists app_upcoming_assignments(uuid, timestamptz, timestamptz, relevance[], boolean, integer);

create or replace function app_upcoming_assignments(
  p_user_id uuid,
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
    a.id, a.course_id, c.name, a.title,
    a.due_date_raw, a.due_time_raw, a.due_at, a.due_precision, a.due_sort_at,
    coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance),
    case when o.relevance is not null then 1.0 else coalesce(cl.confidence, 0) end,
    o.relevance is not null,
    coalesce(cl.scope_type, 'UNCERTAIN'::section_scope_type),
    coalesce(cl.scope_sections, '{}'),
    s.state, a.last_synced_at, a.alternate_link
  from assignments a
  join course_tracking t
    on t.course_id = a.course_id and t.user_id = a.user_id and t.is_tracked
  join courses c on c.id = a.course_id
  left join academic_profiles ap on ap.user_id = a.user_id
  left join assignment_classifications cl on cl.assignment_id = a.id
  left join classification_overrides o on o.assignment_id = a.id and o.user_id = a.user_id
  left join submissions s on s.assignment_id = a.id
  where a.user_id = p_user_id
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

-- -----------------------------------------------------------------------------
-- Overdue: the exact complement, on the same boundary function.
--
-- Ordered most-recently-missed first, which is how a student triages: what did
-- I just miss, rather than what have I been ignoring longest.
--
-- Submitted work is excluded by default. An assignment turned in after its
-- deadline is late, but it is done, and surfacing it as outstanding would make
-- the tab noise instead of a to-do list.
-- -----------------------------------------------------------------------------
create or replace function app_overdue_assignments(
  p_user_id uuid,
  p_since timestamptz,
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
    a.id, a.course_id, c.name, a.title,
    a.due_date_raw, a.due_time_raw, a.due_at, a.due_precision, a.due_sort_at,
    coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance),
    case when o.relevance is not null then 1.0 else coalesce(cl.confidence, 0) end,
    o.relevance is not null,
    coalesce(cl.scope_type, 'UNCERTAIN'::section_scope_type),
    coalesce(cl.scope_sections, '{}'),
    s.state, a.last_synced_at, a.alternate_link
  from assignments a
  join course_tracking t
    on t.course_id = a.course_id and t.user_id = a.user_id and t.is_tracked
  join courses c on c.id = a.course_id
  left join academic_profiles ap on ap.user_id = a.user_id
  left join assignment_classifications cl on cl.assignment_id = a.id
  left join classification_overrides o on o.assignment_id = a.id and o.user_id = a.user_id
  left join submissions s on s.assignment_id = a.id
  where a.user_id = p_user_id
    and a.lifecycle_status in ('ACTIVE', 'SOURCE_MISSING')
    and a.source_state = 'PUBLISHED'
    and a.due_sort_at is not null
    and app_is_past_due(a.due_precision, a.due_at, a.due_date_raw, ap.time_zone)
    -- Optional floor, so a student returning after a long break is not buried
    -- under a year of missed work. Null means everything.
    and (p_since is null or a.due_sort_at >= p_since)
    and coalesce(o.relevance, cl.relevance, 'UNCERTAIN'::relevance) = any (p_relevance)
    and (p_include_submitted or s.state is null or s.state not in ('TURNED_IN', 'RETURNED'))
  order by a.due_sort_at desc, a.title asc
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;

grant execute on function app_is_past_due(due_precision, timestamptz, date, text) to authenticated;
grant execute on function app_upcoming_assignments(uuid, timestamptz, relevance[], boolean, integer) to authenticated;
grant execute on function app_overdue_assignments(uuid, timestamptz, relevance[], boolean, integer) to authenticated;

-- =============================================================================
-- 0015_student_notes_and_events.sql
--
-- The first two things in this system the student writes themselves.
--
-- Everything stored until now came from Google and was, in the end, a cache: if
-- a table were dropped the next sync would rebuild it. These two cannot be
-- rebuilt from anywhere. A note about a submitted assignment and a quiz the
-- student added to their own calendar exist only here, which is why both cascade
-- from user_profiles (so account deletion still removes everything) and why both
-- carry length limits at the database rather than trusting a form.
--
-- Kept in one migration because they are one concern -- student-authored content
-- -- and because applying two files by hand is two chances to apply one.
--
-- Written to be safely re-runnable: every object is created with IF NOT EXISTS
-- or OR REPLACE, and the policies are dropped before being recreated. A
-- migration applied by pasting into a SQL editor gets re-run by accident sooner
-- or later, and failing halfway through is worse than doing nothing twice.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Notes on coursework.
--
-- One note per assignment, not a thread. A student annotating their own work
-- wants to amend the note, not accumulate a conversation with themselves, and a
-- unique constraint makes "save" idempotent rather than duplicating on a double
-- click.
-- -----------------------------------------------------------------------------
create table if not exists assignment_notes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references user_profiles (id) on delete cascade,
  assignment_id uuid not null references assignments (id) on delete cascade,
  body          text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint assignment_notes_unique_per_assignment unique (user_id, assignment_id),
  -- Bounded here as well as in the API. A limit enforced only by a form is a
  -- limit that does not apply to anything calling the endpoint directly.
  constraint assignment_notes_body_length check (char_length(body) between 1 and 2000)
);

create or replace trigger assignment_notes_touch
  before update on assignment_notes
  for each row execute function app_touch_updated_at();

create index if not exists assignment_notes_user_idx on assignment_notes (user_id);

-- -----------------------------------------------------------------------------
-- The student's own calendar entries.
--
-- A quiz the lecturer announced out loud and never posted to Classroom is the
-- motivating case: it is real, it is dated, and nothing in Google knows about
-- it. No foreign key to assignments, deliberately -- this exists precisely for
-- the work that has no assignment row.
--
-- `kind` is a text column with a check rather than a Postgres enum. 0011 is the
-- standing reminder of what enums cost here: a new label cannot be used in the
-- same transaction that adds it, so extending one is a two-migration dance. A
-- student wanting "Viva" or "Presentation" later should not need that.
-- -----------------------------------------------------------------------------
create table if not exists user_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references user_profiles (id) on delete cascade,
  title      text not null,
  kind       text not null default 'OTHER',
  -- Stored as an instant. The application supplies it from the student's own
  -- timezone, so a 9am quiz stays 9am for them and does not drift when the
  -- server's idea of "today" differs.
  starts_at  timestamptz not null,
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_events_title_length check (char_length(title) between 1 and 120),
  constraint user_events_note_length check (note is null or char_length(note) <= 500),
  constraint user_events_kind_known check (kind in ('QUIZ', 'EXAM', 'ASSIGNMENT', 'CLASS', 'OTHER'))
);

create or replace trigger user_events_touch
  before update on user_events
  for each row execute function app_touch_updated_at();

-- Leading with user_id so the RLS predicate is an index seek, and ordering by
-- starts_at because every read of this table is "what is coming".
create index if not exists user_events_user_starts_idx on user_events (user_id, starts_at);

-- -----------------------------------------------------------------------------
-- Row-level security, identical in shape to every other user-owned table.
-- -----------------------------------------------------------------------------
alter table assignment_notes enable row level security;
alter table user_events      enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['assignment_notes', 'user_events']
  loop
    execute format('drop policy if exists %1$s_select_own on %1$I', t);
    execute format('drop policy if exists %1$s_insert_own on %1$I', t);
    execute format('drop policy if exists %1$s_update_own on %1$I', t);
    execute format('drop policy if exists %1$s_delete_own on %1$I', t);

    execute format(
      'create policy %1$s_select_own on %1$I for select to authenticated
         using (user_id = (select auth.uid()))', t);

    execute format(
      'create policy %1$s_insert_own on %1$I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);

    -- USING and WITH CHECK both, so a row cannot be updated out of ownership.
    execute format(
      'create policy %1$s_update_own on %1$I for update to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);

    execute format(
      'create policy %1$s_delete_own on %1$I for delete to authenticated
         using (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Writing a note.
--
-- Through a function for the reason 0014 exists: assignment_id is supplied by
-- the caller and has a foreign key, and a foreign key is checked as the table
-- owner, outside the caller's policies. Written as a bare upsert this would
-- accept another student's assignment id and reject an imaginary one, and the
-- difference is an existence oracle. Ownership is required instead, and both
-- cases answer P0002.
--
-- user_events needs no equivalent: it references nothing, so there is no
-- cross-user identifier for a caller to probe.
-- -----------------------------------------------------------------------------
create or replace function app_set_assignment_note(
  p_user_id uuid,
  p_assignment_id uuid,
  p_body text
)
returns assignment_notes
language plpgsql
as $$
declare
  v_row assignment_notes;
begin
  perform app_assert_self(p_user_id);

  if not exists (
    select 1 from assignments a where a.id = p_assignment_id and a.user_id = p_user_id
  ) then
    raise exception 'assignment not found' using errcode = 'P0002';
  end if;

  insert into assignment_notes (user_id, assignment_id, body)
  values (p_user_id, p_assignment_id, p_body)
  on conflict (user_id, assignment_id)
    do update set body = excluded.body
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function app_set_assignment_note(uuid, uuid, text) to authenticated;

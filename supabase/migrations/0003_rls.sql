-- =============================================================================
-- 0003_rls.sql
--
-- Row-level security.
--
-- The threat this defends against is concrete: two students at the same
-- university, both signed in, both hitting the same PostgREST endpoint. Without
-- RLS the only thing standing between them is a WHERE clause in application
-- code, and a single missing filter leaks one student's coursework, sections,
-- classifications and manual decisions to another.
--
-- Every user-owned table therefore carries user_id and the same predicate. The
-- predicate is deliberately identical everywhere: a clever per-table variation
-- is a place for a bug to hide.
--
-- google_connections is the exception, and its exception is stricter, not
-- looser: RLS is enabled with NO policies at all, so every client role is
-- denied. Only the service role -- used by the token service and the OAuth
-- callback, nowhere else -- can reach it.
-- =============================================================================

alter table user_profiles              enable row level security;
alter table academic_profiles          enable row level security;
alter table section_aliases            enable row level security;
alter table google_connections         enable row level security;
alter table courses                    enable row level security;
alter table topics                     enable row level security;
alter table assignments                enable row level security;
alter table submissions                enable row level security;
alter table assignment_classifications enable row level security;
alter table classification_overrides   enable row level security;
alter table sync_runs                  enable row level security;
alter table sync_course_results        enable row level security;
alter table sync_errors                enable row level security;

-- Belt and braces: FORCE applies the policies even to the table owner, so a
-- migration or a job that happens to run as the owner is not silently exempt.
alter table google_connections force row level security;

-- -----------------------------------------------------------------------------
-- user_profiles keys on `id` rather than `user_id`.
-- -----------------------------------------------------------------------------

create policy user_profiles_select_own on user_profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy user_profiles_insert_own on user_profiles
  for insert to authenticated
  with check (id = (select auth.uid()));

create policy user_profiles_update_own on user_profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Everything else keys on user_id.
--
-- Both USING and WITH CHECK are specified on every writable policy. USING alone
-- would let a user update a row they own into one they do not, which is the
-- classic RLS mistake.
--
-- auth.uid() is wrapped in a scalar subquery so Postgres evaluates it once per
-- statement instead of once per row -- a measurable difference on a batch
-- upsert of several hundred assignments.
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'academic_profiles',
    'section_aliases',
    'courses',
    'topics',
    'assignments',
    'submissions',
    'assignment_classifications',
    'classification_overrides',
    'sync_runs',
    'sync_course_results',
    'sync_errors'
  ]
  loop
    execute format(
      'create policy %1$s_select_own on %1$I for select to authenticated
         using (user_id = (select auth.uid()))', t);

    execute format(
      'create policy %1$s_insert_own on %1$I for insert to authenticated
         with check (user_id = (select auth.uid()))', t);

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
-- Indexes supporting the policy predicates.
--
-- An RLS predicate is a WHERE clause: without an index on user_id every policy
-- check on a table without a leading-user_id index degrades to a scan. The
-- composite indexes in 0001 already lead with user_id for courses, assignments
-- and sync_runs; these cover the remainder.
-- -----------------------------------------------------------------------------

create index if not exists section_aliases_user_idx on section_aliases (user_id) where is_active;
create index if not exists topics_user_idx on topics (user_id);
create index if not exists submissions_user_idx on submissions (user_id);
create index if not exists overrides_user_idx on classification_overrides (user_id);
create index if not exists sync_course_results_user_idx on sync_course_results (user_id);
create index if not exists sync_errors_user_idx on sync_errors (user_id);

-- -----------------------------------------------------------------------------
-- Execution grants.
--
-- The RPCs are SECURITY INVOKER, so granting EXECUTE does not grant data
-- access: RLS still decides what each call can touch.
-- -----------------------------------------------------------------------------

grant execute on function app_acquire_sync_run(uuid, sync_trigger, sync_mode, integer) to authenticated;
grant execute on function app_heartbeat_sync_run(uuid, integer) to authenticated;
grant execute on function app_finalize_sync_run(uuid, sync_status, jsonb, text) to authenticated;
grant execute on function app_upsert_courses(uuid, jsonb, timestamptz) to authenticated;
grant execute on function app_upsert_topics(uuid, uuid, jsonb, timestamptz) to authenticated;
grant execute on function app_upsert_assignments(uuid, uuid, jsonb, timestamptz) to authenticated;
grant execute on function app_upsert_submissions(uuid, uuid, jsonb, timestamptz) to authenticated;
grant execute on function app_reconcile_missing_assignments(uuid, uuid, text[], timestamptz, integer) to authenticated;
grant execute on function app_upsert_classifications(uuid, jsonb) to authenticated;
grant execute on function app_upcoming_assignments(uuid, timestamptz, timestamptz, relevance[], boolean, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- New-user bootstrap.
--
-- Creating the profile row from a trigger rather than from application code
-- means a user cannot exist in auth.users without the row every foreign key
-- depends on -- including one created through a path the application does not
-- control, such as an invite or an admin action.
-- -----------------------------------------------------------------------------

create or replace function app_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email, display_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_handle_new_user();

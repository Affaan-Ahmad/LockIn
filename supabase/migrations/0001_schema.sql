-- =============================================================================
-- 0001_schema.sql
--
-- Core schema for the personalised academic data layer.
--
-- Two principles shape this file:
--
--   1. SOURCE AND DERIVED DATA ARE PHYSICALLY SEPARATE. `assignments` holds only
--      what Google said. `assignment_classifications` holds what we concluded.
--      `classification_overrides` holds what the student decided. Three tables,
--      three owners, three lifecycles -- so a sync that rewrites source data has
--      no code path that can touch a conclusion or a user decision.
--
--   2. INVARIANTS THAT PROTECT A STUDENT'S DATA LIVE HERE, NOT ONLY IN
--      TYPESCRIPT. Duplicate prevention, deadline coherence, the confidence
--      floor for hiding coursework, and single-active-sync are all enforced by
--      constraints. Application bugs then produce errors instead of corruption.
-- =============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "citext";

-- -----------------------------------------------------------------------------
-- Enumerations
--
-- Enums rather than free text so that a typo in application code is a database
-- error rather than a row nobody ever queries again. Adding a value later is a
-- one-line ALTER TYPE, which is the same cost as widening a CHECK constraint.
-- -----------------------------------------------------------------------------

create type academic_source as enum ('GOOGLE_CLASSROOM', 'MANUAL');

create type work_type as enum (
  'ASSIGNMENT',
  'SHORT_ANSWER_QUESTION',
  'MULTIPLE_CHOICE_QUESTION',
  'MATERIAL',
  'UNSPECIFIED'
);

create type source_state as enum ('PUBLISHED', 'DRAFT', 'DELETED', 'UNSPECIFIED');

create type assignee_mode as enum ('ALL_STUDENTS', 'INDIVIDUAL_STUDENTS');

create type lifecycle_status as enum (
  'ACTIVE',
  'SOURCE_MISSING',
  'SOURCE_REMOVED',
  'ARCHIVED'
);

create type due_precision as enum ('EXACT', 'DATE_ONLY', 'NONE');

create type relevance as enum ('RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN');

create type submission_state as enum (
  'NEW',
  'CREATED',
  'TURNED_IN',
  'RETURNED',
  'RECLAIMED_BY_STUDENT',
  'UNSPECIFIED'
);

create type sync_status as enum (
  'RUNNING',
  'SUCCESS',
  'PARTIAL_SUCCESS',
  'FAILED',
  'ABANDONED'
);

create type sync_mode as enum ('FULL', 'INCREMENTAL');
create type sync_trigger as enum ('MANUAL', 'SCHEDULED', 'ON_DEMAND');
create type course_sync_status as enum ('SUCCESS', 'FAILED', 'SKIPPED');
create type listing_completeness as enum ('COMPLETE', 'PARTIAL', 'FAILED');
create type google_connection_status as enum ('ACTIVE', 'NEEDS_RECONNECT', 'REVOKED');
create type alias_source as enum ('USER', 'DERIVED');
create type alias_kind as enum ('BARE', 'LABELLED', 'PROGRAM_CODE', 'BATCH_SECTION', 'CUSTOM');
create type issue_scope as enum ('RUN', 'COURSE', 'ITEM');

-- -----------------------------------------------------------------------------
-- Shared helpers
-- -----------------------------------------------------------------------------

create or replace function app_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Identity
-- -----------------------------------------------------------------------------

create table user_profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       citext not null,
  display_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger user_profiles_touch
  before update on user_profiles
  for each row execute function app_touch_updated_at();

create table academic_profiles (
  user_id         uuid primary key references user_profiles (id) on delete cascade,
  university      text,
  program_code    text,
  batch           text,
  primary_section text not null,
  -- IANA zone. Deadlines are always stored in UTC; this is used only to render
  -- them, and having it explicit is what stops rendering from guessing.
  time_zone       text not null default 'UTC',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint academic_profiles_section_not_blank check (btrim(primary_section) <> ''),
  constraint academic_profiles_time_zone_not_blank check (btrim(time_zone) <> '')
);

create trigger academic_profiles_touch
  before update on academic_profiles
  for each row execute function app_touch_updated_at();

create table section_aliases (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references user_profiles (id) on delete cascade,
  alias_raw  text not null,
  -- Normalised comparison key, maintained by trigger so that a direct INSERT
  -- cannot introduce an alias that the application would never match.
  alias_key  text not null,
  kind       alias_kind not null default 'CUSTOM',
  source     alias_source not null default 'USER',
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),

  constraint section_aliases_raw_not_blank check (btrim(alias_raw) <> ''),
  constraint section_aliases_key_not_blank check (alias_key <> ''),
  constraint section_aliases_unique_per_user unique (user_id, alias_key)
);

-- unaccent is not enabled by default on every Postgres deployment, so fold the
-- common Latin-1 accents explicitly rather than depending on the extension.
create or replace function unaccent_fallback(p_input text)
returns text
language sql
immutable
as $$
  select translate(
    p_input,
    'àáâãäåèéêëìíîïòóôõöùúûüýÿñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝÑÇ',
    'aaaaaaeeeeiiiiooooouuuuyyncAAAAAAEEEEIIIIOOOOOUUUUYNC'
  );
$$;

-- Mirrors normalizeAliasKey() in src/domain/academic/section.ts. The two must
-- agree; the unique constraint on section_aliases is meaningless otherwise.
create or replace function app_normalize_alias_key(p_raw text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(unaccent_fallback(p_raw)), '[^a-z0-9]', '', 'g');
$$;

create or replace function app_section_aliases_normalize()
returns trigger
language plpgsql
as $$
begin
  new.alias_key := app_normalize_alias_key(new.alias_raw);
  return new;
end;
$$;

create trigger section_aliases_normalize
  before insert or update of alias_raw on section_aliases
  for each row execute function app_section_aliases_normalize();

-- -----------------------------------------------------------------------------
-- Google authorisation
--
-- Tokens are stored as AES-256-GCM envelopes, not plaintext. RLS on this table
-- denies every client role outright (see 0003_rls.sql): only the server-side
-- token service, holding the service role, ever reads it. Encryption is the
-- second layer -- it protects backups, replicas and support exports, which RLS
-- does not.
-- -----------------------------------------------------------------------------

create table google_connections (
  user_id                  uuid primary key references user_profiles (id) on delete cascade,
  google_sub               text not null,
  -- Classroom's own user id. Nullable because we learn it opportunistically
  -- from a submission payload rather than spending an extra OAuth scope on it.
  -- Null means "unknown", and the source-targeting rule abstains rather than
  -- guessing when it is null.
  google_user_id           text,
  granted_scopes           text[] not null default '{}',
  access_token_ct          bytea,
  access_token_expires_at  timestamptz,
  refresh_token_ct         bytea,
  status                   google_connection_status not null default 'ACTIVE',
  last_error_code          text,
  connected_at             timestamptz not null default now(),
  last_refreshed_at        timestamptz,
  revoked_at               timestamptz,
  updated_at               timestamptz not null default now(),

  constraint google_connections_revoked_consistency
    check (status <> 'REVOKED' or revoked_at is not null)
);

create trigger google_connections_touch
  before update on google_connections
  for each row execute function app_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Courses
--
-- Courses are stored per user rather than as shared entities with a join table.
-- A shared row would mean one student's sync writing rows another student reads,
-- which is a cross-tenant write path, a more complex RLS story, and a single
-- watermark shared by users whose syncs run at different times. The duplication
-- (about ten rows per student) is not worth avoiding at that price. These rows
-- are a per-user projection of Google's state, not a canonical course registry.
-- -----------------------------------------------------------------------------

create table courses (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references user_profiles (id) on delete cascade,
  source               academic_source not null default 'GOOGLE_CLASSROOM',
  source_course_id     text not null,

  name                 text not null,
  section              text,
  description_heading  text,
  room                 text,
  course_state         text,
  alternate_link       text,

  source_created_at    timestamptz,
  source_updated_at    timestamptz,
  last_synced_at       timestamptz not null default now(),
  -- Newest coursework update timestamp already ingested. Drives incremental
  -- fetching; null means "never fully synchronised, do a full pass".
  coursework_watermark timestamptz,
  lifecycle_status     lifecycle_status not null default 'ACTIVE',

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint courses_unique_per_user unique (user_id, source, source_course_id)
);

create trigger courses_touch
  before update on courses
  for each row execute function app_touch_updated_at();

create index courses_user_lifecycle_idx
  on courses (user_id, lifecycle_status);

create table topics (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references user_profiles (id) on delete cascade,
  course_id         uuid not null references courses (id) on delete cascade,
  source            academic_source not null default 'GOOGLE_CLASSROOM',
  source_topic_id   text not null,
  name              text not null,
  source_updated_at timestamptz,
  last_synced_at    timestamptz not null default now(),

  constraint topics_unique_per_course unique (course_id, source_topic_id)
);

-- -----------------------------------------------------------------------------
-- Assignments
--
-- Everything above `-- derived` is what the source told us. Nothing in this
-- table is inferred, and no column here is ever written by the classifier.
-- -----------------------------------------------------------------------------

create table assignments (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references user_profiles (id) on delete cascade,
  course_id              uuid not null references courses (id) on delete cascade,

  source                 academic_source not null default 'GOOGLE_CLASSROOM',
  -- Google's courseWork id, or the equivalent stable id from another source.
  -- Uniqueness is scoped (user, source, id) so two sources may reuse an id.
  source_item_id         text not null,

  title                  text not null,
  description            text,
  work_type              work_type not null default 'UNSPECIFIED',
  source_state           source_state not null default 'UNSPECIFIED',
  max_points             numeric,
  alternate_link         text,
  topic_id               uuid references topics (id) on delete set null,
  source_topic_id        text,

  assignee_mode          assignee_mode,
  -- Null means Google did not expose the list. That is NOT the same as an empty
  -- list, and the classifier treats the two differently.
  individual_student_ids text[],

  -- Deadline, kept in the shape Google gave us. due_at exists only when both a
  -- date and a time were supplied; a date with no time never acquires 23:59.
  due_date_raw           date,
  due_time_raw           time,
  due_at                 timestamptz,
  due_precision          due_precision not null default 'NONE',

  source_created_at      timestamptz,
  source_updated_at      timestamptz,

  -- derived / local bookkeeping ------------------------------------------------
  lifecycle_status       lifecycle_status not null default 'ACTIVE',
  missing_streak         integer not null default 0,
  first_missing_at       timestamptz,
  source_fingerprint     text not null,
  last_synced_at         timestamptz not null default now(),
  -- Ordering key only. A DATE_ONLY item sorts at the start of its UTC day.
  -- This must never be rendered as a deadline: the student was not given a
  -- time, and showing one would be inventing data.
  due_sort_at            timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint assignments_unique_per_user unique (user_id, source, source_item_id),

  -- A deadline cannot claim more precision than the data supports.
  constraint assignments_due_precision_coherent check (
    (due_precision = 'EXACT'     and due_at is not null and due_date_raw is not null and due_time_raw is not null)
    or (due_precision = 'DATE_ONLY' and due_at is null and due_date_raw is not null and due_time_raw is null)
    or (due_precision = 'NONE'      and due_at is null and due_date_raw is null and due_time_raw is null)
  ),

  constraint assignments_missing_streak_sane check (missing_streak >= 0),

  constraint assignments_title_not_blank check (btrim(title) <> '')
);

create trigger assignments_touch
  before update on assignments
  for each row execute function app_touch_updated_at();

-- due_sort_at is maintained by trigger rather than as a GENERATED column
-- because the date-to-timestamptz conversion is not universally accepted as
-- immutable across Postgres versions. A trigger is portable and, unlike
-- application code, cannot be bypassed by a direct INSERT.
create or replace function app_assignments_set_due_sort()
returns trigger
language plpgsql
as $$
begin
  new.due_sort_at := coalesce(
    new.due_at,
    case
      when new.due_date_raw is null then null
      else timezone('UTC', new.due_date_raw::timestamp)
    end
  );
  return new;
end;
$$;

create trigger assignments_set_due_sort
  before insert or update of due_at, due_date_raw on assignments
  for each row execute function app_assignments_set_due_sort();

-- The hot query: "what is coming up for me". Partial so that years of archived
-- and removed coursework never enter the index, which keeps it small enough to
-- stay cached even for a student with a long history.
create index assignments_upcoming_idx
  on assignments (user_id, due_sort_at)
  where lifecycle_status in ('ACTIVE', 'SOURCE_MISSING')
    and source_state = 'PUBLISHED';

-- Incremental sync compares against the newest ingested update per course.
create index assignments_course_updated_idx
  on assignments (course_id, source_updated_at desc);

-- Reconciliation and per-course listing.
create index assignments_course_lifecycle_idx
  on assignments (course_id, lifecycle_status);

create table submissions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references user_profiles (id) on delete cascade,
  course_id             uuid not null references courses (id) on delete cascade,
  -- One submission per student per coursework item: the uniqueness is on
  -- assignment_id alone, which makes a duplicate structurally impossible rather
  -- than merely unlikely.
  assignment_id         uuid not null references assignments (id) on delete cascade,

  source                academic_source not null default 'GOOGLE_CLASSROOM',
  source_submission_id  text not null,

  state                 submission_state not null default 'UNSPECIFIED',
  -- Null means the source did not say. Not the same as "on time".
  late                  boolean,
  assigned_grade        numeric,
  draft_grade           numeric,
  alternate_link        text,

  source_created_at     timestamptz,
  source_updated_at     timestamptz,
  last_synced_at        timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint submissions_unique_per_assignment unique (assignment_id),
  constraint submissions_unique_source_id unique (user_id, source, source_submission_id)
);

create trigger submissions_touch
  before update on submissions
  for each row execute function app_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Derived: classifications
-- -----------------------------------------------------------------------------

create table assignment_classifications (
  assignment_id      uuid primary key references assignments (id) on delete cascade,
  user_id            uuid not null references user_profiles (id) on delete cascade,

  relevance          relevance not null,
  confidence         numeric(4, 3) not null,
  decided_by_rule    text,
  reason             text not null,
  -- Full evidence trail: which rule, which field, which substring, which alias.
  -- Kept so a wrong verdict can be explained and reproduced from stored data.
  evidence           jsonb not null default '[]'::jsonb,
  conflicted         boolean not null default false,
  ruleset_version    text not null,
  -- Hash of every input the verdict depended on. A mismatch on the next sync
  -- forces re-classification, so a rule fix or an alias correction reaches
  -- existing rows without a backfill.
  input_fingerprint  text not null,
  classified_at      timestamptz not null default now(),

  constraint classifications_confidence_range check (confidence >= 0 and confidence <= 1),

  -- The system may only hide coursework when it is genuinely confident. A timid
  -- NOT_RELEVANT is the failure mode that makes a student miss a deadline, so
  -- the database refuses to store one.
  constraint classifications_hiding_requires_confidence
    check (relevance <> 'NOT_RELEVANT' or confidence >= 0.8),

  -- An UNCERTAIN verdict with high confidence is a contradiction and almost
  -- certainly a bug in a new rule.
  constraint classifications_uncertain_is_low_confidence
    check (relevance <> 'UNCERTAIN' or confidence < 0.8)
);

-- Serves "show me everything I need to review" without touching the heap.
create index classifications_user_relevance_idx
  on assignment_classifications (user_id, relevance)
  include (assignment_id, confidence);

-- -----------------------------------------------------------------------------
-- User decisions
--
-- A separate table, not a column on the classification. Sync writes
-- classifications constantly; if the override lived alongside them, "sync
-- erased my decision" would be one careless upsert away. Here there is simply
-- no write path from the sync pipeline to this table.
-- -----------------------------------------------------------------------------

create table classification_overrides (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references user_profiles (id) on delete cascade,
  assignment_id uuid not null references assignments (id) on delete cascade,
  relevance     relevance not null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint overrides_unique_per_assignment unique (user_id, assignment_id),
  -- A manual override exists to make a definite statement. "I am unsure" is
  -- the absence of an override, not a third value.
  constraint overrides_must_be_decisive check (relevance in ('RELEVANT', 'NOT_RELEVANT'))
);

create trigger classification_overrides_touch
  before update on classification_overrides
  for each row execute function app_touch_updated_at();

-- -----------------------------------------------------------------------------
-- Observability
-- -----------------------------------------------------------------------------

create table sync_runs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references user_profiles (id) on delete cascade,
  trigger           sync_trigger not null,
  mode              sync_mode not null,
  status            sync_status not null default 'RUNNING',
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  -- Refreshed while the run works. A run whose heartbeat has expired is
  -- reclaimable, which is what keeps a crashed process from holding the single
  -- active-run slot forever.
  heartbeat_at      timestamptz not null default now(),
  lease_expires_at  timestamptz not null,
  counts            jsonb not null default '{}'::jsonb,
  error_summary     text,

  constraint sync_runs_finished_consistency
    check (status = 'RUNNING' or finished_at is not null)
);

-- One running sync per user, enforced by Postgres rather than by an application
-- flag that can drift from reality. A second concurrent trigger collides here.
create unique index sync_runs_single_active_idx
  on sync_runs (user_id)
  where status = 'RUNNING';

create index sync_runs_user_started_idx
  on sync_runs (user_id, started_at desc);

-- Answers "when did I last have a complete, trustworthy picture?"
create index sync_runs_user_success_idx
  on sync_runs (user_id, finished_at desc)
  where status in ('SUCCESS', 'PARTIAL_SUCCESS');

create table sync_course_results (
  id            uuid primary key default gen_random_uuid(),
  sync_run_id   uuid not null references sync_runs (id) on delete cascade,
  user_id       uuid not null references user_profiles (id) on delete cascade,
  course_id     uuid references courses (id) on delete set null,
  source_course_id text not null,
  course_name   text,
  status        course_sync_status not null,
  completeness  listing_completeness not null,
  counts        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),

  constraint sync_course_results_unique unique (sync_run_id, source_course_id)
);

create index sync_course_results_run_idx on sync_course_results (sync_run_id);

create table sync_errors (
  id               uuid primary key default gen_random_uuid(),
  sync_run_id      uuid not null references sync_runs (id) on delete cascade,
  user_id          uuid not null references user_profiles (id) on delete cascade,
  scope            issue_scope not null,
  code             text not null,
  message          text not null,
  retryable        boolean not null default false,
  source_course_id text,
  source_item_id   text,
  context          jsonb not null default '{}'::jsonb,
  occurred_at      timestamptz not null default now()
);

create index sync_errors_run_idx on sync_errors (sync_run_id, occurred_at);

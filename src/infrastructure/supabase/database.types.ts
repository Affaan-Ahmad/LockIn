/**
 * Hand-written database types.
 *
 * Written by hand rather than generated so that the compiler checks repository
 * code against the migrations from the first commit, before any Supabase
 * project exists to generate from. Keep this file in step with
 * `supabase/migrations/`; a column added there and forgotten here is a type
 * error at the call site, which is the point.
 *
 * Only the tables, columns and functions the repositories actually use appear
 * here.
 */

export type Relevance = 'RELEVANT' | 'NOT_RELEVANT' | 'UNCERTAIN';
export type LifecycleStatusDb = 'ACTIVE' | 'SOURCE_MISSING' | 'SOURCE_REMOVED' | 'ARCHIVED';
export type DuePrecisionDb = 'EXACT' | 'DATE_ONLY' | 'NONE';
export type SourceStateDb = 'PUBLISHED' | 'DRAFT' | 'DELETED' | 'UNSPECIFIED';
export type WorkTypeDb =
  | 'ASSIGNMENT'
  | 'SHORT_ANSWER_QUESTION'
  | 'MULTIPLE_CHOICE_QUESTION'
  | 'MATERIAL'
  | 'UNSPECIFIED';
export type AssigneeModeDb = 'ALL_STUDENTS' | 'INDIVIDUAL_STUDENTS';
export type SubmissionStateDb =
  | 'NEW'
  | 'CREATED'
  | 'TURNED_IN'
  | 'RETURNED'
  | 'RECLAIMED_BY_STUDENT'
  | 'UNSPECIFIED';
export type SyncStatusDb = 'RUNNING' | 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'ABANDONED';
export type SyncModeDb = 'FULL' | 'INCREMENTAL';
export type SyncTriggerDb = 'MANUAL' | 'SCHEDULED' | 'ON_DEMAND';
export type CourseSyncStatusDb = 'SUCCESS' | 'FAILED' | 'SKIPPED';
export type ListingCompletenessDb = 'COMPLETE' | 'PARTIAL' | 'FAILED';
export type GoogleConnectionStatusDb = 'ACTIVE' | 'NEEDS_RECONNECT' | 'REVOKED';
export type AcademicSourceDb = 'GOOGLE_CLASSROOM' | 'MANUAL';
export type AliasSourceDb = 'USER' | 'DERIVED';
export type AliasKindDb = 'BARE' | 'LABELLED' | 'PROGRAM_CODE' | 'BATCH_SECTION' | 'CUSTOM';
export type IssueScopeDb = 'RUN' | 'COURSE' | 'ITEM';
export type SectionScopeTypeDb =
  | 'ALL_SECTIONS'
  | 'ALL_SECTIONS_EXCEPT'
  | 'SPECIFIC_SECTIONS'
  | 'UNCERTAIN';

export type CourseTrackingRow = {
  id: string;
  user_id: string;
  course_id: string;
  is_tracked: boolean;
  selected_at: string;
  updated_at: string;
};

export type DiscoveredCourseRow = {
  course_id: string;
  source_course_id: string;
  name: string;
  section: string | null;
  course_state: string | null;
  is_tracked: boolean;
  decided_at: string | null;
  last_synced_at: string;
  tracked_assignment_count: number;
};

export type UndatedAssignmentRow = {
  assignment_id: string;
  course_id: string;
  course_name: string;
  title: string;
  effective_relevance: Relevance;
  has_manual_override: boolean;
  scope_type: SectionScopeTypeDb;
  submission_state: SubmissionStateDb | null;
  source_created_at: string | null;
  last_synced_at: string;
  alternate_link: string | null;
};

export type CourseRow = {
  id: string;
  user_id: string;
  source: AcademicSourceDb;
  source_course_id: string;
  name: string;
  section: string | null;
  description_heading: string | null;
  room: string | null;
  course_state: string | null;
  alternate_link: string | null;
  source_created_at: string | null;
  source_updated_at: string | null;
  last_synced_at: string;
  coursework_watermark: string | null;
  lifecycle_status: LifecycleStatusDb;
  created_at: string;
  updated_at: string;
};

export type AcademicProfileRow = {
  user_id: string;
  university: string | null;
  program_code: string | null;
  batch: string | null;
  primary_section: string;
  time_zone: string;
  created_at: string;
  updated_at: string;
};

export type SectionAliasRow = {
  id: string;
  user_id: string;
  alias_raw: string;
  alias_key: string;
  kind: AliasKindDb;
  source: AliasSourceDb;
  is_active: boolean;
  created_at: string;
};

export type GoogleConnectionRow = {
  user_id: string;
  google_sub: string;
  google_user_id: string | null;
  granted_scopes: string[];
  /** bytea, surfaced by PostgREST as a `\x`-prefixed hex string. */
  access_token_ct: string | null;
  access_token_expires_at: string | null;
  refresh_token_ct: string | null;
  status: GoogleConnectionStatusDb;
  last_error_code: string | null;
  connected_at: string;
  last_refreshed_at: string | null;
  revoked_at: string | null;
  updated_at: string;
};

export type AssignmentClassificationRow = {
  assignment_id: string;
  user_id: string;
  relevance: Relevance;
  confidence: number;
  decided_by_rule: string | null;
  reason: string;
  evidence: unknown;
  conflicted: boolean;
  ruleset_version: string;
  input_fingerprint: string;
  classified_at: string;
  scope_type: SectionScopeTypeDb;
  scope_sections: string[];
  scope_rule: string | null;
  scope_confidence: number | null;
};

export type ClassificationOverrideRow = {
  id: string;
  user_id: string;
  assignment_id: string;
  relevance: Relevance;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type SyncRunRow = {
  id: string;
  user_id: string;
  trigger: SyncTriggerDb;
  mode: SyncModeDb;
  status: SyncStatusDb;
  started_at: string;
  finished_at: string | null;
  heartbeat_at: string;
  lease_expires_at: string;
  counts: Record<string, number> | null;
  error_summary: string | null;
};

export type SyncCourseResultRow = {
  id: string;
  sync_run_id: string;
  user_id: string;
  course_id: string | null;
  source_course_id: string;
  course_name: string | null;
  status: CourseSyncStatusDb;
  completeness: ListingCompletenessDb;
  counts: Record<string, number> | null;
  created_at: string;
};

export type SyncErrorRow = {
  id: string;
  sync_run_id: string;
  user_id: string;
  scope: IssueScopeDb;
  code: string;
  message: string;
  retryable: boolean;
  source_course_id: string | null;
  source_item_id: string | null;
  context: Record<string, unknown>;
  occurred_at: string;
};

export type AssignmentRow = {
  id: string;
  user_id: string;
  course_id: string;
  source: AcademicSourceDb;
  source_item_id: string;
  title: string;
  description: string | null;
  work_type: WorkTypeDb;
  source_state: SourceStateDb;
  max_points: number | null;
  alternate_link: string | null;
  topic_id: string | null;
  source_topic_id: string | null;
  assignee_mode: AssigneeModeDb | null;
  individual_student_ids: string[] | null;
  due_date_raw: string | null;
  due_time_raw: string | null;
  due_at: string | null;
  due_precision: DuePrecisionDb;
  source_created_at: string | null;
  source_updated_at: string | null;
  lifecycle_status: LifecycleStatusDb;
  missing_streak: number;
  first_missing_at: string | null;
  source_fingerprint: string;
  last_synced_at: string;
  /** Ordering key only. Never render this as a deadline. */
  due_sort_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TopicRow = {
  id: string;
  user_id: string;
  course_id: string;
  source: AcademicSourceDb;
  source_topic_id: string;
  name: string;
  source_updated_at: string | null;
  last_synced_at: string;
};

export type SubmissionRow = {
  id: string;
  user_id: string;
  course_id: string;
  assignment_id: string;
  source: AcademicSourceDb;
  source_submission_id: string;
  state: SubmissionStateDb;
  late: boolean | null;
  assigned_grade: number | null;
  draft_grade: number | null;
  alternate_link: string | null;
  source_created_at: string | null;
  source_updated_at: string | null;
  last_synced_at: string;
  updated_at: string;
};

export type UpcomingAssignmentRow = {
  assignment_id: string;
  course_id: string;
  course_name: string;
  title: string;
  due_date_raw: string | null;
  due_time_raw: string | null;
  due_at: string | null;
  due_precision: DuePrecisionDb;
  due_sort_at: string | null;
  effective_relevance: Relevance;
  confidence: number;
  has_manual_override: boolean;
  scope_type: SectionScopeTypeDb;
  scope_sections: string[];
  submission_state: SubmissionStateDb | null;
  last_synced_at: string;
  alternate_link: string | null;
};

export type UpsertAssignmentResultRow = {
  assignment_id: string;
  source_item_id: string;
  created: boolean;
  changed: boolean;
};

/** Payload shape for app_upsert_assignments. Mirrors the jsonb_to_recordset columns. */
export type AssignmentUpsertPayload = {
  source_item_id: string;
  title: string;
  description: string | null;
  work_type: WorkTypeDb;
  source_state: SourceStateDb;
  max_points: number | null;
  alternate_link: string | null;
  source_topic_id: string | null;
  assignee_mode: AssigneeModeDb | null;
  individual_student_ids: string[] | null;
  due_date_raw: string | null;
  due_time_raw: string | null;
  due_at: string | null;
  due_precision: DuePrecisionDb;
  source_created_at: string | null;
  source_updated_at: string | null;
  source_fingerprint: string;
};

export type SubmissionUpsertPayload = {
  source_submission_id: string;
  source_item_id: string;
  state: SubmissionStateDb;
  late: boolean | null;
  assigned_grade: number | null;
  draft_grade: number | null;
  alternate_link: string | null;
  source_created_at: string | null;
  source_updated_at: string | null;
};

export type CourseUpsertPayload = {
  source_course_id: string;
  name: string;
  section: string | null;
  description_heading: string | null;
  room: string | null;
  course_state: string | null;
  alternate_link: string | null;
  source_created_at: string | null;
  source_updated_at: string | null;
};

export type TopicUpsertPayload = {
  source_topic_id: string;
  name: string;
  source_updated_at: string | null;
};

export type ClassificationUpsertPayload = {
  assignment_id: string;
  relevance: Relevance;
  confidence: number;
  decided_by_rule: string | null;
  reason: string;
  evidence: unknown;
  conflicted: boolean;
  ruleset_version: string;
  input_fingerprint: string;
  scope_type: SectionScopeTypeDb;
  scope_sections: string[];
  scope_rule: string;
  scope_confidence: number;
};

interface TableDef<Row, Insert = Partial<Row>, Update = Partial<Row>> {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
}

export type Database = {
  public: {
    Tables: {
      courses: TableDef<CourseRow>;
      topics: TableDef<TopicRow>;
      assignments: TableDef<AssignmentRow>;
      submissions: TableDef<SubmissionRow>;
      course_tracking: TableDef<CourseTrackingRow>;
      academic_profiles: TableDef<AcademicProfileRow>;
      section_aliases: TableDef<SectionAliasRow>;
      google_connections: TableDef<GoogleConnectionRow>;
      assignment_classifications: TableDef<AssignmentClassificationRow>;
      classification_overrides: TableDef<ClassificationOverrideRow>;
      sync_runs: TableDef<SyncRunRow>;
      sync_course_results: TableDef<SyncCourseResultRow>;
      sync_errors: TableDef<SyncErrorRow>;
    };
    Views: Record<never, never>;
    Functions: {
      app_acquire_sync_run: {
        Args: {
          p_user_id: string;
          p_trigger: SyncTriggerDb;
          p_mode: SyncModeDb;
          p_lease_ttl_seconds: number;
        };
        Returns: SyncRunRow[];
      };
      app_heartbeat_sync_run: {
        Args: { p_sync_run_id: string; p_lease_ttl_seconds: number };
        Returns: undefined;
      };
      app_finalize_sync_run: {
        Args: {
          p_sync_run_id: string;
          p_status: SyncStatusDb;
          p_counts: Record<string, number>;
          p_error_summary: string | null;
        };
        Returns: undefined;
      };
      app_upsert_courses: {
        Args: { p_user_id: string; p_items: CourseUpsertPayload[]; p_synced_at: string };
        Returns: CourseRow[];
      };
      app_upsert_topics: {
        Args: {
          p_user_id: string;
          p_course_id: string;
          p_items: TopicUpsertPayload[];
          p_synced_at: string;
        };
        Returns: number;
      };
      app_upsert_assignments: {
        Args: {
          p_user_id: string;
          p_course_id: string;
          p_items: AssignmentUpsertPayload[];
          p_synced_at: string;
        };
        Returns: UpsertAssignmentResultRow[];
      };
      app_upsert_submissions: {
        Args: {
          p_user_id: string;
          p_course_id: string;
          p_items: SubmissionUpsertPayload[];
          p_synced_at: string;
        };
        Returns: number;
      };
      app_reconcile_missing_assignments: {
        Args: {
          p_user_id: string;
          p_course_id: string;
          p_seen_item_ids: string[];
          p_at: string;
          p_threshold: number;
        };
        Returns: number;
      };
      app_upsert_classifications: {
        Args: { p_user_id: string; p_rows: ClassificationUpsertPayload[] };
        Returns: number;
      };
      app_list_discovered_courses: {
        Args: { p_user_id: string };
        Returns: DiscoveredCourseRow[];
      };
      app_set_course_tracking: {
        Args: { p_user_id: string; p_items: { course_id: string; is_tracked: boolean }[] };
        Returns: number;
      };
      app_undated_assignments: {
        Args: { p_user_id: string; p_relevance: Relevance[]; p_limit: number };
        Returns: UndatedAssignmentRow[];
      };
      app_upcoming_assignments: {
        Args: {
          p_user_id: string;
          p_to: string | null;
          p_relevance: Relevance[];
          p_include_submitted: boolean;
          p_limit: number;
        };
        Returns: UpcomingAssignmentRow[];
      };
      app_overdue_assignments: {
        Args: {
          p_user_id: string;
          p_since: string | null;
          p_relevance: Relevance[];
          p_include_submitted: boolean;
          p_limit: number;
        };
        Returns: UpcomingAssignmentRow[];
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

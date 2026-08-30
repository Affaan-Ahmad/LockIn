import 'server-only';

import type { CourseRepository, StoredCourse } from '@/application/ports/repositories';
import type {
  AcademicSourceId,
  CourseSourceRecord,
  TopicSourceRecord,
} from '@/domain/assignment/types';
import { PersistenceError } from '@/shared/errors';

import type { AppSupabaseClient } from '../clients';
import type { CourseRow, CourseUpsertPayload, TopicUpsertPayload } from '../database.types';
import { toDbTimestamp, translatePostgrestError } from './shared';

export class SupabaseCourseRepository implements CourseRepository {
  constructor(private readonly db: AppSupabaseClient) {}

  /**
   * One round trip for all of a student's courses.
   *
   * The RPC is a single INSERT ... ON CONFLICT over a jsonb payload, so ten
   * courses cost one statement rather than ten. It also deliberately leaves
   * `coursework_watermark` alone: that column is our incremental cursor, and a
   * course metadata refresh must not reset it and force a full re-read.
   */
  async upsertMany(
    userId: string,
    source: AcademicSourceId,
    records: readonly CourseSourceRecord[],
    syncedAt: Date,
  ): Promise<readonly StoredCourse[]> {
    if (source !== 'GOOGLE_CLASSROOM') {
      throw new PersistenceError(`Course upsert is not implemented for source ${source}`);
    }
    if (records.length === 0) return [];

    const payload: CourseUpsertPayload[] = records.map((record) => ({
      source_course_id: record.sourceCourseId,
      name: record.name,
      section: record.section,
      description_heading: record.descriptionHeading,
      room: record.room,
      course_state: record.courseState,
      alternate_link: record.alternateLink,
      source_created_at: toDbTimestamp(record.sourceCreatedAt),
      source_updated_at: toDbTimestamp(record.sourceUpdatedAt),
    }));

    const { data, error } = await this.db.rpc('app_upsert_courses', {
      p_user_id: userId,
      p_items: payload,
      p_synced_at: syncedAt.toISOString(),
    });

    if (error !== null) throw translatePostgrestError(error, 'courses.upsertMany');
    return (data ?? []).map(toStoredCourse);
  }

  async listForUser(
    userId: string,
    source: AcademicSourceId,
  ): Promise<readonly StoredCourse[]> {
    const { data, error } = await this.db
      .from('courses')
      // Explicit column list: `select('*')` would drag description and room
      // across the wire on a path that only needs identity and the watermark.
      .select(
        'id, user_id, source, source_course_id, name, section, coursework_watermark, lifecycle_status',
      )
      .eq('user_id', userId)
      .eq('source', source)
      .neq('lifecycle_status', 'SOURCE_REMOVED');

    if (error !== null) throw translatePostgrestError(error, 'courses.listForUser');

    return (data ?? []).map((row) => ({
      id: row.id,
      sourceCourseId: row.source_course_id,
      name: row.name,
      section: row.section,
      courseworkWatermark:
        row.coursework_watermark === null ? null : new Date(row.coursework_watermark),
      lifecycleStatus: row.lifecycle_status,
    }));
  }

  async setCourseworkWatermark(
    userId: string,
    courseId: string,
    watermark: Date | null,
  ): Promise<void> {
    const { error } = await this.db
      .from('courses')
      .update({ coursework_watermark: toDbTimestamp(watermark) })
      .eq('id', courseId)
      .eq('user_id', userId);

    if (error !== null) throw translatePostgrestError(error, 'courses.setCourseworkWatermark');
  }

  async upsertTopics(
    userId: string,
    courseId: string,
    topics: readonly TopicSourceRecord[],
    syncedAt: Date,
  ): Promise<void> {
    if (topics.length === 0) return;

    const payload: TopicUpsertPayload[] = topics.map((topic) => ({
      source_topic_id: topic.sourceTopicId,
      name: topic.name,
      source_updated_at: toDbTimestamp(topic.sourceUpdatedAt),
    }));

    const { error } = await this.db.rpc('app_upsert_topics', {
      p_user_id: userId,
      p_course_id: courseId,
      p_items: payload,
      p_synced_at: syncedAt.toISOString(),
    });

    if (error !== null) throw translatePostgrestError(error, 'courses.upsertTopics');
  }
}

function toStoredCourse(row: CourseRow): StoredCourse {
  return {
    id: row.id,
    sourceCourseId: row.source_course_id,
    name: row.name,
    section: row.section,
    courseworkWatermark:
      row.coursework_watermark === null ? null : new Date(row.coursework_watermark),
    lifecycleStatus: row.lifecycle_status,
  };
}

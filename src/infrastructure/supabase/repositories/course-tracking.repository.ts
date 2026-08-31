import 'server-only';

import type { CourseTrackingRepository } from '@/application/ports/repositories';
import type { DiscoveredCourse, TrackingDecision } from '@/domain/course/tracking';

import type { AppSupabaseClient } from '../clients';
import { translatePostgrestError } from './shared';

/**
 * Persistence for the student's subject selection.
 *
 * Note what is absent: any method the sync pipeline could use to change a
 * decision. `setTracking` exists for the explicit user action and nothing else,
 * which is what makes "my selection survives a sync" a structural property
 * rather than a convention -- the same reasoning as classification overrides.
 */
export class SupabaseCourseTrackingRepository implements CourseTrackingRepository {
  constructor(private readonly db: AppSupabaseClient) {}

  /**
   * Every discovered course with its decision, in one call.
   *
   * Deliberately does not filter by tracking: this feeds the screen whose job
   * is to show the untracked courses so they can be turned on.
   */
  async listDiscovered(userId: string): Promise<readonly DiscoveredCourse[]> {
    const { data, error } = await this.db.rpc('app_list_discovered_courses', {
      p_user_id: userId,
    });

    if (error !== null) throw translatePostgrestError(error, 'courseTracking.listDiscovered');

    return (data ?? []).map((row) => ({
      courseId: row.course_id,
      sourceCourseId: row.source_course_id,
      name: row.name,
      section: row.section,
      courseState: row.course_state,
      decision: row.is_tracked ? 'TRACKED' : 'NOT_TRACKED',
      // Null means the student has not chosen yet, which is a different state
      // from having chosen "no" and must stay distinguishable.
      decidedAt: row.decided_at === null ? null : new Date(row.decided_at),
      lastSyncedAt: new Date(row.last_synced_at),
    }));
  }

  /**
   * The filter the sync pipeline applies before spending any API call.
   *
   * Returned as a Set because the caller tests membership once per course; a
   * list would turn that into a scan per course.
   */
  async listTrackedCourseIds(userId: string): Promise<ReadonlySet<string>> {
    const { data, error } = await this.db
      .from('course_tracking')
      .select('course_id')
      .eq('user_id', userId)
      .eq('is_tracked', true);

    if (error !== null) throw translatePostgrestError(error, 'courseTracking.listTracked');
    return new Set((data ?? []).map((row) => row.course_id));
  }

  async setTracking(
    userId: string,
    decisions: readonly { courseId: string; decision: TrackingDecision }[],
    ): Promise<number> {
    if (decisions.length === 0) return 0;

    const { data, error } = await this.db.rpc('app_set_course_tracking', {
      p_user_id: userId,
      p_items: decisions.map((entry) => ({
        course_id: entry.courseId,
        is_tracked: entry.decision === 'TRACKED',
      })),
    });

    if (error !== null) throw translatePostgrestError(error, 'courseTracking.setTracking');
    return data ?? 0;
  }
}

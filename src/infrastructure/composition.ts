import 'server-only';

import { ClassroomSyncService } from '@/application/services/classroom-sync.service';
import { CourseDiscoveryService } from '@/application/services/course-discovery.service';
import { GoogleTokenService } from '@/application/services/google-token.service';
import { getServerEnv } from '@/config/env';
import { createRelevanceClassifier } from '@/domain/classification/registry';
import { GoogleClassroomSource } from '@/infrastructure/google/classroom.source';
import { GoogleOAuthHttpClient } from '@/infrastructure/google/oauth';
import {
  createServiceRoleClient,
  createUserScopedClient,
  type AppSupabaseClient,
} from '@/infrastructure/supabase/clients';
import { SupabaseAssignmentRepository } from '@/infrastructure/supabase/repositories/assignment.repository';
import {
  SupabaseClassificationRepository,
  SupabaseOverrideRepository,
  SupabaseSubmissionRepository,
} from '@/infrastructure/supabase/repositories/classification.repository';
import { SupabaseCourseRepository } from '@/infrastructure/supabase/repositories/course.repository';
import { SupabaseCourseTrackingRepository } from '@/infrastructure/supabase/repositories/course-tracking.repository';
import { SupabaseGoogleConnectionRepository } from '@/infrastructure/supabase/repositories/google-connection.repository';
import {
  SupabaseAcademicProfileRepository,
  SupabaseSyncRunRepository,
} from '@/infrastructure/supabase/repositories/sync-run.repository';
import { systemClock } from '@/shared/clock';
import { createLogger, type Logger } from '@/shared/logger';

/**
 * Composition root.
 *
 * Wiring lives here and only here. Nothing below this file constructs its own
 * dependencies, which is what keeps the services testable: every one of them
 * takes its collaborators as constructor arguments and can be handed fakes.
 *
 * Note which client each repository receives. The sync pipeline gets a
 * user-scoped client, so row-level security applies to every statement it runs
 * -- a bug in a repository filter is caught by a policy rather than becoming a
 * data leak. Only the Google connection repository gets the service role, and
 * only because its table denies every other role by design.
 */

export function createRootLogger(): Logger {
  const env = getServerEnv();
  return createLogger({ level: env.LOG_LEVEL, base: { service: 'lockin' } });
}

export function createGoogleTokenService(logger: Logger): GoogleTokenService {
  const env = getServerEnv();

  const connections = new SupabaseGoogleConnectionRepository(
    createServiceRoleClient(),
    env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    logger,
  );

  const oauth = new GoogleOAuthHttpClient({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    logger,
  });

  return new GoogleTokenService({ connections, oauth, logger, clock: systemClock });
}

export function createGoogleConnectionRepository(
  logger: Logger,
): SupabaseGoogleConnectionRepository {
  const env = getServerEnv();
  return new SupabaseGoogleConnectionRepository(
    createServiceRoleClient(),
    env.GOOGLE_TOKEN_ENCRYPTION_KEY,
    logger,
  );
}

export interface BackendContext {
  readonly db: AppSupabaseClient;
  readonly logger: Logger;
  readonly sync: ClassroomSyncService;
  readonly discovery: CourseDiscoveryService;
  readonly assignments: SupabaseAssignmentRepository;
  readonly overrides: SupabaseOverrideRepository;
  readonly syncRuns: SupabaseSyncRunRepository;
  readonly connections: SupabaseGoogleConnectionRepository;
}

/**
 * Builds everything a request handler needs.
 *
 * Constructed per request rather than as a module-level singleton: the
 * user-scoped Supabase client carries that request's session, and sharing one
 * across requests would let one user's queries run with another user's
 * credentials.
 */
export async function createBackendContext(): Promise<BackendContext> {
  const env = getServerEnv();
  const logger = createRootLogger();
  const db = await createUserScopedClient();

  const tokens = createGoogleTokenService(logger);

  const source = new GoogleClassroomSource({
    credentials: tokens,
    logger,
    maxRetryAttempts: env.GOOGLE_MAX_RETRY_ATTEMPTS,
    requestTimeoutMs: env.GOOGLE_REQUEST_TIMEOUT_MS,
  });

  const courses = new SupabaseCourseRepository(db);
  const assignments = new SupabaseAssignmentRepository(db);
  const submissions = new SupabaseSubmissionRepository(db);
  const classifications = new SupabaseClassificationRepository(db);
  const overrides = new SupabaseOverrideRepository(db);
  const profiles = new SupabaseAcademicProfileRepository(db);
  const tracking = new SupabaseCourseTrackingRepository(db);
  const syncRuns = new SupabaseSyncRunRepository(db, env.SYNC_LEASE_TTL_SECONDS);
  const connections = createGoogleConnectionRepository(logger);

  const discovery = new CourseDiscoveryService({
    source,
    courses,
    tracking,
    logger,
    clock: systemClock,
  });

  const sync = new ClassroomSyncService({
    source,
    courses,
    assignments,
    submissions,
    classifications,
    tracking,
    discovery,
    profiles,
    syncRuns,
    classifier: createRelevanceClassifier(),
    logger,
    clock: systemClock,
    config: {
      courseConcurrency: env.SYNC_COURSE_CONCURRENCY,
      leaseTtlSeconds: env.SYNC_LEASE_TTL_SECONDS,
    },
  });

  return { db, logger, sync, discovery, assignments, overrides, syncRuns, connections };
}

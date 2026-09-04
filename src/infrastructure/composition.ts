import 'server-only';

import { ClassroomSyncService } from '@/application/services/classroom-sync.service';
import { AccountService } from '@/application/services/account.service';
import { CourseDiscoveryService } from '@/application/services/course-discovery.service';
import { GoogleTokenService } from '@/application/services/google-token.service';
import { SyncWorker, type ContinuationTrigger } from '@/application/services/sync-worker';
import { getServerEnv } from '@/config/env';
import { deriveWorkerSecret, PLATFORM_MAX_DURATION_SECONDS } from '@/config/sync-runtime';
import { deriveBudget } from '@/domain/sync/deadline';
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
import { SupabaseRateLimiter } from '@/infrastructure/supabase/repositories/rate-limit.repository';
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
  readonly worker: SyncWorker;
  readonly discovery: CourseDiscoveryService;
  readonly account: AccountService;
  readonly profiles: SupabaseAcademicProfileRepository;
  readonly tokens: GoogleTokenService;
  readonly rateLimiter: SupabaseRateLimiter;
  readonly limits: {
    readonly sync: { readonly limit: number; readonly windowSeconds: number };
    readonly discovery: { readonly limit: number; readonly windowSeconds: number };
  };
  readonly assignments: SupabaseAssignmentRepository;
  readonly overrides: SupabaseOverrideRepository;
  readonly syncRuns: SupabaseSyncRunRepository;
  readonly connections: SupabaseGoogleConnectionRepository;
}

/**
 * Asks the deployment for another invocation to continue a run.
 *
 * Authenticated with a secret derived from the service-role key rather than a
 * new environment variable, so there is nothing extra to configure and nothing
 * extra to leak. The request is not awaited to completion -- only to acceptance
 * -- because the successor's whole job is to outlive this one.
 */
function createContinuationTrigger(logger: Logger): ContinuationTrigger {
  const env = getServerEnv();
  const secret = deriveWorkerSecret(env.SUPABASE_SERVICE_ROLE_KEY);
  const url = new URL('/api/sync/continue', env.NEXT_PUBLIC_SITE_URL).toString();

  return {
    async request(userId: string, syncRunId: string): Promise<boolean> {
      const controller = new AbortController();
      // Just long enough to hand the work over. The successor runs for minutes;
      // waiting for it here would recreate the very coupling this removes.
      const timer = setTimeout(() => controller.abort(), 5_000);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-sync-worker-token': secret,
          },
          body: JSON.stringify({ userId, syncRunId }),
          signal: controller.signal,
        });
        return response.ok;
      } catch (cause) {
        // A failed handover is not a failed sync. The run is QUEUED with its
        // progress durable, and the next trigger picks it up.
        logger.warn('continuation could not be requested', {
          stage: 'continuation',
          syncRunId,
          errorCode: cause instanceof Error ? cause.name : 'UNKNOWN',
        });
        return false;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * Everything a request handler needs, wired against one Supabase client.
 *
 * Split from the entry points below so the user-scoped and worker contexts
 * cannot drift apart. Which client arrives is the only difference between them,
 * and it is a deliberate one -- see `createWorkerContext`.
 */
function buildContext(db: AppSupabaseClient, logger: Logger): BackendContext {
  const env = getServerEnv();

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
  const syncRuns = new SupabaseSyncRunRepository(db);
  const connections = createGoogleConnectionRepository(logger);
  const rateLimiter = new SupabaseRateLimiter(db, logger);

  const account = new AccountService({
    google: tokens,
    logger,
    authUsers: {
      deleteUser: async (id: string) => {
        const admin = createServiceRoleClient() as unknown as {
          auth: { admin: { deleteUser: (userId: string) => Promise<{ error: unknown }> } };
        };
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error !== null && error !== undefined) {
          throw new Error(`auth user deletion failed: ${JSON.stringify(error)}`);
        }
      },
    },
    });

  const discovery = new CourseDiscoveryService({
    source,
    courses,
    tracking,
    logger,
    clock: systemClock,
    });

  // The worker's budget comes from the platform ceiling, not a hardcoded
  // number, so lowering maxDuration or losing fluid compute changes how much
  // work one invocation attempts rather than how it fails.
  const { budgetMs, reserveMs } = deriveBudget(PLATFORM_MAX_DURATION_SECONDS * 1000);

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
      leaseTtlSeconds: env.SYNC_LEASE_TTL_SECONDS,
      invocationBudgetMs: budgetMs,
      checkoutReserveMs: reserveMs,
      initialUnitEstimateMs: env.SYNC_UNIT_ESTIMATE_MS,
      maxCourseAttempts: env.SYNC_MAX_COURSE_ATTEMPTS,
    },
    });

  const worker = new SyncWorker({
    sync,
    continuation: createContinuationTrigger(logger),
    logger,
    });

  return {
    db,
    logger,
    sync,
    worker,
    discovery,
    account,
    profiles,
    tokens,
    rateLimiter,
    assignments,
    overrides,
    syncRuns,
    connections,
    limits: {
      sync: { limit: env.SYNC_RATE_LIMIT, windowSeconds: env.SYNC_RATE_WINDOW_SECONDS },
      discovery: {
        limit: env.DISCOVERY_RATE_LIMIT,
        windowSeconds: env.DISCOVERY_RATE_WINDOW_SECONDS,
      },
    },
    };
}

/**
 * Builds everything a request handler needs, scoped to the signed-in user.
 *
 * Constructed per request rather than as a module-level singleton: the
 * user-scoped Supabase client carries that request's session, and sharing one
 * across requests would let one user's queries run with another user's
 * credentials.
 */
export async function createBackendContext(): Promise<BackendContext> {
  return buildContext(await createUserScopedClient(), createRootLogger());
}

/**
 * The context a background worker runs in.
 *
 * Uses the service role, and that is a deliberate, uncomfortable trade. A
 * continuation is the server calling itself: there is no cookie, so there is no
 * user JWT, so row-level security has no identity to enforce. The alternatives
 * were worse -- keeping a user's session alive in a background job means storing
 * a JWT we would then have to protect and refresh, and driving continuation from
 * the browser strands the sync the moment a tab closes.
 *
 * What holds the boundary instead:
 *
 *   Every repository method already takes an explicit user id and filters on
 *   it. RLS was defence in depth here, never the only filter.
 *
 *   The continuation endpoint accepts a user id only alongside a secret derived
 *   from the service-role key, and it acts solely on that user's own resumable
 *   run. It cannot be pointed at an arbitrary account by an outside caller.
 *
 *   The lease is scoped to one run, and every write is fenced by its owner
 *   token, so even a confused worker cannot touch a run it does not hold.
 */
export function createWorkerContext(): BackendContext {
  return buildContext(createServiceRoleClient(), createRootLogger().child({ component: 'worker' }));
}

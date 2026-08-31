import 'server-only';

import type { z } from 'zod';

import type { Logger } from '@/shared/logger';
import {
  AuthorizationExpiredError,
  ExternalValidationError,
  GoogleApiDisabledError,
  GoogleApiError,
  isAppError,
  RateLimitError,
} from '@/shared/errors';
import { withRetry } from '@/shared/retry';

import {
  googleCourseListSchema,
  googleCourseWorkListSchema,
  googleErrorSchema,
  googleStudentSubmissionListSchema,
  googleTopicListSchema,
  type GoogleCourse,
  type GoogleCourseWork,
  type GoogleStudentSubmission,
  type GoogleTopic,
} from './classroom.schemas';

/**
 * Server-only Google Classroom client.
 *
 * This is the only place in the codebase that knows Classroom exists as an HTTP
 * API. It owns pagination, retry policy, error translation and response
 * validation; nothing above it sees a status code, a page token, or a raw JSON
 * body.
 *
 * Uses fetch directly rather than the googleapis SDK. The SDK would add a large
 * dependency, its own retry behaviour we would have to disable, and its own
 * types leaking into call sites -- for four read-only endpoints whose shapes we
 * are validating ourselves regardless.
 */

const CLASSROOM_BASE = 'https://classroom.googleapis.com/v1';

/** Classroom caps page size at 100 for these collections; asking for more is ignored. */
const MAX_PAGE_SIZE = 100;

/**
 * Hard ceiling on pages per collection. Without it, a pagination bug on either
 * side turns into an unbounded request loop against a quota-limited API.
 */
const MAX_PAGES = 100;

export interface GoogleClassroomClientOptions {
  readonly accessToken: string;
  readonly logger: Logger;
  readonly maxRetryAttempts: number;
  readonly requestTimeoutMs: number;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface PagedResult<T> {
  readonly items: readonly T[];
  /** False when the page ceiling stopped us before the API ran out of pages. */
  readonly exhausted: boolean;
  readonly pagesFetched: number;
}

export interface ListCourseWorkOptions {
  /**
   * Stop paging once items older than this are reached.
   *
   * Safe only because Classroom orders courseWork by updateTime descending by
   * default and we request that ordering explicitly. The caller is told via
   * `exhausted: false` that it received a prefix, and must treat the listing as
   * PARTIAL -- an incremental pass must never drive deletion.
   */
  readonly updatedSince: Date | null;
}

export class GoogleClassroomClient {
  private readonly accessToken: string;
  private readonly logger: Logger;
  private readonly maxRetryAttempts: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly signal: AbortSignal | undefined;

  constructor(options: GoogleClassroomClientOptions) {
    this.accessToken = options.accessToken;
    this.logger = options.logger;
    this.maxRetryAttempts = options.maxRetryAttempts;
    this.requestTimeoutMs = options.requestTimeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.signal = options.signal;
  }

  /** Courses the signed-in user is enrolled in as a student. */
  async listCourses(): Promise<PagedResult<GoogleCourse>> {
    return this.paginate({
      path: '/courses',
      query: { studentId: 'me', courseStates: 'ACTIVE' },
      schema: googleCourseListSchema,
      select: (page) => page.courses ?? [],
      nextToken: (page) => page.nextPageToken,
      operation: 'classroom.courses.list',
    });
  }

  async listCourseWork(
    courseId: string,
    options: ListCourseWorkOptions = { updatedSince: null },
    ): Promise<PagedResult<GoogleCourseWork>> {
    const cutoff = options.updatedSince?.getTime() ?? null;

    return this.paginate({
      path: `/courses/${encodeURIComponent(courseId)}/courseWork`,
      // Explicit rather than relying on the documented default: if the default
      // ever changes, early-stop below would silently start truncating.
      query: { orderBy: 'updateTime desc' },
      schema: googleCourseWorkListSchema,
      select: (page) => page.courseWork ?? [],
      nextToken: (page) => page.nextPageToken,
      operation: 'classroom.courseWork.list',
      stopWhen:
        cutoff === null
          ? undefined
          : (items) =>
              items.some((item) => {
                const updated = item.updateTime === undefined ? null : Date.parse(item.updateTime);
                return updated !== null && !Number.isNaN(updated) && updated <= cutoff;
              }),
    });
  }

  /**
   * Every submission the student has in a course, in one paginated call.
   *
   * The literal "-" for courseWorkId is what makes this possible. Fetching
   * submissions per coursework item instead would be an N+1 against a
   * rate-limited API: five hundred requests where one paginated sweep suffices.
   */
  async listStudentSubmissions(courseId: string): Promise<PagedResult<GoogleStudentSubmission>> {
    return this.paginate({
      path: `/courses/${encodeURIComponent(courseId)}/courseWork/-/studentSubmissions`,
      query: { userId: 'me' },
      schema: googleStudentSubmissionListSchema,
      select: (page) => page.studentSubmissions ?? [],
      nextToken: (page) => page.nextPageToken,
      operation: 'classroom.studentSubmissions.list',
    });
  }

  async listTopics(courseId: string): Promise<PagedResult<GoogleTopic>> {
    return this.paginate({
      path: `/courses/${encodeURIComponent(courseId)}/topics`,
      query: {},
      schema: googleTopicListSchema,
      select: (page) => page.topic ?? [],
      nextToken: (page) => page.nextPageToken,
      operation: 'classroom.topics.list',
    });
  }

  // ---------------------------------------------------------------------------

  private async paginate<TPage, TItem>(config: {
    path: string;
    query: Record<string, string>;
    schema: z.ZodType<TPage, z.ZodTypeDef, unknown>;
    select: (page: TPage) => readonly TItem[];
    nextToken: (page: TPage) => string | undefined;
    operation: string;
    stopWhen?: ((items: readonly TItem[]) => boolean) | undefined;
  }): Promise<PagedResult<TItem>> {
    const items: TItem[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    for (;;) {
      const page = await this.requestJson(config.path, config.schema, {
        ...config.query,
        pageSize: String(MAX_PAGE_SIZE),
        ...(pageToken === undefined ? {} : { pageToken }),
      }, config.operation);

      pages += 1;
      const pageItems = config.select(page);
      items.push(...pageItems);

      if (config.stopWhen?.(pageItems) === true) {
        // Deliberately not exhausted: the caller must know it has a prefix.
        return { items, exhausted: false, pagesFetched: pages };
      }

      const next = config.nextToken(page);
      if (next === undefined || next === '') {
        return { items, exhausted: true, pagesFetched: pages };
      }

      if (pages >= MAX_PAGES) {
        this.logger.warn('page ceiling reached; treating listing as incomplete', {
          operation: config.operation,
          pages,
        });
        return { items, exhausted: false, pagesFetched: pages };
      }

      pageToken = next;
    }
  }

  private async requestJson<T>(
    path: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    query: Record<string, string>,
    operation: string,
    ): Promise<T> {
    const url = new URL(`${CLASSROOM_BASE}${path}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);

    const body = await withRetry(
      async () => this.executeRequest(url, operation),
      {
        maxAttempts: this.maxRetryAttempts,
        logger: this.logger,
        operation,
      },
    );

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      // The request succeeded but the payload is not what we validated against.
      // Not retryable: the same call returns the same body.
      throw new ExternalValidationError(
        `Google Classroom returned an unexpected payload for ${operation}`,
        {
          cause: parsed.error,
          context: { operation, issues: parsed.error.issues.length },
        },
      );
    }

    return parsed.data;
  }

  private async executeRequest(url: URL, operation: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    const onOuterAbort = (): void => controller.abort();
    this.signal?.addEventListener('abort', onOuterAbort, { once: true });

    try {
      const response = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: {
          // Never logged: the logger redacts any field whose key contains
          // "authorization", and this header is not put into a log field at all.
          Authorization: `Bearer ${this.accessToken}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      const text = await response.text();

      if (!response.ok) {
        throw translateHttpError(response, text, operation);
      }

      try {
        return JSON.parse(text) as unknown;
      } catch (cause) {
        throw new ExternalValidationError(`Google returned non-JSON for ${operation}`, {
          cause,
          context: { operation, status: response.status },
        });
      }
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') {
        // A timeout is worth one more attempt; a genuine cancellation is not,
        // but the outer signal being aborted means the run is ending anyway.
        throw new GoogleApiError(`Request to ${operation} timed out or was aborted`, {
          retryable: this.signal?.aborted !== true,
          cause: caught,
          context: { operation },
        });
      }
      // Anything already in our taxonomy came from translateHttpError or the
      // JSON parse below and is deliberate -- pass it through untouched.
      //
      // This deliberately tests the base class rather than listing subclasses.
      // The list version silently mislabelled every newly added error type as a
      // network failure, which is how a disabled-API 403 first surfaced as
      // "Network failure calling classroom.courses.list".
      if (isAppError(caught)) throw caught;
      // Network-level failure: DNS, TLS, socket reset. Safe to retry a GET.
      throw new GoogleApiError(`Network failure calling ${operation}`, {
        retryable: true,
        cause: caught,
        context: { operation },
      });
    } finally {
      clearTimeout(timeout);
      this.signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}

/**
 * Maps HTTP status onto the error taxonomy, and in particular onto the
 * retryable flag.
 *
 * The distinction that matters most: 401 and 403 are never retried. Repeatedly
 * hammering Google with a revoked credential is how an OAuth client gets
 * throttled or flagged, and no number of retries will produce consent.
 */
function translateHttpError(response: Response, body: string, operation: string): Error {
  const status = response.status;
  const detail = extractGoogleErrorMessage(body) ?? response.statusText;
  const context = { operation, status } as const;

  if (status === 401) {
    return new AuthorizationExpiredError(
      `Google rejected our credentials for ${operation}: ${detail}`,
      { context },
    );
  }

  if (status === 403) {
    // 403 is overloaded three ways: the API is switched off, quota is exhausted,
    // or permission is genuinely missing. They need completely different fixes,
    // so read the reason rather than guessing.
    if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(body)) {
      return new GoogleApiDisabledError(
        `The Google Classroom API is not enabled on the Cloud project. Enable it in Cloud Console, wait a minute for it to propagate, then retry. (${operation})`,
        { context },
      );
    }
    const quotaRelated = /quota|rate limit|userRateLimitExceeded|rateLimitExceeded/i.test(body);
    if (quotaRelated) {
      return new RateLimitError(`Google quota exceeded during ${operation}: ${detail}`, {
        retryAfterMs: parseRetryAfter(response),
        context,
      });
    }
    return new AuthorizationExpiredError(
      `Google denied access for ${operation}: ${detail}. The granted scopes may be insufficient.`,
      { context },
    );
  }

  if (status === 429) {
    return new RateLimitError(`Google rate limited ${operation}`, {
      retryAfterMs: parseRetryAfter(response),
      context,
    });
  }

  if (status >= 500) {
    return new GoogleApiError(`Google server error during ${operation}: ${detail}`, {
      status,
      retryable: true,
      context,
    });
  }

  return new GoogleApiError(`Google rejected ${operation}: ${detail}`, {
    status,
    retryable: false,
    context,
    });
}

function parseRetryAfter(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (header === null) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);

  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, Math.min(date - Date.now(), 60_000));

  return null;
}

function extractGoogleErrorMessage(body: string): string | null {
  try {
    const parsed = googleErrorSchema.safeParse(JSON.parse(body));
    if (!parsed.success) return null;
    return parsed.data.error.message ?? parsed.data.error.status ?? null;
  } catch {
    return null;
  }
}

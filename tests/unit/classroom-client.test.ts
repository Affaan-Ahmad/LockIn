import { describe, expect, it, vi } from 'vitest';

import { GoogleClassroomClient } from '@/infrastructure/google/classroom.client';
import { silentLogger } from '@/shared/logger';

/**
 * Client behaviour that the sync depends on and cannot verify for itself:
 * pagination that actually follows tokens, early stop that reports itself as a
 * prefix, and an error taxonomy that decides correctly what may be retried.
 */

/** Reads the target URL without stringifying a Request object. */
function urlOf(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input);
  return new URL(input.url);
}

interface FakeResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

function fakeFetch(responses: readonly FakeResponse[]): {
  fetchImpl: typeof fetch;
  calls: URL[];
} {
  const calls: URL[] = [];
  let index = 0;

  const fetchImpl: typeof fetch = (input) => {
    calls.push(urlOf(input));
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (response === undefined) throw new Error('no response configured');

    return Promise.resolve(
      new Response(
        typeof response.body === 'string' ? response.body : JSON.stringify(response.body),
        { status: response.status, headers: response.headers ?? {} },
      ),
    );
  };

  return { fetchImpl, calls };
}

function makeClient(fetchImpl: typeof fetch, maxRetryAttempts = 1): GoogleClassroomClient {
  return new GoogleClassroomClient({
    accessToken: 'test-token',
    logger: silentLogger,
    maxRetryAttempts,
    requestTimeoutMs: 5_000,
    fetchImpl,
  });
}

describe('pagination', () => {
  it('follows nextPageToken until the API runs out', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { courses: [{ id: 'c1', name: 'A' }], nextPageToken: 'p2' } },
      { status: 200, body: { courses: [{ id: 'c2', name: 'B' }], nextPageToken: 'p3' } },
      { status: 200, body: { courses: [{ id: 'c3', name: 'C' }] } },
    ]);

    const result = await makeClient(fetchImpl).listCourses();

    // Assuming the first page is everything is the classic Classroom bug: a
    // student with more than a page of courses silently loses the rest.
    expect(result.items.map((course) => course.id)).toEqual(['c1', 'c2', 'c3']);
    expect(result.exhausted).toBe(true);
    expect(result.pagesFetched).toBe(3);
    expect(calls[1]?.searchParams.get('pageToken')).toBe('p2');
    expect(calls[2]?.searchParams.get('pageToken')).toBe('p3');
  });

  it('requests an explicit ordering for coursework', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { courseWork: [] } }]);
    await makeClient(fetchImpl).listCourseWork('c1');

    // Early stop is only sound because of this ordering; relying on the
    // documented default would break silently if the default ever changed.
    expect(calls[0]?.searchParams.get('orderBy')).toBe('updateTime desc');
  });

  it('lists every submission in a course through the "-" coursework id', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 200, body: { studentSubmissions: [] } }]);
    await makeClient(fetchImpl).listStudentSubmissions('c1');

    // One paginated sweep instead of one request per coursework item.
    expect(calls[0]?.pathname).toContain('/courseWork/-/studentSubmissions');
    expect(calls[0]?.searchParams.get('userId')).toBe('me');
  });
});

describe('incremental early stop', () => {
  const item = (id: string, updateTime: string) => ({
    id,
    courseId: 'c1',
    title: id,
    updateTime,
  });

  it('stops paging once it crosses the watermark and reports a prefix', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        status: 200,
        body: {
          courseWork: [item('w1', '2026-03-10T00:00:00Z'), item('w2', '2026-02-01T00:00:00Z')],
          nextPageToken: 'p2',
        },
      },
      { status: 200, body: { courseWork: [item('w3', '2026-01-01T00:00:00Z')] } },
    ]);

    const result = await makeClient(fetchImpl).listCourseWork('c1', {
      updatedSince: new Date('2026-03-01T00:00:00Z'),
    });

    expect(calls).toHaveLength(1);
    // exhausted:false is what stops the sync service reconciling deletions from
    // this listing. Reporting true here would soft-delete most of the course.
    expect(result.exhausted).toBe(false);
  });

  it('reports a complete listing when nothing predates the watermark', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 200, body: { courseWork: [item('w1', '2026-03-10T00:00:00Z')] } },
    ]);

    const result = await makeClient(fetchImpl).listCourseWork('c1', {
      updatedSince: new Date('2026-01-01T00:00:00Z'),
    });

    expect(result.exhausted).toBe(true);
  });
});

describe('error translation', () => {
  it('treats 401 as expired authorisation and does not retry', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 401, body: { error: { code: 401, message: 'Invalid Credentials' } } },
    ]);

    await expect(makeClient(fetchImpl, 3).listCourses()).rejects.toMatchObject({
      code: 'AUTHORIZATION_EXPIRED',
      retryable: false,
    });
    // Hammering Google with a revoked credential is how a project gets flagged.
    expect(calls).toHaveLength(1);
  });

  it('separates a disabled-API 403 from a permission 403', async () => {
    // Regression: this surfaced in the first real run against Google as
    // "The granted scopes may be insufficient", which sends whoever is
    // debugging to re-check the consent screen when the fix is one click in
    // Cloud Console.
    const { fetchImpl } = fakeFetch([
      {
        status: 403,
        body: {
          error: {
            code: 403,
            status: 'PERMISSION_DENIED',
            message:
              'Google Classroom API has not been used in project 1017170078493 before or it is disabled.',
          },
        },
      },
    ]);

    await expect(makeClient(fetchImpl).listCourses()).rejects.toMatchObject({
      code: 'GOOGLE_API_DISABLED',
      retryable: false,
    });
  });

  it('separates a quota 403 from a permission 403', async () => {
    const quota = fakeFetch([
      { status: 403, body: { error: { code: 403, message: 'userRateLimitExceeded' } } },
    ]);
    await expect(makeClient(quota.fetchImpl).listCourses()).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });

    const permission = fakeFetch([
      { status: 403, body: { error: { code: 403, message: 'Insufficient permission' } } },
    ]);
    await expect(makeClient(permission.fetchImpl).listCourses()).rejects.toMatchObject({
      code: 'AUTHORIZATION_EXPIRED',
      retryable: false,
    });
  });

  it('honours Retry-After on a 429', async () => {
    const { fetchImpl } = fakeFetch([
      { status: 429, body: { error: { message: 'slow down' } }, headers: { 'retry-after': '3' } },
    ]);

    await expect(makeClient(fetchImpl).listCourses()).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterMs: 3000,
    });
  });

  it('retries a 5xx and succeeds on a later attempt', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 503, body: { error: { message: 'backend error' } } },
      { status: 200, body: { courses: [{ id: 'c1', name: 'A' }] } },
    ]);

    const client = new GoogleClassroomClient({
      accessToken: 't',
      logger: silentLogger,
      maxRetryAttempts: 3,
      requestTimeoutMs: 5_000,
      fetchImpl,
    });

    const result = await client.listCourses();
    expect(result.items).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('does not retry a payload that failed validation', async () => {
    // The same request returns the same malformed body; retrying is noise.
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { courses: [{ name: 'missing an id' }] } },
    ]);

    await expect(makeClient(fetchImpl, 3).listCourses()).rejects.toMatchObject({
      code: 'EXTERNAL_VALIDATION_ERROR',
      retryable: false,
    });
    expect(calls).toHaveLength(1);
  });

  it('treats a non-JSON body as a validation failure', async () => {
    const { fetchImpl } = fakeFetch([{ status: 200, body: '<html>proxy error</html>' }]);
    await expect(makeClient(fetchImpl).listCourses()).rejects.toMatchObject({
      code: 'EXTERNAL_VALIDATION_ERROR',
    });
  });

  it('treats a network failure as retryable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('fetch failed')) as unknown as typeof fetch;
    await expect(makeClient(fetchImpl).listCourses()).rejects.toMatchObject({
      code: 'GOOGLE_API_ERROR',
      retryable: true,
    });
  });
});

describe('credential handling', () => {
  it('sends the token as a bearer header and never in the query string', async () => {
    const calls: Array<{ url: URL; init: RequestInit | undefined }> = [];
    const fetchImpl: typeof fetch = (input, init) => {
      calls.push({ url: urlOf(input), init });
      return Promise.resolve(new Response(JSON.stringify({ courses: [] }), { status: 200 }));
    };

    await makeClient(fetchImpl).listCourses();

    const headers = calls[0]?.init?.headers as Record<string, string> | undefined;
    expect(headers?.['Authorization']).toBe('Bearer test-token');
    // A token in a URL ends up in access logs, proxies and browser history.
    expect(calls[0]?.url.toString()).not.toContain('test-token');
  });
});

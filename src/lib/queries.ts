import 'server-only';

import { redirect } from 'next/navigation';
import { cache } from 'react';

import { buildStudentSectionProfile } from '@/domain/academic/alias-generation';
import { createBackendContext, type BackendContext } from '@/infrastructure/composition';
import { createUserScopedClient } from '@/infrastructure/supabase/clients';

import type { ApiDeadline } from './format';
import type { SyncRunStatus } from '@/domain/sync/outcome';

/**
 * Read queries for Server Components.
 *
 * These call the application services directly rather than fetching our own
 * HTTP routes. A Server Component fetching `localhost/api/...` would open a
 * socket to the process it is already running in, re-parse cookies, re-validate
 * the JWT and re-build the whole dependency graph — a full round trip and a
 * second auth check to reach code already in memory.
 *
 * This is not bypassing the backend. The same services, the same repositories,
 * the same row-level security and the same user-scoped Supabase client are
 * used; only the HTTP hop is skipped. The route handlers remain the entry point
 * for client-side mutations, where an HTTP call is genuinely what is happening.
 *
 * Latency is the design constraint here. Every Supabase call is a round trip
 * to another continent -- measured at 280-500ms from the author's network --
 * so what matters is not how many queries a screen makes but how many of them
 * are forced to wait for each other. Two sequential queries cost more than ten
 * concurrent ones. Hence the `cache()` wrappers below, which collapse repeated
 * questions inside a single render, and the deliberate `Promise.all` grouping
 * in each loader.
 */

/**
 * Per-request memoisation.
 *
 * React's `cache()` is scoped to one server render, so two loaders on the same
 * screen asking the same question share one round trip. It is not a data cache
 * across requests: a second page load re-reads everything, which is what a
 * deadline product needs.
 */
const context = cache(createBackendContext);

const cachedConnection = cache(async (userId: string) =>
  (await context()).connections.snapshot(userId),
);

const cachedProfile = cache(async (userId: string) =>
  (await context()).profiles.findByUserId(userId),
);

const cachedCourses = cache(async (userId: string) => (await context()).discovery.list(userId));

export interface SessionUser {
  readonly id: string;
  readonly email: string | null;
}

/**
 * The signed-in user, or null. Pages decide what to do about it.
 *
 * Cached per request because it is a network call, not a cookie read, and a
 * page that asks twice pays for it twice.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const db = await createUserScopedClient();
  // getUser(), not getSession(): it revalidates the JWT with the auth server
  // rather than trusting a cookie the browser handed us.
  const { data, error } = await db.auth.getUser();
  if (error !== null || data.user === null) return null;
  return { id: data.user.id, email: data.user.email ?? null };
});

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (user === null) redirect('/welcome');
  return user;
}

export interface AssignmentView {
  readonly assignmentId: string;
  readonly courseId: string;
  readonly courseName: string;
  readonly title: string;
  readonly deadline: ApiDeadline;
  readonly relevance: 'RELEVANT' | 'NOT_RELEVANT' | 'UNCERTAIN';
  readonly confidence: number;
  readonly hasManualOverride: boolean;
  readonly scopeType: string;
  readonly scopeSections: readonly string[];
  readonly submissionState: string | null;
  readonly link: string | null;
}

export interface FreshnessView {
  readonly lastRunStatus?: SyncRunStatus | null;
  readonly connectionUsable?: boolean;
  readonly level: 'FRESH' | 'AGEING' | 'STALE' | 'PARTIAL' | 'UNAVAILABLE';
  readonly reason: string;
  readonly ageMs: number | null;
  readonly lastSuccessfulSyncAt: string | null;
  readonly timeZone: string;
}

/**
 * Everything the dashboard renders, in one pass.
 *
 * Deliberately one function rather than three called from three components.
 * Component-level fetching here would serialise into a waterfall — upcoming,
 * then overdue, then freshness — and add two render round trips to the screen
 * a student opens most.
 */
export interface DashboardData {
  readonly undated: readonly AssignmentView[];
  readonly upcoming: readonly AssignmentView[];
  readonly overdue: readonly AssignmentView[];
  readonly reviewCount: number;
  readonly ignoredCount: number;
  readonly freshness: FreshnessView;
  readonly trackedCourseCount: number;
}

export async function loadDashboard(userId: string): Promise<DashboardData> {
  const backend = await context();
  const now = new Date();

  const [upcoming, overdue, review, ignored, courses, freshness, undated] = await Promise.all([
    backend.assignments.findUpcoming({
      userId,
      to: null,
      relevance: ['RELEVANT'],
      includeSubmitted: false,
      limit: 100,
    }),
    backend.assignments.findOverdue({
      userId,
      // Two months back. Far enough to catch a missed deadline, short enough
      // that a returning student is not buried under a year of history.
      since: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
      relevance: ['RELEVANT'],
      includeSubmitted: false,
      limit: 50,
    }),
    loadReviewCount(userId),
    backend.assignments.findIgnored(userId, 200),
    cachedCourses(userId),
    loadFreshnessView(userId, now),
    backend.assignments.findUndated({ userId, relevance: ['RELEVANT'], limit: 100 }),
    ]);

  return {
    upcoming: upcoming.map(toView),
    overdue: overdue.map(toView),
    reviewCount: review,
    undated: undated.map(toUndatedView),
    ignoredCount: ignored.length,
    freshness,
    trackedCourseCount: courses.filter((course) => course.decision === 'TRACKED').length,
    };
}

/** Items the backend could not confidently place. Never hidden, always askable. */
export const loadReviewQueue = cache(async (userId: string): Promise<{
  readonly items: readonly AssignmentView[];
  readonly freshness: FreshnessView;
}> => {
  const backend = await context();
  const now = new Date();

  const [upcoming, overdue, undated, freshness] = await Promise.all([
    backend.assignments.findUpcoming({
      userId,
      to: null,
      relevance: ['UNCERTAIN'],
      includeSubmitted: true,
      limit: 100,
    }),
    backend.assignments.findOverdue({
      userId,
      since: null,
      relevance: ['UNCERTAIN'],
      includeSubmitted: true,
      limit: 100,
    }),
    backend.assignments.findUndated({ userId, relevance: ['UNCERTAIN'], limit: 100 }),
    loadFreshnessView(userId, now),
    ]);

  return {
    items: [
      ...overdue.map(toView),
      ...upcoming.map(toView),
      ...undated.map(toUndatedView),
    ],
    freshness,
    };
});

/**
 * Everything the student has personally decided.
 *
 * Exists so a wrong answer is recoverable. Once an item is overridden it stops
 * being UNCERTAIN and leaves the review queue, and a mistaken "not my section"
 * would otherwise hide real coursework with no way back -- the exact failure
 * the product is built to prevent.
 *
 * Six reads rather than one because the assignment feeds are partitioned by
 * deadline, not by decision. They run concurrently, so the screen waits for the
 * slowest, not the sum.
 */
export async function loadDecisions(userId: string): Promise<readonly AssignmentView[]> {
  const backend = await context();
  const relevance: readonly ['RELEVANT', 'NOT_RELEVANT'] = ['RELEVANT', 'NOT_RELEVANT'];

  const [upcoming, overdue, undated] = await Promise.all([
    backend.assignments.findUpcoming({
      userId,
      to: null,
      relevance,
      includeSubmitted: true,
      limit: 200,
    }),
    backend.assignments.findOverdue({
      userId,
      since: null,
      relevance,
      includeSubmitted: true,
      limit: 200,
    }),
    backend.assignments.findUndated({ userId, relevance, limit: 200 }),
    ]);

  return [
    ...overdue.map(toView),
    ...upcoming.map(toView),
    ...undated.map(toUndatedView),
    ].filter((item) => item.hasManualOverride);
}

/** What the student has hidden. Reachable, reversible, never a void. */
export async function loadIgnored(userId: string): Promise<{
  readonly items: readonly AssignmentView[];
  readonly freshness: FreshnessView;
}> {
  const backend = await context();
  const [items, freshness] = await Promise.all([
    backend.assignments.findIgnored(userId, 200),
    loadFreshnessView(userId, new Date()),
    ]);
  return { items: items.map(toView), freshness };
}

/**
 * Just the number on the Review tab.
 *
 * Secondary screens need this one integer for the nav badge and nothing else.
 * They used to get it by calling loadDashboard, which cost nine queries and a
 * second freshness computation to produce a single digit.
 */
export const loadReviewCount = cache(async (userId: string): Promise<number> => {
  const { items } = await loadReviewQueue(userId);
  return items.length;
});

export interface CourseView {
  readonly courseId: string;
  readonly name: string;
  readonly section: string | null;
  readonly courseState: string | null;
  readonly isTracked: boolean;
  /** Null means never chosen, which is different from chosen and declined. */
  readonly decidedAt: string | null;
}

export async function loadCourses(userId: string): Promise<{
  readonly courses: readonly CourseView[];
  readonly freshness: FreshnessView;
}> {
  const [courses, freshness] = await Promise.all([
    cachedCourses(userId),
    loadFreshnessView(userId, new Date()),
    ]);

  return {
    courses: courses.map((course) => ({
      courseId: course.courseId,
      name: course.name,
      section: course.section,
      courseState: course.courseState,
      isTracked: course.decision === 'TRACKED',
      decidedAt: course.decidedAt?.toISOString() ?? null,
    })),
    freshness,
    };
}

export interface ProfileView {
  readonly primarySection: string;
  readonly programCode: string | null;
  readonly batch: string | null;
  readonly timeZone: string;
  readonly extraAliases: readonly string[];
}

/**
 * The student's saved academic identity, in full.
 *
 * Separate from SetupState, which only answers "is there one?". A form that
 * edits the profile needs every field it will send back: rendering it from a
 * partial view and posting the gaps as null silently erases whatever the
 * student had entered before.
 */
export const loadProfile = cache(async (userId: string): Promise<ProfileView | null> => {
  const profile = await cachedProfile(userId);
  if (profile === null) return null;

  return {
    primarySection: profile.identity.primarySection,
    programCode: profile.identity.programCode,
    batch: profile.identity.batch,
    timeZone: profile.timeZone,
    extraAliases: profile.aliases
      .filter((alias) => alias.source === 'USER')
      .map((alias) => alias.raw),
      };
});

export interface SetupState {
  readonly hasConnection: boolean;
  readonly connectionStatus: string | null;
  readonly hasProfile: boolean;
  readonly primarySection: string | null;
  readonly matchedAliases: readonly string[];
  readonly hasTrackedCourses: boolean;
  readonly discoveredCourseCount: number;
}

/**
 * How far through setup the student is.
 *
 * Read once by the shell so every screen can route a half-configured account to
 * the right step, instead of each page inventing its own idea of "ready".
 */
export const loadSetupState = cache(async (userId: string): Promise<SetupState> => {
  // All three are shared with the freshness check, so on a screen that needs
  // both this costs nothing the other did not already pay for.
  const [connection, profile, courses] = await Promise.all([
    cachedConnection(userId),
    cachedProfile(userId),
    cachedCourses(userId),
    ]);

  const aliases =
    profile === null
      ? []
      : buildStudentSectionProfile(profile.identity, profile.aliases).aliases.map((a) => a.raw);

  return {
    hasConnection: connection !== null && connection.status === 'ACTIVE',
    connectionStatus: connection?.status ?? null,
    hasProfile: profile !== null,
    primarySection: profile?.identity.primarySection ?? null,
    matchedAliases: aliases,
    hasTrackedCourses: courses.some((course) => course.decision === 'TRACKED'),
    discoveredCourseCount: courses.length,
    };
});

// ---------------------------------------------------------------------------

async function loadFreshnessView(userId: string, now: Date): Promise<FreshnessView> {
  const { assessFreshness } = await import('@/domain/sync/freshness');
  const backend = await context();

  const [lastSuccessfulSyncAt, latestRun, connection, profile] = await Promise.all([
    backend.syncRuns.lastSuccessfulAt(userId),
    backend.syncRuns.latestForUser(userId),
    cachedConnection(userId),
    cachedProfile(userId),
    ]);

  const report = assessFreshness({
    lastSuccessfulSyncAt,
    lastAttemptedSyncAt: latestRun?.startedAt ?? null,
    lastRunStatus: latestRun?.status ?? null,
    connectionUsable: connection !== null && connection.status === 'ACTIVE',
    now,
    });

  return {
    level: report.level,
    lastRunStatus: report.lastRunStatus,
    connectionUsable: connection !== null && connection.status === 'ACTIVE',
    reason: report.reason,
    ageMs: report.ageMs,
    lastSuccessfulSyncAt: report.lastSuccessfulSyncAt?.toISOString() ?? null,
    // UTC rather than the server's zone when unset: falling back to the
    // server's would make date boundaries depend on where this is deployed.
    timeZone: profile?.timeZone ?? 'UTC',
    };
}

type RepoAssignment = Awaited<
  ReturnType<BackendContext['assignments']['findUpcoming']>
>[number];

function toView(item: RepoAssignment): AssignmentView {
  return {
    assignmentId: item.assignmentId,
    courseId: item.courseId,
    courseName: item.courseName,
    title: item.title,
    deadline: {
      precision: item.deadline.precision,
      dueAtUtc: item.deadline.dueAt?.toISOString() ?? null,
      dueDateUtc:
        item.deadline.dueDate === null
          ? null
          : `${pad(item.deadline.dueDate.year, 4)}-${pad(item.deadline.dueDate.month, 2)}-${pad(item.deadline.dueDate.day, 2)}`,
    },
    relevance: item.relevance,
    confidence: item.confidence,
    hasManualOverride: item.hasManualOverride,
    scopeType: item.scopeType,
    scopeSections: item.scopeSections,
    submissionState: item.submissionState,
    link: item.alternateLink,
    };
}

type RepoUndated = Awaited<ReturnType<BackendContext['assignments']['findUndated']>>[number];

function toUndatedView(item: RepoUndated): AssignmentView {
  return {
    assignmentId: item.assignmentId,
    courseId: item.courseId,
    courseName: item.courseName,
    title: item.title,
    // NONE, honestly. The review screen shows "No due date" rather than
    // borrowing a plausible one.
    deadline: { precision: 'NONE', dueAtUtc: null, dueDateUtc: null },
    relevance: item.relevance,
    confidence: 0,
    hasManualOverride: item.hasManualOverride,
    scopeType: item.scopeType,
    scopeSections: [],
    submissionState: item.submissionState,
    link: item.alternateLink,
    };
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

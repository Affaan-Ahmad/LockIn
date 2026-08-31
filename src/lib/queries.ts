import 'server-only';

import { redirect } from 'next/navigation';

import { buildStudentSectionProfile } from '@/domain/academic/alias-generation';
import { createBackendContext, type BackendContext } from '@/infrastructure/composition';
import { createUserScopedClient } from '@/infrastructure/supabase/clients';

import type { ApiDeadline } from './format';

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
 */

export interface SessionUser {
  readonly id: string;
  readonly email: string | null;
}

/** The signed-in user, or null. Pages decide what to do about it. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const db = await createUserScopedClient();
  // getUser(), not getSession(): it revalidates the JWT with the auth server
  // rather than trusting a cookie the browser handed us.
  const { data, error } = await db.auth.getUser();
  if (error !== null || data.user === null) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

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
  readonly upcoming: readonly AssignmentView[];
  readonly overdue: readonly AssignmentView[];
  readonly reviewCount: number;
  readonly ignoredCount: number;
  readonly freshness: FreshnessView;
  readonly trackedCourseCount: number;
}

export async function loadDashboard(userId: string): Promise<DashboardData> {
  const context = await createBackendContext();
  const now = new Date();

  const [upcoming, overdue, review, ignored, courses, freshness] = await Promise.all([
    context.assignments.findUpcoming({
      userId,
      to: null,
      relevance: ['RELEVANT'],
      includeSubmitted: false,
      limit: 100,
    }),
    context.assignments.findOverdue({
      userId,
      // Two months back. Far enough to catch a missed deadline, short enough
      // that a returning student is not buried under a year of history.
      since: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000),
      relevance: ['RELEVANT'],
      includeSubmitted: false,
      limit: 50,
    }),
    context.assignments.findUpcoming({
      userId,
      to: null,
      relevance: ['UNCERTAIN'],
      includeSubmitted: false,
      limit: 100,
    }),
    context.assignments.findIgnored(userId, 200),
    context.discovery.list(userId),
    loadFreshnessView(context, userId, now),
  ]);

  return {
    upcoming: upcoming.map(toView),
    overdue: overdue.map(toView),
    reviewCount: review.length,
    ignoredCount: ignored.length,
    freshness,
    trackedCourseCount: courses.filter((course) => course.decision === 'TRACKED').length,
  };
}

/** Items the backend could not confidently place. Never hidden, always askable. */
export async function loadReviewQueue(userId: string): Promise<{
  readonly items: readonly AssignmentView[];
  readonly freshness: FreshnessView;
}> {
  const context = await createBackendContext();
  const now = new Date();

  const [upcoming, overdue, undated, freshness] = await Promise.all([
    context.assignments.findUpcoming({
      userId,
      to: null,
      relevance: ['UNCERTAIN'],
      includeSubmitted: true,
      limit: 100,
    }),
    context.assignments.findOverdue({
      userId,
      since: null,
      relevance: ['UNCERTAIN'],
      includeSubmitted: true,
      limit: 100,
    }),
    context.assignments.findUndated({ userId, relevance: ['UNCERTAIN'], limit: 100 }),
    loadFreshnessView(context, userId, now),
  ]);

  return {
    items: [
      ...overdue.map(toView),
      ...upcoming.map(toView),
      ...undated.map(toUndatedView),
    ],
    freshness,
  };
}

/** What the student has hidden. Reachable, reversible, never a void. */
export async function loadIgnored(userId: string): Promise<{
  readonly items: readonly AssignmentView[];
  readonly freshness: FreshnessView;
}> {
  const context = await createBackendContext();
  const [items, freshness] = await Promise.all([
    context.assignments.findIgnored(userId, 200),
    loadFreshnessView(context, userId, new Date()),
  ]);
  return { items: items.map(toView), freshness };
}

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
  const context = await createBackendContext();

  const [courses, freshness] = await Promise.all([
    context.discovery.list(userId),
    loadFreshnessView(context, userId, new Date()),
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
export async function loadSetupState(userId: string): Promise<SetupState> {
  const context = await createBackendContext();

  const [connection, profile, courses] = await Promise.all([
    context.connections.snapshot(userId),
    context.profiles.findByUserId(userId),
    context.discovery.list(userId),
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
}

// ---------------------------------------------------------------------------

async function loadFreshnessView(
  context: BackendContext,
  userId: string,
  now: Date,
): Promise<FreshnessView> {
  const { assessFreshness } = await import('@/domain/sync/freshness');

  const [lastSuccessfulSyncAt, latestRun, connection, profile] = await Promise.all([
    context.syncRuns.lastSuccessfulAt(userId),
    context.syncRuns.latestForUser(userId),
    context.connections.snapshot(userId),
    context.profiles.findByUserId(userId),
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

import { NextResponse } from 'next/server';

import { createBackendContext } from '@/infrastructure/composition';
import { buildStudentSectionProfile } from '@/domain/academic/alias-generation';

import { handleRoute, requireUser } from '../../_lib/handler';

/**
 * Everything LockIn holds about the caller, as one JSON file.
 *
 * The counterpart to account deletion. Deletion answers "remove my data" and
 * this answers "show me what you have", and a product that offers the first
 * without the second is asking to be trusted rather than being checkable.
 *
 * Built from the same repositories the app reads, so it cannot drift into
 * describing a schema that no longer exists: if a table stops being readable
 * this route stops returning it, rather than quietly omitting a category the
 * privacy policy still claims.
 *
 * Deliberately excluded: the Google access and refresh tokens. They are
 * credentials, not personal data about the student, and handing them back in a
 * downloadable file would put a live key to their Classroom account in their
 * Downloads folder. The export says the connection exists and when it was
 * made, which is the fact; the secret is not the fact.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const context = await createBackendContext();

    const relevance = ['RELEVANT', 'NOT_RELEVANT', 'UNCERTAIN'] as const;

    const [profile, connection, courses, upcoming, overdue, undated, ignored, runs] =
      await Promise.all([
        context.profiles.findByUserId(user.id),
        context.connections.snapshot(user.id),
        context.discovery.list(user.id),
        context.assignments.findUpcoming({
          userId: user.id,
          to: null,
          relevance,
          includeSubmitted: true,
          limit: 1000,
        }),
        context.assignments.findOverdue({
          userId: user.id,
          since: null,
          relevance,
          includeSubmitted: true,
          limit: 1000,
        }),
        context.assignments.findUndated({ userId: user.id, relevance, limit: 1000 }),
        context.assignments.findIgnored(user.id, 1000),
        context.syncRuns.lastSuccessfulAt(user.id),
      ]);

    const aliases =
      profile === null
        ? []
        : buildStudentSectionProfile(profile.identity, profile.aliases).aliases.map((a) => a.raw);

    // Dated and undated coursework carry different shapes in the repository,
    // and they are mapped separately rather than flattened through a cast. An
    // assignment with no due date genuinely has no deadline, no confidence and
    // no scope sections; inventing nulls for them here would put fields in the
    // export that do not exist in the record.
    const dated = [...overdue, ...upcoming].map((item) => ({
      title: item.title,
      course: item.courseName,
      due: {
        precision: item.deadline.precision,
        at: item.deadline.dueAt?.toISOString() ?? null,
      },
      // The classification and its evidence, because a student is entitled to
      // see the reasoning that decided whether their coursework was shown to
      // them, not just the verdict.
      lockInDecided: item.relevance,
      confidence: item.confidence,
      youOverrodeIt: item.hasManualOverride,
      sectionScope: { type: item.scopeType, sections: item.scopeSections },
      submissionState: item.submissionState,
      link: item.alternateLink,
    }));

    const withoutDueDate = undated.map((item) => ({
      title: item.title,
      course: item.courseName,
      due: null,
      lockInDecided: item.relevance,
      youOverrodeIt: item.hasManualOverride,
      sectionScope: { type: item.scopeType },
      submissionState: item.submissionState,
      link: item.alternateLink,
    }));

    const body = {
      exportedAt: new Date().toISOString(),
      account: { email: user.email },
      profile:
        profile === null
          ? null
          : {
              section: profile.identity.primarySection,
              programCode: profile.identity.programCode,
              batch: profile.identity.batch,
              timeZone: profile.timeZone,
              // What the classifier actually matches on, so the student can
              // check the input as well as the output.
              matchedAliases: aliases,
            },
      googleConnection:
        connection === null
          ? null
          : { status: connection.status, connectedAt: connection.connectedAt?.toISOString() ?? null },
      courses: courses.map((course) => ({
        name: course.name,
        section: course.section,
        state: course.courseState,
        tracked: course.decision === 'TRACKED',
        decidedAt: course.decidedAt?.toISOString() ?? null,
      })),
      assignments: dated,
      assignmentsWithNoDueDate: withoutDueDate,
      hidden: ignored.map((item) => ({ title: item.title, course: item.courseName })),
      lastSuccessfulSyncAt: runs?.toISOString() ?? null,
      note: 'Google access and refresh tokens are deliberately not included. They are credentials, not information about you.',
    };

    return new NextResponse(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // Downloads rather than rendering. A wall of JSON in a browser tab is
        // technically an export and practically useless.
        'Content-Disposition': `attachment; filename="lockin-export-${new Date().toISOString().slice(0, 10)}.json"`,
        // Never cached anywhere: this is one student's entire record.
        'Cache-Control': 'no-store, private',
      },
    });
  });
}

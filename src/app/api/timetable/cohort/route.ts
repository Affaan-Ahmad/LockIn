import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { cohortOptions, findCohort, WHOLE_COHORT_SECTION } from '@/domain/timetable';
import { loadTimetable } from '@/infrastructure/google/timetable.client';
import { COHORT_COOKIE, SECTION_COOKIE } from '@/lib/timetable';
import { InvalidInputError } from '@/shared/errors';

import { handleRoute, jsonOk, requireUser } from '../../_lib/handler';

/**
 * Records which cohort and section a student is in, for the timetable only.
 *
 * Stored in a cookie rather than the database. This is a view preference: get
 * it wrong and the student sees somebody else's week and fixes it in a click.
 * The section held in their academic profile is a different thing entirely --
 * it decides which coursework is hidden from them, and belongs to a naming
 * scheme the timetable does not share. Conflating the two would let a timetable
 * preference change what deadlines they are shown.
 *
 * The submitted pair is checked against the live document before it is stored,
 * so a cookie can only ever name a cohort and section the sheet really has.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A year, so a student is not asked again every term, but not forever. */
const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

const selectionSchema = z.object({
  cohortLabel: z.string().trim().min(1).max(80),
  section: z.string().trim().min(1).max(8),
});

export async function PUT(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    await requireUser();

    let body: unknown;
    try {
      body = (await request.json()) as unknown;
    } catch {
      body = null;
    }

    const parsed = selectionSchema.safeParse(body);
    if (!parsed.success) throw new InvalidInputError('A cohort and a section are required.');

    const snapshot = await loadTimetable();
    const cohort = findCohort(cohortOptions(snapshot.days), parsed.data.cohortLabel);
    if (cohort === null) {
      throw new InvalidInputError('That cohort is not in the published timetable.');
    }
    if (cohort.sections.length === 0) {
      // Taught as one group: the only acceptable "section" is the sentinel.
      if (parsed.data.section !== WHOLE_COHORT_SECTION) {
        throw new InvalidInputError(`${cohort.label} is taught as one group and has no sections.`);
      }
    } else if (!cohort.sections.includes(parsed.data.section)) {
      throw new InvalidInputError(`${cohort.label} has no section ${parsed.data.section}.`);
    }

    const response = jsonOk({ cohortLabel: cohort.label, section: parsed.data.section });

    // Not httpOnly-sensitive in the security sense -- it holds a section letter
    // -- but there is no reason for scripts to read it either.
    const options = {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: COOKIE_MAX_AGE_SECONDS,
    } as const;

    response.cookies.set(COHORT_COOKIE, cohort.label, options);
    response.cookies.set(SECTION_COOKIE, parsed.data.section, options);
    return response;
  });
}

/** Forgets the choice, so the picker comes back. */
export async function DELETE(): Promise<NextResponse> {
  return handleRoute(async () => {
    await requireUser();
    const response = jsonOk({ cleared: true });
    response.cookies.delete(COHORT_COOKIE);
    response.cookies.delete(SECTION_COOKIE);
    return response;
  });
}

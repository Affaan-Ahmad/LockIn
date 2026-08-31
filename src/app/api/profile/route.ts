import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { buildStudentSectionProfile } from '@/domain/academic/alias-generation';
import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { handleRoute, jsonOk, requireUser } from '../_lib/handler';

/**
 * The student's academic identity: section, programme, batch, timezone.
 *
 * Onboarding cannot work without this. Until now the only way to set a section
 * was raw SQL, which is fine for one developer and impossible for a user.
 *
 * The response includes the *generated* aliases so onboarding can show the
 * student what LockIn will actually match on -- "we will look for G, Section G,
 * Sec G, 5G" -- rather than asking them to trust an invisible rule. Those
 * aliases are derived on read, never stored, so they cannot drift from what the
 * classifier uses.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const profileSchema = z.object({
  // A section is a short label like "G" or "B2". Anything longer is a mistake
  // that would generate useless aliases and quietly break classification.
  primarySection: z.string().trim().min(1).max(8),
  programCode: z.string().trim().max(16).nullable().default(null),
  batch: z.string().trim().max(8).nullable().default(null),
  university: z.string().trim().max(120).nullable().default(null),
  // Validated against the runtime's own zone database rather than a hand-kept
  // list: an unknown zone would silently shift every deadline boundary.
  timeZone: z.string().refine(isValidTimeZone, { message: 'Unknown IANA time zone' }),
  /** Extra spellings the student's teachers use that we would not generate. */
  extraAliases: z.array(z.string().trim().min(1).max(32)).max(20).default([]),
});

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export async function GET(): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const context = await createBackendContext();

    const profile = await context.profiles.findByUserId(user.id);
    if (profile === null) {
      // Not an error: a new account legitimately has no profile yet, and
      // onboarding needs to distinguish "not set up" from "failed".
      return jsonOk({ configured: false, profile: null });
    }

    const resolved = buildStudentSectionProfile(profile.identity, profile.aliases);

    return jsonOk({
      configured: true,
      profile: {
        primarySection: profile.identity.primarySection,
        programCode: profile.identity.programCode,
        batch: profile.identity.batch,
        timeZone: profile.timeZone,
        extraAliases: profile.aliases
          .filter((alias) => alias.source === 'USER')
          .map((alias) => alias.raw),
        // What the classifier will match on, shown so the student can sanity
        // check it instead of trusting an invisible rule.
        matchedAliases: resolved.aliases.map((alias) => alias.raw),
      },
    });
  });
}

export async function PUT(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();

    let body: unknown;
    try {
      body = (await request.json()) as unknown;
    } catch {
      body = null;
    }

    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) {
      throw new InvalidInputError(
        parsed.error.issues[0]?.message ?? 'A section and a valid time zone are required',
      );
    }

    const context = await createBackendContext();
    const { extraAliases, ...identity } = parsed.data;

    const saved = await context.profiles.upsert(user.id, identity);
    await context.profiles.replaceAliases(user.id, extraAliases);

    const resolved = buildStudentSectionProfile(saved.identity, []);

    return jsonOk({
      configured: true,
      profile: {
        primarySection: saved.identity.primarySection,
        programCode: saved.identity.programCode,
        batch: saved.identity.batch,
        timeZone: saved.timeZone,
        extraAliases,
        matchedAliases: [...resolved.aliases.map((a) => a.raw), ...extraAliases],
      },
      // Changing a section changes every classification input fingerprint, so
      // the next sync re-evaluates everything. Said plainly, because otherwise
      // the student would see old verdicts and assume the change failed.
      note: 'Your next sync will re-check every assignment against this section.',
    });
  });
}

import type { NextResponse } from 'next/server';
import { z } from 'zod';

import { createBackendContext } from '@/infrastructure/composition';
import { InvalidInputError } from '@/shared/errors';

import { handleRoute, jsonOk, requireUser } from '../_lib/handler';

/**
 * Account deletion.
 *
 * Required before this application can be offered to anyone: a privacy policy
 * cannot truthfully say "we delete your data when you delete your account"
 * unless this exists and has been tested. It is also the operation with no undo,
 * so it is the one place in the API that demands an explicit confirmation
 * rather than accepting a bare request.
 *
 * Deletion revokes our Google grant first, then removes the auth user. Every
 * user-owned table cascades from `user_profiles`, which cascades from
 * `auth.users`, so the removal is one transaction and cannot leave a table
 * behind the way a hand-maintained list eventually would.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const confirmSchema = z.object({
  // A typed confirmation, not a boolean. `{"confirm":true}` is something a
  // misfiring client can send by accident; this is not.
  confirm: z.literal('DELETE MY ACCOUNT'),
});

export async function DELETE(request: Request): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();

    let body: unknown;
    try {
      body = (await request.json()) as unknown;
    } catch {
      body = null;
    }

    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) {
      throw new InvalidInputError(
        'Account deletion requires {"confirm":"DELETE MY ACCOUNT"}. This cannot be undone.',
      );
    }

    const context = await createBackendContext();
    const result = await context.account.deleteAccount(user.id);

    return jsonOk({
      deleted: true,
      deletedAt: result.deletedAt.toISOString(),
      googleAccessRevoked: result.googleRevoked,
      // Said plainly, because the honest answer differs from the happy path and
      // the student needs to know to finish the job themselves.
      note: result.googleRevoked
        ? 'Your account, coursework and Google authorisation have been removed.'
        : 'Your account and coursework have been removed. Google authorisation could not be revoked automatically. Remove it at myaccount.google.com/permissions.',
    });
  });
}

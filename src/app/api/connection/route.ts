import type { NextResponse } from 'next/server';

import { createBackendContext } from '@/infrastructure/composition';

import { handleRoute, jsonOk, requireUser } from '../_lib/handler';

/**
 * Google connection status.
 *
 * Returns the snapshot shape only. The full connection record carries decrypted
 * tokens and must never reach a response body, which is why the repository
 * exposes a separate method for this rather than letting a route pick safe
 * fields off the full object and hope nobody adds a spread later.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const context = await createBackendContext();
    const snapshot = await context.connections.snapshot(user.id);

    if (snapshot === null) {
      return jsonOk({ connected: false, status: 'NOT_CONNECTED' });
    }

    return jsonOk({
      connected: snapshot.status === 'ACTIVE',
      status: snapshot.status,
      grantedScopes: snapshot.grantedScopes,
      connectedAt: snapshot.connectedAt.toISOString(),
      lastErrorCode: snapshot.lastErrorCode,
      // Expiry only, never the token. Lets a client show "reconnect needed"
      // without ever handling a credential.
      accessTokenExpiresAt: snapshot.accessTokenExpiresAt?.toISOString() ?? null,
    });
  });
}

/**
 * Disconnects Google.
 *
 * Revokes the grant at Google and clears the stored credentials, so no further
 * synchronisation is possible until the student reconnects.
 *
 * Coursework already imported is deliberately kept. It is the student's record
 * of their own work, and silently destroying it because they withdrew an API
 * permission would be a surprise in the wrong direction. The response says so
 * explicitly rather than leaving them to find out.
 */
export async function DELETE(): Promise<NextResponse> {
  return handleRoute(async () => {
    const user = await requireUser();
    const context = await createBackendContext();

    const result = await context.tokens.disconnect(user.id);

    return jsonOk({
      disconnected: true,
      googleAccessRevoked: result.revokedAtGoogle,
      dataRetained: true,
      note: result.revokedAtGoogle
        ? 'Google access revoked. Coursework already imported is kept; delete your account to remove it.'
        : 'Local credentials cleared, but Google did not confirm revocation. Remove it at myaccount.google.com/permissions.',
    });
  });
}

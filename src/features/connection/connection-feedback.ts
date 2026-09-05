/**
 * What to say when connecting Google Classroom did not simply work.
 *
 * The callback cannot render anything -- it is a redirect -- so it names an
 * outcome in the query string and the screen the student lands on says what it
 * means. Those outcomes used to be appended to `/`, which redirects a
 * half-configured account straight to `/welcome` and drops the query string on
 * the way: every failure message the callback produced was written to a URL
 * nobody ever read.
 *
 * Pure, so the wording is unit-testable without rendering anything, and so the
 * set of codes the route can emit is the same set this file handles.
 */

import type { ConnectionResult } from '@/application/services/google-connection.service';

export const CONNECTION_FEEDBACK = {
  denied: 'denied',
  missingCode: 'missing_code',
  failed: 'failed',
  noProviderToken: 'no_provider_token',
  noRefreshToken: 'no_refresh_token',
  insufficientScopes: 'insufficient_scopes',
  unverified: 'unverified',
} as const;

export type ConnectionFeedbackCode =
  (typeof CONNECTION_FEEDBACK)[keyof typeof CONNECTION_FEEDBACK];

/**
 * Everything the screen renders, and nothing it does not.
 *
 * There was a `retryable` boolean here, for the difference between "try that
 * again" and "grant the permissions this time". It was real, but it was never
 * read: the notice renders the tone, the title and the detail, and the advice
 * it encoded is already in the wording of each `detail` below -- which is where
 * a student can actually see it. A second, silent copy of that distinction is
 * a thing to keep in step with the sentences for no benefit, and the first time
 * the two disagreed nobody would find out.
 */
export interface ConnectionFeedback {
  readonly code: ConnectionFeedbackCode;
  readonly tone: 'warning' | 'danger';
  readonly title: string;
  readonly detail: string;
}

/**
 * Every sentence here has to be true of what the code did.
 *
 * The tempting reassurances are the ones to watch: "nothing was shared",
 * "nothing was stored", "nothing about your account has changed", "nothing has
 * stopped working". Each is a claim about state this route cannot see. The
 * callback learns that a step failed, not what happened on Google's side, not
 * what a previous attempt already wrote, and not whether the student's existing
 * connection is still working. Comforting a student with a guarantee we cannot
 * make is worse than saying less.
 *
 * So these say what was observed and what to do next, and nothing else.
 */
const FEEDBACK: Readonly<Record<ConnectionFeedbackCode, Omit<ConnectionFeedback, 'code'>>> = {
  denied: {
    tone: 'warning',
    title: 'Google Classroom was not connected',
    detail:
      'The consent screen was closed or declined, so the connection was not completed. You can start again whenever you like.',
  },
  missing_code: {
    tone: 'warning',
    title: 'That sign-in link could not be completed',
    detail:
      'Google sent you back without a sign-in code, which usually means the link was opened again after it had already been used. Start the connection from here instead.',
  },
  failed: {
    tone: 'danger',
    title: 'The connection could not be completed',
    detail:
      'LockIn could not finish setting up the Classroom connection. Try again later; if it keeps happening, contact support.',
  },
  no_provider_token: {
    tone: 'danger',
    title: 'Google did not give LockIn access to Classroom',
    detail:
      'You are signed in, but no Classroom permission came back with it, so there is nothing to read your coursework with. Connect again and accept the Classroom permissions on the Google screen.',
  },
  no_refresh_token: {
    tone: 'danger',
    title: 'That connection would have stopped working within the hour',
    detail:
      'Google granted the permissions but did not return the credential LockIn needs to keep the connection alive, so it was recorded as needing reconnection rather than as working. Connect again, and if Google offers to reuse a previous approval, choose to review the permissions instead.',
  },
  insufficient_scopes: {
    tone: 'danger',
    title: 'Some Classroom permissions were not granted',
    detail:
      'Google let you untick permissions on the consent screen, and LockIn needs all of them to work out which coursework is yours. What was granted has been recorded, but syncing stays off until the missing permissions are granted.',
  },
  unverified: {
    tone: 'warning',
    title: 'LockIn could not check what Google granted',
    detail:
      'The check that asks Google which permissions were granted did not return an answer LockIn could use, so nothing was recorded rather than guessed at. Try again in a moment.',
  },
};

/**
 * The URL that shows one of these messages.
 *
 * `/welcome`, always. The dashboard redirects a half-configured account to
 * `/welcome` and drops the query string on the way, so a message attached to
 * `/` is written to a URL nobody ever reads -- which is precisely how every
 * failure the callback could report came to be invisible.
 */
export function connectionFeedbackPath(code: ConnectionFeedbackCode): string {
  return `/welcome?connection=${code}`;
}

/**
 * Where the OAuth callback sends each outcome.
 *
 * Pure, and here rather than inline in the route, for the same reason the
 * wording is: the route cannot be exercised without standing up Supabase, env
 * validation and `server-only`, and the part worth proving is the decision, not
 * the call to `NextResponse.redirect`. Keeping it in this file also means the
 * set of outcomes and the set of messages cannot drift apart -- the compiler
 * rejects a new `ConnectionResult` kind that nothing here handles.
 */
export function connectionRedirectPath(kind: ConnectionResult['kind']): string {
  switch (kind) {
    case 'CONNECTED':
      // Onward to whatever the account still needs. `/` routes a half-set-up
      // account to the next step and a finished one to the dashboard, and there
      // is no message to lose on the way.
      return '/';
    case 'INCOMPLETE_SCOPES':
      return connectionFeedbackPath(CONNECTION_FEEDBACK.insufficientScopes);
    case 'NO_REFRESH_TOKEN':
      // Full permissions and nothing to renew them with. Treating this as
      // success hands back an account that expires by itself within the hour.
      return connectionFeedbackPath(CONNECTION_FEEDBACK.noRefreshToken);
    case 'UNVERIFIED':
      return connectionFeedbackPath(CONNECTION_FEEDBACK.unverified);
  }
}

/**
 * Reads the `connection` query parameter, or returns null.
 *
 * An unknown value is null rather than a generic error. A stale bookmark or
 * somebody editing the URL should show the ordinary screen, not an alarming
 * message about a failure that did not happen.
 */
export function describeConnectionFeedback(
  raw: string | readonly string[] | undefined,
): ConnectionFeedback | null {
  const value = typeof raw === 'string' ? raw : null;
  if (value === null) return null;

  const known = Object.values(CONNECTION_FEEDBACK).find((code) => code === value);
  if (known === undefined) return null;

  return { code: known, ...FEEDBACK[known] };
}

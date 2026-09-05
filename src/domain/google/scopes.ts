/**
 * What a usable Google Classroom grant consists of.
 *
 * This lives in the domain because it is a product rule, not a transport
 * detail: "the connection is only usable if the student granted all four
 * permissions" decides what the sync may attempt, what the connection screen
 * says, and whether a stored row counts as connected at all. It was previously
 * implicit in a route that simply asserted the full list had been granted --
 * which meant a partial consent was recorded as a complete one and the failure
 * surfaced later, as an unexplained Google error mid-sync.
 *
 * Pure and dependency-free, so both the callback and the token service can
 * apply exactly the same rule without either of them owning it.
 */

/**
 * The minimum read-only scopes this application needs.
 *
 * Least privilege is not just policy here -- Google's consent screen shows every
 * scope, and asking a student for roster or profile access to read their own
 * deadlines is both unnecessary and a reason not to grant consent at all. The
 * student's Classroom user id is instead learned from their own submissions.
 */
export const REQUIRED_CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
  'https://www.googleapis.com/auth/classroom.topics.readonly',
] as const;

/**
 * The error code recorded on a connection whose grant is real but incomplete.
 *
 * Named here rather than at either call site because two layers write it -- the
 * callback when the grant arrives short, and the token service if it later
 * notices a shrunken grant -- and one screen reads it. A string literal repeated
 * three times is a rename waiting to go wrong.
 */
export const INSUFFICIENT_SCOPES = 'INSUFFICIENT_SCOPES';

/**
 * The error code recorded when nothing can renew the connection.
 *
 * Not a scope, and here anyway for the same reason as the constant above: two
 * layers write it -- the connection service when a consent arrives with no
 * refresh token and none is already stored, and the token service when a stored
 * one turns out to be absent -- and a screen reads it back. Three copies of a
 * string literal is a rename waiting to go wrong.
 *
 * It is a distinct fault from INSUFFICIENT_SCOPES. A student can grant every
 * permission and still leave us unable to renew, and telling them to tick more
 * boxes would be advice that cannot work.
 */
export const NO_REFRESH_TOKEN = 'NO_REFRESH_TOKEN';

/**
 * What each scope buys, in the words a student would use.
 *
 * Kept beside the list rather than in a component so that "which permission is
 * missing" and "what to tell the person about it" cannot drift apart. Google's
 * own consent screen describes these differently; a student who declined one
 * needs to know what stopped working, not what the API is called.
 */
const SCOPE_LABELS: Readonly<Record<string, string>> = {
  'https://www.googleapis.com/auth/classroom.courses.readonly':
    'See your list of Classroom courses',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly':
    'Read your coursework and its due dates',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly':
    'See which work you have already turned in',
  'https://www.googleapis.com/auth/classroom.topics.readonly':
    'Read topic names, which say which section a post is for',
};

/**
 * The required scopes Google did not grant.
 *
 * Extra scopes are ignored rather than rejected. Google attaches sign-in scopes
 * (`openid`, `email`, `profile`) to the same token, and treating an unexpected
 * entry as a fault would break every connection the day Google adds one.
 */
export function missingClassroomScopes(granted: readonly string[]): readonly string[] {
  const held = new Set(granted.map((scope) => scope.trim()).filter((scope) => scope !== ''));
  return REQUIRED_CLASSROOM_SCOPES.filter((scope) => !held.has(scope));
}

/** True only when every required scope is present. */
export function hasCompleteClassroomGrant(granted: readonly string[]): boolean {
  return missingClassroomScopes(granted).length === 0;
}

/**
 * Plain-language labels for a set of scopes.
 *
 * An unrecognised scope is dropped rather than shown raw: a URL in a sentence
 * addressed to a student is noise, and the only scopes that reach here are the
 * ones this application asked for.
 */
export function describeScopes(scopes: readonly string[]): readonly string[] {
  return scopes.map((scope) => SCOPE_LABELS[scope]).filter((label): label is string => label !== undefined);
}

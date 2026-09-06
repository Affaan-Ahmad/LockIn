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

type RequiredClassroomScope = (typeof REQUIRED_CLASSROOM_SCOPES)[number];

/**
 * The other scope names under which Google may report a required permission.
 *
 * Google's token describes the *permission it granted*, not the string that was
 * asked for, and it collapses scopes that mean the same thing to it.
 * `classroom.student-submissions.me.readonly` and
 * `classroom.coursework.me.readonly` are one permission on the consent screen --
 * they carry the identical description, "View your course work and grades in
 * Google Classroom", and there is no box a student can untick to accept one and
 * decline the other. Ask for both and the granted token is described by
 * `tokeninfo` as carrying only `classroom.coursework.me.readonly`.
 *
 * Comparing Google's answer against the requested list by string identity
 * therefore read a *complete* grant as one permission short: a student who
 * accepted everything on the consent screen was sent to
 * `/welcome?connection=insufficient_scopes`, the connection was stored
 * NEEDS_RECONNECT / INSUFFICIENT_SCOPES, and reconnecting could not help
 * because the second attempt produced the same token as the first.
 *
 * This relation is deliberately one-way and must stay that way.
 * `classroom.coursework.me.readonly` authorises listing coursework *and*
 * reading the student's own submissions, so it genuinely stands in for the
 * submissions scope. The reverse does not hold, so a grant carrying only
 * `classroom.student-submissions.me.readonly` still leaves the coursework
 * requirement unmet and must keep saying so. Nothing here lowers what the
 * application needs -- it recognises the same access under the name Google
 * chose to report it by.
 */
const EQUIVALENT_SCOPES: Readonly<
  Partial<Record<RequiredClassroomScope, readonly string[]>>
> = {
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly': [
    'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  ],
};

/** Whether the grant carries a required permission, under any name Google uses. */
function isHeld(held: ReadonlySet<string>, required: RequiredClassroomScope): boolean {
  if (held.has(required)) return true;
  return (EQUIVALENT_SCOPES[required] ?? []).some((equivalent) => held.has(equivalent));
}

/**
 * The required scopes Google did not grant.
 *
 * Extra scopes are ignored rather than rejected. Google attaches sign-in scopes
 * (`openid`, `email`, `profile`) to the same token, and treating an unexpected
 * entry as a fault would break every connection the day Google adds one.
 *
 * A required scope counts as granted when Google reports it, or when Google
 * reports an equivalent that confers at least the same access -- see
 * `EQUIVALENT_SCOPES`. What comes back is matched on what it permits, never on
 * whether the string is the one this application happened to ask for.
 */
export function missingClassroomScopes(granted: readonly string[]): readonly string[] {
  const held = new Set(granted.map((scope) => scope.trim()).filter((scope) => scope !== ''));
  return REQUIRED_CLASSROOM_SCOPES.filter((scope) => !isHeld(held, scope));
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

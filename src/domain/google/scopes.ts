/**
 * What a usable Google Classroom grant consists of.
 *
 * This lives in the domain because it is a product rule, not a transport
 * detail: "the connection is only usable if the student granted every
 * permission it asks for" decides what the sync may attempt, what the
 * connection screen says, and whether a stored row counts as connected at all.
 * It was previously implicit in a route that simply asserted the full list had
 * been granted -- which meant a partial consent was recorded as a complete one
 * and the failure surfaced later, as an unexplained Google error mid-sync.
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
 *
 * This is the list sent to the consent screen, and only that. Whether a grant
 * that came back is usable is decided by `REQUIRED_CLASSROOM_PERMISSIONS` below:
 * what to ask for and how to read Google's answer are different questions, and
 * conflating them is what made a complete consent read as an incomplete one.
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

type RequiredClassroomScope = (typeof REQUIRED_CLASSROOM_SCOPES)[number];

interface ClassroomPermission {
  /** The name reported when this permission is absent, and the one labelled. */
  readonly scope: RequiredClassroomScope;
  /** Other names Google may use for the same permission. */
  readonly alsoReportedAs: readonly string[];
  /** What it buys, in the words a student would use. */
  readonly label: string;
}

/**
 * The permissions a usable grant must carry -- one entry per thing a student
 * accepts, not one per requested scope.
 *
 * Google's token describes the *permission it granted*, not the string that was
 * asked for. Exactly one live shape has been observed, on 2026-09-06, after a
 * consent in which every permission was accepted: `granted_scopes` came back as
 * `classroom.courses.readonly`, `classroom.student-submissions.me.readonly`,
 * `classroom.topics.readonly` and the sign-in scopes, with
 * `classroom.coursework.me.readonly` absent. Three of the four requested
 * Classroom scopes, one half of the coursework/submissions pair missing.
 * Comparing that answer against the requested list by string identity read a
 * *complete* grant as one permission short: the student was sent to
 * `/welcome?connection=insufficient_scopes`, the connection was stored
 * NEEDS_RECONNECT / INSUFFICIENT_SCOPES, and reconnecting could not help,
 * because a second consent produced the same token and the same verdict.
 *
 * That one shape is the whole of the evidence. The first attempt at this fix
 * aliased coursework -> submissions only, which presumes the opposite shape --
 * coursework named, submissions absent -- and nothing has ever demonstrated it.
 * Nothing rules it out either: which name Google names back is undocumented and
 * outside this application's control. So both names are accepted and no code
 * here reads *which* one arrived. Treating the observed name as the one Google
 * always picks would be a guess of exactly the shape that caused the bug.
 *
 * Accepting either name grants nothing extra, and that is checkable against the
 * client rather than against a claim about Google's consent screen.
 * `src/infrastructure/google/classroom.client.ts` makes four Classroom calls.
 * `listCourses` and `listTopics` are covered by `classroom.courses.readonly` and
 * `classroom.topics.readonly`, which are required separately below and have no
 * second name. `listCourseWork` and `listStudentSubmissions` are the only calls
 * the pair is required for, and they are the same one consent entry either name
 * stands for -- so whichever name comes back, the set of calls this application
 * will attempt is identical. If a token turns out not to permit one of those two
 * calls, Classroom answers 403 and the client raises `AuthorizationExpiredError`
 * on the operation that needed it: a visible failure at the call, rather than a
 * complete consent misread as an incomplete one on every attempt forever.
 *
 * The pair is one entry here for a second reason. Counted as two requirements, a
 * grant carrying neither name reported two missing permissions and the connect
 * screen listed two bullets -- for one line the student declined once, which is
 * advice they cannot act on twice. `classroom.coursework.me.readonly` is the name
 * reported: coursework is what the product reads (`listCourseWork` supplies the
 * deadlines; submissions only mark which of them are done), and the choice is
 * safe precisely because it is used only when Google reported neither name, so
 * there is nothing for it to contradict.
 *
 * A grant carrying neither name still fails the requirement and must keep saying
 * so.
 *
 * The labels live here rather than in a component so that "which permission is
 * missing" and "what to tell the person about it" cannot drift apart. Google's
 * own consent screen words these differently; a student who declined one needs
 * to know what stopped working, not what the API is called.
 */
const REQUIRED_CLASSROOM_PERMISSIONS: readonly ClassroomPermission[] = [
  {
    scope: 'https://www.googleapis.com/auth/classroom.courses.readonly',
    alsoReportedAs: [],
    label: 'See your list of Classroom courses',
  },
  {
    scope: 'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    alsoReportedAs: ['https://www.googleapis.com/auth/classroom.student-submissions.me.readonly'],
    label: 'Read your coursework, its due dates, and which of it you have turned in',
  },
  {
    scope: 'https://www.googleapis.com/auth/classroom.topics.readonly',
    alsoReportedAs: [],
    label: 'Read topic names, which say which section a post is for',
  },
];

/** Whether the grant carries a permission, under any name Google uses for it. */
function isHeld(held: ReadonlySet<string>, permission: ClassroomPermission): boolean {
  if (held.has(permission.scope)) return true;
  return permission.alsoReportedAs.some((name) => held.has(name));
}

/** The permission a scope name stands for, whichever of its names it is. */
function permissionFor(scope: string): ClassroomPermission | undefined {
  return REQUIRED_CLASSROOM_PERMISSIONS.find(
    (permission) => permission.scope === scope || permission.alsoReportedAs.includes(scope),
  );
}

/**
 * The required permissions Google did not grant, named by scope.
 *
 * One entry per missing permission, never one per unmatched string: the
 * coursework/submissions pair is a single permission under two names, so a grant
 * carrying neither reports one missing item, not two.
 *
 * Extra scopes are ignored rather than rejected. Google attaches sign-in scopes
 * (`openid`, `email`, `profile`) to the same token, and treating an unexpected
 * entry as a fault would break every connection the day Google adds one.
 *
 * A permission counts as granted when Google reports any of its names -- see
 * `REQUIRED_CLASSROOM_PERMISSIONS`. What comes back is matched on the permission
 * it stands for, never on whether the string is the one this application
 * happened to ask for.
 */
export function missingClassroomScopes(granted: readonly string[]): readonly string[] {
  const held = new Set(granted.map((scope) => scope.trim()).filter((scope) => scope !== ''));
  return REQUIRED_CLASSROOM_PERMISSIONS.filter((permission) => !isHeld(held, permission)).map(
    (permission) => permission.scope,
  );
}

/** True only when every required scope is present. */
export function hasCompleteClassroomGrant(granted: readonly string[]): boolean {
  return missingClassroomScopes(granted).length === 0;
}

/**
 * Plain-language labels for a set of scopes.
 *
 * One label per permission, so passing both names of the coursework/submissions
 * pair produces one line rather than the same permission said twice.
 *
 * An unrecognised scope is dropped rather than shown raw: a URL in a sentence
 * addressed to a student is noise, and the only scopes that reach here are the
 * ones this application asked for.
 */
export function describeScopes(scopes: readonly string[]): readonly string[] {
  const labels: string[] = [];
  for (const scope of scopes) {
    const permission = permissionFor(scope);
    if (permission === undefined) continue;
    if (!labels.includes(permission.label)) labels.push(permission.label);
  }
  return labels;
}

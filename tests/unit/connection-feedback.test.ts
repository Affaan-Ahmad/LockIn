import { describe, expect, it } from 'vitest';

import {
  describeScopes,
  hasCompleteClassroomGrant,
  missingClassroomScopes,
  REQUIRED_CLASSROOM_SCOPES,
} from '@/domain/google/scopes';
import {
  CONNECTION_FEEDBACK,
  connectionFeedbackPath,
  connectionRedirectPath,
  describeConnectionFeedback,
} from '@/features/connection/connection-feedback';

/**
 * What the student is told after a connection attempt.
 *
 * The callback is a redirect, so everything it knows has to survive as a query
 * parameter and be turned back into words somewhere else. Those messages used
 * to be appended to `/`, which redirects a half-configured account to
 * `/welcome` and drops the query string doing it -- so every failure the
 * callback could report was invisible, and the student saw only that nothing
 * had happened.
 */

describe('the scope rule', () => {
  it('accepts a grant that carries extra scopes', () => {
    // Google attaches sign-in scopes to the same token. Rejecting anything
    // unexpected would break every connection the day Google adds one.
    expect(
      hasCompleteClassroomGrant([
        ...REQUIRED_CLASSROOM_SCOPES,
        'openid',
        'https://www.googleapis.com/auth/userinfo.email',
      ]),
    ).toBe(true);
  });

  it('names exactly what is missing', () => {
    const granted = REQUIRED_CLASSROOM_SCOPES.filter((scope) => !scope.includes('topics'));

    expect(missingClassroomScopes(granted)).toEqual([
      'https://www.googleapis.com/auth/classroom.topics.readonly',
    ]);
  });

  it('treats an empty grant as missing everything, not as nothing to check', () => {
    // Three permissions, not four scopes: the coursework/submissions pair is one
    // thing a student accepts and is reported as one missing item.
    expect(missingClassroomScopes([])).toEqual([
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      'https://www.googleapis.com/auth/classroom.topics.readonly',
    ]);
  });

  /**
   * The shape the first fix assumed, which has never actually been observed.
   *
   * It is here because the rule must not depend on which of the pair's two names
   * Google names back. Only one live shape has ever been seen -- the submissions
   * one, in the test below -- and the reverse is neither demonstrated nor ruled
   * out. Baking in the observed name would be the same guess that caused the
   * production fault: a complete consent read as one permission short, the
   * student sent to `/welcome?connection=insufficient_scopes`, and reconnecting
   * producing the same token and the same verdict.
   */
  it('accepts a full consent reported under the coursework name alone', () => {
    const reportedUnderCoursework = [
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      // The pair's other name, with the submissions name absent.
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
      'https://www.googleapis.com/auth/classroom.topics.readonly',
    ];

    expect(missingClassroomScopes(reportedUnderCoursework)).toEqual([]);
    expect(hasCompleteClassroomGrant(reportedUnderCoursework)).toBe(true);
  });

  /**
   * The one shape production has actually returned.
   *
   * A live diagnostic taken 2026-09-06 after a consent in which every permission
   * was accepted: the submissions scope present, the coursework scope absent.
   * The first fix aliased coursework -> submissions only, arguing that coursework
   * access subsumes reading one's own submissions but not the reverse -- a claim
   * about the APIs, not about what Google reports -- so it rejected this grant
   * exactly as the original string comparison had, storing the connection
   * NEEDS_RECONNECT / INSUFFICIENT_SCOPES. This fixture is the evidence, and it
   * must keep passing.
   */
  it('accepts the full consent Google reported under the submissions name', () => {
    const liveGrantedScopes = [
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
      'https://www.googleapis.com/auth/classroom.topics.readonly',
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ];

    expect(missingClassroomScopes(liveGrantedScopes)).toEqual([]);
    expect(hasCompleteClassroomGrant(liveGrantedScopes)).toBe(true);
  });

  it('does not let the equivalence excuse a missing courses or topics scope', () => {
    // Only the coursework/submissions pair is one permission with two names.
    // Nothing stands in for these two, so a grant short of either is short.
    const paired = REQUIRED_CLASSROOM_SCOPES.filter(
      (scope) => scope.includes('coursework') || scope.includes('student-submissions'),
    );

    expect(missingClassroomScopes(paired)).toEqual([
      'https://www.googleapis.com/auth/classroom.courses.readonly',
      'https://www.googleapis.com/auth/classroom.topics.readonly',
    ]);
  });

  it('rejects a grant that carries neither name for the coursework permission', () => {
    // The case the equivalence must not swallow: nothing here permits reading
    // the student's work under either name, so the grant is genuinely short.
    const neither = REQUIRED_CLASSROOM_SCOPES.filter(
      (scope) => !scope.includes('coursework') && !scope.includes('student-submissions'),
    );

    expect(hasCompleteClassroomGrant(neither)).toBe(false);
    expect(missingClassroomScopes(neither)).toEqual([
      'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    ]);
  });

  it('reports one missing permission for the pair, not one per requested name', () => {
    // A student declines one line on the consent screen; being told to grant two
    // things is advice they cannot act on twice. The scope named is the one this
    // application reads coursework with, and it is only ever reached when Google
    // reported neither name, so it contradicts nothing Google said.
    const declinedEverything = missingClassroomScopes([]);

    expect(declinedEverything).toHaveLength(3);
    expect(declinedEverything).not.toContain(
      'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
    );
    expect(describeScopes(declinedEverything)).toHaveLength(3);
  });

  it('describes each required permission in words a student would use', () => {
    const labels = describeScopes(REQUIRED_CLASSROOM_SCOPES);

    // Both names of the pair go in; one line comes out, because they are one
    // permission and saying it twice would read as two separate asks.
    expect(labels).toEqual(describeScopes(missingClassroomScopes([])));
    expect(labels).toHaveLength(3);
    // No URLs in a sentence addressed to a person.
    expect(labels.join(' ')).not.toContain('https://');
  });

  it('drops a scope it has no wording for rather than showing the raw URL', () => {
    expect(describeScopes(['https://www.googleapis.com/auth/userinfo.email'])).toEqual([]);
  });
});

describe('connection feedback', () => {
  it('has wording for every outcome the callback can redirect with', () => {
    for (const code of Object.values(CONNECTION_FEEDBACK)) {
      const feedback = describeConnectionFeedback(code);
      expect(feedback, code).not.toBeNull();
      expect(feedback!.title.length).toBeGreaterThan(0);
      expect(feedback!.detail.length).toBeGreaterThan(0);
    }
  });

  it('says nothing for a value it does not recognise', () => {
    // A stale bookmark or an edited URL should show the ordinary screen, not
    // an alarming message about a failure that did not happen.
    expect(describeConnectionFeedback('something-else')).toBeNull();
    expect(describeConnectionFeedback(undefined)).toBeNull();
    expect(describeConnectionFeedback(['denied', 'failed'])).toBeNull();
  });

  it('does not tell a student to retry a permission they declined', () => {
    /**
     * Retrying is the right advice for an outage and useless advice for an
     * unticked checkbox, and the difference is the whole point of the code.
     *
     * Asserted against the sentences the student reads. There used to be a
     * `retryable` boolean here saying the same thing, and it was checked in
     * exactly one place -- this test. The notice renders the tone, the title and
     * the detail and never looked at it, so the flag could have contradicted the
     * wording indefinitely with the suite still green.
     */
    const declined = describeConnectionFeedback(CONNECTION_FEEDBACK.insufficientScopes);
    const unverified = describeConnectionFeedback(CONNECTION_FEEDBACK.unverified);

    expect(declined!.detail.toLowerCase()).not.toContain('try again');
    expect(declined!.detail.toLowerCase()).toContain('granted');
    expect(unverified!.detail.toLowerCase()).toContain('try again');
  });

  it('does not describe an unverified grant as a revoked one', () => {
    // Not knowing what Google granted is a far weaker claim than knowing it was
    // withdrawn, and the wording must not upgrade it.
    const feedback = describeConnectionFeedback(CONNECTION_FEEDBACK.unverified);
    const words = `${feedback!.title} ${feedback!.detail}`.toLowerCase();

    expect(words).not.toContain('revoked');
    expect(words).not.toContain('disconnected');
  });

  it('claims nothing about state the callback cannot observe', () => {
    /**
     * The reassurances that had to go.
     *
     * "Nothing was shared", "nothing was stored", "nothing about your account
     * has changed", "nothing has stopped working" -- each is a claim about state
     * this code never inspects. The callback learns that a step failed. It does
     * not learn what Google did on its side, what an earlier attempt already
     * wrote, or whether the student's existing connection still works.
     *
     * The specific trap is `denied`. A student can decline the *second* consent
     * screen having granted the first, so "nothing was shared" is not merely
     * unprovable, it can be flatly false.
     */
    const unprovable = [
      'nothing was shared',
      'nothing was stored',
      'nothing about your account',
      'nothing has stopped working',
      'has not changed',
      'is untouched',
      'google did not answer',
      'google gave no',
    ];

    for (const code of Object.values(CONNECTION_FEEDBACK)) {
      const feedback = describeConnectionFeedback(code);
      const words = `${feedback!.title} ${feedback!.detail}`.toLowerCase();

      for (const claim of unprovable) {
        expect(words, `${code} claims "${claim}"`).not.toContain(claim);
      }
    }
  });

  it('tells a student that an unrenewable grant was not stored as working', () => {
    // The failure mode this outcome exists for is silent: an account that reads
    // as connected everywhere and stops by itself about an hour later. The
    // message has to say the row was not stored as working, and say what to do.
    const feedback = describeConnectionFeedback(CONNECTION_FEEDBACK.noRefreshToken);

    expect(feedback).not.toBeNull();
    expect(feedback!.detail.toLowerCase()).toContain('needing reconnection');
    expect(feedback!.detail.toLowerCase()).toContain('connect again');
  });
});

describe('where the callback sends each outcome', () => {
  /**
   * The redirect decision, which was previously a switch inside a route that no
   * test could import -- so every branch of it was unproven.
   *
   * The rule that matters is the destination, not the wording: failures must
   * land on `/welcome`. `/` redirects a half-configured account to `/welcome`
   * and drops the query string doing it, so a message attached to `/` is
   * written to a URL nobody ever reads. That is not hypothetical; it is how
   * every message the callback produced used to be lost.
   */
  it('sends a complete, renewable grant onward without a message', () => {
    expect(connectionRedirectPath('CONNECTED')).toBe('/');
  });

  it.each([
    ['INCOMPLETE_SCOPES', CONNECTION_FEEDBACK.insufficientScopes],
    ['NO_REFRESH_TOKEN', CONNECTION_FEEDBACK.noRefreshToken],
    ['UNVERIFIED', CONNECTION_FEEDBACK.unverified],
  ] as const)('sends %s to /welcome carrying %s', (kind, code) => {
    expect(connectionRedirectPath(kind)).toBe(`/welcome?connection=${code}`);
  });

  it('never drops a failure message onto the dashboard', () => {
    for (const kind of ['INCOMPLETE_SCOPES', 'NO_REFRESH_TOKEN', 'UNVERIFIED'] as const) {
      expect(connectionRedirectPath(kind).startsWith('/welcome?')).toBe(true);
    }
  });

  it('routes every message the route can emit to a path that renders it', () => {
    // The other half of the loop: a code that redirects somewhere the screen
    // does not read is the same bug as a message with no wording.
    for (const code of Object.values(CONNECTION_FEEDBACK)) {
      const path = connectionFeedbackPath(code);

      expect(path).toBe(`/welcome?connection=${code}`);
      const value = new URL(path, 'https://lockinapp.tech').searchParams.get('connection');
      expect(describeConnectionFeedback(value ?? undefined)).not.toBeNull();
    }
  });
});

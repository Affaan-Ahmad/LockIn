import { LegalTitle, SECURITY_CONTACT, Section } from '../content';

/**
 * The limits of what LockIn can promise.
 *
 * Its own page rather than a clause buried in the terms, because it is the part
 * a student most needs to have read: an app that filters deadlines can cause a
 * missed one, and pretending otherwise would be the dishonest choice.
 */
export const metadata = {
  title: 'Disclaimer · LockIn',
  description: 'What LockIn can and cannot promise about your deadlines.',
};

export default function DisclaimerPage() {
  return (
    <article>
      <LegalTitle>Disclaimer</LegalTitle>

      <Section heading="LockIn is not the source of truth">
        <p>
          Google Classroom is. LockIn is a filtered view of it, built to cut noise, and a filtered
          view can filter out the wrong thing.
        </p>
      </Section>

      <Section heading="How it can be wrong">
        <p>
          LockIn works out which assignments belong to your section by reading section labels out of
          the title and description a teacher wrote. That text is written by people, inconsistently,
          and sometimes it names no section at all.
        </p>
        <p>
          A post that mentions no section is treated as being for everyone, which is usually right.
          Where the text is ambiguous the assignment goes to the Review screen and you are asked,
          rather than handed a guess dressed as an answer. Neither behaviour makes it impossible for
          a real deadline to be missed.
        </p>
        <p>
          It also depends on syncing. If a sync fails, or your Google access expires, what you are
          looking at is old. LockIn says so on the screen instead of quietly presenting stale work
          as current, but you have to read the warning.
        </p>
      </Section>

      <Section heading="No warranty">
        <p>
          LockIn is provided as it is, with no guarantee that it is accurate, complete, available or
          fit for any particular purpose. To the extent the law allows, no liability is accepted for
          a missed deadline, a lost mark, or any other loss arising from its use.
        </p>
        <p>You are responsible for your own coursework. Check Google Classroom.</p>
      </Section>

      <Section heading="No affiliation">
        <p>
          LockIn is an independent project. It is not affiliated with, endorsed by or sponsored by
          Google LLC or any university. Google Classroom is a trademark of Google LLC, used here
          only to describe what the product reads.
        </p>
      </Section>

      <Section heading="Reporting a problem">
        <p>
          Security issues go to {SECURITY_CONTACT}. If LockIn hid work that was genuinely yours,
          that is a correctness bug worth reporting, not just an inconvenience.
        </p>
      </Section>
    </article>
  );
}

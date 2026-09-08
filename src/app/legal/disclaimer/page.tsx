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
          Google Classroom is, for coursework. Your university&rsquo;s published timetable is, for
          classes. LockIn is a filtered view of both, built to cut noise, and a filtered view can
          filter out the wrong thing.
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

      <Section heading="How the timetable can be wrong">
        <p>
          The timetable screen is read automatically from the spreadsheet your university publishes.
          Nothing is typed in by hand and nothing is invented, but that document is written by
          people and LockIn has to interpret it.
        </p>
        <p>
          Which intake a class belongs to is recorded only in the colour of its cell, so two classes
          can read identically and mean different years. Times, rooms and cancellations are written
          as free text. Where a cell cannot be read confidently, LockIn shows it and marks it rather
          than dropping it or guessing &mdash; but a marked entry is still one you should check
          against the original.
        </p>
        <p>
          Which laboratory subgroup you belong to is not published anywhere in the document, so both
          are shown to you. Only you know which is yours.
        </p>
        <p>
          The timetable is re-read periodically rather than continuously. If re-reading fails,
          LockIn keeps showing the last copy it retrieved and says so on the screen. A class moved
          in the last few minutes may not have reached you yet.
        </p>
      </Section>

      <Section heading="Free rooms are not bookings">
        <p>
          A room LockIn calls free is one where it found no class in the published timetable for the
          period you asked about. That is not the same as the room being available: it may be
          booked for something the timetable does not list, locked, or in use by people who did not
          need to book it.
        </p>
        <p>
          Rooms holding something LockIn could not read are left out of the answer rather than
          counted as empty, and the screen says how many were left out. Treat the result as a place
          to look, not as permission to be there.
        </p>
      </Section>

      <Section heading="No warranty">
        <p>
          LockIn is provided as it is, with no guarantee that it is accurate, complete, available or
          fit for any particular purpose. To the extent the law allows, no liability is accepted for
          a missed deadline, a lost mark, or any other loss arising from its use.
        </p>
        <p>
          You are responsible for your own coursework and for turning up to your own classes. Check
          Google Classroom, and check the timetable your university publishes.
        </p>
      </Section>

      <Section heading="No affiliation">
        <p>
          LockIn is an independent project. It is not affiliated with, endorsed by or sponsored by
          Google LLC or any university. Google Classroom is a trademark of Google LLC, used here
          only to describe what the product reads. The class timetable is your
          university&rsquo;s own document, shown to you as it published it; LockIn neither maintains
          it nor speaks for whoever does, and displaying it implies no endorsement in either
          direction.
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

import {
  CONTROLLER,
  JURISDICTION,
  LegalTitle,
  List,
  PRIVACY_CONTACT,
  Section,
  SECURITY_CONTACT,
} from '../content';

/**
 * What LockIn stores, why, and how to get rid of it.
 *
 * Written from the schema and the OAuth scope list rather than from a template,
 * so every claim here is checkable against the code. If a table is added, this
 * page is wrong until it is updated, which is the point.
 */
export const metadata = {
  title: 'Privacy policy · LockIn',
  description: 'What LockIn stores, why it stores it, and how to delete it.',
};

export default function PrivacyPage() {
  return (
    <article>
      <LegalTitle>Privacy policy</LegalTitle>

      <Section heading="Who is responsible">
        <p>
          LockIn is run by {CONTROLLER}, an individual based in {JURISDICTION}. It is not a company.
          Questions about your data go to {PRIVACY_CONTACT}.
        </p>
      </Section>

      <Section heading="What LockIn reads from Google Classroom">
        <p>
          LockIn asks Google for read-only access to four things, and nothing else. It cannot post,
          submit, grade, edit or delete anything in Classroom, because it never requests permission
          to.
        </p>
        <List
          items={[
            'Your course list, including course names and the section label the teacher set.',
            'Coursework in the courses you choose to track: titles, descriptions, due dates and links.',
            'Course topics, used to group work.',
            'Your own submission state, so work you have already turned in stops appearing as outstanding.',
          ]}
        />
        <p>
          The submission data Google returns also contains your grades. LockIn discards them on
          arrival and has no column to store them in. No part of the product reads or shows a grade.
        </p>
      </Section>

      <Section heading="What LockIn stores">
        <List
          items={[
            'Your email address and Google account identifier, to identify your account.',
            'Your section, programme code, batch and any alternative spellings you add, which is what the section matching runs on.',
            'Your time zone, which decides when a deadline counts as due today.',
            'Course names, sections and state for the courses Google shows you.',
            'Coursework titles, descriptions, due dates and links for the courses you track.',
            'Whether each piece of work is turned in, and whether it was late.',
            'What LockIn decided about each assignment, the section evidence it found, and how confident it was.',
            'Your own decisions: which courses to track, which assignments are yours, and what you have hidden.',
            'Your Google access and refresh tokens, encrypted.',
            'A history of sync attempts and any errors, used to tell you how current your data is.',
          ]}
        />
      </Section>

      <Section heading="Why the classification evidence is kept">
        <p>
          When LockIn decides an assignment is not for your section, it stores the reason: which
          section labels it found in the post and how it read them. That record exists so the
          decision can be explained to you and corrected, rather than being an unaccountable
          judgement about your coursework. It is also what makes the &ldquo;Review&rdquo; screen
          able to show you why it was unsure.
        </p>
      </Section>

      <Section heading="Who else sees it">
        <p>
          Nobody buys it, and it is not used for advertising, profiling or training any model. Three
          providers necessarily process it in order for the product to run:
        </p>
        <List
          items={[
            'Google, which is the source of the coursework and handles sign-in.',
            'Supabase, which hosts the database and the authentication service.',
            'The hosting provider that serves the application and its request logs.',
          ]}
        />
        <p>
          Your data is never shared with your teachers, your university, or other students. LockIn
          reads Classroom as you, and shows the result only to you.
        </p>
      </Section>

      <Section heading="Deleting it">
        <p>
          Settings has two separate controls. Disconnecting Google revokes LockIn&rsquo;s access and
          deletes the stored tokens, while leaving the coursework already imported in place, so
          nothing updates but nothing disappears. Deleting your account removes the profile,
          courses, coursework, submission records, classifications and every decision you have made,
          and revokes the Google grant.
        </p>
        <p>
          Account deletion is immediate and cannot be undone. It is not a request queue and there is
          no recovery window.
        </p>
      </Section>

      <Section heading="How long it is kept">
        <p>
          Coursework and your decisions are kept until you delete your account or stop tracking the
          course. Sync history and error records currently have no automatic expiry, which is a
          known gap rather than a deliberate choice, and it is recorded as an open item in the
          project&rsquo;s own release checklist.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          Google tokens are encrypted before they are stored, and the table holding them is
          unreadable through the public API by any client, including your own. Every other table is
          protected by database-level row security, so one student&rsquo;s query cannot return
          another student&rsquo;s rows even if the application asks for them.
        </p>
        <p>
          No system is secure in an absolute sense and this page does not claim that. To report
          something, write to {SECURITY_CONTACT}.
        </p>
      </Section>

      <Section heading="Children">
        <p>
          LockIn is built for university students and is not directed at children. If you believe a
          child has created an account, write to {PRIVACY_CONTACT} and it will be deleted.
        </p>
      </Section>

      <Section heading="Changes">
        <p>
          This page changes when the product does. Because it is written from the database schema,
          a change to what is stored is a change here.
        </p>
      </Section>
    </article>
  );
}

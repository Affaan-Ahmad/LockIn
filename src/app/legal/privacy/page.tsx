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

      <Section heading="What LockIn reads from Google">
        <p>
          Four Classroom permissions, all of them read-only. LockIn cannot post, submit, grade, edit
          or delete anything in Classroom, because it does not request permission to and the
          read-only scopes it holds do not allow it.
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
          Signing in with Google also involves the basic sign-in permissions every Google
          login uses: your email address and your Google account identifier. That is how LockIn
          knows whose coursework to show, and it is what the Google consent screen will list
          alongside the four above.
        </p>
        <p>
          The submission data Google returns also contains your grades. LockIn drops them at the
          point the response is read, before anything is written, and the database has no column to
          put them in. No part of the product reads, stores or shows a grade.
        </p>
      </Section>

      <Section heading="How LockIn uses what it reads">
        <p>
          Only to run the features you can see: listing your courses so you can choose which to
          follow, organising coursework by deadline, working out which work applies to your section,
          and marking work you have already turned in so it stops being listed as outstanding.
        </p>
        <p>
          It is not used for advertising or profiling, it is not sold, and it is not used to train
          any machine-learning model.
        </p>
        <p>
          LockIn&rsquo;s use and transfer of information received from Google APIs adheres to the{' '}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="font-medium text-brand-ink hover:underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
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

      <Section heading="Who else processes it">
        <p>
          LockIn does not sell your personal data. Three providers necessarily process it in order
          for the product to run:
        </p>
        <List
          items={[
            'Google, which is the source of the coursework and handles sign-in.',
            'Supabase, which hosts the database and the authentication service.',
            'Vercel, which hosts and serves the application and keeps its request logs.',
          ]}
        />
        <p>
          There is no analytics service, no advertising network, no session recording and no error
          reporting service. Nothing else receives your data.
        </p>
        <p>
          LockIn does not disclose your coursework to your teachers, your university, or other
          students. It reads Classroom as you, and shows the result only to you. Access to the
          underlying database is limited to the person named above and to the providers listed here
          in the course of operating their services.
        </p>
      </Section>

      <Section heading="Disconnecting Google">
        <p>
          Disconnecting stops all future synchronisation and removes the stored Google credentials
          from the database. LockIn also asks Google to revoke the grant. If Google is unreachable
          at that moment the local credentials are still cleared, and LockIn tells you so on the
          screen, because refusing to disconnect you because a third party was down would be the
          wrong way round. You can always remove the grant yourself from your Google account
          permissions page.
        </p>
        <p>
          Coursework already imported stays where it is. Disconnecting stops the updates; it does
          not delete what you already have.
        </p>
      </Section>

      <Section heading="Deleting your account">
        <p>
          Deleting your account removes your profile, your section and aliases, your courses,
          coursework, submission records, classifications, manual overrides, hidden items, sync
          history and stored Google credentials. Every one of those tables is tied to your account
          in the database and removed with it, in one operation rather than a queue.
        </p>
        <p>
          LockIn asks Google to revoke the grant first, so that it is withdrawn while the credential
          to withdraw it still exists. If that call fails the deletion still goes ahead and the
          failure is logged, so it is possible for your data to be gone here while the grant remains
          listed in your Google account until you remove it there.
        </p>
        <p>
          Deletion from the live application database is immediate and cannot be undone. It is not a
          request queue and there is no recovery window. What it cannot reach are the operational
          copies kept by the providers above: database backups and server request logs, which expire
          on those providers&rsquo; own schedules rather than on demand. Anyone claiming a deletion
          reaches every copy everywhere the instant it is pressed is describing a system simpler
          than this one.
        </p>
      </Section>

      <Section heading="Getting a copy">
        <p>
          Settings has a link that downloads a JSON file containing your email address, your section
          and the alternative spellings LockIn matches on, your time zone, your courses and which
          you track, your coursework with its due dates and links, what LockIn decided about each
          assignment and how confident it was, which section scope it concluded, whether you
          overrode it, whether the work is turned in, what you have hidden, and when the last
          successful sync ran.
        </p>
        <p>
          Some things it holds are not in that file. Assignment descriptions, course topics, the
          detailed rule-by-rule evidence behind each classification, and the full sync error history
          are stored but not exported, and the export is capped at one thousand items per category.
          If you want any of those, ask at {PRIVACY_CONTACT} and they will be provided.
        </p>
        <p>
          Your Google tokens are deliberately excluded. They are credentials rather than information
          about you, and putting a live key to your Classroom account in your downloads folder would
          be a worse outcome than omitting it.
        </p>
      </Section>

      <Section heading="How long it is kept">
        <p>
          Coursework and your decisions are kept until you delete your account or stop tracking the
          course.
        </p>
        <p>
          A record of each sync attempt and any errors is kept so LockIn can tell you how current
          your data is and so failures can be diagnosed. It is removed when you delete your account.
          Automatic pruning of older sync history is built but is not yet running on a schedule, so
          this page does not claim a fixed retention period for it.
        </p>
      </Section>

      <Section heading="Security">
        <p>
          Google tokens are encrypted with AES-256-GCM before they are stored, using a key held in
          the server environment and never in the database, and each token is bound to the account
          it belongs to so a row copied between accounts fails to decrypt rather than opening
          somebody else&rsquo;s Classroom. The table holding them has row-level security enabled
          with no policies at all, which means no client role can read it through the public API,
          including yours.
        </p>
        <p>
          Every other table carries row-level security tied to your account, so one student&rsquo;s
          query cannot return another student&rsquo;s rows even if the application asks wrongly.
          Those policies are exercised by an automated test suite that signs in as two separate
          accounts and checks that neither can reach the other&rsquo;s data.
        </p>
        <p>
          No system is secure in an absolute sense and this page does not claim that. To report
          something, write to {SECURITY_CONTACT}.
        </p>
      </Section>

      <Section heading="Who it is for">
        <p>
          LockIn is built for university students and is not directed at children. It does not ask
          for a date of birth and does not verify age, so it cannot enforce a minimum; it relies on
          the fact that you already hold a Google account able to access Google Classroom coursework
          at a university.
        </p>
        <p>
          If you believe a child has created an account, write to {PRIVACY_CONTACT} and it will be
          deleted.
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

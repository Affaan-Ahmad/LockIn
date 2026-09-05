import { CONTROLLER, JURISDICTION, LegalTitle, List, PRIVACY_CONTACT, Section } from '../content';

/**
 * The agreement, such as it is.
 *
 * Short on purpose. A free tool run by one person does not need ten thousand
 * words of boilerplate, and padding it would bury the one clause that actually
 * matters, which is that LockIn can be wrong about your deadlines.
 */
export const metadata = {
  title: 'Terms and Conditions · LockIn',
  description: 'The terms you agree to by using LockIn.',
};

export default function TermsPage() {
  return (
    <article>
      <LegalTitle>Terms and Conditions</LegalTitle>

      <Section heading="What LockIn is">
        <p>
          LockIn reads your Google Classroom coursework and tries to show you only the work that
          applies to your section. It is run by {CONTROLLER}, an individual in {JURISDICTION}, and
          is provided free of charge.
        </p>
        <p>
          It is not affiliated with, endorsed by, or connected to Google, your university, or any
          educational institution.
        </p>
      </Section>

      <Section heading="Your account">
        <p>
          You sign in with Google, so your account is only as secure as your Google account, and
          keeping that secure is your responsibility. LockIn is intended for university students.
          You must be old enough to hold a Google account and to enter an agreement in your own
          country; LockIn does not ask your age and cannot verify it.
        </p>
      </Section>

      <Section heading="What you agree not to do">
        <List
          items={[
            'Access anyone else’s account or data, or attempt to.',
            'Sign in using another student’s Google credentials.',
            'Automate requests at a volume that degrades the service for other people.',
            'Break, probe or bypass the security controls, other than to report what you find.',
          ]}
        />
        <p>
          Security research is welcome. Report what you find rather than exploiting it; nothing here
          is meant to discourage a good-faith report.
        </p>
      </Section>

      <Section heading="LockIn can be wrong">
        <p>
          The term that matters most, so it is not buried. LockIn decides which assignments are
          yours by reading section labels out of text a teacher wrote. Teachers write those labels
          inconsistently, and sometimes not at all.
        </p>
        <p>
          A post that names no section at all is treated as being for everyone, which is usually
          right and occasionally not. Where the text names sections but LockIn cannot tell whether
          yours is among them, the assignment goes to the Review screen and you are asked instead of
          being handed a guess.
        </p>
        <p>
          It will sometimes hide work that was yours, and sometimes show work that was not. You
          remain responsible for your own deadlines, and Google Classroom remains the authoritative
          source.
        </p>
      </Section>

      <Section heading="Google and other services">
        <p>
          LockIn depends on Google Classroom, and on Supabase and Vercel to run. Their terms apply
          to their own services, and LockIn cannot control their availability or their decisions.
          Google may withdraw or change API access at any time, which would stop synchronisation
          working regardless of anything done here.
        </p>
        <p>
          LockIn requests read-only Classroom permissions and cannot change anything in your
          Classroom account. Google Classroom remains the authoritative record of your coursework.
        </p>
      </Section>

      <Section heading="Availability">
        <p>
          There is no uptime guarantee. The service may be unavailable, may lose access to Google
          without warning, and may be discontinued. If it is discontinued you will be told where
          that is reasonably possible, and you can delete your data yourself at any time.
        </p>
      </Section>

      <Section heading="Ending it">
        <p>
          You can stop using LockIn whenever you like. Settings has two controls: disconnecting
          Google stops future synchronisation and removes the stored credentials while leaving the
          coursework already imported in place, and deleting your account removes your data from the
          live database and asks Google to revoke the grant.
        </p>
        <p>
          Deletion from the application database is immediate and cannot be undone. Backups and
          server logs held by the hosting and database providers expire on their own schedules; the
          privacy policy sets that out. Access may be suspended for anyone doing the things listed
          above.
        </p>
      </Section>

      <Section heading="Governing law">
        <p>
          These terms are governed by the laws of {JURISDICTION}. Questions go to {PRIVACY_CONTACT}.
        </p>
      </Section>
    </article>
  );
}

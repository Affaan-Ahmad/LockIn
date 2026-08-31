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
          keeping that secure is your responsibility. You must be old enough to hold a Google
          account and to enter an agreement in your own country.
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
          It will sometimes hide work that was yours, and sometimes show work that was not. Where it
          cannot tell, it says so on the Review screen rather than guessing. You remain responsible
          for your own deadlines, and Google Classroom remains the authoritative source.
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
          You can stop using LockIn whenever you like and delete your account from Settings, which
          removes your data immediately. Access may be suspended for anyone doing the things listed
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

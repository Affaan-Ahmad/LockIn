'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cx } from '@/lib/cx';

/**
 * Disconnecting Google, and deleting the account.
 *
 * Two separate actions with genuinely different consequences, kept apart so
 * neither can be taken for the other. Disconnecting stops the syncing and
 * leaves the record; deleting removes the record and cannot be undone.
 *
 * Neither is a one-tap action, and neither is a dark pattern in the other
 * direction: the confirmation exists because the action is irreversible, not to
 * wear the student down. Deletion asks for typed confirmation because
 * `{"confirm":true}` is something a misfiring client can send by accident and
 * "DELETE MY ACCOUNT" is not.
 *
 * Deletion is the one place here that uses a real dialog. An inline panel let
 * the page scroll behind it, kept the rest of the page in the tab order, and
 * did not close on Escape, which is the wrong set of properties for the only
 * irreversible action in the product. Radix supplies the focus trap, the scroll
 * lock and the aria wiring; those are genuinely hard to get right by hand, and
 * that is what its weight is being spent on.
 */

export interface DangerZoneProps {
  readonly connected: boolean;
}

export function DangerZone({ connected }: DangerZoneProps) {
  return (
    <div className="flex flex-col gap-4">
      <DisconnectCard connected={connected} />
      <DeleteCard />
    </div>
  );
}

function DisconnectCard({ connected }: { readonly connected: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function disconnect() {
    setBusy(true);
    setFailed(false);
    setMessage(null);

    try {
      const response = await fetch('/api/connection', { method: 'DELETE' });
      const body = (await response.json()) as {
        readonly revokedAtGoogle?: boolean;
        readonly note?: string;
        readonly error?: { readonly message?: string };
      };

      if (!response.ok) {
        setFailed(true);
        setMessage(body.error?.message ?? "Couldn't disconnect.");
        return;
      }

      // Whether Google actually revoked the grant is reported honestly. If the
      // revoke call failed, the token here is gone but the grant on Google's
      // side is not, and the student needs to know to finish it themselves.
      setMessage(
        body.revokedAtGoogle === true
          ? 'Disconnected, and access was revoked at Google.'
          : (body.note ??
              'Disconnected here. Google may still list LockIn. Remove it in your Google account.'),
      );
      setConfirming(false);
      router.refresh();
    } catch {
      setFailed(true);
      setMessage('Network problem. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-raised p-4">
      <h3 className="text-base font-semibold text-ink">Google Classroom</h3>
      <p className="measure mt-1 text-sm leading-relaxed text-ink-soft">
        {connected
          ? 'LockIn reads your courses and coursework. Disconnecting stops all syncing. Your existing deadlines stay, and stop updating.'
          : 'Not connected. LockIn cannot see any coursework until you connect.'}
      </p>

      {!connected ? (
        <a href="/api/auth/google" className="mt-3 inline-block">
          <Button variant="primary" size="sm">
            Connect Google Classroom
          </Button>
        </a>
      ) : confirming ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="danger" size="sm" busy={busy} onClick={() => void disconnect()}>
            Yes, disconnect
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setConfirming(false);
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => {
            setConfirming(true);
          }}
        >
          Disconnect
        </Button>
      )}

      {message === null ? null : (
        <p
          role="status"
          className={cx('mt-3 text-sm', failed ? 'text-danger' : 'text-ink-soft')}
        >
          {message}
        </p>
      )}
    </section>
  );
}

const CONFIRM_PHRASE = 'DELETE MY ACCOUNT';

function DeleteCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: CONFIRM_PHRASE }),
      });

      if (!response.ok) {
        const body = (await response.json()) as { readonly error?: { readonly message?: string } };
        setError(body.error?.message ?? "Couldn't delete the account.");
        return;
      }

      // The session is gone with the account, so there is nowhere to return to.
      router.push('/welcome');
      router.refresh();
    } catch {
      setError('Network problem. Nothing was deleted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface-flat border-danger/35 bg-danger-soft p-4">
      <h3 className="text-base font-semibold text-ink">Delete your account</h3>
      <p className="measure mt-1 text-sm leading-relaxed text-ink-soft">
        Removes your profile, courses, coursework, classifications and your decisions, and revokes
        LockIn&rsquo;s access to your Google account. This cannot be undone.
      </p>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // Closing clears the phrase. Leaving it typed would mean a reopened
          // dialog is one click from deleting the account.
          if (!next) setTyped('');
        }}
      >
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm" className="mt-3">
            Delete account
          </Button>
        </DialogTrigger>

        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete your account?</DialogTitle>
            <DialogDescription>
              This removes your profile, courses, coursework, classifications and every decision
              you have made, and revokes LockIn&rsquo;s access to your Google account. It cannot be
              undone.
            </DialogDescription>
          </DialogHeader>

          <div className="mt-1">
            <label htmlFor="confirm-delete" className="block text-sm font-semibold text-ink">
              Type <span className="font-mono">{CONFIRM_PHRASE}</span> to confirm
            </label>
            <input
              id="confirm-delete"
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
              autoComplete="off"
              className="surface-sunken mt-1.5 min-h-11 w-full rounded-control px-3.5 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-danger"
            />
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setOpen(false);
                setTyped('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              busy={busy}
              disabled={typed !== CONFIRM_PHRASE}
              onClick={() => void remove()}
            >
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error === null ? null : (
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { cx } from '@/lib/cx';
import { SKIN_DESCRIPTION, SKIN_LABEL, type Skin } from '@/lib/skin';

/**
 * Which of the two front ends to use.
 *
 * Two native radios, for the same reason the clock and theme controls use them:
 * a radio group already ships arrow-key navigation, roving focus, forced-colours
 * support and the correct announcement, and a menu component would cost tens of
 * kilobytes to choose between two values.
 *
 * Not optimistic, and that is the difference from the clock. Switching skin
 * replaces the page frame, the navigation and the composition of Today, all of
 * which are built on the server. Flipping the radio before the server agrees
 * would leave the control claiming one design while the whole screen around it
 * still showed the other -- a far more confusing half-second than a control that
 * simply waits. It reverts on failure either way.
 */

const OPTIONS: readonly Skin[] = ['paper', 'workbench'];

export interface SkinToggleProps {
  readonly initial: Skin;
}

export function SkinToggle({ initial }: SkinToggleProps) {
  const router = useRouter();
  const name = useId();
  const [skin, setSkin] = useState<Skin>(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function choose(next: Skin): Promise<void> {
    if (next === skin || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch('/api/preferences/skin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skin: next }),
      });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      setSkin(next);
      // The frame itself is server-rendered, so the page has to be asked again.
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <fieldset className="flex flex-col gap-2" disabled={busy}>
        <legend className="sr-only">Design</legend>
        {OPTIONS.map((option) => {
          const active = skin === option;
          return (
            <label
              key={option}
              className={cx(
                'flex cursor-pointer items-start gap-3 rounded-sm p-3 transition-[box-shadow,background-color] duration-[160ms]',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-ink',
                busy && 'cursor-progress opacity-60',
                active ? 'bg-p3 shadow-lift-2' : 'bg-p1 shadow-press hover:shadow-lift-1',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option}
                checked={active}
                onChange={() => void choose(option)}
                className="mt-0.5 size-4 shrink-0 accent-[var(--kraft-3)]"
              />
              <span className="min-w-0">
                <span className="block text-[13.5px] font-semibold text-ink">
                  {SKIN_LABEL[option]}
                  {option === 'paper' ? (
                    <span className="ml-2 font-normal text-ink-faint">default</span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-soft">
                  {SKIN_DESCRIPTION[option]}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {failed ? (
        <p role="alert" className="text-xs text-ink-soft">
          That could not be saved.
        </p>
      ) : null}
    </div>
  );
}

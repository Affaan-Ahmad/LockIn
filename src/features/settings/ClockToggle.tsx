'use client';

import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';

import { formatClock, type TimeFormat } from '@/lib/clock';
import { cx } from '@/lib/cx';

/**
 * Twelve-hour or twenty-four-hour.
 *
 * Two native radios, for the same reason the theme control uses them: a radio
 * group already ships arrow-key navigation, roving focus, forced-colours
 * support and the correct announcement, and a menu component would cost tens of
 * kilobytes to pick one of two values.
 *
 * Unlike the theme, this is stored server-side in a cookie. The timetable is
 * rendered on the server, so a preference the server could not read would mean
 * painting every time in the wrong format and correcting it after hydration --
 * a flicker on exactly the number a student is reading the screen for.
 *
 * The label shows the format rather than naming it: "2:30 pm" and "14:30" say
 * what you are choosing more directly than "12-hour" and "24-hour" do.
 */

const OPTIONS: ReadonlyArray<{ readonly value: TimeFormat }> = [{ value: '12' }, { value: '24' }];

/** Half past two, as a sample. Recognisable, and unambiguous in both formats. */
const SAMPLE_MINUTE = 14 * 60 + 30;

export interface ClockToggleProps {
  readonly initial: TimeFormat;
}

export function ClockToggle({ initial }: ClockToggleProps) {
  const router = useRouter();
  const name = useId();
  const [format, setFormat] = useState<TimeFormat>(initial);
  const [failed, setFailed] = useState(false);

  async function choose(next: TimeFormat): Promise<void> {
    const previous = format;
    // Optimistic: the control answers immediately, and reverts if the write
    // does not land, rather than sitting inert while a request is in flight.
    setFormat(next);
    setFailed(false);
    try {
      const response = await fetch('/api/preferences/time-format', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeFormat: next }),
      });
      if (!response.ok) {
        setFormat(previous);
        setFailed(true);
        return;
      }
      // Times are rendered on the server, so the pages holding them have to be
      // asked again.
      router.refresh();
    } catch {
      setFormat(previous);
      setFailed(true);
    }
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <fieldset className="surface-sunken flex shrink-0 gap-1 rounded-control p-1">
        <legend className="sr-only">Clock format</legend>
        {OPTIONS.map((option) => {
          const active = format === option.value;
          return (
            <label
              key={option.value}
              className={cx(
                'relative flex min-h-11 cursor-pointer items-center rounded-control px-3.5',
                'text-sm font-medium transition-colors duration-[120ms]',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-ink',
                active
                  ? 'bg-raised font-semibold text-ink shadow-raised'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => void choose(option.value)}
                className="sr-only"
              />
              <span className="relative tabular-nums">{formatClock(SAMPLE_MINUTE, option.value)}</span>
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

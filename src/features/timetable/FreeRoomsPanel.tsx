'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { formatClock, type TimeFormat } from '@/lib/clock';
import { cx } from '@/lib/cx';

/**
 * "Where can I sit right now."
 *
 * Asked on demand rather than rendered with the page, because the answer is
 * only true for the minute it was asked in. A list baked into the page at
 * 11:04 and read at 11:40 would be quietly wrong, and quietly wrong is the one
 * thing a room finder must not be.
 *
 * The server decides what "now" means, from the campus clock. A device with the
 * wrong time -- or someone abroad -- would otherwise be told a room in use is
 * empty.
 */

interface FreeRoom {
  readonly room: string;
  readonly freeUntilMinute: number | null;
  readonly cancelledHere: readonly string[];
}

interface RoomsResponse {
  readonly weekday: string | null;
  readonly atMinute: number;
  readonly forMinutes: number;
  readonly occupiedCount: number;
  readonly unknownCount: number;
  readonly rooms: readonly FreeRoom[];
}

const DURATIONS = [30, 60, 120] as const;

export interface FreeRoomsPanelProps {
  readonly timeFormat: TimeFormat;
}

export function FreeRoomsPanel({ timeFormat }: FreeRoomsPanelProps) {
  const [result, setResult] = useState<RoomsResponse | null>(null);
  const [forMinutes, setForMinutes] = useState<number>(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function find(minutes: number): Promise<void> {
    setLoading(true);
    setError(null);
    setForMinutes(minutes);
    try {
      const response = await fetch(`/api/timetable/rooms?forMinutes=${String(minutes)}`);
      if (!response.ok) {
        setError('The timetable could not be read just now.');
        setResult(null);
        return;
      }
      setResult((await response.json()) as RoomsResponse);
    } catch {
      setError('The timetable could not be read just now.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {DURATIONS.map((minutes) => (
          <Button
            key={minutes}
            variant={minutes === forMinutes && result !== null ? 'primary' : 'secondary'}
            size="sm"
            busy={loading && minutes === forMinutes}
            onClick={() => void find(minutes)}
          >
            {minutes < 60 ? `${String(minutes)} min` : `${String(minutes / 60)} hr`}
          </Button>
        ))}
      </div>

      {error === null ? null : (
        <p role="alert" className="text-xs text-ink-soft">
          {error}
        </p>
      )}

      {result === null ? (
        <p className="text-xs text-ink-muted">
          Shows rooms with no class in them for that long, starting now.
        </p>
      ) : (
        <Results result={result} timeFormat={timeFormat} />
      )}
    </div>
  );
}

function Results({
  result,
  timeFormat,
}: {
  readonly result: RoomsResponse;
  readonly timeFormat: TimeFormat;
}) {
  if (result.weekday === null) {
    return (
      <p className="text-xs text-ink-muted">
        Nothing is published for today, so there is nothing to check.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-ink-soft">
        Free from {formatClock(result.atMinute, timeFormat)} for {result.forMinutes} minutes.
      </p>

      {result.rooms.length === 0 ? (
        <p className="text-sm text-ink">Every room is in use for that long.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-control border border-line bg-raised">
          {result.rooms.slice(0, 12).map((room) => (
            <li key={room.room} className="flex items-baseline justify-between gap-3 px-3 py-2">
              <span className="text-sm font-medium text-ink">{room.room}</span>
              <span className={cx('shrink-0 text-xs', 'text-ink-muted')}>
                {room.freeUntilMinute === null
                  ? 'rest of the day'
                  : `until ${formatClock(room.freeUntilMinute, timeFormat)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {result.rooms.length > 12 ? (
        <p className="text-xs text-ink-muted">
          and {String(result.rooms.length - 12)} more.
        </p>
      ) : null}

      {/*
        Said plainly rather than hidden. These are rooms holding something the
        parser could not read -- a tutorial, a seminar with no section. They may
        well be empty, but claiming so would be the one mistake that sends
        somebody to a room with a class in it.
      */}
      {result.unknownCount > 0 ? (
        <p className="text-xs text-ink-muted">
          {String(result.unknownCount)} more{' '}
          {result.unknownCount === 1 ? 'room holds something' : 'rooms hold something'} the sheet
          does not describe clearly enough to call empty.
        </p>
      ) : null}
    </div>
  );
}

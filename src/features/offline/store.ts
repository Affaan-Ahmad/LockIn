/**
 * The only copy of a student's coursework that lives on their device.
 *
 * Everything else in this application is fetched per request and forgotten. This
 * exists so the installed app is readable on a train, and it is written with the
 * assumption that it will one day sit on a shared laptop.
 *
 * THE RULES
 * =========
 *
 *   One record, ever. Not one per user — a single record stamped with whose it
 *   is. Writing for a different user wipes what was there first, so two accounts
 *   can never have coursework on the device at the same time.
 *
 *   Sections are replaced whole, never merged. The server's answer is the
 *   complete truth about what a student has outstanding, so patching a section
 *   could only ever leave behind an assignment that has since been withdrawn.
 *   Different *sections* do coexist, because each is written by the screen that
 *   owns it and they are fetched at different moments.
 *
 *   Every section carries its own `savedAt`. A timetable read this morning and a
 *   deadline list read a minute ago are not equally current, and one shared
 *   timestamp would have to lie about one of them.
 *
 *   Nothing sensitive. Titles, courses, times and rooms — the same fields already
 *   rendered into the HTML of the page. No tokens, no email address, no
 *   connection state, nothing from `/api/auth`.
 *
 *   It expires. A section older than `MAX_AGE_MS` is not shown at all. A
 *   fortnight-old deadline list is not a degraded view of the truth, it is a
 *   different and wrong one, and not showing those is the point of the product.
 *
 * IndexedDB rather than localStorage because this is structured data of
 * non-trivial size, and localStorage is synchronous and would block the main
 * thread on every write. Raw IDB rather than a wrapper library because the whole
 * surface used here is one object store and three operations.
 */

const DB_NAME = 'lockin-offline';
const DB_VERSION = 1;
const STORE = 'snapshot';
/** One record, always. The key is a constant because there is only ever one. */
const KEY = 'current';

/** Beyond this a section is discarded rather than shown with a bigger warning. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Exactly the fields the deadline lists render, and nothing more. */
export interface OfflineAssignment {
  readonly assignmentId: string;
  readonly courseName: string;
  readonly title: string;
  readonly dueAtUtc: string | null;
  readonly dueDateUtc: string | null;
  readonly submissionState: string | null;
}

/** A calendar entry the student added themselves. */
export interface OfflineEvent {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly startsAt: string;
  readonly note: string | null;
}

/** One class, flattened out of a TimetableMatch. */
export interface OfflineClass {
  readonly courseLabel: string;
  readonly room: string;
  readonly startMinute: number | null;
  readonly endMinute: number | null;
  readonly cancelled: boolean;
  readonly uncertain: boolean;
}

export interface OfflineDay {
  readonly weekday: string;
  readonly classes: readonly OfflineClass[];
}

export interface TodaySection {
  readonly savedAt: number;
  readonly overdue: readonly OfflineAssignment[];
  readonly dueSoon: readonly OfflineAssignment[];
}

export interface UpcomingSection {
  readonly savedAt: number;
  readonly items: readonly OfflineAssignment[];
  readonly events: readonly OfflineEvent[];
}

export interface TimetableSection {
  readonly savedAt: number;
  readonly label: string | null;
  readonly days: readonly OfflineDay[];
}

export interface OfflineSnapshot {
  /** Whose coursework this is. The only thing that can detect an account change. */
  readonly userId: string;
  readonly timeZone: string;
  readonly today?: TodaySection;
  readonly upcoming?: UpcomingSection;
  readonly timetable?: TimetableSection;
}

export type SectionName = 'today' | 'upcoming' | 'timetable';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error('indexeddb unavailable'));
    };
  });
}

/**
 * One transaction, one request, one promise.
 *
 * `T` is asserted rather than proven, and this is the only place that happens.
 * IndexedDB is untyped by construction -- it hands back whatever was written,
 * and `IDBObjectStore.get` is declared as returning `any` for exactly that
 * reason. The assertion is sound because nothing outside this module writes to
 * the store, and keeping it here means no caller has to make the same claim
 * again somewhere that context is missing.
 */
function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        request.onsuccess = () => {
          resolve(request.result as T);
        };
        request.onerror = () => {
          reject(new Error('indexeddb request failed'));
        };
        tx.oncomplete = () => {
          db.close();
        };
      }),
  );
}

async function readRaw(): Promise<OfflineSnapshot | null> {
  const stored = await run<OfflineSnapshot | undefined>('readonly', (store) => store.get(KEY));
  return stored ?? null;
}

/**
 * Writes one screen's data, leaving the others alone.
 *
 * The user check happens here rather than at the call sites, because this is the
 * one function every screen goes through. A snapshot belonging to somebody else
 * is discarded entirely -- not merged with, not partially kept.
 */
export async function saveSection<K extends SectionName>(
  userId: string,
  timeZone: string,
  section: K,
  value: OfflineSnapshot[K],
): Promise<void> {
  try {
    const existing = await readRaw();
    const base: OfflineSnapshot =
      existing !== null && existing.userId === userId
        ? existing
        : { userId, timeZone };

    await run('readwrite', (store) =>
      store.put({ ...base, userId, timeZone, [section]: value }, KEY),
    );
  } catch {
    // Private browsing, blocked site data, a storage quota. Offline reading is
    // an enhancement; failing to store must never break a screen that was
    // rendering perfectly well from the network.
  }
}

/**
 * The stored snapshot, with any section too old to mean anything removed.
 *
 * The expiry is applied on read rather than on write, because "too old" is a
 * question about now and a snapshot can sit untouched for a month.
 */
export async function readSnapshot(): Promise<OfflineSnapshot | null> {
  try {
    const stored = await readRaw();
    if (stored === null) return null;

    const fresh = (savedAt: number): boolean => Date.now() - savedAt <= MAX_AGE_MS;

    return {
      userId: stored.userId,
      timeZone: stored.timeZone,
      ...(stored.today !== undefined && fresh(stored.today.savedAt)
        ? { today: stored.today }
        : {}),
      ...(stored.upcoming !== undefined && fresh(stored.upcoming.savedAt)
        ? { upcoming: stored.upcoming }
        : {}),
      ...(stored.timetable !== undefined && fresh(stored.timetable.savedAt)
        ? { timetable: stored.timetable }
        : {}),
    };
  } catch {
    return null;
  }
}

/** Removes everything. Called when the account is deleted. */
export async function clearSnapshot(): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(KEY));
  } catch {
    // Nothing stored, or no storage at all. Either way there is nothing to lose.
  }
}

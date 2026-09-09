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
 *   One snapshot, ever. Not a snapshot per user — a single record, stamped with
 *   whose it is. Writing for a different user wipes what was there first, so two
 *   accounts can never have coursework on the device at the same time.
 *
 *   Nothing sensitive. Titles, courses, due dates and submission state — the
 *   same fields already rendered into the HTML of the page. No tokens, no email
 *   address, no connection state, nothing from `/api/auth`.
 *
 *   It expires. A snapshot older than `MAX_AGE_MS` is not shown at all. A
 *   fortnight-old deadline list is not a degraded view of the truth, it is a
 *   different and wrong one, and the point of this product is not showing those.
 *
 *   It is never presented as current. Callers get `savedAt` and are expected to
 *   say so; see `OfflineCoursework`.
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

/** Beyond this a snapshot is discarded rather than shown with a bigger warning. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Exactly the shape the deadline lists render, and nothing more. */
export interface OfflineAssignment {
  readonly assignmentId: string;
  readonly courseName: string;
  readonly title: string;
  readonly dueAtUtc: string | null;
  readonly dueDateUtc: string | null;
  readonly submissionState: string | null;
}

export interface OfflineSnapshot {
  /** Whose coursework this is. Used to refuse a mismatched read. */
  readonly userId: string;
  readonly savedAt: number;
  readonly timeZone: string;
  readonly overdue: readonly OfflineAssignment[];
  readonly dueSoon: readonly OfflineAssignment[];
}

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
 * again in a place where that context is missing.
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

/**
 * Replaces the stored snapshot.
 *
 * There is no merge and no append. The server's answer is the whole truth about
 * what this student has outstanding, so a partial update could only ever leave
 * behind an assignment that has since been withdrawn.
 */
export async function saveSnapshot(snapshot: OfflineSnapshot): Promise<void> {
  try {
    await run('readwrite', (store) => store.put(snapshot, KEY));
  } catch {
    // Private browsing, blocked site data, a storage quota. Offline reading is
    // an enhancement; failing to store must never break the screen that was
    // rendering perfectly well from the network.
  }
}

/**
 * The stored snapshot, if it is this user's and recent enough to mean anything.
 *
 * `expectedUserId` is optional because the offline page has no server to ask who
 * is signed in — the session cookie is httpOnly and unreadable from script. When
 * it is not supplied the snapshot is returned on the strength of the wipe rules
 * in `saveSnapshot`: there can only ever be one user's data present.
 */
export async function readSnapshot(expectedUserId?: string): Promise<OfflineSnapshot | null> {
  try {
    const stored = await run<OfflineSnapshot | undefined>('readonly', (store) => store.get(KEY));
    if (stored === undefined) return null;
    if (expectedUserId !== undefined && stored.userId !== expectedUserId) return null;
    if (Date.now() - stored.savedAt > MAX_AGE_MS) return null;
    return stored;
  } catch {
    return null;
  }
}

/** Removes everything. Called when the account is deleted, and on user change. */
export async function clearSnapshot(): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(KEY));
  } catch {
    // Nothing stored, or no storage at all. Either way there is nothing to lose.
  }
}

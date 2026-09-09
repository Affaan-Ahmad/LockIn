/**
 * The browser's install offer, held somewhere a later screen can reach it.
 *
 * `beforeinstallprompt` fires once, shortly after the page loads, and the event
 * it hands over is the *only* way to open the install dialog — there is no API
 * to summon one on demand. Miss it and the button can never work.
 *
 * That is the whole reason this is a module-level store rather than state inside
 * the Settings screen. Next.js navigates on the client, so a student who lands
 * on Today and then walks to Settings never reloads the page: by the time the
 * Settings component mounts, the event fired minutes ago and is gone. The
 * listener therefore lives in the root layout and the captured event waits here.
 *
 * Written against `useSyncExternalStore`, so `getSnapshot` returns a plain
 * string. Returning a fresh object each call would re-render on every check.
 */

export type InstallState =
  /** Running as an installed app, or the browser told us it was installed. */
  | 'installed'
  /** We hold a live prompt and can open the dialog. */
  | 'ready'
  /** No offer available: unsupported browser, iOS, or already dismissed. */
  | 'unavailable';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let state: InstallState = 'unavailable';
let watchers = 0;

const subscribers = new Set<() => void>();

function set(next: InstallState): void {
  if (state === next) return;
  state = next;
  for (const notify of subscribers) notify();
}

/**
 * Whether this document is already the installed app.
 *
 * Two checks because the platforms disagree: `display-mode: standalone` is the
 * standard one, and `navigator.standalone` is the non-standard property iOS has
 * used since long before it supported the media query.
 */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

/** iOS offers no install API at all, so it gets written instructions instead. */
export function isIosSafari(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua);
  // iPadOS reports itself as a Mac; the touch points give it away.
  const iPadOs = /macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1;
  return ios || iPadOs;
}

function handlePrompt(event: Event): void {
  // Without this Chrome shows its own mini-infobar, and the offer would appear
  // in two places saying two slightly different things.
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  set('ready');
}

function handleInstalled(): void {
  deferred = null;
  set('installed');
}

/**
 * Starts listening. Reference counted, because React's development StrictMode
 * mounts effects twice and a naive implementation would attach two listeners
 * and then detach both on the first cleanup.
 */
export function startWatching(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  if (isStandalone()) set('installed');

  watchers += 1;
  if (watchers === 1) {
    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
  }

  return () => {
    watchers -= 1;
    if (watchers === 0) {
      window.removeEventListener('beforeinstallprompt', handlePrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    }
  };
}

export function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

export function getSnapshot(): InstallState {
  return state;
}

/** The server has no browser to ask, and must not guess. */
export function getServerSnapshot(): InstallState {
  return 'unavailable';
}

/**
 * Opens the browser's install dialog.
 *
 * The captured event is single use. Chrome may fire a fresh one later if the
 * student dismissed this one, which is why dismissal drops back to
 * `unavailable` rather than pretending the offer is still live.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (event === null) return 'unavailable';

  deferred = null;
  await event.prompt();
  const { outcome } = await event.userChoice;

  set(outcome === 'accepted' ? 'installed' : 'unavailable');
  return outcome;
}

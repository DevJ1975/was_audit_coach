/**
 * Service-worker registration — web production builds only. Dev is excluded so
 * the SW never caches metro dev bundles (a stale dev cache is maddening), and
 * native is excluded because there is no serviceWorker API there.
 *
 * Auto-update: sw.js skipWaiting()s + clients.claim()s on activate, so a fresh
 * deploy's worker takes control of open pages and fires `controllerchange`. We
 * reload ONCE on that event (only when an older worker was already in control —
 * never on first install) so a new deploy applies itself instead of leaving the
 * user on a cached shell until they manually clear site data. A visibility /
 * focus `update()` nudge makes long-open tabs notice deploys without a manual
 * reload.
 */
import { Platform } from 'react-native';

interface SWRegistrationLike {
  update(): Promise<unknown>;
}
interface SWContainerLike {
  controller: unknown;
  register(url: string): Promise<SWRegistrationLike>;
  addEventListener(type: 'controllerchange', cb: () => void): void;
}

export function registerServiceWorker(): void {
  if (Platform.OS !== 'web' || process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const sw = (navigator as unknown as { serviceWorker: SWContainerLike }).serviceWorker;
  const g = globalThis as {
    location?: { reload(): void };
    addEventListener?: (type: string, cb: () => void) => void;
    document?: { visibilityState?: string };
  };

  // A worker already controls this page ⇒ a later controllerchange is a NEW
  // deploy taking over → reload once to pick up its assets. First install
  // (no prior controller) must NOT reload, or every first visit double-loads.
  const hadController = Boolean(sw.controller);
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    g.location?.reload();
  });

  sw.register('/sw.js')
    .then((reg) => {
      // Nudge the browser to check for a new sw.js when the tab regains focus,
      // so a long-idle tab still discovers deploys promptly.
      const check = (): void => {
        if (g.document?.visibilityState !== 'hidden') void reg.update();
      };
      g.addEventListener?.('visibilitychange', check);
      g.addEventListener?.('focus', check);
    })
    .catch(() => {
      // Registration failure = no offline shell, app still works online — the
      // browser console has the details; nothing actionable for the user.
    });
}

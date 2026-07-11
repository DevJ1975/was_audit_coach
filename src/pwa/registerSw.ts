/**
 * Service-worker registration — web production builds only. Dev is excluded so
 * the SW never caches metro dev bundles (a stale dev cache is maddening), and
 * native is excluded because there is no serviceWorker API there.
 */
import { Platform } from 'react-native';

export function registerServiceWorker(): void {
  if (Platform.OS !== 'web' || process.env.NODE_ENV !== 'production') return;
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  (navigator as Navigator & { serviceWorker: { register(url: string): Promise<unknown> } }).serviceWorker
    .register('/sw.js')
    .catch(() => {
      // Registration failure = no offline shell, app still works online — the
      // browser console has the details; nothing actionable for the user.
    });
}

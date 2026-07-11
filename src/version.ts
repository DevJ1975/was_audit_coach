/**
 * Build identity for support and pilot triage ("what version are you on?").
 * Version comes from app.json via expo-constants; the commit SHA is baked at
 * build time through EXPO_PUBLIC_BUILD_SHA (wired in vercel.json for web
 * deploys — local dev and EAS builds without it show just the version).
 */
import Constants from 'expo-constants';

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.0.0';

const sha = process.env.EXPO_PUBLIC_BUILD_SHA ?? '';
export const BUILD_SHA: string | null = sha ? sha.slice(0, 7) : null;

/** "v0.2.0 (948a9a2)" — or just "v0.2.0" when no SHA was baked in. */
export function versionLabel(): string {
  return BUILD_SHA ? `v${APP_VERSION} (${BUILD_SHA})` : `v${APP_VERSION}`;
}

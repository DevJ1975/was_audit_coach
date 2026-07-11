/**
 * Evidence capture wrappers (Phase 2). Thin, platform-aware helpers over
 * expo-image-picker (photos) and expo-av (voice). They return a DURABLE local
 * URI the repo stores via addAttachment; permission prompts are handled here.
 *
 * Two invariants this module guarantees:
 *  - Durability (NN #3/#8): captured files are copied out of the volatile OS
 *    cache into the app document directory, so evidence survives cache eviction
 *    even before it is uploaded to Storage.
 *  - Clean release: recorder.stop() and the audio player always unload native
 *    resources, so the single-recorder mic and Sound objects are never leaked.
 *
 * Native modules — not unit-tested, but web-safe so the bundle builds everywhere.
 */
import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import type { EvidenceBlob } from '@/db/sync/remote';

/** Result of a capture attempt. `denied` carries whether the OS will re-prompt. */
export type CaptureResult =
  | { ok: true; uri: string }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'denied'; canAskAgain: boolean };

/** Result of starting a recording. */
export type StartResult =
  | { ok: true }
  | { ok: false; reason: 'denied'; canAskAgain: boolean };

// Durable per-app location for evidence. `null` on web (no filesystem).
const EVIDENCE_DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}evidence/` : null;
let seq = 0; // disambiguates two captures in the same millisecond

/**
 * Copy a freshly captured/recorded file out of the volatile OS cache into the
 * app document directory, so evidence is not lost to cache eviction. No-op on
 * web (blob/object URLs) and when documentDirectory is unavailable. On any copy
 * failure we fall back to the original URI rather than dropping the capture.
 */
async function persist(uri: string): Promise<string> {
  if (Platform.OS === 'web' || !EVIDENCE_DIR) return uri;
  try {
    await FileSystem.makeDirectoryAsync(EVIDENCE_DIR, { intermediates: true });
    const ext = (uri.split('?')[0]?.split('#')[0]?.split('.').pop() || 'dat').slice(0, 5);
    const dest = `${EVIDENCE_DIR}${Date.now()}-${seq++}.${ext}`;
    await FileSystem.copyAsync({ from: uri, to: dest });
    return dest;
  } catch {
    return uri;
  }
}

/** Guess a Storage content-type from a file extension (defaults to octet-stream). */
export function contentTypeFor(uri: string): string {
  const ext = (uri.split('?')[0]?.split('#')[0]?.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'png': return 'image/png';
    case 'heic': return 'image/heic';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'pdf': return 'application/pdf';
    case 'm4a':
    case 'mp4': return 'audio/mp4';
    case 'caf': return 'audio/x-caf';
    case 'wav': return 'audio/wav';
    case 'webm': return 'audio/webm';
    default: return 'application/octet-stream';
  }
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = /* @__PURE__ */ (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < B64_ALPHABET.length; i++) t[B64_ALPHABET.charCodeAt(i)] = i;
  return t;
})();

/**
 * Decode base64 → bytes with no dependency on a global atob (not guaranteed on
 * Hermes). Pure; exported for unit coverage. Ignores whitespace and padding.
 */
export function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    buffer = (buffer << 6) | B64_LOOKUP[clean.charCodeAt(i)]!;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[o++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
}

/**
 * Read a captured file into an upload-ready payload for Storage. Platform-aware:
 * on web we fetch the object/blob URL; on native we read the file as base64 and
 * decode to bytes (avoiding an unreliable file:// fetch on RN). Returns the bytes
 * plus a best-effort content type. Throws if the file can't be read — the caller
 * (AttachmentSync) treats that as a retryable per-file failure, never fatal.
 */
export async function loadForUpload(uri: string): Promise<EvidenceBlob> {
  if (Platform.OS === 'web') {
    const res = await fetch(uri);
    const blob = await res.blob();
    return { data: blob, contentType: blob.type || contentTypeFor(uri) };
  }
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  return { data: base64ToBytes(b64), contentType: contentTypeFor(uri) };
}

/** Best-effort delete of a persisted evidence file when its attachment is removed. */
export async function deleteEvidenceFile(uri: string): Promise<void> {
  if (Platform.OS === 'web' || !EVIDENCE_DIR || !uri.startsWith(EVIDENCE_DIR)) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // An orphaned file wastes a little disk but is otherwise harmless.
  }
}

function toResult(result: ImagePicker.ImagePickerResult): CaptureResult {
  if (result.canceled) return { ok: false, reason: 'cancelled' };
  const uri = result.assets[0]?.uri;
  return uri ? { ok: true, uri } : { ok: false, reason: 'cancelled' };
}

/** Pick an existing photo from the library. */
export async function pickPhoto(): Promise<CaptureResult> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'denied', canAskAgain: perm.canAskAgain };
  const picked = toResult(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 }));
  return picked.ok ? { ok: true, uri: await persist(picked.uri) } : picked;
}

/** Take a photo with the camera (falls back to the library picker on web). */
export async function takePhoto(): Promise<CaptureResult> {
  if (Platform.OS === 'web') return pickPhoto();
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'denied', canAskAgain: perm.canAskAgain };
  const shot = toResult(await ImagePicker.launchCameraAsync({ quality: 0.6 }));
  return shot.ok ? { ok: true, uri: await persist(shot.uri) } : shot;
}

/** A single voice-note recording session (expo-av allows only one at a time). */
export class VoiceRecorder {
  private recording: Audio.Recording | null = null;

  /** True while a native recording is prepared/active. */
  get active(): boolean {
    return this.recording !== null;
  }

  async start(): Promise<StartResult> {
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) return { ok: false, reason: 'denied', canAskAgain: perm.canAskAgain };
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    this.recording = recording;
    return { ok: true };
  }

  /**
   * Stop, unload, and release the mic; returns the DURABLE URI (or null). The
   * handle is cleared FIRST so a second call (e.g. unmount cleanup racing an
   * explicit Stop) is a safe no-op, and a throw from stopAndUnloadAsync never
   * leaves the recorder in a half-stopped state.
   */
  async stop(): Promise<string | null> {
    const rec = this.recording;
    this.recording = null;
    if (!rec) return null;
    let uri: string | null = null;
    try {
      await rec.stopAndUnloadAsync();
    } catch {
      // Even a failed stop may have flushed a partial file — try to keep it.
    }
    try {
      uri = rec.getURI();
    } catch {
      uri = null;
    }
    // Release the iOS recording audio mode so playback isn't stuck in record mode.
    try {
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    } catch {
      // best effort
    }
    return uri ? await persist(uri) : null;
  }
}

/** A single-slot audio player. */
export interface AudioPlayer {
  play(uri: string): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Create an audio player that owns at most one Sound: playing a new note stops
 * and unloads the previous one, playback errors/interruptions unload it, and
 * stop() (called on unmount) releases it. This closes the leak where a Sound was
 * only unloaded on natural completion (didJustFinish).
 */
export function createAudioPlayer(): AudioPlayer {
  let current: Audio.Sound | null = null;

  async function stop(): Promise<void> {
    const s = current;
    current = null;
    if (!s) return;
    try {
      await s.stopAsync();
    } catch {
      // not playing
    }
    try {
      await s.unloadAsync();
    } catch {
      // already unloaded
    }
  }

  return {
    stop,
    async play(uri: string): Promise<void> {
      await stop();
      const { sound } = await Audio.Sound.createAsync({ uri });
      current = sound;
      sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
        if (!status.isLoaded) {
          if (status.error && current === sound) void stop();
          return;
        }
        if (status.didJustFinish && current === sound) void stop();
      });
      await sound.playAsync();
    },
  };
}

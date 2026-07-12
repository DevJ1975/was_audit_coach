/**
 * AttachmentStrip — evidence capture on the item card (Phase 2). Photo (camera
 * or library) + voice note, thumbnails, tap-to-preview, inline audio playback,
 * and delete (which logs attachment_removed). Every write flows through the repo
 * seam via useAttachments. A "Very High" finding can now carry photo evidence.
 *
 * Resource discipline (verified by adversarial review):
 *  - On unmount the recorder and audio player are released, so a card left mid-
 *    record never leaks the single-instance mic and wedges capture app-wide.
 *  - A synchronous busy guard + try/catch make record start/stop double-tap-safe
 *    and error-safe: the UI can never latch in a stuck "recording" state.
 *  - Delete controls meet the 48pt tap target (NN #10) via hitSlop / minHeight,
 *    and removing an attachment also deletes its on-device file.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, Linking, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { Card, Button, Subtitle } from '@/components/ui';
import { useAttachments } from '@/hooks/useAttachments';
import {
  takePhoto,
  pickPhoto,
  createAudioPlayer,
  deleteEvidenceFile,
  VoiceRecorder,
  type CaptureResult,
} from '@/attachments/capture';
import { layout, type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// 24pt delete badge + 12pt slop on every edge = a 48pt touch target (NN #10).
const DELETE_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 };

export function AttachmentStrip({ auditItemId }: { auditItemId: string }): React.ReactElement {
  const { attachments, add, remove, resolveUri } = useAttachments(auditItemId);
  const styles = useThemedStyles(makeStyles);
  const { palette } = useTheme();
  const recorder = useRef(new VoiceRecorder());
  const player = useRef(createAudioPlayer());
  const busyRef = useRef(false); // synchronous guard: blocks double-taps before state settles
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  // Release the mic and any playback if the card unmounts mid-record / mid-play.
  // expo-av allows only ONE active recording — leaking it wedges capture app-wide.
  useEffect(() => {
    const rec = recorder.current;
    const play = player.current;
    return () => {
      void rec.stop();
      void play.stop();
    };
  }, []);

  function notifyDenied(what: string, canAskAgain: boolean): void {
    if (canAskAgain) return; // the OS re-prompts on the next tap; no need to nag.
    Alert.alert(
      `${what} access is off`,
      `Enable ${what.toLowerCase()} access in Settings to attach evidence.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => void Linking.openSettings() },
      ],
    );
  }

  async function addPhoto(source: () => Promise<CaptureResult>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await source();
      if (res.ok) await add('photo', res.uri);
      else if (res.reason === 'denied') notifyDenied('Camera / photo', res.canAskAgain);
    } catch {
      Alert.alert('Could not attach photo', 'Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function toggleRecord(): Promise<void> {
    if (busyRef.current) return; // ignore a second tap while a start/stop is in flight
    busyRef.current = true;
    setBusy(true);
    try {
      if (recording || recorder.current.active) {
        const uri = await recorder.current.stop();
        setRecording(false);
        if (uri) await add('voice', uri);
      } else {
        const res = await recorder.current.start();
        if (res.ok) setRecording(true);
        else notifyDenied('Microphone', res.canAskAgain);
      }
    } catch {
      // Never leave the UI latched in "recording": force-release and reset.
      try {
        await recorder.current.stop();
      } catch {
        /* already released */
      }
      setRecording(false);
      Alert.alert('Recording error', 'The voice note could not be saved.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function deleteAttachment(id: string, uri: string): Promise<void> {
    await remove(id);
    if (uri) void deleteEvidenceFile(uri);
  }

  // Remote-only evidence (captured on another device) has no local file — view
  // and playback resolve a short-lived signed Storage URL on demand.
  async function openPhoto(att: (typeof attachments)[number]): Promise<void> {
    const uri = await resolveUri(att);
    if (uri) setPreview(uri);
    else Alert.alert('Photo unavailable offline', 'This photo was captured on another device. Connect to view it.');
  }

  async function playVoice(att: (typeof attachments)[number]): Promise<void> {
    const uri = await resolveUri(att);
    if (uri) await player.current.play(uri);
    else Alert.alert('Voice note unavailable offline', 'This note was recorded on another device. Connect to play it.');
  }

  return (
    <Card>
      <Subtitle>Evidence</Subtitle>
      <View style={styles.actions}>
        <Button icon="camera" label="Camera" variant="secondary" onPress={() => addPhoto(takePhoto)} disabled={busy || recording} />
        <Button icon="image-multiple" label="Library" variant="secondary" onPress={() => addPhoto(pickPhoto)} disabled={busy || recording} />
        <Button
          label={recording ? 'Stop' : 'Record'}
          icon={recording ? 'stop' : 'record'}
          variant={recording ? 'primary' : 'secondary'}
          onPress={toggleRecord}
          disabled={busy}
        />
      </View>

      {attachments.length === 0 ? (
        <Text style={styles.hint}>Attach a photo or voice note. Evidence is saved on-device and syncs when online.</Text>
      ) : (
        <View style={styles.grid}>
          {attachments.map((a) =>
            a.kind === 'photo' ? (
              <View key={a.id} style={styles.thumbWrap}>
                <Pressable onPress={() => void openPhoto(a)} accessibilityRole="imagebutton" accessibilityLabel="Open photo">
                  {a.uri ? (
                    <Image source={{ uri: a.uri }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, styles.remoteThumb]}>
                      <MaterialCommunityIcons name="cloud-outline" size={22} color={palette.text.dim} />
                      <Text style={styles.remoteThumbText}>Photo</Text>
                    </View>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => deleteAttachment(a.id, a.uri)}
                  style={styles.del}
                  hitSlop={DELETE_HIT_SLOP}
                  accessibilityLabel="Delete photo"
                >
                  <MaterialCommunityIcons name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            ) : (
              <View key={a.id} style={styles.voice}>
                <Pressable onPress={() => void playVoice(a)} style={styles.voicePlay} accessibilityLabel="Play voice note">
                  <View style={styles.voiceInner}>
                    <MaterialCommunityIcons name="play" size={16} color={palette.brand.accent} />
                    <Text style={styles.voiceText}>Voice note</Text>
                    {!a.uri ? <MaterialCommunityIcons name="cloud-outline" size={13} color={palette.text.dim} /> : null}
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => deleteAttachment(a.id, a.uri)}
                  style={styles.voiceDel}
                  accessibilityLabel="Delete voice note"
                >
                  <Text style={styles.delText}>Delete</Text>
                </Pressable>
              </View>
            ),
          )}
        </View>
      )}

      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.modal} onPress={() => setPreview(null)}>
          {preview ? <Image source={{ uri: preview }} style={styles.full} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </Card>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    hint: { color: t.text.faint, fontSize: 12, marginTop: 2 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
    thumbWrap: { position: 'relative' },
    thumb: { width: 76, height: 76, borderRadius: layout.radius, backgroundColor: t.surfaces.raised },
    remoteThumb: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      backgroundColor: t.surfaces.raised,
      borderWidth: 1,
      borderColor: t.surfaces.line,
    },
    remoteThumbText: { color: t.text.dim, fontSize: 12, fontWeight: '600' },
    del: {
      position: 'absolute',
      top: -6,
      right: -6,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: t.semantic.danger,
      alignItems: 'center',
      justifyContent: 'center',
    },
    voice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: layout.minTapTarget,
      backgroundColor: t.surfaces.raised,
      borderRadius: layout.radius,
      paddingHorizontal: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.surfaces.line,
    },
    voicePlay: { minHeight: layout.minTapTarget, justifyContent: 'center' },
    voiceInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    voiceText: { color: t.brand.accent, fontWeight: '700' },
    voiceDel: { minHeight: layout.minTapTarget, justifyContent: 'center', paddingHorizontal: 8 },
    delText: { color: t.semantic.danger, fontWeight: '600' },
    modal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
    full: { width: '92%', height: '80%' },
  });

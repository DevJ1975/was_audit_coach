/**
 * BriefReviewSheet — document-scale review/accept UI for the AI legal brief, the
 * analog of the item screen's AiDraftBox. Every section is individually editable;
 * nothing is stored until the human taps Accept (AI drafts; humans rate — NN #2).
 * A single whole-document Accept keeps the audit story simple: one acceptance,
 * one event, one approver on the page.
 */
import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { TextInput, Text } from 'react-native-paper';
import { Button, Title, Body } from '@/components/ui';
import { useThemedStyles } from '@/theme/ThemeProvider';
import type { Palette } from '@/theme/tokens';
import type { ReportBriefContent } from '@/db/types';

/** Order + labels for the per-finding narratives (drives the finding editors). */
export interface BriefFindingLabel {
  audit_item_id: string;
  item_code: string;
  rating: string;
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (t: string) => void;
}): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput mode="outlined" multiline value={value} onChangeText={onChange} style={styles.textArea} />
    </View>
  );
}

export function BriefReviewSheet({
  visible,
  initial,
  findingLabels,
  warnings,
  busy,
  onAccept,
  onDiscard,
}: {
  visible: boolean;
  initial: ReportBriefContent;
  findingLabels: BriefFindingLabel[];
  warnings?: string[];
  busy?: boolean;
  onAccept: (content: ReportBriefContent) => void;
  onDiscard: () => void;
}): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
  const [content, setContent] = useState<ReportBriefContent>(initial);

  const set = (patch: Partial<ReportBriefContent>): void => setContent((c) => ({ ...c, ...patch }));
  const setNarrative = (id: string, text: string): void =>
    setContent((c) => ({ ...c, findingNarratives: { ...c.findingNarratives, [id]: text } }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onDiscard}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Title>Legal brief — review &amp; accept</Title>
          <Text style={styles.sub}>
            AI-drafted narrative. Edit anything, then Accept. Ratings and scores are set by you,
            not the AI, and are unaffected by this text.
          </Text>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
          {warnings && warnings.length > 0 ? (
            <View style={styles.warn}>
              <Text style={styles.warnTitle}>Some sections could not be drafted:</Text>
              {warnings.map((w, i) => (
                <Text key={i} style={styles.warnLine}>• {w}</Text>
              ))}
            </View>
          ) : null}

          <Field label="Executive summary (for counsel)" value={content.execSummary} onChange={(t) => set({ execSummary: t })} />
          <Field label="Scope & methodology" value={content.methodology} onChange={(t) => set({ methodology: t })} />
          <Field label="Evidentiary integrity & chain of custody" value={content.chainOfCustody} onChange={(t) => set({ chainOfCustody: t })} />
          <Field label="Limitations & reservations" value={content.limitations} onChange={(t) => set({ limitations: t })} />
          <Field label="Disclaimers (AI-assisted, not legal advice, human-rated)" value={content.legalDisclaimer} onChange={(t) => set({ legalDisclaimer: t })} />

          {findingLabels.length > 0 ? <Body style={styles.findingsHead}>Per-finding risk characterization</Body> : null}
          {findingLabels.map((f) => (
            <Field
              key={f.audit_item_id}
              label={`${f.item_code} · ${f.rating}`}
              value={content.findingNarratives[f.audit_item_id] ?? ''}
              onChange={(t) => setNarrative(f.audit_item_id, t)}
            />
          ))}
        </ScrollView>
        <View style={styles.actions}>
          <Button label="Discard" variant="ghost" onPress={onDiscard} disabled={busy} />
          <Button label={busy ? 'Saving…' : 'Accept brief'} variant="primary" onPress={() => onAccept(content)} disabled={busy} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.surfaces.bg },
    header: { padding: 16, gap: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.surfaces.line },
    sub: { color: t.text.dim, fontSize: 12 },
    scroll: { flex: 1 },
    scrollBody: { padding: 16, gap: 12, paddingBottom: 32 },
    field: { gap: 4 },
    fieldLabel: { color: t.text.faint, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 },
    textArea: { backgroundColor: t.surfaces.surface, minHeight: 96 },
    findingsHead: { marginTop: 8, fontWeight: '800' },
    warn: { backgroundColor: t.surfaces.raised, borderRadius: 8, padding: 10, gap: 2 },
    warnTitle: { color: t.text.primary, fontWeight: '700', fontSize: 12 },
    warnLine: { color: t.text.dim, fontSize: 12 },
    actions: {
      flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.surfaces.line,
    },
  });

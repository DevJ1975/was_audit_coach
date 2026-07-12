/**
 * Coach — one front door for the AI help that used to be scattered across three
 * names. Ask Soteria (cited regulations) lives here; technique coaching and
 * per-item ARIA stay inside each audit. The coach only ever drafts — ratings
 * are always the auditor's (NN #2).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Screen, Row, SectionTitle, Body } from '@/components/ui';
import { CoachTip } from '@/components/CoachTip';
import { useAiReady, aiHintText } from '@/hooks/useAiReady';
import { type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';

export default function CoachScreen(): React.ReactElement {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { palette } = useTheme();
  const aiGate = useAiReady();

  return (
    <Screen>
      <CoachTip title="Your audit assistant">
        Ask about regulations — every answer is cited to the CFR. Ratings stay yours; the coach only
        ever drafts.
      </CoachTip>

      <SectionTitle>Ask</SectionTitle>
      <Row onPress={() => router.push('/chat')}>
        <View style={[styles.coin, { backgroundColor: palette.brand.soft }]}>
          <MaterialCommunityIcons name="book-search-outline" size={20} color={palette.brand.accent} />
        </View>
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>Ask Soteria</Text>
          <Text style={styles.rowSub}>Federal & state OSHA reference — every answer cited</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={palette.text.faint} />
      </Row>

      <Body style={styles.note}>
        Technique coaching and per-item help live inside each audit — open an item and tap “Coach” or
        “Ask ARIA”.
      </Body>
      {!aiGate.ready ? <Text style={styles.hint}>{aiHintText(aiGate)}</Text> : null}
    </Screen>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    coin: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
    rowBody: { flex: 1, gap: 2 },
    rowTitle: { color: t.text.primary, fontSize: 16, fontWeight: '700' },
    rowSub: { color: t.text.dim, fontSize: 12 },
    note: { color: t.text.dim, marginTop: 8 },
    hint: { color: t.text.faint, fontSize: 12, marginTop: 4 },
  });

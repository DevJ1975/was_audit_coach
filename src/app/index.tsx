import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Banner, Text } from 'react-native-paper';
import { Row, Button, Title, Subtitle, Mono } from '@/components/ui';
import { PrivBadge } from '@/components/badges';
import { useAudits } from '@/hooks/useAudit';
import { useCloudPull } from '@/hooks/useCloudPull';
import { IS_PLACEHOLDER } from '@/seed';
import { layout, type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';

export default function AuditListScreen(): React.ReactElement {
  const router = useRouter();
  const { audits, loading, reload } = useAudits();
  const cloud = useCloudPull(reload);
  const styles = useThemedStyles(makeStyles);
  const { palette } = useTheme();

  // Non-list chrome rides in the FlatList header so the whole screen scrolls as
  // one and the audit list virtualizes (it grows unbounded over a user's life).
  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.header}>
        <Title>Audits</Title>
        <Button label="+ New Audit" onPress={() => router.push('/audit/new')} />
      </View>

      {/* Soteria chat (Phase C4) — corpus-grounded OSHA reference, online-only. */}
      <Row onPress={() => router.push('/chat')}>
        <View style={styles.rowBody}>
          <Text style={styles.soteriaTitle}>Ask Soteria</Text>
          <Text style={styles.soteriaSub}>Federal & state OSHA reference — every answer cited</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={palette.text.faint} />
      </Row>

      {IS_PLACEHOLDER ? (
        <Banner visible elevation={1} style={styles.notice} contentStyle={styles.noticeContent}>
          <Text style={styles.noticeText}>
            Placeholder library in use — run <Text style={styles.mono}>npm run etl</Text> with the
            workbook to load the real 374-item library.
          </Text>
        </Banner>
      ) : null}

      {/* Cloud discovery — audits created on other devices (or before a
          reinstall) materialize locally. Signed-in only; offline unaffected. */}
      {cloud.available ? (
        <View style={styles.cloudRow}>
          <Button
            label={cloud.pulling ? 'Checking cloud…' : 'Check cloud for audits'}
            variant="ghost"
            onPress={() => void cloud.pull()}
            disabled={cloud.pulling}
          />
          {cloud.result ? (
            <Text style={styles.cloudNote}>
              {cloud.result.error
                ? `Cloud check failed: ${cloud.result.error}`
                : cloud.result.added > 0
                  ? `${cloud.result.added} audit${cloud.result.added === 1 ? '' : 's'} added from cloud`
                  : 'Up to date'}
            </Text>
          ) : null}
        </View>
      ) : null}

      {loading ? (
        <ActivityIndicator animating color={palette.brand.accent} style={styles.loading} />
      ) : null}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <FlatList
        data={audits}
        keyExtractor={(a) => a.id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <Subtitle>No audits yet</Subtitle>
              <Text style={styles.emptyBody}>
                Start a new audit — it works fully offline. Everything is saved on this device.
              </Text>
            </View>
          ) : null
        }
        renderItem={({ item: a }) => (
          <Row onPress={() => router.push(`/audit/${a.id}`)}>
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Text style={styles.auditTitle} numberOfLines={1}>
                  {a.title}
                </Text>
                {a.privileged ? <PrivBadge small /> : null}
              </View>
              <View style={styles.rowMeta}>
                <Mono style={styles.meta}>{a.status}</Mono>
                {a.state_plan ? <Mono style={styles.meta}>· {a.state_plan}</Mono> : null}
                <Mono style={styles.meta}>· {new Date(a.created_at).toLocaleDateString()}</Mono>
              </View>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={24} color={palette.text.faint} />
          </Row>
        )}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />
    </SafeAreaView>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.surfaces.bg },
    listContent: { padding: layout.gap, gap: layout.gap },
    headerBlock: { gap: layout.gap },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
    notice: { backgroundColor: t.surfaces.raised, borderColor: t.semantic.warn, borderWidth: 1, borderRadius: 8 },
    noticeContent: { paddingVertical: 4 },
    noticeText: { color: t.semantic.warn, fontSize: 12 },
    mono: { fontFamily: 'monospace' },
    loading: { paddingVertical: 24 },
    cloudRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    cloudNote: { color: t.text.dim, fontSize: 12 },
    empty: { padding: 24, alignItems: 'center', gap: 8 },
    emptyBody: { color: t.text.dim, textAlign: 'center', fontSize: 14 },
    rowBody: { flex: 1, gap: 4 },
    soteriaTitle: { color: t.brand.accent, fontSize: 16, fontWeight: '700' },
    soteriaSub: { color: t.text.dim, fontSize: 12 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    auditTitle: { color: t.text.primary, fontSize: 16, fontWeight: '600', flexShrink: 1 },
    rowMeta: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
    meta: { color: t.text.dim, fontSize: 12 },
  });

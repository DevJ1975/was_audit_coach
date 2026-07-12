import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Banner, Text } from 'react-native-paper';
import { Button } from '@/components/ui';
import { AuditCard } from '@/components/AuditCard';
import { EmptyState } from '@/components/EmptyState';
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

  const header = (
    <View style={styles.headerBlock}>
      <View style={styles.header}>
        <Button label="New audit" icon="plus" onPress={() => router.push('/audit/new')} />
      </View>

      {IS_PLACEHOLDER ? (
        <Banner visible elevation={1} style={styles.notice} contentStyle={styles.noticeContent}>
          <Text style={styles.noticeText}>
            Placeholder library in use — run <Text style={styles.mono}>npm run etl</Text> with the
            workbook to load the real 374-item library.
          </Text>
        </Banner>
      ) : null}

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
    <SafeAreaView style={styles.screen} edges={['left', 'right']}>
      <FlatList
        data={audits}
        keyExtractor={(a) => a.id}
        ListHeaderComponent={header}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon="clipboard-check-outline"
              title="No audits yet"
              message="Start your first audit — it works fully offline, saved right on this device."
              action={<Button label="New audit" icon="plus" onPress={() => router.push('/audit/new')} />}
            />
          ) : null
        }
        renderItem={({ item: a }) => (
          <AuditCard audit={a} onPress={() => router.push(`/audit/${a.id}`)} />
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
    header: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
    notice: { backgroundColor: t.surfaces.raised, borderColor: t.semantic.warn, borderWidth: 1, borderRadius: 8 },
    noticeContent: { paddingVertical: 4 },
    noticeText: { color: t.semantic.warn, fontSize: 12 },
    mono: { fontFamily: 'monospace' },
    loading: { paddingVertical: 24 },
    cloudRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    cloudNote: { color: t.text.dim, fontSize: 12 },
  });

/**
 * Home — the manager landing. A coach greeting, portfolio stat tiles, and the
 * most recent audits. Everything reads from local SQLite (offline-safe); no
 * cross-audit score is computed here (that would load every audit's items).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text } from 'react-native-paper';
import { Screen, Button, SectionTitle, DataText } from '@/components/ui';
import { AuditCard } from '@/components/AuditCard';
import { CoachTip } from '@/components/CoachTip';
import { EmptyState } from '@/components/EmptyState';
import { AppFooter } from '@/components/branding';
import { useAudits } from '@/hooks/useAudit';
import { space, type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';

export default function HomeScreen(): React.ReactElement {
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { audits, loading } = useAudits();

  const inProgress = audits.filter((a) => a.status === 'in_progress' || a.status === 'draft').length;
  const complete = audits.filter((a) => a.status === 'complete').length;
  const recent = audits.slice(0, 4);

  return (
    <Screen>
      <CoachTip
        title="Welcome back"
        actionLabel="Start an audit"
        onAction={() => router.push('/audit/new')}
      >
        {audits.length === 0
          ? 'Ready when you are — your first audit works fully offline, nothing to set up.'
          : inProgress > 0
            ? `You have ${inProgress} audit${inProgress === 1 ? '' : 's'} in progress. Pick up where you left off.`
            : 'All caught up — nice work keeping things tight.'}
      </CoachTip>

      <View style={styles.tiles}>
        <View style={styles.tile}>
          <DataText style={styles.tileNum}>{audits.length}</DataText>
          <Text style={styles.tileLabel}>Audits</Text>
        </View>
        <View style={styles.tile}>
          <DataText style={styles.tileNum}>{inProgress}</DataText>
          <Text style={styles.tileLabel}>In progress</Text>
        </View>
        <View style={styles.tile}>
          <DataText style={styles.tileNum}>{complete}</DataText>
          <Text style={styles.tileLabel}>Complete</Text>
        </View>
      </View>

      <View style={styles.section}>
        <SectionTitle>Recent audits</SectionTitle>
        <Button label="New audit" icon="plus" variant="ghost" onPress={() => router.push('/audit/new')} />
      </View>

      {!loading && audits.length === 0 ? (
        <EmptyState
          icon="clipboard-check-outline"
          title="No audits yet"
          message="Start your first audit — it's saved right here on your device."
          action={<Button label="New audit" icon="plus" onPress={() => router.push('/audit/new')} />}
        />
      ) : (
        recent.map((a) => <AuditCard key={a.id} audit={a} onPress={() => router.push(`/audit/${a.id}`)} />)
      )}

      <AppFooter />
    </Screen>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    tiles: { flexDirection: 'row', gap: space.md },
    tile: { flex: 1, backgroundColor: t.surfaces.sunken, borderRadius: 12, paddingVertical: 16, alignItems: 'center', gap: 2 },
    tileNum: { fontSize: 24, color: t.text.primary },
    tileLabel: { color: t.text.dim, fontSize: 12 },
    section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  });

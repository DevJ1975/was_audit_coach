import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Divider, Text } from 'react-native-paper';
import { Screen, Card, Row, Button, Title, Subtitle, Mono } from '@/components/ui';
import { ScoreReadout } from '@/components/ScoreReadout';
import { PrivilegeBanner } from '@/components/badges';
import { useAuditData } from '@/hooks/useAudit';
import { useSync } from '@/hooks/useSync';
import { sectionNames, sectionOrder } from '@/seed';
import { surfaces, text as textTokens } from '@/theme/tokens';

export default function SectionListScreen(): React.ReactElement {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const router = useRouter();
  const { audit, score, findings } = useAuditData(auditId);
  const { sync, syncing, summary, evidence, available } = useSync(auditId);

  const activeSections = sectionOrder.filter((code) => score.sections[code]);

  return (
    <Screen>
      <Stack.Screen options={{ title: audit?.title ?? 'Audit' }} />

      {audit?.privileged ? <PrivilegeBanner attorney={audit.attorney_of_record} /> : null}

      <Card>
        <Subtitle>Overall</Subtitle>
        <ScoreReadout
          rawScore={score.rawScore}
          effectiveMax={score.effectiveMax}
          percent={score.percent}
          tier={score.tier}
          ratedCount={score.ratedCount}
          itemCount={score.itemCount}
          size="lg"
        />
        <View style={styles.actions}>
          <Button label="Dashboard" variant="secondary" onPress={() => router.push(`/audit/${auditId}/dashboard`)} />
          <Button
            label={`Findings (${findings.length})`}
            variant="secondary"
            onPress={() => router.push(`/audit/${auditId}/report`)}
          />
          <Button label="CA tracker" variant="secondary" onPress={() => router.push(`/audit/${auditId}/corrective-actions`)} />
          {/* Audit Coach — technique mentor (managed agent), distinct from Soteria chat. */}
          <Button label="Coach" variant="secondary" onPress={() => router.push(`/audit/${auditId}/coach`)} />
          {available ? (
            <Button label={syncing ? 'Syncing…' : 'Sync'} variant="ghost" onPress={sync} disabled={syncing} />
          ) : null}
        </View>
        {summary && !summary.skipped ? (
          <Text style={styles.syncNote}>
            Synced · {summary.pushed} pushed · {summary.appliedLocal} applied
            {summary.conflicts.length ? ` · ${summary.conflicts.length} need resolution` : ''}
            {evidence && evidence.uploaded ? ` · ${evidence.uploaded} evidence uploaded` : ''}
            {evidence && evidence.failed ? ` · ${evidence.failed} evidence pending` : ''}
          </Text>
        ) : null}
      </Card>

      <Title style={styles.sectionsHeading}>Sections</Title>
      <Divider style={styles.divider} />
      {activeSections.length === 0 ? (
        <Text style={styles.empty}>No active sections — check the scoping answers.</Text>
      ) : null}

      {activeSections.map((code) => {
        const s = score.sections[code]!;
        return (
          <Row key={code} testID="section-row" onPress={() => router.push(`/audit/${auditId}/section/${code}`)}>
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Mono style={styles.code}>{code}</Mono>
                <Text style={styles.sectionName} numberOfLines={1}>
                  {sectionNames[code] ?? code}
                </Text>
              </View>
              <ScoreReadout
                rawScore={s.rawScore}
                effectiveMax={s.effectiveMax}
                percent={s.percent}
                tier={s.tier}
                ratedCount={s.ratedCount}
                itemCount={s.itemCount}
                size="sm"
              />
            </View>
            <Text style={styles.chevron}>›</Text>
          </Row>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  syncNote: { color: textTokens.faint, fontSize: 12, marginTop: 6 },
  sectionsHeading: { fontSize: 16, marginTop: 4 },
  divider: { backgroundColor: surfaces.line },
  empty: { color: textTokens.dim },
  rowBody: { flex: 1, gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  code: { color: textTokens.dim, fontSize: 13, fontWeight: '700' },
  sectionName: { color: textTokens.primary, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  chevron: { color: textTokens.faint, fontSize: 24, fontWeight: '300' },
});

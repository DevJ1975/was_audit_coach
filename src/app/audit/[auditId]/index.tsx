import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Divider, Text } from 'react-native-paper';
import { Screen, Card, Row, Button, Title, Subtitle, Mono } from '@/components/ui';
import { ScoreReadout } from '@/components/ScoreReadout';
import { PrivilegeBanner } from '@/components/badges';
import { useAuditData } from '@/hooks/useAudit';
import { sectionNames, sectionOrder } from '@/seed';
import { surfaces, text as textTokens } from '@/theme/tokens';

export default function SectionListScreen(): React.ReactElement {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const router = useRouter();
  const { audit, score, findings } = useAuditData(auditId);

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
          <Button
            label={`Findings (${findings.length})`}
            variant="secondary"
            onPress={() => router.push(`/audit/${auditId}/report`)}
          />
        </View>
      </Card>

      <Title style={styles.sectionsHeading}>Sections</Title>
      <Divider style={styles.divider} />
      {activeSections.length === 0 ? (
        <Text style={styles.empty}>No active sections — check the scoping answers.</Text>
      ) : null}

      {activeSections.map((code) => {
        const s = score.sections[code]!;
        return (
          <Row key={code} onPress={() => router.push(`/audit/${auditId}/section/${code}`)}>
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
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  sectionsHeading: { fontSize: 16, marginTop: 4 },
  divider: { backgroundColor: surfaces.line },
  empty: { color: textTokens.dim },
  rowBody: { flex: 1, gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  code: { color: textTokens.dim, fontSize: 13, fontWeight: '700' },
  sectionName: { color: textTokens.primary, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  chevron: { color: textTokens.faint, fontSize: 24, fontWeight: '300' },
});

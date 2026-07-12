import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Text } from 'react-native-paper';
import { Screen, Card, Row, Title, Subtitle, Mono } from '@/components/ui';
import { ScoreReadout } from '@/components/ScoreReadout';
import { PrivilegeBanner } from '@/components/badges';
import { useAuditData } from '@/hooks/useAudit';
import { sectionNames, sectionOrder } from '@/seed';
import { RATINGS } from '@soteria/scoring-engine';
import { ratingColors, type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';

export default function DashboardScreen(): React.ReactElement {
  const { auditId } = useLocalSearchParams<{ auditId: string }>();
  const router = useRouter();
  const styles = useThemedStyles(makeStyles);
  const { audit, items, score, findings } = useAuditData(auditId);

  const ratingCounts = Object.fromEntries(RATINGS.map((r) => [r, 0])) as Record<string, number>;
  for (const it of items) if (it.applicable && it.rating) ratingCounts[it.rating] = (ratingCounts[it.rating] ?? 0) + 1;
  const highPlus = findings.filter((f) => f.rating === 'High' || f.rating === 'Very High').length;
  const sif = findings.filter((f) => f.sif_potential).length;
  const activeSections = sectionOrder.filter((c) => score.sections[c]);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Dashboard' }} />
      {audit?.privileged ? <PrivilegeBanner attorney={audit.attorney_of_record} /> : null}

      <Card>
        <Subtitle>Overall</Subtitle>
        <ScoreReadout
          rawScore={score.rawScore} effectiveMax={score.effectiveMax}
          percent={score.percent} tier={score.tier}
          ratedCount={score.ratedCount} itemCount={score.itemCount} size="lg"
        />
      </Card>

      <Card>
        <Subtitle>Finding distribution</Subtitle>
        <View style={styles.pills}>
          {RATINGS.map((r) => (
            <View key={r} style={styles.pill}>
              <View style={[styles.dot, { backgroundColor: ratingColors[r] }]} />
              <Text style={styles.pillText}>{r}: <Text style={styles.pillNum}>{ratingCounts[r]}</Text></Text>
            </View>
          ))}
        </View>
        <Text style={styles.kpi}>
          High/Very High: <Text style={styles.kpiNum}>{highPlus}</Text> · SIF-potential:{' '}
          <Text style={styles.kpiNum}>{sif}</Text> · Total findings: <Text style={styles.kpiNum}>{findings.length}</Text>
        </Text>
      </Card>

      <Title style={styles.heading}>Section scorecards</Title>
      {activeSections.map((code) => {
        const s = score.sections[code]!;
        return (
          <Row key={code} onPress={() => router.push(`/audit/${auditId}/section/${code}`)}>
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Mono style={styles.code}>{code}</Mono>
                <Text style={styles.name} numberOfLines={1}>{sectionNames[code] ?? code}</Text>
              </View>
              <ScoreReadout
                rawScore={s.rawScore} effectiveMax={s.effectiveMax} percent={s.percent}
                tier={s.tier} ratedCount={s.ratedCount} itemCount={s.itemCount} size="sm"
              />
            </View>
          </Row>
        );
      })}
    </Screen>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    pill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.surfaces.raised, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
    dot: { width: 8, height: 8, borderRadius: 4 },
    pillText: { color: t.text.dim, fontSize: 12 },
    pillNum: { color: t.text.primary, fontWeight: '800' },
    kpi: { color: t.text.dim, fontSize: 13, marginTop: 6 },
    kpiNum: { color: t.text.primary, fontWeight: '800' },
    heading: { fontSize: 16, marginTop: 4 },
    rowBody: { flex: 1, gap: 6 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    code: { color: t.text.dim, fontSize: 13, fontWeight: '700' },
    name: { color: t.text.primary, fontSize: 15, fontWeight: '600', flexShrink: 1 },
  });

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Screen, Card, Row, Subtitle, Mono } from '@/components/ui';
import { ScoreReadout } from '@/components/ScoreReadout';
import { RatingDot, SifBadge } from '@/components/badges';
import { useAuditData } from '@/hooks/useAudit';
import { compareByCode } from '@/domain/ordering';
import { sectionNames, libraryItem } from '@/seed';
import { text as textTokens } from '@/theme/tokens';

export default function ItemListScreen(): React.ReactElement {
  const { auditId, code } = useLocalSearchParams<{ auditId: string; code: string }>();
  const router = useRouter();
  const { items, score } = useAuditData(auditId);

  const sectionItems = items
    .filter((it) => it.section_code === code && it.applicable)
    .sort(compareByCode);
  const s = score.sections[code];

  return (
    <Screen>
      <Stack.Screen options={{ title: `${code} · ${sectionNames[code] ?? ''}`.trim() }} />

      {s ? (
        <Card>
          <Subtitle>{sectionNames[code] ?? code}</Subtitle>
          <ScoreReadout
            rawScore={s.rawScore}
            effectiveMax={s.effectiveMax}
            percent={s.percent}
            tier={s.tier}
            ratedCount={s.ratedCount}
            itemCount={s.itemCount}
          />
        </Card>
      ) : null}

      {sectionItems.map((it) => {
        const lib = libraryItem(it.item_code);
        return (
          <Row key={it.id} testID="item-row" accent={undefined} onPress={() => router.push(`/audit/${auditId}/item/${it.id}`)}>
            <RatingDot rating={it.rating} />
            <View style={styles.body}>
              <View style={styles.top}>
                <Mono style={styles.code}>{it.item_code}</Mono>
                {lib?.sif_potential ? <SifBadge small /> : null}
                {it.rating ? <Text style={styles.rating}>{it.rating}</Text> : null}
              </View>
              <Text style={styles.req} numberOfLines={2}>
                {lib?.requirement ?? '—'}
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Row>
        );
      })}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: 4 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  code: { color: textTokens.primary, fontSize: 14, fontWeight: '700' },
  rating: { color: textTokens.dim, fontSize: 12, fontWeight: '600', marginLeft: 'auto' },
  req: { color: textTokens.dim, fontSize: 13, lineHeight: 18 },
  chevron: { color: textTokens.faint, fontSize: 24, fontWeight: '300' },
});

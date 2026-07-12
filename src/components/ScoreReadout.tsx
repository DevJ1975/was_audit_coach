/**
 * ScoreReadout — ALWAYS shows raw score AND effective max together, never a bare
 * percentage (Non-Negotiable #9). Small sections (MED = 8 items) are only
 * interpretable with the denominator visible.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Tier } from '@soteria/scoring-engine';
import { TierBadge } from './TierBadge';
import { typography, type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';

export function ScoreReadout({
  rawScore,
  effectiveMax,
  percent,
  tier,
  ratedCount,
  itemCount,
  size = 'md',
  showTier = true,
}: {
  rawScore: number;
  effectiveMax: number;
  percent: number | null;
  tier: Tier | null;
  ratedCount?: number;
  itemCount?: number;
  size?: 'sm' | 'md' | 'lg';
  showTier?: boolean;
}): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
  const scoreFont = size === 'lg' ? 28 : size === 'sm' ? 15 : 20;
  const pctText = percent === null ? '—' : `${percent.toFixed(1)}%`;
  return (
    <View style={styles.wrap}>
      <View style={styles.line}>
        <Text style={[styles.score, { fontSize: scoreFont }]}>
          {rawScore.toFixed(1)}
          <Text style={styles.denominator}> / {effectiveMax}</Text>
        </Text>
        <Text style={[styles.percent, { fontSize: scoreFont - 4 }]}>{pctText}</Text>
        {showTier ? <TierBadge tier={tier} small={size !== 'lg'} /> : null}
      </View>
      {ratedCount !== undefined && itemCount !== undefined ? (
        <Text style={styles.progress}>
          {ratedCount}/{itemCount} rated
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    wrap: { gap: 4 },
    line: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    score: { color: t.text.primary, fontFamily: typography.mono, fontWeight: '700' },
    denominator: { color: t.text.dim, fontWeight: '400' },
    percent: { color: t.text.dim, fontFamily: typography.mono, fontWeight: '600' },
    progress: { color: t.text.faint, fontSize: 12 },
  });

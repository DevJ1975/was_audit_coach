import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Tier } from '@soteria/scoring-engine';
import { tierColors, surfaces, text as textTokens, layout } from '@/theme/tokens';

/** Tier pill in the constant tier palette. `null` renders a muted "N/A" chip. */
export function TierBadge({ tier, small }: { tier: Tier | null; small?: boolean }): React.ReactElement {
  const color = tier ? tierColors[tier] : surfaces.line;
  return (
    <View style={[styles.badge, small && styles.small, { borderColor: color, backgroundColor: color + '22' }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.label, small && styles.labelSmall, { color: tier ? color : textTokens.dim }]}>
        {tier ?? 'N/A'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  small: { paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: 13, fontWeight: '700' },
  labelSmall: { fontSize: 11 },
});

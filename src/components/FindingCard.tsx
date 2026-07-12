/**
 * FindingCard — a finding as a scannable work item: the constant OSHA rating as
 * a 4px left severity rail (NN #7), the item code in mono, the rating tag, the
 * requirement, and (for the cross-audit queue) which audit it belongs to.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SifBadge } from '@/components/badges';
import { ratingColors, layout, typeRamp, typography, type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';
import type { Rating } from '@soteria/scoring-engine';

export interface FindingLike {
  audit_item_id: string;
  item_code: string;
  rating: Rating;
  requirement: string;
  sif_potential?: boolean;
}

export function FindingCard({
  finding,
  auditTitle,
  onPress,
}: {
  finding: FindingLike;
  auditTitle?: string;
  onPress?: () => void;
}): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
  const rail = ratingColors[finding.rating];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, { borderLeftColor: rail }, pressed && styles.pressed]}
    >
      <View style={styles.head}>
        <Text style={styles.code}>{finding.item_code}</Text>
        {finding.sif_potential ? <SifBadge small /> : null}
        <Text style={[styles.tag, { color: rail }]}>{finding.rating}</Text>
      </View>
      <Text style={styles.req} numberOfLines={2}>
        {finding.requirement}
      </Text>
      {auditTitle ? (
        <Text style={styles.audit} numberOfLines={1}>
          {auditTitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surfaces.surface,
      borderRadius: layout.radiusLg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.surfaces.line,
      borderLeftWidth: 4,
      padding: 14,
      gap: 6,
    },
    pressed: { transform: [{ scale: 0.99 }] },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    code: { fontFamily: typography.mono, fontSize: 14, color: t.text.primary },
    tag: { ...typeRamp.label, marginLeft: 'auto' },
    req: { ...typeRamp.bodySm, color: t.text.primary, lineHeight: 18 },
    audit: { ...typeRamp.caption, color: t.text.faint },
  });

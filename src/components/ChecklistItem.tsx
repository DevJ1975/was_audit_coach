/**
 * ChecklistItem — an item as an inline work card in the section list. The whole
 * point of Wave 3: the RatingSelector sits INLINE (NN #2's sole rating path,
 * always visible — the rating is never buried), so an auditor rates straight
 * down the checklist without drilling into each item. Observations, AI, and
 * evidence stay one tap away via the footer (progressive disclosure). The left
 * rail is the constant OSHA rating color once rated (NN #7).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { RatingSelector } from '@/components/RatingSelector';
import { SifBadge } from '@/components/badges';
import { ratingColors, typography, typeRamp, layout, type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';
import type { Rating } from '@soteria/scoring-engine';

export function ChecklistItem({
  index,
  code,
  requirement,
  sif,
  rating,
  hasObservations,
  needsResolution,
  disabled,
  onRate,
  onOpen,
}: {
  index?: number;
  code: string;
  requirement: string;
  sif?: boolean;
  rating: Rating | null;
  hasObservations?: boolean;
  needsResolution?: boolean;
  disabled?: boolean;
  onRate: (rating: Rating) => void;
  onOpen: () => void;
}): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
  const { palette } = useTheme();
  const rail = rating ? ratingColors[rating] : undefined;
  return (
    <View style={[styles.card, rail ? { borderLeftColor: rail, borderLeftWidth: 4 } : null]}>
      <View style={styles.head}>
        <Text style={styles.code}>
          {index !== undefined ? `${index}. ` : ''}
          {code}
        </Text>
        {sif ? <SifBadge small /> : null}
        {rating ? (
          <Text style={[styles.tag, { color: rail }]}>{rating}</Text>
        ) : (
          <Text style={styles.unrated}>Unrated</Text>
        )}
      </View>

      <Text style={styles.req} numberOfLines={3}>
        {requirement}
      </Text>

      {needsResolution ? (
        <Text style={styles.conflict}>Rated differently on another device — resolve on the audit screen.</Text>
      ) : null}

      <RatingSelector value={rating} onChange={onRate} disabled={disabled} />

      <Pressable onPress={onOpen} style={styles.footer} accessibilityRole="button">
        <MaterialCommunityIcons
          name={hasObservations ? 'note-text-outline' : 'plus-circle-outline'}
          size={16}
          color={palette.brand.accent}
        />
        <Text style={styles.footerText}>
          {hasObservations ? 'Observations & evidence' : 'Add observations & evidence'}
        </Text>
        <MaterialCommunityIcons name="chevron-right" size={18} color={palette.text.faint} style={styles.chevron} />
      </Pressable>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.surfaces.surface,
      borderRadius: layout.radiusLg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.surfaces.line,
      padding: 14,
      gap: 10,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    code: { fontFamily: typography.mono, fontSize: 14, color: t.text.primary },
    tag: { ...typeRamp.label, marginLeft: 'auto' },
    unrated: { ...typeRamp.label, color: t.text.faint, marginLeft: 'auto' },
    req: { ...typeRamp.bodySm, color: t.text.primary, lineHeight: 19 },
    conflict: { ...typeRamp.caption, color: t.semantic.warn },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: layout.minTapTarget,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.surfaces.line,
      paddingTop: 8,
    },
    footerText: { ...typeRamp.label, color: t.brand.accent },
    chevron: { marginLeft: 'auto' },
  });

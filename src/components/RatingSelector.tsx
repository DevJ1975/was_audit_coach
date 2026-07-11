/**
 * RatingSelector — the 7 OSHA ratings as ≥48pt buttons in the constant signal
 * palette (Non-Negotiable #7, #10). AUDITOR-ONLY: this is the sole surface that
 * sets `rating`. No AI path reaches it (Non-Negotiable #2).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { RATINGS, type Rating } from '@soteria/scoring-engine';
import { ratingColors, surfaces, text as textTokens, layout } from '@/theme/tokens';

export function RatingSelector({
  value,
  onChange,
  disabled,
}: {
  value: Rating | null;
  onChange: (rating: Rating) => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <View style={styles.grid} accessibilityRole="radiogroup">
      {RATINGS.map((rating) => {
        const selected = value === rating;
        const color = ratingColors[rating];
        return (
          <Pressable
            key={rating}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !!disabled }}
            accessibilityLabel={rating}
            disabled={disabled}
            onPress={() => onChange(rating)}
            style={[
              styles.chip,
              { borderColor: color },
              selected && { backgroundColor: color },
              disabled && styles.disabled,
            ]}
          >
            <Text style={[styles.label, selected ? styles.labelSelected : { color }]} numberOfLines={2}>
              {rating}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    minHeight: layout.minTapTarget,
    minWidth: 96,
    flexGrow: 1,
    flexBasis: '30%',
    borderWidth: 2,
    borderRadius: layout.radius,
    backgroundColor: surfaces.raised,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  disabled: { opacity: 0.5 },
  label: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  labelSelected: { color: '#06121E' },
});

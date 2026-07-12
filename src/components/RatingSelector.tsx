/**
 * RatingSelector — the 7 OSHA ratings as ≥48pt buttons in the constant signal
 * palette (Non-Negotiable #7, #10). AUDITOR-ONLY: this is the sole surface that
 * sets `rating`. No AI path reaches it (Non-Negotiable #2).
 *
 * The chip fill/border are the CONSTANT rating color; the selected label uses the
 * per-rating `ratingOn` contrast color so "High" / "Very High" stay legible.
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { RATINGS, type Rating } from '@soteria/scoring-engine';
import { ratingColors, ratingOn, layout, type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';

export function RatingSelector({
  value,
  onChange,
  disabled,
}: {
  value: Rating | null;
  onChange: (rating: Rating) => void;
  disabled?: boolean;
}): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
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
            onPress={() => {
              // Tactile confirmation for a rating tap — helps gloved hands (NN #10).
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              onChange(rating);
            }}
            style={[
              styles.chip,
              { borderColor: color },
              selected && { backgroundColor: color },
              disabled && styles.disabled,
            ]}
          >
            <Text
              style={[styles.label, { color: selected ? ratingOn[rating] : color }]}
              numberOfLines={2}
            >
              {rating}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      minHeight: layout.minTapTarget,
      minWidth: 96,
      flexGrow: 1,
      flexBasis: '30%',
      borderWidth: 2,
      borderRadius: layout.radius,
      backgroundColor: t.surfaces.raised,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    disabled: { opacity: 0.5 },
    label: { fontSize: 13, fontWeight: '700', textAlign: 'center' },
  });

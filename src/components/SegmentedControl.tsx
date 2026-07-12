/**
 * SegmentedControl — a connected 2–3 segment toggle in the brand palette, ≥48pt
 * tall (NN #10). Replaces the ad-hoc Yes/No button pairs on the new-audit and
 * scoping screens. Selected = brand fill; the rest read as quiet outlined
 * segments. Semantic rating/tier colors are never used here (this is a neutral
 * input, not a risk signal — NN #7).
 */
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { layout, typography, type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';

export interface SegOption<T extends string> {
  label: string;
  value: T;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly SegOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
}): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
  const { palette } = useTheme();
  return (
    <View style={[styles.track, disabled && styles.disabled]} accessibilityRole="radiogroup">
      {options.map((opt, i) => {
        const selected = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled: !!disabled }}
            accessibilityLabel={opt.label}
            disabled={disabled}
            onPress={() => {
              if (Platform.OS !== 'web') void Haptics.selectionAsync();
              onChange(opt.value);
            }}
            style={[
              styles.seg,
              i > 0 && styles.divider,
              selected && { backgroundColor: palette.brand.accent },
            ]}
          >
            <Text
              style={[styles.label, { color: selected ? palette.brand.onAccent : palette.text.dim }]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    track: {
      flexDirection: 'row',
      borderRadius: layout.radius,
      borderWidth: 1,
      borderColor: t.surfaces.line,
      backgroundColor: t.surfaces.raised,
      overflow: 'hidden',
    },
    disabled: { opacity: 0.5 },
    seg: {
      flex: 1,
      minHeight: layout.minTapTarget,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    divider: { borderLeftWidth: 1, borderLeftColor: t.surfaces.line },
    label: { fontFamily: typography.sansSemibold, fontSize: 15 },
  });

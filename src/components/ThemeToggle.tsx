/**
 * ThemeToggle — a 48pt System / Light / Dark segmented control (Non-Negotiable
 * #10). Writes through ThemeProvider.setMode, which persists the choice. "System"
 * follows the device appearance.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme, useThemedStyles, type ThemeMode } from '@/theme/ThemeProvider';
import { layout, type Palette } from '@/theme/tokens';

const OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'system', label: 'System' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
];

export function ThemeToggle(): React.ReactElement {
  const { mode, setMode, palette } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
      {OPTIONS.map((o) => {
        const on = mode === o.mode;
        return (
          <Pressable
            key={o.mode}
            onPress={() => setMode(o.mode)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.label}
            style={[
              styles.chip,
              on && { backgroundColor: palette.brand.accent, borderColor: palette.brand.accent },
            ]}
          >
            <Text style={[styles.label, on && { color: palette.brand.onAccent }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    wrap: { flexDirection: 'row', gap: 8 },
    chip: {
      flex: 1,
      minHeight: layout.minTapTarget,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: layout.radius,
      borderWidth: 1,
      borderColor: t.surfaces.line,
      backgroundColor: t.surfaces.raised,
      paddingHorizontal: 12,
    },
    label: { color: t.text.dim, fontSize: 14, fontWeight: '700' },
  });

/**
 * CoachTip — the one decorative flourish the brand sanctions. A soft brand-red
 * wash card with a filled school-icon coin and encouraging, data-tied guidance
 * ("nice catch" moments, never scolding). Flat fill (no gradient) per the
 * "whisper-quiet" rule.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { layout, typeRamp, type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';

export function CoachTip({
  title = 'Coach tip',
  children,
  actionLabel,
  onAction,
  compact,
}: {
  title?: string;
  children: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View
      style={[
        styles.wrap,
        compact && styles.compact,
        { backgroundColor: palette.brand.soft, borderColor: palette.brand.accent + '40' },
      ]}
    >
      <View style={[styles.coin, { backgroundColor: palette.brand.accent }]}>
        <MaterialCommunityIcons name="school" size={19} color={palette.brand.onAccent} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.label, { color: palette.brand.accent }]}>{title}</Text>
        <Text style={styles.copy}>{children}</Text>
        {actionLabel ? (
          <Pressable onPress={onAction} style={styles.action} accessibilityRole="button" hitSlop={8}>
            <Text style={[styles.actionText, { color: palette.brand.accent }]}>{actionLabel}</Text>
            <MaterialCommunityIcons name="arrow-right" size={16} color={palette.brand.accent} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    wrap: {
      flexDirection: 'row',
      gap: 12,
      alignItems: 'flex-start',
      padding: 16,
      borderRadius: layout.radiusLg,
      borderWidth: 1,
    },
    compact: { paddingVertical: 12, paddingHorizontal: 14 },
    coin: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
    body: { flex: 1, minWidth: 0 },
    label: { ...typeRamp.label, marginBottom: 3 },
    copy: { ...typeRamp.bodySm, color: t.text.dim, lineHeight: 19 },
    action: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, minHeight: 32 },
    actionText: { ...typeRamp.label },
  });

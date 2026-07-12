/**
 * EmptyState — a centered zero-state with a sunken icon coin, a title, and
 * coach-tone copy (encouraging, never blaming). Optional action node.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { typeRamp, type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';

export function EmptyState({
  icon = 'inbox-outline',
  title,
  message,
  action,
}: {
  icon?: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
  message?: string;
  action?: React.ReactNode;
}): React.ReactElement {
  const { palette } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.wrap}>
      <View style={[styles.coin, { backgroundColor: palette.surfaces.sunken }]}>
        <MaterialCommunityIcons name={icon} size={30} color={palette.text.faint} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const makeStyles = (t: Palette) =>
  StyleSheet.create({
    wrap: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 24, gap: 6 },
    coin: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
    title: { ...typeRamp.titleSm, color: t.text.primary, textAlign: 'center' },
    message: { ...typeRamp.body, color: t.text.dim, textAlign: 'center', maxWidth: 300 },
    action: { marginTop: 12 },
  });

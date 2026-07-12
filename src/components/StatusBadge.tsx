/**
 * StatusBadge — a pill for audit/CA lifecycle status, with a filled leading
 * icon. Colors derive from the palette's semantic hues (not the constant OSHA
 * rating palette). "Overdue" is filled for emphasis; the rest are soft tints.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { typography, type Palette } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export type BadgeStatus =
  | 'draft'
  | 'in_progress'
  | 'complete'
  | 'archived'
  | 'open'
  | 'verified'
  | 'closed'
  | 'overdue'
  | 'scheduled'
  | 'pass'
  | 'fail';

function tone(status: BadgeStatus, p: Palette): { color: string; icon: IconName; filled?: boolean; label: string } {
  switch (status) {
    case 'in_progress':
      return { color: p.semantic.warn, icon: 'progress-clock', label: 'In progress' };
    case 'complete':
      return { color: p.semantic.success, icon: 'check-circle', label: 'Complete' };
    case 'verified':
      return { color: p.semantic.success, icon: 'check-decagram', label: 'Verified' };
    case 'closed':
      return { color: p.semantic.success, icon: 'check-circle', label: 'Closed' };
    case 'pass':
      return { color: p.semantic.success, icon: 'check-circle', label: 'Pass' };
    case 'open':
      return { color: p.semantic.danger, icon: 'flag', label: 'Open' };
    case 'fail':
      return { color: p.semantic.danger, icon: 'alert-circle', label: 'Fail' };
    case 'overdue':
      return { color: p.semantic.danger, icon: 'clock-alert-outline', filled: true, label: 'Overdue' };
    case 'archived':
      return { color: p.text.faint, icon: 'archive-outline', label: 'Archived' };
    case 'scheduled':
      return { color: p.text.dim, icon: 'calendar', label: 'Scheduled' };
    case 'draft':
    default:
      return { color: p.text.dim, icon: 'file-document-edit-outline', label: 'Draft' };
  }
}

export function StatusBadge({
  status,
  label,
  small,
}: {
  status: BadgeStatus;
  label?: string;
  small?: boolean;
}): React.ReactElement {
  const { palette } = useTheme();
  const t = tone(status, palette);
  const bg = t.filled ? t.color : t.color + '22';
  const fg = t.filled ? '#FFFFFF' : t.color;
  return (
    <View style={[styles.badge, small && styles.small, { backgroundColor: bg }]}>
      <MaterialCommunityIcons name={t.icon} size={small ? 12 : 13} color={fg} />
      <Text style={[styles.text, small && styles.textSmall, { color: fg }]}>{label ?? t.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  small: { height: 20, paddingHorizontal: 8, gap: 4 },
  text: { fontFamily: typography.sansSemibold, fontSize: 12, letterSpacing: 0.12 },
  textSmall: { fontSize: 11 },
});

/**
 * AuditCard — the Audits-list summary card: title, plan · date, a StatusBadge,
 * and a privilege marker. Replaces the old text-only Settings-style Row so the
 * front door scans like a dashboard. Press gives a subtle scale + accent border.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { StatusBadge } from '@/components/StatusBadge';
import { PrivBadge } from '@/components/badges';
import { layout, typeRamp, type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';
import type { Audit } from '@/db/types';

export function AuditCard({ audit, onPress }: { audit: Audit; onPress: () => void }): React.ReactElement {
  const styles = useThemedStyles(makeStyles);
  const meta = [audit.state_plan || 'Federal OSHA', new Date(audit.created_at).toLocaleDateString()].join(' · ');
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={audit.title}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.top}>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {audit.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <StatusBadge status={audit.status} small />
      </View>
      {audit.privileged ? (
        <View style={styles.badges}>
          <PrivBadge small />
        </View>
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
      padding: 16,
      gap: 10,
    },
    pressed: { transform: [{ scale: 0.985 }], borderColor: t.brand.accent + '55' },
    top: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    titleWrap: { flex: 1, minWidth: 0, gap: 2 },
    title: { ...typeRamp.titleSm, color: t.text.primary },
    meta: { ...typeRamp.bodySm, color: t.text.faint },
    badges: { flexDirection: 'row', gap: 6 },
  });

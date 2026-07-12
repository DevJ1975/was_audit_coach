/**
 * Collapsible — a titled Card whose body folds away, with a ≥48pt tappable
 * header, chevron, and an optional `right` slot (e.g. a SavedFlash). Extracted
 * from the item-card's inline collapse so Requirement / ARIA / Notes share one
 * behavior. LayoutAnimation on native only (web ignores it, per the app's
 * existing guard).
 */
import React, { useState } from 'react';
import { LayoutAnimation, Platform, Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Card, Subtitle } from '@/components/ui';
import { layout, type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';

export function Collapsible({
  title,
  defaultOpen = false,
  accent,
  titleColor,
  right,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  /** Left accent border (passed through to Card). */
  accent?: string;
  /** Override the title color (e.g. brand accent for a prominent section). */
  titleColor?: string;
  /** Trailing header content shown left of the chevron (stays visible collapsed). */
  right?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const styles = useThemedStyles(makeStyles);
  const { palette } = useTheme();
  return (
    <Card accent={accent}>
      <Pressable
        onPress={() => {
          if (Platform.OS !== 'web') LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen((v) => !v);
        }}
        style={styles.head}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <Subtitle style={titleColor ? { color: titleColor } : undefined}>{title}</Subtitle>
        <View style={styles.right}>
          {right}
          <MaterialCommunityIcons
            name={open ? 'chevron-down' : 'chevron-right'}
            size={22}
            color={palette.text.dim}
          />
        </View>
      </Pressable>
      {open ? <View style={styles.body}>{children}</View> : null}
    </Card>
  );
}

const makeStyles = (_t: Palette) =>
  StyleSheet.create({
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: layout.minTapTarget,
      paddingVertical: 4,
    },
    right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    body: { gap: 10, marginTop: 2 },
  });

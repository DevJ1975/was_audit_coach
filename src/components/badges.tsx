import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Surface } from 'react-native-paper';
import type { Rating } from '@soteria/scoring-engine';
import { ratingColors } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import type { ColorScheme } from '@/theme/tokens';

/** Small color dot for a rating (item lists). Muted when unrated. */
export function RatingDot({ rating }: { rating: Rating | null }): React.ReactElement {
  const { palette } = useTheme();
  const color = rating ? ratingColors[rating] : palette.surfaces.line;
  return (
    <View
      style={[dotStyles.dot, { backgroundColor: color, borderColor: rating ? color : palette.surfaces.line }]}
    />
  );
}

const dotStyles = StyleSheet.create({
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1 },
});

/**
 * Serious Injury or Fatality badge. A CONSTANT risk signal (like the rating
 * palette) — deliberately not themed so it reads identically everywhere.
 */
export function SifBadge({ small }: { small?: boolean }): React.ReactElement {
  return (
    <View style={[sifStyles.badge, small && sifStyles.small]}>
      <Text style={[sifStyles.text, small && sifStyles.textSmall]}>SIF</Text>
    </View>
  );
}

const sifStyles = StyleSheet.create({
  badge: { backgroundColor: '#8F1D28', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  small: { paddingHorizontal: 5, paddingVertical: 2 },
  text: { color: '#FDE2E2', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  textSmall: { fontSize: 10 },
});

/** Amber privilege tones, theme-aware: deep on dark, soft on light. */
function privTones(scheme: ColorScheme) {
  return scheme === 'dark'
    ? { bg: '#2A1B12', border: '#B0793C', title: '#E7C33B' }
    : { bg: '#FBF3E4', border: '#B0793C', title: '#8A6410' };
}

/**
 * Compact privileged-audit marker for list rows (the full PrivilegeBanner is for
 * detail screens). Amber — NEVER the SIF badge, which signals serious-injury
 * potential, an unrelated semantic.
 */
export function PrivBadge({ small }: { small?: boolean }): React.ReactElement {
  const { scheme } = useTheme();
  const c = privTones(scheme);
  return (
    <View style={[privChip.badge, { backgroundColor: c.bg, borderColor: c.border }, small && privChip.small]}>
      <Text style={[privChip.text, { color: c.title }, small && privChip.textSmall]}>PRIV</Text>
    </View>
  );
}

const privChip = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  small: { paddingHorizontal: 5, paddingVertical: 2 },
  text: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  textSmall: { fontSize: 10 },
});

/** Privilege banner shown on privileged audits (attorney-client work product). */
export function PrivilegeBanner({ attorney }: { attorney?: string | null }): React.ReactElement {
  const { scheme, palette } = useTheme();
  const c = privTones(scheme);
  return (
    <Surface
      elevation={2}
      style={[privBanner.banner, { backgroundColor: c.bg, borderColor: c.border }]}
      accessibilityRole="alert"
    >
      <Text style={[privBanner.title, { color: c.title }]}>
        PRIVILEGED &amp; CONFIDENTIAL — ATTORNEY WORK PRODUCT
      </Text>
      {attorney ? (
        <Text style={[privBanner.sub, { color: palette.text.dim }]}>
          Prepared at the direction of counsel: {attorney}
        </Text>
      ) : null}
    </Surface>
  );
}

const privBanner = StyleSheet.create({
  banner: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  title: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  sub: { fontSize: 11 },
});

export type SaveStatus = 'saved' | 'error' | null;

/** Autosave status flash — confirms a debounced write landed, or that it failed. */
export function SavedFlash({ status }: { status: SaveStatus }): React.ReactElement | null {
  const { scheme, palette } = useTheme();
  if (!status) return null;
  const isError = status === 'error';
  const pillBg = isError ? (scheme === 'dark' ? '#3A1A1A' : '#FBE6E6') : palette.surfaces.raised;
  const textColor = isError ? palette.semantic.warn : palette.semantic.success;
  return (
    <View style={[savedStyles.pill, { backgroundColor: pillBg }]}>
      <Text style={[savedStyles.text, { color: textColor }]}>
        {isError ? '⚠ Save failed — keep editing to retry' : '✓ Saved'}
      </Text>
    </View>
  );
}

const savedStyles = StyleSheet.create({
  pill: { alignSelf: 'flex-end', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  text: { fontSize: 12, fontWeight: '700' },
});

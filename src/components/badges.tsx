import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Surface } from 'react-native-paper';
import type { Rating } from '@soteria/scoring-engine';
import { ratingColors, semantic, surfaces, text as textTokens } from '@/theme/tokens';

/** Small color dot for a rating (item lists). Muted when unrated. */
export function RatingDot({ rating }: { rating: Rating | null }): React.ReactElement {
  const color = rating ? ratingColors[rating] : surfaces.line;
  return <View style={[dotStyles.dot, { backgroundColor: color, borderColor: rating ? color : surfaces.line }]} />;
}

const dotStyles = StyleSheet.create({
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 1 },
});

/** Serious Injury or Fatality badge (Non-Negotiable: prominent SIF signalling). */
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

/**
 * Compact privileged-audit marker for list rows (the full PrivilegeBanner is
 * for detail screens). Amber like the banner — NEVER the SIF badge, which
 * signals serious-injury potential, an unrelated semantic.
 */
export function PrivBadge({ small }: { small?: boolean }): React.ReactElement {
  return (
    <View style={[privChip.badge, small && privChip.small]}>
      <Text style={[privChip.text, small && privChip.textSmall]}>PRIV</Text>
    </View>
  );
}

const privChip = StyleSheet.create({
  badge: { backgroundColor: '#2A1B12', borderWidth: 1, borderColor: '#B0793C', borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  small: { paddingHorizontal: 5, paddingVertical: 2 },
  text: { color: semantic.warn, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  textSmall: { fontSize: 10 },
});

/** Privilege banner shown on privileged audits (attorney-client work product). */
export function PrivilegeBanner({ attorney }: { attorney?: string | null }): React.ReactElement {
  return (
    <Surface elevation={2} style={privStyles.banner} accessibilityRole="alert">
      <Text style={privStyles.title}>PRIVILEGED &amp; CONFIDENTIAL — ATTORNEY WORK PRODUCT</Text>
      {attorney ? <Text style={privStyles.sub}>Prepared at the direction of counsel: {attorney}</Text> : null}
    </Surface>
  );
}

const privStyles = StyleSheet.create({
  banner: {
    backgroundColor: '#2A1B12',
    borderWidth: 1,
    borderColor: '#B0793C',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  title: { color: '#E7C33B', fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  sub: { color: textTokens.dim, fontSize: 11 },
});

export type SaveStatus = 'saved' | 'error' | null;

/** Autosave status flash — confirms a debounced write landed, or that it failed. */
export function SavedFlash({ status }: { status: SaveStatus }): React.ReactElement | null {
  if (!status) return null;
  const isError = status === 'error';
  return (
    <View style={[savedStyles.pill, isError && savedStyles.pillError]}>
      <Text style={[savedStyles.text, isError && savedStyles.textError]}>
        {isError ? '⚠ Save failed — keep editing to retry' : '✓ Saved'}
      </Text>
    </View>
  );
}

const savedStyles = StyleSheet.create({
  pill: { alignSelf: 'flex-end', backgroundColor: surfaces.raised, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillError: { backgroundColor: '#3A1A1A' },
  text: { color: '#3CA96B', fontSize: 12, fontWeight: '700' },
  textError: { color: '#E7C33B' },
});

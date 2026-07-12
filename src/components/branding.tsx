/**
 * White-label branding. WLS Audit Coach is the WLS org's white-label theme of
 * Soteria Audit (plan Part 5). The header carries the org logo; the footer
 * carries the platform attribution.
 *
 * The WLS wordmark colors (red "Workplace" / grey "Learning System") are the
 * brand mark itself and are intentionally CONSTANT across light/dark. The footer
 * chrome follows the active theme.
 *
 * LOGO: the real "Workplace Learning System" mark goes at
 * assets/branding/wls-logo.png. Until it's provided, BrandLogo renders the
 * wordmark fallback so the header is branded immediately.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { versionLabel } from '@/version';
import { type Palette } from '@/theme/tokens';
import { useThemedStyles } from '@/theme/ThemeProvider';

const WLS_RED = '#E1251B';
const WLS_GREY = '#6B7280';

/**
 * WLS header logo. Wordmark fallback until the raster mark is added.
 *
 * To use the real logo: add assets/branding/wls-logo.png, then replace the
 * returned View with an <Image> pointing at it.
 */
export function BrandLogo({ height = 34 }: { height?: number }): React.ReactElement {
  return (
    <View style={styles.wordmark} accessibilityLabel="Workplace Learning System">
      <Text style={[styles.word, styles.red, { fontSize: height * 0.44 }]}>Workplace</Text>
      <Text style={[styles.word, styles.grey, { fontSize: height * 0.44 }]}> Learning System</Text>
    </View>
  );
}

export function AppFooter(): React.ReactElement {
  const f = useThemedStyles(makeFooterStyles);
  return (
    <View style={f.footer}>
      <Text style={f.footerText}>Powered by Trainovate Technologies LLC · {versionLabel()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  word: { fontWeight: '800', letterSpacing: 0.2 },
  red: { color: WLS_RED },
  grey: { color: WLS_GREY },
});

const makeFooterStyles = (t: Palette) =>
  StyleSheet.create({
    footer: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.surfaces.line,
      backgroundColor: t.surfaces.surface,
      paddingVertical: 8,
      alignItems: 'center',
    },
    footerText: { color: t.text.faint, fontSize: 11, letterSpacing: 0.3 },
  });

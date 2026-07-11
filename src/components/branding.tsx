/**
 * White-label branding. WLS Audit Coach is the WLS org's white-label theme of
 * Soteria Audit (plan Part 5). The header carries the org logo; the footer
 * carries the platform attribution.
 *
 * LOGO: the real "Workplace Learning System" mark goes at
 * assets/branding/wls-logo.png. Until it's provided, BrandLogo renders a
 * wordmark fallback in the logo's palette (red "Workplace" / grey "Learning
 * System") so the header is branded immediately. To use the raster, set
 * USE_RASTER_LOGO = true after adding the file.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { versionLabel } from '@/version';
import { text as textTokens, surfaces } from '@/theme/tokens';

const WLS_RED = '#E1251B';
const WLS_GREY = '#6B7280';

/**
 * WLS header logo. Wordmark fallback until the raster mark is added.
 *
 * To use the real logo: add assets/branding/wls-logo.png, then replace the
 * returned View with:
 *   <Image source={require('../../assets/branding/wls-logo.png')}
 *          style={{ height, width: height * 2.2, resizeMode: 'contain' }}
 *          accessibilityLabel="Workplace Learning System" />
 * (Metro resolves require() statically, so only add it once the file exists.)
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
  return (
    <View style={styles.footer}>
      <Text style={styles.footerText}>
        Powered by Trainovate Technologies LLC · {versionLabel()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  word: { fontWeight: '800', letterSpacing: 0.2 },
  red: { color: WLS_RED },
  grey: { color: WLS_GREY },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: surfaces.line,
    backgroundColor: surfaces.surface,
    paddingVertical: 8,
    alignItems: 'center',
  },
  footerText: { color: textTokens.faint, fontSize: 11, letterSpacing: 0.3 },
});

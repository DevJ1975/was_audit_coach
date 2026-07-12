/**
 * White-label branding — WLS Audit Coach. The header carries the product lockup
 * (the real WLS globe mark from the design-system kit + the "Audit Coach"
 * wordmark in the brand font); the footer carries the platform attribution.
 *
 * Logo assets live in assets/branding/logo/ (SVG masters + PNG exports from the
 * kit). The globe reads on both light and dark headers; below ~24px the flat
 * glyph variants should be used instead.
 */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { versionLabel } from '@/version';
import { typography, type Palette } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/theme/ThemeProvider';

// Metro resolves require() statically; the PNG is bundled at build time.
const GLOBE = require('../../assets/branding/logo/png/wls-globe-128.png');

/** WLS Audit Coach header lockup: the globe mark + the product wordmark. */
export function BrandLogo({ height = 34 }: { height?: number }): React.ReactElement {
  const { palette } = useTheme();
  return (
    <View style={styles.lockup} accessibilityLabel="WLS Audit Coach">
      <Image source={GLOBE} style={{ width: height, height, resizeMode: 'contain' }} />
      <Text style={[styles.product, { color: palette.text.primary, fontSize: height * 0.46 }]}>
        Audit Coach
      </Text>
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
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  product: { fontFamily: typography.sansBold, letterSpacing: 0.2 },
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
    footerText: { color: t.text.faint, fontSize: 11, letterSpacing: 0.3, fontFamily: typography.sans },
  });

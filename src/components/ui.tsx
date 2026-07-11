/**
 * Shared UI primitives — dark-first, 48pt tap targets (Non-Negotiable #10).
 * Kept dependency-light so every screen composes from the same vocabulary.
 *
 * These now compose React Native Paper (Material 3) chrome — Surface/Button/
 * TouchableRipple/Text — themed via `paperTheme`. Semantic rating & tier colors
 * are NEVER sourced from Paper's palette; they stay in src/theme/tokens.ts (#7).
 */
import React from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {
  Button as PaperButton,
  Surface,
  Text as PaperText,
  TouchableRipple,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { surfaces, text as textTokens, layout, typography } from '@/theme/tokens';

export function Screen({
  children,
  scroll = true,
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, contentStyle]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.scrollContent, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Card({
  children,
  style,
  accent,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Left accent border color (e.g. rating color, or evidence-protocol accent). */
  accent?: string;
}): React.ReactElement {
  return (
    <Surface
      elevation={1}
      style={[styles.card, accent ? { borderLeftWidth: 4, borderLeftColor: accent } : null, style]}
    >
      {children}
    </Surface>
  );
}

export function Title({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <PaperText variant="titleLarge" style={[styles.title, style]}>
      {children}
    </PaperText>
  );
}
export function Subtitle({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <PaperText variant="labelLarge" style={[styles.subtitle, style]}>
      {children}
    </PaperText>
  );
}
export function Body({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <PaperText variant="bodyMedium" style={[styles.body, style]}>
      {children}
    </PaperText>
  );
}
export function Mono({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <PaperText style={[styles.mono, style]}>{children}</PaperText>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}): React.ReactElement {
  const mode = variant === 'primary' ? 'contained' : variant === 'secondary' ? 'contained-tonal' : 'text';
  return (
    <PaperButton
      mode={mode}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.button, style]}
      contentStyle={styles.buttonContent}
      labelStyle={styles.buttonLabel}
    >
      {label}
    </PaperButton>
  );
}

/** Full-width tappable row (48pt+) for lists, with Material ripple feedback. */
export function Row({
  children,
  onPress,
  accent,
  style,
  testID,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accent?: string;
  style?: StyleProp<ViewStyle>;
  /** Stable id for e2e selectors (Maestro `id:`). */
  testID?: string;
}): React.ReactElement {
  return (
    <Surface
      elevation={1}
      style={[styles.rowSurface, accent ? { borderLeftWidth: 4, borderLeftColor: accent } : null, style]}
    >
      <TouchableRipple
        accessibilityRole={onPress ? 'button' : undefined}
        onPress={onPress}
        disabled={!onPress}
        style={styles.rowRipple}
        testID={testID}
        borderless
      >
        <View style={styles.rowInner}>{children}</View>
      </TouchableRipple>
    </Surface>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: surfaces.bg },
  scrollContent: { padding: layout.gap, gap: layout.gap },
  card: {
    backgroundColor: surfaces.surface,
    borderRadius: layout.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaces.line,
    padding: layout.gap,
    gap: 8,
  },
  title: { color: textTokens.primary, fontSize: 20, fontWeight: '700' },
  subtitle: { color: textTokens.dim, fontSize: 13, fontWeight: '600' },
  body: { color: textTokens.primary, fontSize: 15, lineHeight: 21 },
  mono: { color: textTokens.primary, fontFamily: typography.mono, fontSize: 13 },
  button: { borderRadius: layout.radius, justifyContent: 'center' },
  buttonContent: { minHeight: layout.minTapTarget, paddingHorizontal: 10 },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  rowSurface: {
    backgroundColor: surfaces.surface,
    borderRadius: layout.radius,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surfaces.line,
    overflow: 'hidden',
  },
  rowRipple: { borderRadius: layout.radius },
  rowInner: {
    minHeight: layout.minTapTarget,
    paddingHorizontal: layout.gap,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});

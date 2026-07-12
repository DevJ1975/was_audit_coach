/**
 * HeaderAccount — the top-right account control on the Audits header.
 *
 * Replaces the old faint "Sign in" text link (which field users repeatedly
 * could not find). Signed out: an obvious brand-outlined pill with an account
 * icon. Signed in: an avatar chip (initial + name) that still opens the account
 * screen. Colors follow the active theme.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from '@/theme/ThemeProvider';

export function HeaderAccount(): React.ReactElement {
  const { session } = useAuth();
  const { palette } = useTheme();
  const router = useRouter();
  const name = session?.user.email ? session.user.email.split('@')[0]! : '';

  if (session && name) {
    return (
      <Pressable
        onPress={() => router.push('/login')}
        style={styles.account}
        accessibilityRole="button"
        accessibilityLabel={`Account: ${name}`}
        hitSlop={8}
      >
        <View style={[styles.avatar, { backgroundColor: palette.brand.accent }]}>
          <Text style={[styles.avatarText, { color: palette.brand.onAccent }]}>
            {name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={[styles.name, { color: palette.text.primary }]} numberOfLines={1}>
          {name}
        </Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={() => router.push('/login')}
      style={[styles.pill, { backgroundColor: palette.brand.soft, borderColor: palette.brand.accent }]}
      accessibilityRole="button"
      accessibilityLabel="Sign in"
      hitSlop={8}
    >
      <MaterialCommunityIcons name="account-circle-outline" size={18} color={palette.brand.accent} />
      <Text style={[styles.pillText, { color: palette.brand.accent }]}>Sign in</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 6,
    minHeight: 40,
    maxWidth: 150,
  },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800' },
  name: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1.5,
    marginRight: 10,
    minHeight: 38,
  },
  pillText: { fontSize: 14, fontWeight: '700' },
});

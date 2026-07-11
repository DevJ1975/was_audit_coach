import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { RepoProvider } from '@/db/RepoProvider';
import { BrandLogo, AppFooter } from '@/components/branding';
import { paperTheme } from '@/theme/paperTheme';
import { registerServiceWorker } from '@/pwa/registerSw';
import { brand, surfaces, text as textTokens } from '@/theme/tokens';

/** Header account link — reflects the session instead of always "Sign in". */
function AccountLink(): React.ReactElement {
  const { session } = useAuth();
  const label = session?.user.email ? session.user.email.split('@')[0]! : 'Sign in';
  return (
    <Link href="/login" style={styles.signIn} numberOfLines={1}>
      {label}
    </Link>
  );
}

export default function RootLayout(): React.ReactElement {
  // Offline web shell (PWA). No-op on native and in dev. Registered from the
  // component lifecycle so module evaluation (tests, static passes) stays
  // side-effect free.
  React.useEffect(() => registerServiceWorker(), []);
  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <AuthProvider>
          <RepoProvider>
            <StatusBar style="light" />
            <View style={styles.root}>
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: surfaces.surface },
                  headerTintColor: textTokens.primary,
                  headerTitleStyle: { color: textTokens.primary },
                  contentStyle: { backgroundColor: surfaces.bg },
                }}
              >
                {/* Root shows the WLS logo in the header; inner screens set their own titles. */}
                <Stack.Screen
                  name="index"
                  options={{
                    headerTitle: () => <BrandLogo />,
                    headerTitleAlign: 'center',
                    headerRight: () => <AccountLink />,
                  }}
                />
                <Stack.Screen name="login" options={{ title: 'Sign in', presentation: 'modal' }} />
                <Stack.Screen name="audit/new" options={{ title: 'New Audit', presentation: 'modal' }} />
              </Stack>
              <AppFooter />
            </View>
          </RepoProvider>
        </AuthProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: surfaces.bg },
  signIn: { color: brand.default, fontWeight: '600', paddingHorizontal: 12, fontSize: 15, maxWidth: 140 },
});

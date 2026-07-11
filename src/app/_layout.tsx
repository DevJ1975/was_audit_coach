import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { AuthProvider } from '@/auth/AuthProvider';
import { RepoProvider } from '@/db/RepoProvider';
import { BrandLogo, AppFooter } from '@/components/branding';
import { paperTheme } from '@/theme/paperTheme';
import { surfaces, text as textTokens } from '@/theme/tokens';

export default function RootLayout(): React.ReactElement {
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
                    headerRight: () => (
                      <Link href="/login" style={styles.signIn}>
                        Sign in
                      </Link>
                    ),
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
  signIn: { color: '#4FA3E3', fontWeight: '600', paddingHorizontal: 12, fontSize: 15 },
});

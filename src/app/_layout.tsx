import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { RepoProvider } from '@/db/RepoProvider';
import { BrandLogo, AppFooter } from '@/components/branding';
import { paperThemes } from '@/theme/paperTheme';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { registerServiceWorker } from '@/pwa/registerSw';

/**
 * Route react-native-paper's icon props (Button `icon`, Chip, etc.) through
 * @expo/vector-icons so icons render on web + native without a native link step.
 */
type PaperIconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
const paperSettings = {
  icon: (props: { name: string; color?: string; size?: number }) => (
    <MaterialCommunityIcons name={props.name as PaperIconName} color={props.color} size={props.size} />
  ),
};

/** Header account link — reflects the session instead of always "Sign in". */
function AccountLink(): React.ReactElement {
  const { session } = useAuth();
  const { palette } = useTheme();
  const label = session?.user.email ? session.user.email.split('@')[0]! : 'Sign in';
  return (
    <Link href="/login" style={[styles.signIn, { color: palette.brand.accent }]} numberOfLines={1}>
      {label}
    </Link>
  );
}

/**
 * The app tree, themed by the active scheme. Lives under ThemeProvider so it can
 * read useTheme() and drive Paper, the status bar, and the native root color.
 */
function ThemedApp(): React.ReactElement {
  const { scheme, palette } = useTheme();

  // Keep the native root background in sync so navigation/rotation never flashes
  // the wrong color. Best-effort / no-op on web.
  React.useEffect(() => {
    void SystemUI.setBackgroundColorAsync(palette.surfaces.bg).catch(() => {});
  }, [palette.surfaces.bg]);

  return (
    <PaperProvider theme={paperThemes[scheme]} settings={paperSettings}>
      <AuthProvider>
        <RepoProvider>
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <View style={[styles.root, { backgroundColor: palette.surfaces.bg }]}>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: palette.surfaces.surface },
                headerTintColor: palette.text.primary,
                headerTitleStyle: { color: palette.text.primary },
                contentStyle: { backgroundColor: palette.surfaces.bg },
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
  );
}

export default function RootLayout(): React.ReactElement {
  // Offline web shell (PWA). No-op on native and in dev. Registered from the
  // component lifecycle so module evaluation (tests, static passes) stays
  // side-effect free.
  React.useEffect(() => registerServiceWorker(), []);
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedApp />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  signIn: { fontWeight: '600', paddingHorizontal: 12, fontSize: 15, maxWidth: 140 },
});

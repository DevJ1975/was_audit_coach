import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { PaperProvider } from 'react-native-paper';
import { AuthProvider } from '@/auth/AuthProvider';
import { RepoProvider } from '@/db/RepoProvider';
import { BrandLogo, AppFooter } from '@/components/branding';
import { HeaderAccount } from '@/components/HeaderAccount';
import { paperThemes } from '@/theme/paperTheme';
import { ThemeProvider, useTheme } from '@/theme/ThemeProvider';
import { registerServiceWorker } from '@/pwa/registerSw';
import { useFonts } from 'expo-font';
import {
  SourceSans3_400Regular,
  SourceSans3_500Medium,
  SourceSans3_600SemiBold,
  SourceSans3_700Bold,
} from '@expo-google-fonts/source-sans-3';
import {
  IBMPlexMono_400Regular,
  IBMPlexMono_500Medium,
  IBMPlexMono_600SemiBold,
} from '@expo-google-fonts/ibm-plex-mono';

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
                  headerRight: () => <HeaderAccount />,
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
  // Brand fonts — Source Sans 3 (UI) + IBM Plex Mono (data). Each weight is
  // registered as its own family name so the type ramp can select weights.
  const [fontsLoaded, fontError] = useFonts({
    'SourceSans3-Regular': SourceSans3_400Regular,
    'SourceSans3-Medium': SourceSans3_500Medium,
    'SourceSans3-SemiBold': SourceSans3_600SemiBold,
    'SourceSans3-Bold': SourceSans3_700Bold,
    'IBMPlexMono-Regular': IBMPlexMono_400Regular,
    'IBMPlexMono-Medium': IBMPlexMono_500Medium,
    'IBMPlexMono-SemiBold': IBMPlexMono_600SemiBold,
  });

  // Offline web shell (PWA). No-op on native and in dev. Registered from the
  // component lifecycle so module evaluation (tests, static passes) stays
  // side-effect free.
  React.useEffect(() => registerServiceWorker(), []);

  // Hold the first paint until fonts are ready (avoids a system-font flash),
  // but never block forever — on a font error fall back to system fonts.
  if (!fontsLoaded && !fontError) {
    return (
      <SafeAreaProvider>
        <View style={styles.boot} />
      </SafeAreaProvider>
    );
  }

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
  boot: { flex: 1, backgroundColor: '#131417' },
});

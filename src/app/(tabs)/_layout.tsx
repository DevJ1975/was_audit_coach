/**
 * Bottom-tab shell — Home · Audits · Findings · Coach. The account control lives
 * top-right on every tab; opening an audit pushes onto the ROOT stack (a sibling
 * of this group), which covers the tab bar. Icons fill when the tab is active.
 */
import React from 'react';
import { Tabs } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BrandLogo } from '@/components/branding';
import { HeaderAccount } from '@/components/HeaderAccount';
import { useTheme } from '@/theme/ThemeProvider';
import { typography } from '@/theme/tokens';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
function tabIcon(active: IconName, inactive: IconName) {
  const Icon = ({ color, size, focused }: { color: string; size: number; focused: boolean }) => (
    <MaterialCommunityIcons name={focused ? active : inactive} size={size} color={color} />
  );
  return Icon;
}

export default function TabsLayout(): React.ReactElement {
  const { palette } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: palette.surfaces.surface },
        headerTintColor: palette.text.primary,
        headerTitleStyle: { color: palette.text.primary, fontFamily: typography.sansSemibold },
        headerShadowVisible: false,
        headerRight: () => <HeaderAccount />,
        tabBarStyle: { backgroundColor: palette.surfaces.surface, borderTopColor: palette.surfaces.line },
        tabBarActiveTintColor: palette.brand.accent,
        tabBarInactiveTintColor: palette.text.faint,
        tabBarLabelStyle: { fontFamily: typography.sansSemibold, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          headerTitle: () => <BrandLogo />,
          headerTitleAlign: 'center',
          tabBarLabel: 'Home',
          tabBarIcon: tabIcon('home', 'home-outline'),
        }}
      />
      <Tabs.Screen
        name="audits"
        options={{ title: 'Audits', tabBarIcon: tabIcon('clipboard-check', 'clipboard-check-outline') }}
      />
      <Tabs.Screen
        name="findings"
        options={{ title: 'Findings', tabBarIcon: tabIcon('flag', 'flag-outline') }}
      />
      <Tabs.Screen
        name="coach"
        options={{ title: 'Coach', tabBarIcon: tabIcon('school', 'school-outline') }}
      />
    </Tabs>
  );
}

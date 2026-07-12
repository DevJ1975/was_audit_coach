/**
 * ThemeProvider — the runtime light/dark layer the app previously lacked.
 *
 * `mode` is the user's choice ('system' | 'light' | 'dark'), persisted in
 * AsyncStorage. `scheme` is the resolved 'light' | 'dark' — when mode is
 * 'system' it follows the OS via useColorScheme(), falling back to DARK (the
 * poorly-lit-plant default, Non-Negotiable #10) when the OS reports nothing.
 *
 * Screens/components read `palette` via useTheme(), and build their StyleSheets
 * with useThemedStyles(makeStyles) so styles recompute only when the palette
 * changes. Rating/tier colors are NOT themed — they come straight from tokens.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { palettes, type ColorScheme, type Palette } from './tokens';

export type ThemeMode = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'soteria.theme.mode';

interface ThemeContextValue {
  /** The user's selection. */
  mode: ThemeMode;
  /** The resolved scheme actually in effect. */
  scheme: ColorScheme;
  palette: Palette;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const system = useColorScheme(); // 'light' | 'dark' | null
  const [mode, setModeState] = useState<ThemeMode>('system');

  // Load the persisted choice once on mount.
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (active && (v === 'system' || v === 'light' || v === 'dark')) setModeState(v);
      })
      .catch(() => {
        /* first run / unavailable storage — keep the default */
      });
    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
  }, []);

  const scheme: ColorScheme = mode === 'system' ? (system ?? 'dark') : mode;

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, scheme, palette: palettes[scheme], setMode }),
    [mode, scheme, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

/**
 * Build a StyleSheet from the active palette, rebuilt only when the palette
 * changes. `make` MUST be a stable (module-scope) function reference.
 */
export function useThemedStyles<T>(make: (palette: Palette) => T): T {
  const { palette } = useTheme();
  return useMemo(() => make(palette), [make, palette]);
}

/**
 * ProgressBar — thin animated completion bar. Defaults to the brand accent;
 * pass `color` (e.g. a tier color) to tint it. Track = the theme's line color.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { motion } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

export function ProgressBar({
  percent,
  color,
  height = 6,
}: {
  percent: number;
  color?: string;
  height?: number;
}): React.ReactElement {
  const { palette } = useTheme();
  const pct = Math.max(0, Math.min(100, percent));
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: pct, duration: motion.slow, useNativeDriver: false }).start();
  }, [pct, v]);
  const width = v.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] });
  return (
    <View style={{ height, borderRadius: 999, backgroundColor: palette.surfaces.line, overflow: 'hidden' }}>
      <Animated.View style={{ height: '100%', width, borderRadius: 999, backgroundColor: color ?? palette.brand.accent }} />
    </View>
  );
}

/**
 * ScoreRing — circular audit score. The arc color follows the CONSTANT OSHA
 * tier (NN #7); a muted track shows when there is no score yet. The ring is
 * always paired with a raw `score / effectiveMax` readout — it AUGMENTS, never
 * replaces, the denominator (NN #9). Arc animates on mount (reduce-motion gated).
 */
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Text } from 'react-native-paper';
import type { Tier } from '@soteria/scoring-engine';
import { tierColors, typography, motion } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function ScoreRing({
  percent,
  tier,
  size = 104,
  stroke = 9,
}: {
  percent: number | null;
  tier: Tier | null;
  size?: number;
  stroke?: number;
}): React.ReactElement {
  const { palette } = useTheme();
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = percent == null ? 0 : Math.max(0, Math.min(100, percent));
  const color = tier ? tierColors[tier] : palette.text.faint;

  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    const target = pct / 100;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduce) => {
        if (!active) return;
        if (reduce) progress.setValue(target);
        else Animated.timing(progress, { toValue: target, duration: motion.slow, useNativeDriver: false }).start();
      })
      .catch(() => progress.setValue(target));
    return () => {
      active = false;
    };
  }, [pct, progress]);

  const strokeDashoffset = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  const numSize = Math.round(size * 0.28);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={palette.surfaces.line} strokeWidth={stroke} />
        {percent != null ? (
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
          />
        ) : null}
      </Svg>
      <Text style={{ fontFamily: typography.mono, fontSize: numSize, lineHeight: numSize + 2, color: palette.text.primary }}>
        {percent == null ? '—' : Math.round(percent)}
        {percent != null ? (
          <Text style={{ fontFamily: typography.mono, fontSize: Math.round(size * 0.15), color: palette.text.dim }}>%</Text>
        ) : null}
      </Text>
    </View>
  );
}

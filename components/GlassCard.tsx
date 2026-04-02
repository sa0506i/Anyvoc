import React from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { useTheme } from '../hooks/useTheme';
import { borderRadius, marineShadow } from '../constants/theme';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  noHighlight?: boolean;
  noShadow?: boolean;
}

export function GlassCard({ children, style, noHighlight, noShadow }: GlassCardProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        {
          backgroundColor: colors.glass,
          borderWidth: 1,
          borderColor: colors.glassBorder,
          borderRadius: borderRadius.md,
          overflow: 'hidden',
        },
        !noShadow && marineShadow,
        style,
      ]}
    >
      {!noHighlight && <View style={styles.topHighlight} />}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  topHighlight: {
    height: 1,
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
});

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, Animated } from 'react-native';
import { useShareProcessingStore } from '../hooks/useShareProcessingStore';
import { useTheme } from '../hooks/useTheme';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../constants/theme';

const FADE_DURATION_MS = 120;

export default function GlobalLoadingOverlay() {
  const processing = useShareProcessingStore((s) => s.processing);
  const message = useShareProcessingStore((s) => s.message);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Cross-fade the text node whenever the message changes so rotating
  // progress updates don't snap in hard. We keep a locally-mirrored
  // `displayedMessage` and only swap it at the midpoint of the fade.
  const opacity = useRef(new Animated.Value(1)).current;
  const [displayedMessage, setDisplayedMessage] = useState(message);

  useEffect(() => {
    if (message === displayedMessage) return;
    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_DURATION_MS,
      useNativeDriver: true,
    }).start(() => {
      setDisplayedMessage(message);
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_DURATION_MS,
        useNativeDriver: true,
      }).start();
    });
  }, [message, displayedMessage, opacity]);

  if (!processing) return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <View style={styles.card}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Animated.Text style={[styles.text, { opacity }]}>{displayedMessage}</Animated.Text>
      </View>
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.overlay,
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 9999,
      elevation: 9999,
    },
    card: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.lg,
      padding: spacing.xl,
      alignItems: 'center',
      gap: spacing.md,
      marginHorizontal: spacing.xl,
      minWidth: 220,
    },
    text: {
      fontSize: fontSize.md,
      fontWeight: '300',
      color: c.text,
      textAlign: 'center',
    },
  });

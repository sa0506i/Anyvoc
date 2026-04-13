import { useMemo, useRef, useEffect } from 'react';
import { View, Text, Pressable, Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import {
  spacing,
  fontSize,
  borderRadius,
  marineShadow,
  type ThemeColors,
} from '../constants/theme';

interface FlashCardProps {
  front: string;
  back: string;
  isRevealed: boolean;
  onReveal: () => void;
  onCorrect: () => void;
  onIncorrect: () => void;
  onDelete?: () => void;
}

export default function FlashCard({
  front,
  back,
  isRevealed,
  onReveal,
  onCorrect,
  onIncorrect,
  onDelete,
}: FlashCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const flipAnim = useRef(new Animated.Value(0)).current;
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (isRevealed) {
      Animated.timing(flipAnim, {
        toValue: 1,
        duration: 400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }).start();
    } else {
      // Reset immediately for new card
      flipAnim.setValue(0);
    }
  }, [isRevealed]);

  const frontRotateY = flipAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['0deg', '90deg', '90deg'],
  });

  const backRotateY = flipAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: ['-90deg', '-90deg', '0deg'],
  });

  const frontOpacity = flipAnim.interpolate({
    inputRange: [0, 0.49, 0.5],
    outputRange: [1, 1, 0],
  });

  const backOpacity = flipAnim.interpolate({
    inputRange: [0, 0.5, 0.51],
    outputRange: [0, 0, 1],
  });

  return (
    <View style={styles.wrapper}>
      <Pressable testID="flashcard" onPress={!isRevealed ? onReveal : undefined}>
        <View style={styles.cardContainer}>
          {/* Front face */}
          <Animated.View
            style={[
              styles.card,
              {
                transform: [{ perspective: 1000 }, { rotateY: frontRotateY }],
                opacity: frontOpacity,
              },
            ]}
          >
            <View style={styles.cardHighlight} />
            <Text style={styles.label}>Question</Text>
            {onDelete && (
              <Pressable style={styles.deleteButton} onPress={onDelete} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
              </Pressable>
            )}
            <Text style={styles.cardText}>{front}</Text>
            <Text style={styles.tapHint}>Tap to reveal</Text>
          </Animated.View>

          {/* Back face */}
          <Animated.View
            style={[
              styles.card,
              styles.cardBack,
              {
                transform: [{ perspective: 1000 }, { rotateY: backRotateY }],
                opacity: backOpacity,
              },
            ]}
          >
            <View style={styles.cardHighlight} />
            <Text style={styles.label}>Answer</Text>
            {onDelete && (
              <Pressable style={styles.deleteButton} onPress={onDelete} hitSlop={8}>
                <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
              </Pressable>
            )}
            <Text style={styles.cardText}>{back}</Text>
          </Animated.View>
        </View>
      </Pressable>

      {isRevealed && (
        <View style={styles.buttonRow}>
          <Pressable
            testID="incorrect-btn"
            style={({ pressed }) => [
              styles.answerButton,
              styles.incorrectButton,
              pressed && styles.pressed,
            ]}
            onPress={onIncorrect}
          >
            <Ionicons name="close" size={24} color={colors.error} />
            <Text style={[styles.answerButtonText, styles.incorrectButtonText]}>Missed</Text>
          </Pressable>
          <Pressable
            testID="correct-btn"
            style={({ pressed }) => [
              styles.answerButton,
              styles.correctButton,
              pressed && styles.pressed,
            ]}
            onPress={onCorrect}
          >
            <Ionicons name="checkmark" size={24} color={colors.success} />
            <Text style={[styles.answerButtonText, styles.correctButtonText]}>Got it</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrapper: {
      gap: spacing.lg,
    },
    cardContainer: {
      minHeight: 200,
    },
    card: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      ...marineShadow,
      overflow: 'hidden',
      borderRadius: borderRadius.md,
      padding: spacing.xl,
      minHeight: 200,
      justifyContent: 'center',
      alignItems: 'center',
      backfaceVisibility: 'hidden',
    },
    cardBack: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    cardHighlight: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 1,
      backgroundColor: c.subtleOverlay,
      zIndex: 1,
    },
    deleteButton: {
      position: 'absolute',
      top: spacing.md,
      right: spacing.md,
      zIndex: 2,
    },
    label: {
      position: 'absolute',
      top: spacing.md,
      left: spacing.md,
      fontSize: fontSize.xs,
      color: c.textSecondary,
      textTransform: 'uppercase',
      fontWeight: '300',
      letterSpacing: 1.5,
    },
    cardText: {
      fontSize: fontSize.xxl,
      fontWeight: '600',
      color: c.text,
      textAlign: 'center',
    },
    tapHint: {
      position: 'absolute',
      bottom: spacing.md,
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontWeight: '300',
    },
    buttonRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    answerButton: {
      flex: 1,
      flexDirection: 'row',
      justifyContent: 'center',
      alignItems: 'center',
      padding: spacing.md,
      gap: spacing.sm,
    },
    correctButton: {
      backgroundColor: c.successBgLight,
      borderWidth: 1,
      borderColor: c.successBgMedium,
      borderRadius: borderRadius.full,
    },
    incorrectButton: {
      backgroundColor: c.errorBgLight,
      borderWidth: 1,
      borderColor: c.errorBgMedium,
      borderRadius: borderRadius.full,
    },
    answerButtonText: {
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    correctButtonText: {
      color: c.success,
    },
    incorrectButtonText: {
      color: c.error,
    },
    pressed: {
      transform: [{ scale: 0.97 }],
      opacity: 0.85,
    },
  });

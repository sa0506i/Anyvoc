import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { spacing, fontSize, borderRadius, marineShadow, type ThemeColors } from '../constants/theme';

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

  return (
    <View style={styles.wrapper}>
      <Pressable testID="flashcard" style={styles.card} onPress={!isRevealed ? onReveal : undefined}>
        <View style={styles.cardHighlight} />
        <Text style={styles.label}>{isRevealed ? 'Answer' : 'Question'}</Text>
        {onDelete && (
          <Pressable style={styles.deleteButton} onPress={onDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
          </Pressable>
        )}
        <Text style={styles.cardText}>{isRevealed ? back : front}</Text>
        {!isRevealed && (
          <Text style={styles.tapHint}>Tap to reveal</Text>
        )}
      </Pressable>

      {isRevealed && (
        <View style={styles.buttonRow}>
          <Pressable testID="incorrect-btn" style={[styles.answerButton, styles.incorrectButton]} onPress={onIncorrect}>
            <Ionicons name="close" size={24} color={colors.error} />
            <Text style={[styles.answerButtonText, styles.incorrectButtonText]}>Missed</Text>
          </Pressable>
          <Pressable testID="correct-btn" style={[styles.answerButton, styles.correctButton]} onPress={onCorrect}>
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
  });

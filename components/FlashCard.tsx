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
}

export default function FlashCard({
  front,
  back,
  isRevealed,
  onReveal,
  onCorrect,
  onIncorrect,
}: FlashCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.wrapper}>
      <Pressable style={styles.card} onPress={!isRevealed ? onReveal : undefined}>
        <View style={styles.cardHighlight} />
        <Text style={styles.label}>{isRevealed ? 'Antwort' : 'Frage'}</Text>
        <Text style={styles.cardText}>{isRevealed ? back : front}</Text>
        {!isRevealed && (
          <Text style={styles.tapHint}>Tippen zum Aufdecken</Text>
        )}
      </Pressable>

      {isRevealed && (
        <View style={styles.buttonRow}>
          <Pressable style={[styles.answerButton, styles.incorrectButton]} onPress={onIncorrect}>
            <Ionicons name="close" size={24} color={colors.error} />
            <Text style={[styles.answerButtonText, styles.incorrectButtonText]}>Nicht gewusst</Text>
          </Pressable>
          <Pressable style={[styles.answerButton, styles.correctButton]} onPress={onCorrect}>
            <Ionicons name="checkmark" size={24} color={colors.success} />
            <Text style={[styles.answerButtonText, styles.correctButtonText]}>Gewusst</Text>
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
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
      zIndex: 1,
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
      backgroundColor: 'rgba(77, 255, 181, 0.2)',
      borderWidth: 1,
      borderColor: 'rgba(77, 255, 181, 0.4)',
      borderRadius: borderRadius.full,
    },
    incorrectButton: {
      backgroundColor: 'rgba(255, 77, 106, 0.2)',
      borderWidth: 1,
      borderColor: 'rgba(255, 77, 106, 0.4)',
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

import { useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import { matchAnswer } from '../lib/matchAnswer';
import type { MatchResult } from '../lib/matchAnswer';
import {
  spacing,
  fontSize,
  borderRadius,
  marineShadow,
  type ThemeColors,
} from '../constants/theme';

interface TypingCardProps {
  question: string;
  expectedAnswer: string;
  wordType?: string;
  level?: string;
  onCorrect: () => void;
  onIncorrect: () => void;
  onDelete?: () => void;
}

export default function TypingCard({
  question,
  expectedAnswer,
  wordType,
  level,
  onCorrect,
  onIncorrect,
  onDelete,
}: TypingCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);

  const [input, setInput] = useState('');
  const [result, setResult] = useState<MatchResult | null>(null);

  const isCorrect = result !== null && result.match !== 'none';
  const isTolerant = result !== null && result.match === 'tolerant';

  const handleCheck = () => {
    if (!input.trim()) return;
    const r = matchAnswer(input, expectedAnswer);
    setResult(r);
  };

  const handleGiveUp = () => {
    setResult({ match: 'none', expected: expectedAnswer });
  };

  const handleNext = () => {
    if (isCorrect) {
      onCorrect();
    } else {
      onIncorrect();
    }
    setInput('');
    setResult(null);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 120 : 0}
      style={styles.wrapper}
    >
      <View testID="typing-card" style={styles.card}>
        <View style={styles.cardHighlight} />

        {onDelete && (
          <Pressable style={styles.deleteButton} onPress={onDelete} hitSlop={8}>
            <Ionicons name="trash-outline" size={18} color={colors.textSecondary} />
          </Pressable>
        )}

        <Text style={styles.label}>Question</Text>
        <Text style={styles.questionText}>{question}</Text>

        {(wordType || level) && (
          <Text style={styles.subtitle}>
            {wordType ? wordType.charAt(0).toUpperCase() + wordType.slice(1) : ''}
            {wordType && level ? ' · ' : ''}
            {level ?? ''}
          </Text>
        )}

        <TextInput
          testID="typing-input"
          ref={inputRef}
          style={[styles.input, result !== null && styles.inputDisabled]}
          placeholder="Type your answer…"
          placeholderTextColor={colors.textSecondary}
          value={input}
          onChangeText={setInput}
          editable={result === null}
          onSubmitEditing={result === null ? handleCheck : undefined}
          returnKeyType="done"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {result !== null && (
          <View
            testID="feedback-box"
            style={[styles.feedbackBox, isCorrect ? styles.feedbackCorrect : styles.feedbackWrong]}
          >
            <Text style={[styles.feedbackTitle, isCorrect ? styles.textCorrect : styles.textWrong]}>
              {isCorrect ? '✓ Correct!' : '✗ Wrong'}
            </Text>
            {(isTolerant || !isCorrect) && (
              <Text style={styles.feedbackHint}>
                {isCorrect ? 'Complete form: ' : ''}
                {result.expected}
              </Text>
            )}
          </View>
        )}

        {result === null ? (
          <View style={styles.buttonRow}>
            <Pressable
              testID="give-up-btn"
              style={({ pressed }) => [styles.giveUpButton, pressed && styles.pressed]}
              onPress={handleGiveUp}
            >
              <Text style={styles.giveUpText}>Reveal</Text>
            </Pressable>
            <Pressable
              testID="check-btn"
              style={({ pressed }) => [
                styles.checkButton,
                !input.trim() && styles.checkButtonDisabled,
                pressed && styles.pressed,
              ]}
              onPress={handleCheck}
              disabled={!input.trim()}
            >
              <Text style={[styles.checkText, !input.trim() && styles.checkTextDisabled]}>
                Check
              </Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            testID="next-btn"
            style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}
            onPress={handleNext}
          >
            <Text style={styles.nextText}>Next →</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
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
      gap: spacing.md,
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
      fontSize: fontSize.xs,
      color: c.textSecondary,
      textTransform: 'uppercase',
      fontWeight: '300',
      letterSpacing: 1.5,
    },
    questionText: {
      fontSize: fontSize.xxl,
      fontWeight: '600',
      color: c.text,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontWeight: '300',
    },
    input: {
      width: '100%',
      padding: spacing.md,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
      borderColor: c.glassBorder,
      backgroundColor: c.background,
      color: c.text,
      fontSize: fontSize.md,
    },
    inputDisabled: {
      opacity: 0.6,
    },
    feedbackBox: {
      width: '100%',
      padding: spacing.md,
      borderRadius: borderRadius.sm,
      borderWidth: 1,
    },
    feedbackCorrect: {
      backgroundColor: c.successBgLight,
      borderColor: c.successBgMedium,
    },
    feedbackWrong: {
      backgroundColor: c.errorBgLight,
      borderColor: c.errorBgMedium,
    },
    feedbackTitle: {
      fontWeight: '600',
      fontSize: fontSize.sm,
    },
    textCorrect: {
      color: c.success,
    },
    textWrong: {
      color: c.error,
    },
    feedbackHint: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginTop: spacing.xs,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: spacing.md,
      width: '100%',
    },
    checkButton: {
      flex: 2,
      backgroundColor: c.primary,
      borderRadius: borderRadius.full,
      padding: spacing.md,
      alignItems: 'center',
    },
    checkButtonDisabled: {
      opacity: 0.4,
    },
    checkText: {
      color: '#FFFFFF',
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    checkTextDisabled: {
      color: '#FFFFFF',
    },
    giveUpButton: {
      flex: 1,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.full,
      padding: spacing.md,
      alignItems: 'center',
    },
    giveUpText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: '300',
    },
    nextButton: {
      width: '100%',
      backgroundColor: c.primary,
      borderRadius: borderRadius.full,
      padding: spacing.md,
      alignItems: 'center',
    },
    nextText: {
      color: '#FFFFFF',
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    pressed: {
      transform: [{ scale: 0.97 }],
      opacity: 0.85,
    },
  });

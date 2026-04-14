import { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Switch,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  useSettingsStore,
  useSettingsActions,
  QuizDirection,
  QuizMode,
} from '../hooks/useSettings';
import { useTheme } from '../hooks/useTheme';
import { languages, getLanguageName, getLanguageFlag } from '../constants/languages';
import { CEFR_LEVELS_UI, displayLevel, uiToInternalLevel } from '../constants/levels';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, fontSize, borderRadius, marineShadow } from '../constants/theme';
import ConfirmDialog from '../components/ConfirmDialog';

export default function SettingsScreen() {
  const router = useRouter();
  const nativeLanguage = useSettingsStore((s) => s.nativeLanguage);
  const learningLanguage = useSettingsStore((s) => s.learningLanguage);
  const level = useSettingsStore((s) => s.level);
  const quizDirection = useSettingsStore((s) => s.quizDirection);
  const quizMode = useSettingsStore((s) => s.quizMode);
  const cardsPerRound = useSettingsStore((s) => s.cardsPerRound);
  const proMode = useSettingsStore((s) => s.proMode);
  const { updateSetting, resetApp } = useSettingsActions();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const nativeFlag = getLanguageFlag(nativeLanguage);
  const learningFlag = getLanguageFlag(learningLanguage);

  const Header = () => (
    <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
      <View style={styles.headerSide} />
      <Text style={styles.headerTitle}>Settings</Text>
      <View style={styles.headerSide}>
        <Pressable
          testID="settings-close-btn"
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.closeButton}
        >
          <Ionicons name="close" size={20} color={colors.text} style={styles.closeIcon} />
        </Pressable>
      </View>
    </View>
  );

  const [showLanguagePicker, setShowLanguagePicker] = useState<'native' | 'learning' | null>(null);
  const [showResetDialog, setShowResetDialog] = useState(false);

  const quizModeOptions: { value: QuizMode; label: string }[] = [
    { value: 'flashcard', label: 'Flashcard' },
    { value: 'typing', label: 'Typing' },
  ];

  const quizDirectionOptions: { value: QuizDirection; parts: [string, string, string] }[] = [
    { value: 'native-to-learning', parts: [nativeFlag, '→', learningFlag] },
    { value: 'learning-to-native', parts: [learningFlag, '→', nativeFlag] },
    { value: 'random', parts: [nativeFlag, '⇄', learningFlag] },
  ];

  const handleReset = () => {
    setShowResetDialog(true);
  };

  const confirmReset = async () => {
    setShowResetDialog(false);
    await resetApp();
    router.back();
  };

  if (showLanguagePicker) {
    const isNative = showLanguagePicker === 'native';
    return (
      <View style={styles.container}>
        <Header />
        <Pressable style={styles.pickerBack} onPress={() => setShowLanguagePicker(null)}>
          <Text style={styles.pickerBackText}>← Back</Text>
        </Pressable>
        <Text style={styles.sectionTitle}>
          {isNative ? 'Select Native Language' : 'Select Learning Language'}
        </Text>
        <ScrollView>
          {languages
            .filter((lang) => isNative || lang.code !== nativeLanguage)
            .map((lang) => {
              const selected = isNative
                ? lang.code === nativeLanguage
                : lang.code === learningLanguage;
              return (
                <Pressable
                  key={lang.code}
                  style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                  onPress={() => {
                    if (isNative && lang.code === learningLanguage) {
                      // Swap: learning language takes the old native language
                      updateSetting('learningLanguage', nativeLanguage);
                    }
                    updateSetting(isNative ? 'nativeLanguage' : 'learningLanguage', lang.code);
                    setShowLanguagePicker(null);
                  }}
                >
                  <Text style={[styles.pickerItemText, selected && styles.pickerItemTextSelected]}>
                    {lang.nativeName}
                  </Text>
                  <Text style={styles.pickerItemSubtext}>{lang.name}</Text>
                </Pressable>
              );
            })}
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      <Header />
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Mode */}
        <Text style={styles.sectionTitle}>Mode</Text>
        <Text style={styles.sectionHint}>
          Basic limits content to 1000 characters, 3 additions per day, and no full-text
          translation. Pro removes all limits.
        </Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Pro Mode</Text>
          <Switch
            testID="pro-mode-switch"
            value={proMode}
            onValueChange={(on) => updateSetting('proMode', on ? 'true' : 'false')}
            trackColor={{ false: colors.subtleOverlay, true: colors.primary }}
            thumbColor={'#FFFFFF'}
          />
        </View>

        {/* Languages */}
        <Text style={styles.sectionTitle}>Languages</Text>

        <Pressable
          testID="native-language-btn"
          style={styles.row}
          onPress={() => setShowLanguagePicker('native')}
        >
          <Text style={styles.rowLabel}>Native Language</Text>
          <Text style={styles.rowValue}>{getLanguageName(nativeLanguage)} →</Text>
        </Pressable>

        <Pressable
          testID="learning-language-btn"
          style={styles.row}
          onPress={() => setShowLanguagePicker('learning')}
        >
          <Text style={styles.rowLabel}>Learning Language</Text>
          <Text style={styles.rowValue}>{getLanguageName(learningLanguage)} →</Text>
        </Pressable>

        {/* Level */}
        <Text style={styles.sectionTitle}>Language Level</Text>
        <Text style={styles.sectionHint}>Vocabulary below this level will be ignored</Text>
        <View style={styles.levelRow}>
          {CEFR_LEVELS_UI.map((ui) => {
            const active = displayLevel(level) === ui;
            return (
              <Pressable
                key={ui}
                style={({ pressed }) => [
                  styles.levelChip,
                  active && styles.levelChipActive,
                  pressed && styles.pressed,
                ]}
                onPress={() => updateSetting('level', uiToInternalLevel(ui))}
              >
                <Text style={[styles.levelChipText, active && styles.levelChipTextActive]}>
                  {ui}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Quiz Mode */}
        <Text style={styles.sectionTitle}>Quiz Mode</Text>
        <View style={styles.chipRow}>
          {quizModeOptions.map((opt) => (
            <Pressable
              key={opt.value}
              testID={`quiz-mode-${opt.value}`}
              style={({ pressed }) => [
                styles.levelChip,
                quizMode === opt.value && styles.levelChipActive,
                pressed && styles.pressed,
              ]}
              onPress={() => updateSetting('quizMode', opt.value)}
            >
              <Text
                style={[styles.levelChipText, quizMode === opt.value && styles.levelChipTextActive]}
              >
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Quiz Direction */}
        <Text style={styles.sectionTitle}>Quiz Direction</Text>
        <Text style={styles.sectionHint}>Which language is shown as the question</Text>
        <View style={styles.directionRow}>
          {quizDirectionOptions.map((opt) => (
            <Pressable
              key={opt.value}
              style={({ pressed }) => [
                styles.directionChip,
                quizDirection === opt.value && styles.levelChipActive,
                pressed && styles.pressed,
              ]}
              onPress={() => updateSetting('quizDirection', opt.value)}
            >
              <View style={styles.directionContent}>
                <Text style={styles.directionEmoji}>{opt.parts[0]}</Text>
                <Text style={styles.directionArrow}>{opt.parts[1]}</Text>
                <Text style={styles.directionEmoji}>{opt.parts[2]}</Text>
              </View>
            </Pressable>
          ))}
        </View>

        {/* Cards Per Round */}
        <Text style={styles.sectionTitle}>Cards Per Round</Text>
        <Text style={styles.sectionHint}>Number of cards in each training session</Text>
        <View style={styles.chipRow}>
          {[5, 10, 15, 20, 25, 30].map((n) => (
            <Pressable
              key={n}
              style={({ pressed }) => [
                styles.levelChip,
                cardsPerRound === String(n) && styles.levelChipActive,
                pressed && styles.pressed,
              ]}
              onPress={() => updateSetting('cardsPerRound', String(n))}
            >
              <Text
                style={[
                  styles.levelChipText,
                  cardsPerRound === String(n) && styles.levelChipTextActive,
                ]}
              >
                {n}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Reset App */}
        <Text style={styles.sectionTitle}>Reset App</Text>
        <Text style={styles.sectionHint}>
          Delete all vocabulary and go back to initial settings
        </Text>
        <Pressable testID="reset-app-btn" style={styles.resetButton} onPress={handleReset}>
          <Ionicons name="trash-outline" size={16} color={colors.error} />
          <Text style={styles.resetText}>Reset</Text>
        </Pressable>
      </ScrollView>

      <ConfirmDialog
        visible={showResetDialog}
        title="Reset App"
        message="All vocabulary, content, statistics, and Leitner progress will be deleted. This action cannot be undone."
        cancelLabel="Cancel"
        confirmLabel="Reset"
        destructive
        onCancel={() => setShowResetDialog(false)}
        onConfirm={confirmReset}
      />
    </KeyboardAvoidingView>
  );
}

function createStyles(c: typeof import('../constants/theme').darkColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      backgroundColor: c.backgroundMid,
    },
    headerSide: {
      width: 40,
      alignItems: 'flex-end',
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: c.text,
    },
    closeButton: {
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: c.subtleOverlay,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeIcon: {
      lineHeight: 20,
      textAlign: 'center',
      textAlignVertical: 'center',
      includeFontPadding: false,
      width: 20,
      height: 20,
    },
    content: {
      padding: spacing.md,
      paddingBottom: spacing.xxl,
    },
    sectionTitle: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
    sectionHint: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      marginBottom: spacing.sm,
      fontWeight: '300',
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      padding: spacing.md,
      borderRadius: borderRadius.md,
      marginTop: spacing.sm,
    },
    rowLabel: {
      fontSize: fontSize.md,
      color: c.text,
      fontWeight: '300',
    },
    rowValue: {
      fontSize: fontSize.md,
      color: c.primary,
      fontWeight: '300',
    },
    levelRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    chipRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    directionRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    directionChip: {
      flex: 1,
      paddingVertical: spacing.sm + 2,
      borderRadius: borderRadius.full,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    directionContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    directionEmoji: {
      fontSize: 18,
    },
    directionArrow: {
      fontSize: 16,
      fontWeight: '900',
      color: '#FFFFFF',
    },
    levelChip: {
      flex: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.full,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      alignItems: 'center',
    },
    levelChipActive: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
    levelChipText: {
      fontSize: fontSize.sm,
      color: c.text,
      fontWeight: '300',
    },
    levelChipTextActive: {
      color: '#FFFFFF',
      fontWeight: '600',
    },
    resetButton: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: spacing.xs,
      backgroundColor: c.errorBgLight,
      borderWidth: 1,
      borderColor: c.errorBgMedium,
      borderRadius: borderRadius.full,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.lg,
    },
    resetText: {
      color: c.error,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    pickerBack: {
      padding: spacing.md,
    },
    pickerBackText: {
      fontSize: fontSize.md,
      color: c.primary,
      fontWeight: '600',
    },
    pickerItem: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.glassBorder,
    },
    pickerItemSelected: {
      backgroundColor: c.primaryLight,
    },
    pickerItemText: {
      fontSize: fontSize.md,
      color: c.text,
      fontWeight: '300',
    },
    pickerItemTextSelected: {
      fontWeight: '600',
      color: c.primary,
    },
    pickerItemSubtext: {
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '300',
    },
    pressed: {
      transform: [{ scale: 0.97 }],
      opacity: 0.85,
    },
  });
}

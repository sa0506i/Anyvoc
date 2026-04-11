import { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSettings, QuizDirection } from '../hooks/useSettings';
import { useTheme } from '../hooks/useTheme';
import { languages, getLanguageName } from '../constants/languages';
import { CEFR_LEVELS_UI, displayLevel, uiToInternalLevel } from '../constants/levels';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, fontSize, borderRadius, marineShadow } from '../constants/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const {
    nativeLanguage,
    learningLanguage,
    level,
    quizDirection,
    cardsPerRound,
    updateSetting,
    resetApp,
  } = useSettings();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const Header = () => (
    <View style={[styles.header, { paddingTop: insets.top / 2 + spacing.xs }]}>
      <View style={styles.headerSide} />
      <Text style={styles.headerTitle}>Settings</Text>
      <View style={styles.headerSide}>
        <Pressable testID="settings-close-btn" onPress={() => router.back()} hitSlop={8} style={styles.closeButton}>
          <Ionicons
            name="close"
            size={20}
            color={colors.text}
            style={styles.closeIcon}
          />
        </Pressable>
      </View>
    </View>
  );

  const [showLanguagePicker, setShowLanguagePicker] = useState<'native' | 'learning' | null>(null);

  const quizDirectionOptions: { value: QuizDirection; label: string }[] = [
    { value: 'native-to-learning', label: 'Native → Learning' },
    { value: 'learning-to-native', label: 'Learning → Native' },
    { value: 'random', label: 'Random' },
  ];

  const handleReset = () => {
    Alert.alert(
      'Reset App',
      'All vocabulary, content, statistics, and Leitner progress will be deleted. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            await resetApp();
            router.back();
          },
        },
      ]
    );
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
          {languages.map((lang) => {
            const selected = isNative
              ? lang.code === nativeLanguage
              : lang.code === learningLanguage;
            return (
              <Pressable
                key={lang.code}
                style={[styles.pickerItem, selected && styles.pickerItemSelected]}
                onPress={() => {
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
      {/* Languages */}
      <Text style={styles.sectionTitle}>Languages</Text>

      <Pressable testID="native-language-btn" style={styles.row} onPress={() => setShowLanguagePicker('native')}>
        <Text style={styles.rowLabel}>Native Language</Text>
        <Text style={styles.rowValue}>{getLanguageName(nativeLanguage)} →</Text>
      </Pressable>

      <Pressable testID="learning-language-btn" style={styles.row} onPress={() => setShowLanguagePicker('learning')}>
        <Text style={styles.rowLabel}>Learning Language</Text>
        <Text style={styles.rowValue}>{getLanguageName(learningLanguage)} →</Text>
      </Pressable>

      {/* Level */}
      <Text style={styles.sectionTitle}>Language Level</Text>
      <Text style={styles.sectionHint}>
        Vocabulary below this level will be ignored
      </Text>
      <View style={styles.levelRow}>
        {CEFR_LEVELS_UI.map((ui) => {
          const active = displayLevel(level) === ui;
          return (
            <Pressable
              key={ui}
              style={[styles.levelChip, styles.cefrChip, active && styles.levelChipActive]}
              onPress={() => updateSetting('level', uiToInternalLevel(ui))}
            >
              <Text style={[styles.levelChipText, active && styles.levelChipTextActive]}>
                {ui}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Quiz Direction */}
      <Text style={styles.sectionTitle}>Quiz Direction</Text>
      <View style={styles.chipRow}>
        {quizDirectionOptions.map((opt) => (
          <Pressable
            key={opt.value}
            style={[styles.levelChip, quizDirection === opt.value && styles.levelChipActive]}
            onPress={() => updateSetting('quizDirection', opt.value)}
          >
            <Text style={[styles.levelChipText, quizDirection === opt.value && styles.levelChipTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Cards Per Round */}
      <Text style={styles.sectionTitle}>Cards Per Round</Text>
      <Text style={styles.sectionHint}>
        Number of cards in each training session
      </Text>
      <View style={styles.chipRow}>
        {[5, 10, 15, 20, 25, 30].map((n) => (
          <Pressable
            key={n}
            style={[styles.levelChip, cardsPerRound === String(n) && styles.levelChipActive]}
            onPress={() => updateSetting('cardsPerRound', String(n))}
          >
            <Text style={[styles.levelChipText, cardsPerRound === String(n) && styles.levelChipTextActive]}>
              {n}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Reset */}
      <View style={styles.resetSection}>
        <Pressable testID="reset-app-btn" style={styles.resetButton} onPress={handleReset}>
          <Ionicons name="trash-outline" size={16} color={colors.error} />
          <Text style={styles.resetText}>Reset App</Text>
        </Pressable>
      </View>
    </ScrollView>
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
      backgroundColor: 'rgba(255, 255, 255, 0.08)',
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
    levelChip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: borderRadius.full,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
    },
    cefrChip: {
      minWidth: 52,
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
    radioRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      padding: spacing.md,
      borderRadius: borderRadius.md,
      marginTop: spacing.sm,
      gap: spacing.sm,
    },
    radioRowSelected: {
      borderColor: c.primary,
      borderWidth: 1,
    },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: c.glassBorder,
      justifyContent: 'center',
      alignItems: 'center',
    },
    radioSelected: {
      borderColor: c.primary,
    },
    radioDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: c.primary,
    },
    radioLabel: {
      fontSize: fontSize.md,
      color: c.text,
      fontWeight: '300',
    },
    resetSection: {
      marginTop: spacing.xxl,
    },
    resetButton: {
      flexDirection: 'row',
      alignSelf: 'center',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: 'rgba(255, 77, 106, 0.2)',
      borderWidth: 1,
      borderColor: 'rgba(255, 77, 106, 0.4)',
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
  });
}

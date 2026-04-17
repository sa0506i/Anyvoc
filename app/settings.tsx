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
import { useAuthStore } from '../lib/authStore';
import { signOut as supabaseSignOut, deleteAccount, AuthError } from '../lib/auth';
import { useTheme } from '../hooks/useTheme';
import { languages, getLanguageName, getLanguageFlag } from '../constants/languages';
import { CEFR_LEVELS_UI, displayLevel, uiToInternalLevel } from '../constants/levels';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spacing, fontSize, borderRadius, marineShadow } from '../constants/theme';
import { useAlert } from '../components/ConfirmDialog';

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
  const authUser = useAuthStore((s) => s.user);
  const isAuthed = useAuthStore((s) => s.isAuthed);
  const clearAuth = useAuthStore((s) => s.clear);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { confirm, AlertDialog } = useAlert();

  const nativeFlag = getLanguageFlag(nativeLanguage);
  const learningFlag = getLanguageFlag(learningLanguage);

  const [showLanguagePicker, setShowLanguagePicker] = useState<'native' | 'learning' | null>(null);

  const handleBack = () => {
    if (showLanguagePicker) {
      setShowLanguagePicker(null);
      return;
    }
    router.back();
  };

  const Header = () => (
    <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
      <View style={styles.headerSideLeft}>
        <Pressable testID="settings-close-btn" onPress={handleBack} hitSlop={8}>
          <Text style={styles.backText}>{'\u2190 Back'}</Text>
        </Pressable>
      </View>
      <Text style={styles.headerTitle}>Settings</Text>
      <View style={styles.headerSide} />
    </View>
  );

  const quizModeOptions: { value: QuizMode; label: string }[] = [
    { value: 'flashcard', label: 'Flashcard' },
    { value: 'typing', label: 'Typing' },
  ];

  const quizDirectionOptions: { value: QuizDirection; parts: [string, string, string] }[] = [
    { value: 'native-to-learning', parts: [nativeFlag, '→', learningFlag] },
    { value: 'learning-to-native', parts: [learningFlag, '→', nativeFlag] },
    { value: 'random', parts: [nativeFlag, '⇄', learningFlag] },
  ];

  const handleSignIn = () => {
    // `from: 'settings'` tells navigateAfterSignIn to pop the auth
    // screens after success, leaving this Settings modal visible so
    // the user resumes exactly where they left off.
    router.push({ pathname: '/auth/login', params: { from: 'settings' } });
  };

  const handleReset = () => {
    confirm(
      'Reset App',
      'All vocabulary, content, statistics, and Leitner progress will be deleted. This action cannot be undone.',
      async () => {
        await resetApp();
        router.back();
      },
      { destructive: true, confirmLabel: 'Reset' },
    );
  };

  const handleSignOut = () => {
    confirm(
      'Log off',
      'All vocabulary, content, statistics, and Leitner progress will be deleted. You will be signed out. This action cannot be undone.',
      async () => {
        try {
          await supabaseSignOut();
        } catch (err) {
          console.warn('signOut failed', err);
        }
        clearAuth();
        await resetApp();
        router.back();
      },
      { destructive: true, confirmLabel: 'Log off' },
    );
  };

  const handleDeleteAccount = () => {
    confirm(
      'Delete account',
      'Your account will be permanently deleted. All vocabulary, content, statistics, and Leitner progress on this device will also be deleted. This action cannot be undone.',
      async () => {
        try {
          await deleteAccount();
          clearAuth();
          await resetApp();
          router.back();
        } catch (err) {
          console.warn('deleteAccount failed', err);
          const message =
            err instanceof AuthError && err.message
              ? err.message
              : 'Could not delete the account. Please try again later.';
          confirm('Delete failed', message, () => {}, { confirmLabel: 'OK' });
        }
      },
      { destructive: true, confirmLabel: 'Delete' },
    );
  };

  if (showLanguagePicker) {
    const isNative = showLanguagePicker === 'native';
    return (
      <View style={styles.container}>
        <Header />
        <Text style={[styles.sectionTitle, styles.pickerTitle]}>
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
        {/* ── User Settings ── */}
        <Text style={styles.sectionHeader}>User Settings</Text>

        {/* Account */}
        {isAuthed ? (
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Signed in as</Text>
            <Text
              testID="settings-account-email"
              style={styles.rowValue}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {authUser?.email ?? ''}
            </Text>
          </View>
        ) : (
          <Pressable
            testID="settings-sign-in-btn"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={handleSignIn}
          >
            <Text style={styles.rowLabel}>Sign in</Text>
            <Text style={styles.rowValue}>Sign in →</Text>
          </Pressable>
        )}

        {/* Pro Mode */}
        <View style={[styles.row, !isAuthed && styles.disabledRow]}>
          <Text style={styles.rowLabel}>Pro Mode</Text>
          <Switch
            testID="pro-mode-switch"
            value={proMode}
            disabled={!isAuthed}
            onValueChange={(on) => updateSetting('proMode', on ? 'true' : 'false')}
            trackColor={{ false: colors.subtleOverlay, true: colors.primary }}
            thumbColor={'#FFFFFF'}
          />
        </View>
        <Text style={styles.sectionHint}>
          {isAuthed
            ? 'Basic limits content to 2000 characters, 3 additions per day, and no full-text translation. Pro removes all limits.'
            : 'Sign in to unlock Pro Mode.'}
        </Text>

        {/* Languages — side by side */}
        <Text style={styles.sectionTitle}>Languages</Text>
        <View style={styles.languageRow}>
          <Pressable
            testID="native-language-btn"
            style={({ pressed }) => [styles.languageCard, pressed && styles.pressed]}
            onPress={() => setShowLanguagePicker('native')}
          >
            <Text style={styles.languageLabel}>Native</Text>
            <Text style={styles.languageFlag}>{nativeFlag}</Text>
          </Pressable>
          <Pressable
            testID="learning-language-btn"
            style={({ pressed }) => [styles.languageCard, pressed && styles.pressed]}
            onPress={() => setShowLanguagePicker('learning')}
          >
            <Text style={styles.languageLabel}>Learning</Text>
            <Text style={styles.languageFlag}>{learningFlag}</Text>
          </Pressable>
        </View>

        {/* Language Level */}
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

        {/* ── Support ── */}
        <Text style={styles.sectionHeader}>Support</Text>
        <View style={[styles.row, styles.disabledRow]}>
          <Text style={styles.disabledLabel}>Feedback</Text>
          <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
        </View>
        <View style={[styles.row, styles.disabledRow]}>
          <Text style={styles.disabledLabel}>FAQ</Text>
          <Ionicons name="help-circle-outline" size={18} color={colors.textSecondary} />
        </View>

        {/* ── Legal ── */}
        <Text style={styles.sectionHeader}>Legal</Text>
        <View style={[styles.row, styles.disabledRow]}>
          <Text style={styles.disabledLabel}>Terms of Use</Text>
          <Ionicons name="document-text-outline" size={18} color={colors.textSecondary} />
        </View>
        <View style={[styles.row, styles.disabledRow]}>
          <Text style={styles.disabledLabel}>Data Privacy</Text>
          <Ionicons name="shield-outline" size={18} color={colors.textSecondary} />
        </View>
        <View style={[styles.row, styles.disabledRow]}>
          <Text style={styles.disabledLabel}>Impressum</Text>
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
        </View>
        {/* ── Bottom actions ── */}
        {isAuthed ? (
          <View style={styles.bottomActions}>
            <Pressable
              testID="settings-delete-account-btn"
              style={styles.bottomActionBtn}
              onPress={handleDeleteAccount}
            >
              <Ionicons name="trash-outline" size={16} color={colors.error} />
              <Text style={styles.resetText}>Delete Account</Text>
            </Pressable>
            <Pressable
              testID="settings-sign-out-btn"
              style={styles.bottomActionBtn}
              onPress={handleSignOut}
            >
              <Ionicons name="log-out-outline" size={16} color={colors.error} />
              <Text style={styles.resetText}>Log Off</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.bottomActions}>
            <Pressable testID="reset-app-btn" style={styles.bottomActionBtn} onPress={handleReset}>
              <Ionicons name="trash-outline" size={16} color={colors.error} />
              <Text style={styles.resetText}>Reset App</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <AlertDialog />
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
    headerSideLeft: {
      width: 80,
      alignItems: 'flex-start',
    },
    headerSide: {
      width: 80,
      alignItems: 'flex-end',
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: c.text,
    },
    backText: {
      fontSize: fontSize.md,
      color: c.primary,
      fontWeight: '600',
    },
    content: {
      padding: spacing.md,
      paddingBottom: spacing.xxl,
    },
    sectionHeader: {
      fontSize: fontSize.xs,
      fontWeight: '600',
      color: c.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginTop: spacing.xl,
      marginBottom: spacing.xs,
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
      height: 44,
      paddingHorizontal: spacing.md,
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
      height: 44,
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
      height: 44,
      paddingHorizontal: spacing.md,
      borderRadius: borderRadius.full,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      alignItems: 'center',
      justifyContent: 'center',
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
    languageRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    languageCard: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      height: 56,
      borderRadius: borderRadius.md,
      gap: spacing.sm,
    },
    languageFlag: {
      fontSize: 28,
    },
    languageLabel: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontWeight: '300',
    },
    disabledRow: {
      opacity: 0.4,
    },
    disabledLabel: {
      fontSize: fontSize.md,
      color: c.textSecondary,
      fontWeight: '300',
    },
    bottomActions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.xl,
    },
    bottomActionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      backgroundColor: c.errorBgLight,
      borderWidth: 1,
      borderColor: c.errorBgMedium,
      borderRadius: borderRadius.full,
      height: 44,
      paddingHorizontal: spacing.lg,
    },
    resetText: {
      color: c.error,
      fontSize: fontSize.sm,
      fontWeight: '600',
    },
    pickerTitle: {
      paddingHorizontal: spacing.md,
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

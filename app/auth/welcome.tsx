/**
 * Welcome screen — shown on first launch before the user has either
 * signed in or chosen to continue as guest. Existing users are skipped
 * past this via the grandfathering migration in lib/database.ts.
 */

import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { setSetting } from '../../lib/database';
import { useTheme } from '../../hooks/useTheme';
import {
  spacing,
  fontSize,
  borderRadius,
  marineShadow,
  type ThemeColors,
} from '../../constants/theme';

export default function WelcomeScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const handleSignIn = () => {
    router.push('/auth/login');
  };

  const handleContinueAsGuest = () => {
    // Persist the choice so we don't show the welcome screen again on
    // the next app launch. The user can still sign in later from settings.
    setSetting(db, 'onboarding_seen', 'true');
    router.replace('/(tabs)');
  };

  return (
    <View
      testID="welcome-screen"
      style={[
        styles.container,
        { paddingTop: insets.top + spacing.xxl, paddingBottom: insets.bottom + spacing.lg },
      ]}
    >
      <View style={styles.content}>
        <Image source={require('../../assets/icon.png')} style={styles.logo} />
        <Text style={styles.title}>Welcome to Anyvoc</Text>
        <Text style={styles.subtitle}>
          Build a personal vocabulary from anything you read. Your data stays on your device.
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          testID="welcome-sign-in-btn"
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
          onPress={handleSignIn}
        >
          <Text style={styles.primaryBtnText}>Sign in</Text>
        </Pressable>

        <Pressable
          testID="welcome-continue-guest-btn"
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}
          onPress={handleContinueAsGuest}
        >
          <Text style={styles.secondaryBtnText}>Continue as guest</Text>
        </Pressable>

        <Text style={styles.footnote}>
          Signing in is only required for Pro features. You can do it later from Settings.
        </Text>
      </View>
    </View>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
      paddingHorizontal: spacing.xl,
      justifyContent: 'space-between',
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      gap: spacing.lg,
    },
    logo: {
      width: 96,
      height: 96,
      borderRadius: borderRadius.lg,
      marginBottom: spacing.md,
    },
    title: {
      fontSize: fontSize.xxl,
      fontWeight: '700',
      color: c.text,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: fontSize.md,
      color: c.textSecondary,
      fontWeight: '300',
      textAlign: 'center',
      lineHeight: 22,
      maxWidth: 320,
    },
    actions: {
      gap: spacing.sm,
      alignItems: 'stretch',
    },
    primaryBtn: {
      backgroundColor: c.primary,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.full,
      alignItems: 'center',
      ...marineShadow,
    },
    primaryBtnText: {
      color: c.textOnColor,
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    secondaryBtn: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.full,
      alignItems: 'center',
    },
    secondaryBtnText: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '500',
    },
    footnote: {
      marginTop: spacing.md,
      fontSize: fontSize.xs,
      color: c.textSecondary,
      textAlign: 'center',
      fontWeight: '300',
    },
    pressed: {
      transform: [{ scale: 0.97 }],
      opacity: 0.85,
    },
  });

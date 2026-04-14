/**
 * Login method selection. In Chunk 2 only email OTP is wired up.
 * Apple and Google providers will be added in the next chunk (they
 * require native SDKs and a prebuild). The buttons are already laid
 * out with placeholder behavior so the UI landing pad is stable.
 */

import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  signInWithEmailOtp,
  signInWithGoogleIdToken,
  signInWithAppleIdToken,
  AuthError,
} from '../../lib/auth';
import { useAuthStore } from '../../lib/authStore';
import {
  signInWithGoogle,
  GoogleSignInError,
  GOOGLE_SIGN_IN_CANCELLED,
} from '../../lib/googleSignIn';
import { signInWithApple, AppleSignInError, APPLE_SIGN_IN_CANCELLED } from '../../lib/appleSignIn';
import { useSQLiteContext } from 'expo-sqlite';
import { setSetting } from '../../lib/database';
import { useTheme } from '../../hooks/useTheme';
import { useAlert } from '../../components/ConfirmDialog';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../../constants/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginScreen() {
  const router = useRouter();
  const db = useSQLiteContext();
  const setSession = useAuthStore((s) => s.setSession);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { alert, AlertDialog } = useAlert();

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [providerSubmitting, setProviderSubmitting] = useState<null | 'google' | 'apple'>(null);

  const emailValid = EMAIL_RE.test(email.trim());

  const handleEmailSubmit = async () => {
    if (!emailValid || submitting) return;
    const trimmed = email.trim().toLowerCase();
    setSubmitting(true);
    try {
      await signInWithEmailOtp(trimmed);
      router.push({ pathname: '/auth/verify', params: { email: trimmed } });
    } catch (err) {
      console.warn('signInWithEmailOtp failed', err);
      const message =
        err instanceof AuthError && err.message
          ? err.message
          : 'Could not send the verification code. Please check your connection and try again.';
      alert('Sign-in failed', message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    if (providerSubmitting) return;
    setProviderSubmitting('google');
    try {
      const idToken = await signInWithGoogle();
      const session = await signInWithGoogleIdToken(idToken);
      setSession(session);
      setSetting(db, 'onboarding_seen', 'true');
      if (session.user?.id) {
        setSetting(db, 'auth_user_id', session.user.id);
      }
      router.replace('/(tabs)');
    } catch (err) {
      if (err instanceof GoogleSignInError && err.code === GOOGLE_SIGN_IN_CANCELLED) {
        // User backed out — silent, no toast, per project UX convention.
        return;
      }
      console.warn('Google sign-in failed', err);
      const message =
        err instanceof GoogleSignInError || err instanceof AuthError
          ? err.message
          : 'Could not sign in with Google. Please try again.';
      alert('Sign-in failed', message);
    } finally {
      setProviderSubmitting(null);
    }
  };

  const handleAppleSignIn = async () => {
    if (providerSubmitting) return;
    setProviderSubmitting('apple');
    try {
      const idToken = await signInWithApple();
      const session = await signInWithAppleIdToken(idToken);
      setSession(session);
      setSetting(db, 'onboarding_seen', 'true');
      if (session.user?.id) {
        setSetting(db, 'auth_user_id', session.user.id);
      }
      router.replace('/(tabs)');
    } catch (err) {
      if (err instanceof AppleSignInError && err.code === APPLE_SIGN_IN_CANCELLED) {
        // User backed out — silent.
        return;
      }
      console.warn('Apple sign-in failed', err);
      const message =
        err instanceof AppleSignInError || err instanceof AuthError
          ? err.message
          : 'Could not sign in with Apple. Please try again.';
      alert('Sign-in failed', message);
    } finally {
      setProviderSubmitting(null);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable
          testID="login-back-btn"
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.closeButton}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Sign in</Text>
        <View style={styles.headerSide} />
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Email</Text>
        <Text style={styles.sectionHint}>
          We will send you a 6-digit code to confirm your email address.
        </Text>
        <TextInput
          testID="login-email-input"
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoComplete="email"
          autoCorrect={false}
          keyboardType="email-address"
          inputMode="email"
          returnKeyType="send"
          onSubmitEditing={handleEmailSubmit}
          editable={!submitting}
          style={styles.input}
        />
        <Pressable
          testID="login-email-submit"
          style={({ pressed }) => [
            styles.primaryBtn,
            (!emailValid || submitting) && styles.primaryBtnDisabled,
            pressed && emailValid && !submitting && styles.pressed,
          ]}
          disabled={!emailValid || submitting}
          onPress={handleEmailSubmit}
        >
          {submitting ? (
            <ActivityIndicator color={colors.textOnColor} />
          ) : (
            <Text style={styles.primaryBtnText}>Continue with email</Text>
          )}
        </Pressable>

        <View style={styles.separatorRow}>
          <View style={styles.separatorLine} />
          <Text style={styles.separatorText}>or</Text>
          <View style={styles.separatorLine} />
        </View>

        {Platform.OS === 'ios' && (
          <Pressable
            testID="login-method-apple"
            style={({ pressed }) => [
              styles.providerBtn,
              providerSubmitting !== null && styles.primaryBtnDisabled,
              pressed && providerSubmitting === null && styles.pressed,
            ]}
            disabled={providerSubmitting !== null}
            onPress={handleAppleSignIn}
          >
            {providerSubmitting === 'apple' ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <>
                <Ionicons name="logo-apple" size={18} color={colors.text} />
                <Text style={styles.providerBtnText}>Continue with Apple</Text>
              </>
            )}
          </Pressable>
        )}

        {/*
          Google Sign-In is Android-only: the google-signin native iOS SDK
          conflicts with MLKit's transitive Google utilities at pod
          resolution. react-native.config.js excludes the module from iOS
          autolinking; this button renders only on Android so we never
          attempt to call a missing native module. iOS users sign in via
          email (OTP) or Apple.
        */}
        {Platform.OS === 'android' && (
          <Pressable
            testID="login-method-google"
            style={({ pressed }) => [
              styles.providerBtn,
              providerSubmitting !== null && styles.primaryBtnDisabled,
              pressed && providerSubmitting === null && styles.pressed,
            ]}
            disabled={providerSubmitting !== null}
            onPress={handleGoogleSignIn}
          >
            {providerSubmitting === 'google' ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <>
                <Ionicons name="logo-google" size={18} color={colors.text} />
                <Text style={styles.providerBtnText}>Continue with Google</Text>
              </>
            )}
          </Pressable>
        )}
      </View>

      <AlertDialog />
    </KeyboardAvoidingView>
  );
}

const createStyles = (c: ThemeColors) =>
  StyleSheet.create({
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
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: fontSize.lg,
      fontWeight: '600',
      color: c.text,
    },
    closeButton: {
      width: 40,
      alignItems: 'flex-start',
    },
    content: {
      padding: spacing.lg,
      gap: spacing.sm,
    },
    sectionTitle: {
      fontSize: fontSize.md,
      fontWeight: '600',
      color: c.text,
      marginTop: spacing.md,
    },
    sectionHint: {
      fontSize: fontSize.xs,
      color: c.textSecondary,
      fontWeight: '300',
      marginBottom: spacing.sm,
    },
    input: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
      color: c.text,
      fontSize: fontSize.md,
    },
    primaryBtn: {
      backgroundColor: c.primary,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.full,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    primaryBtnDisabled: {
      opacity: 0.5,
    },
    primaryBtnText: {
      color: c.textOnColor,
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    separatorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginVertical: spacing.md,
    },
    separatorLine: {
      flex: 1,
      height: 1,
      backgroundColor: c.glassBorder,
    },
    separatorText: {
      color: c.textSecondary,
      fontSize: fontSize.sm,
      fontWeight: '300',
    },
    providerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.full,
    },
    providerBtnText: {
      color: c.text,
      fontSize: fontSize.md,
      fontWeight: '500',
    },
    pressed: {
      transform: [{ scale: 0.97 }],
      opacity: 0.85,
    },
  });

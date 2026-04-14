/**
 * OTP verification screen. Receives the email via router params, lets
 * the user enter the 6-digit code, and verifies via Supabase. On
 * success, persists onboarding_seen=true, updates the auth store, and
 * routes to the tabs.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { verifyEmailOtp, signInWithEmailOtp, AuthError } from '../../lib/auth';
import { useAuthStore } from '../../lib/authStore';
import { setSetting } from '../../lib/database';
import { useTheme } from '../../hooks/useTheme';
import { useAlert } from '../../components/ConfirmDialog';
import { spacing, fontSize, borderRadius, type ThemeColors } from '../../constants/theme';

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

export default function VerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = (params.email ?? '').toLowerCase();
  const db = useSQLiteContext();
  const setSession = useAuthStore((s) => s.setSession);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { alert, AlertDialog } = useAlert();

  const [code, setCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendRemaining, setResendRemaining] = useState(RESEND_COOLDOWN_SECONDS);
  const inputRef = useRef<TextInput>(null);

  // Guard against arriving here without an email (deep link or reload).
  useEffect(() => {
    if (!email) {
      router.replace('/auth/login');
    }
  }, [email, router]);

  // Resend cooldown timer.
  useEffect(() => {
    if (resendRemaining <= 0) return;
    const t = setInterval(() => {
      setResendRemaining((n) => (n > 0 ? n - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [resendRemaining]);

  const codeValid = code.length === CODE_LENGTH && /^\d+$/.test(code);

  const handleVerify = async () => {
    if (!codeValid || verifying) return;
    setVerifying(true);
    try {
      const session = await verifyEmailOtp(email, code);
      setSession(session);
      setSetting(db, 'onboarding_seen', 'true');
      if (session.user?.id) {
        setSetting(db, 'auth_user_id', session.user.id);
      }
      router.replace('/(tabs)');
    } catch (err) {
      console.warn('verifyEmailOtp failed', err);
      const message =
        err instanceof AuthError && err.message
          ? err.message
          : 'The code could not be verified. Please check the code and try again.';
      alert('Verification failed', message);
      setCode('');
      inputRef.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (resendRemaining > 0 || resending) return;
    setResending(true);
    try {
      await signInWithEmailOtp(email);
      setResendRemaining(RESEND_COOLDOWN_SECONDS);
      alert('Code sent', `We sent a new code to ${email}.`);
    } catch (err) {
      console.warn('resend OTP failed', err);
      const message =
        err instanceof AuthError && err.message
          ? err.message
          : 'Could not resend the code. Please try again in a moment.';
      alert('Resend failed', message);
    } finally {
      setResending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + spacing.xs }]}>
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.closeButton}>
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Verify email</Text>
        <View style={styles.headerSide} />
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Enter the 6-digit code</Text>
        <Text style={styles.sectionHint}>
          We sent a code to <Text style={styles.emailHighlight}>{email}</Text>. It may take a minute
          to arrive — check your spam folder if you don't see it.
        </Text>

        <TextInput
          ref={inputRef}
          testID="verify-otp-input"
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, CODE_LENGTH))}
          placeholder="123456"
          placeholderTextColor={colors.textSecondary}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={CODE_LENGTH}
          editable={!verifying}
          style={styles.codeInput}
        />

        <Pressable
          testID="verify-submit-btn"
          style={({ pressed }) => [
            styles.primaryBtn,
            (!codeValid || verifying) && styles.primaryBtnDisabled,
            pressed && codeValid && !verifying && styles.pressed,
          ]}
          disabled={!codeValid || verifying}
          onPress={handleVerify}
        >
          {verifying ? (
            <ActivityIndicator color={colors.textOnColor} />
          ) : (
            <Text style={styles.primaryBtnText}>Verify</Text>
          )}
        </Pressable>

        <Pressable
          testID="verify-resend-btn"
          style={styles.resendBtn}
          disabled={resendRemaining > 0 || resending}
          onPress={handleResend}
        >
          {resending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text
              style={[
                styles.resendText,
                (resendRemaining > 0 || resending) && styles.resendTextDisabled,
              ]}
            >
              {resendRemaining > 0 ? `Resend code in ${resendRemaining}s` : 'Resend code'}
            </Text>
          )}
        </Pressable>
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
      fontSize: fontSize.sm,
      color: c.textSecondary,
      fontWeight: '300',
      lineHeight: 20,
      marginBottom: spacing.md,
    },
    emailHighlight: {
      color: c.text,
      fontWeight: '500',
    },
    codeInput: {
      backgroundColor: c.glass,
      borderWidth: 1,
      borderColor: c.glassBorder,
      borderRadius: borderRadius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.lg,
      color: c.text,
      fontSize: fontSize.xl,
      fontWeight: '600',
      textAlign: 'center',
      letterSpacing: 8,
    },
    primaryBtn: {
      backgroundColor: c.primary,
      paddingVertical: spacing.md,
      borderRadius: borderRadius.full,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    primaryBtnDisabled: {
      opacity: 0.5,
    },
    primaryBtnText: {
      color: c.textOnColor,
      fontSize: fontSize.md,
      fontWeight: '600',
    },
    resendBtn: {
      alignItems: 'center',
      paddingVertical: spacing.md,
    },
    resendText: {
      color: c.primary,
      fontSize: fontSize.sm,
      fontWeight: '500',
    },
    resendTextDisabled: {
      color: c.textSecondary,
    },
    pressed: {
      transform: [{ scale: 0.97 }],
      opacity: 0.85,
    },
  });

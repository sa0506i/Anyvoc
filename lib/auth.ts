/**
 * Authentication layer — Supabase client + auth operations.
 *
 * Exposes a small wrapper around Supabase Auth so the rest of the app
 * never imports `@supabase/supabase-js` directly. All session tokens
 * are persisted in `expo-secure-store` (Keychain on iOS,
 * EncryptedSharedPreferences on Android) via a custom storage adapter.
 *
 * SECURITY NOTE — SUPABASE_ANON_KEY is intentionally bundled in the client.
 * Supabase's anon key is a *public* project identifier, not a secret —
 * equivalent to a Firebase web config. Access control is enforced by
 * Supabase Row-Level-Security policies on every table, not by hiding
 * this key. Shipping it is the documented, intended usage.
 *
 * This does NOT violate CLAUDE.md's "no API key in client code" rule,
 * which targets *secret* keys (the former Anthropic client key, and
 * Supabase service-role keys). The service-role key lives ONLY in the
 * `delete-account` Edge Function as a Supabase secret — never in this
 * file, never in `lib/`, never in `app/`. Architecture test Rule 11
 * enforces that.
 */

import 'react-native-url-polyfill/auto';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { createClient, type Session, type User } from '@supabase/supabase-js';

// --- Config ---

const SUPABASE_URL = Constants.expoConfig?.extra?.supabaseUrl as string | undefined;
const SUPABASE_ANON_KEY = Constants.expoConfig?.extra?.supabaseAnonKey as string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Supabase config missing: set supabaseUrl and supabaseAnonKey in app.json extra.',
  );
}

// --- SecureStore adapter for Supabase session persistence ---
//
// Supabase-JS expects a storage interface with getItem/setItem/removeItem
// returning promises. We wrap expo-secure-store so refresh tokens land in
// the platform's hardware-backed keystore instead of AsyncStorage (which
// is unencrypted on Android and readable on rooted devices).

export const secureStorageAdapter = {
  getItem: (key: string): Promise<string | null> => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string): Promise<void> => SecureStore.setItemAsync(key, value),
  removeItem: (key: string): Promise<void> => SecureStore.deleteItemAsync(key),
};

// --- Client ---

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: secureStorageAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no URL bar — disable URL-based session detection.
    detectSessionInUrl: false,
  },
});

// --- Types re-exported so callers don't import from @supabase directly ---

export type { Session, User };

// --- Error class ---

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// --- Email OTP ---

/**
 * Sends a 6-digit OTP code to the given email address.
 * Supabase rate-limits this to ~1/min per email address.
 */
export async function signInWithEmailOtp(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // Prevent Supabase from creating a password-style account — we want
      // pure OTP. shouldCreateUser=true so first-time logins auto-create
      // the auth.users row on successful verification.
      shouldCreateUser: true,
    },
  });
  if (error) {
    throw new AuthError(error.message, error);
  }
}

/**
 * Verifies the 6-digit code sent to `email`. On success, Supabase stores
 * the session via our secureStorageAdapter and returns it.
 */
export async function verifyEmailOtp(email: string, token: string): Promise<Session> {
  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token,
    type: 'email',
  });
  if (error || !data.session) {
    throw new AuthError(error?.message ?? 'Verification failed', error);
  }
  return data.session;
}

// --- Apple / Google (wired in later phase; signature stable) ---

/**
 * Signs in with an Apple identity token. The caller is responsible for
 * obtaining the token via `expo-apple-authentication`. iOS-only.
 */
export async function signInWithAppleIdToken(idToken: string): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: idToken,
  });
  if (error || !data.session) {
    throw new AuthError(error?.message ?? 'Apple sign-in failed', error);
  }
  return data.session;
}

/**
 * Signs in with a Google ID token. The caller is responsible for
 * obtaining the token via `@react-native-google-signin/google-signin`.
 */
export async function signInWithGoogleIdToken(idToken: string): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'google',
    token: idToken,
  });
  if (error || !data.session) {
    throw new AuthError(error?.message ?? 'Google sign-in failed', error);
  }
  return data.session;
}

// --- Session lifecycle ---

export async function getCurrentSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new AuthError(error.message, error);
  }
  return data.session;
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    throw new AuthError(error.message, error);
  }
}

/**
 * Deletes the current user's account via the `delete-account` Edge Function.
 * The function runs server-side with the service-role key and calls
 * `supabase.auth.admin.deleteUser(user.id)`. Local device data is NOT
 * touched — the user can continue as a guest afterwards.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) {
    throw new AuthError(error.message, error);
  }
  // Server-side deletion invalidates the session; signOut() clears local
  // tokens so the app state reflects reality.
  await signOut();
}

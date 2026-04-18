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
//
// Chunking: expo-secure-store warns that values larger than 2048 bytes
// may not persist and will throw in a future SDK. Supabase writes the
// whole session (access_token JWT + refresh_token + user object) as one
// JSON blob, which routinely exceeds that limit. We split the value
// across numbered child keys with a manifest key recording the count;
// getItem reassembles them, removeItem tears them all down. Legacy
// installs that wrote a single value pre-chunking fall through the
// `${key}.chunks` absence and are read via the classic single-key path
// on their next boot — Supabase then refreshes, we write chunked, done.

const SECURE_STORE_CHUNK_SIZE = 1800; // leave headroom under the 2 KB cap
const CHUNK_COUNT_SUFFIX = '.chunks';
const chunkKey = (key: string, index: number): string => `${key}.chunk.${index}`;

async function setItemChunked(key: string, value: string): Promise<void> {
  // Tear down any previous chunked write first so a shorter new value
  // doesn't leave stale chunks behind.
  await removeItemChunked(key);

  const chunks = Math.max(1, Math.ceil(value.length / SECURE_STORE_CHUNK_SIZE));
  for (let i = 0; i < chunks; i++) {
    const slice = value.slice(i * SECURE_STORE_CHUNK_SIZE, (i + 1) * SECURE_STORE_CHUNK_SIZE);
    await SecureStore.setItemAsync(chunkKey(key, i), slice);
  }
  await SecureStore.setItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`, String(chunks));
}

async function getItemChunked(key: string): Promise<string | null> {
  const countStr = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  if (countStr === null) {
    // Legacy single-value read: installs that wrote before this
    // adapter grew chunking still have their session at `key` itself.
    return SecureStore.getItemAsync(key);
  }
  const count = Number.parseInt(countStr, 10);
  if (!Number.isFinite(count) || count <= 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i));
    if (part === null) return null; // partial / corrupted write — fail safe
    parts.push(part);
  }
  return parts.join('');
}

async function removeItemChunked(key: string): Promise<void> {
  const countStr = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  if (countStr !== null) {
    const count = Number.parseInt(countStr, 10);
    if (Number.isFinite(count) && count > 0) {
      for (let i = 0; i < count; i++) {
        await SecureStore.deleteItemAsync(chunkKey(key, i));
      }
    }
    await SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  }
  // Clear any legacy single-value entry too (no-op if absent).
  await SecureStore.deleteItemAsync(key);
}

export const secureStorageAdapter = {
  getItem: (key: string): Promise<string | null> => getItemChunked(key),
  setItem: (key: string, value: string): Promise<void> => setItemChunked(key, value),
  removeItem: (key: string): Promise<void> => removeItemChunked(key),
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
  const { data, error } = await supabase.functions.invoke('delete-account');
  if (error) {
    // Supabase SDK wraps non-2xx responses in a generic message. Try to
    // pull the actual server body so diagnostics are useful. The SDK
    // attaches the raw Response object under `error.context` in some
    // versions and `error.response` in others; we try both.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx: any = (error as any).context ?? (error as any).response;
    let serverBody: string | null = null;
    try {
      if (ctx && typeof ctx.text === 'function') {
        serverBody = await ctx.text();
      }
    } catch {
      // ignore — we'll fall through with the generic message.
    }
    console.warn('deleteAccount Edge Function failed', {
      message: error.message,
      status: ctx?.status,
      body: serverBody,
    });
    throw new AuthError(serverBody && serverBody.length < 300 ? serverBody : error.message, error);
  }
  console.log('deleteAccount succeeded', data);
  // Server-side deletion invalidates the session; signOut() clears local
  // tokens so the app state reflects reality.
  await signOut();
}

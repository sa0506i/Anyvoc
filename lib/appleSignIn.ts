/**
 * Apple Sign-In wrapper (iOS only).
 *
 * Exposes signInWithApple() which triggers the native Apple
 * authentication sheet and returns the identityToken for
 * supabase.auth.signInWithIdToken({ provider: 'apple', token }).
 *
 * The caller is responsible for not invoking this on Android — use
 * `isAppleSignInAvailable()` or `Platform.OS === 'ios'` to gate.
 *
 * Apple only returns full-name + email on the FIRST sign-in per app
 * install. On subsequent logins, only the stable user identifier is
 * returned. Supabase persists the email from the first sign-in in
 * auth.users, so this is fine.
 */

import * as AppleAuthentication from 'expo-apple-authentication';

export class AppleSignInError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppleSignInError';
  }
}

export const APPLE_SIGN_IN_CANCELLED = 'ERR_CANCELED';

export async function isAppleSignInAvailable(): Promise<boolean> {
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Launches the native Apple sign-in sheet and returns the identityToken.
 * Throws AppleSignInError with code APPLE_SIGN_IN_CANCELLED on cancel —
 * callers should swallow silently per project UX convention.
 */
export async function signInWithApple(): Promise<string> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new AppleSignInError('Apple did not return an identityToken');
    }
    return credential.identityToken;
  } catch (err) {
    if (err instanceof AppleSignInError) throw err;
    // expo-apple-authentication throws with code 'ERR_CANCELED' on cancel.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const code = (err as any)?.code as string | undefined;
    if (code === APPLE_SIGN_IN_CANCELLED) {
      throw new AppleSignInError('Sign-in cancelled', APPLE_SIGN_IN_CANCELLED, err);
    }
    const message = err instanceof Error ? err.message : 'Apple sign-in failed';
    throw new AppleSignInError(message, code, err);
  }
}

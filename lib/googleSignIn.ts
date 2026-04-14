/**
 * Google Sign-In wrapper — **Android-only at runtime.**
 *
 * The native iOS SDK that @react-native-google-signin/google-signin v16
 * pulls (GoogleSignIn ~> 9.0, GoogleUtilities ~> 8.0, GTMSessionFetcher
 * ~> 3.x) conflicts with @infinitered/react-native-mlkit-text-recognition
 * at pod resolution. We disable iOS autolinking in
 * react-native.config.js so the pod is never installed there. The login
 * screen also hides the Google button on iOS. signInWithGoogle() below
 * bails early on iOS with a clear error in case a future caller slips
 * through — saves you the confusing "RNGoogleSignin is not linked" crash.
 *
 * On Android the SDK pairs Package name + SHA-1 (configured in Google
 * Cloud Console) with the Web Client ID to obtain ID tokens. The Web
 * Client ID is the one Supabase validates against.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import {
  GoogleSignin,
  statusCodes,
  isErrorWithCode,
} from '@react-native-google-signin/google-signin';

const WEB_CLIENT_ID = Constants.expoConfig?.extra?.googleWebClientId as string | undefined;
const IOS_CLIENT_ID = Constants.expoConfig?.extra?.googleIosClientId as string | undefined;

let configured = false;

/**
 * Idempotent. Safe to call from module-load, screen mount, or right
 * before sign-in. Throws if the Web Client ID is missing because
 * without it, id-token retrieval will fail silently with misleading
 * errors downstream.
 */
export function configureGoogleSignIn(): void {
  if (configured) return;
  if (!WEB_CLIENT_ID) {
    throw new Error(
      'googleWebClientId missing from app.json extra — cannot configure Google Sign-In.',
    );
  }
  GoogleSignin.configure({
    webClientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID,
    // offlineAccess: false is the default — we don't need a refresh token
    // from Google since Supabase issues its own session once we hand over
    // the id_token. Keeping it off avoids the second consent dialog.
    offlineAccess: false,
    scopes: ['profile', 'email'],
  });
  configured = true;
}

export class GoogleSignInError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'GoogleSignInError';
  }
}

/** Special sentinel code for "user cancelled" — caller should swallow silently. */
export const GOOGLE_SIGN_IN_CANCELLED = 'SIGN_IN_CANCELLED';

/**
 * Launches the Google sign-in sheet and returns the Google ID token.
 * The caller passes that to supabase.auth.signInWithIdToken.
 *
 * On cancellation, throws GoogleSignInError with code
 * GOOGLE_SIGN_IN_CANCELLED — callers should swallow that silently and
 * show nothing, per project UX convention.
 */
export async function signInWithGoogle(): Promise<string> {
  if (Platform.OS === 'ios') {
    throw new GoogleSignInError(
      'Google Sign-In is not available on iOS in this build. Please use email or Apple sign-in.',
      'IOS_NOT_SUPPORTED',
    );
  }
  configureGoogleSignIn();

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const result = await GoogleSignin.signIn();
    // Library v13+ returns { type: 'success', data: {...} } or { type: 'cancelled' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = result;
    if (r?.type === 'cancelled') {
      throw new GoogleSignInError('Sign-in cancelled', GOOGLE_SIGN_IN_CANCELLED);
    }
    const idToken: string | undefined = r?.data?.idToken ?? r?.idToken;
    if (!idToken) {
      throw new GoogleSignInError('Google did not return an id_token');
    }
    return idToken;
  } catch (err) {
    if (err instanceof GoogleSignInError) throw err;
    if (isErrorWithCode(err)) {
      if (err.code === statusCodes.SIGN_IN_CANCELLED) {
        throw new GoogleSignInError('Sign-in cancelled', GOOGLE_SIGN_IN_CANCELLED, err);
      }
      if (err.code === statusCodes.IN_PROGRESS) {
        throw new GoogleSignInError('Sign-in already in progress', err.code, err);
      }
      if (err.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new GoogleSignInError(
          'Google Play Services is not available on this device.',
          err.code,
          err,
        );
      }
      throw new GoogleSignInError(err.message || 'Google sign-in failed', err.code, err);
    }
    throw new GoogleSignInError('Google sign-in failed', undefined, err);
  }
}

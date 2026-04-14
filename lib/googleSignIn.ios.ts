/**
 * iOS stub for lib/googleSignIn.ts.
 *
 * Metro resolves this file on iOS instead of googleSignIn.ts, so the
 * @react-native-google-signin/google-signin JS package is not bundled
 * into iOS builds. The Android implementation lives next to it in
 * googleSignIn.ts.
 *
 * Why this exists — not a style choice:
 *   The google-signin package runs
 *     TurboModuleRegistry.getEnforcing('RNGoogleSignin')
 *   at module load. We excluded the native pod on iOS (Rules 16 + 18),
 *   so getEnforcing throws on iOS. A previous version of this wrapper
 *   used a runtime Platform.OS guard INSIDE signInWithGoogle(); that
 *   ran too late — the static import of the library had already
 *   triggered the throw and crashed the JS thread during error
 *   conversion as soon as /auth/login loaded. This stub keeps the
 *   library entirely out of the iOS bundle.
 *
 * The public surface must mirror googleSignIn.ts exactly so
 * `import { ... } from '../../lib/googleSignIn'` resolves the same
 * identifiers on both platforms. Architecture test Rule 19 enforces
 * that this file exists and never re-introduces the forbidden import.
 */

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

/** Sentinel re-exported for parity with the Android implementation. On
 *  iOS it is never produced (cancellation cannot happen because the
 *  flow cannot start), but consumers that import it by name from this
 *  module would otherwise get `undefined` — breaking typed destructure. */
export const GOOGLE_SIGN_IN_CANCELLED = 'SIGN_IN_CANCELLED';

/** No-op on iOS — there is nothing to configure. Safe to call from any
 *  code path that runs on both platforms. */
export function configureGoogleSignIn(): void {
  // intentionally empty
}

/** On iOS this rejects immediately with IOS_NOT_SUPPORTED. The caller
 *  (app/auth/login.tsx) already hides the Google button on iOS, so in
 *  practice this path should never be reached — this is defence in depth
 *  against a future caller. */
export async function signInWithGoogle(): Promise<string> {
  throw new GoogleSignInError(
    'Google Sign-In is not available on iOS in this build. Please use email or Apple sign-in.',
    'IOS_NOT_SUPPORTED',
  );
}

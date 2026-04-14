/**
 * Type-only facade for platform-split googleSignIn wrapper.
 *
 * Runtime:
 *   Metro resolves './googleSignIn' to lib/googleSignIn.android.ts on
 *   Android builds and lib/googleSignIn.ios.ts on iOS builds.
 *
 * TypeScript:
 *   TS doesn't follow React Native's .ios.ts / .android.ts suffix
 *   convention. Consumers that `import { ... } from '../../lib/googleSignIn'`
 *   need a resolvable module at that path — this .d.ts file is it.
 *   The types below must mirror the public surface of BOTH .android.ts
 *   and .ios.ts (they already agree by design; the stub tests enforce
 *   value-level parity where it matters, e.g. GOOGLE_SIGN_IN_CANCELLED).
 */

export declare class GoogleSignInError extends Error {
  constructor(message: string, code?: string, cause?: unknown);
  readonly code?: string;
  readonly cause?: unknown;
}

export declare const GOOGLE_SIGN_IN_CANCELLED: string;

export declare function configureGoogleSignIn(): void;

export declare function signInWithGoogle(): Promise<string>;

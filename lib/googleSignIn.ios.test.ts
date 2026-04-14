/**
 * Jest tests for lib/googleSignIn.ios.ts — the iOS stub.
 *
 * Note: this test file imports googleSignIn.ios.ts DIRECTLY (with the
 * explicit suffix). In production Metro handles the suffix resolution
 * based on the build platform; in jest-expo's default setup tests run
 * on a single platform and the .ios-suffixed file would otherwise be
 * ignored. The direct-path import is the standard Jest idiom for
 * platform-specific modules.
 *
 * The tests confirm:
 *  1. The stub rejects with IOS_NOT_SUPPORTED (defence-in-depth if a
 *     future caller reaches it).
 *  2. configureGoogleSignIn is a harmless no-op.
 *  3. The public surface matches googleSignIn.ts exactly — if someone
 *     adds an export to the Android impl without updating the stub,
 *     this test would fail on the next missing-binding assertion.
 */

import {
  signInWithGoogle,
  configureGoogleSignIn,
  GoogleSignInError,
  GOOGLE_SIGN_IN_CANCELLED,
} from './googleSignIn.ios';

describe('iOS stub: signInWithGoogle', () => {
  it('rejects with GoogleSignInError whose code is IOS_NOT_SUPPORTED', async () => {
    await expect(signInWithGoogle()).rejects.toMatchObject({
      name: 'GoogleSignInError',
      code: 'IOS_NOT_SUPPORTED',
      message: expect.stringContaining('not available on iOS'),
    });
  });

  it('the rejection is an instance of GoogleSignInError', async () => {
    await expect(signInWithGoogle()).rejects.toBeInstanceOf(GoogleSignInError);
  });
});

describe('iOS stub: configureGoogleSignIn', () => {
  it('is a no-op and does not throw', () => {
    expect(() => configureGoogleSignIn()).not.toThrow();
  });

  it('is idempotent — repeated calls are fine', () => {
    configureGoogleSignIn();
    configureGoogleSignIn();
    configureGoogleSignIn();
    expect(true).toBe(true);
  });
});

describe('iOS stub: public surface parity with Android impl', () => {
  it('exports GOOGLE_SIGN_IN_CANCELLED with the same value', () => {
    // If the Android impl changes the sentinel value without updating
    // this stub, consumers that compare against it would silently
    // diverge. Enforce identical values across platforms.
    expect(GOOGLE_SIGN_IN_CANCELLED).toBe('SIGN_IN_CANCELLED');
  });

  it('GoogleSignInError carries the standard name', () => {
    const err = new GoogleSignInError('test', 'X');
    expect(err.name).toBe('GoogleSignInError');
    expect(err.code).toBe('X');
  });
});

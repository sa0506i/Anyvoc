/**
 * Jest tests for lib/appleSignIn.ts
 *
 * Mocks expo-apple-authentication and verifies the wrapper's contract:
 * - isAppleSignInAvailable() gracefully returns false on throw
 * - signInWithApple() returns the identityToken on success
 * - cancel → AppleSignInError with APPLE_SIGN_IN_CANCELLED sentinel
 * - missing identityToken → AppleSignInError
 */

jest.mock('expo-apple-authentication', () => {
  const signInAsync = jest.fn();
  const isAvailableAsync = jest.fn();
  return {
    signInAsync,
    isAvailableAsync,
    AppleAuthenticationScope: {
      FULL_NAME: 'full_name',
      EMAIL: 'email',
    },
    __getMocks: () => ({ signInAsync, isAvailableAsync }),
  };
});

import {
  signInWithApple,
  isAppleSignInAvailable,
  AppleSignInError,
  APPLE_SIGN_IN_CANCELLED,
} from './appleSignIn';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { signInAsync, isAvailableAsync } = (
  jest.requireMock('expo-apple-authentication') as any
).__getMocks();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('isAppleSignInAvailable', () => {
  it('returns true when the native module reports availability', async () => {
    isAvailableAsync.mockResolvedValue(true);
    expect(await isAppleSignInAvailable()).toBe(true);
  });

  it('returns false on any thrown error', async () => {
    isAvailableAsync.mockRejectedValue(new Error('not supported'));
    expect(await isAppleSignInAvailable()).toBe(false);
  });
});

describe('signInWithApple', () => {
  it('requests FULL_NAME and EMAIL scopes and returns the identityToken', async () => {
    signInAsync.mockResolvedValue({ identityToken: 'apple-id-token-abc' });
    const token = await signInWithApple();
    expect(token).toBe('apple-id-token-abc');
    expect(signInAsync).toHaveBeenCalledWith({
      requestedScopes: ['full_name', 'email'],
    });
  });

  it('throws AppleSignInError with CANCELLED sentinel on user cancel', async () => {
    signInAsync.mockRejectedValue({ code: 'ERR_CANCELED', message: 'user cancelled' });
    await expect(signInWithApple()).rejects.toMatchObject({
      name: 'AppleSignInError',
      code: APPLE_SIGN_IN_CANCELLED,
    });
  });

  it('throws AppleSignInError when identityToken is missing', async () => {
    signInAsync.mockResolvedValue({ identityToken: null });
    await expect(signInWithApple()).rejects.toMatchObject({
      name: 'AppleSignInError',
      message: expect.stringMatching(/identityToken/i),
    });
  });

  it('wraps unknown errors with their code attached', async () => {
    signInAsync.mockRejectedValue({ code: 'ERR_OTHER', message: 'boom' });
    await expect(signInWithApple()).rejects.toMatchObject({
      name: 'AppleSignInError',
      code: 'ERR_OTHER',
    });
  });

  it('wraps non-object errors as AppleSignInError', async () => {
    signInAsync.mockRejectedValue(new Error('network'));
    await expect(signInWithApple()).rejects.toMatchObject({
      name: 'AppleSignInError',
      message: 'network',
    });
  });
});

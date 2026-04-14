/**
 * Jest tests for lib/googleSignIn.ts
 *
 * Mocks @react-native-google-signin/google-signin entirely so the
 * wrapper's behavior is driven by the tests. The mock is defined
 * inside the factory to avoid the ESM-hoisting TDZ issue (same
 * pattern as auth.test.ts).
 */

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        googleWebClientId: 'web-client-id.apps.googleusercontent.com',
        googleIosClientId: 'ios-client-id.apps.googleusercontent.com',
      },
    },
  },
}));

jest.mock('@react-native-google-signin/google-signin', () => {
  const GoogleSignin = {
    configure: jest.fn(),
    hasPlayServices: jest.fn(),
    signIn: jest.fn(),
  };
  const statusCodes = {
    SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
    IN_PROGRESS: 'IN_PROGRESS',
    PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
  };
  // Returns true for anything that looks like { code: string }.
  const isErrorWithCode = (err: unknown): err is { code: string; message?: string } =>
    !!err && typeof err === 'object' && 'code' in err;
  return {
    GoogleSignin,
    statusCodes,
    isErrorWithCode,
    __getMocks: () => ({ GoogleSignin, statusCodes }),
  };
});

import {
  signInWithGoogle,
  configureGoogleSignIn,
  GoogleSignInError,
  GOOGLE_SIGN_IN_CANCELLED,
} from './googleSignIn';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { GoogleSignin, statusCodes } = (
  jest.requireMock('@react-native-google-signin/google-signin') as any
).__getMocks();

beforeEach(() => {
  jest.clearAllMocks();
});

describe('configureGoogleSignIn', () => {
  it('passes Web + iOS client IDs and no offline access', () => {
    configureGoogleSignIn();
    expect(GoogleSignin.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        webClientId: 'web-client-id.apps.googleusercontent.com',
        iosClientId: 'ios-client-id.apps.googleusercontent.com',
        offlineAccess: false,
        scopes: ['profile', 'email'],
      }),
    );
  });

  it('is idempotent — configure only runs once per process', () => {
    configureGoogleSignIn();
    configureGoogleSignIn();
    configureGoogleSignIn();
    // Called at most once despite three calls. (First call is in the
    // previous test thanks to module-level state; we can't easily
    // isolate, so we just assert "<= 1 additional call here".)
    expect(GoogleSignin.configure.mock.calls.length).toBeLessThanOrEqual(1);
  });
});

describe('signInWithGoogle', () => {
  it('returns the id_token from a successful sign-in (v13+ shape)', async () => {
    GoogleSignin.hasPlayServices.mockResolvedValue(true);
    GoogleSignin.signIn.mockResolvedValue({
      type: 'success',
      data: { idToken: 'google-id-token-123' },
    });

    const token = await signInWithGoogle();
    expect(token).toBe('google-id-token-123');
    expect(GoogleSignin.hasPlayServices).toHaveBeenCalledWith({
      showPlayServicesUpdateDialog: true,
    });
  });

  it('returns the id_token from a successful sign-in (legacy shape)', async () => {
    GoogleSignin.hasPlayServices.mockResolvedValue(true);
    GoogleSignin.signIn.mockResolvedValue({ idToken: 'legacy-token' });

    const token = await signInWithGoogle();
    expect(token).toBe('legacy-token');
  });

  it('throws GoogleSignInError with CANCELLED sentinel on v13 cancelled response', async () => {
    GoogleSignin.hasPlayServices.mockResolvedValue(true);
    GoogleSignin.signIn.mockResolvedValue({ type: 'cancelled' });

    await expect(signInWithGoogle()).rejects.toMatchObject({
      name: 'GoogleSignInError',
      code: GOOGLE_SIGN_IN_CANCELLED,
    });
  });

  it('throws GoogleSignInError with CANCELLED sentinel on SIGN_IN_CANCELLED status', async () => {
    GoogleSignin.hasPlayServices.mockResolvedValue(true);
    GoogleSignin.signIn.mockRejectedValue({
      code: statusCodes.SIGN_IN_CANCELLED,
      message: 'user cancelled',
    });

    await expect(signInWithGoogle()).rejects.toMatchObject({
      name: 'GoogleSignInError',
      code: GOOGLE_SIGN_IN_CANCELLED,
    });
  });

  it('maps PLAY_SERVICES_NOT_AVAILABLE to a user-friendly message', async () => {
    GoogleSignin.hasPlayServices.mockResolvedValue(true);
    GoogleSignin.signIn.mockRejectedValue({
      code: statusCodes.PLAY_SERVICES_NOT_AVAILABLE,
      message: 'no play services',
    });

    await expect(signInWithGoogle()).rejects.toMatchObject({
      name: 'GoogleSignInError',
      code: statusCodes.PLAY_SERVICES_NOT_AVAILABLE,
      message: expect.stringContaining('Play Services'),
    });
  });

  it('maps IN_PROGRESS errors to a GoogleSignInError with the same code', async () => {
    GoogleSignin.hasPlayServices.mockResolvedValue(true);
    GoogleSignin.signIn.mockRejectedValue({
      code: statusCodes.IN_PROGRESS,
      message: 'already running',
    });

    await expect(signInWithGoogle()).rejects.toMatchObject({
      name: 'GoogleSignInError',
      code: statusCodes.IN_PROGRESS,
    });
  });

  it('throws if Google returned no idToken', async () => {
    GoogleSignin.hasPlayServices.mockResolvedValue(true);
    GoogleSignin.signIn.mockResolvedValue({ type: 'success', data: {} });

    await expect(signInWithGoogle()).rejects.toMatchObject({
      name: 'GoogleSignInError',
      message: expect.stringMatching(/id_token/i),
    });
  });

  it('wraps non-coded errors as GoogleSignInError', async () => {
    GoogleSignin.hasPlayServices.mockResolvedValue(true);
    GoogleSignin.signIn.mockRejectedValue(new Error('network boom'));

    await expect(signInWithGoogle()).rejects.toMatchObject({
      name: 'GoogleSignInError',
    });
  });
});

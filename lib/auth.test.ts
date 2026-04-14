/**
 * Jest tests for lib/auth.ts
 *
 * The supabase-js mock is created inside the jest.mock factory to avoid
 * the TDZ / import-hoisting pitfall: ESM imports are hoisted above
 * top-level const declarations, so by the time `createClient` runs
 * during ./auth module load, any top-level mock objects would still be
 * undefined. Exposing the mocks via `__getMocks()` lets tests reach
 * them after the factory has populated them.
 */

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {
        supabaseUrl: 'https://test.supabase.co',
        supabaseAnonKey: 'test-anon-key',
      },
    },
  },
}));

// In-memory SecureStore mock
jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (key: string) => store[key] ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key];
    }),
    __store: store,
  };
});

jest.mock('@supabase/supabase-js', () => {
  const mockAuth = {
    signInWithOtp: jest.fn(),
    verifyOtp: jest.fn(),
    signInWithIdToken: jest.fn(),
    getSession: jest.fn(),
    signOut: jest.fn(),
    onAuthStateChange: jest.fn(),
  };
  const mockFunctions = { invoke: jest.fn() };
  let capturedOptions: unknown = null;
  return {
    createClient: jest.fn((_url: string, _key: string, opts: unknown) => {
      capturedOptions = opts;
      return { auth: mockAuth, functions: mockFunctions };
    }),
    __getMocks: () => ({
      mockAuth,
      mockFunctions,
      getCapturedOptions: () => capturedOptions,
    }),
  };
});

import {
  signInWithEmailOtp,
  verifyEmailOtp,
  signInWithAppleIdToken,
  signInWithGoogleIdToken,
  getCurrentSession,
  signOut,
  deleteAccount,
  secureStorageAdapter,
  AuthError,
} from './auth';
import * as SecureStore from 'expo-secure-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const supabaseMock = jest.requireMock('@supabase/supabase-js') as any;
const { mockAuth, mockFunctions, getCapturedOptions } = supabaseMock.__getMocks();

const fakeSession = {
  access_token: 'at',
  refresh_token: 'rt',
  user: { id: 'u1', email: 'a@b.c' },
};

beforeEach(() => {
  jest.clearAllMocks();
});

// --------- Client construction ---------

describe('supabase client construction', () => {
  it('passes the secureStorageAdapter to the SDK', () => {
    const opts = getCapturedOptions() as { auth: { storage: unknown } };
    expect(opts.auth.storage).toBe(secureStorageAdapter);
  });

  it('configures autoRefreshToken + persistSession + no URL detection', () => {
    const opts = getCapturedOptions() as {
      auth: { autoRefreshToken: boolean; persistSession: boolean; detectSessionInUrl: boolean };
    };
    expect(opts.auth.autoRefreshToken).toBe(true);
    expect(opts.auth.persistSession).toBe(true);
    expect(opts.auth.detectSessionInUrl).toBe(false);
  });
});

// --------- secureStorageAdapter ---------

describe('secureStorageAdapter', () => {
  it('round-trips set/get/remove via expo-secure-store', async () => {
    await secureStorageAdapter.setItem('k', 'v');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('k', 'v');

    const got = await secureStorageAdapter.getItem('k');
    expect(got).toBe('v');

    await secureStorageAdapter.removeItem('k');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('k');

    const afterRemove = await secureStorageAdapter.getItem('k');
    expect(afterRemove).toBeNull();
  });
});

// --------- Email OTP ---------

describe('signInWithEmailOtp', () => {
  it('calls supabase.auth.signInWithOtp with the email', async () => {
    mockAuth.signInWithOtp.mockResolvedValue({ error: null });
    await signInWithEmailOtp('user@example.com');
    expect(mockAuth.signInWithOtp).toHaveBeenCalledWith({
      email: 'user@example.com',
      options: { shouldCreateUser: true },
    });
  });

  it('throws AuthError on Supabase error', async () => {
    mockAuth.signInWithOtp.mockResolvedValue({ error: { message: 'rate limit' } });
    await expect(signInWithEmailOtp('a@b.c')).rejects.toBeInstanceOf(AuthError);
  });
});

describe('verifyEmailOtp', () => {
  it('returns the session on success', async () => {
    mockAuth.verifyOtp.mockResolvedValue({ data: { session: fakeSession }, error: null });
    const s = await verifyEmailOtp('a@b.c', '123456');
    expect(s).toBe(fakeSession);
    expect(mockAuth.verifyOtp).toHaveBeenCalledWith({
      email: 'a@b.c',
      token: '123456',
      type: 'email',
    });
  });

  it('throws AuthError on error', async () => {
    mockAuth.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { message: 'bad code' },
    });
    await expect(verifyEmailOtp('a@b.c', '000000')).rejects.toBeInstanceOf(AuthError);
  });

  it('throws AuthError when session is missing even if no error', async () => {
    mockAuth.verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
    await expect(verifyEmailOtp('a@b.c', '000000')).rejects.toBeInstanceOf(AuthError);
  });
});

// --------- Apple / Google ---------

describe('signInWithAppleIdToken', () => {
  it('delegates to supabase.auth.signInWithIdToken with provider=apple', async () => {
    mockAuth.signInWithIdToken.mockResolvedValue({ data: { session: fakeSession }, error: null });
    await signInWithAppleIdToken('apple-token');
    expect(mockAuth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple-token',
    });
  });

  it('throws AuthError on failure', async () => {
    mockAuth.signInWithIdToken.mockResolvedValue({
      data: { session: null },
      error: { message: 'denied' },
    });
    await expect(signInWithAppleIdToken('x')).rejects.toBeInstanceOf(AuthError);
  });
});

describe('signInWithGoogleIdToken', () => {
  it('delegates with provider=google', async () => {
    mockAuth.signInWithIdToken.mockResolvedValue({ data: { session: fakeSession }, error: null });
    await signInWithGoogleIdToken('g-token');
    expect(mockAuth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'google',
      token: 'g-token',
    });
  });
});

// --------- Session lifecycle ---------

describe('getCurrentSession', () => {
  it('returns the session from the SDK', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: fakeSession }, error: null });
    const s = await getCurrentSession();
    expect(s).toBe(fakeSession);
  });

  it('returns null when no session', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    expect(await getCurrentSession()).toBeNull();
  });

  it('throws AuthError on SDK error', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: { message: 'oops' } });
    await expect(getCurrentSession()).rejects.toBeInstanceOf(AuthError);
  });
});

describe('signOut', () => {
  it('delegates to SDK', async () => {
    mockAuth.signOut.mockResolvedValue({ error: null });
    await signOut();
    expect(mockAuth.signOut).toHaveBeenCalled();
  });

  it('throws AuthError on error', async () => {
    mockAuth.signOut.mockResolvedValue({ error: { message: 'network' } });
    await expect(signOut()).rejects.toBeInstanceOf(AuthError);
  });
});

// --------- Delete account ---------

describe('deleteAccount', () => {
  it('invokes the delete-account Edge Function and signs out', async () => {
    mockFunctions.invoke.mockResolvedValue({ data: null, error: null });
    mockAuth.signOut.mockResolvedValue({ error: null });

    await deleteAccount();

    expect(mockFunctions.invoke).toHaveBeenCalledWith('delete-account');
    expect(mockAuth.signOut).toHaveBeenCalled();
  });

  it('throws AuthError when the Edge Function errors and does NOT sign out', async () => {
    mockFunctions.invoke.mockResolvedValue({ data: null, error: { message: 'no' } });

    await expect(deleteAccount()).rejects.toBeInstanceOf(AuthError);
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  it('surfaces the server response body when SDK exposes error.context', async () => {
    // Supabase-JS wraps non-2xx responses with a generic message and
    // attaches the raw Response on error.context. Our wrapper reads
    // context.text() so operators see the real server message.
    const ctx = {
      status: 500,
      text: jest.fn().mockResolvedValue('{"error":"Edge Function env not configured"}'),
    };
    const sdkError = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: ctx,
    });
    mockFunctions.invoke.mockResolvedValue({ data: null, error: sdkError });

    await expect(deleteAccount()).rejects.toMatchObject({
      name: 'AuthError',
      message: expect.stringContaining('Edge Function env not configured'),
    });
    expect(ctx.text).toHaveBeenCalled();
    expect(mockAuth.signOut).not.toHaveBeenCalled();
  });

  it('falls back to SDK message when context.text() itself throws', async () => {
    const ctx = {
      status: 500,
      text: jest.fn().mockRejectedValue(new Error('stream consumed')),
    };
    const sdkError = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: ctx,
    });
    mockFunctions.invoke.mockResolvedValue({ data: null, error: sdkError });

    await expect(deleteAccount()).rejects.toMatchObject({
      name: 'AuthError',
      message: 'Edge Function returned a non-2xx status code',
    });
  });
});

/**
 * Jest tests for lib/authStore.ts
 *
 * Uses the same factory-internal-mocks pattern as auth.test.ts to dodge
 * the import-hoisting TDZ issue.
 */

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { supabaseUrl: 'x', supabaseAnonKey: 'y' } } },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => {}),
  deleteItemAsync: jest.fn(async () => {}),
}));

jest.mock('@supabase/supabase-js', () => {
  const mockAuth = {
    getSession: jest.fn(),
    onAuthStateChange: jest.fn(),
    signInWithOtp: jest.fn(),
    verifyOtp: jest.fn(),
    signInWithIdToken: jest.fn(),
    signOut: jest.fn(),
  };
  const mockFunctions = { invoke: jest.fn() };
  return {
    createClient: jest.fn(() => ({ auth: mockAuth, functions: mockFunctions })),
    __getMocks: () => ({ mockAuth, mockFunctions }),
  };
});

import { useAuthStore, __resetAuthSubscriptionForTests } from './authStore';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { mockAuth } = (jest.requireMock('@supabase/supabase-js') as any).__getMocks();

const fakeSession = {
  access_token: 'at',
  refresh_token: 'rt',
  user: { id: 'u1', email: 'a@b.c' },
};

function resetStore() {
  useAuthStore.setState({
    session: null,
    user: null,
    isAuthed: false,
    isLoading: true,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStore();
  __resetAuthSubscriptionForTests();
});

describe('useAuthStore initial state', () => {
  it('starts unauthenticated and loading', () => {
    const s = useAuthStore.getState();
    expect(s.session).toBeNull();
    expect(s.user).toBeNull();
    expect(s.isAuthed).toBe(false);
    expect(s.isLoading).toBe(true);
  });
});

describe('restoreSession', () => {
  it('hydrates from SDK getSession and clears loading', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: fakeSession } });
    mockAuth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });

    await useAuthStore.getState().restoreSession();

    const s = useAuthStore.getState();
    expect(s.session).toBe(fakeSession);
    expect(s.user).toBe(fakeSession.user);
    expect(s.isAuthed).toBe(true);
    expect(s.isLoading).toBe(false);
  });

  it('handles null session (no prior login)', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null } });
    mockAuth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: jest.fn() } },
    });

    await useAuthStore.getState().restoreSession();

    const s = useAuthStore.getState();
    expect(s.isAuthed).toBe(false);
    expect(s.isLoading).toBe(false);
  });

  it('subscribes to onAuthStateChange and syncs store on events', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null } });
    let captured: ((event: string, session: unknown) => void) | null = null;
    mockAuth.onAuthStateChange.mockImplementation((cb: (event: string, s: unknown) => void) => {
      captured = cb;
      return { data: { subscription: { unsubscribe: jest.fn() } } };
    });

    await useAuthStore.getState().restoreSession();
    expect(captured).not.toBeNull();

    // Simulate a later SIGNED_IN event from the SDK.
    captured!('SIGNED_IN', fakeSession);
    const s = useAuthStore.getState();
    expect(s.session).toBe(fakeSession);
    expect(s.isAuthed).toBe(true);
  });

  it('tears down the existing subscription when the test-reset helper runs', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null } });
    const unsubscribe = jest.fn();
    mockAuth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe } },
    });

    await useAuthStore.getState().restoreSession();
    expect(mockAuth.onAuthStateChange).toHaveBeenCalledTimes(1);

    // A second restore while still subscribed must NOT open a second listener.
    await useAuthStore.getState().restoreSession();
    expect(mockAuth.onAuthStateChange).toHaveBeenCalledTimes(1);

    // Reset helper unsubscribes the current listener so a fresh store
    // instance (e.g. next test, Fast Refresh) can register cleanly.
    __resetAuthSubscriptionForTests();
    expect(unsubscribe).toHaveBeenCalledTimes(1);

    await useAuthStore.getState().restoreSession();
    expect(mockAuth.onAuthStateChange).toHaveBeenCalledTimes(2);
  });
});

describe('setSession', () => {
  it('updates session and derived flags', () => {
    useAuthStore.getState().setSession(fakeSession as never);
    const s = useAuthStore.getState();
    expect(s.session).toBe(fakeSession);
    expect(s.user).toBe(fakeSession.user);
    expect(s.isAuthed).toBe(true);
    expect(s.isLoading).toBe(false);
  });

  it('setSession(null) clears state', () => {
    useAuthStore.getState().setSession(fakeSession as never);
    useAuthStore.getState().setSession(null);
    const s = useAuthStore.getState();
    expect(s.session).toBeNull();
    expect(s.isAuthed).toBe(false);
  });
});

describe('clear', () => {
  it('resets the store to signed-out state', () => {
    useAuthStore.getState().setSession(fakeSession as never);
    useAuthStore.getState().clear();
    const s = useAuthStore.getState();
    expect(s.session).toBeNull();
    expect(s.user).toBeNull();
    expect(s.isAuthed).toBe(false);
    expect(s.isLoading).toBe(false);
  });
});

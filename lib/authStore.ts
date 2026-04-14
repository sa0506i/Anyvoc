/**
 * Auth state store (Zustand).
 *
 * Mirrors the pattern of `useSettingsStore` / `useTrainerStore`. Holds
 * the current Supabase session/user in memory for synchronous reads in
 * UI code. On app start, `restoreSession()` pulls the persisted session
 * from SecureStore (via the Supabase SDK) and subscribes to future
 * auth-state changes so the store stays in sync with the SDK.
 */

import { create } from 'zustand';
import { supabase, type Session, type User } from './auth';

interface AuthState {
  session: Session | null;
  user: User | null;
  /** True while the initial session restore is in flight. */
  isLoading: boolean;
  /** Derived: true iff a valid session exists. */
  isAuthed: boolean;

  /** Called once at app start. Restores session from SecureStore and
   *  subscribes to Supabase auth-state changes. Idempotent. */
  restoreSession: () => Promise<void>;
  /** Clears the in-memory session. Does NOT call Supabase signOut —
   *  use the `signOut` helper from `lib/auth` for that. */
  clear: () => void;
  /** Sets session from outside (e.g. right after verifyEmailOtp). */
  setSession: (session: Session | null) => void;
}

let subscribed = false;

/** Test-only: resets the one-shot onAuthStateChange subscription flag so
 *  `restoreSession` can re-register a fresh listener. No effect at runtime. */
export function __resetAuthSubscriptionForTests(): void {
  subscribed = false;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  isLoading: true,
  isAuthed: false,

  restoreSession: async () => {
    // The SDK's getSession() reads from our SecureStore adapter.
    const { data } = await supabase.auth.getSession();
    set({
      session: data.session,
      user: data.session?.user ?? null,
      isAuthed: !!data.session,
      isLoading: false,
    });

    // Subscribe once for the lifetime of the process. Covers token
    // refreshes, sign-outs from other tabs/flows, and provider flows.
    if (!subscribed) {
      subscribed = true;
      supabase.auth.onAuthStateChange((_event, session) => {
        set({
          session,
          user: session?.user ?? null,
          isAuthed: !!session,
          isLoading: false,
        });
      });
    }
  },

  clear: () => {
    set({ session: null, user: null, isAuthed: false, isLoading: false });
  },

  setSession: (session) => {
    set({
      session,
      user: session?.user ?? null,
      isAuthed: !!session,
      isLoading: false,
    });
  },
}));

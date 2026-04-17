import { Platform } from 'react-native';
import type { Router } from 'expo-router';

type SignInContext = {
  /**
   * Where the auth flow was entered from.
   *  - `'settings'`: user tapped "Sign in" inside the Settings modal.
   *    After success we pop the auth screens off the top of the stack
   *    so the Settings modal remains visible — the user resumes where
   *    they left off (e.g. to toggle Pro Mode on).
   *  - anything else / undefined: fresh-install / welcome flow. Land
   *    on the main tabs.
   */
  from?: string;
  /**
   * How many auth screens currently sit above the return point. Only
   * read when `from === 'settings'`. `login.tsx` passes 1 (pop login).
   * `verify.tsx` passes 2 (pop verify + login).
   */
  authDepth?: number;
};

/**
 * Navigate after a successful sign-in.
 *
 * Two stack shapes are possible:
 *
 *   Welcome flow:   [auth/welcome, auth/login, auth/verify?]
 *   Settings flow:  [(tabs), settings(modal), auth/login, auth/verify?]
 *
 * Welcome flow → land on the main tabs. A plain `router.replace` only
 * swaps the top screen, so on iOS we first `dismissAll()` to clear the
 * stack (otherwise any lingering modal sheet would render on top of
 * the new tabs screen). On Android we skip `dismissAll()` — the
 * combined `dismissAll()` + `replace()` sequence crashes Fabric with
 * `IllegalStateException: addViewAt: failed to insert view` when the
 * stack contains the Settings modal; the plain replace works there.
 *
 * Settings flow → pop only the auth screens and leave the Settings
 * modal on screen. A single `dismiss(n)` is one native op, so no
 * Fabric race on Android.
 */
export function navigateAfterSignIn(router: Router, ctx: SignInContext = {}): void {
  if (ctx.from === 'settings') {
    router.dismiss(ctx.authDepth ?? 1);
    return;
  }
  if (Platform.OS === 'ios' && router.canDismiss()) {
    router.dismissAll();
  }
  router.replace('/(tabs)');
}

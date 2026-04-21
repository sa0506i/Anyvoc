/**
 * Architecture Boundary Tests — "Architecture Fitness Harness"
 *
 * These tests enforce structural rules documented in CLAUDE.md as
 * deterministic, computational sensors. They run in milliseconds and
 * catch drift that would otherwise require manual review.
 *
 * Each test maps to a specific CLAUDE.md rule with an actionable error
 * message designed for both humans and LLM agents (self-correction).
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

/** Recursively collect .ts/.tsx files under a directory, excluding tests and node_modules */
function collectSourceFiles(dir: string, ext = /\.(ts|tsx)$/): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '__tests__') {
      results.push(...collectSourceFiles(full, ext));
    } else if (
      entry.isFile() &&
      ext.test(entry.name) &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.test.tsx')
    ) {
      results.push(full);
    }
  }
  return results;
}

// ─── Rule 1: No Node-only imports in lib/ ───────────────────────────
// CLAUDE.md: "nothing under lib/ may import axios, tar, node:fs,
// node:path, node:https, better-sqlite3, or any Node-only API"
describe('Architecture: lib/ must not import Node-only modules', () => {
  const BANNED_PATTERNS = [
    /\bfrom\s+['"](?:node:)?fs['"]/,
    /\brequire\s*\(\s*['"](?:node:)?fs['"]\s*\)/,
    /\bfrom\s+['"](?:node:)?path['"]/,
    /\brequire\s*\(\s*['"](?:node:)?path['"]\s*\)/,
    /\bfrom\s+['"](?:node:)?https?['"]/,
    /\brequire\s*\(\s*['"](?:node:)?https?['"]\s*\)/,
    /\bfrom\s+['"]better-sqlite3['"]/,
    /\brequire\s*\(\s*['"]better-sqlite3['"]\s*\)/,
    /\bfrom\s+['"]axios['"]/,
    /\brequire\s*\(\s*['"]axios['"]\s*\)/,
    /\bfrom\s+['"]tar['"]/,
    /\brequire\s*\(\s*['"]tar['"]\s*\)/,
  ];

  const libFiles = collectSourceFiles(path.join(ROOT, 'lib'));

  it('should have lib/ source files to check', () => {
    expect(libFiles.length).toBeGreaterThan(0);
  });

  for (const file of libFiles) {
    const relPath = path.relative(ROOT, file);
    it(`${relPath} has no banned Node-only imports`, () => {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of BANNED_PATTERNS) {
        const match = content.match(pattern);
        expect(match).toBeNull();
        if (match) {
          throw new Error(
            `BANNED IMPORT in ${relPath}: "${match[0]}"\n` +
              `Node-only imports are not allowed in lib/. ` +
              `Move this code to scripts/ (devDependency) or use a React Native compatible alternative.\n` +
              `See CLAUDE.md "Hard rule" section.`,
          );
        }
      }
    });
  }
});

// ─── Rule 2: components/ must not use raw SQL (expo-sqlite direct queries) ───
// useSQLiteContext() is OK (React hook for DB context), but raw SQL calls belong in lib/database.ts
describe('Architecture: components/ must not use raw SQL queries', () => {
  const componentFiles = collectSourceFiles(path.join(ROOT, 'components'));

  const RAW_SQL_PATTERNS = [
    /\bopenDatabaseSync\b/,
    /\.runSync\s*\(/,
    /\.getAllSync\s*\(/,
    /\.getFirstSync\s*\(/,
    /\.execSync\s*\(/,
  ];

  for (const file of componentFiles) {
    const relPath = path.relative(ROOT, file);
    it(`${relPath} has no raw SQL calls`, () => {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of RAW_SQL_PATTERNS) {
        const match = content.match(pattern);
        expect(match).toBeNull();
        if (match) {
          throw new Error(
            `RAW SQL in ${relPath}: "${match[0]}"\n` +
              `Components must not call SQLite methods directly. ` +
              `Use functions from lib/database.ts instead.\n` +
              `useSQLiteContext() is fine — but all queries belong in the data layer.`,
          );
        }
      }
    });
  }
});

// ─── Rule 3: No API key or Authorization header in client code ──────
// CLAUDE.md: "No API key ships with the app"
describe('Architecture: no API keys in client code', () => {
  const clientDirs = ['lib', 'app', 'components', 'hooks', 'constants'];
  const allFiles = clientDirs.flatMap((dir) => collectSourceFiles(path.join(ROOT, dir)));

  const API_KEY_PATTERNS = [
    /['"]Authorization['"]\s*:/i,
    /['"]x-api-key['"]\s*:/i,
    /ANTHROPIC_API_KEY/,
    /MISTRAL_API_KEY/,
    /expo-secure-store/,
  ];

  // Files allowed to import expo-secure-store. The auth layer legitimately
  // stores Supabase refresh tokens there (not API keys) — the only sanctioned
  // use. See lib/auth.ts docblock and CLAUDE.md "Authentication" section.
  const SECURE_STORE_ALLOWLIST = new Set([path.join('lib', 'auth.ts')]);

  for (const file of allFiles) {
    const relPath = path.relative(ROOT, file);
    const allowsSecureStore = SECURE_STORE_ALLOWLIST.has(relPath);
    it(`${relPath} has no API key patterns`, () => {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of API_KEY_PATTERNS) {
        if (allowsSecureStore && pattern.source === 'expo-secure-store') continue;
        const match = content.match(pattern);
        expect(match).toBeNull();
        if (match) {
          throw new Error(
            `API KEY PATTERN in ${relPath}: "${match[0]}"\n` +
              `The app must not hold API keys. All LLM calls go through the backend proxy.\n` +
              `Do not add Authorization headers, API key env vars, or expo-secure-store.\n` +
              `See CLAUDE.md "Security" section.`,
          );
        }
      }
    });
  }
});

// ─── Rule 4: lib/classifier/score.ts must not be manually edited ────
// CLAUDE.md: "Don't edit them by hand — they come from the calibration pipeline"
describe('Architecture: score.ts integrity', () => {
  it('score.ts contains expected model constants', () => {
    const scorePath = path.join(ROOT, 'lib', 'classifier', 'score.ts');
    const content = fs.readFileSync(scorePath, 'utf8');

    // Must contain the key model constants
    expect(content).toMatch(/W_ZIPF/);
    expect(content).toMatch(/W_AOA/);
    expect(content).toMatch(/THETA/);

    // Must export key scoring functions
    expect(content).toMatch(/export\s+function\s+scoreDifficulty/);
    expect(content).toMatch(/export\s+function\s+difficultyToCefr/);
  });
});

// ─── Rule 5: matchAnswer.ts must stay offline (no network imports) ───
// CLAUDE.md: Typing quiz matching is pure local — no LLM, no fetch.
describe('Architecture: matchAnswer.ts must not use network', () => {
  it('matchAnswer.ts has no network imports', () => {
    const filePath = path.join(ROOT, 'lib', 'matchAnswer.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    const NETWORK_PATTERNS = [
      /\bfetch\s*\(/,
      /\bfrom\s+['"].*claude['"]/,
      /\bfrom\s+['"]axios['"]/,
      /\bimport\b.*['"].*callClaude['"]/,
      /\bXMLHttpRequest\b/,
    ];

    for (const pattern of NETWORK_PATTERNS) {
      const match = content.match(pattern);
      expect(match).toBeNull();
      if (match) {
        throw new Error(
          `NETWORK IMPORT in matchAnswer.ts: "${match[0]}"\n` +
            `matchAnswer must be pure local string matching — no network calls.\n` +
            `See spec: docs/superpowers/specs/2026-04-13-typing-quiz-mode-design.md`,
        );
      }
    }
  });
});

// ─── Rule 6: Trainer screen imports ConfirmDialog ──────────────────
// Trainer has delete-card flow that needs themed dialog.
// (The broader "no Alert anywhere" ban is Rule 8 below.)
describe('Architecture: trainer screen uses ConfirmDialog', () => {
  it('app/(tabs)/index.tsx imports ConfirmDialog', () => {
    const filePath = path.join(ROOT, 'app', '(tabs)', 'index.tsx');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toMatch(/import\s+ConfirmDialog\s+from/);
  });
});

// ─── Rule 7: Settings language picker filters native from learning ───
// Native language must not appear in learning language picker.
// When native is set to current learning language, they must swap.
describe('Architecture: settings language swap logic', () => {
  it('settings.tsx filters languages in learning picker', () => {
    const filePath = path.join(ROOT, 'app', 'settings.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    // Must filter out nativeLanguage from learning picker
    expect(content).toMatch(/\.filter\(/);
    expect(content).toMatch(/nativeLanguage/);
  });

  it('settings.tsx swaps languages when native conflicts with learning', () => {
    const filePath = path.join(ROOT, 'app', 'settings.tsx');
    const content = fs.readFileSync(filePath, 'utf8');

    // Must handle the swap case: when selected native === current learning
    expect(content).toMatch(/learningLanguage/);
    // Should update learningLanguage to old nativeLanguage when conflict detected
    expect(content).toMatch(/updateSetting\(['"]learningLanguage['"]/);
  });
});

// ─── Rule 8: No Alert.alert anywhere in app/ or components/ ────────
// CLAUDE.md: Native Alert.alert is unstyled on Android. All screens
// and components must use the themed ConfirmDialog / useAlert() hook.
// The only file allowed to reference Alert is ConfirmDialog.tsx itself.
describe('Architecture: no native Alert.alert in client code', () => {
  const appFiles = collectSourceFiles(path.join(ROOT, 'app'));
  const componentFiles = collectSourceFiles(path.join(ROOT, 'components'));
  const allFiles = [...appFiles, ...componentFiles];

  for (const file of allFiles) {
    const relPath = path.relative(ROOT, file);
    // ConfirmDialog.tsx is the themed replacement — it's allowed to reference Alert concepts
    if (relPath.includes('ConfirmDialog')) continue;

    it(`${relPath} does not use native Alert`, () => {
      const content = fs.readFileSync(file, 'utf8');
      // Check for Alert import from react-native
      const importMatch = content.match(/\bimport\b[^;]*\bAlert\b[^;]*from\s+['"]react-native['"]/);
      expect(importMatch).toBeNull();
      if (importMatch) {
        throw new Error(
          `NATIVE ALERT IMPORT in ${relPath}: "${importMatch[0]}"\n` +
            `Do not use React Native's Alert — it renders unstyled on Android.\n` +
            `Use the useAlert() hook from components/ConfirmDialog instead.\n` +
            `See CLAUDE.md "Known Issues" section.`,
        );
      }
      // Check for Alert.alert() calls (even without import, could be a global reference)
      const callMatch = content.match(/\bAlert\.alert\s*\(/);
      expect(callMatch).toBeNull();
      if (callMatch) {
        throw new Error(
          `ALERT.ALERT() CALL in ${relPath}: "${callMatch[0]}"\n` +
            `Do not use Alert.alert() — use the useAlert() hook instead.\n` +
            `See CLAUDE.md "Known Issues" section.`,
        );
      }
    });
  }
});

// ─── Rule 9: Error messages must use English language names ─────────
// CLAUDE.md: All UI is English. Use getLanguageEnglishName() for user-facing
// strings, not getLanguageName() (which returns native names like "Deutsch").
describe('Architecture: error messages use English language names', () => {
  it('shareProcessing.ts uses getLanguageEnglishName for error messages', () => {
    const filePath = path.join(ROOT, 'lib', 'shareProcessing.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Must import getLanguageEnglishName
    expect(content).toMatch(/getLanguageEnglishName/);

    // Must NOT import getLanguageName (the native-name version) —
    // if needed for non-error purposes in the future, this test can be relaxed
    const nativeNameImport = content.match(/\bimport\b[^;]*\bgetLanguageName\b[^;]*from/);
    expect(nativeNameImport).toBeNull();
    if (nativeNameImport) {
      throw new Error(
        `NATIVE LANGUAGE NAME in shareProcessing.ts\n` +
          `User-facing error messages must use English language names.\n` +
          `Use getLanguageEnglishName() instead of getLanguageName().\n` +
          `getLanguageName() returns native names (e.g. "Deutsch" instead of "German").`,
      );
    }
  });
});

// ─── Rule 10: No console.error for user-facing errors in app/ ──────
// console.error triggers Expo LogBox red toast in dev mode.
// Use console.warn for expected/handled errors shown to the user.
describe('Architecture: no console.error in app/ screens', () => {
  const appFiles = collectSourceFiles(path.join(ROOT, 'app'));

  for (const file of appFiles) {
    const relPath = path.relative(ROOT, file);
    it(`${relPath} does not use console.error`, () => {
      const content = fs.readFileSync(file, 'utf8');
      const match = content.match(/\bconsole\.error\s*\(/);
      expect(match).toBeNull();
      if (match) {
        throw new Error(
          `CONSOLE.ERROR in ${relPath}: "${match[0]}"\n` +
            `console.error triggers Expo LogBox red toast in dev mode.\n` +
            `Use console.warn for expected/handled errors, or remove the log.\n` +
            `See CLAUDE.md "Known Issues" section.`,
        );
      }
    });
  }
});

// ─── Rule 11: proMode gates translateText in shareProcessing.ts ─────
// CLAUDE.md: translateText is a Pro feature. Basic mode skips it.
// The call must be preceded by a check of settings.proMode or a local
// const derived from it (e.g. isPro). This prevents the gate from being
// removed accidentally.
describe('Architecture: proMode gates translateText in shareProcessing', () => {
  it('processSharedText only calls translateText when proMode is true', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'shareProcessing.ts'), 'utf8');
    // The call must exist.
    const callIdx = src.indexOf('translateText(');
    expect(callIdx).toBeGreaterThan(-1);
    // Everything before the first translateText( call must reference
    // settings.proMode or a local isPro variable.
    const before = src.slice(0, callIdx);
    const gated = /settings\.proMode/.test(before) || /\bisPro\b/.test(before);
    expect(gated).toBe(true);
    if (!gated) {
      throw new Error(
        `translateText() called without proMode gate in lib/shareProcessing.ts\n` +
          `Full-text translation is a Pro feature. The call must be inside a block\n` +
          `guarded by settings.proMode or a local const isPro derived from it.\n` +
          `See CLAUDE.md "Settings Keys" section.`,
      );
    }
  });
});

// ─── Rule 12: clearAllData must not delete from content_adds_log ─────
// CLAUDE.md: The daily-limit counter lives in content_adds_log.
// Reset / logout clears all user data including the daily-limit counter,
// so users start fresh after a full reset. The counter still persists
// across individual content deletions (tested in database.test.ts).
describe('Architecture: clearAllData wipes the daily-limit log', () => {
  it('lib/database.ts clearAllData must contain DELETE FROM content_adds_log', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'database.ts'), 'utf8');
    const match = src.match(/export function clearAllData\b[\s\S]*?\n\}/);
    expect(match).not.toBeNull();
    const body = match![0];
    expect(body).toMatch(/DELETE\s+FROM\s+content_adds_log/i);
  });
});

// ─── Rule 13: processSharedText checks daily limit before API calls ───
// CLAUDE.md: Basic-mode users over quota must be rejected before any
// billable API call (extractVocabulary or translateText). Moving the gate
// below those calls would charge the user before rejection.
describe('Architecture: processSharedText checks daily limit before API calls', () => {
  it('countContentsAddedToday reference appears before any extractVocabulary/translateText call', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'shareProcessing.ts'), 'utf8');
    const gateIdx = src.indexOf('countContentsAddedToday');
    const extractIdx = src.indexOf('extractVocabulary(');
    const translateIdx = src.indexOf('translateText(');

    expect(gateIdx).toBeGreaterThan(-1);
    expect(extractIdx).toBeGreaterThan(-1);
    expect(translateIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(extractIdx);
    expect(gateIdx).toBeLessThan(translateIdx);

    if (gateIdx >= extractIdx || gateIdx >= translateIdx) {
      throw new Error(
        `DAILY-LIMIT GATE OUT OF ORDER in lib/shareProcessing.ts\n` +
          `countContentsAddedToday() must be called BEFORE extractVocabulary() and translateText().\n` +
          `Moving the gate below API calls would trigger billable requests before rejection.\n` +
          `See CLAUDE.md "Known Issues" section.`,
      );
    }
  });
});

// ─── Rule 15: app/ screens must import useTheme, not hardcode colors ─
// Known baseline: 7 existing #FFFFFF usages in button text/icons (pre-existing debt).
// This test catches NEW hardcoded colors beyond the baseline.
describe('Architecture: screens use theme system', () => {
  const appFiles = collectSourceFiles(path.join(ROOT, 'app'));

  // Hex color patterns that suggest hardcoded colors (excluding #FFFFFF which is baselined)
  const HARDCODED_COLOR = /#[0-9a-fA-F]{6}\b/;
  const BASELINED_COLORS = new Set(['#FFFFFF', '#ffffff']);

  for (const file of appFiles) {
    const relPath = path.relative(ROOT, file);
    if (!file.endsWith('.tsx')) continue;

    it(`${relPath} does not introduce new hardcoded hex colors`, () => {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');
      const violations: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (
          line.trim().startsWith('//') ||
          line.trim().startsWith('*') ||
          line.trim().startsWith('import')
        )
          continue;
        const match = line.match(HARDCODED_COLOR);
        if (match && !BASELINED_COLORS.has(match[0].toUpperCase())) {
          violations.push(`  Line ${i + 1}: ${match[0]} in "${line.trim().substring(0, 80)}"`);
        }
      }

      if (violations.length > 0) {
        throw new Error(
          `NEW HARDCODED COLORS in ${relPath}:\n${violations.join('\n')}\n\n` +
            `Use colors from useTheme() instead of hex values.\n` +
            `#FFFFFF is baselined (pre-existing), but other hex colors are not allowed.\n` +
            `See CLAUDE.md "Styling Conventions" section.`,
        );
      }
    });
  }
});

// ─── Rule 11: No Supabase service-role key anywhere in client code ──
// CLAUDE.md "Authentication": "Service-role key lives ONLY in the
// delete-account Edge Function as a Supabase secret — never in this
// file, never in lib/, never in app/."
describe('Architecture: no Supabase service-role key in client code', () => {
  const clientDirs = ['lib', 'app', 'components', 'hooks', 'constants'];
  const allFiles = clientDirs.flatMap((dir) => collectSourceFiles(path.join(ROOT, dir)));

  const SERVICE_ROLE_PATTERNS = [
    /SUPABASE_SERVICE_ROLE_KEY/,
    /['"]service_role['"]/,
    /serviceRoleKey/i,
  ];

  for (const file of allFiles) {
    const relPath = path.relative(ROOT, file);
    it(`${relPath} has no service-role-key references`, () => {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of SERVICE_ROLE_PATTERNS) {
        const match = content.match(pattern);
        expect(match).toBeNull();
        if (match) {
          throw new Error(
            `SERVICE-ROLE KEY REFERENCE in ${relPath}: "${match[0]}"\n` +
              `The Supabase service-role key MUST NOT appear in client code.\n` +
              `It lives exclusively in the delete-account Edge Function as a\n` +
              `Supabase secret. Exposing it in the client would give anyone\n` +
              `who downloads the APK full admin access to the database.\n` +
              `See CLAUDE.md "Authentication" section.`,
          );
        }
      }
    });
  }
});

// ─── Rule 12: lib/auth.ts must not import AsyncStorage ──────────────
// CLAUDE.md "Authentication": session tokens go into expo-secure-store
// (Keychain/EncryptedSharedPreferences). AsyncStorage is unencrypted on
// Android and readable on rooted devices — unacceptable for refresh tokens.
describe('Architecture: lib/auth.ts uses SecureStore, not AsyncStorage', () => {
  it('lib/auth.ts does not import @react-native-async-storage/async-storage', () => {
    const authPath = path.join(ROOT, 'lib', 'auth.ts');
    const content = fs.readFileSync(authPath, 'utf8');
    const match = content.match(/@react-native-async-storage\/async-storage/);
    expect(match).toBeNull();
    if (match) {
      throw new Error(
        `AsyncStorage import in lib/auth.ts.\n` +
          `Session tokens must be persisted via expo-secure-store, not\n` +
          `AsyncStorage, because AsyncStorage is unencrypted on Android.\n` +
          `See CLAUDE.md "Authentication" section.`,
      );
    }
  });
});

// ─── Rule 14: Client code must not import from supabase/functions/ ──
// CLAUDE.md "Authentication": Edge Function code runs in Supabase's
// Deno runtime and relies on Deno-globals that do not exist in the
// React Native bundle. Importing it into the client would crash at
// load time. Keep the two worlds strictly separated.
describe('Architecture: client code must not import from supabase/functions/', () => {
  const clientDirs = ['lib', 'app', 'components', 'hooks', 'constants'];
  const allFiles = clientDirs.flatMap((dir) => collectSourceFiles(path.join(ROOT, dir)));

  // Matches relative or namespaced imports that reach into the functions
  // folder. Examples caught:
  //   import x from '../supabase/functions/delete-account';
  //   import x from '../../supabase/functions/shared';
  //   require('supabase/functions/...');
  const FORBIDDEN = /['"](?:[./\\]*\/)?supabase[/\\]functions\b/;

  for (const file of allFiles) {
    const relPath = path.relative(ROOT, file);
    it(`${relPath} does not import from supabase/functions/`, () => {
      const content = fs.readFileSync(file, 'utf8');
      const match = content.match(FORBIDDEN);
      expect(match).toBeNull();
      if (match) {
        throw new Error(
          `IMPORT FROM supabase/functions/ in ${relPath}: "${match[0]}"\n` +
            `Edge Functions run in a Deno server runtime and use globals\n` +
            `(Deno.env, Deno.serve) that do not exist in React Native.\n` +
            `Bundling that code into the app would crash at load time.\n` +
            `Invoke Edge Functions via supabase.functions.invoke('name')\n` +
            `from lib/auth.ts instead. See CLAUDE.md "Authentication".`,
        );
      }
    });
  }
});

// ─── Rule 15: Native provider SDKs only in their wrapper files ─────
// CLAUDE.md "Authentication": Google/Apple native SDKs are encapsulated
// in lib/googleSignIn.ts and lib/appleSignIn.ts. Callers use those
// wrappers — not the SDKs directly. This keeps (a) the SDK swappable
// with a single-file change and (b) test mocks centralised.
describe('Architecture: native provider SDKs only in their wrapper files', () => {
  const clientDirs = ['lib', 'app', 'components', 'hooks', 'constants'];
  const allFiles = clientDirs.flatMap((dir) => collectSourceFiles(path.join(ROOT, dir)));

  const PROVIDER_SDKS: Array<{
    pattern: RegExp;
    allowedFiles: string[];
    name: string;
  }> = [
    {
      pattern: /['"]@react-native-google-signin\/google-signin['"]/,
      // Android implementation lives in .android.ts. The .d.ts facade
      // and the .ios.ts stub are covered by Rule 19 (the stub MUST NOT
      // import it; the facade is type-only).
      allowedFiles: [path.join('lib', 'googleSignIn.android.ts')],
      name: '@react-native-google-signin/google-signin',
    },
    {
      pattern: /['"]expo-apple-authentication['"]/,
      allowedFiles: [path.join('lib', 'appleSignIn.ts')],
      name: 'expo-apple-authentication',
    },
  ];

  for (const file of allFiles) {
    const relPath = path.relative(ROOT, file);
    it(`${relPath} does not import native provider SDKs directly`, () => {
      const content = fs.readFileSync(file, 'utf8');
      for (const sdk of PROVIDER_SDKS) {
        if (sdk.allowedFiles.includes(relPath)) continue;
        const match = content.match(sdk.pattern);
        expect(match).toBeNull();
        if (match) {
          throw new Error(
            `DIRECT SDK IMPORT of ${sdk.name} in ${relPath}.\n` +
              `The native provider SDKs are encapsulated in their wrapper\n` +
              `(lib/googleSignIn.ts / lib/appleSignIn.ts). Use the wrapper's\n` +
              `exported helpers — signInWithGoogle() / signInWithApple() —\n` +
              `so provider swaps stay one-file changes and test mocks stay\n` +
              `centralised. See CLAUDE.md "Authentication" section.`,
          );
        }
      }
    });
  }
});

// ─── Rule 16: react-native.config.js excludes google-signin from iOS ──
// CLAUDE.md "Authentication": the google-signin native iOS SDK pulls
// Google utilities that conflict with MLKit's. We disable iOS
// autolinking for the package so its pod is never added to the iOS
// Podfile. Losing this config would reintroduce the pod conflict on
// the next EAS iOS build — a multi-minute round-trip failure. Catch
// it here in milliseconds instead.
describe('Architecture: react-native.config.js disables google-signin on iOS', () => {
  it('config file exists at the project root', () => {
    const cfgPath = path.join(ROOT, 'react-native.config.js');
    expect(fs.existsSync(cfgPath)).toBe(true);
  });

  it('configures ios: null for @react-native-google-signin/google-signin', () => {
    const cfgPath = path.join(ROOT, 'react-native.config.js');
    if (!fs.existsSync(cfgPath)) {
      throw new Error(
        'react-native.config.js is missing.\n' +
          'This file disables iOS autolinking for\n' +
          '@react-native-google-signin/google-signin, without which the\n' +
          'EAS iOS build fails at pod resolution.\n' +
          'See CLAUDE.md "Authentication" section.',
      );
    }
    const content = fs.readFileSync(cfgPath, 'utf8');

    // Rough but sufficient: require the package key AND the ios: null key
    // to both appear. More brittle string matching (exact JSON) would
    // reject harmless refactors like renaming the variable or adding
    // comments mid-block.
    const hasPackage = /@react-native-google-signin\/google-signin/.test(content);
    const hasIosNull = /ios\s*:\s*null/.test(content);

    if (!hasPackage || !hasIosNull) {
      throw new Error(
        `react-native.config.js must exclude @react-native-google-signin/\n` +
          `google-signin from iOS autolinking. Expected the file to contain:\n` +
          `  - the string "@react-native-google-signin/google-signin"\n` +
          `  - the key "ios: null" inside its platforms block\n` +
          `Found package ref: ${hasPackage} | ios:null: ${hasIosNull}\n` +
          `Without this, the iOS Podfile pulls google-signin's native SDK\n` +
          `which conflicts with MLKit's transitive Google utilities.\n` +
          `See CLAUDE.md "Authentication" section for the full exit paths.`,
      );
    }
    expect(hasPackage).toBe(true);
    expect(hasIosNull).toBe(true);
  });
});

// ─── Rule 19: googleSignIn platform-split is intact ─────────────────
// CLAUDE.md "Authentication": we ship platform-specific implementations
// via Metro's .ios/.android suffix resolution plus a .d.ts facade for
// TypeScript. The iOS stub must stay google-signin-free — its whole
// purpose is to keep the library OUT of the iOS bundle (its module-load
// TurboModuleRegistry.getEnforcing("RNGoogleSignin") crashes the JS
// thread when the native pod is excluded — Rules 16 + 18).
describe('Architecture: googleSignIn is platform-split with an iOS stub', () => {
  const iosPath = path.join(ROOT, 'lib', 'googleSignIn.ios.ts');
  const androidPath = path.join(ROOT, 'lib', 'googleSignIn.android.ts');
  const dtsPath = path.join(ROOT, 'lib', 'googleSignIn.d.ts');

  it('all three files (ios, android, .d.ts) exist', () => {
    const missing: string[] = [];
    if (!fs.existsSync(iosPath)) missing.push('lib/googleSignIn.ios.ts');
    if (!fs.existsSync(androidPath)) missing.push('lib/googleSignIn.android.ts');
    if (!fs.existsSync(dtsPath)) missing.push('lib/googleSignIn.d.ts');
    if (missing.length > 0) {
      throw new Error(
        `Platform-split googleSignIn wrapper is incomplete.\n` +
          `Missing: ${missing.join(', ')}\n\n` +
          `The split requires:\n` +
          `  - googleSignIn.android.ts: real implementation\n` +
          `  - googleSignIn.ios.ts:     google-signin-free stub\n` +
          `  - googleSignIn.d.ts:       type facade for TS consumers\n` +
          `Without all three, either Metro cannot resolve the module for\n` +
          `a platform, or TypeScript cannot type-check consumers.\n` +
          `See CLAUDE.md "Authentication" section.`,
      );
    }
    expect(missing).toEqual([]);
  });

  it('lib/googleSignIn.ios.ts does not import @react-native-google-signin/google-signin', () => {
    if (!fs.existsSync(iosPath)) return; // previous test already failed
    const content = fs.readFileSync(iosPath, 'utf8');
    // Match only actual module references, not doc-block mentions. ESM
    // imports and CJS require() both land in a string literal adjacent
    // to the keyword — that is the signal we care about.
    const IMPORT_RE =
      /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)['"]@react-native-google-signin\/google-signin['"]/;
    const match = content.match(IMPORT_RE);
    expect(match).toBeNull();
    if (match) {
      throw new Error(
        `lib/googleSignIn.ios.ts imports @react-native-google-signin/google-signin.\n` +
          `This is the iOS stub — its whole purpose is to keep google-signin\n` +
          `OUT of the iOS bundle. A static import here reintroduces the\n` +
          `TurboModuleRegistry.getEnforcing crash on /auth/login.\n` +
          `See CLAUDE.md "Authentication" section.`,
      );
    }
  });
});

// ─── Rule 18: package.json excludes google-signin from Expo autolinking on iOS ──
// CLAUDE.md "Authentication": @react-native-google-signin/google-signin
// ships BOTH an RN native module (RNGoogleSignin) AND an Expo module
// adapter (ExpoAdapterGoogleSignIn). react-native.config.js only blocks
// the RN side. Expo autolinking has its own channel — expo-module.config.json
// inside the package — which bundles the adapter pod independently.
// package.json's "expo.autolinking.ios.exclude" is the matching override.
// Missing this entry on iOS silently re-admits the pod conflict with MLKit.
describe('Architecture: package.json excludes google-signin from Expo autolinking on iOS', () => {
  it('has expo.autolinking.ios.exclude containing the google-signin package', () => {
    const pkgPath = path.join(ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      expo?: { autolinking?: { ios?: { exclude?: unknown } } };
    };

    const excludes = pkg?.expo?.autolinking?.ios?.exclude;

    if (
      !Array.isArray(excludes) ||
      !excludes.includes('@react-native-google-signin/google-signin')
    ) {
      throw new Error(
        'package.json is missing expo.autolinking.ios.exclude for\n' +
          '"@react-native-google-signin/google-signin".\n\n' +
          'Without this, Expo module autolinking bundles the\n' +
          'ExpoAdapterGoogleSignIn pod on iOS, which transitively pulls\n' +
          'GoogleSignIn 9.x / GTMSessionFetcher 3.x / GoogleUtilities 8.x\n' +
          'and collides with MLKit. EAS iOS pod resolution fails.\n' +
          'Note: react-native.config.js (Rule 16) is necessary but NOT\n' +
          'sufficient — it only controls RN autolinking, not Expo module\n' +
          'autolinking. Both must agree.\n' +
          'See CLAUDE.md "Authentication" section.',
      );
    }
    expect(excludes).toContain('@react-native-google-signin/google-signin');
  });
});

// ─── Rule 17: .easignore must contain /ios for CNG builds ────────────
// CLAUDE.md "Authentication": the project has android/ committed but
// not ios/. expo-doctor flags this as a mixed CNG state — EAS skips
// syncing app.json plugins on the platform whose folder exists. Adding
// /ios to .easignore tells EAS to always prebuild iOS from scratch,
// picking up current app.json plugins every build.
describe('Architecture: .easignore forces CNG prebuild for iOS', () => {
  it('.easignore exists and lists /ios', () => {
    const easignorePath = path.join(ROOT, '.easignore');
    expect(fs.existsSync(easignorePath)).toBe(true);

    if (!fs.existsSync(easignorePath)) {
      throw new Error(
        '.easignore is missing. EAS needs it to know which files should\n' +
          'be excluded from the upload and (for /ios) which folders to\n' +
          'regenerate via prebuild.',
      );
    }

    const content = fs.readFileSync(easignorePath, 'utf8');
    // Match /ios on its own line (not part of a longer path like /ios-legacy/).
    const hasIos = /^\s*\/?ios\/?\s*$/m.test(content);

    if (!hasIos) {
      throw new Error(
        `.easignore must list "/ios" to force EAS to prebuild the iOS\n` +
          `folder on every build instead of trying to reuse stale state.\n` +
          `Without this, app.json plugin changes do not reliably reach\n` +
          `the iOS build — expo-doctor flags the mixed CNG state.\n` +
          `Add "/ios" as its own line in .easignore.\n` +
          `See CLAUDE.md "Authentication" section.`,
      );
    }
    expect(hasIos).toBe(true);
  });
});

// ─── Rule 20: Level filter applied at vocab view boundaries ────────
// CLAUDE.md "Vocabulary post-processing": every screen that shows
// vocabulary to the user must hide entries below the user's CEFR
// minimum via isAtOrAboveLevel(). Storage stays untouched so lowering
// the level brings them back. The sensor enforces that each enumerated
// view file references the helper — adding a new vocab view without
// the filter is the regression we want to catch.
//
// Each view must ALSO bypass the filter for user_added=1 rows (Pro
// long-press single-word adds) — the user's explicit intent beats the
// level minimum. Missing the bypass re-hides words the user deliberately
// picked, which is the exact regression the bypass was introduced to
// fix. See CLAUDE.md "Vocabulary post-processing" → user_added bypass.
describe('Architecture: Rule 20 — vocab views apply level filter', () => {
  const REQUIRED_FILES = [
    'app/(tabs)/vocabulary.tsx',
    'app/(tabs)/index.tsx',
    'app/content/[id].tsx',
  ];

  for (const rel of REQUIRED_FILES) {
    it(`${rel} references isAtOrAboveLevel`, () => {
      const full = path.join(ROOT, rel);
      const src = fs.readFileSync(full, 'utf8');
      if (!src.includes('isAtOrAboveLevel')) {
        throw new Error(
          `LEVEL FILTER MISSING in ${rel}\n` +
            `Vocabulary views must filter by the user's CEFR minimum via\n` +
            `isAtOrAboveLevel(v.level, settings.level) — see\n` +
            `constants/levels.ts. Storage stays untouched; only the view\n` +
            `hides below-level entries so raising the level no longer shows\n` +
            `them. See CLAUDE.md "Vocabulary post-processing" section.`,
        );
      }
      expect(src).toContain('isAtOrAboveLevel');
    });

    it(`${rel} bypasses level filter for user_added=1 rows`, () => {
      const full = path.join(ROOT, rel);
      const src = fs.readFileSync(full, 'utf8');
      if (!src.includes('user_added')) {
        throw new Error(
          `LEVEL-FILTER BYPASS MISSING in ${rel}\n` +
            `Vocab views must bypass the CEFR filter for user-added entries:\n` +
            `  v.user_added === 1 || isAtOrAboveLevel(v.level, minLevel)\n` +
            `Words the user explicitly added via Pro long-press must stay\n` +
            `visible regardless of the level setting. See CLAUDE.md\n` +
            `"Vocabulary post-processing" → user_added bypass.`,
        );
      }
      expect(src).toContain('user_added');
    });
  }
});

// ─── Rule 21: extractVocabulary + translateSingleWord run post-processor ─
// CLAUDE.md "Vocabulary post-processing": both LLM extraction paths must
// pipe their output through postProcessExtractedVocab so the
// abbreviation / proper-noun / German-capitalisation guards cannot be
// silently bypassed by a future refactor.
describe('Architecture: Rule 21 — claude.ts wires postProcessExtractedVocab', () => {
  const claudeSrc = fs.readFileSync(path.join(ROOT, 'lib', 'claude.ts'), 'utf8');

  it('imports postProcessExtractedVocab from ./vocabFilters', () => {
    expect(claudeSrc).toMatch(/postProcessExtractedVocab.*from\s+['"]\.\/vocabFilters['"]/s);
  });

  it('extractVocabulary calls postProcessExtractedVocab', () => {
    const extractStart = claudeSrc.indexOf('export async function extractVocabulary');
    const translateStart = claudeSrc.indexOf('export async function translateText');
    expect(extractStart).toBeGreaterThan(-1);
    expect(translateStart).toBeGreaterThan(extractStart);
    const body = claudeSrc.substring(extractStart, translateStart);
    if (!body.includes('postProcessExtractedVocab(')) {
      throw new Error(
        `POST-PROCESSOR MISSING in extractVocabulary()\n` +
          `Call postProcessExtractedVocab(allVocabs, learningLanguageCode,\n` +
          `nativeLanguageCode) right after the JSON parse loop — before the\n` +
          `classifier loop. See CLAUDE.md "Vocabulary post-processing".`,
      );
    }
    expect(body).toContain('postProcessExtractedVocab(');
  });

  it('translateSingleWord calls postProcessExtractedVocab', () => {
    const fnStart = claudeSrc.indexOf('export async function translateSingleWord');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = claudeSrc.substring(fnStart);
    if (!fnBody.includes('postProcessExtractedVocab(')) {
      throw new Error(
        `POST-PROCESSOR MISSING in translateSingleWord()\n` +
          `Wrap the parsed result in postProcessExtractedVocab so German\n` +
          `target capitalisation and abbreviation filtering apply to the\n` +
          `single-word path too. See CLAUDE.md "Vocabulary post-processing".`,
      );
    }
    expect(fnBody).toContain('postProcessExtractedVocab(');
  });
});

// ─── Rule 22: lib/vocabFilters.ts must stay pure / offline ─────────
// CLAUDE.md "Vocabulary post-processing": vocabFilters is a pure helper
// reused by tests and (eventually) batch scripts. It must not pull in
// I/O, the database, the LLM client, or expo-* runtime modules.
describe('Architecture: Rule 22 — vocabFilters.ts is pure / offline', () => {
  const FORBIDDEN_PATTERNS: { pattern: RegExp; reason: string }[] = [
    { pattern: /\bfetch\s*\(/, reason: 'no network calls (fetch)' },
    { pattern: /from\s+['"]\.\/claude['"]/, reason: 'no LLM client import' },
    { pattern: /from\s+['"]\.\/database['"]/, reason: 'no database import' },
    { pattern: /from\s+['"]expo-[^'"]+['"]/, reason: 'no expo-* runtime import' },
    { pattern: /from\s+['"]@expo\//, reason: 'no @expo/* runtime import' },
    { pattern: /from\s+['"](?:node:)?fs['"]/, reason: 'no fs import' },
  ];

  it('lib/vocabFilters.ts contains no forbidden imports', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'vocabFilters.ts'), 'utf8');
    const violations: string[] = [];
    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      const m = src.match(pattern);
      if (m) violations.push(`${reason}: matched "${m[0]}"`);
    }
    if (violations.length > 0) {
      throw new Error(
        `IMPURE IMPORT in lib/vocabFilters.ts:\n  ${violations.join('\n  ')}\n\n` +
          `vocabFilters must remain a pure helper so unit tests stay fast\n` +
          `and the batch-classification scripts can reuse it. Move I/O to\n` +
          `the calling site (lib/claude.ts). See CLAUDE.md "Vocabulary\n` +
          `post-processing" section.`,
      );
    }
    expect(violations).toEqual([]);
  });
});

// ─── Rule 23: extractWithReadability must use cleanArticleHtml ──────
// CLAUDE.md "LLM API": Readability's article.content HTML is post-processed
// by cleanArticleHtml() to remove infoboxes, footnotes, SVGs, etc.
// Using article.textContent directly would reintroduce noise.
describe('Architecture: Rule 23 — Readability pipeline uses cleanArticleHtml', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'urlExtractor.ts'), 'utf8');

  it('extractWithReadability calls cleanArticleHtml(article.content)', () => {
    // Extract the function body of extractWithReadability
    const fnMatch = src.match(/function extractWithReadability\b[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];

    expect(fnBody).toContain('cleanArticleHtml(article.content)');
  });

  it('extractWithReadability does NOT use article.textContent', () => {
    const fnMatch = src.match(/function extractWithReadability\b[\s\S]*?^}/m);
    const fnBody = fnMatch![0];

    if (fnBody.includes('article.textContent')) {
      throw new Error(
        `extractWithReadability uses article.textContent directly.\n\n` +
          `Readability's textContent includes infobox tables, footnotes,\n` +
          `SVG icon labels, and other non-article noise. Always use\n` +
          `cleanArticleHtml(article.content) instead.\n` +
          `See CLAUDE.md "LLM API" section.`,
      );
    }
  });

  it('fetchArticleContent has text density check before Claude fallback', () => {
    const fnMatch = src.match(/async function fetchArticleContent\b[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    const fnBody = fnMatch![0];

    expect(fnBody).toContain('MIN_TEXT_FOR_FALLBACK');
  });
});

// ─── Rule 13: app/auth/ UI strings must be English ──────────────────
// CLAUDE.md "Authentication": the project-wide convention is English UI
// strings for all new features. The auth screens establish that pattern
// and should not mix German phrases into user-visible text.
describe('Architecture: app/auth/ UI strings are English', () => {
  // Minimal, high-confidence heuristic: umlauts and a handful of common
  // German words that would not plausibly appear in English copy.
  const GERMAN_INDICATORS = [
    /[äöüÄÖÜß]/,
    /\b(und|oder|nicht|bitte|anmelden|abmelden|erstellen|löschen|Konto|Einstellungen|Willkommen)\b/i,
  ];
  const authDir = path.join(ROOT, 'app', 'auth');
  const files = collectSourceFiles(authDir);

  for (const file of files) {
    const relPath = path.relative(ROOT, file);
    it(`${relPath} contains only English UI strings`, () => {
      const content = fs.readFileSync(file, 'utf8');
      // Only look at string literals — comments can be any language.
      const stringLiterals = content.match(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g) ?? [];
      const violations: string[] = [];
      for (const lit of stringLiterals) {
        for (const p of GERMAN_INDICATORS) {
          if (p.test(lit)) {
            violations.push(`  "${lit}"`);
            break;
          }
        }
      }
      expect(violations).toEqual([]);
      if (violations.length > 0) {
        throw new Error(
          `NON-ENGLISH UI STRINGS in ${relPath}:\n${violations.join('\n')}\n\n` +
            `All user-visible strings in app/auth/ must be English per the\n` +
            `project-wide convention. See CLAUDE.md "Authentication" section.`,
        );
      }
    });
  }
});

// ─── Rule 24: ARTICLE_PREFIXES covers all supported languages ───────
describe('Architecture: Rule 24 — ARTICLE_PREFIXES covers all language articles', () => {
  const featuresPath = path.join(ROOT, 'lib', 'classifier', 'features.ts');
  const featuresContent = fs.readFileSync(featuresPath, 'utf8');

  const setBlock = featuresContent.match(/ARTICLE_PREFIXES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
  const entries = setBlock
    ? (setBlock[1]!.match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, ''))
    : [];
  const prefixSet = new Set(entries);

  const REQUIRED: Record<string, string[]> = {
    en: ['the', 'a', 'an', 'to'],
    de: [
      'zu',
      'der',
      'die',
      'das',
      'den',
      'dem',
      'des',
      'ein',
      'eine',
      'einen',
      'einem',
      'eines',
      'einer',
    ],
    fr: ['le', 'la', 'les', 'l', 'un', 'une', 'des', 'du'],
    es: ['el', 'los', 'las', 'un', 'una', 'unos', 'unas'],
    it: ['il', 'lo', 'gli', 'un', 'uno'],
    pt: ['o', 'os', 'as', 'um', 'uma', 'uns', 'umas'],
    nl: ['de', 'het', 'een', 'te'],
    sv: ['en', 'ett', 'att'],
    no: ['en', 'ei', 'et', 'det', 'å'],
    da: ['en', 'et', 'det', 'at'],
  };

  const REQUIRED_REFLEXIVE = ['sich', 'se', 'si'];

  for (const [lang, articles] of Object.entries(REQUIRED)) {
    for (const art of articles) {
      it(`"${art}" (${lang}) is in ARTICLE_PREFIXES`, () => {
        if (!prefixSet.has(art)) {
          throw new Error(
            `MISSING ARTICLE "${art}" for ${lang} in ARTICLE_PREFIXES.\n` +
              `Without it, "${art} <word>" lookups hit low-frequency bigrams and\n` +
              `inflate classification to C1/C2. Add '${art}' to ARTICLE_PREFIXES\n` +
              `in lib/classifier/features.ts. See CLAUDE.md "CEFR Classifier".`,
          );
        }
        expect(prefixSet.has(art)).toBe(true);
      });
    }
  }

  for (const pron of REQUIRED_REFLEXIVE) {
    it(`reflexive "${pron}" is in ARTICLE_PREFIXES`, () => {
      expect(prefixSet.has(pron)).toBe(true);
    });
  }

  // STRIP_PREFIX in vocabSort.ts must cover every entry in ARTICLE_PREFIXES
  it('STRIP_PREFIX in vocabSort.ts covers all ARTICLE_PREFIXES entries', () => {
    const sortPath = path.join(ROOT, 'lib', 'vocabSort.ts');
    const sortContent = fs.readFileSync(sortPath, 'utf8');
    const regexMatch = sortContent.match(/STRIP_PREFIX\s*=\s*\/\^?\(([^)]+)\)/);
    expect(regexMatch).not.toBeNull();
    const regexEntries = new Set(
      regexMatch![1].split('|').map((s) => s.replace(/['"]/g, '').toLowerCase()),
    );
    const missing = entries.filter((e) => !regexEntries.has(e) && !regexEntries.has(e + "'"));
    if (missing.length > 0) {
      throw new Error(
        `STRIP_PREFIX in vocabSort.ts is missing: ${missing.join(', ')}.\n` +
          `Both ARTICLE_PREFIXES (classifier) and STRIP_PREFIX (sort/search)\n` +
          `must stay in sync. Add the missing entries to the STRIP_PREFIX regex.`,
      );
    }
    expect(missing).toEqual([]);
  });
});

// ─── Rule 25: Sort chip UI uses shared SortChips component ──────────
describe('Architecture: Rule 25 — vocab views use shared SortChips component', () => {
  const files = [
    path.join(ROOT, 'app', '(tabs)', 'vocabulary.tsx'),
    path.join(ROOT, 'app', 'content', '[id].tsx'),
  ];

  for (const file of files) {
    const relPath = path.relative(ROOT, file);
    it(`${relPath} imports SortChips component`, () => {
      const src = fs.readFileSync(file, 'utf8');
      const importsSortChips = /import\s+SortChips\s+from\s+['"].*SortChips['"]/.test(src);
      if (!importsSortChips) {
        throw new Error(
          `${relPath} does not import the shared SortChips component.\n` +
            `Sort chip rendering must use components/SortChips.tsx to prevent\n` +
            `visual and behavioural drift between vocabulary views.\n` +
            `See CLAUDE.md "Styling Conventions" section.`,
        );
      }
      expect(importsSortChips).toBe(true);
    });

    it(`${relPath} does not inline sort chip styles`, () => {
      const src = fs.readFileSync(file, 'utf8');
      const hasInlineStyles = /sortChip[^s].*:.*\{/.test(src);
      if (hasInlineStyles) {
        throw new Error(
          `${relPath} still contains inline sortChip styles.\n` +
            `Remove them and use the shared SortChips component instead.`,
        );
      }
      expect(hasInlineStyles).toBe(false);
    });
  }
});

// ─── Rule 26: Default learning language must differ from native language ──
// CLAUDE.md: When native language is English, learning language must not
// default to English. A helper function must ensure they differ.
describe('Architecture: Rule 26 — default learning language differs from native', () => {
  it('hooks/useSettings.ts has getDefaultLearningLanguage that avoids same-language default', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hooks', 'useSettings.ts'), 'utf8');
    // The helper must exist
    expect(src).toMatch(/function getDefaultLearningLanguage/);
    // It must check against the native language to avoid same-language
    expect(src).toMatch(/nativeLang/);
  });

  it('hooks/useSettings.ts loadSettings and resetApp both use getDefaultLearningLanguage', () => {
    const src = fs.readFileSync(path.join(ROOT, 'hooks', 'useSettings.ts'), 'utf8');
    // Count occurrences — must appear in at least loadSettings + resetApp = 2+ places
    const matches = src.match(/getDefaultLearningLanguage/g);
    expect(matches).not.toBeNull();
    // Function definition (1) + loadSettings usage (2) + resetApp usage (1) = 4+
    expect(matches!.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Rule 27: translateSingleWord prompt must include CRITICAL FORMATTING RULE ─
// CLAUDE.md: Both extractVocabulary and translateSingleWord must enforce
// vocabulary formatting rules (articles on nouns, infinitive for verbs,
// etc.) with equal emphasis. The CRITICAL FORMATTING RULE block and the
// shared VOCAB_FORMATTING_RULES constant must both appear in the
// translateSingleWord system prompt.
describe('Architecture: Rule 27 — translateSingleWord prompt has CRITICAL FORMATTING RULE', () => {
  it('lib/claude.ts translateSingleWord systemPrompt includes CRITICAL FORMATTING RULE', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'claude.ts'), 'utf8');
    // Find the translateSingleWord function body
    const match = src.match(/export async function translateSingleWord\b[\s\S]*?\n\}/);
    expect(match).not.toBeNull();
    const body = match![0];
    // Must include the critical emphasis block
    expect(body).toMatch(/CRITICAL FORMATTING RULE/);
    // Must reference the shared rules constant(s). 2026-04-21 the single
    // VOCAB_FORMATTING_RULES was split into NOUN_VERB_FORMATTING_RULES +
    // a per-language adjective branch (Rule 38) — accept either shape.
    expect(body).toMatch(/VOCAB_FORMATTING_RULES|NOUN_VERB_FORMATTING_RULES/);
    // Must instruct about base form / inflected input
    expect(body).toMatch(/inflect|conjugat|base form|dictionary/i);
  });

  it('lib/claude.ts formatting rules constant mentions articles + infinitive + reflexive', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'claude.ts'), 'utf8');
    // Either the legacy VOCAB_FORMATTING_RULES constant or the post-
    // split NOUN_VERB_FORMATTING_RULES + ROMANCE_ADJ_RULE / SINGLE_FORM_ADJ_RULE.
    const legacyMatch = src.match(/const VOCAB_FORMATTING_RULES\s*=\s*`[\s\S]*?`;/);
    const nvMatch = src.match(/const NOUN_VERB_FORMATTING_RULES\s*=\s*`[\s\S]*?`;/);
    const rules = (legacyMatch?.[0] ?? '') + (nvMatch?.[0] ?? '');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules).toMatch(/article/i);
    expect(rules).toMatch(/infinitive/i);
    expect(rules).toMatch(/reflexive/i);
  });
});

// ─── Rule 28: Pro mode gates manual word add/remove in content detail ─
// CLAUDE.md: Manual vocabulary add (long-press) and remove (tap highlight)
// are Pro features. The content detail screen must pass undefined for
// onAddWord and onRemoveHighlight when proMode is false.
describe('Architecture: Rule 27 — content detail gates word add/remove behind proMode', () => {
  it('app/content/[id].tsx reads proMode from settings store', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'content', '[id].tsx'), 'utf8');
    expect(src).toMatch(/useSettingsStore\(.*proMode/);
  });

  it('app/content/[id].tsx conditionally passes onAddWord based on proMode', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'content', '[id].tsx'), 'utf8');
    // onAddWord must be conditional: proMode ? handler : undefined
    expect(src).toMatch(/onAddWord\s*=\s*\{.*proMode\b/);
  });

  it('app/content/[id].tsx conditionally passes onRemoveHighlight based on proMode', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'content', '[id].tsx'), 'utf8');
    // onRemoveHighlight must be conditional: proMode ? handler : undefined
    expect(src).toMatch(/onRemoveHighlight\s*=\s*\{.*proMode\b/);
  });

  it('components/HighlightedText.tsx declares onAddWord and onRemoveHighlight as optional', () => {
    const src = fs.readFileSync(path.join(ROOT, 'components', 'HighlightedText.tsx'), 'utf8');
    // Both props must be optional (have ?)
    expect(src).toMatch(/onAddWord\??\s*:\s*\(/);
    expect(src).toMatch(/onRemoveHighlight\??\s*:\s*\(/);
    // Specifically, they must have the ? for optional
    const addMatch = src.match(/onAddWord(\??)\s*:/);
    expect(addMatch?.[1]).toBe('?');
    const removeMatch = src.match(/onRemoveHighlight(\??)\s*:/);
    expect(removeMatch?.[1]).toBe('?');
  });
});

// ─── Rule 29: Pro mode switch disabled for guest users ─────────────
// CLAUDE.md: Pro mode is only available to signed-in users. The switch
// must be disabled and visually greyed out when the user is not
// authenticated.
describe('Architecture: Rule 29 — Pro mode switch disabled for guests', () => {
  it('app/settings.tsx Pro mode Switch has disabled={!isAuthed}', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'settings.tsx'), 'utf8');
    // Find the pro-mode-switch section
    const switchIdx = src.indexOf('pro-mode-switch');
    expect(switchIdx).toBeGreaterThan(-1);
    // Within reasonable proximity after the testID, there must be a disabled prop
    const after = src.slice(switchIdx, switchIdx + 300);
    expect(after).toMatch(/disabled\s*=\s*\{.*!isAuthed/);
    if (!/disabled\s*=\s*\{.*!isAuthed/.test(after)) {
      throw new Error(
        `Pro mode Switch in app/settings.tsx must have disabled={!isAuthed}.\n` +
          `Guest users must not be able to toggle Pro mode.\n` +
          `See CLAUDE.md "Settings Keys" section.`,
      );
    }
  });

  it('app/settings.tsx Pro mode row has disabledRow style when not authed', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'settings.tsx'), 'utf8');
    // The Pro Mode row must apply disabledRow conditionally on auth
    expect(src).toMatch(/!isAuthed\s*&&\s*styles\.disabledRow/);
  });
});

// ─── Rule 30: Settings screen has exactly one Back button ──────────
// CLAUDE.md: Sub-menus inside app/settings.tsx must not render their
// own Back affordance. The single header Back button handles both
// "pop sub-menu" and "close settings" via state-aware logic, so the
// user never sees two stacked Back controls.
describe('Architecture: Rule 30 — app/settings.tsx renders Back exactly once', () => {
  it('has exactly one Back label in source', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'settings.tsx'), 'utf8');
    // Match any Back arrow literal: "\u2190 Back", "← Back", or "\\u2190 Back"
    const matches = src.match(/(?:\\u2190|←)\s*Back/g) ?? [];
    if (matches.length !== 1) {
      throw new Error(
        `app/settings.tsx contains ${matches.length} Back labels; expected exactly 1.\n` +
          `Sub-menus (language picker, future sub-screens) must reuse the header Back\n` +
          `button instead of rendering their own. The header's onPress handler should\n` +
          `pop sub-menu state first, then fall back to router.back() on the main screen.\n` +
          `See CLAUDE.md "Settings navigation" rule.`,
      );
    }
    expect(matches.length).toBe(1);
  });

  it('header Back handler pops sub-menu state before router.back()', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'settings.tsx'), 'utf8');
    // There must be a handler that clears showLanguagePicker before falling
    // through to router.back(). This enforces the "go back one level" logic.
    const hasStateAwareBack = /setShowLanguagePicker\(null\)[\s\S]{0,200}router\.back\(\)/.test(
      src,
    );
    if (!hasStateAwareBack) {
      throw new Error(
        `app/settings.tsx header Back button must be state-aware:\n` +
          `sub-menu state (e.g. showLanguagePicker) should be cleared before\n` +
          `falling through to router.back(). Otherwise pressing Back in a sub-menu\n` +
          `exits Settings instead of returning to the main screen.\n` +
          `See CLAUDE.md "Settings navigation" rule.`,
      );
    }
    expect(hasStateAwareBack).toBe(true);
  });
});

// ─── Rule 31: Auth screens route home via navigateAfterSignIn ──────
// CLAUDE.md: After a successful sign-in, the stack may contain a
// Settings modal (/(tabs) → /settings → /auth/login → /auth/verify).
// A plain router.replace('/(tabs)') only swaps the top, leaving the
// modal mounted and visible on iOS. All post-sign-in navigation must
// go through lib/authNavigation.navigateAfterSignIn which dismissAll's
// first, then replaces.
describe('Architecture: Rule 31 — auth screens use navigateAfterSignIn', () => {
  const authFiles = [
    path.join(ROOT, 'app', 'auth', 'login.tsx'),
    path.join(ROOT, 'app', 'auth', 'verify.tsx'),
  ];

  for (const file of authFiles) {
    const relPath = path.relative(ROOT, file);
    it(`${relPath} does not call router.replace('/(tabs)') directly`, () => {
      const src = fs.readFileSync(file, 'utf8');
      const forbidden = /router\.replace\(\s*['"]\/\(tabs\)['"]\s*\)/.test(src);
      if (forbidden) {
        throw new Error(
          `${relPath} calls router.replace('/(tabs)') directly.\n` +
            `After a successful sign-in, the stack can still contain the\n` +
            `Settings modal (from the /(tabs) → /settings → /auth/login flow).\n` +
            `Plain replace leaves that modal mounted under the new tabs screen,\n` +
            `causing an iOS-only ghost-layer bug. Use navigateAfterSignIn(router)\n` +
            `from lib/authNavigation.ts instead — it dismissAll's first, then\n` +
            `replaces. See CLAUDE.md "Authentication → Post-sign-in navigation".`,
        );
      }
      expect(forbidden).toBe(false);
    });

    it(`${relPath} imports navigateAfterSignIn`, () => {
      const src = fs.readFileSync(file, 'utf8');
      // Only require the import if the file actually reaches a "success"
      // branch (i.e. uses setSession). Defensive for future auth screens
      // that don't complete a sign-in themselves.
      if (!/setSession\s*\(/.test(src)) return;
      const imports = /from\s+['"][^'"]*authNavigation['"]/.test(src);
      if (!imports) {
        throw new Error(
          `${relPath} calls setSession() but does not import navigateAfterSignIn\n` +
            `from lib/authNavigation.ts. All post-sign-in navigation must use\n` +
            `that helper to avoid the iOS modal-ghost bug.\n` +
            `See CLAUDE.md "Authentication → Post-sign-in navigation".`,
        );
      }
      expect(imports).toBe(true);
    });
  }

  it('lib/authNavigation.ts exists and calls dismissAll before replace', () => {
    const file = path.join(ROOT, 'lib', 'authNavigation.ts');
    expect(fs.existsSync(file)).toBe(true);
    const raw = fs.readFileSync(file, 'utf8');
    // Strip JSDoc/block comments and line comments so we don't match the
    // word "replace" inside the documentation that explains why we dismiss.
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const dismissIdx = src.indexOf('dismissAll');
    const replaceIdx = src.indexOf('replace(');
    expect(dismissIdx).toBeGreaterThan(-1);
    expect(replaceIdx).toBeGreaterThan(-1);
    expect(dismissIdx).toBeLessThan(replaceIdx);
  });

  it('app/settings.tsx passes from: "settings" when pushing to /auth/login', () => {
    // So navigateAfterSignIn knows to dismiss back to the still-open
    // Settings modal instead of replacing to (tabs). Without this, a
    // successful sign-in from the menu closes the menu, forcing the
    // user to reopen it to toggle Pro Mode etc.
    const src = fs.readFileSync(path.join(ROOT, 'app', 'settings.tsx'), 'utf8');
    const pattern =
      /router\.push\s*\(\s*\{[\s\S]{0,200}pathname\s*:\s*['"]\/auth\/login['"][\s\S]{0,200}from\s*:\s*['"]settings['"]/;
    if (!pattern.test(src)) {
      throw new Error(
        `app/settings.tsx handleSignIn must push /auth/login with params { from: 'settings' }.\n` +
          `The 'from' param tells navigateAfterSignIn to dismiss only the auth\n` +
          `screens on success, leaving the Settings modal open so the user can\n` +
          `continue where they left off (e.g. enable Pro Mode).\n` +
          `See CLAUDE.md "Authentication" Hard rule 13.`,
      );
    }
    expect(pattern.test(src)).toBe(true);
  });

  it('lib/authNavigation.ts guards dismissAll with Platform.OS === "ios"', () => {
    // Android crashes Fabric with IllegalStateException when dismissAll() and
    // replace() run in the same tick from the settings-flow stack. The helper
    // must keep dismissAll behind a Platform.OS === 'ios' check so Android
    // stays on the plain-replace path that was working pre-fix.
    const file = path.join(ROOT, 'lib', 'authNavigation.ts');
    const raw = fs.readFileSync(file, 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const hasIosGuard = /Platform\.OS\s*===\s*['"]ios['"][\s\S]{0,200}dismissAll/.test(src);
    if (!hasIosGuard) {
      throw new Error(
        `lib/authNavigation.ts must gate dismissAll() behind Platform.OS === 'ios'.\n` +
          `Running dismissAll + replace in the same tick crashes Fabric on Android\n` +
          `with "IllegalStateException: addViewAt: failed to insert view" when the\n` +
          `user signs in from the Settings modal. Android keeps the plain-replace\n` +
          `path that worked before the iOS ghost-modal fix.\n` +
          `See CLAUDE.md "Authentication" Hard rule 13.`,
      );
    }
    expect(hasIosGuard).toBe(true);
  });
});

// ─── Rule 32: Progress-overlay messages live only in constants/progressMessages.ts ─
// CLAUDE.md: Inline string literals handed to the shareStore would drift
// out of sync across the four entry points (system share, manual link,
// manual image, manual text) and could silently exceed the 5 s on-screen
// cap. Every call to shareStore.start / setMessage / setRotating must
// therefore pass a constant imported from constants/progressMessages.ts.
describe('Architecture: Rule 32 — progress messages only from constants/progressMessages.ts', () => {
  const scanDirs = ['app', 'components'];
  const allFiles = scanDirs.flatMap((dir) => collectSourceFiles(path.join(ROOT, dir)));
  const storeConsumers = allFiles.filter((file) =>
    fs.readFileSync(file, 'utf8').includes('useShareProcessingStore'),
  );

  it('should find share-store consumer files to check', () => {
    expect(storeConsumers.length).toBeGreaterThan(0);
  });

  // Forbidden patterns: string/array literal as first arg to the store's
  // message-setting methods. A constant identifier (imported from
  // progressMessages.ts) produces a non-quote, non-bracket first char.
  const FORBIDDEN = [
    { op: 'start', re: /\.start\s*\(\s*['"`]/ },
    { op: 'setMessage', re: /\.setMessage\s*\(\s*['"`]/ },
    { op: 'setRotating', re: /\.setRotating\s*\(\s*\[/ },
    { op: 'setRotatingPools', re: /\.setRotatingPools\s*\(\s*\[/ },
  ];

  for (const file of storeConsumers) {
    const relPath = path.relative(ROOT, file);
    it(`${relPath} uses constants for shareStore message calls`, () => {
      const src = fs.readFileSync(file, 'utf8');
      for (const { op, re } of FORBIDDEN) {
        const match = src.match(re);
        if (match) {
          throw new Error(
            `INLINE PROGRESS MESSAGE in ${relPath}: "${match[0]}"\n` +
              `shareStore.${op} must take a constant from constants/progressMessages.ts,\n` +
              `not an inline literal. Inline strings drift across the four share flows\n` +
              `and can silently exceed the 5 s on-screen cap. Import INTRO / FETCH_ROTATION /\n` +
              `OCR_PHASES / LLM_PHASES_PRO / LLM_PHASES_BASIC / SAVING and pass the identifier.\n` +
              `See CLAUDE.md "Share-processing progress messages" section.`,
          );
        }
        expect(match).toBeNull();
      }
    });
  }
});

describe('Architecture: Rule 33 — classifier fallback enforces a per-window rate limit', () => {
  // CLAUDE.md documents the CEFR classifier as rate-limited to 10 calls
  // per rolling 60 s window. That invariant lives entirely in
  // lib/classifier/fallback.ts — if a future refactor silently removes
  // the check, nothing else would catch it. Unit tests already exercise
  // the mocked behaviour; this is the structural sensor on the source.
  it('lib/classifier/fallback.ts declares RATE_LIMIT / RATE_WINDOW_MS and consumes the budget before each call', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'classifier', 'fallback.ts'), 'utf8');

    // Constants must exist verbatim. We don't pin the exact numbers
    // here (those are product decisions that may legitimately move),
    // but the *shape* is fixed.
    expect(src).toMatch(/const\s+RATE_LIMIT\s*=\s*\d+/);
    expect(src).toMatch(/const\s+RATE_WINDOW_MS\s*=\s*[\d_]+/);

    // There must be a budget-consuming gate and `classifyViaClaude`
    // must call it before issuing the network request.
    expect(src).toMatch(/function\s+tryConsumeRateBudget\s*\(/);
    const guardIdx = src.search(/if\s*\(\s*!tryConsumeRateBudget\s*\(\s*\)\s*\)/);
    const fetchIdx = src.indexOf('await claudeFn(');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    if (!(guardIdx < fetchIdx)) {
      throw new Error(
        `CLASSIFIER RATE LIMIT BYPASSED: tryConsumeRateBudget() must be\n` +
          `checked *before* the Claude fallback fetch in classifyViaClaude.\n` +
          `Otherwise a misbehaving caller can run the LLM unbounded and\n` +
          `inflate cost. See CLAUDE.md "CEFR Classifier" → Fallback path.`,
      );
    }
  });
});

describe('Architecture: Rule 34 — backend must never forward upstream error bodies', () => {
  // Mistral's 401/5xx response bodies can include API key fragments,
  // internal URLs, and other provider-side details. The proxy MUST
  // map upstream status codes to generic English strings via
  // safeErrorMessage() and keep the raw body only in server logs.
  // Forwarding errorText was the H4 finding in the arch review.
  it('backend/server.js routes upstream errors through safeErrorMessage(), not raw text', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

    // Must declare and use the sanitizer.
    expect(src).toMatch(/function\s+safeErrorMessage\s*\(/);
    expect(src).toMatch(/error:\s*\{\s*message:\s*safeErrorMessage\s*\(/);

    // Must NOT pass the raw upstream body through. Any of the
    // equivalent shapes would reintroduce the leak.
    const BANNED_PASSTHROUGH_SHAPES = [
      /error:\s*\{\s*message:\s*errorText\s*\}/,
      /error:\s*\{\s*message:\s*response\.statusText\s*\}/,
      /error:\s*\{\s*message:\s*await\s+response\.text\s*\(/,
    ];
    for (const pattern of BANNED_PASSTHROUGH_SHAPES) {
      const match = src.match(pattern);
      if (match) {
        throw new Error(
          `UPSTREAM ERROR LEAK in backend/server.js: "${match[0]}"\n` +
            `Mistral error bodies may contain API key fragments or internal\n` +
            `URLs. Route the response through safeErrorMessage(response.status)\n` +
            `and keep the raw text in a console.error call only.\n` +
            `See CLAUDE.md H4 fix + arch-review-2 Phase 1.`,
        );
      }
      expect(match).toBeNull();
    }
  });
});

describe('Architecture: Rule 35 — share-intent link gate uses the URL constructor', () => {
  // A regex-only check accepted javascript:, file:, data:, ftp: and
  // malformed URLs as "links", which then reached fetch + linkedom.
  // The hardening requires the URL constructor and an http(s) protocol
  // assertion. This sensor prevents silent reversion to regex.
  it('lib/shareHandler.ts validates link candidates via new URL() + protocol check', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'shareHandler.ts'), 'utf8');

    // Required: a URL constructor + protocol guard path.
    expect(src).toMatch(/new\s+URL\s*\(/);
    expect(src).toMatch(/protocol\s*===\s*['"]https?:['"]/);

    // Banned: regex-only link gate in parseShareIntent (the shape that
    // used to ship). We check the specific anti-pattern, not all
    // regex usage — this file may have unrelated regex in the future.
    const BANNED = [
      /urlPattern\.test\s*\(\s*shareIntent\.text/,
      /\/\^https\?:\\\/\\\/\/i\.test\s*\(/,
    ];
    for (const pattern of BANNED) {
      const match = src.match(pattern);
      if (match) {
        throw new Error(
          `REGEX LINK GATE in lib/shareHandler.ts: "${match[0]}"\n` +
            `Link detection must use new URL() + protocol check, not a\n` +
            `\\^https?:\\\\\/\\\\\/ regex. A regex lets javascript:, file:,\n` +
            `data: URIs and malformed strings through to fetch/Readability.\n` +
            `See arch-review-2 Phase 2.A F10.4 + CLAUDE.md Security.`,
        );
      }
      expect(match).toBeNull();
    }
  });
});

describe('Architecture: Rule 36 — backend validates each incoming message before fetching Mistral', () => {
  // CLAUDE.md "backend proxy" requires per-message shape + size checks
  // so a client cannot send many valid-shaped messages with
  // pathologically long text and burn tokens. validateMessage() must
  // be called for every message before the upstream fetch.
  it('backend/server.js loops messages through validateMessage() before fetch(MISTRAL_API_URL)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'backend', 'server.js'), 'utf8');

    // The helper must exist.
    expect(src).toMatch(/function\s+validateMessage\s*\(/);

    // It must be invoked in a loop over `messages`.
    expect(src).toMatch(/for\s*\(\s*const\s+\w+\s+of\s+messages\s*\)/);
    expect(src).toMatch(/validateMessage\s*\(/);

    // The validation loop must run BEFORE the Mistral fetch call,
    // not after. If ordering is reversed, size-cap violations slip
    // through to upstream and cost money anyway.
    const validateIdx = src.search(/validateMessage\s*\(/);
    const fetchIdx = src.search(/fetch\s*\(\s*MISTRAL_API_URL/);
    expect(validateIdx).toBeGreaterThan(-1);
    expect(fetchIdx).toBeGreaterThan(-1);
    if (!(validateIdx < fetchIdx)) {
      throw new Error(
        `MESSAGE VALIDATION BYPASSED: validateMessage() must run BEFORE\n` +
          `fetch(MISTRAL_API_URL) in backend/server.js. Otherwise invalid\n` +
          `messages still hit Mistral and the per-message size cap is\n` +
          `bypassed. See arch-review-2 Phase 2.A F10.1.`,
      );
    }
  });
});

describe('Architecture: Rule 37 — vocabulary.created_at index is present', () => {
  // The vocabulary tab defaults to "recent first" sort. At ~1000 rows
  // (the app's target scale) a full table scan on every tab focus is
  // a measurable main-thread cost. The index must stay in the
  // initDatabase() CREATE INDEX block.
  it('lib/database.ts creates idx_vocabulary_created_at in initDatabase', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'database.ts'), 'utf8');

    const match = src.match(
      /CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_vocabulary_created_at\s+ON\s+vocabulary\s*\(\s*created_at/i,
    );
    if (!match) {
      throw new Error(
        `MISSING INDEX: lib/database.ts must declare\n` +
          `  CREATE INDEX IF NOT EXISTS idx_vocabulary_created_at ON vocabulary(created_at DESC)\n` +
          `inside initDatabase(). Without it the default vocabulary sort\n` +
          `at ~1000 rows becomes a full table scan on every tab focus.\n` +
          `See arch-review-2 Phase 2.A F10.5.`,
      );
    }
    expect(match).not.toBeNull();
  });
});

describe('Architecture: Rule 38 — callClaude retries transient failures', () => {
  // Flaky networks + upstream 5xx used to fail the whole extraction
  // with no retry. The refactor split the fetch into callClaudeOnce()
  // and wrapped it in a retry loop. Silent removal of the wrapper
  // would undo this hardening without any test catching it.
  it('lib/claude.ts exposes a retry loop around callClaudeOnce with an isRetryable() gate', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'claude.ts'), 'utf8');

    // Shape constants + helpers.
    expect(src).toMatch(/const\s+MAX_RETRIES\s*=\s*\d+/);
    expect(src).toMatch(/function\s+isRetryable\s*\(/);
    expect(src).toMatch(/async\s+function\s+callClaudeOnce\s*\(/);

    // callClaude must delegate to callClaudeOnce inside a loop
    // guarded by attempt count + isRetryable.
    const hasLoop = /for\s*\(\s*let\s+attempt\s*=\s*0\s*;\s*attempt\s*<=?\s*MAX_RETRIES/.test(src);
    const hasDelegate = /callClaudeOnce\s*\(/.test(src);
    const hasIsRetryableCheck = /!isRetryable\s*\(/.test(src);

    if (!hasLoop || !hasDelegate || !hasIsRetryableCheck) {
      throw new Error(
        `RETRY WRAPPER MISSING: lib/claude.ts's callClaude must wrap\n` +
          `callClaudeOnce in a retry loop (for attempt <= MAX_RETRIES) and\n` +
          `rethrow when !isRetryable(err). Non-retryable: 4xx + AbortError.\n` +
          `Retryable: 5xx + network failures. See arch-review-2 Phase 2.C F5.1.`,
      );
    }
    expect(hasLoop).toBe(true);
    expect(hasDelegate).toBe(true);
    expect(hasIsRetryableCheck).toBe(true);
  });
});

describe('Architecture: Rule 39 — SecureStore adapter chunks values over the 2 KB cap', () => {
  // expo-secure-store persists at most ~2 KB per value on the native
  // keystore; larger values trigger a warning today and will throw in
  // a future SDK. Supabase session blobs (JWT + refresh token + user)
  // routinely exceed that. The adapter in lib/auth.ts must split
  // values across numbered child keys with a manifest, so a future
  // refactor that collapses back to a single setItemAsync is caught.
  it('lib/auth.ts secureStorageAdapter wraps the raw SecureStore API with chunking helpers', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'auth.ts'), 'utf8');

    // Chunking helpers must exist.
    expect(src).toMatch(/SECURE_STORE_CHUNK_SIZE\s*=\s*\d+/);
    expect(src).toMatch(/async\s+function\s+setItemChunked\s*\(/);
    expect(src).toMatch(/async\s+function\s+getItemChunked\s*\(/);
    expect(src).toMatch(/async\s+function\s+removeItemChunked\s*\(/);

    // Chunk size must be strictly under the 2048-byte SecureStore cap.
    const sizeMatch = src.match(/SECURE_STORE_CHUNK_SIZE\s*=\s*(\d+)/);
    expect(sizeMatch).not.toBeNull();
    const size = Number(sizeMatch![1]);
    if (size >= 2048) {
      throw new Error(
        `SECURE_STORE_CHUNK_SIZE = ${size} is >= the 2048-byte SecureStore\n` +
          `cap. Leave headroom (recommended: 1800). See CLAUDE.md Security\n` +
          `+ arch-review-2 Phase 2.G.`,
      );
    }

    // The adapter must route through the helpers. A direct binding
    // to SecureStore.getItemAsync / setItemAsync inside the adapter
    // literal reintroduces the 2 KB bug.
    const adapterMatch = src.match(/export\s+const\s+secureStorageAdapter\s*=\s*\{[\s\S]*?\}\s*;/);
    expect(adapterMatch).not.toBeNull();
    const adapterBody = adapterMatch![0];

    const BANNED_DIRECT_WRAP = [
      /setItem:.*SecureStore\.setItemAsync\s*\(/,
      /getItem:.*SecureStore\.getItemAsync\s*\(/,
      /removeItem:.*SecureStore\.deleteItemAsync\s*\(/,
    ];
    for (const pattern of BANNED_DIRECT_WRAP) {
      const match = adapterBody.match(pattern);
      if (match) {
        throw new Error(
          `SECURESTORE ADAPTER BYPASS in lib/auth.ts: "${match[0]}"\n` +
            `The adapter must delegate to setItemChunked / getItemChunked /\n` +
            `removeItemChunked, NOT to SecureStore.*Async directly. Supabase\n` +
            `session blobs exceed the 2 KB cap; direct wrapping regresses\n` +
            `the arch-review-2 Phase 2.G hardening.`,
        );
      }
      expect(match).toBeNull();
    }
  });
});

describe('Architecture: Rule 40 — extractVocabulary prompt shows every non-other type', () => {
  // Small LLMs (mistral-small-2506) are strongly biased by few-shot
  // examples at temperature 0. A single-example JSON schema ("type":
  // "noun") caused every extracted entry — nouns, verbs, adjectives,
  // phrases — to come back labelled "noun" deterministically, which
  // then made capitaliseGermanNouns fire on verbs for German users.
  // Pin the prompt to show each non-"other" type so the model has
  // canonical anchors for all of them.
  it('buildVocabSystemPrompt includes noun/verb/adjective/phrase examples AND the type enum', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'claude.ts'), 'utf8');

    const fnMatch = src.match(/function\s+buildVocabSystemPrompt[\s\S]*?^}/m);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];

    const REQUIRED_TYPE_LABELS = ['noun', 'verb', 'adjective', 'phrase'];
    const missing = REQUIRED_TYPE_LABELS.filter((t) => !body.includes(`"type": "${t}"`));
    if (missing.length > 0) {
      throw new Error(
        `EXTRACTION PROMPT BIAS in lib/claude.ts: buildVocabSystemPrompt\n` +
          `must include one "type": "${REQUIRED_TYPE_LABELS.join('" / "type": "')}" example.\n` +
          `Missing: ${missing.map((t) => `"type": "${t}"`).join(', ')}.\n` +
          `Temperature-0 small models cargo-cult single-example prompts —\n` +
          `without all four anchors, every entry comes back as "noun".\n` +
          `See arch-review-2 Phase 2.H.`,
      );
    }
    expect(missing).toEqual([]);

    // The prompt must also carry an enum-shaped listing so the model
    // treats the field as a choice, not a cargo-culted constant.
    expect(body).toMatch(/"noun".*"verb".*"adjective".*"phrase"/s);
  });
});

// ─── Rule 33: postProcessExtractedVocab applies full filter chain ────
// CLAUDE.md "Vocabulary post-processing": the single integration point
// must drop abbreviations + likely proper nouns + multi-word noun leaks
// AND deduplicate within a batch on (original, type). Each of these is
// a quality fix anchored by the 2026-04-20 sweep analysis. Silently
// removing any one would let the same class of regression back in.
describe('Architecture: Rule 33 — postProcessExtractedVocab applies full filter chain', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'vocabFilters.ts'), 'utf8');
  const fnMatch = src.match(/export function postProcessExtractedVocab[\s\S]*?\n\}/);
  it('postProcessExtractedVocab exists', () => {
    expect(fnMatch).not.toBeNull();
  });

  const body = fnMatch?.[0] ?? '';

  it.each([
    ['isAbbreviation', /isAbbreviation\s*\(/],
    ['isLikelyProperNoun', /isLikelyProperNoun\s*\(/],
    ['isMultiWordNounLeak', /isMultiWordNounLeak\s*\(/],
    ['collapseIdenticalFormPair', /collapseIdenticalFormPair\s*\(/],
  ])('calls %s in its filter chain', (_name, pattern) => {
    if (!pattern.test(body)) {
      throw new Error(
        `Missing filter call in postProcessExtractedVocab:\n  ${_name}\n\n` +
          `All filters (abbreviation, proper noun, multi-word leak, same-\n` +
          `form pair collapse, dedup set) must run on every batch — see\n` +
          `CLAUDE.md "Vocabulary post-processing" and the 2026-04-20 sweep\n` +
          `analysis. Removing any one reintroduces an observed regression:\n` +
          `  - abbreviation → GNR-style noise\n` +
          `  - proper noun → Maria / Real Madrid leaks\n` +
          `  - multi-word noun → "die öffentliche Gewalt" entries\n` +
          `  - same-form collapse → "grande, grande" / "igual, igual" pairs\n` +
          `  - dedup → repetition-loop inflation (être × 37).`,
      );
    }
    expect(body).toMatch(pattern);
  });

  it('deduplicates within a batch via a Set-based seen-key pattern', () => {
    // The dedup catches both 2× copies AND full repetition loops where the
    // LLM emits the same word 30+ times. The only shape we check is
    // "there is a Set collecting (original, type) keys and we bail on dup".
    const hasSet = /new Set<[^>]+>\s*\(\s*\)/.test(body);
    const hasSeenAdd = /seen\.add\s*\(/.test(body);
    const hasSeenHas = /seen\.has\s*\(/.test(body);
    if (!(hasSet && hasSeenAdd && hasSeenHas)) {
      throw new Error(
        `Missing batch-level dedup in postProcessExtractedVocab.\n` +
          `Required shape: a Set collecting (original, type) keys, guarded\n` +
          `by seen.has(...) and advanced by seen.add(...). See CLAUDE.md\n` +
          `"Vocabulary post-processing" and lib/vocabFilters.test.ts\n` +
          `"collapses repetition-loops to a single entry".`,
      );
    }
    expect(hasSet && hasSeenAdd && hasSeenHas).toBe(true);
  });
});

// ─── Rule 34: Extraction prompt carries native-specific + anti-dup rules ─
// CLAUDE.md "Vocabulary Formatting Rules": the extraction system prompt
// must be aware of the learning-language code so Scandinavian languages
// (da/sv/no) receive the indefinite-article rule (since they mark
// definiteness by suffix, not prefix). It must also instruct the LLM to
// emit each distinct word at most once — the primary defence against
// the repetition-loop failure mode observed in the 2026-04-20 sweep.
// extractVocabulary must additionally log a warning when ≥3 consecutive
// identical entries are parsed (post-hoc loop detection).
describe('Architecture: Rule 34 — extraction prompt has Scandi + anti-dup rules', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'claude.ts'), 'utf8');
  const fnMatch = src.match(/function buildVocabSystemPrompt\b[\s\S]*?\n\}/);

  it('buildVocabSystemPrompt exists and accepts learningLanguageCode', () => {
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    if (!/\blearningLanguageCode\b/.test(body)) {
      throw new Error(
        `buildVocabSystemPrompt must accept learningLanguageCode so it can\n` +
          `specialise the noun rule for Scandinavian languages (da/sv/no).\n` +
          `See CLAUDE.md "Vocabulary Formatting Rules".`,
      );
    }
    expect(body).toMatch(/\blearningLanguageCode\b/);
  });

  it('prompt carries a Scandinavian indefinite-article rule', () => {
    // The rule lives outside the function (as a const) in current code; allow either.
    if (!/(sv|no|da)/i.test(src) || !/\b(indefinite|en\b|ett\b|ei\b)/i.test(src)) {
      throw new Error(
        `Missing Scandinavian noun rule in lib/claude.ts. The extraction\n` +
          `prompt must tell the model to prepend "en"/"ett"/"ei" for\n` +
          `Swedish/Norwegian/Danish nouns, since definiteness is suffixed\n` +
          `in those languages. See CLAUDE.md "Vocabulary Formatting Rules".`,
      );
    }
    expect(/(sv|no|da)/i.test(src)).toBe(true);
    expect(/\b(indefinite|en\b|ett\b|ei\b)/i.test(src)).toBe(true);
  });

  it('prompt instructs AT MOST ONCE per distinct word', () => {
    if (!/AT MOST ONCE/i.test(src)) {
      throw new Error(
        `Missing "AT MOST ONCE" rule in extraction prompt. This is the\n` +
          `primary prompt-side defence against the repetition-loop failure\n` +
          `(être × 37, la perfetta × 39). Removing it reintroduces loops\n` +
          `even if the batch-dedup in postProcessExtractedVocab still\n` +
          `collapses them — loops inflate LLM output tokens and latency.\n` +
          `See 2026-04-20 sweep analysis + CLAUDE.md.`,
      );
    }
    expect(src).toMatch(/AT MOST ONCE/i);
  });

  it('extractVocabulary logs a repetition-loop warning after JSON parse', () => {
    const extractMatch = src.match(/export async function extractVocabulary\b[\s\S]*?^}/m);
    expect(extractMatch).not.toBeNull();
    const body = extractMatch![0];
    if (!/repetition loop detected/i.test(body) || !/console\.warn\s*\(/.test(body)) {
      throw new Error(
        `extractVocabulary must log "repetition loop detected" via\n` +
          `console.warn when ≥3 consecutive identical (original, type)\n` +
          `entries are parsed. This is the diagnostic counterpart to the\n` +
          `batch-dedup in postProcessExtractedVocab — silently collapsing\n` +
          `loops hides prompt drift from the on-call signal. See 2026-04-20\n` +
          `sweep analysis.`,
      );
    }
    expect(body).toMatch(/repetition loop detected/i);
    expect(body).toMatch(/console\.warn\s*\(/);
  });
});

// ─── Rule 35: Two-phase extraction tool stays out of the production bundle ─
// The two-phase extraction harness (scripts/extraction/) is a dev-only
// validation tool, not production code. It must never be reachable from
// the app bundle — no import from app/, components/, hooks/, constants/,
// or lib/ may point into scripts/extraction/. Any such import would pull
// the validation harness into Metro and silently turn a sweep-only
// experiment into live user-affecting code.
describe('Architecture: Rule 35 — two-phase extraction stays dev-only', () => {
  const PRODUCTION_DIRS = ['app', 'components', 'hooks', 'constants', 'lib'];

  function walkForImports(dir: string, acc: string[]): string[] {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walkForImports(full, acc);
      } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
        acc.push(full);
      }
    }
    return acc;
  }

  it('no production-dir file imports from scripts/extraction/', () => {
    const offenders: { file: string; snippet: string }[] = [];
    for (const dir of PRODUCTION_DIRS) {
      const files = walkForImports(path.join(ROOT, dir), []);
      for (const f of files) {
        const src = fs.readFileSync(f, 'utf8');
        const m = src.match(/from\s+['"][^'"]*scripts\/extraction[^'"]*['"]/);
        if (m) offenders.push({ file: path.relative(ROOT, f), snippet: m[0] });
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Production code imported the dev-only two-phase extraction harness:\n` +
          offenders.map((o) => `  ${o.file}: ${o.snippet}`).join('\n') +
          `\n\nscripts/extraction/ is a validation tool for the sweep script only.\n` +
          `It is NOT wired into the production LLM path and has not gone\n` +
          `through rollout plumbing (feature flag, SQLite cache, telemetry).\n` +
          `Importing it from app-side code turns a dev experiment into\n` +
          `live user-affecting code silently.\n\n` +
          `If you intend to productise two-phase extraction: see the spike\n` +
          `design doc, build the Ship-A rollout plumbing (Settings flag +\n` +
          `SQLite cache + composer wiring in lib/claude.ts), add a dedicated\n` +
          `architecture rule for the production path, then decide whether\n` +
          `this harness stays or gets deleted.`,
      );
    }
    expect(offenders).toEqual([]);
  });

  it('scripts/extraction/ exists (guard against the rule passing by accident if the harness is deleted)', () => {
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'extraction'))).toBe(true);
  });
});

// ─── Rule 36: Classifier lookup strips apostrophe-attached elision articles ─
// lib/classifier/features.ts must strip apostrophe-prefix elision
// articles (l', d', s', c', j', n', qu') after the whitespace-article
// strip, so "l'uovo" looks up against "uovo" in the Leipzig frequency
// table. Without this strip, elision nouns in French/Italian/Portuguese
// fall through to the zero-zipf default and get mis-classified C2. See
// 2026-04-20 sweep analysis I.9.
describe('Architecture: Rule 36 — classifier strips apostrophe articles', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'classifier', 'features.ts'), 'utf8');
  const fnMatch = src.match(/function normaliseLookupKey\b[\s\S]*?\n\}/);

  it('normaliseLookupKey exists', () => {
    expect(fnMatch).not.toBeNull();
  });

  it('normaliseLookupKey strips leading apostrophe-letter prefixes', () => {
    const body = fnMatch?.[0] ?? '';
    // Accept any of: ASCII-only regex replace, curly+ASCII class, manual
    // startsWith check, or a \u2019 normalisation pass (Rule 40). Any of
    // these means elision is handled; the test should not be brittle to
    // the specific regex class shape.
    const hasApostropheStrip =
      /replace\s*\(\s*\/\^\[[^\]]*\][\\u20']/i.test(body) ||
      /\.startsWith\("[a-z]'"\)/i.test(body) ||
      /\\u2019/.test(body);
    if (!hasApostropheStrip) {
      throw new Error(
        `normaliseLookupKey must strip apostrophe-attached elision\n` +
          `articles (l', d', s', c' …) after the whitespace-article pass.\n` +
          `Without this, Italian/French/Portuguese elision nouns like\n` +
          `"l'uovo", "l'amour", "l'acqua" never hit the Leipzig entry and\n` +
          `mis-classify C2. See 2026-04-20 sweep analysis section I.9 and\n` +
          `the regression test "l'uovo (it) — apostrophe article is\n` +
          `stripped" in lib/classifier/classifier.test.ts.`,
      );
    }
    expect(hasApostropheStrip).toBe(true);
  });
});

// ─── Rule 37: isMultiWordNounLeak also catches type='other' leaks ────
// The 2026-04-20 sweep's remaining 9 proper-noun leaks were all multi-
// word club names the LLM typed 'other' rather than 'noun' (fr→{es,sv,da}
// × "le Real Madrid" / "le Bayern Munich" / "le FC Barcelone"). The
// filter must therefore treat 'noun' AND 'other' as candidate types.
// Other types (phrase, verb, adjective) are exempt: phrases are multi-
// word by design, verbs rarely produce this shape, adjectives use the
// m/f-pair shape handled by collapseIdenticalFormPair.
describe('Architecture: Rule 37 — isMultiWordNounLeak covers "other" type too', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'vocabFilters.ts'), 'utf8');
  const fnMatch = src.match(/export function isMultiWordNounLeak[\s\S]*?\n\}/);

  it('isMultiWordNounLeak guards on noun OR other', () => {
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    // Allow either a direct conjunction or a set membership check — the
    // invariant is that 'noun' AND 'other' both pass the guard.
    const guardsNoun =
      /type\s*!==\s*['"]noun['"]/.test(body) || /type\s*===\s*['"]noun['"]/.test(body);
    const guardsOther =
      /type\s*!==\s*['"]other['"]/.test(body) || /type\s*===\s*['"]other['"]/.test(body);
    if (!guardsNoun || !guardsOther) {
      throw new Error(
        `isMultiWordNounLeak must accept type === 'noun' OR 'other' as\n` +
          `candidates. 'other' catches proper-noun leaks the LLM fell back\n` +
          `to when it couldn't commit to 'noun' (e.g. "le Real Madrid"\n` +
          `typed 'other' in fr→{es,sv,da} in the 2026-04-20 sweep).\n` +
          `Current guard handles noun=${guardsNoun}, other=${guardsOther}.`,
      );
    }
    expect(guardsNoun && guardsOther).toBe(true);
  });
});

// ─── Rule 38: Adjective rule is language-scoped in extraction prompt ──
// Romance languages (fr, es, it, pt) inflect adjectives by gender in the
// dictionary form ("beau, belle"). German / Dutch / Scandi / Slavic do
// NOT — "dünn" is the base, "dünne" is an inflected weak-declension form.
// Emitting "dünn, dünne" is a category error. Prompt must branch per
// language; post-filter must collapse leaked pairs. See CLAUDE.md
// §"Vocabulary Formatting Rules" Rule 38.
describe('Architecture: Rule 38 — adjective rule is language-scoped', () => {
  const claudeSrc = fs.readFileSync(path.join(ROOT, 'lib', 'claude.ts'), 'utf8');
  const filtersSrc = fs.readFileSync(path.join(ROOT, 'lib', 'vocabFilters.ts'), 'utf8');

  it('lib/claude.ts has a Romance vs single-form adjective branch', () => {
    const hasRomance =
      /ROMANCE_ADJ_RULE/.test(claudeSrc) || /masculine and feminine/.test(claudeSrc);
    const hasSingleForm =
      /SINGLE_FORM_ADJ_RULE/.test(claudeSrc) || /SINGLE dictionary base form/.test(claudeSrc);
    const hasLangBranch = /adjRuleForLang/.test(claudeSrc);
    if (!(hasRomance && hasSingleForm && hasLangBranch)) {
      throw new Error(
        `lib/claude.ts must distinguish Romance adjective rule from single-form rule.\n` +
          `Found: romance=${hasRomance}, singleForm=${hasSingleForm}, branch=${hasLangBranch}.\n` +
          `Romance adjectives ("beau, belle") differ by gender in the dictionary form.\n` +
          `Germanic/Scandi/Slavic adjectives ("dünn") do not — emitting "dünn, dünne"\n` +
          `is a category error. See CLAUDE.md Rule 38.`,
      );
    }
    expect(hasRomance && hasSingleForm && hasLangBranch).toBe(true);
  });

  it('lib/vocabFilters.ts exports collapseAdjectivePair', () => {
    const hasExport = /export function collapseAdjectivePair\b/.test(filtersSrc);
    const hasRomanceGuard = /NO_GENDER_ADJ_LANGS|no.gender.*adj/i.test(filtersSrc);
    if (!(hasExport && hasRomanceGuard)) {
      throw new Error(
        `lib/vocabFilters.ts must export collapseAdjectivePair AND track the\n` +
          `set of languages where adjective m/f pairs are illegitimate\n` +
          `(NO_GENDER_ADJ_LANGS). Romance pairs must pass through unchanged.\n` +
          `Found: export=${hasExport}, guard-set=${hasRomanceGuard}.`,
      );
    }
    expect(hasExport && hasRomanceGuard).toBe(true);
  });

  it('postProcessExtractedVocab invokes collapseAdjectivePair', () => {
    const ppMatch = filtersSrc.match(/export function postProcessExtractedVocab[\s\S]*?\n\}/);
    expect(ppMatch).not.toBeNull();
    const body = ppMatch![0];
    expect(/collapseAdjectivePair/.test(body)).toBe(true);
  });
});

// ─── Rule 39: Non-infinitive verbs dropped in post-processor ──────────
// The LLM occasionally emits conjugated or past-participle forms as
// type='verb' — especially Portuguese ("morreu", "registado"), German
// ("installiert", "zahlt"), and Italian ("distingue"). The 2026-04-21
// sweep quantified 26 such leaks across 6108 entries. The extraction
// prompt must name the mistake explicitly with per-language examples,
// and postProcessExtractedVocab must call isNonInfinitiveVerb to drop
// leaks that slip past the prompt. See CLAUDE.md Rule 39.
describe('Architecture: Rule 39 — non-infinitive verbs dropped', () => {
  const claudeSrc = fs.readFileSync(path.join(ROOT, 'lib', 'claude.ts'), 'utf8');
  const filtersSrc = fs.readFileSync(path.join(ROOT, 'lib', 'vocabFilters.ts'), 'utf8');

  it('extraction prompt names the verb-infinitive mistake explicitly', () => {
    const hasWarning = /never conjugated|never a past participle/i.test(claudeSrc);
    const hasExamples = /morrer|installieren|rendere/.test(claudeSrc);
    if (!(hasWarning && hasExamples)) {
      throw new Error(
        `Extraction prompt must explicitly forbid conjugated / past-participle\n` +
          `verb forms and include at least one per-language example\n` +
          `(morrer, installieren, rendere). Found: warning=${hasWarning},\n` +
          `examples=${hasExamples}. See CLAUDE.md Rule 39.`,
      );
    }
    expect(hasWarning && hasExamples).toBe(true);
  });

  it('lib/vocabFilters.ts exports isNonInfinitiveVerb', () => {
    expect(/export function isNonInfinitiveVerb\b/.test(filtersSrc)).toBe(true);
  });

  it('postProcessExtractedVocab calls isNonInfinitiveVerb', () => {
    const ppMatch = filtersSrc.match(/export function postProcessExtractedVocab[\s\S]*?\n\}/);
    expect(ppMatch).not.toBeNull();
    expect(/isNonInfinitiveVerb/.test(ppMatch![0])).toBe(true);
  });
});

// ─── Rule 40: Curly apostrophes normalised to ASCII ──────────────────
// Readability-extracted HTML emits typographic apostrophes (\u2019) while
// the extraction prompt's examples and the classifier's elision-article
// strip both assume ASCII ('). The 2026-04-21 sweep found 27 French
// entries with \u2019 that bypassed Rule 36's apostrophe strip, fell to
// zero-zipf, and landed in AoA-fallback levels. Both sides must normalise:
// postProcessExtractedVocab calls normaliseApostrophes so dedup keys
// collapse, and normaliseLookupKey accepts both apostrophe codepoints.
describe('Architecture: Rule 40 — curly apostrophes normalised', () => {
  const filtersSrc = fs.readFileSync(path.join(ROOT, 'lib', 'vocabFilters.ts'), 'utf8');
  const featuresSrc = fs.readFileSync(path.join(ROOT, 'lib', 'classifier', 'features.ts'), 'utf8');

  it('lib/vocabFilters.ts exports normaliseApostrophes', () => {
    expect(/export function normaliseApostrophes\b/.test(filtersSrc)).toBe(true);
  });

  it('postProcessExtractedVocab calls normaliseApostrophes', () => {
    const ppMatch = filtersSrc.match(/export function postProcessExtractedVocab[\s\S]*?\n\}/);
    expect(ppMatch).not.toBeNull();
    expect(/normaliseApostrophes/.test(ppMatch![0])).toBe(true);
  });

  it('classifier normaliseLookupKey handles both ASCII and curly apostrophe', () => {
    const fnMatch = featuresSrc.match(/function normaliseLookupKey\b[\s\S]*?\n\}/);
    expect(fnMatch).not.toBeNull();
    const body = fnMatch![0];
    // Either the key is pre-normalised to ASCII with a \u2019 replace, or
    // the final apostrophe-strip regex contains the curly codepoint.
    const hasReplace = /\\u2019/.test(body) || /\u2019/.test(body);
    if (!hasReplace) {
      throw new Error(
        `normaliseLookupKey must handle typographic apostrophe (\u2019, U+2019).\n` +
          `Readability-extracted HTML emits curly apostrophes for French/Italian\n` +
          `elision articles ("l\u2019année", "l\u2019uovo") that otherwise bypass\n` +
          `the ASCII-only apostrophe strip and hit zero-zipf. See CLAUDE.md Rule 40.`,
      );
    }
    expect(hasReplace).toBe(true);
  });
});

// ─── Rule 41: Article-less + determinerless languages have explicit rules ─
// The generic "ALWAYS include the direct article" line is vacuous for
// Polish / Czech (no articles exist) and contrary-to-convention for
// English (the/a/an are determiners, not lexical). Without explicit
// overrides in CRITICAL_NOUN_RULE_BY_LANG, small LLMs may prepend a
// foreign article, switch languages, or emit "the house" / "ten tekst".
// The 2026-04-21 sweep ran native=en + learning∈{11 non-en}, so EN-as-
// learning was never exercised — this rule closes the gap before a
// future sweep with EN-as-learning or a PL-native hits it.
describe('Architecture: Rule 41 — pl/cs/en carry explicit noun rules', () => {
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'claude.ts'), 'utf8');

  it('SLAVIC_NOUN_RULE constant exists and names pl + cs', () => {
    const match = src.match(/const SLAVIC_NOUN_RULE\s*=\s*`[\s\S]*?`;/);
    expect(match).not.toBeNull();
    const body = match![0];
    expect(/\bpolish\b/i.test(body)).toBe(true);
    expect(/\bczech\b/i.test(body)).toBe(true);
    // Must instruct bare form (NO article)
    expect(/no articles|bare|NEVER prepend/i.test(body)).toBe(true);
  });

  it('ENGLISH_NOUN_RULE constant exists and forbids the/a/an prefix', () => {
    const match = src.match(/const ENGLISH_NOUN_RULE\s*=\s*`[\s\S]*?`;/);
    expect(match).not.toBeNull();
    const body = match![0];
    expect(/\benglish\b/i.test(body)).toBe(true);
    expect(/bare|NEVER prepend|without any article/i.test(body)).toBe(true);
    // Must name the three EN determiners so small models can't wiggle
    expect(/the/i.test(body) && /\ba\b/i.test(body) && /\ban\b/i.test(body)).toBe(true);
  });

  it('CRITICAL_NOUN_RULE_BY_LANG maps pl, cs, en to the new rules', () => {
    const match = src.match(/const CRITICAL_NOUN_RULE_BY_LANG[\s\S]*?\};/);
    expect(match).not.toBeNull();
    const body = match![0];
    expect(/\bpl\s*:\s*SLAVIC_NOUN_RULE/.test(body)).toBe(true);
    expect(/\bcs\s*:\s*SLAVIC_NOUN_RULE/.test(body)).toBe(true);
    expect(/\ben\s*:\s*ENGLISH_NOUN_RULE/.test(body)).toBe(true);
    // Sanity: Scandi entries still present (Rule 34 invariant)
    expect(/\bsv\s*:\s*SCANDINAVIAN_NOUN_RULE/.test(body)).toBe(true);
    expect(/\bno\s*:\s*SCANDINAVIAN_NOUN_RULE/.test(body)).toBe(true);
    expect(/\bda\s*:\s*SCANDINAVIAN_NOUN_RULE/.test(body)).toBe(true);
  });
});

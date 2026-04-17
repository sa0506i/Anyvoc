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
    // Must reference the shared rules constant
    expect(body).toMatch(/VOCAB_FORMATTING_RULES/);
    // Must instruct about base form / inflected input
    expect(body).toMatch(/inflect|conjugat|base form|dictionary/i);
  });

  it('lib/claude.ts VOCAB_FORMATTING_RULES mentions articles for nouns', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'claude.ts'), 'utf8');
    const match = src.match(/const VOCAB_FORMATTING_RULES\s*=\s*`[\s\S]*?`;/);
    expect(match).not.toBeNull();
    const rules = match![0];
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

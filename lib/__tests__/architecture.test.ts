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
// Clearing it inside clearAllData would reset the counter on app-reset,
// allowing Basic users to bypass the daily cap. The table must survive a reset.
describe('Architecture: clearAllData does not wipe the daily-limit log', () => {
  it('lib/database.ts clearAllData must not contain DELETE FROM content_adds_log', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'database.ts'), 'utf8');
    // Locate the clearAllData function body. Match from "export function clearAllData"
    // up to the closing "}" at column 0 (function-level closing brace).
    const match = src.match(/export function clearAllData\b[\s\S]*?\n\}/);
    expect(match).not.toBeNull();
    const body = match![0];
    // The log table must never appear inside a DELETE statement in this function.
    expect(body).not.toMatch(/DELETE\s+FROM\s+content_adds_log/i);
    if (/DELETE\s+FROM\s+content_adds_log/i.test(body)) {
      throw new Error(
        `DAILY-LIMIT LOG CLEARED in lib/database.ts clearAllData()\n` +
          `content_adds_log must NOT be deleted during app reset.\n` +
          `The daily-limit counter must survive a reset to prevent Basic-mode bypass.\n` +
          `See CLAUDE.md "Database Schema" section and commit f3e8c22.`,
      );
    }
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

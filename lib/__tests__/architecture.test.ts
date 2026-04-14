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

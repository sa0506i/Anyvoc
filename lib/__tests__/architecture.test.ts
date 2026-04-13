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

  for (const file of allFiles) {
    const relPath = path.relative(ROOT, file);
    it(`${relPath} has no API key patterns`, () => {
      const content = fs.readFileSync(file, 'utf8');
      for (const pattern of API_KEY_PATTERNS) {
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

// ─── Rule 5: app/ screens must import useTheme, not hardcode colors ─
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

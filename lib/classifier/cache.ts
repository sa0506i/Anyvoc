/**
 * cache.ts — two-tier cache for classifier results that came from the
 * Claude API fallback.
 *
 * Tier 1: in-memory Map (cleared on JS reload).
 * Tier 2: expo-sqlite table `classifier_fallback_cache` with a 30-day TTL.
 *
 * The runtime never depends on better-sqlite3. expo-sqlite is the only
 * persistent store; if for any reason the DB cannot be opened (test env,
 * platform without filesystem) we fall back to in-memory only.
 */

import type { CEFRLevel } from '../../constants/levels';
import type { SupportedLanguage } from './index';

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const memCache = new Map<string, CEFRLevel>();

function key(word: string, language: SupportedLanguage): string {
  return `${language}:${word.toLowerCase()}`;
}

// --- expo-sqlite layer ---
//
// We open the same anyvoc.db file the rest of the app uses. expo-sqlite
// dedupes handles, so this does not conflict with SQLiteProvider in
// app/_layout.tsx.

interface MinimalDb {
  runSync(sql: string, params?: unknown[]): unknown;
  getFirstSync<T>(sql: string, params?: unknown[]): T | null;
}

let dbInstance: MinimalDb | null | undefined;
let dbInitTried = false;

function getDb(): MinimalDb | null {
  if (dbInstance !== undefined) return dbInstance;
  if (dbInitTried) return null;
  dbInitTried = true;
  try {
    // Lazy require so unit tests outside jest-expo (pure node) don't crash.
    const sqlite = require('expo-sqlite') as {
      openDatabaseSync?: (name: string) => MinimalDb;
    };
    if (typeof sqlite.openDatabaseSync !== 'function') {
      dbInstance = null;
      return null;
    }
    const db = sqlite.openDatabaseSync('anyvoc.db');
    db.runSync(
      `CREATE TABLE IF NOT EXISTS classifier_fallback_cache (
         word TEXT NOT NULL,
         language TEXT NOT NULL,
         level TEXT NOT NULL,
         created_at INTEGER NOT NULL,
         PRIMARY KEY (word, language)
       )`
    );
    dbInstance = db;
    return db;
  } catch {
    dbInstance = null;
    return null;
  }
}

export function getCached(word: string, language: SupportedLanguage): CEFRLevel | null {
  const k = key(word, language);
  const mem = memCache.get(k);
  if (mem) return mem;

  const db = getDb();
  if (!db) return null;
  try {
    const row = db.getFirstSync<{ level: string; created_at: number }>(
      'SELECT level, created_at FROM classifier_fallback_cache WHERE word = ? AND language = ?',
      [word.toLowerCase(), language]
    );
    if (!row) return null;
    if (Date.now() - row.created_at > TTL_MS) {
      // Stale entry — drop it.
      db.runSync(
        'DELETE FROM classifier_fallback_cache WHERE word = ? AND language = ?',
        [word.toLowerCase(), language]
      );
      return null;
    }
    const lvl = row.level as CEFRLevel;
    memCache.set(k, lvl);
    return lvl;
  } catch {
    return null;
  }
}

export function setCached(
  word: string,
  language: SupportedLanguage,
  level: CEFRLevel
): void {
  const k = key(word, language);
  memCache.set(k, level);
  const db = getDb();
  if (!db) return;
  try {
    db.runSync(
      `INSERT OR REPLACE INTO classifier_fallback_cache (word, language, level, created_at)
       VALUES (?, ?, ?, ?)`,
      [word.toLowerCase(), language, level, Date.now()]
    );
  } catch {
    /* ignore */
  }
}

export function clearCache(): void {
  memCache.clear();
  const db = getDb();
  if (!db) return;
  try {
    db.runSync('DELETE FROM classifier_fallback_cache');
  } catch {
    /* ignore */
  }
}

/** Test helper: reset the lazy DB handle so a fresh openDatabaseSync mock takes effect. */
export function __resetDbForTests(): void {
  dbInstance = undefined;
  dbInitTried = false;
}

/**
 * Unit tests for processSharedText proMode gates.
 *
 * Uses an in-memory better-sqlite3 database wrapped in the same
 * SQLiteDatabase shim as lib/database.test.ts.
 */

import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';
import { processSharedText, type ShareProcessingSettings } from './shareProcessing';
import { insertContent } from './database';

// Mock the 3 Claude API functions + language detection
jest.mock('./claude', () => ({
  extractVocabulary: jest.fn().mockResolvedValue([]),
  translateText: jest.fn().mockResolvedValue('translated text'),
  detectLanguage: jest.fn().mockResolvedValue(null),
  ClaudeAPIError: class ClaudeAPIError extends Error {},
}));

// Mock classifier to avoid transitive native-module imports
jest.mock('./classifier', () => ({
  classifyWord: jest.fn().mockResolvedValue('B1'),
}));

import * as claude from './claude';

// --- Mock SQLite wrapper (copied verbatim from lib/database.test.ts) ---

function createMockDb(): SQLiteDatabase {
  const raw = new Database(':memory:');
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');

  // Create schema
  raw.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      original_text TEXT NOT NULL,
      translated_text TEXT,
      source_type TEXT NOT NULL,
      source_url TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vocabulary (
      id TEXT PRIMARY KEY,
      content_id TEXT NOT NULL REFERENCES contents(id) ON DELETE CASCADE,
      original TEXT NOT NULL,
      translation TEXT NOT NULL,
      level TEXT NOT NULL,
      word_type TEXT NOT NULL,
      source_forms TEXT,
      leitner_box INTEGER NOT NULL DEFAULT 1,
      last_reviewed INTEGER,
      correct_count INTEGER NOT NULL DEFAULT 0,
      incorrect_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vocabulary_content_id ON vocabulary(content_id);
    CREATE INDEX IF NOT EXISTS idx_vocabulary_leitner_box ON vocabulary(leitner_box);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vocabulary_original ON vocabulary(original);
    CREATE TABLE IF NOT EXISTS review_days (
      day TEXT PRIMARY KEY
    );
  `);

  return {
    runSync(sql: string, params?: any[]) {
      raw.prepare(sql).run(...(params ?? []));
    },
    getFirstSync<T>(sql: string, params?: any[]): T | null {
      return (raw.prepare(sql).get(...(params ?? [])) as T) ?? null;
    },
    getAllSync<T>(sql: string, params?: any[]): T[] {
      return raw.prepare(sql).all(...(params ?? [])) as T[];
    },
    withTransactionSync(fn: () => void) {
      raw.transaction(fn)();
    },
  } as unknown as SQLiteDatabase;
}

// --- Test fixtures ---

const baseSettings: ShareProcessingSettings = {
  nativeLanguage: 'en',
  learningLanguage: 'de',
  level: 'A1',
};

const noop = () => {};

// --- Tests ---

describe('processSharedText — proMode', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips translateText when proMode is false', async () => {
    const db = createMockDb();
    await processSharedText(
      db,
      'Hallo Welt.',
      'title',
      'text',
      undefined,
      { ...baseSettings, proMode: false },
      noop,
    );
    expect(claude.translateText).not.toHaveBeenCalled();
    expect(claude.extractVocabulary).toHaveBeenCalled();
  });

  it('calls translateText when proMode is true', async () => {
    const db = createMockDb();
    await processSharedText(
      db,
      'Hallo Welt.',
      'title',
      'text',
      undefined,
      { ...baseSettings, proMode: true },
      noop,
    );
    expect(claude.translateText).toHaveBeenCalled();
    expect(claude.extractVocabulary).toHaveBeenCalled();
  });

  it('calls translateText when proMode is omitted (defaults to Pro)', async () => {
    const db = createMockDb();
    await processSharedText(db, 'Hallo Welt.', 'title', 'text', undefined, baseSettings, noop);
    expect(claude.translateText).toHaveBeenCalled();
  });

  it('rejects with daily-limit when Basic mode and >=3 contents today', async () => {
    const db = createMockDb();
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      insertContent(db, {
        id: `c${i}`,
        title: 't',
        original_text: 'x',
        translated_text: null,
        source_type: 'text',
        source_url: null,
        created_at: now,
      });
    }

    const result = await processSharedText(
      db,
      'Hallo.',
      'title',
      'text',
      undefined,
      { ...baseSettings, proMode: false },
      noop,
    );

    expect(result.rejected).toBe('daily-limit');
    expect(claude.extractVocabulary).not.toHaveBeenCalled();
    expect(claude.translateText).not.toHaveBeenCalled();
  });

  it('does not reject in Pro mode even with 3 contents today', async () => {
    const db = createMockDb();
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      insertContent(db, {
        id: `c${i}`,
        title: 't',
        original_text: 'x',
        translated_text: null,
        source_type: 'text',
        source_url: null,
        created_at: now,
      });
    }

    const result = await processSharedText(
      db,
      'Hallo.',
      'title',
      'text',
      undefined,
      { ...baseSettings, proMode: true },
      noop,
    );

    expect(result.rejected).toBeUndefined();
    expect(claude.extractVocabulary).toHaveBeenCalled();
  });

  it('truncates long text in Basic mode and sets truncated=true', async () => {
    const db = createMockDb();
    const longText = 'Ein Satz. '.repeat(200); // ~2000 chars

    const result = await processSharedText(
      db,
      longText,
      'title',
      'text',
      undefined,
      { ...baseSettings, proMode: false },
      noop,
    );

    expect(result.truncated).toBe(true);
    // The mock should have been called with the truncated text (<=1010 chars)
    const extractArg = (claude.extractVocabulary as jest.Mock).mock.calls[0][0] as string;
    expect(extractArg.length).toBeLessThanOrEqual(1010);
  });

  it('does not truncate in Pro mode', async () => {
    const db = createMockDb();
    const longText = 'Ein Satz. '.repeat(200);

    const result = await processSharedText(
      db,
      longText,
      'title',
      'text',
      undefined,
      { ...baseSettings, proMode: true },
      noop,
    );

    expect(result.truncated).toBe(false);
  });
});

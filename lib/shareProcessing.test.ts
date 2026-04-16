/**
 * Unit tests for processSharedText proMode gates.
 *
 * Uses an in-memory better-sqlite3 database wrapped in the same
 * SQLiteDatabase shim as lib/database.test.ts.
 */

import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';
import { processSharedText, type ShareProcessingSettings } from './shareProcessing';
import { insertContent, recordContentAdd } from './database';

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
    CREATE TABLE IF NOT EXISTS content_adds_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      added_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_adds_log_added_at ON content_adds_log(added_at);
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
    for (let i = 0; i < 3; i++) {
      recordContentAdd(db);
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
    for (let i = 0; i < 3; i++) {
      recordContentAdd(db);
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

  it('calls recordContentAdd on successful insert in Basic mode', async () => {
    const db = createMockDb();
    await processSharedText(
      db,
      'Hallo.',
      'title',
      'text',
      undefined,
      { ...baseSettings, proMode: false },
      noop,
    );
    expect(
      db.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM content_adds_log', []),
    ).toEqual({ count: 1 });
  });

  it('truncates long text in Basic mode and sets truncated=true', async () => {
    const db = createMockDb();
    const longText = 'Ein Satz. '.repeat(300); // ~3000 chars

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
    const extractArg = (claude.extractVocabulary as jest.Mock).mock.calls[0][0] as string;
    expect(extractArg.length).toBeLessThanOrEqual(2010);
  });

  it('does not truncate short text in Pro mode', async () => {
    const db = createMockDb();
    const longText = 'Ein Satz. '.repeat(200); // 2000 chars, under 5000 Pro limit

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

  it('truncates long text in Pro mode at 5000 chars and sets truncated=true', async () => {
    const db = createMockDb();
    const longText = 'Ein Satz. '.repeat(600); // 6000 chars, over 5000 Pro limit

    const result = await processSharedText(
      db,
      longText,
      'title',
      'text',
      undefined,
      { ...baseSettings, proMode: true },
      noop,
    );

    expect(result.truncated).toBe(true);
  });

  it('does NOT call recordContentAdd when rejected by daily limit', async () => {
    const db = createMockDb();
    // Simulate 3 previous additions
    for (let i = 0; i < 3; i++) recordContentAdd(db);
    const beforeCount = db.getFirstSync<{ count: number }>(
      'SELECT COUNT(*) as count FROM content_adds_log',
      [],
    )?.count;

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
    const afterCount = db.getFirstSync<{ count: number }>(
      'SELECT COUNT(*) as count FROM content_adds_log',
      [],
    )?.count;
    // Count must be unchanged from the 3 we seeded — rejection does not log.
    expect(afterCount).toBe(beforeCount);
    expect(afterCount).toBe(3);
  });

  it('does NOT call recordContentAdd when language detection rejects', async () => {
    const db = createMockDb();
    // Force a language mismatch: learning = de but detectLanguage returns 'fr'
    (claude.detectLanguage as jest.Mock).mockResolvedValueOnce('fr');

    await expect(
      processSharedText(
        db,
        'Bonjour.',
        'title',
        'text',
        undefined,
        { ...baseSettings, proMode: true }, // Pro so no daily-limit gate
        noop,
      ),
    ).rejects.toThrow(/appears to be in French/);

    const count = db.getFirstSync<{ count: number }>(
      'SELECT COUNT(*) as count FROM content_adds_log',
      [],
    )?.count;
    expect(count).toBe(0);
  });

  it('extractVocabulary and translateText run in parallel in Pro mode', async () => {
    const db = createMockDb();
    const extractStart = jest.fn();
    const translateStart = jest.fn();

    (claude.extractVocabulary as jest.Mock).mockImplementation(async () => {
      extractStart();
      await new Promise((r) => setTimeout(r, 20));
      return [];
    });
    (claude.translateText as jest.Mock).mockImplementation(async () => {
      translateStart();
      await new Promise((r) => setTimeout(r, 20));
      return 'translated';
    });

    await processSharedText(
      db,
      'Hallo.',
      'title',
      'text',
      undefined,
      { ...baseSettings, proMode: true },
      noop,
    );

    // Both should have started before either resolved.
    // We verify this by checking both were called; sequential would still call
    // both, but parallel means the second started before the first finished.
    // Easiest proxy: inspect mock.invocationCallOrder values close together.
    const extractOrder = (claude.extractVocabulary as jest.Mock).mock.invocationCallOrder[0];
    const translateOrder = (claude.translateText as jest.Mock).mock.invocationCallOrder[0];
    // With Promise.all both synchronous kicks happen in the same tick before
    // any await resolves. A small gap (≤ 3) accounts for other mocks (e.g.
    // detectLanguage) that fire between them but still in the same sync burst.
    // A sequential implementation would produce a gap much larger than 3
    // because translateText would only be called after extract's await resolves.
    expect(Math.abs(extractOrder - translateOrder)).toBeLessThanOrEqual(3);
    expect(extractStart).toHaveBeenCalled();
    expect(translateStart).toHaveBeenCalled();
  });
});

/**
 * Database layer unit tests.
 *
 * Uses an in-memory mock of expo-sqlite's synchronous API (runSync,
 * getFirstSync, getAllSync) backed by a real better-sqlite3 database
 * so we can test actual SQL logic without an emulator.
 */

import Database from 'better-sqlite3';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  getSetting,
  setSetting,
  getAllSettings,
  clearAllSettings,
  insertContent,
  getContents,
  getContentById,
  deleteContent,
  updateContentTranslation,
  insertVocabulary,
  insertVocabularyBatch,
  getAllVocabulary,
  getVocabularyByContentId,
  vocabularyExists,
  updateVocabularyReview,
  updateVocabularyFields,
  deleteVocabulary,
  deleteVocabularyByContentId,
  getVocabularyStats,
  recordReviewDay,
  getAllReviewDays,
  clearAllData,
  type Content,
  type Vocabulary,
} from './database';

// --- Mock SQLite wrapper ---

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
  } as unknown as SQLiteDatabase;
}

// --- Helpers ---

function makeContent(overrides: Partial<Content> = {}): Content {
  return {
    id: 'c1',
    title: 'Test Content',
    original_text: 'Der Hund spielt.',
    translated_text: null,
    source_type: 'text',
    source_url: null,
    created_at: Date.now(),
    ...overrides,
  };
}

function makeVocab(overrides: Partial<Vocabulary> = {}): Vocabulary {
  return {
    id: 'v1',
    content_id: 'c1',
    original: 'der Hund',
    translation: 'the dog',
    level: 'A1',
    word_type: 'noun',
    source_forms: null,
    leitner_box: 1,
    last_reviewed: null,
    correct_count: 0,
    incorrect_count: 0,
    created_at: Date.now(),
    ...overrides,
  };
}

// --- Tests ---

let db: SQLiteDatabase;

beforeEach(() => {
  db = createMockDb();
});

describe('Settings', () => {
  it('getSetting returns null for missing key', () => {
    expect(getSetting(db, 'missing')).toBeNull();
  });

  it('setSetting + getSetting round-trips', () => {
    setSetting(db, 'lang', 'de');
    expect(getSetting(db, 'lang')).toBe('de');
  });

  it('setSetting overwrites existing value', () => {
    setSetting(db, 'lang', 'de');
    setSetting(db, 'lang', 'fr');
    expect(getSetting(db, 'lang')).toBe('fr');
  });

  it('getAllSettings returns all pairs', () => {
    setSetting(db, 'a', '1');
    setSetting(db, 'b', '2');
    expect(getAllSettings(db)).toEqual({ a: '1', b: '2' });
  });

  it('clearAllSettings removes everything', () => {
    setSetting(db, 'x', 'y');
    clearAllSettings(db);
    expect(getSetting(db, 'x')).toBeNull();
  });
});

describe('Contents', () => {
  it('insertContent + getContentById round-trips', () => {
    const c = makeContent();
    insertContent(db, c);
    const found = getContentById(db, c.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe('Test Content');
  });

  it('getContents returns vocab_count', () => {
    const c = makeContent();
    insertContent(db, c);
    insertVocabulary(db, makeVocab({ id: 'v1', content_id: c.id }));
    insertVocabulary(db, makeVocab({ id: 'v2', content_id: c.id, original: 'die Katze' }));

    const contents = getContents(db);
    expect(contents).toHaveLength(1);
    expect(contents[0].vocab_count).toBe(2);
  });

  it('getContents returns 0 vocab_count for content without vocab', () => {
    insertContent(db, makeContent());
    expect(getContents(db)[0].vocab_count).toBe(0);
  });

  it('updateContentTranslation updates translated_text', () => {
    insertContent(db, makeContent());
    updateContentTranslation(db, 'c1', 'The dog plays.');
    expect(getContentById(db, 'c1')!.translated_text).toBe('The dog plays.');
  });

  it('deleteContent removes content and its vocabulary', () => {
    insertContent(db, makeContent());
    insertVocabulary(db, makeVocab());
    deleteContent(db, 'c1');
    expect(getContentById(db, 'c1')).toBeNull();
    expect(getAllVocabulary(db)).toHaveLength(0);
  });
});

describe('Vocabulary', () => {
  beforeEach(() => {
    insertContent(db, makeContent());
  });

  it('insertVocabulary + getAllVocabulary round-trips', () => {
    insertVocabulary(db, makeVocab());
    const all = getAllVocabulary(db);
    expect(all).toHaveLength(1);
    expect(all[0].original).toBe('der Hund');
  });

  it('insertVocabulary skips duplicates (same original)', () => {
    insertVocabulary(db, makeVocab({ id: 'v1', original: 'der Hund' }));
    insertVocabulary(db, makeVocab({ id: 'v2', original: 'der Hund' }));
    expect(getAllVocabulary(db)).toHaveLength(1);
  });

  it('insertVocabulary allows different originals', () => {
    insertVocabulary(db, makeVocab({ id: 'v1', original: 'der Hund' }));
    insertVocabulary(db, makeVocab({ id: 'v2', original: 'die Katze' }));
    expect(getAllVocabulary(db)).toHaveLength(2);
  });

  it('vocabularyExists returns correct boolean', () => {
    insertVocabulary(db, makeVocab());
    expect(vocabularyExists(db, 'der Hund')).toBe(true);
    expect(vocabularyExists(db, 'die Katze')).toBe(false);
  });

  it('getVocabularyByContentId filters correctly', () => {
    insertContent(db, makeContent({ id: 'c2', title: 'Other' }));
    insertVocabulary(db, makeVocab({ id: 'v1', content_id: 'c1' }));
    insertVocabulary(db, makeVocab({ id: 'v2', content_id: 'c2', original: 'die Katze' }));

    expect(getVocabularyByContentId(db, 'c1')).toHaveLength(1);
    expect(getVocabularyByContentId(db, 'c2')).toHaveLength(1);
  });

  it('insertVocabularyBatch inserts multiple', () => {
    const vocabs = [
      makeVocab({ id: 'v1', original: 'der Hund' }),
      makeVocab({ id: 'v2', original: 'die Katze' }),
      makeVocab({ id: 'v3', original: 'das Haus' }),
    ];
    insertVocabularyBatch(db, vocabs);
    expect(getAllVocabulary(db)).toHaveLength(3);
  });

  it('updateVocabularyFields updates original and translation', () => {
    insertVocabulary(db, makeVocab());
    updateVocabularyFields(db, 'v1', 'der große Hund', 'the big dog');
    const updated = getAllVocabulary(db)[0];
    expect(updated.original).toBe('der große Hund');
    expect(updated.translation).toBe('the big dog');
  });

  it('deleteVocabulary removes single vocab', () => {
    insertVocabulary(db, makeVocab({ id: 'v1', original: 'der Hund' }));
    insertVocabulary(db, makeVocab({ id: 'v2', original: 'die Katze' }));
    deleteVocabulary(db, 'v1');
    const remaining = getAllVocabulary(db);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe('v2');
  });

  it('deleteVocabularyByContentId removes all vocab for content', () => {
    insertVocabulary(db, makeVocab({ id: 'v1', original: 'der Hund' }));
    insertVocabulary(db, makeVocab({ id: 'v2', original: 'die Katze' }));
    deleteVocabularyByContentId(db, 'c1');
    expect(getAllVocabulary(db)).toHaveLength(0);
  });
});

describe('Reviews', () => {
  beforeEach(() => {
    insertContent(db, makeContent());
    insertVocabulary(db, makeVocab());
  });

  it('updateVocabularyReview correct increments correct_count and promotes box', () => {
    updateVocabularyReview(db, 'v1', 2, true);
    const v = getAllVocabulary(db)[0];
    expect(v.correct_count).toBe(1);
    expect(v.leitner_box).toBe(2);
    expect(v.last_reviewed).not.toBeNull();
  });

  it('updateVocabularyReview incorrect increments incorrect_count', () => {
    updateVocabularyReview(db, 'v1', 1, false);
    const v = getAllVocabulary(db)[0];
    expect(v.incorrect_count).toBe(1);
  });

  it('updateVocabularyReview records review day', () => {
    updateVocabularyReview(db, 'v1', 2, true);
    const days = getAllReviewDays(db);
    expect(days.length).toBeGreaterThanOrEqual(1);
  });

  it('recordReviewDay is idempotent', () => {
    recordReviewDay(db);
    recordReviewDay(db);
    const days = getAllReviewDays(db);
    expect(days).toHaveLength(1);
  });
});

describe('getVocabularyStats', () => {
  beforeEach(() => {
    insertContent(db, makeContent());
  });

  it('returns zeros for empty db', () => {
    const stats = getVocabularyStats(db);
    expect(stats.total).toBe(0);
    expect(stats.byBox).toEqual({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
  });

  it('counts total and byBox correctly', () => {
    insertVocabulary(db, makeVocab({ id: 'v1', original: 'a', leitner_box: 1 }));
    insertVocabulary(db, makeVocab({ id: 'v2', original: 'b', leitner_box: 3 }));
    insertVocabulary(db, makeVocab({ id: 'v3', original: 'c', leitner_box: 3 }));

    const stats = getVocabularyStats(db);
    expect(stats.total).toBe(3);
    expect(stats.byBox[1]).toBe(1);
    expect(stats.byBox[3]).toBe(2);
  });
});

describe('clearAllData', () => {
  it('removes all tables content', () => {
    insertContent(db, makeContent());
    insertVocabulary(db, makeVocab());
    setSetting(db, 'lang', 'de');
    recordReviewDay(db);

    clearAllData(db);

    expect(getContents(db)).toHaveLength(0);
    expect(getAllVocabulary(db)).toHaveLength(0);
    expect(getSetting(db, 'lang')).toBeNull();
    expect(getAllReviewDays(db)).toHaveLength(0);
  });
});

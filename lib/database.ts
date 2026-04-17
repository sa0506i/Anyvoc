import type { SQLiteDatabase } from 'expo-sqlite';

// --- Types ---

export interface Content {
  id: string;
  title: string;
  original_text: string;
  translated_text: string | null;
  source_type: 'text' | 'image' | 'link' | 'manual';
  source_url: string | null;
  created_at: number;
}

export interface Vocabulary {
  id: string;
  content_id: string;
  original: string;
  translation: string;
  level: string;
  word_type: 'noun' | 'verb' | 'adjective' | 'phrase' | 'other';
  source_forms: string | null; // JSON array of text forms, e.g. '["rivais"]'
  leitner_box: number;
  last_reviewed: number | null;
  correct_count: number;
  incorrect_count: number;
  created_at: number;
  // 1 when the user explicitly added this word (Pro long-press flow); 0 for
  // bulk-extracted rows. Vocab views bypass the CEFR level filter for
  // user_added=1 rows — the user's explicit intent beats the level setting.
  user_added: number;
}

// --- Init ---

export async function initDatabase(db: SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

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
      created_at INTEGER NOT NULL,
      user_added INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_vocabulary_content_id ON vocabulary(content_id);
    CREATE INDEX IF NOT EXISTS idx_vocabulary_leitner_box ON vocabulary(leitner_box);
    CREATE INDEX IF NOT EXISTS idx_vocabulary_created_at ON vocabulary(created_at DESC);

    CREATE TABLE IF NOT EXISTS review_days (
      day TEXT PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS content_adds_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      added_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_content_adds_log_added_at ON content_adds_log(added_at);
  `);

  // Backfill review_days from existing vocabulary last_reviewed timestamps
  const reviewed = db.getAllSync<{ last_reviewed: number }>(
    'SELECT DISTINCT last_reviewed FROM vocabulary WHERE last_reviewed IS NOT NULL',
  );
  for (const row of reviewed) {
    const d = new Date(row.last_reviewed);
    const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    db.runSync('INSERT OR IGNORE INTO review_days (day) VALUES (?)', [dayStr]);
  }

  // Migration: add source_forms column if missing (existing installs)
  try {
    db.runSync('ALTER TABLE vocabulary ADD COLUMN source_forms TEXT');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add user_added column for single-word adds (Pro long-press).
  // Legacy rows default to 0 (all prior vocab came from bulk extraction).
  try {
    db.runSync('ALTER TABLE vocabulary ADD COLUMN user_added INTEGER NOT NULL DEFAULT 0');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add unique index on vocabulary.original for INSERT OR IGNORE dedup
  try {
    db.runSync('CREATE UNIQUE INDEX IF NOT EXISTS idx_vocabulary_original ON vocabulary(original)');
  } catch {
    // Index already exists — ignore
  }

  // Migration: Auth grandfathering.
  // If this install already has data (contents, vocabulary, or known user
  // settings), it belongs to a pre-auth user — mark onboarding as seen so
  // the new welcome/login screen does not interrupt them. New installs
  // (empty DB) leave onboarding_seen absent, which routes them to welcome.
  // Idempotent: only writes onboarding_seen if it isn't already set.
  const onboardingSeen = getSetting(db, 'onboarding_seen');
  if (onboardingSeen === null && hasExistingData(db)) {
    setSetting(db, 'onboarding_seen', 'true');
  }
}

/**
 * Returns true if this SQLite database contains real learning data from a
 * prior session — i.e. contents or vocabulary rows. Used for auth
 * grandfathering to decide whether to skip the welcome screen.
 *
 * Language settings (nativeLanguage/learningLanguage) are NOT counted,
 * because useSettings.loadSettings auto-persists nativeLanguage from the
 * device locale on first launch and resetApp() immediately re-sets it
 * after clearAllData(). Using those as a "user exists" signal would (a)
 * misfire on fresh installs after the very first open and (b) hide the
 * welcome screen after a Reset App + reload, which is the opposite of
 * what the user expects.
 */
export function hasExistingData(db: SQLiteDatabase): boolean {
  const c = db.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM contents');
  if ((c?.count ?? 0) > 0) return true;
  const v = db.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM vocabulary');
  if ((v?.count ?? 0) > 0) return true;
  return false;
}

// --- Settings ---

export function getSetting(db: SQLiteDatabase, key: string): string | null {
  const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export function setSetting(db: SQLiteDatabase, key: string, value: string): void {
  db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

export function getAllSettings(db: SQLiteDatabase): Record<string, string> {
  const rows = db.getAllSync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

export function clearAllSettings(db: SQLiteDatabase): void {
  db.runSync('DELETE FROM settings');
}

// --- Contents ---

export function getContents(db: SQLiteDatabase): (Content & { vocab_count: number })[] {
  return db.getAllSync<Content & { vocab_count: number }>(`
    SELECT c.*, COALESCE(v.cnt, 0) as vocab_count
    FROM contents c
    LEFT JOIN (SELECT content_id, COUNT(*) as cnt FROM vocabulary GROUP BY content_id) v
      ON c.id = v.content_id
    ORDER BY c.created_at DESC
  `);
}

export function getContentById(db: SQLiteDatabase, id: string): Content | null {
  return db.getFirstSync<Content>('SELECT * FROM contents WHERE id = ?', [id]);
}

export function insertContent(db: SQLiteDatabase, content: Content): void {
  db.runSync(
    'INSERT INTO contents (id, title, original_text, translated_text, source_type, source_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [
      content.id,
      content.title,
      content.original_text,
      content.translated_text,
      content.source_type,
      content.source_url,
      content.created_at,
    ],
  );
}

export function updateContentTranslation(
  db: SQLiteDatabase,
  id: string,
  translatedText: string,
): void {
  db.runSync('UPDATE contents SET translated_text = ? WHERE id = ?', [translatedText, id]);
}

export function deleteContent(db: SQLiteDatabase, id: string): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM contents WHERE id = ?', [id]);
    // vocabulary rows are removed automatically via ON DELETE CASCADE
  });
}

/** Maximum contents a user in Basic mode may add per local calendar day. */
export const BASIC_MODE_DAILY_CONTENT_LIMIT = 3;

/** Counts contents added on the local calendar day of `now` (default: now). */
export function countContentsAddedToday(db: SQLiteDatabase, now: Date = new Date()): number {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const row = db.getFirstSync<{ count: number }>(
    'SELECT COUNT(*) as count FROM content_adds_log WHERE added_at >= ?',
    [todayStart],
  );
  return row?.count ?? 0;
}

/** Logs a content-addition event for Basic-mode daily-limit accounting.
 *  Rows persist across individual item deletion but are cleared on full
 *  app reset / logout (via clearAllData). */
export function recordContentAdd(db: SQLiteDatabase, now: Date = new Date()): void {
  db.runSync('INSERT INTO content_adds_log (added_at) VALUES (?)', [now.getTime()]);
}

// --- Vocabulary ---

export function getAllVocabulary(db: SQLiteDatabase): Vocabulary[] {
  return db.getAllSync<Vocabulary>('SELECT * FROM vocabulary ORDER BY created_at DESC');
}

export function getVocabularyByContentId(db: SQLiteDatabase, contentId: string): Vocabulary[] {
  return db.getAllSync<Vocabulary>(
    'SELECT * FROM vocabulary WHERE content_id = ? ORDER BY created_at ASC',
    [contentId],
  );
}

/** Checks if a word already exists globally (across all contents).
 *  Global dedup is intentional: the Leitner system tracks each word once. */
export function vocabularyExists(db: SQLiteDatabase, original: string): boolean {
  const row = db.getFirstSync('SELECT id FROM vocabulary WHERE original = ?', [original]);
  return !!row;
}

export function insertVocabulary(db: SQLiteDatabase, vocab: Vocabulary): void {
  db.runSync(
    'INSERT OR IGNORE INTO vocabulary (id, content_id, original, translation, level, word_type, source_forms, leitner_box, last_reviewed, correct_count, incorrect_count, created_at, user_added) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      vocab.id,
      vocab.content_id,
      vocab.original,
      vocab.translation,
      vocab.level,
      vocab.word_type,
      vocab.source_forms,
      vocab.leitner_box,
      vocab.last_reviewed,
      vocab.correct_count,
      vocab.incorrect_count,
      vocab.created_at,
      vocab.user_added,
    ],
  );
}

export function insertVocabularyBatch(db: SQLiteDatabase, vocabs: Vocabulary[]): number {
  let insertedBefore = 0;
  let insertedAfter = 0;
  db.withTransactionSync(() => {
    insertedBefore = (
      db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM vocabulary') ?? { cnt: 0 }
    ).cnt;
    for (const vocab of vocabs) {
      insertVocabulary(db, vocab);
    }
    insertedAfter = (
      db.getFirstSync<{ cnt: number }>('SELECT COUNT(*) as cnt FROM vocabulary') ?? { cnt: 0 }
    ).cnt;
  });
  return insertedAfter - insertedBefore;
}

export function recordReviewDay(db: SQLiteDatabase): void {
  const d = new Date();
  const dayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  db.runSync('INSERT OR IGNORE INTO review_days (day) VALUES (?)', [dayStr]);
}

export function getAllReviewDays(db: SQLiteDatabase): string[] {
  const rows = db.getAllSync<{ day: string }>('SELECT day FROM review_days ORDER BY day ASC');
  return rows.map((r) => r.day);
}

export function getReviewDaysForMonth(db: SQLiteDatabase, year: number, month: number): string[] {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
  const rows = db.getAllSync<{ day: string }>('SELECT day FROM review_days WHERE day LIKE ?', [
    `${prefix}%`,
  ]);
  return rows.map((r) => r.day);
}

export function updateVocabularyReview(
  db: SQLiteDatabase,
  id: string,
  leitnerBox: number,
  correct: boolean,
): void {
  const now = Date.now();
  if (correct) {
    db.runSync(
      'UPDATE vocabulary SET leitner_box = ?, last_reviewed = ?, correct_count = correct_count + 1 WHERE id = ?',
      [leitnerBox, now, id],
    );
  } else {
    db.runSync(
      'UPDATE vocabulary SET leitner_box = ?, last_reviewed = ?, incorrect_count = incorrect_count + 1 WHERE id = ?',
      [leitnerBox, now, id],
    );
  }
  recordReviewDay(db);
}

export function updateVocabularyFields(
  db: SQLiteDatabase,
  id: string,
  original: string,
  translation: string,
): void {
  db.runSync('UPDATE vocabulary SET original = ?, translation = ? WHERE id = ?', [
    original,
    translation,
    id,
  ]);
}

export function deleteVocabulary(db: SQLiteDatabase, id: string): void {
  db.runSync('DELETE FROM vocabulary WHERE id = ?', [id]);
}

export function deleteVocabularyByContentId(db: SQLiteDatabase, contentId: string): void {
  db.runSync('DELETE FROM vocabulary WHERE content_id = ?', [contentId]);
}

export function getVocabularyStats(db: SQLiteDatabase): {
  total: number;
  byBox: Record<number, number>;
  learnedToday: number;
  learnedThisWeek: number;
} {
  const total =
    db.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM vocabulary')?.count ?? 0;

  const boxRows = db.getAllSync<{ leitner_box: number; count: number }>(
    'SELECT leitner_box, COUNT(*) as count FROM vocabulary GROUP BY leitner_box',
  );
  const byBox: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of boxRows) {
    byBox[row.leitner_box] = row.count;
  }

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = todayStart - 6 * 86400000;

  const learnedToday =
    db.getFirstSync<{ count: number }>(
      'SELECT COUNT(*) as count FROM vocabulary WHERE last_reviewed >= ?',
      [todayStart],
    )?.count ?? 0;

  const learnedThisWeek =
    db.getFirstSync<{ count: number }>(
      'SELECT COUNT(*) as count FROM vocabulary WHERE last_reviewed >= ?',
      [weekStart],
    )?.count ?? 0;

  return { total, byBox, learnedToday, learnedThisWeek };
}

export function clearAllData(db: SQLiteDatabase): void {
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM vocabulary');
    db.runSync('DELETE FROM contents');
    db.runSync('DELETE FROM settings');
    db.runSync('DELETE FROM review_days');
    db.runSync('DELETE FROM content_adds_log');
  });
}

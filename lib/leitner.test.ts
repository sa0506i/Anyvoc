/**
 * Leitner system unit tests.
 *
 * Pure logic tests — no database, no emulator. Covers scheduling,
 * box promotion/demotion, round selection, streaks, and statistics.
 */

import {
  isDueForReview,
  getCardsForReview,
  selectRound,
  promoteBox,
  demoteBox,
  getStreakDays,
  getKnownPercentage,
  getBestStreak,
  getAveragePerDay,
} from './leitner';
import type { Vocabulary } from './database';

// --- Helpers ---

function makeVocab(overrides: Partial<Vocabulary> = {}): Vocabulary {
  return {
    id: 'v1',
    content_id: 'c1',
    original: 'Hund',
    translation: 'dog',
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

const DAY = 24 * 60 * 60 * 1000;

// --- isDueForReview ---

describe('isDueForReview', () => {
  it('never-reviewed cards are always due', () => {
    expect(isDueForReview(makeVocab({ last_reviewed: null }))).toBe(true);
  });

  it('box 1 is due after 1 day', () => {
    const now = Date.now();
    const reviewed = now - 1 * DAY - 1; // 1 day + 1ms ago
    expect(isDueForReview(makeVocab({ leitner_box: 1, last_reviewed: reviewed }), now)).toBe(true);
  });

  it('box 1 is NOT due before 1 day', () => {
    const now = Date.now();
    const reviewed = now - 0.5 * DAY; // 12 hours ago
    expect(isDueForReview(makeVocab({ leitner_box: 1, last_reviewed: reviewed }), now)).toBe(false);
  });

  it('box 2 is due after 2 days', () => {
    const now = Date.now();
    expect(isDueForReview(makeVocab({ leitner_box: 2, last_reviewed: now - 2 * DAY }), now)).toBe(
      true,
    );
    expect(isDueForReview(makeVocab({ leitner_box: 2, last_reviewed: now - 1 * DAY }), now)).toBe(
      false,
    );
  });

  it('box 3 is due after 4 days', () => {
    const now = Date.now();
    expect(isDueForReview(makeVocab({ leitner_box: 3, last_reviewed: now - 4 * DAY }), now)).toBe(
      true,
    );
    expect(isDueForReview(makeVocab({ leitner_box: 3, last_reviewed: now - 3 * DAY }), now)).toBe(
      false,
    );
  });

  it('box 4 is due after 8 days', () => {
    const now = Date.now();
    expect(isDueForReview(makeVocab({ leitner_box: 4, last_reviewed: now - 8 * DAY }), now)).toBe(
      true,
    );
    expect(isDueForReview(makeVocab({ leitner_box: 4, last_reviewed: now - 7 * DAY }), now)).toBe(
      false,
    );
  });

  it('box 5 is due after 16 days', () => {
    const now = Date.now();
    expect(isDueForReview(makeVocab({ leitner_box: 5, last_reviewed: now - 16 * DAY }), now)).toBe(
      true,
    );
    expect(isDueForReview(makeVocab({ leitner_box: 5, last_reviewed: now - 15 * DAY }), now)).toBe(
      false,
    );
  });

  it('unknown box falls back to box 1 interval', () => {
    const now = Date.now();
    expect(isDueForReview(makeVocab({ leitner_box: 99, last_reviewed: now - 1 * DAY }), now)).toBe(
      true,
    );
  });
});

// --- getCardsForReview ---

describe('getCardsForReview', () => {
  it('returns only due cards', () => {
    const now = Date.now();
    const due = makeVocab({ id: 'due', last_reviewed: null });
    const notDue = makeVocab({ id: 'not-due', leitner_box: 5, last_reviewed: now });
    expect(getCardsForReview([due, notDue]).map((v) => v.id)).toEqual(['due']);
  });

  it('returns empty array when nothing is due', () => {
    const now = Date.now();
    const recent = makeVocab({ last_reviewed: now });
    expect(getCardsForReview([recent])).toEqual([]);
  });
});

// --- selectRound ---

describe('selectRound', () => {
  it('prioritises lower boxes', () => {
    const cards = [
      makeVocab({ id: 'box3', leitner_box: 3, last_reviewed: null }),
      makeVocab({ id: 'box1', leitner_box: 1, last_reviewed: null }),
      makeVocab({ id: 'box2', leitner_box: 2, last_reviewed: null }),
    ];
    const round = selectRound(cards, 3);
    expect(round.map((v) => v.id)).toEqual(['box1', 'box2', 'box3']);
  });

  it('within same box, prioritises oldest reviewed', () => {
    const cards = [
      makeVocab({ id: 'recent', leitner_box: 1, last_reviewed: 2000 }),
      makeVocab({ id: 'old', leitner_box: 1, last_reviewed: 1000 }),
      makeVocab({ id: 'never', leitner_box: 1, last_reviewed: null }),
    ];
    const round = selectRound(cards, 3);
    expect(round.map((v) => v.id)).toEqual(['never', 'old', 'recent']);
  });

  it('limits to count parameter', () => {
    const cards = Array.from({ length: 50 }, (_, i) =>
      makeVocab({ id: `v${i}`, last_reviewed: null }),
    );
    expect(selectRound(cards, 20)).toHaveLength(20);
  });

  it('defaults to 20 cards', () => {
    const cards = Array.from({ length: 30 }, (_, i) =>
      makeVocab({ id: `v${i}`, last_reviewed: null }),
    );
    expect(selectRound(cards)).toHaveLength(20);
  });

  it('returns all if fewer than count', () => {
    const cards = [makeVocab({ id: 'only' })];
    expect(selectRound(cards, 20)).toHaveLength(1);
  });

  it('does not mutate the input array', () => {
    const cards = [makeVocab({ id: 'b', leitner_box: 2 }), makeVocab({ id: 'a', leitner_box: 1 })];
    const original = cards.map((c) => c.id);
    selectRound(cards);
    expect(cards.map((c) => c.id)).toEqual(original);
  });
});

// --- promoteBox / demoteBox ---

describe('promoteBox / demoteBox', () => {
  it('promotes by 1', () => {
    expect(promoteBox(1)).toBe(2);
    expect(promoteBox(3)).toBe(4);
  });

  it('caps at box 5', () => {
    expect(promoteBox(5)).toBe(5);
  });

  it('demote always returns 1', () => {
    expect(demoteBox()).toBe(1);
  });
});

// --- getStreakDays ---

describe('getStreakDays', () => {
  it('returns 0 for empty vocab', () => {
    expect(getStreakDays([])).toBe(0);
  });

  it('returns 0 if no reviews exist', () => {
    expect(getStreakDays([makeVocab({ last_reviewed: null })])).toBe(0);
  });

  it('returns 1 if reviewed today', () => {
    const today = Date.now();
    expect(getStreakDays([makeVocab({ last_reviewed: today })])).toBe(1);
  });

  it('counts consecutive days', () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    const yesterday = today - DAY;
    const dayBefore = today - 2 * DAY;

    const vocabs = [
      makeVocab({ id: 'v1', last_reviewed: today }),
      makeVocab({ id: 'v2', last_reviewed: yesterday }),
      makeVocab({ id: 'v3', last_reviewed: dayBefore }),
    ];
    expect(getStreakDays(vocabs)).toBe(3);
  });

  it('breaks streak on gap', () => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12).getTime();
    const threeDaysAgo = today - 3 * DAY;

    const vocabs = [
      makeVocab({ id: 'v1', last_reviewed: today }),
      makeVocab({ id: 'v2', last_reviewed: threeDaysAgo }),
    ];
    expect(getStreakDays(vocabs)).toBe(1);
  });
});

// --- getKnownPercentage ---

describe('getKnownPercentage', () => {
  it('returns 0 for empty', () => {
    expect(getKnownPercentage([])).toBe(0);
  });

  it('counts box 4 and 5 as known', () => {
    const vocabs = [
      makeVocab({ leitner_box: 1 }),
      makeVocab({ leitner_box: 3 }),
      makeVocab({ leitner_box: 4 }),
      makeVocab({ leitner_box: 5 }),
    ];
    expect(getKnownPercentage(vocabs)).toBe(50); // 2/4
  });
});

// --- getBestStreak ---

describe('getBestStreak', () => {
  it('returns 0 for empty', () => {
    expect(getBestStreak([])).toBe(0);
  });

  it('returns 1 for single day', () => {
    expect(getBestStreak(['2025-01-15'])).toBe(1);
  });

  it('counts consecutive days', () => {
    expect(getBestStreak(['2025-01-13', '2025-01-14', '2025-01-15'])).toBe(3);
  });

  it('finds best streak with gaps', () => {
    expect(
      getBestStreak([
        '2025-01-01',
        '2025-01-02', // streak of 2
        '2025-01-10',
        '2025-01-11',
        '2025-01-12',
        '2025-01-13', // streak of 4
        '2025-01-20', // streak of 1
      ]),
    ).toBe(4);
  });

  it('handles duplicate days', () => {
    expect(getBestStreak(['2025-01-01', '2025-01-01', '2025-01-02'])).toBe(2);
  });
});

// --- getAveragePerDay ---

describe('getAveragePerDay', () => {
  it('returns 0 when no review days', () => {
    expect(getAveragePerDay([makeVocab()], 0)).toBe(0);
  });

  it('calculates total reviews / days', () => {
    const vocabs = [
      makeVocab({ correct_count: 5, incorrect_count: 1 }),
      makeVocab({ correct_count: 3, incorrect_count: 1 }),
    ];
    // (5+1+3+1) = 10 reviews over 5 days = 2.0
    expect(getAveragePerDay(vocabs, 5)).toBe(2);
  });

  it('rounds to 1 decimal', () => {
    const vocabs = [makeVocab({ correct_count: 1, incorrect_count: 0 })];
    // 1 review / 3 days = 0.333... → 0.3
    expect(getAveragePerDay(vocabs, 3)).toBe(0.3);
  });
});

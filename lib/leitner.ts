import type { Vocabulary } from './database';

// Leitner box intervals in milliseconds
const BOX_INTERVALS: Record<number, number> = {
  1: 1 * 24 * 60 * 60 * 1000,   // 1 day
  2: 2 * 24 * 60 * 60 * 1000,   // 2 days
  3: 4 * 24 * 60 * 60 * 1000,   // 4 days
  4: 8 * 24 * 60 * 60 * 1000,   // 8 days
  5: 16 * 24 * 60 * 60 * 1000,  // 16 days
};

export function isDueForReview(vocab: Vocabulary, now: number = Date.now()): boolean {
  // Never reviewed → always due
  if (vocab.last_reviewed === null) return true;

  const interval = BOX_INTERVALS[vocab.leitner_box] ?? BOX_INTERVALS[1];
  return now - vocab.last_reviewed >= interval;
}

export function getCardsForReview(allVocab: Vocabulary[]): Vocabulary[] {
  const now = Date.now();
  return allVocab.filter((v) => isDueForReview(v, now));
}

export function selectRound(dueCards: Vocabulary[], count: number = 20): Vocabulary[] {
  // Sort by box (lower boxes first = higher priority), then by last_reviewed (oldest first)
  const sorted = [...dueCards].sort((a, b) => {
    if (a.leitner_box !== b.leitner_box) return a.leitner_box - b.leitner_box;
    const aReviewed = a.last_reviewed ?? 0;
    const bReviewed = b.last_reviewed ?? 0;
    return aReviewed - bReviewed;
  });

  return sorted.slice(0, count);
}

export function promoteBox(currentBox: number): number {
  return Math.min(currentBox + 1, 5);
}

export function demoteBox(): number {
  return 1;
}

export function getStreakDays(allVocab: Vocabulary[]): number {
  if (allVocab.length === 0) return 0;

  // Get unique days (in local timezone) where reviews happened
  const reviewDays = new Set<string>();
  for (const v of allVocab) {
    if (v.last_reviewed !== null) {
      const date = new Date(v.last_reviewed);
      reviewDays.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
    }
  }

  if (reviewDays.size === 0) return 0;

  // Count consecutive days ending today
  let streak = 0;
  const now = new Date();
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  while (true) {
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    if (reviewDays.has(key)) {
      streak++;
      day.setDate(day.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

export function getKnownPercentage(allVocab: Vocabulary[]): number {
  if (allVocab.length === 0) return 0;
  const known = allVocab.filter((v) => v.leitner_box >= 4).length;
  return Math.round((known / allVocab.length) * 100);
}

export function getBestStreak(reviewDays: string[]): number {
  if (reviewDays.length === 0) return 0;

  // reviewDays should be sorted YYYY-MM-DD strings
  let best = 1;
  let current = 1;

  for (let i = 1; i < reviewDays.length; i++) {
    const prev = new Date(reviewDays[i - 1]);
    const curr = new Date(reviewDays[i]);
    const diffMs = curr.getTime() - prev.getTime();
    const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));

    if (diffDays === 1) {
      current++;
      if (current > best) best = current;
    } else if (diffDays > 1) {
      current = 1;
    }
    // diffDays === 0 means duplicate day, skip
  }

  return best;
}

export function getAveragePerDay(allVocab: Vocabulary[], totalReviewDays: number): number {
  if (totalReviewDays === 0) return 0;
  const totalReviews = allVocab.reduce(
    (sum, v) => sum + v.correct_count + v.incorrect_count,
    0
  );
  return Math.round((totalReviews / totalReviewDays) * 10) / 10;
}

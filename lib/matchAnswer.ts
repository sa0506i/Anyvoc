/**
 * Local answer matching for the typing quiz mode.
 * Pure string comparison — no network, no LLM. Must stay offline.
 */

export type MatchResult = {
  match: 'exact' | 'tolerant' | 'none';
  expected: string;
};

/** Articles to strip for tolerant matching (all lowercase). */
const ARTICLES = new Set([
  // German
  'der',
  'die',
  'das',
  'ein',
  'eine',
  // French
  'le',
  'la',
  'les',
  "l'",
  'un',
  'une',
  // Spanish
  'el',
  'los',
  'las',
  // Italian
  'il',
  'lo',
  'gli',
  // Portuguese
  'o',
  'a',
  'os',
  'as',
  'um',
  'uma',
  // Dutch
  'de',
  'het',
  'een',
  // Scandinavian
  'en',
  'ett',
]);

/** Normalize a string for comparison: trim, collapse whitespace, lowercase, NFC. */
function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase().normalize('NFC');
}

/** Strip a leading article from a normalized string. */
function stripArticle(s: string): string {
  // Handle l' (French elision)
  if (s.startsWith("l'")) return s.slice(2).trimStart();

  const spaceIdx = s.indexOf(' ');
  if (spaceIdx === -1) return s;

  const firstWord = s.slice(0, spaceIdx);
  if (ARTICLES.has(firstWord)) return s.slice(spaceIdx + 1).trimStart();

  return s;
}

/** Split comma-separated parts and normalize each. */
function commaParts(s: string): string[] {
  return s.split(',').map((p) => normalize(p));
}

/** Levenshtein distance between two strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/**
 * Check if `input` matches `expected` with tolerance rules.
 *
 * Matching chain (first match wins):
 * 1. Exact match after normalization
 * 2. Input matches one comma-separated part of expected
 * 3. Article-tolerant: input without article matches expected without article
 * 4. Levenshtein ≤1 on words ≥5 chars (per comma-part, after article stripping)
 */
export function matchAnswer(userInput: string, expected: string): MatchResult {
  const result: MatchResult = { match: 'none', expected };

  const normInput = normalize(userInput);
  const normExpected = normalize(expected);

  if (!normInput) return result;

  // Rule 1: Exact match
  if (normInput === normExpected) {
    return { match: 'exact', expected };
  }

  // Rule 2: Input matches one comma-separated part
  const parts = commaParts(expected);
  if (parts.some((part) => normInput === part)) {
    return { match: 'tolerant', expected };
  }

  // Rule 3: Article tolerance
  const inputStripped = stripArticle(normInput);
  const expectedStripped = stripArticle(normExpected);

  if (inputStripped === expectedStripped) {
    return { match: 'tolerant', expected };
  }

  // Also check article-stripped against each comma-part
  const partsStripped = parts.map((p) => stripArticle(p));
  if (partsStripped.some((part) => inputStripped === part)) {
    return { match: 'tolerant', expected };
  }

  // Rule 4: Levenshtein ≤1 on words ≥5 chars
  const candidates = [expectedStripped, ...partsStripped];
  for (const candidate of candidates) {
    if (candidate.length >= 5 && inputStripped.length >= 5) {
      if (levenshtein(inputStripped, candidate) <= 1) {
        return { match: 'tolerant', expected };
      }
    }
  }

  return result;
}

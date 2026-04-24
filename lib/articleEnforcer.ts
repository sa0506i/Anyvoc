/**
 * Article Enforcer — post-processing step that adds/normalises the
 * INDEFINITE article on noun entries returned by the LLM.
 *
 * Why this exists: mistral-small-2506 occasionally ignores the prompt's
 * INDEF-only rule for certain text registers (first-person narrative,
 * Romance texts with many contracted prepositions like `na/da/ao`, photo
 * OCR of informal prose). The prompt says "normalize every noun to INDEF"
 * three times, but the small model falls back to bare lemmata when the
 * source text itself uses DEFINITE articles or contractions. Rather than
 * fight prompt-dilution, we normalise in code: deterministic, offline,
 * ~zero cost.
 *
 * Algorithm (per noun entry):
 *   1. If `original` already has the INDEF article — return as-is.
 *   2. If `original` has the DEF article — strip it, derive gender,
 *      prepend INDEF of matching gender.
 *   3. Bare input:
 *      a) Scan `sourceText` for any `sourceForm` preceded by a known
 *         article / contraction; derive gender from the article.
 *      b) Fallback: per-language ending heuristic (PT -ção/-são → fem, etc.).
 *      c) If neither yields a confident gender — leave bare (safety).
 *
 * For German the ending heuristic is skipped (DE gender is too irregular
 * to guess); we only upgrade DE nouns when the source text carries a
 * detectable article. For Polish/Czech the function is a no-op (bare is
 * correct — those languages have no articles).
 *
 * Rule 47 (revised 2026-04-24) — pure-INDEF extraction. This module is
 * the safety-net that catches LLM failures to follow the prompt. Purely
 * offline, no I/O, no DB, no expo-*.
 */

type Gender = 'm' | 'f' | 'n' | 'c'; // masc, fem, neuter, common (Scandi en-gender)

// ─── Per-language article profiles ────────────────────────────────────────

interface ArticleProfile {
  /** True when `original` already carries a valid INDEF article/prefix. */
  hasIndef(original: string): boolean;
  /** True when `original` carries a DEF article/prefix. */
  hasDef(original: string): boolean;
  /** Strip the leading DEF article and return the remaining noun + detected gender. */
  stripDef(original: string): { noun: string; gender: Gender } | null;
  /** Build "INDEF + noun" string for the given gender. */
  buildIndef(noun: string, gender: Gender): string;
  /** Derive gender from an article/contraction token found in source text. */
  articleToGender(articleToken: string): Gender | null;
  /** Regex alternation of single-word article/contraction tokens (lowercased)
   *  — used to scan source text for article-then-noun pairs. Multi-word
   *  contractions (FR "de la", "à la") are deliberately excluded; the
   *  stand-alone tokens cover the common cases. */
  articleAlternation: string;
  /** Per-language ending heuristic fallback when source scan finds nothing.
   *  Return null to skip heuristic (DE, FR). */
  guessByEnding(noun: string): Gender | null;
  /** Default gender when no signal at all is available. Return null to
   *  leave bare (DE, FR). */
  defaultGender: Gender | null;
}

// ── Portuguese ──────────────────────────────────────────────────────────
const PT_EXCEPTIONS_MASC = new Set([
  'dia',
  'mapa',
  'problema',
  'sistema',
  'tema',
  'programa',
  'planeta',
  'clima',
  'cinema',
  'drama',
  'poema',
  'teorema',
  'idioma',
  'aroma',
  'diploma',
  'fantasma',
  'telefonema',
]);
const PT_EXCEPTIONS_FEM = new Set(['mão', 'tribo', 'libido', 'foto', 'moto']);
const pt: ArticleProfile = {
  hasIndef: (s) => /^(um|uma)\s/i.test(s),
  hasDef: (s) => /^(o|a|os|as)\s/i.test(s),
  stripDef: (s) => {
    const m = s.match(/^(o|a|os|as)\s+(.+)$/i);
    if (!m) return null;
    const [, art, rest] = m;
    return { noun: rest, gender: /^(o|os)$/i.test(art!) ? 'm' : 'f' };
  },
  buildIndef: (n, g) => (g === 'f' ? 'uma' : 'um') + ' ' + n,
  articleToGender: (t) => {
    const low = t.toLowerCase();
    if (
      [
        'o',
        'os',
        'no',
        'nos',
        'do',
        'dos',
        'ao',
        'aos',
        'pelo',
        'pelos',
        'num',
        'nuns',
        'dum',
        'duns',
      ].includes(low)
    )
      return 'm';
    if (
      [
        'a',
        'as',
        'na',
        'nas',
        'da',
        'das',
        'à',
        'às',
        'pela',
        'pelas',
        'numa',
        'numas',
        'duma',
        'dumas',
      ].includes(low)
    )
      return 'f';
    return null;
  },
  articleAlternation:
    'o|a|os|as|no|na|nos|nas|do|da|dos|das|ao|aos|à|às|pelo|pela|pelos|pelas|num|numa|nuns|numas|dum|duma|duns|dumas',
  guessByEnding: (noun) => {
    const n = noun.toLowerCase();
    if (PT_EXCEPTIONS_MASC.has(n)) return 'm';
    if (PT_EXCEPTIONS_FEM.has(n)) return 'f';
    if (/(ção|são|dade|tade|tude|ice|agem|eza|ez|ie|ã)$/.test(n)) return 'f';
    if (/(ma|ema)$/.test(n)) return 'm'; // Greek-origin -ma (problema, tema)
    if (/a$/.test(n)) return 'f';
    // Default masculine for all other endings (o, r, l, z, u, consonant)
    return 'm';
  },
  defaultGender: 'm',
};

// ── Spanish ────────────────────────────────────────────────────────────
const ES_EXCEPTIONS_MASC = new Set([
  'día',
  'mapa',
  'problema',
  'sistema',
  'tema',
  'programa',
  'planeta',
  'clima',
  'idioma',
  'poema',
  'drama',
]);
const ES_EXCEPTIONS_FEM = new Set(['mano', 'foto', 'moto', 'radio']);
const es: ArticleProfile = {
  hasIndef: (s) => /^(un|una|unos|unas)\s/i.test(s),
  hasDef: (s) => /^(el|la|los|las|lo)\s/i.test(s),
  stripDef: (s) => {
    const m = s.match(/^(el|la|los|las|lo)\s+(.+)$/i);
    if (!m) return null;
    const [, art, rest] = m;
    return { noun: rest, gender: /^(el|los|lo)$/i.test(art!) ? 'm' : 'f' };
  },
  buildIndef: (n, g) => (g === 'f' ? 'una' : 'un') + ' ' + n,
  articleToGender: (t) => {
    const low = t.toLowerCase();
    if (['el', 'los', 'lo', 'al', 'del', 'un', 'unos'].includes(low)) return 'm';
    if (['la', 'las', 'una', 'unas'].includes(low)) return 'f';
    return null;
  },
  articleAlternation: 'el|la|los|las|lo|al|del|un|una|unos|unas',
  guessByEnding: (noun) => {
    const n = noun.toLowerCase();
    if (ES_EXCEPTIONS_MASC.has(n)) return 'm';
    if (ES_EXCEPTIONS_FEM.has(n)) return 'f';
    if (/(ción|sión|dad|tad|tud|umbre|ez|ía)$/.test(n)) return 'f';
    if (/(ma|ema)$/.test(n)) return 'm';
    if (/a$/.test(n)) return 'f';
    return 'm';
  },
  defaultGender: 'm',
};

// ── Italian ────────────────────────────────────────────────────────────
const it: ArticleProfile = {
  hasIndef: (s) => /^(un\s|uno\s|una\s|un')/i.test(s),
  hasDef: (s) => /^(il\s|lo\s|la\s|i\s|gli\s|le\s|l')/i.test(s),
  stripDef: (s) => {
    const m = s.match(/^(il\s+|lo\s+|la\s+|i\s+|gli\s+|le\s+|l')(.+)$/i);
    if (!m) return null;
    const [, art, rest] = m;
    const a = art!.trim().toLowerCase();
    if (a === 'la') return { noun: rest, gender: 'f' };
    if (a === "l'") return null; // elision is gender-ambiguous (l'amica vs l'amico)
    return { noun: rest, gender: 'm' };
  },
  buildIndef: (n, g) => {
    if (g === 'f') return (/^[aeiouAEIOU]/.test(n) ? "un'" : 'una ') + n;
    // Masc: uno before s+consonant, z, gn, ps, x, y; else un
    if (/^(s[bcdfghjklmnpqrstvwxz]|z|gn|ps|x|y)/i.test(n)) return 'uno ' + n;
    return 'un ' + n;
  },
  articleToGender: (t) => {
    const low = t.toLowerCase().replace(/'$/, '');
    if (
      [
        'il',
        'lo',
        'i',
        'gli',
        'un',
        'uno',
        'del',
        'dello',
        'dei',
        'degli',
        'al',
        'allo',
        'ai',
        'agli',
        'nel',
        'nello',
        'nei',
        'negli',
        'dal',
        'dallo',
        'dai',
        'dagli',
        'sul',
        'sullo',
        'sui',
        'sugli',
      ].includes(low)
    )
      return 'm';
    if (
      [
        'la',
        'le',
        'una',
        'della',
        'delle',
        'alla',
        'alle',
        'nella',
        'nelle',
        'dalla',
        'dalle',
        'sulla',
        'sulle',
      ].includes(low)
    )
      return 'f';
    if (low === 'l') return null; // ambiguous l'
    return null;
  },
  articleAlternation:
    "il|lo|la|i|gli|le|l'|un|uno|una|un'|del|dello|della|dei|degli|delle|al|allo|alla|ai|agli|alle|nel|nello|nella|nei|negli|nelle|dal|dallo|dalla|dai|dagli|dalle|sul|sullo|sulla|sui|sugli|sulle",
  guessByEnding: (noun) => {
    const n = noun.toLowerCase();
    if (/(zione|sione|tà|tù|ie|gine|trice|ite)$/.test(n)) return 'f';
    if (/(ma|ema)$/.test(n)) return 'm'; // Greek-origin
    if (/a$/.test(n)) return 'f';
    if (/o$/.test(n)) return 'm';
    return 'm';
  },
  defaultGender: 'm',
};

// ── French ─────────────────────────────────────────────────────────────
const fr: ArticleProfile = {
  hasIndef: (s) => /^(un\s|une\s|un'|une')/i.test(s),
  hasDef: (s) => /^(le\s|la\s|les\s|l')/i.test(s),
  stripDef: (s) => {
    const m = s.match(/^(le\s+|la\s+|les\s+|l')(.+)$/i);
    if (!m) return null;
    const [, art, rest] = m;
    const a = art!.trim().toLowerCase();
    if (a === 'le') return { noun: rest, gender: 'm' };
    if (a === 'la') return { noun: rest, gender: 'f' };
    // les/l' — ambiguous, skip
    return null;
  },
  buildIndef: (n, g) => (g === 'f' ? 'une' : 'un') + ' ' + n,
  articleToGender: (t) => {
    const low = t.toLowerCase().replace(/'$/, '');
    if (['le', 'un', 'du', 'au', 'ce', 'cet', 'mon', 'son', 'ton'].includes(low)) return 'm';
    if (['la', 'une', 'cette', 'ma', 'sa', 'ta'].includes(low)) return 'f';
    return null;
  },
  articleAlternation: "le|la|les|l'|un|une|du|des|au|aux",
  guessByEnding: (noun) => {
    const n = noun.toLowerCase();
    // FR endings are more irregular — only confident cases, else null.
    if (/(tion|sion|ance|ence|ée|ette|esse|aison|ude|té|rie|ie|ure|eur)$/.test(n)) return 'f';
    if (/(age|eau|ment|isme|scope|phone|gramme|mètre)$/.test(n)) return 'm';
    // Everything else (ambiguous -e, foreign words, unknown endings) → leave bare
    return null;
  },
  defaultGender: null, // don't guess blindly for FR
};

// ── German ─────────────────────────────────────────────────────────────
const de: ArticleProfile = {
  hasIndef: (s) => /^(ein|eine)\s/i.test(s),
  hasDef: (s) => /^(der|die|das)\s/i.test(s),
  stripDef: (s) => {
    const m = s.match(/^(der|die|das)\s+(.+)$/i);
    if (!m) return null;
    const [, art, rest] = m;
    const a = art!.toLowerCase();
    if (a === 'der') return { noun: rest, gender: 'm' };
    if (a === 'die') return { noun: rest, gender: 'f' };
    return { noun: rest, gender: 'n' };
  },
  buildIndef: (n, g) => (g === 'f' ? 'eine' : 'ein') + ' ' + n, // ein for m+n, eine for f
  articleToGender: (t) => {
    const low = t.toLowerCase();
    if (['der', 'den', 'dem', 'des', 'ein', 'einen', 'einem', 'eines'].includes(low)) return 'm';
    if (['die', 'eine', 'einer'].includes(low)) return 'f';
    if (['das'].includes(low)) return 'n';
    return null;
  },
  articleAlternation: 'der|die|das|den|dem|des|ein|eine|einen|einem|einer|eines',
  guessByEnding: () => null, // DE gender is too irregular for safe ending-based guessing
  defaultGender: null,
};

// ── Dutch ──────────────────────────────────────────────────────────────
const nl: ArticleProfile = {
  hasIndef: (s) => /^een\s/i.test(s),
  hasDef: (s) => /^(de|het)\s/i.test(s),
  stripDef: (s) => {
    const m = s.match(/^(de|het)\s+(.+)$/i);
    if (!m) return null;
    // NL INDEF is ungendered (een), so gender doesn't matter here
    return { noun: m[2]!, gender: 'c' };
  },
  buildIndef: (n) => 'een ' + n, // universal
  articleToGender: (t) => (['de', 'het', 'een'].includes(t.toLowerCase()) ? 'c' : null),
  articleAlternation: 'de|het|een',
  guessByEnding: () => 'c', // any noun gets een
  defaultGender: 'c',
};

// ── English ────────────────────────────────────────────────────────────
const VOWEL_SOUND = /^[aeiouAEIOU]/;
const SPECIAL_AN = /^(hour|honest|honor|honour|heir|MBA|FBI|SUV|RSVP)/i; // starts with silent h or is acronym starting with vowel sound
const SPECIAL_A = /^(university|universal|uniform|unit|utopia|useful|user|eu|euro|once|one)/i;
function enArticle(noun: string): string {
  if (SPECIAL_AN.test(noun)) return 'an';
  if (SPECIAL_A.test(noun)) return 'a';
  return VOWEL_SOUND.test(noun) ? 'an' : 'a';
}
const en: ArticleProfile = {
  hasIndef: (s) => /^(a|an)\s/i.test(s),
  hasDef: (s) => /^the\s/i.test(s),
  stripDef: (s) => {
    const m = s.match(/^the\s+(.+)$/i);
    return m ? { noun: m[1]!, gender: 'c' } : null;
  },
  buildIndef: (n) => enArticle(n) + ' ' + n,
  articleToGender: () => 'c',
  articleAlternation: 'the|a|an',
  guessByEnding: () => 'c',
  defaultGender: 'c',
};

// ── Scandinavian (sv, no, da) ──────────────────────────────────────────
/** Scandi INDEF prefixes: en (common) / ett (neuter). SV + DA use en/ett;
 *  NO uses en/ei/et. We default to common gender ("en") when no source
 *  signal is available — empirically the correct form for ~70% of Scandi
 *  nouns in general text. */
function scandiProfile(_code: 'sv' | 'no' | 'da'): ArticleProfile {
  return {
    hasIndef: (s) => /^(en|ett|ei|et)\s/i.test(s),
    hasDef: () => false, // suffix-def is already stripped by our prompt; don't try to recover
    stripDef: () => null,
    buildIndef: (n, g) => {
      if (g === 'n') return 'ett ' + n;
      return 'en ' + n;
    },
    articleToGender: (t) => {
      const low = t.toLowerCase();
      if (['ett', 'et'].includes(low)) return 'n';
      if (['en', 'ei'].includes(low)) return 'c';
      return null;
    },
    articleAlternation: 'en|ett|ei|et',
    guessByEnding: () => 'c', // common-gender fallback
    defaultGender: 'c',
  };
}

const PROFILES: Record<string, ArticleProfile> = {
  pt,
  es,
  it,
  fr,
  de,
  nl,
  en,
  sv: scandiProfile('sv'),
  no: scandiProfile('no'),
  da: scandiProfile('da'),
  // pl, cs: no profile — bare is correct, function is a no-op
};

// ─── Source-text scanning ───────────────────────────────────────────────

/**
 * Scan `sourceText` for occurrences of any `sourceForms` or the bare noun
 * preceded by a known article/contraction token. Returns the most
 * commonly observed gender, or null if nothing conclusive is found.
 *
 * Apostrophe-elision handling: "l'annee" and "l'uovo" count as
 * article-present — we split on the apostrophe.
 */
function findGenderInSource(
  bareNoun: string,
  sourceForms: string[],
  sourceText: string,
  profile: ArticleProfile,
): Gender | null {
  if (!sourceText || sourceText.length < 2) return null;
  const forms = new Set<string>([bareNoun.toLowerCase()]);
  for (const f of sourceForms) {
    if (f) forms.add(f.toLowerCase());
  }
  // Build regex: (article) (whitespace or apostrophe) (form)
  // Use word boundaries on the article side; the form match is case-insensitive.
  const articlePat = profile.articleAlternation;
  const formsPat = Array.from(forms)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .sort((a, b) => b.length - a.length) // longest-first to avoid partial matches
    .join('|');
  const re = new RegExp(`(^|[^\\p{L}])(${articlePat})(['\\s]+)(${formsPat})(?=$|[^\\p{L}])`, 'giu');
  const counts: Record<Gender, number> = { m: 0, f: 0, n: 0, c: 0 };
  let match: RegExpExecArray | null;
  let seen = 0;
  while ((match = re.exec(sourceText)) !== null) {
    const article = match[2]!;
    const g = profile.articleToGender(article);
    if (g) {
      counts[g]++;
      seen++;
    }
    if (seen >= 5) break; // stop after a few hits
  }
  if (seen === 0) return null;
  // Return most common gender
  const order: Gender[] = ['m', 'f', 'n', 'c'];
  return order.reduce((best, g) => (counts[g] > counts[best] ? g : best), order[0]);
}

// ─── Main entry point ───────────────────────────────────────────────────

/**
 * Normalise the `original` field of a noun vocabulary entry to carry its
 * language-appropriate INDEF article. Returns the corrected string (or
 * the input unchanged if no correction is applicable or confident).
 *
 * Handles comma-separated m/f pairs (`der Arzt, die Ärztin`) by
 * processing each part independently.
 *
 * @param original    The noun as returned by the LLM (may be bare, DEF, or already INDEF)
 * @param sourceForms Inflected surface forms from the source text (for scanning)
 * @param sourceText  The full source text (for article-context scanning)
 * @param learnLang   ISO language code of the learning language
 */
export function ensureIndefArticle(
  original: string,
  sourceForms: string[],
  sourceText: string,
  learnLang: string,
): string {
  const profile = PROFILES[learnLang];
  if (!profile) return original; // pl, cs, unknown — no-op
  if (!original || !original.trim()) return original;

  // Handle m/f pairs (e.g. "der Arzt, die Ärztin") — process each part.
  if (original.includes(',')) {
    return original
      .split(',')
      .map((p) => processSingle(p.trim(), sourceForms, sourceText, profile))
      .join(', ');
  }
  return processSingle(original, sourceForms, sourceText, profile);
}

function processSingle(
  original: string,
  sourceForms: string[],
  sourceText: string,
  profile: ArticleProfile,
): string {
  const trimmed = original.trim();
  if (!trimmed) return original;

  // 1. Already INDEF → pass through
  if (profile.hasIndef(trimmed)) return trimmed;

  // 2. DEF → strip and rebuild INDEF. If gender is ambiguous (Romance
  //    elision `l'amica` / `l'après-midi` where gender can't be derived
  //    from `l'` alone), leave original unchanged — safer than guessing
  //    fem and mis-gendering masculine elision nouns like `l'amico`.
  if (profile.hasDef(trimmed)) {
    const stripped = profile.stripDef(trimmed);
    if (stripped) return profile.buildIndef(stripped.noun, stripped.gender);
    return original; // has article but ambiguous — preserve as-is
  }

  // 3. Bare — derive gender
  const bareNoun = trimmed;

  // 3a. Source-scan
  const srcGender = findGenderInSource(bareNoun, sourceForms, sourceText, profile);
  if (srcGender) return profile.buildIndef(bareNoun, srcGender);

  // 3b. Ending heuristic
  const endGender = profile.guessByEnding(bareNoun);
  if (endGender) return profile.buildIndef(bareNoun, endGender);

  // 3c. Default — or leave bare if no default
  if (profile.defaultGender) return profile.buildIndef(bareNoun, profile.defaultGender);

  return original;
}

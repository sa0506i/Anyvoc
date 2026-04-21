/**
 * analyze-validation-run.ts — deterministic QA pass over a try-pipeline
 * sweep dump. Reads the JSON, applies the canonical KPI set from
 * compare-sweeps.ts plus 20 new heuristics that target every Rule from
 * CLAUDE.md §"Vocabulary post-processing" / §"Vocabulary Formatting
 * Rules". Emits a single Markdown report on stdout.
 *
 * Usage:
 *   npx tsx scripts/analyze-validation-run.ts --in=tmp/validation/<run>.json
 *   npx tsx scripts/analyze-validation-run.ts --in=a.json --compare=b.json
 *
 * Pure Node — imports nothing from lib/ to stay tsx-safe without the
 * expo-constants shim. Frequency JSONs are loaded directly from
 * lib/data/freq_*.json (plain data, no runtime types needed).
 *
 * Dev-machine only. Never in EAS build.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

type Lang = 'de' | 'fr' | 'es' | 'it' | 'pt' | 'nl' | 'sv' | 'no' | 'da' | 'pl' | 'cs' | 'en';

interface VocabItem {
  original: string;
  translation: string;
  level: string;
  type: string;
  source_forms?: string[];
}

interface Result {
  url: string;
  lang: Lang;
  native: string;
  corpus?: { difficulty_estimate?: string; text_type?: string; domain?: string };
  ok: boolean;
  error?: string;
  title?: string;
  textLength?: number;
  processedTextLength?: number;
  truncated?: boolean;
  elapsedMs: number;
  vocabCount?: number;
  levelDistribution?: Record<string, number>;
  typeDistribution?: Record<string, number>;
  vocab?: VocabItem[];
}

interface Dump {
  ranAt?: string;
  mode?: string;
  seed?: number;
  maxChars?: number;
  natives?: string[];
  totals?: { combos?: number; ok?: number; failed?: number; vocab?: number; wallSec?: number };
  results: Result[];
}

// -------------------------------------------------------------------
// CLI
// -------------------------------------------------------------------

function parseArgs(): { ins: string[]; compare?: string } {
  const argv = process.argv.slice(2);
  const ins: string[] = [];
  let cmpPath: string | undefined;
  for (const a of argv) {
    const m = a.match(/^--(in|compare)=(.+)$/);
    if (m) {
      if (m[1] === 'in') ins.push(m[2]!);
      else if (m[1] === 'compare') cmpPath = m[2];
    }
  }
  if (ins.length === 0) {
    console.error(
      'Usage: analyze-validation-run --in=<path> [--compare=<path>]\n' +
        '       analyze-validation-run --in=<path1> --in=<path2> ...  (multi-native mode)',
    );
    process.exit(2);
  }
  return { ins, compare: cmpPath };
}

// -------------------------------------------------------------------
// Frequency loader (plain JSON — no classifier runtime needed).
// Maps first word → zipf (or 0 if absent).
// -------------------------------------------------------------------

const freqCache: Record<string, Map<string, number>> = {};

function loadFreq(lang: Lang): Map<string, number> {
  if (freqCache[lang]) return freqCache[lang]!;
  const p = path.resolve(__dirname, '..', 'lib', 'data', `freq_${lang}.json`);
  if (!fs.existsSync(p)) {
    freqCache[lang] = new Map();
    return freqCache[lang]!;
  }
  const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as { keys: string[]; values: number[] };
  const map = new Map<string, number>();
  for (let i = 0; i < raw.keys.length; i++) map.set(raw.keys[i]!, raw.values[i]!);
  freqCache[lang] = map;
  return map;
}

// Mirror lib/classifier/features.ts normaliseLookupKey (whitespace article
// strip + apostrophe elision strip). Loosely; full classifier not imported.
const ARTICLE_PREFIXES = new Set([
  'the',
  'a',
  'an',
  'to',
  'zu',
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einen',
  'einem',
  'eines',
  'einer',
  'le',
  'la',
  'les',
  "l'",
  'l',
  'un',
  'une',
  'des',
  'du',
  'el',
  'los',
  'las',
  'unos',
  'unas',
  'una',
  'il',
  'lo',
  'i',
  'gli',
  'uno',
  'o',
  'os',
  'as',
  'um',
  'uma',
  'uns',
  'umas',
  'de',
  'het',
  'een',
  'te',
  'en',
  'ei',
  'ett',
  'et',
  'det',
  'att',
  'å',
  'at',
  'sich',
  'se',
  'si',
]);

function normaliseLookupKey(word: string): string {
  const first = word.split(',')[0]!.trim().toLowerCase();
  const toks = first.split(/\s+/).filter(Boolean);
  const afterWs =
    toks.length > 1 && ARTICLE_PREFIXES.has(toks[0]!) ? toks.slice(1).join(' ') : first;
  return afterWs.replace(/^[a-zà-ÿ]'/i, '');
}

function zipfOf(lang: Lang, word: string): number {
  return loadFreq(lang).get(normaliseLookupKey(word)) ?? 0;
}

// -------------------------------------------------------------------
// KPI heuristics (copied faithfully from scripts/compare-sweeps.ts).
// -------------------------------------------------------------------

const ARTICLES: Record<string, string[]> = {
  de: ['der ', 'die ', 'das '],
  fr: ['le ', 'la ', "l'", 'l\u2019', 'les ', 'un ', 'une '],
  es: ['el ', 'la ', 'los ', 'las ', 'un ', 'una '],
  it: ['il ', 'la ', 'lo ', "l'", 'l\u2019', 'i ', 'le ', 'gli '],
  pt: ['o ', 'a ', 'os ', 'as ', 'um ', 'uma '],
  nl: ['de ', 'het ', 'een '],
  sv: ['en ', 'ett ', 'den ', 'det '],
  no: ['en ', 'ei ', 'et ', 'den ', 'det '],
  da: ['en ', 'et ', 'den ', 'det '],
};
const SCANDI = new Set(['sv', 'no', 'da']);

function hasArticle(lang: string, original: string): boolean {
  const arts = ARTICLES[lang];
  if (!arts) return false;
  // Normalise curly apostrophe to ASCII so "l\u2019année" passes the "l'"
  // check. This mirrors the 2026-04-21 finding: the Readability pipeline
  // emits typographic apostrophes while the prompt/classifier assumes ASCII.
  const low = original
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'");
  return arts.some((a) => low.startsWith(a.replace(/\u2019/g, "'")));
}

function isInfinitive(lang: string, original: string): boolean {
  // Normalise diacritics so Spanish "freír" / "reír" (with í) matches the
  // -ir ending; otherwise the accented i is treated as a different character.
  const low = original
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  switch (lang) {
    case 'de':
      return /^(sich )?\S+(e?(n|rn|ln))$/.test(low);
    case 'fr':
      return low.startsWith('se ') || low.startsWith("s'") || /(er|ir|re|oir|oire)$/.test(low);
    case 'es':
      return /(ar|er|ir|arse|erse|irse)$/.test(low);
    // Italian: add -rre ending (tradurre, disporre, trarre, porre) which is
    // a legitimate infinitive class but not covered by -are/-ere/-ire.
    case 'it':
      return /(are|ere|ire|rre|arsi|ersi|irsi)$/.test(low);
    case 'pt':
      return /(ar|er|ir|or|ar-se|er-se|ir-se)$/.test(low);
    // Dutch: infinitive ends in -en OR -n (after long vowel: zijn, gaan,
    // staan, doen, bestaan, opengaan). Narrow "-en$" was rejecting many
    // valid infinitives as false positives in the 2026-04-21 sweep.
    case 'nl':
      return /(en|an|on|un|ijn)$/.test(low);
    case 'en':
      return low.startsWith('to ');
    // Scandinavian: infinitive particle "att" (sv), "å" (no), "at" (da)
    // prefixes the bare verb. Accept either form. We cannot check the verb
    // ending itself without proper lemmatisation (as before).
    case 'sv':
      return low.startsWith('att ') || true;
    case 'no':
      return low.startsWith('a ') || low.startsWith('å ') || true;
    case 'da':
      return low.startsWith('at ') || true;
    case 'pl':
    case 'cs':
      return true;
    default:
      return true;
  }
}

function isMultiWordNoun(original: string): boolean {
  // Split on comma first so legitimate m/f pairs ("o visinho, a visinha",
  // "der Arzt, die Ärztin", "Europejczyk, Europejka") aren't false-flagged
  // on whitespace count. Mirrors lib/vocabFilters.ts isMultiWordNounLeak
  // which also checks parts individually. A part with ≥2 content tokens
  // AFTER the article is suspect.
  const ARTICLES_REGEX =
    /^(der|die|das|le|la|les|l'|l\u2019|el|los|las|il|lo|gli|i|o|a|os|as|de|het|en|ett|den|det|ei|et)\s+/i;
  for (const rawPart of original.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const afterArticle = part.replace(ARTICLES_REGEX, '');
    if (/\S\s\S\s\S/.test(afterArticle)) return true;
  }
  return false;
}

function looksLikeProperNoun(lang: string, original: string): boolean {
  const trimmed = original.trim();
  const rest = trimmed.replace(
    /^(der|die|das|le|la|les|l'|el|los|las|il|lo|gli|i|o|a|os|as|de|het|en|ett|den|det|ei|et) /i,
    '',
  );
  const toks = rest.split(/\s+/).filter(Boolean);
  if (lang === 'de') {
    return toks.length >= 2 && toks.every((t) => /^[A-ZÄÖÜ]{2,}$/.test(t));
  }
  if (toks.length < 2) return toks.length === 1 && /^[A-Z]{3,}$/.test(toks[0]!);
  return toks.every((t) => /^[A-ZÁÀÂÄÉÈÊËÍÎÏÓÔÖÚÛÜÇÑ]/.test(t));
}

function isDeTranslationCaseError(translation: string): boolean {
  const m = translation.trim().match(/^(der|die|das)\s+(\S+)\s+(\S+)(?:\s|$)/i);
  if (!m) return false;
  return /^[A-ZÄÖÜ]/.test(m[2]!) && /^[A-ZÄÖÜ]/.test(m[3]!);
}

// -------------------------------------------------------------------
// New heuristics H1–H20.
// Each returns a boolean + optional reason string.
// -------------------------------------------------------------------

function stripArticlesAny(s: string): string {
  let out = s.trim().toLowerCase();
  const prefixes = [
    'der ',
    'die ',
    'das ',
    'den ',
    'dem ',
    'le ',
    'la ',
    'les ',
    "l'",
    'el ',
    'los ',
    'las ',
    'il ',
    'lo ',
    'gli ',
    'i ',
    'o ',
    'a ',
    'os ',
    'as ',
    'de ',
    'het ',
    'een ',
    'en ',
    'ett ',
    'ei ',
    'et ',
    'den ',
    'det ',
    'to ',
    'the ',
    'a ',
    'an ',
    'sich ',
    'se ',
    "s'",
    'si ',
  ];
  for (const p of prefixes) {
    if (out.startsWith(p)) {
      out = out.slice(p.length).trim();
      break;
    }
  }
  return out;
}

function isCognateTrivial(original: string, translation: string): boolean {
  const o = stripArticlesAny(original);
  const t = stripArticlesAny(translation);
  if (!o || !t) return false;
  // Allow identical or single-char diff (past-tense, gender suffix)
  if (o === t) return true;
  // Normalise diacritics
  const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return strip(o) === strip(t);
}

function isAbbreviation(original: string | undefined): boolean {
  if (!original) return false;
  const first = (original.split(',')[0] ?? '').trim();
  // strip leading article if any
  const base = first
    .replace(/^(der|die|das|le|la|les|l'|el|il|lo|o|a|de|het|en|ett|et|ei)\s+/i, '')
    .replace(/^[a-z]'/i, '');
  if (base.length < 2) return false;
  return /^[A-ZÄÖÜÁÀÂÉÈÊÍÎÓÔÚÛÇÑ0-9]{2,}$/.test(base);
}

function isCommaIdenticalPair(original: string): boolean {
  const parts = original.split(',').map((p) => p.trim());
  if (parts.length < 2) return false;
  const norm = parts.map((p) => stripArticlesAny(p));
  return norm[0] === norm[1] && norm[0]!.length > 0;
}

function startsWithDoubleArticle(lang: Lang, original: string): boolean {
  const low = original.trim().toLowerCase();
  const arts = ARTICLES[lang] ?? [];
  for (const a of arts) {
    if (low.startsWith(a)) {
      const rest = low.slice(a.length).trimStart();
      if (arts.some((b) => rest.startsWith(b))) return true;
    }
  }
  return false;
}

function hasHyphenLinebreakRest(original: string): boolean {
  // Hyphen inside a token (not at start/end), as in 'Wort-trennung' carried from PDFs.
  // Exclude well-known hyphenated words: too noisy — accept any inner hyphen as suspect.
  return /\S-\S/.test(original) && !/^[-]/.test(original);
}

function isEnTransCapitalisedNoun(translation: string): boolean {
  // "the X Y" where X or Y starts capital
  const m = translation.trim().match(/^(the|a|an)\s+(.+)$/i);
  if (!m) return false;
  const rest = m[2]!.trim();
  if (rest.length === 0) return false;
  // Flag if first char uppercase (likely proper noun leak in translation)
  return /^[A-Z]/.test(rest);
}

function isTypeOtherMultiWord(v: VocabItem): boolean {
  if (v.type !== 'other') return false;
  const rest = v.original.replace(
    /^(der|die|das|le|la|les|l'|el|los|las|il|lo|gli|i|o|a|os|as|de|het|en|ett|den|det|ei|et)\s+/i,
    '',
  );
  return rest.trim().split(/\s+/).length >= 2;
}

function sourceFormsEmpty(v: VocabItem): boolean {
  if (!v.source_forms || v.source_forms.length === 0) return true;
  return v.source_forms.every((s) => !s || s.trim().length === 0);
}

function isMultiWordMistyped(v: VocabItem, lang?: string): boolean {
  if (v.type === 'phrase') return false;
  // Scandinavian infinitive markers (att/å/at) + EN 'to' + reflexive
  // pronouns do NOT count as extra content tokens — they are conventional
  // verb prefixes, not mistakes. Also strip curly apostrophe elision.
  const SCANDI_INF = lang === 'sv' ? 'att' : lang === 'no' ? '(a|å)' : lang === 'da' ? 'at' : '';
  const articlePattern = SCANDI_INF
    ? `(der|die|das|le|la|les|l'|\u2019|el|los|las|il|lo|gli|i|o|a|os|as|de|het|en|ett|ei|den|det|et|the|to|sich|se|si|${SCANDI_INF})\\s+`
    : `(der|die|das|le|la|les|l'|\u2019|el|los|las|il|lo|gli|i|o|a|os|as|de|het|en|ett|ei|den|det|et|the|to|sich|se|si)\\s+`;
  const rest = v.original
    .replace(new RegExp('^' + articlePattern, 'i'), '')
    .replace(/^[a-zà-ÿ][\u2019']/i, '');
  return rest.trim().split(/\s+/).length >= 2 && v.type !== 'noun';
}

function isNounMissingArticle(lang: Lang, v: VocabItem): boolean {
  if (v.type !== 'noun') return false;
  if (SCANDI.has(lang)) return false;
  if (lang === 'pl' || lang === 'cs') return false; // Slavic — no articles
  return !hasArticle(lang, v.original);
}

// -------------------------------------------------------------------
// Main KPI + heuristic computation.
// -------------------------------------------------------------------

interface Metrics {
  combos: number;
  ok: number;
  failed: number;
  vocabTotal: number;
  wallSec: number;
  p95Ms: number;
  // KPIs from compare-sweeps
  loopRate: number; // combos with ≥10× same entry / combos
  loopRate3: number; // combos with ≥3× same entry / combos
  dupeRate: number; // mean within-combo duplicate rate
  multiWordNouns: number;
  scandiArticlePct: number;
  infPctByLang: Record<string, number>;
  infPctOverall: number;
  deCaseErrors: number;
  properNounLeaks: number;
  costPer100: number;
  totalCost: number;
  // New heuristics
  h1Cognate: number;
  h2EmptyTr: number;
  h3LongTr: number;
  h4EnCapNoun: number;
  h5Abbrev: number;
  h6CommaIdent: number;
  h13Rep3: number;
  h14Hyphen: number;
  h15InfFail: number;
  h17NounNoArt: number;
  h19OtherMulti: number;
  h20DoubleArt: number;
  h11SrcEmpty: number;
  h12MultiMistyped: number;
  // Level & type distributions
  levelDist: Record<string, number>;
  typeDist: Record<string, number>;
  // Per-lang
  perLang: Record<string, PerLangMetrics>;
  // Samples (max 10 per flag)
  samples: Record<string, FlagSample[]>;
  // Level sanity (high-zipf-but-Cx)
  levelAnomaliesHighZipfC: FlagSample[];
  levelAnomaliesZeroZipfA: FlagSample[];
  topHighLevelWordsByLang: Record<string, string[]>;
  topLowLevelWordsByLang: Record<string, string[]>;
}

interface PerLangMetrics {
  combos: number;
  ok: number;
  failed: number;
  vocab: number;
  typeDist: Record<string, number>;
  levelDist: Record<string, number>;
  cognate: number;
  infFail: number;
  scandiArt: number;
  scandiNouns: number;
  multiWordNoun: number;
  properLeaks: number;
  repetitionCombos: number;
  nounNoArt: number;
}

interface FlagSample {
  lang: string;
  url: string;
  original: string;
  translation: string;
  type: string;
  level: string;
  reason?: string;
}

function pushSample(arr: FlagSample[], s: FlagSample, cap = 15) {
  if (arr.length < cap) arr.push(s);
}

function compute(dump: Dump): Metrics {
  const results = dump.results;
  const okResults = results.filter((r) => r.ok && r.vocab);
  const vocabAll = okResults.flatMap((r) =>
    (r.vocab ?? []).map((v) => ({ ...v, _lang: r.lang, _url: r.url })),
  );

  const samples: Record<string, FlagSample[]> = {
    H1: [],
    H2: [],
    H3: [],
    H4: [],
    H5: [],
    H6: [],
    H11: [],
    H12: [],
    H13: [],
    H14: [],
    H15: [],
    H17: [],
    H19: [],
    H20: [],
    SCANDI_ART: [],
    MULTI_WORD_NOUN: [],
    PROPER_NOUN: [],
    DE_CASE: [],
  };

  // Per-language containers
  const perLang: Record<string, PerLangMetrics> = {};
  const langs = Array.from(new Set(results.map((r) => r.lang)));
  for (const lang of langs) {
    perLang[lang] = {
      combos: 0,
      ok: 0,
      failed: 0,
      vocab: 0,
      typeDist: {},
      levelDist: {},
      cognate: 0,
      infFail: 0,
      scandiArt: 0,
      scandiNouns: 0,
      multiWordNoun: 0,
      properLeaks: 0,
      repetitionCombos: 0,
      nounNoArt: 0,
    };
  }

  // Combo-level metrics: repetition, duplicates
  let loopCombos = 0;
  let loopThreshold3 = 0;
  let totalDupeRatio = 0;
  for (const r of results.filter((r) => r.ok)) {
    const cnt = new Map<string, number>();
    let total = 0;
    for (const v of r.vocab ?? []) {
      const k = (v.original || '').trim().toLowerCase() + '|' + v.type;
      cnt.set(k, (cnt.get(k) ?? 0) + 1);
      total++;
    }
    let max = 0;
    for (const n of cnt.values()) if (n > max) max = n;
    if (max >= 10) loopCombos++;
    if (max >= 3) {
      loopThreshold3++;
      perLang[r.lang]!.repetitionCombos++;
    }
    const uniq = cnt.size;
    totalDupeRatio += total > 0 ? 1 - uniq / total : 0;
    // sample
    if (max >= 3) {
      for (const [k, n] of cnt.entries())
        if (n >= 3) {
          pushSample(samples.H13!, {
            lang: r.lang,
            url: r.url,
            original: k.split('|')[0]!,
            translation: '',
            type: k.split('|')[1]!,
            level: '',
            reason: `${n}× in combo`,
          });
        }
    }
  }
  const dupeRate = okResults.length > 0 ? totalDupeRatio / okResults.length : 0;

  // Flat per-entry heuristics
  let multiWordNouns = 0;
  let scandiNouns = 0,
    scandiWithArticle = 0;
  let totalVerbs = 0,
    infVerbs = 0;
  const infPerLangNum: Record<string, number> = {};
  const infPerLangDen: Record<string, number> = {};
  let deCaseErrors = 0;
  let properNounLeaks = 0;
  let h1 = 0,
    h2 = 0,
    h3 = 0,
    h4 = 0,
    h5 = 0,
    h6 = 0;
  let h11 = 0,
    h12 = 0,
    h14 = 0,
    h15 = 0,
    h17 = 0,
    h19 = 0,
    h20 = 0;

  const levelDist: Record<string, number> = {};
  const typeDist: Record<string, number> = {};

  for (const r of okResults) {
    const lang = r.lang;
    const pl = perLang[lang]!;
    pl.vocab += (r.vocab ?? []).length;
    for (const v of r.vocab ?? []) {
      levelDist[v.level] = (levelDist[v.level] ?? 0) + 1;
      typeDist[v.type] = (typeDist[v.type] ?? 0) + 1;
      pl.levelDist[v.level] = (pl.levelDist[v.level] ?? 0) + 1;
      pl.typeDist[v.type] = (pl.typeDist[v.type] ?? 0) + 1;

      // Multi-word noun
      if (v.type === 'noun' && isMultiWordNoun(v.original)) {
        multiWordNouns++;
        pl.multiWordNoun++;
        pushSample(samples.MULTI_WORD_NOUN!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // Scandi article
      if (SCANDI.has(lang) && v.type === 'noun') {
        scandiNouns++;
        pl.scandiNouns++;
        if (hasArticle(lang, v.original)) {
          scandiWithArticle++;
          pl.scandiArt++;
          pushSample(samples.SCANDI_ART!, {
            lang,
            url: r.url,
            original: v.original,
            translation: v.translation,
            type: v.type,
            level: v.level,
          });
        }
      }
      // Infinitives
      if (v.type === 'verb') {
        totalVerbs++;
        infPerLangDen[lang] = (infPerLangDen[lang] ?? 0) + 1;
        if (isInfinitive(lang, v.original)) {
          infVerbs++;
          infPerLangNum[lang] = (infPerLangNum[lang] ?? 0) + 1;
        } else {
          h15++;
          pl.infFail++;
          pushSample(samples.H15!, {
            lang,
            url: r.url,
            original: v.original,
            translation: v.translation,
            type: v.type,
            level: v.level,
          });
        }
      }
      // DE case errors
      if (r.native === 'de' && isDeTranslationCaseError(v.translation)) {
        deCaseErrors++;
        pushSample(samples.DE_CASE!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // Proper noun leaks
      if (looksLikeProperNoun(lang, v.original)) {
        properNounLeaks++;
        pl.properLeaks++;
        pushSample(samples.PROPER_NOUN!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }

      // H1 cognate trivial
      if (isCognateTrivial(v.original, v.translation)) {
        h1++;
        pl.cognate++;
        pushSample(samples.H1!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // H2 empty translation
      if (!v.translation || v.translation.trim().length < 2) {
        h2++;
        pushSample(samples.H2!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // H3 long translation
      if (v.translation && v.translation.length > 60) {
        h3++;
        pushSample(samples.H3!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // H4 EN translation capitalised noun
      if (r.native === 'en' && v.type === 'noun' && isEnTransCapitalisedNoun(v.translation)) {
        h4++;
        pushSample(samples.H4!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // H5 abbrev
      if (isAbbreviation(v.original)) {
        h5++;
        pushSample(samples.H5!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // H6 comma-identical
      if (isCommaIdenticalPair(v.original)) {
        h6++;
        pushSample(samples.H6!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // H11 src empty
      if (sourceFormsEmpty(v)) {
        h11++;
        pushSample(samples.H11!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // H12 multi mistyped
      if (isMultiWordMistyped(v, lang)) {
        h12++;
        pushSample(samples.H12!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // H14 hyphen
      if (hasHyphenLinebreakRest(v.original)) {
        h14++;
        pushSample(samples.H14!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // H17 noun missing article
      if (isNounMissingArticle(lang, v)) {
        h17++;
        pl.nounNoArt++;
        pushSample(samples.H17!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // H19 other multi-word
      if (isTypeOtherMultiWord(v)) {
        h19++;
        pushSample(samples.H19!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      // H20 double article
      if (startsWithDoubleArticle(lang, v.original)) {
        h20++;
        pushSample(samples.H20!, {
          lang,
          url: r.url,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
    }
  }

  // Per-language combos counts
  for (const r of results) {
    const pl = perLang[r.lang]!;
    pl.combos++;
    if (r.ok) pl.ok++;
    else pl.failed++;
  }

  // p95 latency
  const lats = results.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const p95 = lats.length > 0 ? lats[Math.floor(lats.length * 0.95)]! : 0;

  // Cost proxy
  const totalInputChars = okResults.reduce((a, r) => a + (r.processedTextLength ?? 0), 0);
  const totalOutputItems = vocabAll.length;
  const inputTokens = totalInputChars * 0.3;
  const outputTokens = totalOutputItems * 40;
  const inputCost = (inputTokens / 1_000_000) * 0.1;
  const outputCost = (outputTokens / 1_000_000) * 0.3;
  const totalCost = inputCost + outputCost;
  const uniqueVocab = new Set(vocabAll.map((v) => (v.original || '').toLowerCase() + '|' + v.type))
    .size;
  const costPer100 = uniqueVocab > 0 ? (totalCost / uniqueVocab) * 100 : 0;

  // Level sanity: high-zipf C1/C2 + zero-zipf A1/A2
  const levelRank: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
  const levelAnomHigh: FlagSample[] = [];
  const levelAnomLow: FlagSample[] = [];
  const topHigh: Record<string, string[]> = {};
  const topLow: Record<string, string[]> = {};

  for (const lang of langs) {
    topHigh[lang] = [];
    topLow[lang] = [];
  }

  for (const r of okResults) {
    for (const v of r.vocab ?? []) {
      const z = zipfOf(r.lang, v.original);
      const lvl = levelRank[v.level] ?? 0;
      if (z >= 6 && lvl >= 5) {
        // very high zipf, C1/C2
        pushSample(
          levelAnomHigh,
          {
            lang: r.lang,
            url: r.url,
            original: v.original,
            translation: v.translation,
            type: v.type,
            level: v.level,
            reason: `zipf=${z.toFixed(2)}`,
          },
          25,
        );
      }
      if (z === 0 && lvl <= 2 && v.type !== 'phrase') {
        pushSample(
          levelAnomLow,
          {
            lang: r.lang,
            url: r.url,
            original: v.original,
            translation: v.translation,
            type: v.type,
            level: v.level,
          },
          25,
        );
      }
      // top high-level / low-level words per lang
      if ((v.level === 'C1' || v.level === 'C2') && topHigh[r.lang]!.length < 8) {
        topHigh[r.lang]!.push(`${v.original} (${v.level})`);
      }
      if ((v.level === 'A1' || v.level === 'A2') && topLow[r.lang]!.length < 8) {
        topLow[r.lang]!.push(`${v.original} (${v.level})`);
      }
    }
  }

  const infPctOverall = totalVerbs > 0 ? infVerbs / totalVerbs : 0;
  const infPctByLang: Record<string, number> = {};
  for (const l of Object.keys(infPerLangDen)) {
    const num = infPerLangNum[l] ?? 0;
    const den = infPerLangDen[l]!;
    infPctByLang[l] = den > 0 ? num / den : 0;
  }

  return {
    combos: results.length,
    ok: okResults.length,
    failed: results.length - okResults.length,
    vocabTotal: vocabAll.length,
    wallSec: dump.totals?.wallSec ?? lats.reduce((a, b) => a + b, 0) / 1000,
    p95Ms: p95,
    loopRate: results.length > 0 ? loopCombos / results.length : 0,
    loopRate3: results.length > 0 ? loopThreshold3 / results.length : 0,
    dupeRate,
    multiWordNouns,
    scandiArticlePct: scandiNouns > 0 ? scandiWithArticle / scandiNouns : 0,
    infPctByLang,
    infPctOverall,
    deCaseErrors,
    properNounLeaks,
    costPer100,
    totalCost,
    h1Cognate: h1,
    h2EmptyTr: h2,
    h3LongTr: h3,
    h4EnCapNoun: h4,
    h5Abbrev: h5,
    h6CommaIdent: h6,
    h13Rep3: loopThreshold3,
    h14Hyphen: h14,
    h15InfFail: h15,
    h17NounNoArt: h17,
    h19OtherMulti: h19,
    h20DoubleArt: h20,
    h11SrcEmpty: h11,
    h12MultiMistyped: h12,
    levelDist,
    typeDist,
    perLang,
    samples,
    levelAnomaliesHighZipfC: levelAnomHigh,
    levelAnomaliesZeroZipfA: levelAnomLow,
    topHighLevelWordsByLang: topHigh,
    topLowLevelWordsByLang: topLow,
  };
}

// -------------------------------------------------------------------
// Report rendering.
// -------------------------------------------------------------------

function pct(v: number): string {
  return (v * 100).toFixed(1) + '%';
}
function pad(s: string, n: number): string {
  return s + ' '.repeat(Math.max(0, n - s.length));
}

function renderReport(m: Metrics, inPath: string): string {
  const L: string[] = [];
  L.push(`# Validation-Run-Analyse — ${path.basename(inPath)}`);
  L.push('');
  L.push(`- Combos: **${m.combos}** (ok: ${m.ok}, failed: ${m.failed})`);
  L.push(`- Vokabeln total: **${m.vocabTotal}**`);
  L.push(`- Wall-Time: **${(m.wallSec / 60).toFixed(1)} min**`);
  L.push(`- p95 Latency / Combo: **${Math.round(m.p95Ms).toLocaleString()} ms**`);
  L.push('');

  L.push('## 1) Baseline-KPI-Tabelle (compare-sweeps-kompatibel)');
  L.push('');
  L.push('| KPI | Value | Target |');
  L.push('|---|---|---|');
  L.push(`| Repetition-Loop Rate (≥10× same entry) | ${pct(m.loopRate)} | 0% |`);
  L.push(`| Repetition Presence (≥3× same entry) | ${pct(m.loopRate3)} | <5% |`);
  L.push(`| Within-Combo Duplicate Rate | ${pct(m.dupeRate)} | <1% |`);
  L.push(`| Multi-Word-Noun Violations | ${m.multiWordNouns} | <30 |`);
  L.push(
    `| Scandinavian Nouns WITH Article | ${pct(m.scandiArticlePct)} | target depends on rule |`,
  );
  L.push(`| Verb Infinitive Compliance (overall) | ${pct(m.infPctOverall)} | ≥99.5% |`);
  L.push(`| DE Translation Case Errors | ${m.deCaseErrors} | N/A (native=en) |`);
  L.push(`| p95 Latency per Combo | ${Math.round(m.p95Ms).toLocaleString()} ms | ≤22000 ms |`);
  L.push(`| Total Wall Time | ${(m.wallSec / 60).toFixed(1)} min | ≤32 min |`);
  L.push(`| Cost per 100 Unique Vocabs | $${m.costPer100.toFixed(4)} | ≤$0.004 |`);
  L.push(`| Proper-Noun Leak Count | ${m.properNounLeaks} | <5 |`);
  L.push('');

  L.push('### Infinitive-Compliance pro Lernsprache');
  L.push('');
  L.push('| Lang | Compliance |');
  L.push('|---|---|');
  for (const lang of Object.keys(m.infPctByLang).sort()) {
    L.push(`| ${lang} | ${pct(m.infPctByLang[lang]!)} |`);
  }
  L.push('');

  L.push('## 2) Neue Heuristiken (H1–H20)');
  L.push('');
  L.push('| # | Heuristik | Count | %-of-Vocab |');
  L.push('|---|---|---|---|');
  const row = (id: string, label: string, n: number) =>
    L.push(`| ${id} | ${label} | ${n} | ${((n / m.vocabTotal) * 100).toFixed(2)}% |`);
  row('H1', 'Translation ≈ Original (Cognate-Trivial)', m.h1Cognate);
  row('H2', 'Leere/kaputte Translation', m.h2EmptyTr);
  row('H3', 'Translation > 60 chars', m.h3LongTr);
  row('H4', 'EN-Translation: capitalised noun-Kern', m.h4EnCapNoun);
  row('H5', 'Abkürzung durchgerutscht', m.h5Abbrev);
  row('H6', 'Komma-gleiche Paare überlebt', m.h6CommaIdent);
  row('H11', 'source_forms leer', m.h11SrcEmpty);
  row('H12', 'Multi-word mistyped (≠phrase)', m.h12MultiMistyped);
  row('H13', 'Repetition ≥3× in Combo (combo-count)', m.h13Rep3);
  row('H14', 'Hyphen-Linebreak-Rest', m.h14Hyphen);
  row('H15', 'Infinitiv-Violation (non-verb-lang auto-pass)', m.h15InfFail);
  row('H17', 'Noun ohne Artikel (non-Scandi, non-Slav)', m.h17NounNoArt);
  row('H19', 'type=other Multi-Word', m.h19OtherMulti);
  row('H20', 'Doppelter Artikel am Anfang', m.h20DoubleArt);
  L.push('');

  L.push('## 3) Per-Language Breakdown');
  L.push('');
  L.push(
    '| Lang | OK/Fail | Vocab | Noun | Verb | Adj | Phrase | Other | A1 | A2 | B1 | B2 | C1 | C2 | Cognate | InfFail | ScandiArt | NoArt | MultiN | Proper | Rep3 |',
  );
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const lang of Object.keys(m.perLang).sort()) {
    const p = m.perLang[lang]!;
    const td = p.typeDist;
    const ld = p.levelDist;
    L.push(
      `| ${lang} | ${p.ok}/${p.failed} | ${p.vocab} | ${td.noun ?? 0} | ${td.verb ?? 0} | ${td.adjective ?? 0} | ${td.phrase ?? 0} | ${td.other ?? 0} | ${ld.A1 ?? 0} | ${ld.A2 ?? 0} | ${ld.B1 ?? 0} | ${ld.B2 ?? 0} | ${ld.C1 ?? 0} | ${ld.C2 ?? 0} | ${p.cognate} | ${p.infFail} | ${SCANDI.has(lang) ? `${p.scandiArt}/${p.scandiNouns}` : '-'} | ${p.nounNoArt} | ${p.multiWordNoun} | ${p.properLeaks} | ${p.repetitionCombos} |`,
    );
  }
  L.push('');

  L.push('## 4) CEFR-Sanity');
  L.push('');
  L.push('### Zipf-vs-Level-Anomalies');
  L.push(`- High-Zipf (≥6.0) aber Level ≥ C1: **${m.levelAnomaliesHighZipfC.length}** entries`);
  L.push(
    `- Zero-Zipf aber Level ≤ A2 (non-phrase): **${m.levelAnomaliesZeroZipfA.length}** entries`,
  );
  L.push('');
  L.push('### Top-C1/C2-Wörter pro Sprache (Stichprobe, max. 8)');
  for (const lang of Object.keys(m.topHighLevelWordsByLang).sort()) {
    const arr = m.topHighLevelWordsByLang[lang]!;
    if (arr.length > 0) L.push(`- **${lang}**: ${arr.join(', ')}`);
  }
  L.push('');
  L.push('### Top-A1/A2-Wörter pro Sprache (Stichprobe, max. 8)');
  for (const lang of Object.keys(m.topLowLevelWordsByLang).sort()) {
    const arr = m.topLowLevelWordsByLang[lang]!;
    if (arr.length > 0) L.push(`- **${lang}**: ${arr.join(', ')}`);
  }
  L.push('');

  L.push('## 5) Flagged Samples (max. 15 pro Heuristik)');
  L.push('');
  const renderSamples = (title: string, arr: FlagSample[]) => {
    L.push(`### ${title} — ${arr.length} entries`);
    if (arr.length === 0) {
      L.push('(none)');
      L.push('');
      return;
    }
    for (const s of arr.slice(0, 15)) {
      const tr = s.translation ? ` → "${s.translation}"` : '';
      const reason = s.reason ? ` [${s.reason}]` : '';
      L.push(`- [${s.lang}] "${s.original}"${tr} (${s.type}/${s.level})${reason}`);
    }
    L.push('');
  };
  renderSamples('H1 Cognate-Trivial', m.samples.H1 ?? []);
  renderSamples('H2 Empty Translation', m.samples.H2 ?? []);
  renderSamples('H3 Long Translation', m.samples.H3 ?? []);
  renderSamples('H4 EN-Translation capitalised', m.samples.H4 ?? []);
  renderSamples('H5 Abbreviation', m.samples.H5 ?? []);
  renderSamples('H6 Comma-identical pair', m.samples.H6 ?? []);
  renderSamples('H11 source_forms empty', m.samples.H11 ?? []);
  renderSamples('H12 Multi-word mistyped', m.samples.H12 ?? []);
  renderSamples('H13 Repetition ≥3', m.samples.H13 ?? []);
  renderSamples('H14 Hyphen-Linebreak', m.samples.H14 ?? []);
  renderSamples('H15 Infinitive violation', m.samples.H15 ?? []);
  renderSamples('H17 Noun missing article', m.samples.H17 ?? []);
  renderSamples('H19 type=other Multi-Word', m.samples.H19 ?? []);
  renderSamples('H20 Double article', m.samples.H20 ?? []);
  renderSamples('SCANDI nouns WITH article', m.samples.SCANDI_ART ?? []);
  renderSamples('Multi-word NOUN leaks', m.samples.MULTI_WORD_NOUN ?? []);
  renderSamples('Proper-noun leaks', m.samples.PROPER_NOUN ?? []);

  L.push('### Level anomalies (High zipf → C1/C2)');
  for (const s of m.levelAnomaliesHighZipfC.slice(0, 20)) {
    L.push(`- [${s.lang}] "${s.original}" → "${s.translation}" ${s.level} ${s.reason ?? ''}`);
  }
  L.push('');
  L.push('### Level anomalies (Zero zipf → A1/A2)');
  for (const s of m.levelAnomaliesZeroZipfA.slice(0, 20)) {
    L.push(`- [${s.lang}] "${s.original}" → "${s.translation}" ${s.level}`);
  }
  L.push('');

  return L.join('\n');
}

// -------------------------------------------------------------------
// Compare mode (for future A/B run).
// -------------------------------------------------------------------

function renderDiff(a: Metrics, b: Metrics, aPath: string, bPath: string): string {
  const L: string[] = [];
  L.push(`# KPI Diff — ${path.basename(aPath)} → ${path.basename(bPath)}`);
  L.push('');
  const row = (label: string, aV: number, bV: number, unit: string, higherBetter: boolean) => {
    const delta = bV - aV;
    const deltaPct = aV !== 0 ? (delta / Math.abs(aV)) * 100 : 0;
    const better = (higherBetter && delta > 0) || (!higherBetter && delta < 0);
    const mark = Math.abs(deltaPct) < 0.5 ? '=' : better ? '✓' : '✗';
    const fmt = (v: number) =>
      unit === '%'
        ? pct(v)
        : unit === '$'
          ? '$' + v.toFixed(4)
          : unit === 'ms'
            ? `${Math.round(v).toLocaleString()} ms`
            : unit === 'min'
              ? `${(v / 60).toFixed(1)} min`
              : v.toString();
    L.push(`| ${label} | ${fmt(aV)} | **${fmt(bV)}** | ${mark} ${fmt(delta)} |`);
  };
  L.push('| KPI | A | B | Δ |');
  L.push('|---|---|---|---|');
  row('Repetition-Loop Rate (≥10×)', a.loopRate, b.loopRate, '%', false);
  row('Repetition Presence (≥3×)', a.loopRate3, b.loopRate3, '%', false);
  row('Within-Combo Duplicate Rate', a.dupeRate, b.dupeRate, '%', false);
  row('Multi-Word-Noun Violations', a.multiWordNouns, b.multiWordNouns, '', false);
  row('Scandi Nouns WITH Article', a.scandiArticlePct, b.scandiArticlePct, '%', false);
  row('Verb Infinitive Compliance', a.infPctOverall, b.infPctOverall, '%', true);
  row('Proper-Noun Leaks', a.properNounLeaks, b.properNounLeaks, '', false);
  row('H1 Cognate', a.h1Cognate, b.h1Cognate, '', false);
  row('H2 Empty Translation', a.h2EmptyTr, b.h2EmptyTr, '', false);
  row('H3 Long Translation', a.h3LongTr, b.h3LongTr, '', false);
  row('H4 EN Cap Noun', a.h4EnCapNoun, b.h4EnCapNoun, '', false);
  row('H5 Abbreviation', a.h5Abbrev, b.h5Abbrev, '', false);
  row('H6 Comma-identical', a.h6CommaIdent, b.h6CommaIdent, '', false);
  row('H11 src-forms empty', a.h11SrcEmpty, b.h11SrcEmpty, '', false);
  row('H12 Multi-mistyped', a.h12MultiMistyped, b.h12MultiMistyped, '', false);
  row('H14 Hyphen', a.h14Hyphen, b.h14Hyphen, '', false);
  row('H15 Inf Fail', a.h15InfFail, b.h15InfFail, '', false);
  row('H17 Noun no Article', a.h17NounNoArt, b.h17NounNoArt, '', false);
  row('H19 type=other multi', a.h19OtherMulti, b.h19OtherMulti, '', false);
  row('H20 Double article', a.h20DoubleArt, b.h20DoubleArt, '', false);
  row('p95 Latency (ms)', a.p95Ms, b.p95Ms, 'ms', false);
  row('Wall time', a.wallSec, b.wallSec, 'min', false);
  row('Cost per 100', a.costPer100, b.costPer100, '$', false);
  L.push('');
  return L.join('\n');
}

// -------------------------------------------------------------------
// Main.
// -------------------------------------------------------------------

function main() {
  const { ins, compare: cmpPath } = parseArgs();
  if (ins.length === 1) {
    const inPath = ins[0]!;
    const dump: Dump = JSON.parse(fs.readFileSync(path.resolve(inPath), 'utf-8'));
    const m = compute(dump);
    console.log(renderReport(m, inPath));
    if (cmpPath) {
      const cmpDump: Dump = JSON.parse(fs.readFileSync(path.resolve(cmpPath), 'utf-8'));
      const cmpM = compute(cmpDump);
      console.log('\n\n');
      console.log(renderDiff(m, cmpM, inPath, cmpPath));
    }
    return;
  }
  // Multi-file mode: aggregate across native-specific files, compute
  // per-native + cross-native heuristics (Rule 34 / 38 / 39 / 41 / 42).
  const dumps = ins.map((p) => ({
    path: p,
    dump: JSON.parse(fs.readFileSync(path.resolve(p), 'utf-8')) as Dump,
  }));
  console.log(renderMultiReport(dumps));
}

// -------------------------------------------------------------------
// Multi-file mode: per-native + per-(learn, native) rule compliance.
// -------------------------------------------------------------------

type LangCat = 'def' | 'indef' | 'bare';

const LEARN_CATEGORY: Record<string, LangCat> = {
  de: 'def',
  fr: 'def',
  es: 'def',
  it: 'def',
  pt: 'def',
  nl: 'def',
  en: 'def',
  sv: 'indef',
  no: 'indef',
  da: 'indef',
  pl: 'bare',
  cs: 'bare',
};

// Native default category when learn is BARE (Rule 42 fallback).
const NATIVE_DEFAULT: Record<string, LangCat> = {
  de: 'def',
  fr: 'def',
  es: 'def',
  it: 'def',
  pt: 'def',
  nl: 'def',
  en: 'def',
  sv: 'indef',
  no: 'indef',
  da: 'indef',
  pl: 'bare',
  cs: 'bare',
};

/** Classify an extracted translation by its leading article form. Rough
 *  heuristic; suffix-definiteness in Scandi cannot be reliably detected
 *  without lemmatisation, so we only flag positive prefix matches. */
function classifyTransArticle(nativeCode: string, translation: string): LangCat | 'unknown' {
  const low = translation
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'");
  switch (nativeCode) {
    case 'en':
      if (/^the\s/.test(low)) return 'def';
      if (/^(a|an)\s/.test(low)) return 'indef';
      return 'bare';
    case 'de':
      if (/^(der|die|das|den|dem|des)\s/.test(low)) return 'def';
      if (/^(ein|eine|einen|einem|einer|eines)\s/.test(low)) return 'indef';
      return 'bare';
    case 'fr':
      if (/^(le|la|les)\s/.test(low) || /^l'/.test(low)) return 'def';
      if (/^(un|une)\s/.test(low)) return 'indef';
      return 'bare';
    case 'es':
      if (/^(el|la|los|las)\s/.test(low)) return 'def';
      if (/^(un|una|unos|unas)\s/.test(low)) return 'indef';
      return 'bare';
    case 'it':
      if (/^(il|la|lo|i|gli|le)\s/.test(low) || /^l'/.test(low)) return 'def';
      if (/^(un|uno|una|un')/.test(low)) return 'indef';
      return 'bare';
    case 'pt':
      if (/^(o|a|os|as)\s/.test(low)) return 'def';
      if (/^(um|uma|uns|umas)\s/.test(low)) return 'indef';
      return 'bare';
    case 'nl':
      if (/^(de|het)\s/.test(low)) return 'def';
      if (/^een\s/.test(low)) return 'indef';
      return 'bare';
    case 'sv':
    case 'no':
    case 'da':
      // Scandi: indefinite prefix is the canonical lemma shape under Rule 34.
      if (/^(en|ett|ei|et|den|det)\s/.test(low)) return 'indef';
      // Definite is a noun SUFFIX in Scandi (bilden, folket, lagen, bogen,
      // hjernen, boken, huset, dagen). Heuristic: 4+ chars and ends in the
      // common def-suffix inventory. This misses some edge cases (e.g. def
      // plural -erne/-ene/-na) and false-flags some bare nouns that
      // happen to end in -en (like "man" → "en man" indef vs "mannen" def)
      // but over 12 natives it's a net win over flagging all def-suffix
      // forms as 'bare' (which was the 2026-04-22 R42 mismatch noise).
      if (low.length >= 4 && /(erne|ene|ane|arna|orna|na|en|et|n|a)$/.test(low)) return 'def';
      return 'bare';
    case 'pl':
    case 'cs':
      return 'bare'; // No articles
    default:
      return 'unknown';
  }
}

/** Expected translation article category for a (learn, native) pair
 *  per Rule 42 (mirror, with bare-fallback to native default). */
function expectedTransCat(learnCode: string, nativeCode: string): LangCat {
  const learnCat = LEARN_CATEGORY[learnCode] ?? 'def';
  if (learnCat === 'def') {
    // Native keeps def, except pl/cs which have no articles → bare
    return nativeCode === 'pl' || nativeCode === 'cs' ? 'bare' : 'def';
  }
  if (learnCat === 'indef') {
    // Scandi-learn: translation uses native's indef form, or bare for pl/cs
    return nativeCode === 'pl' || nativeCode === 'cs' ? 'bare' : 'indef';
  }
  // Learn is bare (pl/cs): fall back to native default (Rule 42 F6 branch)
  return NATIVE_DEFAULT[nativeCode] ?? 'def';
}

interface PerNativeStats {
  native: string;
  combos: number;
  ok: number;
  failed: number;
  vocab: number;
  nouns: number;
  verbs: number;
  adjectives: number;
  phrases: number;
  levelDist: Record<string, number>;
  // Original-side rule compliance
  origRule34Pass: number; // scandi learn: en/ett/ei prefix present
  origRule34Total: number;
  origRule41aBarePass: number; // pl/cs learn: bare
  origRule41aBareTotal: number;
  origRule41bEnThe: number; // en learn: starts with "the "
  origRule41bEnTotal: number;
  origRule38AdjPairs: number; // DE/Germanic adj m/f pair (should be 0)
  origRule38AdjTotal: number;
  origRule39VerbInfFail: number; // verb not infinitive
  origRule39VerbTotal: number;
  // Translation-side rule compliance (Rule 42)
  transCatDist: Record<LangCat | 'unknown', number>;
  transRule42Pass: number;
  transRule42Mismatch: number;
  // Per learn category → observed translation category
  transMatrixByLearnCat: Record<LangCat, Record<LangCat | 'unknown', number>>;
  // DE native capitalization (when native=de)
  deNativeNounCapPass: number;
  deNativeNounCapFail: number;
  // Multi-word noun leaks + type=other multi-word (Rule 33/37)
  multiWordNounLeaks: number;
  typeOtherMulti: number;
  // Repetition + dup (Rule 33)
  repetitionCombos: number;
  dupeRatioSum: number;
  // Abbreviations (should be 0)
  abbrevLeaks: number;
  // Curly apostrophe in original (Rule 40 post-fix should be 0)
  curlyApostropheInOrig: number;
  // CEFR anomalies
  zeroZipfA1: number;
  highZipfC: number;
  // Samples (capped)
  samples: Record<
    string,
    {
      learn: string;
      original: string;
      translation: string;
      type: string;
      level: string;
      reason?: string;
    }[]
  >;
}

function emptySamples(): PerNativeStats['samples'] {
  return {
    R34_scandi_bare: [],
    R38_de_adjpair: [],
    R39_verb_notinf: [],
    R41a_pl_cs_withart: [],
    R41b_en_nothe: [],
    R42_mirror_mismatch: [],
    DE_cap_err: [],
    Rule33_multiword: [],
    Rule37_other: [],
    Abbrev: [],
    CurlyApostrophe: [],
    CEFR_zerozipf_A1: [],
    CEFR_highzipf_C: [],
  };
}
function pushS(
  arr: PerNativeStats['samples'][string],
  s: PerNativeStats['samples'][string][number],
  cap = 12,
) {
  if (arr.length < cap) arr.push(s);
}

function computePerNative(dump: Dump): PerNativeStats {
  const nativeCode = (dump.natives ?? [dump.results[0]?.native ?? 'en'])[0] ?? 'en';
  const s: PerNativeStats = {
    native: nativeCode,
    combos: dump.results.length,
    ok: 0,
    failed: 0,
    vocab: 0,
    nouns: 0,
    verbs: 0,
    adjectives: 0,
    phrases: 0,
    levelDist: {},
    origRule34Pass: 0,
    origRule34Total: 0,
    origRule41aBarePass: 0,
    origRule41aBareTotal: 0,
    origRule41bEnThe: 0,
    origRule41bEnTotal: 0,
    origRule38AdjPairs: 0,
    origRule38AdjTotal: 0,
    origRule39VerbInfFail: 0,
    origRule39VerbTotal: 0,
    transCatDist: { def: 0, indef: 0, bare: 0, unknown: 0 },
    transRule42Pass: 0,
    transRule42Mismatch: 0,
    transMatrixByLearnCat: {
      def: { def: 0, indef: 0, bare: 0, unknown: 0 },
      indef: { def: 0, indef: 0, bare: 0, unknown: 0 },
      bare: { def: 0, indef: 0, bare: 0, unknown: 0 },
    },
    deNativeNounCapPass: 0,
    deNativeNounCapFail: 0,
    multiWordNounLeaks: 0,
    typeOtherMulti: 0,
    repetitionCombos: 0,
    dupeRatioSum: 0,
    abbrevLeaks: 0,
    curlyApostropheInOrig: 0,
    zeroZipfA1: 0,
    highZipfC: 0,
    samples: emptySamples(),
  };

  for (const r of dump.results) {
    if (!r.ok) {
      s.failed++;
      continue;
    }
    s.ok++;
    const learn = r.lang;
    const learnCat = LEARN_CATEGORY[learn] ?? 'def';
    const vocab = r.vocab ?? [];
    s.vocab += vocab.length;

    // Rep/dup per-combo
    const keyCount = new Map<string, number>();
    for (const v of vocab) {
      const k = (v.original || '').trim().toLowerCase() + '|' + v.type;
      keyCount.set(k, (keyCount.get(k) ?? 0) + 1);
    }
    let maxCount = 0;
    for (const n of keyCount.values()) if (n > maxCount) maxCount = n;
    if (maxCount >= 3) s.repetitionCombos++;
    const total = vocab.length;
    const uniq = keyCount.size;
    s.dupeRatioSum += total > 0 ? 1 - uniq / total : 0;

    for (const v of vocab) {
      // Types + levels
      if (v.type === 'noun') s.nouns++;
      else if (v.type === 'verb') s.verbs++;
      else if (v.type === 'adjective') s.adjectives++;
      else if (v.type === 'phrase') s.phrases++;
      s.levelDist[v.level] = (s.levelDist[v.level] ?? 0) + 1;

      // Rule 40: curly apostrophe in original (should be 0)
      if (/\u2019/.test(v.original)) {
        s.curlyApostropheInOrig++;
        pushS(s.samples.CurlyApostrophe!, {
          learn,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }

      // Rule 5 / abbreviations in lib/vocabFilters
      if (isAbbreviation(v.original)) {
        s.abbrevLeaks++;
        pushS(s.samples.Abbrev!, {
          learn,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }

      // Multi-word noun + type=other multi-word
      if (v.type === 'noun' && isMultiWordNoun(v.original)) {
        s.multiWordNounLeaks++;
        pushS(s.samples.Rule33_multiword!, {
          learn,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
      if (isTypeOtherMultiWord(v)) {
        s.typeOtherMulti++;
        pushS(s.samples.Rule37_other!, {
          learn,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }

      // ORIGINAL-side Rule 34: scandi learn must start with en/ett/ei
      if (learn === 'sv' || learn === 'no' || learn === 'da') {
        if (v.type === 'noun') {
          s.origRule34Total++;
          if (hasArticle(learn, v.original)) s.origRule34Pass++;
          else {
            pushS(s.samples.R34_scandi_bare!, {
              learn,
              original: v.original,
              translation: v.translation,
              type: v.type,
              level: v.level,
            });
          }
        }
      }

      // Rule 41a: pl/cs learn noun should be bare (no article prefix)
      if (learn === 'pl' || learn === 'cs') {
        if (v.type === 'noun') {
          s.origRule41aBareTotal++;
          const low = v.original.trim().toLowerCase();
          // Any leading article-like token from any language
          const hasAnyArt =
            /^(the|a|an|der|die|das|le|la|les|l'|el|los|las|il|lo|gli|le|o|os|as|de|het|en|ett|ei|et|den|det|un|une|uno|una|um|uma)\s/.test(
              low,
            );
          if (!hasAnyArt) s.origRule41aBarePass++;
          else {
            pushS(s.samples.R41a_pl_cs_withart!, {
              learn,
              original: v.original,
              translation: v.translation,
              type: v.type,
              level: v.level,
              reason: 'article detected',
            });
          }
        }
      }

      // Rule 41b: en learn noun should start with "the "
      if (learn === 'en') {
        if (v.type === 'noun') {
          s.origRule41bEnTotal++;
          const low = v.original.trim().toLowerCase();
          if (/^the\s/.test(low)) s.origRule41bEnThe++;
          else {
            pushS(s.samples.R41b_en_nothe!, {
              learn,
              original: v.original,
              translation: v.translation,
              type: v.type,
              level: v.level,
            });
          }
        }
      }

      // Rule 38: de/nl/sv/no/da/pl/cs/en adj m/f pair (should collapse to single)
      if (
        v.type === 'adjective' &&
        ['de', 'nl', 'sv', 'no', 'da', 'pl', 'cs', 'en'].includes(learn)
      ) {
        s.origRule38AdjTotal++;
        if (v.original.includes(',')) {
          s.origRule38AdjPairs++;
          pushS(s.samples.R38_de_adjpair!, {
            learn,
            original: v.original,
            translation: v.translation,
            type: v.type,
            level: v.level,
          });
        }
      }

      // Rule 39: verb must be infinitive (per-learn-lang regex from compare-sweeps)
      if (v.type === 'verb') {
        s.origRule39VerbTotal++;
        if (!isInfinitive(learn, v.original)) {
          s.origRule39VerbInfFail++;
          pushS(s.samples.R39_verb_notinf!, {
            learn,
            original: v.original,
            translation: v.translation,
            type: v.type,
            level: v.level,
          });
        }
      }

      // TRANSLATION-side Rule 42: check mirror rule
      if (v.type === 'noun') {
        const obsCat = classifyTransArticle(nativeCode, v.translation);
        s.transCatDist[obsCat]++;
        s.transMatrixByLearnCat[learnCat][obsCat]++;
        const expectedCat = expectedTransCat(learn, nativeCode);
        if (
          obsCat === expectedCat ||
          (obsCat === 'bare' &&
            (nativeCode === 'sv' || nativeCode === 'no' || nativeCode === 'da') &&
            expectedCat === 'indef')
        ) {
          // Scandi def-suffix forms may be classified 'bare' by our simple
          // prefix regex when they actually end in -en/-et. Accept bare as
          // a soft pass only for scandi natives where this is plausible.
          s.transRule42Pass++;
        } else {
          s.transRule42Mismatch++;
          pushS(s.samples.R42_mirror_mismatch!, {
            learn,
            original: v.original,
            translation: v.translation,
            type: v.type,
            level: v.level,
            reason: `${learnCat}→${obsCat} (expected ${expectedCat})`,
          });
        }
      }

      // DE native: noun translations should start with def article + capitalised noun
      if (nativeCode === 'de' && v.type === 'noun') {
        const tr = v.translation.trim();
        const m = tr.match(/^(der|die|das)\s+(\S+)/i);
        if (m) {
          const noun = m[2]!;
          if (/^[A-ZÄÖÜ]/.test(noun)) s.deNativeNounCapPass++;
          else {
            s.deNativeNounCapFail++;
            pushS(s.samples.DE_cap_err!, {
              learn,
              original: v.original,
              translation: v.translation,
              type: v.type,
              level: v.level,
              reason: 'noun not capitalised after article',
            });
          }
        } else {
          // Missing article — also a fail if learn is def-category
          if (learnCat === 'def') {
            s.deNativeNounCapFail++;
            pushS(s.samples.DE_cap_err!, {
              learn,
              original: v.original,
              translation: v.translation,
              type: v.type,
              level: v.level,
              reason: 'missing der/die/das',
            });
          }
        }
      }

      // CEFR anomalies
      const z = zipfOf(learn as Lang, v.original);
      const lvlRank: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
      const lvl = lvlRank[v.level] ?? 0;
      if (z >= 6 && lvl >= 5) {
        s.highZipfC++;
        pushS(s.samples.CEFR_highzipf_C!, {
          learn,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
          reason: `zipf=${z.toFixed(2)}`,
        });
      }
      if (z === 0 && lvl <= 2 && v.type !== 'phrase') {
        s.zeroZipfA1++;
        pushS(s.samples.CEFR_zerozipf_A1!, {
          learn,
          original: v.original,
          translation: v.translation,
          type: v.type,
          level: v.level,
        });
      }
    }
  }
  return s;
}

function fmtPct(num: number, denom: number): string {
  if (denom === 0) return '—';
  return ((num / denom) * 100).toFixed(1) + '%';
}

function renderMultiReport(items: { path: string; dump: Dump }[]): string {
  const L: string[] = [];
  const perNative = items.map(({ dump }) => computePerNative(dump));
  perNative.sort((a, b) => a.native.localeCompare(b.native));

  const totalCombos = perNative.reduce((a, p) => a + p.combos, 0);
  const totalOk = perNative.reduce((a, p) => a + p.ok, 0);
  const totalFailed = perNative.reduce((a, p) => a + p.failed, 0);
  const totalVocab = perNative.reduce((a, p) => a + p.vocab, 0);

  L.push(`# Multi-Native Validation Analyse — ${items.length} Native-Dateien`);
  L.push('');
  L.push(`- Files analysed: ${items.map((i) => path.basename(i.path)).join(', ')}`);
  L.push(`- Combos total: **${totalCombos}** (ok: ${totalOk}, failed: ${totalFailed})`);
  L.push(`- Vokabeln total: **${totalVocab}**`);
  L.push('');

  // ────────────────────────────────
  // Per-native summary table
  // ────────────────────────────────
  L.push('## 1) Per-Native Summary');
  L.push('');
  L.push(
    '| Native | Combos | OK/Fail | Vocab | Noun | Verb | Adj | Phrase | A1 | A2 | B1 | B2 | C1 | C2 |',
  );
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of perNative) {
    const ld = p.levelDist;
    L.push(
      `| ${p.native} | ${p.combos} | ${p.ok}/${p.failed} | ${p.vocab} | ${p.nouns} | ${p.verbs} | ${p.adjectives} | ${p.phrases} | ${ld.A1 ?? 0} | ${ld.A2 ?? 0} | ${ld.B1 ?? 0} | ${ld.B2 ?? 0} | ${ld.C1 ?? 0} | ${ld.C2 ?? 0} |`,
    );
  }
  L.push('');

  // ────────────────────────────────
  // Rule compliance (per native file)
  // ────────────────────────────────
  L.push('## 2) Rule Compliance per Native File');
  L.push('');
  L.push(
    '| Native | R34 Scandi indef | R38 DE adj single | R39 Verb inf | R41a pl/cs bare | R41b en "the" | R42 Mirror | DE cap (native=de) | R33 MW-noun | R37 other-MW | Abbrev | Curly ’ | Rep≥3 |',
  );
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const p of perNative) {
    const r42pct = fmtPct(p.transRule42Pass, p.transRule42Pass + p.transRule42Mismatch);
    const r34pct = fmtPct(p.origRule34Pass, p.origRule34Total);
    const r38violPct = fmtPct(p.origRule38AdjPairs, p.origRule38AdjTotal);
    const r39failPct = fmtPct(p.origRule39VerbInfFail, p.origRule39VerbTotal);
    const r41apct = fmtPct(p.origRule41aBarePass, p.origRule41aBareTotal);
    const r41bpct = fmtPct(p.origRule41bEnThe, p.origRule41bEnTotal);
    const deCapPct =
      p.native === 'de'
        ? fmtPct(p.deNativeNounCapPass, p.deNativeNounCapPass + p.deNativeNounCapFail)
        : '—';
    L.push(
      `| ${p.native} | ${r34pct} (pass) | ${r38violPct} (violations) | ${r39failPct} (violations) | ${r41apct} (pass) | ${r41bpct} (pass) | ${r42pct} (pass) | ${deCapPct} | ${p.multiWordNounLeaks} | ${p.typeOtherMulti} | ${p.abbrevLeaks} | ${p.curlyApostropheInOrig} | ${p.repetitionCombos} |`,
    );
  }
  L.push('');

  // ────────────────────────────────
  // Rule 42 Mirror matrix (aggregated)
  // ────────────────────────────────
  L.push('## 3) Rule 42 Mirror — Translation Article Distribution');
  L.push('');
  L.push(
    'Per (learn-category → native) pair, share of translations starting with each article category.',
  );
  L.push('');
  L.push(
    '| Native | DEF learn → def/indef/bare/unk | INDEF learn → def/indef/bare/unk | BARE learn → def/indef/bare/unk | Expected |',
  );
  L.push('|---|---|---|---|---|');
  for (const p of perNative) {
    const m = p.transMatrixByLearnCat;
    const fmt = (cat: LangCat) => {
      const row = m[cat];
      const total = row.def + row.indef + row.bare + row.unknown;
      if (total === 0) return '— (0)';
      return `${fmtPct(row.def, total)}/${fmtPct(row.indef, total)}/${fmtPct(row.bare, total)}/${fmtPct(row.unknown, total)} (${total})`;
    };
    const expectedDef = expectedTransCat('de', p.native);
    const expectedIndef = expectedTransCat('sv', p.native);
    const expectedBare = expectedTransCat('pl', p.native);
    const expected = `DEF→${expectedDef} · INDEF→${expectedIndef} · BARE→${expectedBare}`;
    L.push(`| ${p.native} | ${fmt('def')} | ${fmt('indef')} | ${fmt('bare')} | ${expected} |`);
  }
  L.push('');

  // ────────────────────────────────
  // Top flags per rule (aggregated across natives)
  // ────────────────────────────────
  L.push('## 4) Flagged Entries (aggregated, max 12 per rule)');
  L.push('');
  const rules: [string, keyof PerNativeStats['samples']][] = [
    ['R34 Scandi noun without en/ett/ei', 'R34_scandi_bare'],
    ['R38 DE/Germanic adj m/f pair leaked', 'R38_de_adjpair'],
    ['R39 Verb not in infinitive form', 'R39_verb_notinf'],
    ['R41a pl/cs noun with article', 'R41a_pl_cs_withart'],
    ['R41b en noun without "the "', 'R41b_en_nothe'],
    ['R42 Mirror mismatch', 'R42_mirror_mismatch'],
    ['DE translation capitalization error', 'DE_cap_err'],
    ['Rule 33 multi-word noun leak', 'Rule33_multiword'],
    ['Rule 37 type=other multi-word', 'Rule37_other'],
    ['Abbreviation leak', 'Abbrev'],
    ['Curly apostrophe in original', 'CurlyApostrophe'],
    ['CEFR zero-zipf A1/A2', 'CEFR_zerozipf_A1'],
    ['CEFR high-zipf C1/C2', 'CEFR_highzipf_C'],
  ];
  for (const [label, key] of rules) {
    const all = perNative.flatMap((p) =>
      (p.samples[key] ?? []).map((s) => ({ ...s, native: p.native })),
    );
    L.push(`### ${label} — ${all.length} entries`);
    if (all.length === 0) {
      L.push('✓ (none)');
      L.push('');
      continue;
    }
    for (const s of all.slice(0, 12)) {
      L.push(
        `- [${s.learn}→${(s as { native?: string }).native ?? '?'}] "${s.original}" → "${s.translation}" (${s.type}/${s.level})${s.reason ? ` — ${s.reason}` : ''}`,
      );
    }
    L.push('');
  }

  return L.join('\n');
}

main();

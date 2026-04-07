/**
 * build-gold.ts
 *
 * Reads CEFR-labeled vocabulary files from KELLY (XLS) and CEFRLex (CSV/TSV)
 * placed under tmp/gold/, normalises them into a single JSONL file at
 * tmp/gold/gold-cefr.jsonl with one record per line:
 *
 *   { "word": "hund", "language": "de", "cefr": "A1", "source": "DAFlex" }
 *
 * This is dev-machine only. The output JSONL is gitignored. Subsequent
 * steps (export-features.ts, calibrate-model.py) consume it to fit a
 * proper ordinal model whose learned weights and cut points end up
 * committed in lib/classifier/score.ts.
 *
 * NEVER wired into eas-build hooks.
 *
 * Run:
 *   npm run build:gold
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as XLSX from 'xlsx';
// pdfjs-dist is bundled by `pdf-parse` (a devDep). We use its lower-level
// text-content API directly because the Goethe B1 PDF needs positional
// (x,y) layout to separate headwords from example sentences.
// pdfjs-dist v4+ is ESM-only, so we load it via dynamic import inside main().
type PdfjsModule = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsLib: PdfjsModule | null = null;
async function loadPdfjs(): Promise<PdfjsModule> {
  if (pdfjsLib) return pdfjsLib;
  pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsLib;
}

type CEFR = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
const CEFR_SET: ReadonlySet<string> = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

interface GoldRow {
  word: string;
  language: string;
  cefr: CEFR;
  source: string;
}

// Mirror of features.ts ARTICLE_PREFIXES so the gold lemmas line up with
// what the classifier actually looks up at runtime.
const ARTICLE_PREFIXES = new Set([
  'der', 'die', 'das', 'le', 'la', 'les', 'l',
  'el', 'los', 'las', 'lo', 'i', 'gli', 'un', 'una',
  'um', 'uma', 'o', 'os', 'as', 'de', 'het', 'een',
  'en', 'ett', 'sich', 'se', 'si',
]);

function normaliseLemma(raw: string): string | null {
  const first = raw.split(',')[0]?.trim().toLowerCase();
  if (!first) return null;
  const tokens = first.split(/\s+/).filter(Boolean);
  const stripped =
    tokens.length > 1 && ARTICLE_PREFIXES.has(tokens[0])
      ? tokens.slice(1).join(' ')
      : first;
  // Reject anything containing non-letter junk (digits, punctuation).
  if (!/^[\p{L}][\p{L}'\- ]*[\p{L}]?$/u.test(stripped)) return null;
  if (stripped.length < 2 || stripped.length > 40) return null;
  return stripped;
}

// ----------------------------------------------------------------------------
// KELLY parsers
//
// KELLY xls files are wildly inconsistent across languages. Each one is a
// snowflake — different sheet names, different column headers, sometimes
// the CEFR label hides in a column literally called "Points", sometimes
// the cells are wrapped in Unicode smart quotes ("A1") instead of plain
// text. So we don't enumerate header names. Instead we:
//
//   1. Try every sheet in the workbook.
//   2. For each sheet, scan all columns and find the one whose first ~50
//      non-null values look like CEFR labels (after stripping whitespace
//      and any kind of quote). That's the CEFR column.
//   3. Find the column whose values look like single-word lemmas (mostly
//      letters, length 2..40). That's the word column.
//   4. If both are found, use that sheet. Otherwise, try the next sheet.
//
// This handles English (column "CEFR" with values like "“A1”"), Italian
// ("Points" column with A1..C2 strings), and Swedish (data is in the
// 2nd sheet, not the 1st) without per-language special-cases.
// ----------------------------------------------------------------------------

// Strip ASCII and Unicode "smart" quotes (U+2018, U+2019, U+201C, U+201D)
// plus typographic guillemets that show up in some KELLY files.
const QUOTE_RE = /[\u2018\u2019\u201C\u201D'"`«»‹›]/g;

function cleanCellString(v: unknown): string {
  return String(v ?? '').replace(QUOTE_RE, '').trim();
}

function looksLikeCefr(s: string): boolean {
  return CEFR_SET.has(s.toUpperCase());
}

function looksLikeLemma(s: string): boolean {
  if (s.length < 2 || s.length > 40) return false;
  // Allow letters, hyphens, apostrophes, internal whitespace, and parens
  // (some KELLY rows are like "abandon (give up)").
  return /^[\p{L}][\p{L}'\- ()]*$/u.test(s);
}

interface DetectedColumns {
  wordCol: string;
  cefrCol: string;
}

function detectKellyColumns(
  rows: Record<string, unknown>[]
): DetectedColumns | null {
  if (rows.length === 0) return null;
  const headers = Object.keys(rows[0]);
  const sample = rows.slice(0, 200);

  // For each column, count how many sampled values look like CEFR / lemma.
  // We also track the distinct-value count so we can distinguish a real
  // vocabulary column (thousands of unique lemmas) from a grammar/marker
  // column that only contains a handful of repeating tokens. KELLY-sv has
  // a `Gram-\nmar` column whose values are just "en" / "ett" / "att" — all
  // of which pass looksLikeLemma, so without uniqueness we'd pick that
  // column as the word column and every gold row would collapse to three
  // Swedish articles. See lib/classifier/TODO.md "SV KELLY collapse" bug.
  const stats: Record<
    string,
    { cefr: number; lemma: number; nonNull: number; unique: Set<string> }
  > = {};
  for (const h of headers) {
    stats[h] = { cefr: 0, lemma: 0, nonNull: 0, unique: new Set() };
  }
  for (const row of sample) {
    for (const h of headers) {
      const v = cleanCellString(row[h]);
      if (!v) continue;
      stats[h].nonNull++;
      stats[h].unique.add(v.toLowerCase());
      if (looksLikeCefr(v)) stats[h].cefr++;
      if (looksLikeLemma(v)) stats[h].lemma++;
    }
  }

  // CEFR column = highest cefr-hit ratio above 0.5.
  let cefrCol: string | null = null;
  let cefrBest = 0.5;
  for (const h of headers) {
    const s = stats[h];
    if (s.nonNull < 5) continue;
    const ratio = s.cefr / s.nonNull;
    if (ratio > cefrBest) {
      cefrBest = ratio;
      cefrCol = h;
    }
  }
  if (!cefrCol) return null;

  // Word column = highest lemma-hit ratio above 0.7, distinct from CEFR col,
  // AND a uniqueness ratio above 0.5 so we don't pick a grammar/marker
  // column with a handful of repeating tokens (see KELLY-sv Gram-\nmar).
  // Ties broken by whichever column has the most distinct values.
  let wordCol: string | null = null;
  let wordBest = 0.7;
  let wordBestUnique = 0;
  for (const h of headers) {
    if (h === cefrCol) continue;
    const s = stats[h];
    if (s.nonNull < 5) continue;
    const ratio = s.lemma / s.nonNull;
    if (ratio <= wordBest) continue;
    const uniqueRatio = s.unique.size / s.nonNull;
    if (uniqueRatio < 0.5) continue;
    if (ratio > wordBest || (ratio === wordBest && s.unique.size > wordBestUnique)) {
      wordBest = ratio;
      wordBestUnique = s.unique.size;
      wordCol = h;
    }
  }
  if (!wordCol) return null;

  return { wordCol, cefrCol };
}

function parseKellyXls(filePath: string, lang: string): GoldRow[] {
  const wb = XLSX.readFile(filePath);

  let bestSheet: string | null = null;
  let bestRows: Record<string, unknown>[] = [];
  let bestCols: DetectedColumns | null = null;
  let bestSize = 0;

  for (const sn of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets[sn],
      { defval: null }
    );
    const cols = detectKellyColumns(rows);
    if (cols && rows.length > bestSize) {
      bestSheet = sn;
      bestRows = rows;
      bestCols = cols;
      bestSize = rows.length;
    }
  }

  if (!bestCols) {
    throw new Error(
      `[KELLY ${lang}] could not auto-detect word/CEFR columns in any sheet. ` +
        `Sheets: ${wb.SheetNames.join(', ')}`
    );
  }

  const { wordCol, cefrCol } = bestCols;
  const out: GoldRow[] = [];
  for (const row of bestRows) {
    const rawWord = cleanCellString(row[wordCol]);
    const rawCefr = cleanCellString(row[cefrCol]).toUpperCase();
    if (!rawWord || !CEFR_SET.has(rawCefr)) continue;
    const lemma = normaliseLemma(rawWord);
    if (!lemma) continue;
    out.push({
      word: lemma,
      language: lang,
      cefr: rawCefr as CEFR,
      source: `KELLY-${lang}`,
    });
  }

  console.log(
    `  [KELLY ${lang}] sheet="${bestSheet}" wordCol="${wordCol}" cefrCol="${cefrCol}" → ${out.length} rows`
  );
  return out;
}

// ----------------------------------------------------------------------------
// CEFRLex parsers
//
// CEFRLex files are TAB-separated CSV with one row per lemma and columns:
//   lemma, tag, freq_A1, freq_A2, freq_B1, freq_B2, freq_C1[, freq_C2]
// (C2 is missing in EFLLex but present in others.)
//
// We assign each lemma the EARLIEST level at which its normalised frequency
// exceeds the threshold MIN_FREQ_PER_MILLION. That maps the multi-level
// frequency profile to a single ordinal CEFR label suitable for ordinal
// regression. This matches the conventional usage of CEFRLex resources for
// L2 vocabulary classification (Tack et al. 2018, Graën et al. 2020).
// ----------------------------------------------------------------------------

const MIN_FREQ_PER_MILLION = 0.5;
const CEFRLEX_LEVELS: CEFR[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

function stripQuotes(s: string): string {
  return s.replace(/^["']|["']$/g, '').trim();
}

function parseCefrLexCsv(filePath: string, lang: string, source: string): GoldRow[] {
  const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];

  // Auto-detect delimiter.
  const firstLine = lines[0];
  const delim =
    firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';

  const rawHeaders = firstLine.split(delim).map(stripQuotes);
  const wordIdx = rawHeaders.findIndex((h) => /^(lemma|word|form|wordform)$/i.test(h));
  if (wordIdx === -1) {
    throw new Error(
      `[CEFRLex ${lang}] no lemma column. Headers: ${rawHeaders.join(', ')}`
    );
  }

  // CEFRLex header conventions vary widely:
  //   FLELex     : freq_A1, freq_A2, ...
  //   ELELex     : level_freq@a1, level_freq@a2, ...
  //   NT2Lex     : F@A1 (Frequency), D@A1 (Dispersion), SFI@A1, U@A1, tf-idf@A1
  //   SVALex     : freq_a1, freq_a2, ...
  //
  // Strategy: for each level, find ALL columns containing that level code as
  // a word boundary, then prefer the one whose name matches a "frequency-ish"
  // pattern. Concretely:
  //   1st choice: ^F@<lvl>$        (NT2Lex frequency)
  //   2nd choice: name contains "freq" or "level_freq"
  //   3rd choice: any column containing the level
  // We never pick "tf-idf", "D@", "SFI@", "U@", "nb_doc", or "total".
  const EXCLUDE = /(tf[-_]?idf|^d@|^sfi@|^u@|nb_doc|total)/i;
  const levelIdx: Partial<Record<CEFR, number>> = {};
  for (const lvl of CEFRLEX_LEVELS) {
    const lvlLc = lvl.toLowerCase();
    const candidates: number[] = [];
    for (let i = 0; i < rawHeaders.length; i++) {
      if (i === wordIdx) continue;
      const h = rawHeaders[i].toLowerCase();
      if (EXCLUDE.test(h)) continue;
      // Match level code as a "word": @A1, _A1, ^A1, A1$, A1_, A1@
      if (new RegExp(`(^|[@_\\s])${lvlLc}([@_\\s]|$)`).test(h)) {
        candidates.push(i);
      }
    }
    if (candidates.length === 0) continue;
    // Prefer F@<lvl> (NT2Lex frequency), then anything with "freq".
    let best = candidates.find((i) =>
      new RegExp(`^f@${lvlLc}$`).test(rawHeaders[i].toLowerCase())
    );
    if (best === undefined) {
      best = candidates.find((i) => /freq/i.test(rawHeaders[i]));
    }
    if (best === undefined) best = candidates[0];
    levelIdx[lvl] = best;
  }

  if (Object.keys(levelIdx).length === 0) {
    throw new Error(
      `[CEFRLex ${lang}] no CEFR frequency columns. Headers: ${rawHeaders.join(', ')}`
    );
  }

  const chosen = (Object.entries(levelIdx) as [CEFR, number][])
    .map(([lvl, i]) => `${lvl}=${rawHeaders[i]}`)
    .join('  ');
  console.log(`  [${source} ${lang}] lemma="${rawHeaders[wordIdx]}" levels: ${chosen}`);

  const out: GoldRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delim).map(stripQuotes);
    const rawWord = parts[wordIdx];
    if (!rawWord) continue;
    const lemma = normaliseLemma(rawWord);
    if (!lemma) continue;

    let assigned: CEFR | null = null;
    for (const lvl of CEFRLEX_LEVELS) {
      const idx = levelIdx[lvl];
      if (idx === undefined) continue;
      const v = parseFloat(parts[idx] ?? '');
      if (Number.isFinite(v) && v >= MIN_FREQ_PER_MILLION) {
        assigned = lvl;
        break;
      }
    }
    if (!assigned) continue;
    out.push({ word: lemma, language: lang, cefr: assigned, source });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Goethe-Institut PDF parsers
//
// The Goethe wordlists for A1 / A2 / B1 are the only open CEFR-labeled
// vocabulary source we have for German (no DAFlex / no German KELLY). They
// are PDF documents, formatted as a 2-column table per page:
//
//     <headword>   <example sentence>     <headword>   <example sentence>
//     col1 (~x35)  col2 (~x140)           col3 (~x315) col4 (~x420)
//
// A1 and A2 PDFs flatten cleanly to TAB-separated text via pdf-parse's
// getText(): every entry shows up as `<headword>\t<example>` on its own
// line. We use that fast path for them.
//
// The B1 PDF however contains many multi-line entries (verb conjugations
// like "aufwachen, wacht auf, / wachte auf, / ist aufgewacht") and the
// flat-text output interleaves headword continuations with example
// sentence continuations in a way that no line-based regex can untangle.
// For B1 we therefore go through pdfjs-dist directly and reconstruct the
// 2x2 layout using x-coordinates: a column-1 line is a NEW HEADWORD only
// if there is a column-2 line at the SAME y starting with a sentence-
// initial character (uppercase letter, digit, or '('). Otherwise it is a
// continuation line and we drop it. Same rule for the right pair (col3
// + col4). This isolates ~2400 unique B1 headwords cleanly.
// ----------------------------------------------------------------------------

const GOETHE_LEVEL_FROM_FILE: Record<string, CEFR> = {
  de_a1: 'A1',
  de_a2: 'A2',
  de_b1: 'B1',
};

// Lines we always reject as obvious non-headwords (table-of-contents
// entries, page headers, copyright boilerplate, etc.).
const GOETHE_REJECT_LINE = /^(seite|wortliste|inhalt|vorwort|zertifikat|goethe|isbn|©|herausgeber|gestaltung|--\s|\d+\s|abkürzungen|wortgruppen)/i;

function parseGoetheTabbedPdf(text: string, level: CEFR): GoldRow[] {
  // A1/A2 path: pdf-parse getText() yields lines like "<word>\t<example>".
  // We accept a line if it has a tab, the left side is short (<= 40 chars),
  // and normaliseLemma() can extract a clean lemma from it.
  const out: GoldRow[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const tab = raw.indexOf('\t');
    if (tab < 0) continue;
    const left = raw.slice(0, tab).trim();
    if (!left || left.length > 40) continue;
    if (GOETHE_REJECT_LINE.test(left)) continue;
    // Skip thematic group lines like "• Schule" / "1 Euro 100 Cent" / colours
    if (left.startsWith('•')) continue;
    const lemma = normaliseLemma(left);
    if (!lemma) continue;
    if (seen.has(lemma)) continue;
    seen.add(lemma);
    out.push({ word: lemma, language: 'de', cefr: level, source: `Goethe-${level}` });
  }
  return out;
}

interface PdfItem {
  text: string;
  x: number;
  y: number;
}

interface RowItem {
  text: string;
  x: number;
}

// Group items into rows by y-coordinate (within ±2 units).
function groupByY(items: PdfItem[]): { y: number; cells: RowItem[] }[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const rows: { y: number; cells: RowItem[] }[] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - it.y) <= 2) {
      last.cells.push({ text: it.text, x: it.x });
    } else {
      rows.push({ y: it.y, cells: [{ text: it.text, x: it.x }] });
    }
  }
  return rows;
}

// Concatenate cells whose x falls within [xMin, xMax) into a single string.
function joinColumn(cells: RowItem[], xMin: number, xMax: number): string {
  return cells
    .filter((c) => c.x >= xMin && c.x < xMax)
    .map((c) => c.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Sentence-initial = uppercase letter, digit, or opening parenthesis.
const SENTENCE_INITIAL = /^[A-ZÄÖÜ0-9(]/;

async function parseGoethePdfPositional(filePath: string, level: CEFR): Promise<GoldRow[]> {
  const pdfjs = await loadPdfjs();
  const buf = fs.readFileSync(filePath);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    // Suppress noisy "fetching standardFontData" warnings.
    verbosity: 0,
  }).promise;

  const out: GoldRow[] = [];
  const seen = new Set<string>();

  for (let pn = 1; pn <= doc.numPages; pn++) {
    const page = await doc.getPage(pn);
    const tc = await page.getTextContent();
    const items: PdfItem[] = [];
    for (const it of tc.items as Array<{ str: string; transform: number[] }>) {
      if (!it.str || !it.str.trim()) continue;
      items.push({
        text: it.str,
        x: Math.round(it.transform[4]),
        y: Math.round(it.transform[5]),
      });
    }
    if (items.length === 0) continue;
    const rows = groupByY(items);
    for (const row of rows) {
      // Two-column-pair layout (left + right) used by all word-list pages:
      //   col1 ≈ 30..100  headword
      //   col2 ≈ 100..300 example sentence
      //   col3 ≈ 300..400 headword
      //   col4 ≈ 400..600 example sentence
      const c1 = joinColumn(row.cells, 30, 100);
      const c2 = joinColumn(row.cells, 100, 300);
      const c3 = joinColumn(row.cells, 300, 400);
      const c4 = joinColumn(row.cells, 400, 700);

      const tryHeadword = (head: string, example: string) => {
        if (!head || head.length > 50) return;
        if (!example || !SENTENCE_INITIAL.test(example)) return;
        if (GOETHE_REJECT_LINE.test(head)) return;
        const lemma = normaliseLemma(head);
        if (!lemma) return;
        if (seen.has(lemma)) return;
        seen.add(lemma);
        out.push({ word: lemma, language: 'de', cefr: level, source: `Goethe-${level}` });
      };

      tryHeadword(c1, c2);
      tryHeadword(c3, c4);
    }
  }

  return out;
}

async function parseGoethePdf(filePath: string): Promise<GoldRow[]> {
  const base = path.basename(filePath, path.extname(filePath)).toLowerCase();
  const level = GOETHE_LEVEL_FROM_FILE[base];
  if (!level) {
    throw new Error(
      `[Goethe] cannot infer CEFR level from filename: ${path.basename(filePath)}. ` +
        `Expected one of: ${Object.keys(GOETHE_LEVEL_FROM_FILE).join(', ')}.pdf`
    );
  }

  // For A1/A2 the flattened text is well-behaved (one entry per line, tab
  // between headword and example). For B1 it isn't, so we go positional.
  if (level === 'B1') {
    return parseGoethePdfPositional(filePath, level);
  }

  const { PDFParse } = require('pdf-parse');
  const buf = fs.readFileSync(filePath);
  const result = await new PDFParse({ data: new Uint8Array(buf) }).getText();
  return parseGoetheTabbedPdf(result.text, level);
}

// ----------------------------------------------------------------------------
// Aspekte neu B2/C1 (Klett) Kapitelwortschatz parser
//
// Input: pre-extracted UTF-8 text dumps of the publisher's chapter-vocabulary
// PDFs, produced with `pdftotext -enc UTF-8 -layout de_b2.pdf de_b2.txt`.
// Place the .txt files at tmp/gold/aspekt/de_b2.txt and tmp/gold/aspekt/de_c1.txt.
//
// The PDFs use a two-column layout that pdftotext preserves via runs of
// whitespace. Each entry is one of:
//
//   die Vorstellung, -en (Meine Vorstellung von Heimat ist …)
//   der/die Grafiker/in, -/-nen
//   empfinden, empfand, hat empfunden
//   abenteuerlich
//   geben, gibt, gab, hat gegeben (einen Kuss geben)
//
// Lines may be prefixed by an exercise marker like "1a", "2b", "3", which
// only sits in front of the first entry of an exercise block. Section
// headers (Kapitel N, Modul N, Auftakt, Porträt, Grammatik, Redemittel)
// and running page footers (Aspekte neu B2 / Kapitelwortschatz / Seite N)
// are skipped. Wrapped continuation lines (e.g. the tail of a parenthesised
// example that broke across a line break) are detected via paren-balance
// and dropped. Acceptable noise: a handful of stray past-participle forms
// like "eingegangen" that survived the wrap detection — calibration uses
// thousands of rows so the impact is negligible.
// ----------------------------------------------------------------------------

const ASPEKT_SKIP_RE =
  /^(Kapitelwortschatz|Kapitel\s+\d|Modul\s+\d|Auftakt|Porträt|Grammatik|Redemittel|Aspekte\s+neu|Seite\s+\d|Der\s+Wortschatz\s+von|B1plus)/i;

const ASPEKT_EXERCISE_PREFIX_RE = /^\d+[a-z]?\s+/;

function extractAspektLemma(rawCell: string): string | null {
  let s = rawCell.trim();
  if (!s) return null;

  // Strip leading exercise marker like "1a ", "2b ", "3 ".
  s = s.replace(ASPEKT_EXERCISE_PREFIX_RE, '');

  // Drop balanced parenthesised content (examples / grammar markers).
  // Repeat in case of nested or sequential parens.
  for (let i = 0; i < 4; i++) {
    const next = s.replace(/\([^()]*\)/g, ' ');
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // Drop everything from the first comma onwards (plural marker for nouns,
  // principal parts for verbs, alternative forms for adjectives).
  s = s.split(',')[0].trim();
  if (!s) return null;

  // Article + slash form: "der/die Grafiker/in" → "der Grafiker"
  const slashArt = s.match(/^(der|die|das)\/(?:der|die|das)\s+(.+)$/);
  if (slashArt) {
    const noun = slashArt[2].split('/')[0].trim();
    s = `${slashArt[1]} ${noun}`;
  }

  // Generic slash collapse on the trailing token: "Pate/Patin" → "Pate".
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    if (last.includes('/')) {
      tokens[tokens.length - 1] = last.split('/')[0];
    }
    s = tokens.join(' ');
  }

  // Strip trailing punctuation (a stray "." from a wrapped example).
  s = s.replace(/[.;:!?"'„“”]+$/u, '').trim();
  if (!s) return null;

  // Validate: either a single word or "article noun".
  if (!/^[A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]*( [A-Za-zÄÖÜäöüß][\wÄÖÜäöüß-]*)?$/u.test(s)) {
    return null;
  }
  if (s.length < 2 || s.length > 50) return null;

  return s.toLowerCase();
}

function parseAspektTxt(filePath: string, level: CEFR): GoldRow[] {
  const text = fs.readFileSync(filePath, 'utf8');
  const out: GoldRow[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (ASPEKT_SKIP_RE.test(line.trim())) continue;

    // Split into column cells at runs of 3+ spaces (pdftotext -layout
    // preserves the column gutter as ≥3 spaces).
    const cells = line.split(/ {3,}/).map((c) => c.trim()).filter(Boolean);

    for (const cell of cells) {
      if (ASPEKT_SKIP_RE.test(cell)) continue;

      // Skip wrapped-continuation cells: a closing paren without a matching
      // opener means the cell is the tail of a parens example that broke
      // across a line.
      const opens = (cell.match(/\(/g) ?? []).length;
      const closes = (cell.match(/\)/g) ?? []).length;
      if (closes > opens) continue;

      const lemma = extractAspektLemma(cell);
      if (!lemma) continue;

      // The article-stripped form is what runtime extractFeatures() will
      // look up, so we mirror that for dedupe AND we emit the article-
      // stripped variant (consistent with KELLY/CEFRLex normalisation).
      const tokens = lemma.split(/\s+/);
      const stripped =
        tokens.length > 1 && ARTICLE_PREFIXES.has(tokens[0])
          ? tokens.slice(1).join(' ')
          : lemma;
      if (!/^[\p{L}][\p{L}'\- ]*[\p{L}]?$/u.test(stripped)) continue;
      if (stripped.length < 2 || stripped.length > 40) continue;

      if (seen.has(stripped)) continue;
      seen.add(stripped);
      out.push({
        word: stripped,
        language: 'de',
        cefr: level,
        source: `Aspekte-${level}`,
      });
    }
  }

  return out;
}

// ----------------------------------------------------------------------------
// Oxford 5000 (American English) parser
//
// Input: pre-extracted UTF-8 text from Oxford University Press's
// "The Oxford 5000™ (American English)" PDF, dumped via
//   pdftotext -layout -enc UTF-8 American_Oxford_5000.pdf American_Oxford_5000.txt
// Place the .txt at tmp/gold/oxford/American_Oxford_5000.txt.
//
// The PDF contains the 2000 additional B2/C1 words on top of the Oxford 3000
// (so only B2 and C1 levels appear). Each entry has the form:
//
//   abolish v. C1
//   acid n. B2, adj. C1          ← multi-POS with split CEFRs
//   bow1 v., n. C1               ← homonym disambiguation digit
//   wrist n.B2                   ← occasional missing space
//   viable adj., C1              ← stray comma before CEFR
//
// 4-column layout preserved by `-layout`. We split cells at runs of ≥3
// spaces, then for each cell extract the headword and the LOWEST CEFR
// label observed (so a B2/C1 split → B2, the level at which the word
// first becomes worth knowing). Used as an EN-only B2/C1 supplement to
// the existing KELLY-en A1/A2/B1 portion. Gives the calibrator clean,
// unambiguous B2/C1 EN gold for the first time.
// ----------------------------------------------------------------------------

const OXFORD_CEFR_RE = /\b(A1|A2|B1|B2|C1|C2)\b/g;
const OXFORD_HEADWORD_RE = /^([a-zA-Z][a-zA-Z-]*)\d?(?=\s|$)/;

function extractOxfordEntry(rawCell: string): { word: string; cefr: CEFR } | null {
  const cell = rawCell.trim();
  if (!cell) return null;

  // Find headword (first letters-only token, optionally followed by a
  // single homonym digit which we strip).
  const wm = cell.match(OXFORD_HEADWORD_RE);
  if (!wm) return null;
  const word = wm[1].toLowerCase();
  if (word.length < 2 || word.length > 40) return null;

  // Collect every CEFR label in the cell. The Oxford 5000 cell may carry
  // two (one per POS); we keep the lowest level — the earliest CEFR at
  // which the headword is worth knowing.
  const matches = [...cell.matchAll(OXFORD_CEFR_RE)].map((m) => m[1]);
  if (matches.length === 0) return null;
  const order: CEFR[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const lowest = order.find((lvl) => matches.includes(lvl));
  if (!lowest) return null;

  return { word, cefr: lowest };
}

function parseOxford5000Txt(filePath: string): GoldRow[] {
  const text = fs.readFileSync(filePath, 'utf8');
  const out: GoldRow[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line.trim()) continue;
    // Skip the title block, the explanation paragraph, and the footer.
    if (/^(The Oxford 5000|©|The Oxford 3000)/i.test(line.trim())) continue;
    // Skip the wrap of the explanation paragraph (lines without any CEFR).
    if (!OXFORD_CEFR_RE.test(line)) {
      OXFORD_CEFR_RE.lastIndex = 0;
      continue;
    }
    OXFORD_CEFR_RE.lastIndex = 0;

    const cells = line.split(/ {3,}/).map((c) => c.trim()).filter(Boolean);
    for (const cell of cells) {
      const entry = extractOxfordEntry(cell);
      if (!entry) continue;
      if (seen.has(entry.word)) continue;
      seen.add(entry.word);
      out.push({
        word: entry.word,
        language: 'en',
        cefr: entry.cefr,
        source: 'Oxford-5000',
      });
    }
  }

  return out;
}

// ----------------------------------------------------------------------------
// Discovery
// ----------------------------------------------------------------------------

interface SourceFile {
  kind: 'kelly' | 'cefrlex' | 'goethe' | 'aspekt' | 'oxford';
  language: string;
  filePath: string;
  source: string;
  level?: CEFR;
}

function discoverSources(rootDir: string): SourceFile[] {
  const out: SourceFile[] = [];

  const kellyDir = path.join(rootDir, 'kelly');
  if (fs.existsSync(kellyDir)) {
    for (const entry of fs.readdirSync(kellyDir)) {
      const m = entry.match(/^([a-z]{2})\.(xls|xlsx)$/i);
      if (!m) continue;
      out.push({
        kind: 'kelly',
        language: m[1].toLowerCase(),
        filePath: path.join(kellyDir, entry),
        source: `KELLY-${m[1].toLowerCase()}`,
      });
    }
  }

  const goetheDir = path.join(rootDir, 'goethe');
  if (fs.existsSync(goetheDir)) {
    for (const entry of fs.readdirSync(goetheDir)) {
      const m = entry.match(/^(de_(a1|a2|b1))\.pdf$/i);
      if (!m) continue;
      const level = m[2].toUpperCase();
      out.push({
        kind: 'goethe',
        language: 'de',
        filePath: path.join(goetheDir, entry),
        source: `Goethe-${level}`,
      });
    }
  }

  const oxfordDir = path.join(rootDir, 'oxford');
  if (fs.existsSync(oxfordDir)) {
    for (const entry of fs.readdirSync(oxfordDir)) {
      if (!/\.txt$/i.test(entry)) continue;
      out.push({
        kind: 'oxford',
        language: 'en',
        filePath: path.join(oxfordDir, entry),
        source: 'Oxford-5000',
      });
    }
  }

  const aspektDir = path.join(rootDir, 'aspekt');
  if (fs.existsSync(aspektDir)) {
    for (const entry of fs.readdirSync(aspektDir)) {
      const m = entry.match(/^de_(b2|c1)\.txt$/i);
      if (!m) continue;
      const level = m[1].toUpperCase() as CEFR;
      out.push({
        kind: 'aspekt',
        language: 'de',
        filePath: path.join(aspektDir, entry),
        source: `Aspekte-${level}`,
        level,
      });
    }
  }

  const cefrlexDir = path.join(rootDir, 'cefrlex');
  if (fs.existsSync(cefrlexDir)) {
    const sourceMap: Record<string, string> = {
      en: 'EFLLex', de: 'DAFlex', fr: 'FLELex', es: 'ELELex',
      it: 'ITLex', nl: 'NT2Lex', sv: 'SVALex',
    };
    for (const entry of fs.readdirSync(cefrlexDir)) {
      const m = entry.match(/^([a-z]{2})\.(csv|tsv|txt)$/i);
      if (!m) continue;
      const lang = m[1].toLowerCase();
      out.push({
        kind: 'cefrlex',
        language: lang,
        filePath: path.join(cefrlexDir, entry),
        source: sourceMap[lang] ?? `CEFRLex-${lang}`,
      });
    }
  }

  return out;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  const rootDir = path.resolve(__dirname, '..', 'tmp', 'gold');
  const outPath = path.join(rootDir, 'gold-cefr.jsonl');
  fs.mkdirSync(rootDir, { recursive: true });

  const sources = discoverSources(rootDir);
  if (sources.length === 0) {
    console.error(
      `[build:gold] No source files found under ${rootDir}.\n` +
        '  Expected: tmp/gold/kelly/<lang>.xls and/or tmp/gold/cefrlex/<lang>.csv\n' +
        '  See README / chat instructions for download URLs.'
    );
    process.exit(1);
  }

  console.log(`[build:gold] discovered ${sources.length} source file(s):`);
  for (const s of sources) {
    console.log(`  - ${s.kind.padEnd(7)} ${s.language}  ${path.basename(s.filePath)}`);
  }

  // Preserve previously-appended LLM-oracle rows. build-gold-llm.ts appends
  // to the same gold-cefr.jsonl file for languages where no reference-grade
  // CEFR list exists (currently pt/da/cs/no/pl). Re-running build-gold would
  // otherwise truncate that file and silently delete those rows, forcing the
  // user to re-spend API budget on a rebuild. We read the existing file,
  // keep only rows whose `source === 'LLM-oracle'`, and merge them back into
  // the output after the reference-data sources have been parsed.
  let preservedOracleRows: GoldRow[] = [];
  if (fs.existsSync(outPath)) {
    const existing = fs
      .readFileSync(outPath, 'utf8')
      .split('\n')
      .filter((l) => l.length > 0);
    for (const line of existing) {
      try {
        const r = JSON.parse(line) as GoldRow;
        if (r.source === 'LLM-oracle') preservedOracleRows.push(r);
      } catch {
        // ignore malformed lines
      }
    }
    if (preservedOracleRows.length > 0) {
      const byLang: Record<string, number> = {};
      for (const r of preservedOracleRows) {
        byLang[r.language] = (byLang[r.language] ?? 0) + 1;
      }
      console.log(
        `[build:gold] preserving ${preservedOracleRows.length} LLM-oracle rows from existing file: ` +
          Object.entries(byLang)
            .map(([l, n]) => `${l}=${n}`)
            .join('  ')
      );
    }
  }

  // Per-(language, word) deduplication. If KELLY and CEFRLex disagree on a
  // lemma's level, we keep BOTH rows so the regression sees the conflict
  // honestly — they will tend to cancel out in the fit.
  const all: GoldRow[] = [];
  const stats: Record<string, { rows: number; perLevel: Record<string, number> }> = {};

  for (const s of sources) {
    let rows: GoldRow[];
    try {
      if (s.kind === 'kelly') {
        rows = parseKellyXls(s.filePath, s.language);
      } else if (s.kind === 'cefrlex') {
        rows = parseCefrLexCsv(s.filePath, s.language, s.source);
      } else if (s.kind === 'aspekt') {
        rows = parseAspektTxt(s.filePath, s.level!);
        console.log(`  [${s.source}] → ${rows.length} rows`);
      } else if (s.kind === 'oxford') {
        rows = parseOxford5000Txt(s.filePath);
        console.log(`  [${s.source}] → ${rows.length} rows`);
      } else {
        rows = await parseGoethePdf(s.filePath);
        console.log(`  [${s.source}] → ${rows.length} rows`);
      }
    } catch (err) {
      console.error(`[build:gold] FAILED ${s.filePath}: ${(err as Error).message}`);
      continue;
    }
    all.push(...rows);
    const key = `${s.language}/${s.source}`;
    const perLevel: Record<string, number> = {};
    for (const r of rows) perLevel[r.cefr] = (perLevel[r.cefr] ?? 0) + 1;
    stats[key] = { rows: rows.length, perLevel };
  }

  // Merge preserved LLM-oracle rows back in (after the reference sources so
  // their per-language stats line up with the build-gold-llm log output).
  all.push(...preservedOracleRows);
  if (preservedOracleRows.length > 0) {
    const perLang: Record<string, Record<string, number>> = {};
    for (const r of preservedOracleRows) {
      const p = (perLang[r.language] ??= {});
      p[r.cefr] = (p[r.cefr] ?? 0) + 1;
    }
    for (const [lang, perLevel] of Object.entries(perLang)) {
      const n = Object.values(perLevel).reduce((a, b) => a + b, 0);
      stats[`${lang}/LLM-oracle`] = { rows: n, perLevel };
    }
  }

  // Write JSONL.
  const fd = fs.openSync(outPath, 'w');
  for (const r of all) {
    fs.writeSync(fd, JSON.stringify(r) + '\n');
  }
  fs.closeSync(fd);

  console.log(`\n[build:gold] wrote ${all.length} rows → ${outPath}\n`);
  console.log('Per-source breakdown:');
  for (const [key, s] of Object.entries(stats)) {
    const dist = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
      .map((l) => `${l}=${s.perLevel[l] ?? 0}`)
      .join('  ');
    console.log(`  ${key.padEnd(20)} ${String(s.rows).padStart(6)} rows   ${dist}`);
  }

  // Per-language coverage summary.
  const langTotals: Record<string, number> = {};
  for (const r of all) langTotals[r.language] = (langTotals[r.language] ?? 0) + 1;
  console.log('\nPer-language totals:');
  for (const [lang, n] of Object.entries(langTotals).sort()) {
    console.log(`  ${lang}: ${n}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

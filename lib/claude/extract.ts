/**
 * Orchestration for bulk vocabulary extraction.
 *
 * URL/text → chunk → LLM call → JSON parse (+ truncation repair) →
 * per-entry postProcessExtractedVocab (pure, offline filters) →
 * per-entry classifyWord (deterministic CEFR) → return.
 *
 * Phase 2 Slice 4 extracted from lib/claude.ts. Behaviour is byte-
 * identical; only the file boundary moved.
 */
import { classifyWord, type SupportedLanguage } from '../classifier';
import { postProcessExtractedVocab } from '../vocabFilters';
import { ensureIndefArticle } from '../articleEnforcer';
import { callClaude } from './transport';
import { chunkText } from './chunk';
import { EXTRACTION_MODE } from './extractionMode';
import { buildVocabSystemPrompt } from './prompt';
import type { ExtractedVocab } from './types';

// Halved from the default 5000-char chunk size so Pro-Mode texts (capped at
// PRO_MODE_CHAR_LIMIT = 5000 in lib/truncate.ts) split into up to 2 chunks
// we can fire in parallel. Shorter per-chunk output also shortens LLM
// generation time, compounding the concurrency win.
const PARALLEL_EXTRACT_CHUNK_CHARS = 2500;
// Pre-2026-04-24 chunk size. Keeps Pro-Mode texts as exactly 1 chunk so
// the 'serial' kill-switch path replicates the old single-call behaviour.
const SERIAL_EXTRACT_CHUNK_CHARS = 5000;

export async function extractVocabulary(
  text: string,
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: SupportedLanguage,
  nativeLanguageCode?: string,
): Promise<ExtractedVocab[]> {
  const mode = EXTRACTION_MODE;
  const chunkSize = mode === 'parallel' ? PARALLEL_EXTRACT_CHUNK_CHARS : SERIAL_EXTRACT_CHUNK_CHARS;
  const chunks = chunkText(text, chunkSize);

  const systemPrompt = buildVocabSystemPrompt(
    nativeLanguageName,
    learningLanguageName,
    learningLanguageCode,
    nativeLanguageCode ?? 'en',
  );

  async function parseChunk(chunk: string): Promise<ExtractedVocab[]> {
    const responseText = await callClaude([{ role: 'user', content: chunk }], systemPrompt, 8192, {
      temperature: 0,
    });

    const arrayStart = responseText.indexOf('[');
    if (arrayStart === -1) {
      console.warn('No JSON array in vocabulary response:', responseText.substring(0, 200));
      return [];
    }

    // First try: parse from first '[' to last ']' (handles complete responses)
    let parsed: ExtractedVocab[] | null = null;
    const lastBracket = responseText.lastIndexOf(']');
    if (lastBracket > arrayStart) {
      try {
        parsed = JSON.parse(responseText.substring(arrayStart, lastBracket + 1));
      } catch {
        // fall through to repair
      }
    }

    // Repair fallback: truncate after the last fully completed top-level object
    if (!parsed) {
      try {
        const tail = responseText.substring(arrayStart);
        // Walk through and track brace depth to find completed top-level objects
        let depth = 0;
        let inString = false;
        let escape = false;
        let lastTopLevelCloseIdx = -1;
        for (let i = 0; i < tail.length; i++) {
          const c = tail[i];
          if (escape) {
            escape = false;
            continue;
          }
          if (c === '\\') {
            escape = true;
            continue;
          }
          if (c === '"') {
            inString = !inString;
            continue;
          }
          if (inString) continue;
          if (c === '{') depth++;
          else if (c === '}') {
            depth--;
            if (depth === 0) lastTopLevelCloseIdx = i;
          }
        }
        if (lastTopLevelCloseIdx !== -1) {
          const repaired = tail.substring(0, lastTopLevelCloseIdx + 1) + ']';
          parsed = JSON.parse(repaired);
        }
      } catch {
        console.warn('Failed to repair vocabulary response:', responseText.substring(0, 300));
      }
    }

    if (!parsed || !Array.isArray(parsed)) return [];

    // Diagnostic: warn when the parsed array contains ≥3 consecutive
    // identical (original, type) entries — the hallmark of the repetition
    // loop failure mode observed in the 2026-04-20 sweep (être × 37,
    // la perfetta × 39). postProcessExtractedVocab collapses them to one
    // entry; the log surfaces prompt drift in production. Runs are
    // scoped per chunk so parallel chunks can't create cross-chunk
    // false positives.
    let run = 0;
    let runKey = '';
    for (const v of parsed) {
      const key = (v as { original?: string }).original + '|' + (v as { type?: string }).type;
      if (key === runKey) {
        run++;
        if (run === 3) {
          console.warn(
            `[extractVocabulary] repetition loop detected for "${(v as { original?: string }).original}" (${learningLanguageCode} → ${nativeLanguageCode ?? '?'}); dedup will collapse it to one entry`,
          );
        }
      } else {
        run = 1;
        runKey = key;
      }
    }
    // Explicit field pick — strips any legacy source_cat the LLM may
    // still emit, keeping the runtime shape aligned with ExtractedVocab.
    const out: ExtractedVocab[] = [];
    for (const raw of parsed as Array<Partial<ExtractedVocab>>) {
      out.push({
        original: raw.original ?? '',
        translation: raw.translation ?? '',
        level: raw.level ?? '',
        type: (raw.type ?? 'other') as ExtractedVocab['type'],
        source_forms: raw.source_forms ?? [],
      });
    }
    return out;
  }

  // 'parallel': fan out with Promise.all — Array.prototype.flat() preserves
  // the chunks' Promise.all ordering so extract output stays deterministic
  // for equivalent inputs. Post-processing (dedup on (original, type))
  // collapses any cross-chunk duplicates further down.
  // 'serial': run chunks one at a time with for-await, matching the
  // pre-2026-04-24 behaviour. Kill-switch path toggled via EXTRACTION_MODE
  // in lib/claude/extractionMode.ts.
  let perChunk: ExtractedVocab[][];
  if (mode === 'parallel') {
    perChunk = await Promise.all(chunks.map(parseChunk));
  } else {
    perChunk = [];
    for (const chunk of chunks) {
      perChunk.push(await parseChunk(chunk));
    }
  }
  const allVocabs: ExtractedVocab[] = perChunk.flat();

  // Post-processing: drop abbreviations, likely proper nouns, multi-word
  // noun leaks; deduplicate on (original, type); capitalise German noun
  // translations. Pure, offline. Architecture rule 21 enforces this call site.
  const filtered = postProcessExtractedVocab(
    allVocabs,
    learningLanguageCode,
    nativeLanguageCode ?? '',
  );
  allVocabs.length = 0;
  allVocabs.push(...filtered);

  // Pure-INDEF safety net (Rule 47, 2026-04-24): add/normalise the INDEF
  // article on noun entries when the LLM returned bare or DEF forms. The
  // prompt enforces INDEF three times but mistral-small occasionally drops
  // the article for first-person / medical / OCR-photo text. Deterministic,
  // offline, ~zero cost. See lib/articleEnforcer.ts.
  for (const vocab of allVocabs) {
    if (vocab.type !== 'noun') continue;
    vocab.original = ensureIndefArticle(
      vocab.original,
      vocab.source_forms,
      text,
      learningLanguageCode,
    );
    // Symmetric normalisation on the translation side (native lang).
    if (nativeLanguageCode) {
      vocab.translation = ensureIndefArticle(vocab.translation, [], '', nativeLanguageCode);
    }
  }

  // Deterministic CEFR classification via lib/classifier — the LLM no longer
  // assigns levels. High/medium-confidence words resolve synchronously.
  for (const vocab of allVocabs) {
    try {
      vocab.level = await classifyWord(vocab.original, learningLanguageCode, callClaude);
    } catch (err) {
      console.warn(
        `[claude] classifyWord failed for "${vocab.original}" (${learningLanguageCode}):`,
        (err as Error).message,
      );
      vocab.level = 'B1';
    }
  }

  return allVocabs;
}

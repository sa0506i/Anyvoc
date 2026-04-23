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
import { callClaude } from './transport';
import { chunkText } from './chunk';
import { buildVocabSystemPrompt } from './prompt';
import type { ExtractedVocab } from './types';

export async function extractVocabulary(
  text: string,
  nativeLanguageName: string,
  learningLanguageName: string,
  learningLanguageCode: SupportedLanguage,
  nativeLanguageCode?: string,
): Promise<ExtractedVocab[]> {
  const chunks = chunkText(text);
  const allVocabs: ExtractedVocab[] = [];

  for (const chunk of chunks) {
    const systemPrompt = buildVocabSystemPrompt(
      nativeLanguageName,
      learningLanguageName,
      learningLanguageCode,
      nativeLanguageCode ?? 'en',
    );
    const responseText = await callClaude([{ role: 'user', content: chunk }], systemPrompt, 8192, {
      temperature: 0,
    });

    const arrayStart = responseText.indexOf('[');
    if (arrayStart === -1) {
      console.warn('No JSON array in vocabulary response:', responseText.substring(0, 200));
      continue;
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

    if (parsed && Array.isArray(parsed)) {
      // Diagnostic: warn when the parsed array contains ≥3 consecutive
      // identical (original, type) entries — the hallmark of the repetition
      // loop failure mode observed in the 2026-04-20 sweep (être × 37,
      // la perfetta × 39). postProcessExtractedVocab collapses them to one
      // entry; the log surfaces prompt drift in production.
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
      allVocabs.push(...parsed);
    }
  }

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

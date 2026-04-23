import { classifyWord, type SupportedLanguage } from './classifier';
import { postProcessExtractedVocab } from './vocabFilters';
// Phase 2 Slice 1: transport, chunking, detection, and shared types
// live in dedicated files under ./claude/. lib/claude.ts continues to
// re-export them so existing callers (shareProcessing, urlExtractor,
// etc.) keep working unchanged.
import { callClaude, ClaudeAPIError } from './claude/transport';
import { chunkText } from './claude/chunk';
import { detectLanguage } from './claude/detectLanguage';
import type {
  ExtractedVocab,
  TranslateSingleWordResult,
  ClaudeMessage,
  PromptVersion,
} from './claude/types';
// Phase 2 Slice 3: prompt builders + matrixTranslationTarget +
// defaultPromptVersion live in lib/claude/prompt/. The dispatcher's
// buildVocabSystemPrompt + buildTranslateSingleWordPrompt pick the
// version-specific builder at runtime. Re-exported from this file
// so external callers and unit tests see the same symbol names.
import {
  buildVocabSystemPrompt,
  buildTranslateSingleWordPrompt,
  defaultPromptVersion,
  matrixTranslationTarget,
} from './claude/prompt';

export { callClaude, ClaudeAPIError } from './claude/transport';
export { chunkText } from './claude/chunk';
export { detectLanguage } from './claude/detectLanguage';
export type {
  ExtractedVocab,
  TranslateSingleWordResult,
  PromptVersion,
  ArticleCategory,
  LangExamples,
} from './claude/types';
export { buildVocabSystemPrompt, matrixTranslationTarget } from './claude/prompt';

// LangExamples interface + LANG_EXAMPLES dict + getLangExamples all moved
// to lib/claude/types.ts and lib/claude/langs/{code}.ts in Phase 2 Slice 2.
// The 12 per-language profiles are aggregated by lib/claude/langs/index.ts
// and imported at the top of this file.

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

  // Slice 3/7: under v1 the LLM isn't asked for source_cat — strip any
  // incidental field so v1 callers get a clean shape. Under v2 keep it;
  // it's consumed by the sweep's Translation-Target Match Rate metric.
  if (defaultPromptVersion() === 'v1') {
    for (const vocab of allVocabs) {
      delete (vocab as { source_cat?: unknown }).source_cat;
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

export async function translateText(
  text: string,
  fromLanguageName: string,
  toLanguageName: string,
): Promise<string> {
  const chunks = chunkText(text);
  const translations: string[] = [];

  for (const chunk of chunks) {
    const systemPrompt = `You are a professional translator. Translate the following text from ${fromLanguageName} to ${toLanguageName}. Return only the translation, without any additional explanation.`;
    const result = await callClaude([{ role: 'user', content: chunk }], systemPrompt);
    translations.push(result);
  }

  return translations.join('\n\n');
}

// NB: TranslateSingleWordResult (extracted to a type alias so the
// translateSingleWord signature stays single-line — the Rule-27/42
// regex is non-greedy up to the first `\n}`) now lives in
// lib/claude/types.ts. Re-exported at the top of this file.

export async function translateSingleWord(
  word: string,
  fromLanguageName: string,
  toLanguageName: string,
  fromLanguageCode: SupportedLanguage,
  toLanguageCode?: string,
): Promise<TranslateSingleWordResult> {
  // CEFR level is determined locally after the translation comes back —
  // the LLM is only responsible for formatting + translation.
  const nativeCode = toLanguageCode ?? 'en';
  const version = defaultPromptVersion();
  // Phase 2 Slice 3: prompt templates moved to lib/claude/prompt/{v1,v2}.ts.
  // The dispatcher routes v3 → v2 for single-word translation because
  // type-classification drift (the v3 motivator) is impossible when the
  // input is already a single known word.
  const systemPrompt = buildTranslateSingleWordPrompt(
    fromLanguageName,
    toLanguageName,
    fromLanguageCode,
    nativeCode,
    version,
  );

  const result = await callClaude([{ role: 'user', content: word }], systemPrompt, 4096, {
    temperature: 0,
  });

  let parsed: {
    original: string;
    translation: string;
    level: string;
    type: string;
    source_cat?: 'def' | 'indef' | 'bare';
  } = {
    original: word,
    translation: '',
    level: 'B1',
    type: 'other',
  };
  try {
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[0]);
    }
  } catch {
    // fallback to default above
  }

  // Slice 3/7: under v1 the LLM isn't asked for source_cat — strip any
  // incidental field so v1 callers get a clean shape.
  if (version === 'v1') {
    delete parsed.source_cat;
  }

  // Post-processing: drop abbreviations / proper nouns and apply German
  // capitalisation when target is German. Architecture rule 21 enforces
  // this call site.
  const post = postProcessExtractedVocab(
    [{ original: parsed.original, translation: parsed.translation, type: parsed.type }],
    fromLanguageCode,
    toLanguageCode ?? '',
  );
  if (post.length === 0) {
    // Edge case: the LLM returned an abbreviation or proper noun. Leave
    // the parsed result as-is so the caller can show it; the UI layer
    // already deduplicates and the word never gets persisted unless the
    // user explicitly confirms.
  } else {
    parsed.translation = post[0].translation;
  }

  // Local deterministic CEFR assignment.
  try {
    parsed.level = await classifyWord(parsed.original || word, fromLanguageCode, callClaude);
  } catch (err) {
    console.warn(
      `[claude] classifyWord failed for "${parsed.original || word}" (${fromLanguageCode}):`,
      (err as Error).message,
    );
    if (!parsed.level) parsed.level = 'B1';
  }

  return parsed;
}

// Re-export for callers that need the classifier's supported-language type.
export type { SupportedLanguage } from './classifier';

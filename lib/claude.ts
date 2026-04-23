/**
 * Thin re-export wrapper. The Claude/Mistral module is now fully
 * organised under `./claude/` as of Phase 2 (2026-04-23); this file
 * exists only so pre-refactor callers (`shareProcessing`, `urlExtractor`,
 * `classifier`, `try-pipeline`, tests) keep importing from `lib/claude`
 * without call-site changes.
 *
 * Module layout:
 *   lib/claude/
 *     types.ts                — PromptVersion, ArticleCategory, ExtractedVocab,
 *                               TranslateSingleWordResult, LangExamples,
 *                               ClaudeMessage, ClaudeContentBlock, ClaudeResponse
 *     transport.ts            — callClaude + callClaudeOnce + retry + ClaudeAPIError
 *     chunk.ts                — chunkText (sentence-boundary splitter)
 *     detectLanguage.ts       — franc-min language detection
 *     langs/                  — 12 per-language profile files + aggregator
 *     prompt/                 — shared utilities + v1/v2/v3 builders + dispatcher
 *     extract.ts              — extractVocabulary (bulk extraction orchestrator)
 *     translateText.ts        — translateText (full-text translation)
 *     translateSingleWord.ts  — translateSingleWord (Pro long-press flow)
 */

export { callClaude, ClaudeAPIError } from './claude/transport';
export { chunkText } from './claude/chunk';
export { detectLanguage } from './claude/detectLanguage';
export type {
  ExtractedVocab,
  TranslateSingleWordResult,
  ArticleCategory,
  LangExamples,
} from './claude/types';
export { buildVocabSystemPrompt, matrixTranslationTarget } from './claude/prompt';
export { extractVocabulary } from './claude/extract';
export { translateText } from './claude/translateText';
export { translateSingleWord } from './claude/translateSingleWord';

// Re-export for callers that need the classifier's supported-language type.
export type { SupportedLanguage } from './classifier';

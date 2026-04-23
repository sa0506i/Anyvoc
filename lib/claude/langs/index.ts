/**
 * Aggregator — imports every per-language profile file and exposes
 * the LANG_EXAMPLES dict + getLang helper that prompt.ts consumes.
 *
 * Phase 2 Slice 2 (2026-04-23): the 12 language entries were split out
 * of the monolithic lib/claude.ts into individual files so each
 * language's canonical lemma / verb / adjective / phrase examples are
 * tracked as a standalone unit. Adding a 13th language = create
 * `<code>.ts`, add an import + dict entry here.
 */
import type { LangExamples } from '../types';

import { langProfile as en } from './en';
import { langProfile as de } from './de';
import { langProfile as fr } from './fr';
import { langProfile as es } from './es';
import { langProfile as it } from './it';
import { langProfile as pt } from './pt';
import { langProfile as nl } from './nl';
import { langProfile as sv } from './sv';
import { langProfile as no } from './no';
import { langProfile as da } from './da';
import { langProfile as pl } from './pl';
import { langProfile as cs } from './cs';

export const LANG_EXAMPLES: Record<string, LangExamples> = {
  en,
  de,
  fr,
  es,
  it,
  pt,
  nl,
  sv,
  no,
  da,
  pl,
  cs,
};

/** Look up the profile for a language code. Falls back to English so
 *  unknown codes don't crash prompt builders (mirrors the pre-refactor
 *  behaviour of `getLangExamples`). */
export function getLangExamples(code: string): LangExamples {
  return LANG_EXAMPLES[code] ?? LANG_EXAMPLES.en!;
}

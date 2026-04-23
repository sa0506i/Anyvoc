import type { LangExamples } from '../types';

/** English learning-language profile for prompt building.
 *  Phase 2 Slice 2 — extracted verbatim from the LANG_EXAMPLES dict in
 *  the monolithic lib/claude.ts. Content unchanged. */
export const langProfile: LangExamples = {
  name: 'English',
  artCat: 'def',
  nounLemma: 'the dog',
  nounBare: 'dog',
  nounIndef: 'a dog',
  attrAdj: { good: 'the power', bad: 'the political power' },
  verbInf: 'to run',
  verbWrong: 'ran',
  adjSingle: 'small',
  phraseExample: 'by the way',
};

/**
 * Offline language detection via franc-min (synchronous trigram-based
 * classifier). Phase 2 Slice 1 extracted from lib/claude.ts. No
 * network call — offline capability for the app's share-intent flow
 * to decide the learning language before firing any LLM call.
 */
import { franc } from 'franc-min';

/** ISO 639-3 (franc output) → ISO 639-1 (our language codes) for
 *  supported languages. Non-listed codes return undefined from the
 *  lookup and `detectLanguage` yields null. */
const ISO3_TO_ISO1: Record<string, string> = {
  eng: 'en',
  deu: 'de',
  fra: 'fr',
  spa: 'es',
  ita: 'it',
  por: 'pt',
  nld: 'nl',
  swe: 'sv',
  nob: 'no',
  nno: 'no',
  dan: 'da',
  pol: 'pl',
  ces: 'cs',
};

/**
 * Detect the language of a text sample using franc (offline, synchronous).
 * Returns an ISO 639-1 code for supported languages, or null if
 * undetermined or unsupported.
 */
export function detectLanguage(text: string): string | null {
  const sample = text.substring(0, 500);
  const iso3 = franc(sample);
  if (iso3 === 'und') return null;
  return ISO3_TO_ISO1[iso3] ?? null;
}

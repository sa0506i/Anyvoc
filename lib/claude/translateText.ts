/**
 * Full-text translation orchestrator. Chunks the input, fires one
 * chat completion per chunk, concatenates the results with double-
 * newlines.
 *
 * Phase 2 Slice 4 extracted from lib/claude.ts. No behaviour change.
 */
import { callClaude } from './transport';
import { chunkText } from './chunk';

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

import { callClaude } from './claude';

// Validation thresholds
const MIN_TEXT_LENGTH = 20;
const MIN_WORD_COUNT = 3;
const MIN_MAX_WORD_LENGTH = 5; // At least one word must be longer than 4 chars
const MIN_LETTER_RATIO = 0.4; // At least 40% of non-whitespace chars must be letters
const MIN_AVG_WORD_LENGTH = 2.5; // Reject fragmented OCR noise

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Extract text from an image using Claude Vision API.
 */
async function recognizeText(base64Data: string, mediaType: string): Promise<string> {
  return callClaude(
    [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Data,
            },
          },
          {
            type: 'text',
            text: 'Extract all visible text from this image. Return only the extracted text, no comments.',
          },
        ],
      },
    ],
    'You are an OCR assistant. Extract all visible text from the image. Return only the extracted text without additional comments.'
  );
}

/**
 * Validate OCR text quality. Returns invalid with reason if text is
 * too short, fragmented, or mostly numbers/symbols.
 */
export function validateOcrText(text: string): ValidationResult {
  const trimmed = text.trim();

  // Length check
  if (trimmed.length < MIN_TEXT_LENGTH) {
    return { valid: false, reason: 'The image contains too little text to extract vocabulary from.' };
  }

  // Word extraction (strip punctuation for analysis)
  const words = trimmed
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(w => w.length > 0);

  // Word count check
  if (words.length < MIN_WORD_COUNT) {
    return { valid: false, reason: 'The image contains too few words.' };
  }

  // Longest word check
  const maxWordLen = Math.max(...words.map(w => w.length));
  if (maxWordLen < MIN_MAX_WORD_LENGTH) {
    return { valid: false, reason: 'The image text appears to be labels or short fragments, not readable content.' };
  }

  // Letter ratio check (letters vs total non-whitespace)
  const nonWhitespace = trimmed.replace(/\s/g, '');
  const letterCount = (nonWhitespace.match(/\p{L}/gu) || []).length;
  if (nonWhitespace.length > 0 && letterCount / nonWhitespace.length < MIN_LETTER_RATIO) {
    return { valid: false, reason: 'The image contains mostly numbers or symbols, not readable text.' };
  }

  // Fragmentation check
  const avgWordLen = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  if (avgWordLen < MIN_AVG_WORD_LENGTH && words.length > 5) {
    return { valid: false, reason: 'The extracted text appears fragmented or garbled.' };
  }

  return { valid: true };
}

/**
 * Clean OCR text by removing noise, isolated characters, and blank lines.
 */
export function cleanOcrText(text: string): string {
  return text
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return true;
      if (trimmed.length === 1) return false;
      if (/^[\d\p{P}\p{S}\s]+$/u.test(trimmed)) return false;
      return true;
    })
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/**
 * Full pipeline: OCR via Claude Vision, validate text quality, clean, and return.
 * Throws an Error with a user-facing message if validation fails.
 * This saves the expensive vocabulary extraction call for bad/empty images.
 */
export async function extractTextFromImageLocal(
  base64Data: string,
  mediaType: string
): Promise<string> {
  const rawText = await recognizeText(base64Data, mediaType);

  if (!rawText.trim()) {
    throw new Error('No text could be detected in the image.');
  }

  const validation = validateOcrText(rawText);
  if (!validation.valid) {
    throw new Error(validation.reason || 'The image does not contain usable text.');
  }

  return cleanOcrText(rawText);
}

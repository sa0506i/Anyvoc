/**
 * Tests for the franc-based detectLanguage function.
 */
import { detectLanguage } from './claude';

describe('detectLanguage (franc-based)', () => {
  it('detects German text', () => {
    const text =
      'Dies ist ein langer deutscher Text, der ausreichend Wörter enthält, um die Sprache zuverlässig zu erkennen. Die Erkennung braucht genügend Kontext.';
    const result = detectLanguage(text);
    expect(result).toBe('de');
  });

  it('detects French text', () => {
    const text =
      'Ceci est un texte français suffisamment long pour que la détection de langue fonctionne correctement avec le module franc.';
    const result = detectLanguage(text);
    expect(result).toBe('fr');
  });

  it('detects English text', () => {
    const text =
      'This is a sufficiently long English text that should be detected correctly by the franc language detection library.';
    const result = detectLanguage(text);
    expect(result).toBe('en');
  });

  it('detects Spanish text', () => {
    const text =
      'Este es un texto en español lo suficientemente largo para que la detección del idioma funcione correctamente con la biblioteca franc.';
    const result = detectLanguage(text);
    expect(result).toBe('es');
  });

  it('returns null for undetermined language', () => {
    const text = '12345 67890';
    const result = detectLanguage(text);
    expect(result).toBeNull();
  });

  it('returns null for unsupported language (e.g. Japanese)', () => {
    const text =
      'これは日本語のテキストです。この言語はサポートされていません。十分な長さが必要です。';
    const result = detectLanguage(text);
    expect(result).toBeNull();
  });

  it('samples only the first 500 characters', () => {
    const germanPart = 'Dies ist ein deutscher Text. '.repeat(20); // ~560 chars
    const frenchPart = 'Ceci est un texte français. '.repeat(20);
    const result = detectLanguage(germanPart + frenchPart);
    expect(result).toBe('de');
  });
});

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}

export const languages: Language[] = [
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'zh', name: 'Chinese (Mandarin)', nativeName: '中文' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
];

export function getLanguageName(code: string): string {
  return languages.find((l) => l.code === code)?.nativeName ?? code;
}

const languageToCountry: Record<string, string> = {
  de: 'DE', en: 'GB', fr: 'FR', es: 'ES', it: 'IT', pt: 'PT',
  nl: 'NL', pl: 'PL', ru: 'RU', ja: 'JP', zh: 'CN', ko: 'KR',
  ar: 'SA', tr: 'TR', sv: 'SE', no: 'NO', da: 'DK', fi: 'FI',
  el: 'GR', cs: 'CZ', hu: 'HU', ro: 'RO',
};

export function getLanguageFlag(code: string): string {
  const country = languageToCountry[code];
  if (!country) return '';
  return String.fromCodePoint(
    ...country.split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

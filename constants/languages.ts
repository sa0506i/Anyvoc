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
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'no', name: 'Norwegian', nativeName: 'Norsk' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
];

export function getLanguageName(code: string): string {
  return languages.find((l) => l.code === code)?.nativeName ?? code;
}

export function getLanguageEnglishName(code: string): string {
  return languages.find((l) => l.code === code)?.name ?? code;
}

const languageToCountry: Record<string, string> = {
  de: 'DE', en: 'GB', fr: 'FR', es: 'ES', it: 'IT', pt: 'PT',
  nl: 'NL', sv: 'SE', no: 'NO', da: 'DK', pl: 'PL', cs: 'CZ',
};

export function getLanguageFlag(code: string): string {
  const country = languageToCountry[code];
  if (!country) return '';
  return String.fromCodePoint(
    ...country.split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

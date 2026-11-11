import en from './en.json';
import hi from './hi.json';

export type Locale = 'en' | 'hi';
export type TranslationDict = typeof en;

export function normalizeLocale(raw: string | undefined | null): Locale {
  return raw === 'hi' ? 'hi' : 'en';
}

export function getDictionary(locale: Locale): TranslationDict {
  return locale === 'hi' ? hi : en;
}


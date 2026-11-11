'use client';

import React, { createContext, useContext, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDictionary, type Locale, type TranslationDict } from '@/lib/i18n';

interface LanguageContextValue {
  locale: Locale;
  dict: TranslationDict;
  toggleLocale: () => void;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: 'en',
  dict: getDictionary('en'),
  toggleLocale: () => {},
});

export function LanguageProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const router = useRouter();

  const toggleLocale = () => {
    const next: Locale = locale === 'en' ? 'hi' : 'en';
    document.cookie = `samiti_lang=${next}; Path=/; SameSite=Lax; Max-Age=31536000`;
    document.documentElement.lang = next;
    setLocale(next);
    router.refresh();
  };

  return (
    <LanguageContext.Provider
      value={{
        locale,
        dict: getDictionary(locale),
        toggleLocale,
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}


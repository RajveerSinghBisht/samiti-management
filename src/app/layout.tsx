import React from 'react';
import { cookies } from 'next/headers';
import './globals.css';
import { normalizeLocale } from '@/lib/i18n';
import { LanguageProvider } from '@/components/LanguageProvider';

export const metadata = {
  title: 'Samiti Savings & Loan',
  description: 'Private savings and lending group ledger',
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get('samiti_lang')?.value);

  return (
    <html lang={locale}>
      <body>
        <LanguageProvider initialLocale={locale}>{children}</LanguageProvider>
      </body>
    </html>
  );
}


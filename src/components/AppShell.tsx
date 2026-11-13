'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiMutate } from '@/lib/client-api';
import { useLanguage } from './LanguageProvider';

export function AppShell({
  user,
  children,
}: {
  user?: { name: string; role: 'ADMIN' | 'MEMBER'; totpVerified?: boolean; mustChangePin?: boolean } | null;
  children: React.ReactNode;
}) {
  const { dict, toggleLocale } = useLanguage();
  const router = useRouter();

  const handleSignOut = async () => {
    try {
      await apiMutate('/api/auth/logout', 'POST', {});
    } catch {
      // ignore if already expired
    }
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <header className="no-print bg-white border-b-2 border-slate-300 px-4 py-3">
        <div className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={user?.role === 'ADMIN' ? '/admin' : user ? '/home' : '/login'}
              className="min-h-[48px] min-w-[48px] inline-flex items-center px-3 py-2 text-xl font-bold text-slate-900 rounded-lg hover:bg-slate-100"
            >
              {dict.appTitle}
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              data-testid="language-toggle"
              onClick={toggleLocale}
              className="min-h-[48px] min-w-[48px] px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg hover:bg-slate-100"
            >
              {dict.switchLanguage}
            </button>
            {user && (
              <button
                type="button"
                onClick={handleSignOut}
                className="min-h-[48px] min-w-[48px] px-4 py-2 rounded-lg bg-slate-800 text-white font-semibold text-lg hover:bg-slate-900"
              >
                {dict.signOut}
              </button>
            )}
          </div>
        </div>

        {user && !user.mustChangePin && (
          <nav
            aria-label="Primary Navigation"
            className="max-w-5xl mx-auto mt-3 flex flex-wrap gap-2"
          >
            {user.role === 'MEMBER' ? (
              <>
                <Link
                  href="/home"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-blue-900 bg-blue-900 text-white font-semibold text-lg hover:bg-blue-800"
                >
                  {dict.home}
                </Link>
                <Link
                  href="/my-loan"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg hover:bg-slate-100"
                >
                  {dict.myLoan}
                </Link>
                <Link
                  href="/my-savings"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg hover:bg-slate-100"
                >
                  {dict.mySavings}
                </Link>
                <Link
                  href="/meetings"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg hover:bg-slate-100"
                >
                  {dict.meetings}
                </Link>
              </>
            ) : user.totpVerified ? (
              <>
                <Link
                  href="/admin"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-blue-900 bg-blue-900 text-white font-semibold text-lg"
                >
                  {dict.adminDashboard}
                </Link>
                <Link
                  href="/admin/contributions"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg"
                >
                  Contributions
                </Link>
                <Link
                  href="/admin/loans"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg"
                >
                  Loans
                </Link>
                <Link
                  href="/admin/approvals"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg"
                >
                  Approvals
                </Link>
                <Link
                  href="/admin/dashboard"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg"
                >
                  Monthly Dashboard
                </Link>
                <Link
                  href="/admin/meetings/conduct"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg"
                >
                  Conduct Meeting
                </Link>
                <Link
                  href="/admin/cycle-wizard"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg"
                >
                  Cycle Wizard
                </Link>
                <Link
                  href="/admin/members"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg"
                >
                  Members
                </Link>
                <Link
                  href="/admin/good-cause"
                  className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-amber-600 bg-amber-50 text-amber-900 font-semibold text-lg"
                >
                  Good Cause
                </Link>
              </>
            ) : null}
          </nav>
        )}
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">{children}</main>
    </div>
  );
}


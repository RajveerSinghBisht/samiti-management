'use client';

import React from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/AppShell';
import { useLanguage } from '@/components/LanguageProvider';
import { formatDisplayDate } from '@/lib/dates';
import { formatPaiseToInr } from '@/lib/money';
import type { getMemberPortalData } from '@/lib/services/member-portal';

type PortalData = Awaited<ReturnType<typeof getMemberPortalData>>;

export function MemberHomeView({
  user,
  data,
}: {
  user: { name: string; mobile: string; role: 'MEMBER' };
  data: PortalData;
}) {
  const { dict } = useLanguage();
  const totalLoanOwed = data.myLoans
    .filter((l) => l.status === 'ACTIVE')
    .reduce((acc, l) => acc + l.balance.totalOwedPaise, 0);

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <section className="bg-white border-2 border-slate-300 rounded-xl p-6">
          <h1 className="text-3xl font-bold text-slate-900">{dict.welcomeGreeting}</h1>
          <p className="text-2xl font-bold text-slate-900 mt-1">{user.name}</p>
          {data.cycle && (
            <p className="text-lg text-slate-700 mt-1">{data.cycle.name}</p>
          )}
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white border-2 border-emerald-800 rounded-xl p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-2">{dict.mySavingsTitle}</h2>
            <p
              data-important-number="true"
              className="text-[32px] leading-tight font-bold text-emerald-900 mb-4"
            >
              {formatPaiseToInr(data.savings.totalContributedPaise)}
            </p>
            <Link
              href="/my-savings"
              className="min-h-[48px] min-w-[48px] w-full inline-flex items-center justify-center px-5 py-3 rounded-lg bg-emerald-800 text-white font-bold text-lg hover:bg-emerald-900"
            >
              {dict.openMySavings}
            </Link>
          </div>

          <div className="bg-white border-2 border-blue-900 rounded-xl p-6">
            <h2 className="text-xl font-bold text-slate-900 mb-2">{dict.myLoanBalanceTitle}</h2>
            <p
              data-important-number="true"
              className="text-[32px] leading-tight font-bold text-blue-900 mb-4"
            >
              {formatPaiseToInr(totalLoanOwed)}
            </p>
            <Link
              href="/my-loan"
              className="min-h-[48px] min-w-[48px] w-full inline-flex items-center justify-center px-5 py-3 rounded-lg bg-blue-900 text-white font-bold text-lg hover:bg-blue-800"
            >
              {dict.openMyLoan}
            </Link>
          </div>
        </section>

        <section className="bg-white border-2 border-slate-300 rounded-xl p-6">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">{dict.groupTotalsTitle}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-lg bg-slate-100 border border-slate-300">
              <div className="text-lg font-semibold text-slate-800">{dict.groupTotalSavings}</div>
              <div data-important-number="true" className="text-[28px] font-bold text-slate-900">
                {formatPaiseToInr(data.groupTotals.totalContributionsPaise)}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-slate-100 border border-slate-300">
              <div className="text-lg font-semibold text-slate-800">{dict.groupCashOnHand}</div>
              <div data-important-number="true" className="text-[28px] font-bold text-slate-900">
                {formatPaiseToInr(data.groupTotals.treasurerCashOnHandPaise)}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-slate-100 border border-slate-300">
              <div className="text-lg font-semibold text-slate-800">
                {dict.groupLoansOutstanding}
              </div>
              <div data-important-number="true" className="text-[28px] font-bold text-slate-900">
                {formatPaiseToInr(data.groupTotals.totalOutstandingPrincipalPaise)}
              </div>
            </div>
            <div className="p-4 rounded-lg bg-slate-100 border border-slate-300">
              <div className="text-lg font-semibold text-slate-800">
                {dict.groupInterestCollected}
              </div>
              <div data-important-number="true" className="text-[28px] font-bold text-slate-900">
                {formatPaiseToInr(data.groupTotals.totalInterestCollectedPaise)}
              </div>
            </div>
          </div>

          <div className="mt-5">
            <Link
              href="/meetings"
              className="min-h-[48px] min-w-[48px] inline-flex items-center px-6 py-3 rounded-lg border-2 border-slate-800 bg-white text-slate-900 font-bold text-lg hover:bg-slate-100"
            >
              {dict.openMeetings}
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

export function MemberLoanView({
  user,
  data,
}: {
  user: { name: string; mobile: string; role: 'MEMBER' };
  data: PortalData;
}) {
  const { dict, locale } = useLanguage();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-slate-900">{dict.loanDetailsHeading}</h1>
          <Link
            href="/home"
            className="min-h-[48px] min-w-[48px] inline-flex items-center px-5 py-3 rounded-lg border-2 border-slate-800 bg-white text-slate-900 font-semibold text-lg"
          >
            {dict.backToHome}
          </Link>
        </div>

        {data.myLoans.length === 0 ? (
          <div className="bg-white border-2 border-slate-300 rounded-xl p-6 text-xl text-slate-800">
            {dict.noActiveLoan}
          </div>
        ) : (
          <div className="space-y-4">
            {data.myLoans.map((loan) => {
              const totalRepaid =
                loan.balance.principalRepaidPaise + loan.balance.interestRepaidPaise;
              return (
                <div
                  key={loan.id}
                  className="bg-white border-2 border-blue-900 rounded-xl p-6 space-y-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xl font-bold text-slate-900">
                      {formatDisplayDate(loan.disbursedDate, locale)}
                    </span>
                    <span className="px-3 py-1 rounded-full bg-blue-100 text-blue-950 font-bold text-lg">
                      {loan.status}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-100 rounded-lg">
                      <div className="text-lg font-semibold text-slate-800">
                        {dict.outstandingPrincipal}
                      </div>
                      <div
                        data-important-number="true"
                        className="text-[30px] font-bold text-slate-900"
                      >
                        {formatPaiseToInr(loan.balance.outstandingPrincipalPaise)}
                      </div>
                    </div>
                    <div className="p-4 bg-slate-100 rounded-lg">
                      <div className="text-lg font-semibold text-slate-800">{dict.totalOwed}</div>
                      <div
                        data-important-number="true"
                        className="text-[30px] font-bold text-blue-900"
                      >
                        {formatPaiseToInr(loan.balance.totalOwedPaise)}
                      </div>
                    </div>
                    <div className="p-4 bg-slate-100 rounded-lg">
                      <div className="text-lg font-semibold text-slate-800">
                        {dict.principalAmount}
                      </div>
                      <div
                        data-important-number="true"
                        className="text-[30px] font-bold text-slate-900"
                      >
                        {formatPaiseToInr(loan.principalPaise)}
                      </div>
                    </div>
                    <div className="p-4 bg-slate-100 rounded-lg">
                      <div className="text-lg font-semibold text-slate-800">
                        {dict.repaidSoFar}
                      </div>
                      <div className="text-2xl font-bold text-emerald-900">
                        {formatPaiseToInr(totalRepaid)}
                      </div>
                    </div>
                    <div className="p-4 bg-slate-100 rounded-lg">
                      <div className="text-lg font-semibold text-slate-800">
                        {dict.unpaidInterest}
                      </div>
                      <div className="text-2xl font-bold text-slate-900">
                        {formatPaiseToInr(loan.balance.unpaidAccruedInterestPaise)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

export function MemberSavingsView({
  user,
  data,
}: {
  user: { name: string; mobile: string; role: 'MEMBER' };
  data: PortalData;
}) {
  const { dict, locale } = useLanguage();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-slate-900">{dict.statementHeading}</h1>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[48px] min-w-[48px] px-5 py-3 rounded-lg bg-blue-900 text-white font-bold text-lg hover:bg-blue-800"
            >
              {dict.printStatement}
            </button>
            <Link
              href="/home"
              className="min-h-[48px] min-w-[48px] inline-flex items-center px-5 py-3 rounded-lg border-2 border-slate-800 bg-white text-slate-900 font-semibold text-lg"
            >
              {dict.backToHome}
            </Link>
          </div>
        </div>

        <section
          data-testid="printable-statement"
          className="bg-white border-2 border-slate-400 rounded-xl p-6 space-y-5"
        >
          <div className="border-b-2 border-slate-300 pb-4">
            <h2 className="text-2xl font-bold text-slate-900">{user.name}</h2>
            <p className="text-lg text-slate-800">{data.cycle?.name ?? 'Samiti Cycle'}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-emerald-50 border border-emerald-800 rounded-lg">
              <div className="text-lg font-semibold text-slate-900">{dict.mySavingsTitle}</div>
              <div data-important-number="true" className="text-[30px] font-bold text-emerald-900">
                {formatPaiseToInr(data.savings.totalContributedPaise)}
              </div>
            </div>
            <div className="p-4 bg-slate-100 border border-slate-400 rounded-lg">
              <div className="text-lg font-semibold text-slate-900">{dict.groupTotalSavings}</div>
              <div data-important-number="true" className="text-[30px] font-bold text-slate-900">
                {formatPaiseToInr(data.groupTotals.totalContributionsPaise)}
              </div>
            </div>
          </div>

          <div
            className="overflow-x-auto"
            tabIndex={0}
            role="region"
            aria-label={dict.statementHeading}
          >
            <table className="w-full text-left border-collapse text-lg">
              <thead>
                <tr className="border-b-2 border-slate-400 bg-slate-100">
                  <th className="p-3 font-bold">{dict.dateLabel}</th>
                  <th className="p-3 font-bold">Entry</th>
                  <th className="p-3 font-bold text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {data.myContributionEntries.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="p-4 text-slate-700">
                      No contributions recorded yet.
                    </td>
                  </tr>
                ) : (
                  data.myContributionEntries.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-200">
                      <td className="p-3">{formatDisplayDate(entry.effectiveDate, locale)}</td>
                      <td className="p-3">
                        {entry.entryType}
                        {entry.monthIndex ? ` (Month ${entry.monthIndex})` : ''}
                      </td>
                      <td className="p-3 text-right font-bold">
                        {formatPaiseToInr(entry.amountPaise)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

export function MemberMeetingsView({
  user,
  data,
}: {
  user: { name: string; mobile: string; role: 'MEMBER' };
  data: PortalData;
}) {
  const { dict, locale } = useLanguage();

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-slate-900">{dict.meetingsHeading}</h1>
          <Link
            href="/home"
            className="min-h-[48px] min-w-[48px] inline-flex items-center px-5 py-3 rounded-lg border-2 border-slate-800 bg-white text-slate-900 font-semibold text-lg"
          >
            {dict.backToHome}
          </Link>
        </div>

        {data.meetings.length === 0 ? (
          <div className="bg-white border-2 border-slate-300 rounded-xl p-6 text-xl text-slate-800">
            {dict.noMeetings}
          </div>
        ) : (
          <div className="space-y-4">
            {data.meetings.map((m) => (
              <div
                key={m.id}
                className="bg-white border-2 border-slate-400 rounded-xl p-5 space-y-2"
              >
                <div className="text-2xl font-bold text-slate-900">
                  {formatDisplayDate(m.meetingDate, locale)}
                </div>
                <div className="text-lg text-slate-900">
                  <span className="font-bold">{dict.placeLabel}:</span> {m.place}
                </div>
                {m.hostName && (
                  <div className="text-lg text-slate-800">
                    <span className="font-bold">{dict.hostLabel}:</span> {m.hostName}
                  </div>
                )}
                {m.notes && (
                  <div className="text-lg text-slate-800">
                    <span className="font-bold">{dict.notesLabel}:</span> {m.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}


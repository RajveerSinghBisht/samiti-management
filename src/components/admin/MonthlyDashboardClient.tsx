'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatPaiseToInr } from '@/lib/money';
import { toIstDateString } from '@/lib/dates';

interface DashboardMember {
  memberId: string;
  memberName: string;
  mobile: string;
  paidContributionThisMonth: boolean;
  loanPrincipalPendingPaise: number;
  interestPaidThisMonthPaise: number;
  interestStillDuePaise: number;
  remainingBalancePaise: number;
}

interface DashboardData {
  cycleId: string;
  cycleName: string;
  monthDate: string;
  meetingDate: string | null;
  poolAvailableToLendPaise: number;
  groupTotals: {
    totalContributionsPaise: number;
    totalInterestCollectedPaise: number;
    totalBankInterestPaise: number;
    totalGoodCauseGrantsPaise: number;
    totalOutstandingPrincipalPaise: number;
  };
  members: DashboardMember[];
}

export function MonthlyDashboardClient({
  initialCycleId,
  initialCycleName,
}: {
  initialCycleId: string | null;
  initialCycleName: string | null;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(Boolean(initialCycleId));
  const [error, setError] = useState('');
  const [month, setMonth] = useState(toIstDateString().slice(0, 7)); // YYYY-MM

  useEffect(() => {
    let ignore = false;
    if (!initialCycleId) return;

    fetch(`/api/admin/dashboard/monthly?month=${month}-01`, {
      cache: 'no-store',
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load dashboard data');
        return res.json();
      })
      .then((json: DashboardData) => {
        if (!ignore) {
          setData(json);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : 'Error loading dashboard');
          setLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [initialCycleId, month]);

  if (!initialCycleId) {
    return (
      <div className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
        <h1 className="text-3xl font-bold text-slate-900">Monthly Admin Dashboard</h1>
        <p className="text-lg text-slate-700">No active cycle found. Please create a cycle first.</p>
        <Link
          href="/admin/cycle-wizard"
          className="min-h-[48px] inline-flex items-center px-6 py-3 bg-blue-900 text-white font-bold rounded-lg hover:bg-blue-800"
        >
          Launch New-Cycle Wizard
        </Link>
      </div>
    );
  }

  const paidCount = data?.members.filter((m) => m.paidContributionThisMonth).length ?? 0;
  const unpaidCount = (data?.members.length ?? 0) - paidCount;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Monthly Dashboard</h1>
          <p className="text-lg text-slate-700">
            Cycle: <strong>{data?.cycleName || initialCycleName}</strong>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="month-select" className="font-bold text-slate-800">
            Month:
          </label>
          <input
            id="month-select"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="p-2 border-2 border-slate-400 rounded-lg text-lg font-semibold"
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-100 border-2 border-red-400 rounded-lg text-red-900 font-semibold">
          {error}
        </div>
      )}

      {loading ? (
        <div className="p-8 text-center text-xl text-slate-600">Loading dashboard data...</div>
      ) : data ? (
        <>
          {/* Top highlight: Pool Available to Lend */}
          <div className="bg-gradient-to-r from-blue-900 to-indigo-900 text-white rounded-xl p-6 shadow-md">
            <div className="text-base font-semibold text-blue-200 uppercase tracking-wide">
              Rule 7: Pool Available to Lend
            </div>
            <div data-important-number="true" className="text-4xl font-extrabold mt-1">
              {formatPaiseToInr(data.poolAvailableToLendPaise)}
            </div>
            <div className="text-sm text-blue-200 mt-2">
              Contributions + Interest + Bank Interest + Principal Repaid − Loans Lent − Good Cause Grants
            </div>
          </div>

          {/* Group Totals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-white p-4 border rounded-xl">
              <div className="text-sm font-semibold text-slate-600">Contributions Collected</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {formatPaiseToInr(data.groupTotals.totalContributionsPaise)}
              </div>
            </div>
            <div className="bg-white p-4 border rounded-xl">
              <div className="text-sm font-semibold text-slate-600">Interest Collected</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {formatPaiseToInr(data.groupTotals.totalInterestCollectedPaise)}
              </div>
            </div>
            <div className="bg-white p-4 border rounded-xl">
              <div className="text-sm font-semibold text-slate-600">Outstanding Loans</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {formatPaiseToInr(data.groupTotals.totalOutstandingPrincipalPaise)}
              </div>
            </div>
            <div className="bg-white p-4 border rounded-xl">
              <div className="text-sm font-semibold text-slate-600">Good Cause Grants</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">
                {formatPaiseToInr(data.groupTotals.totalGoodCauseGrantsPaise)}
              </div>
            </div>
          </div>

          {/* Quick Attendance / Paid Status Bar */}
          <div className="bg-white border rounded-xl p-4 flex flex-wrap justify-between items-center gap-3">
            <div className="text-lg font-bold text-slate-900">
              Monthly Contribution Status ({data.members.length} members):
            </div>
            <div className="flex gap-4">
              <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-bold rounded-full">
                ✓ Paid: {paidCount}
              </span>
              <span className="px-3 py-1 bg-amber-100 text-amber-800 font-bold rounded-full">
                ⏳ Unpaid / Pending: {unpaidCount}
              </span>
            </div>
          </div>

          {/* Members List (Mobile-friendly Cards on small screens, Table on larger) */}
          <div className="bg-white border-2 border-slate-300 rounded-xl overflow-hidden">
            <div className="p-4 bg-slate-100 border-b font-bold text-xl text-slate-900">
              Member Status for {month}
            </div>
            <div className="divide-y">
              {data.members.map((m) => (
                <div key={m.memberId} className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-lg text-slate-900">{m.memberName}</span>
                      <span className="text-sm text-slate-600 font-mono">({m.mobile})</span>
                      {m.paidContributionThisMonth ? (
                        <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-xs font-bold rounded">
                          Paid
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-bold rounded">
                          Unpaid
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-slate-600 mt-1">
                      Loan Principal Pending: <strong className="text-slate-800">{formatPaiseToInr(m.loanPrincipalPendingPaise)}</strong> | Interest Still Due: <strong className="text-slate-800">{formatPaiseToInr(m.interestStillDuePaise)}</strong>
                    </div>
                  </div>
                  <div className="text-right sm:text-right w-full sm:w-auto border-t sm:border-t-0 pt-2 sm:pt-0">
                    <div className="text-xs text-slate-500 uppercase font-semibold">Remaining Net Balance</div>
                    <div className="text-xl font-bold text-slate-900">
                      {formatPaiseToInr(m.remainingBalancePaise)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

import React from 'react';
import Link from 'next/link';
import { getActiveCycle } from '@/lib/services/cycles';
import { formatPaiseToInr } from '@/lib/money';
import { getCycleLedgerEntries } from '@/lib/services/ledger';
import { calculateGroupTotals } from '@/lib/calc';
import { toIstDateString } from '@/lib/dates';
import { getDb, loans } from '@/db';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

const ADMIN_CARDS = [
  { href: '/admin/dashboard', title: 'Monthly Dashboard', desc: 'Fast, phone-friendly view of payments, loan balances & available pool' },
  { href: '/admin/cycle-wizard', title: 'New Cycle Wizard', desc: 'Guided step-by-step cycle creation with two-admin approval' },
  { href: '/admin/meetings/conduct', title: 'Conduct Monthly Meeting', desc: 'Guided flow for attendance, contributions, repayments, and bank interest' },
  { href: '/admin/good-cause', title: 'Give for a Good Cause', desc: 'Sidebar community grant deducted from interest pool with 2-admin approval' },
  { href: '/admin/contributions', title: 'Monthly Contributions Grid', desc: 'One-tap recording per member with confirmation' },
  { href: '/admin/loans', title: 'Loans & Repayments', desc: 'Request loans, accrue interest, record repayments' },
  { href: '/admin/approvals', title: 'Approvals Queue', desc: 'Two-admin sign-off for loans, reversals, cycle close' },
  { href: '/admin/members', title: 'Members & PIN Reset', desc: 'Add members or admins, reset forgotten PINs' },
  { href: '/admin/cycle', title: 'Cycle Settings', desc: 'Configure cycle length, interest, sharing, rotation' },
  { href: '/admin/corrections', title: 'Corrections & Reversals', desc: 'Append-only ledger reversals with required reason' },
  { href: '/admin/meetings', title: 'Meetings', desc: 'Schedule rotating home meetings and places' },
  { href: '/admin/messages', title: 'Weekly Messages', desc: 'Prepared WhatsApp reminders and click-to-chat' },
  { href: '/admin/audit', title: 'Audit Log', desc: 'Immutable log of logins, approvals, and ledger actions' },
  { href: '/admin/export', title: 'Export & Settings', desc: 'Download CSV / JSON backups and policy settings' },
];

export default async function AdminDashboardPage() {
  const cycle = await getActiveCycle();
  let totals = null;

  if (cycle) {
    const db = getDb();
    const entries = await getCycleLedgerEntries(cycle.id, db);
    const cycleLoans = await db.select().from(loans).where(eq(loans.cycleId, cycle.id));
    totals = calculateGroupTotals({
      entries,
      settings: {
        startDate: cycle.startDate,
        lengthMonths: cycle.lengthMonths,
        monthlyContributionPaise: cycle.monthlyContributionPaise,
        interestRateBps: cycle.interestRateBps,
        interestMode: cycle.interestMode,
        interestSharingMode: cycle.interestSharingMode,
        rotationPayoutEnabled: cycle.rotationPayoutEnabled,
        lateRuleMode: cycle.lateRuleMode,
        lateRuleValue: cycle.lateRuleValue,
      },
      loans: cycleLoans.map((l) => ({
        id: l.id,
        memberId: l.memberId,
        disbursedDate: l.disbursedDate,
        principalPaise: l.principalPaise,
        interestRateBps: l.interestRateBps,
        interestMode: l.interestMode,
      })),
      asOfDate: toIstDateString(),
    });
  }

  return (
    <div className="space-y-6">
      <div className="bg-white border-2 border-slate-300 rounded-xl p-6">
        <h1 className="text-3xl font-bold text-slate-900">Admin Dashboard</h1>
        <p className="text-lg text-slate-700 mt-1">
          {cycle ? `Active Cycle: ${cycle.name}` : 'No active cycle yet. Start by creating a cycle.'}
        </p>
        {totals && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
            <div className="p-4 bg-slate-100 rounded-lg border border-slate-300">
              <div className="text-lg font-semibold text-slate-800">Total Savings</div>
              <div data-important-number="true" className="text-[28px] font-bold text-slate-900">
                {formatPaiseToInr(totals.totalContributionsPaise)}
              </div>
            </div>
            <div className="p-4 bg-slate-100 rounded-lg border border-slate-300">
              <div className="text-lg font-semibold text-slate-800">Treasurer Cash</div>
              <div data-important-number="true" className="text-[28px] font-bold text-slate-900">
                {formatPaiseToInr(totals.treasurerCashOnHandPaise)}
              </div>
            </div>
            <div className="p-4 bg-slate-100 rounded-lg border border-slate-300">
              <div className="text-lg font-semibold text-slate-800">Outstanding Loans</div>
              <div data-important-number="true" className="text-[28px] font-bold text-slate-900">
                {formatPaiseToInr(totals.totalOutstandingPrincipalPaise)}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {ADMIN_CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className="min-h-[48px] min-w-[48px] block bg-white border-2 border-slate-400 rounded-xl p-5 hover:border-blue-900 hover:bg-blue-50"
          >
            <div className="text-xl font-bold text-blue-900">{card.title}</div>
            <div className="text-lg text-slate-700 mt-1">{card.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}


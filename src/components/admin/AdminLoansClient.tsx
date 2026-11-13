'use client';

import React, { useState } from 'react';
import { MoneyConfirmationModal } from '@/components/MoneyConfirmationModal';
import { apiMutate } from '@/lib/client-api';
import { formatDisplayDate, toIstDateString } from '@/lib/dates';
import { formatPaiseToInr, parseStrictIntegerRupeesToPaise } from '@/lib/money';

interface MemberRow {
  id: string;
  name: string;
  mobile: string;
  role: 'ADMIN' | 'MEMBER';
}

interface CycleRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'CLOSED' | 'PENDING_SECOND_ADMIN_APPROVAL';
}

interface LoanRow {
  id: string;
  memberId: string;
  memberName: string;
  principalPaise: number;
  disbursedDate: string;
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'CLOSED' | 'REJECTED';
  balance: {
    outstandingPrincipalPaise: number;
    unpaidAccruedInterestPaise: number;
    totalOwedPaise: number;
  } | null;
}

export function AdminLoansClient({
  initialCycles,
  initialMembers,
  initialLoans,
}: {
  initialCycles: CycleRow[];
  initialMembers: MemberRow[];
  initialLoans: LoanRow[];
}) {
  const onlyMembers = initialMembers.filter((m) => m.role === 'MEMBER');
  const [cycles, setCycles] = useState<CycleRow[]>(initialCycles);
  const [members, setMembers] = useState<MemberRow[]>(onlyMembers);
  const [loans, setLoans] = useState<LoanRow[]>(initialLoans);
  const [selectedMemberId, setSelectedMemberId] = useState(onlyMembers[0]?.id ?? '');
  const [principalRupees, setPrincipalRupees] = useState('');
  const [disbursedDate, setDisbursedDate] = useState(toIstDateString());
  const [note, setNote] = useState('');

  const [repayTarget, setRepayTarget] = useState<LoanRow | null>(null);
  const [repayRupees, setRepayRupees] = useState('');
  const [repayDate, setRepayDate] = useState(toIstDateString());

  const [confirmState, setConfirmState] = useState<{
    kind: 'REQUEST_LOAN' | 'REPAY_LOAN';
    summaryText: string;
    payload: Record<string, unknown>;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAll = async () => {
    const [cRes, mRes, lRes] = await Promise.all([
      fetch('/api/admin/cycles', { cache: 'no-store' }),
      fetch('/api/admin/members', { cache: 'no-store' }),
      fetch('/api/admin/loans', { cache: 'no-store' }),
    ]);
    if (cRes.ok) setCycles(((await cRes.json()) as { cycles: CycleRow[] }).cycles);
    if (mRes.ok) {
      const mData = (await mRes.json()) as { members: MemberRow[] };
      const filtered = mData.members.filter((m) => m.role === 'MEMBER');
      setMembers(filtered);
      if (filtered[0]) {
        setSelectedMemberId((prev) => prev || filtered[0]!.id);
      }
    }
    if (lRes.ok) setLoans(((await lRes.json()) as { loans: LoanRow[] }).loans);
  };

  const activeCycle = cycles.find((c) => c.status === 'ACTIVE');

  const handleReviewLoan = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!activeCycle) {
      setError('No active cycle found.');
      return;
    }
    const member = members.find((m) => m.id === selectedMemberId);
    if (!member) {
      setError('Select a member.');
      return;
    }
    try {
      const principalPaise = parseStrictIntegerRupeesToPaise(principalRupees);
      setConfirmState({
        kind: 'REQUEST_LOAN',
        summaryText: `You are requesting a loan of ${formatPaiseToInr(principalPaise)} for ${
          member.name
        } on ${formatDisplayDate(disbursedDate)}. A second admin must approve before disbursement.`,
        payload: {
          cycleId: activeCycle.id,
          memberId: member.id,
          principalPaise,
          disbursedDate,
          note: note.trim() || undefined,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid loan amount');
    }
  };

  const handleReviewRepay = (e: React.FormEvent) => {
    e.preventDefault();
    if (!repayTarget) return;
    setError('');
    setNotice('');
    try {
      const amountPaise = parseStrictIntegerRupeesToPaise(repayRupees);
      setConfirmState({
        kind: 'REPAY_LOAN',
        summaryText: `You are recording that ${repayTarget.memberName} repaid ${formatPaiseToInr(
          amountPaise
        )} on ${formatDisplayDate(repayDate)}.`,
        payload: {
          loanId: repayTarget.id,
          amountPaise,
          effectiveDate: repayDate,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid repayment amount');
    }
  };

  const handleConfirm = async () => {
    if (!confirmState) return;
    setSubmitting(true);
    setError('');
    try {
      if (confirmState.kind === 'REQUEST_LOAN') {
        await apiMutate('/api/admin/loans', 'POST', confirmState.payload);
        setPrincipalRupees('');
        setNote('');
        setNotice('Loan request submitted for second-admin sign-off.');
      } else {
        const { loanId, ...rest } = confirmState.payload as { loanId: string };
        await apiMutate(`/api/admin/loans/${loanId}/repay`, 'POST', rest);
        setRepayTarget(null);
        setRepayRupees('');
        setNotice('Repayment recorded.');
      }
      setConfirmState(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
      setConfirmState(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-slate-900">Loans & Repayments</h1>

      {error && (
        <div role="alert" className="p-4 rounded-lg border-2 border-red-800 bg-red-50 text-red-900 font-semibold">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="p-4 rounded-lg border-2 border-emerald-800 bg-emerald-50 text-emerald-950 font-semibold">
          {notice}
        </div>
      )}

      <form onSubmit={handleReviewLoan} className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">Request Loan</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="loan-member" className="block font-bold mb-1">
              Member
            </label>
            <select
              id="loan-member"
              value={selectedMemberId}
              onChange={(e) => setSelectedMemberId(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg bg-white"
            >
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.mobile})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="loan-principal" className="block font-bold mb-1">
              Loan Principal (Rupees)
            </label>
            <input
              id="loan-principal"
              required
              inputMode="numeric"
              value={principalRupees}
              onChange={(e) => setPrincipalRupees(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="loan-date" className="block font-bold mb-1">
              Disbursement Date
            </label>
            <input
              id="loan-date"
              type="date"
              required
              value={disbursedDate}
              onChange={(e) => setDisbursedDate(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="loan-note" className="block font-bold mb-1">
              Note (Optional)
            </label>
            <input
              id="loan-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
        </div>
        <button
          type="submit"
          className="min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg bg-blue-900 text-white font-bold text-lg hover:bg-blue-800"
        >
          Review Loan Request
        </button>
      </form>

      {repayTarget && (
        <form onSubmit={handleReviewRepay} className="bg-amber-50 border-2 border-amber-800 rounded-xl p-6 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            Repayment for {repayTarget.memberName}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="repay-amount" className="block font-bold mb-1">
                Repayment Amount (Rupees)
              </label>
              <input
                id="repay-amount"
                required
                inputMode="numeric"
                value={repayRupees}
                onChange={(e) => setRepayRupees(e.target.value)}
                className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg bg-white"
              />
            </div>
            <div>
              <label htmlFor="repay-date" className="block font-bold mb-1">
                Repayment Date
              </label>
              <input
                id="repay-date"
                type="date"
                required
                value={repayDate}
                onChange={(e) => setRepayDate(e.target.value)}
                className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg bg-white"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="submit"
              className="min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg bg-emerald-800 text-white font-bold text-lg"
            >
              Review Repayment
            </button>
            <button
              type="button"
              onClick={() => setRepayTarget(null)}
              className="min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="space-y-3">
        <h2 className="text-2xl font-bold text-slate-900">All Loans</h2>
        {loans.map((l) => (
          <div key={l.id} className="bg-white border-2 border-slate-400 rounded-xl p-5 flex flex-wrap justify-between items-center gap-4">
            <div>
              <div className="text-xl font-bold text-slate-900">
                {l.memberName} — {formatPaiseToInr(l.principalPaise)}
              </div>
              <div className="text-lg text-slate-800">
                Date: {formatDisplayDate(l.disbursedDate)} |{' '}
                {l.status === 'PENDING_APPROVAL' ? 'Pending Approval' : l.status}
                {l.balance
                  ? ` | Owed: ${formatPaiseToInr(l.balance.totalOwedPaise)}`
                  : ''}
              </div>
            </div>
            {l.status === 'ACTIVE' && (
              <button
                type="button"
                onClick={() => {
                  setRepayTarget(l);
                  setRepayRupees('');
                }}
                className="min-h-[48px] min-w-[48px] px-5 py-3 rounded-lg bg-blue-900 text-white font-bold text-lg"
              >
                Record Repayment
              </button>
            )}
          </div>
        ))}
      </div>

      <MoneyConfirmationModal
        open={Boolean(confirmState)}
        summaryText={confirmState?.summaryText ?? ''}
        submitting={submitting}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}


'use client';

import React, { useState } from 'react';
import { MoneyConfirmationModal } from '@/components/MoneyConfirmationModal';
import { apiMutate } from '@/lib/client-api';
import { formatDisplayDate, toIstDateString } from '@/lib/dates';
import { formatPaiseToInr } from '@/lib/money';

interface MemberInfo {
  id: string;
  name: string;
  mobile: string;
}

interface ContribEntry {
  id: string;
  memberId: string | null;
  monthIndex?: number | null;
  amountPaise: number;
  effectiveDate: string;
}

interface CycleInfo {
  id: string;
  name: string;
  lengthMonths: number;
  monthlyContributionPaise: number;
}

export function AdminContributionsClient({
  initialCycle,
  initialMembers,
  initialContributions,
}: {
  initialCycle: CycleInfo | null;
  initialMembers: MemberInfo[];
  initialContributions: ContribEntry[];
}) {
  const [cycle, setCycle] = useState<CycleInfo | null>(initialCycle);
  const [members, setMembers] = useState<MemberInfo[]>(initialMembers);
  const [contributions, setContributions] = useState<ContribEntry[]>(initialContributions);
  const [monthIndex, setMonthIndex] = useState(1);
  const [effectiveDate, setEffectiveDate] = useState(toIstDateString());
  const [pendingMember, setPendingMember] = useState<MemberInfo | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const loadData = async () => {
    const res = await fetch('/api/admin/contributions', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as {
        cycle: CycleInfo | null;
        members: MemberInfo[];
        contributions: ContribEntry[];
      };
      setCycle(data.cycle);
      setMembers(data.members);
      setContributions(data.contributions);
    }
  };

  const handleConfirm = async () => {
    if (!cycle || !pendingMember) return;
    setSubmitting(true);
    setError('');
    try {
      await apiMutate('/api/admin/contributions', 'POST', {
        cycleId: cycle.id,
        memberId: pendingMember.id,
        monthIndex,
        amountPaise: cycle.monthlyContributionPaise,
        effectiveDate,
      });
      setPendingMember(null);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record contribution');
      setPendingMember(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-slate-900">Monthly Contributions Grid</h1>

      {error && (
        <div role="alert" className="p-4 rounded-lg border-2 border-red-800 bg-red-50 text-red-900 font-semibold">
          {error}
        </div>
      )}

      {!cycle ? (
        <div className="bg-white border-2 border-slate-300 rounded-xl p-6 text-xl">
          Please create an active cycle first.
        </div>
      ) : (
        <>
          <div className="bg-white border-2 border-slate-300 rounded-xl p-5 flex flex-wrap gap-4 items-end">
            <div>
              <label htmlFor="contrib-month" className="block font-bold mb-1">
                Cycle Month
              </label>
              <select
                id="contrib-month"
                value={monthIndex}
                onChange={(e) => setMonthIndex(Number(e.target.value))}
                className="min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg bg-white"
              >
                {Array.from({ length: cycle.lengthMonths }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    Month {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="contrib-date" className="block font-bold mb-1">
                Payment Date
              </label>
              <input
                id="contrib-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                className="min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
              />
            </div>
            <div className="text-lg font-bold text-slate-900">
              Fixed Monthly Amount: {formatPaiseToInr(cycle.monthlyContributionPaise)}
            </div>
          </div>

          <div className="space-y-3">
            {members.map((m) => {
              const paidEntry = contributions.find(
                (c) => c.memberId === m.id && c.monthIndex === monthIndex
              );
              return (
                <div
                  key={m.id}
                  className="bg-white border-2 border-slate-400 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4"
                >
                  <div>
                    <div className="text-xl font-bold text-slate-900">{m.name}</div>
                    <div className="text-lg text-slate-700">{m.mobile}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      data-testid={`contrib-status-${m.mobile}`}
                      className={
                        paidEntry
                          ? 'px-4 py-2 rounded-lg bg-emerald-100 text-emerald-950 font-bold text-lg'
                          : 'px-4 py-2 rounded-lg bg-amber-100 text-amber-950 font-bold text-lg'
                      }
                    >
                      {paidEntry ? `Paid (${formatPaiseToInr(paidEntry.amountPaise)})` : 'Pending'}
                    </span>
                    {!paidEntry && (
                      <button
                        type="button"
                        data-testid={`record-contrib-${m.mobile}`}
                        onClick={() => setPendingMember(m)}
                        className="min-h-[48px] min-w-[48px] px-5 py-3 rounded-lg bg-blue-900 text-white font-bold text-lg hover:bg-blue-800"
                      >
                        Record Contribution
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <MoneyConfirmationModal
        open={Boolean(pendingMember && cycle)}
        summaryText={
          pendingMember && cycle
            ? `You are recording that ${pendingMember.name} paid ${formatPaiseToInr(
                cycle.monthlyContributionPaise
              )} for Month ${monthIndex} on ${formatDisplayDate(effectiveDate)}.`
            : ''
        }
        submitting={submitting}
        onConfirm={handleConfirm}
        onCancel={() => setPendingMember(null)}
      />
    </div>
  );
}


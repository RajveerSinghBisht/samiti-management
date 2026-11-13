'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiMutate } from '@/lib/client-api';
import { toIstDateString } from '@/lib/dates';
import { formatPaiseToInr, parseStrictIntegerRupeesToPaise } from '@/lib/money';

interface MemberSummary {
  id: string;
  name: string;
  mobile: string;
}

interface ActiveLoanSummary {
  id: string;
  memberId: string;
  principalPaise: number;
  repaymentMode: string;
}

export function ConductMeetingClient({
  cycle,
  members,
  loans,
}: {
  cycle: {
    id: string;
    name: string;
    monthlyContributionPaise: number;
    interestRateBps: number;
    normalLoanCapPaise: number;
    emergencyLoanCapPaise: number;
  };
  members: MemberSummary[];
  loans: ActiveLoanSummary[];
}) {
  const router = useRouter();
  const [meetingDate, setMeetingDate] = useState(toIstDateString());
  const [place, setPlace] = useState('');
  const [hostMemberId, setHostMemberId] = useState<string>('');
  const [notes, setNotes] = useState('');

  // Attendance set: memberId is present
  const [attendance, setAttendance] = useState<Set<string>>(() => new Set(members.map((m) => m.id)));

  // Contributions set: memberId paid
  const [contributionsPaid, setContributionsPaid] = useState<Set<string>>(() => new Set(members.map((m) => m.id)));

  // Repayments: loanId -> { interest, principal }
  const [repayments, setRepayments] = useState<Map<string, { interest: string; principal: string }>>(() => new Map());

  // Bank interest
  const [bankInterestRupees, setBankInterestRupees] = useState('');

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedNotice, setCompletedNotice] = useState<string | null>(null);

  const toggleAttendance = (memberId: string) => {
    setAttendance((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
        setContributionsPaid((cp) => {
          const nextCp = new Set(cp);
          nextCp.delete(memberId);
          return nextCp;
        });
      } else {
        next.add(memberId);
      }
      return next;
    });
  };

  const toggleContribution = (memberId: string) => {
    setContributionsPaid((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return next;
    });
  };

  const handleRepaymentChange = (loanId: string, field: 'interest' | 'principal', value: string) => {
    setRepayments((prev) => {
      const next = new Map(prev);
      const cur = next.get(loanId) ?? { interest: '', principal: '' };
      next.set(loanId, { ...cur, [field]: value });
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!place.trim()) {
      setError('Meeting place/location is required (e.g. Ramesh Bhai’s home)');
      return;
    }

    setIsSubmitting(true);
    try {
      const attendancesPayload = members.map((m) => ({
        memberId: m.id,
        isPresent: attendance.has(m.id),
      }));

      const contributionsPayload = members
        .filter((m) => contributionsPaid.has(m.id))
        .map((m) => ({
          memberId: m.id,
          amountPaise: cycle.monthlyContributionPaise,
        }));

      const repaymentsPayload = Array.from(repayments.entries())
        .filter(([, v]) => Number(v.interest || 0) > 0 || Number(v.principal || 0) > 0)
        .map(([loanId, v]) => ({
          loanId,
          interestPaidPaise: parseStrictIntegerRupeesToPaise(v.interest || '0'),
          principalPaidPaise: parseStrictIntegerRupeesToPaise(v.principal || '0'),
        }));

      const bankInterestPaise = bankInterestRupees.trim()
        ? parseStrictIntegerRupeesToPaise(bankInterestRupees)
        : undefined;

      const res = await apiMutate('/api/admin/meetings/conduct', 'POST', {
        cycleId: cycle.id,
        meetingDate,
        place: place.trim(),
        hostMemberId: hostMemberId || undefined,
        notes: notes.trim() || undefined,
        attendances: attendancesPayload,
        contributions: contributionsPayload,
        repayments: repaymentsPayload,
        bankInterestPaise,
      });

      const meetingId = (res as { meeting?: { id: string } }).meeting?.id;
      if (meetingId) {
        // Auto-close meeting with summary
        await apiMutate(`/api/admin/meetings/${meetingId}/close`, 'POST', {});
      }

      setCompletedNotice(
        `Monthly meeting for ${meetingDate} at "${place}" conducted and closed successfully. Ledger entries recorded.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to conduct meeting');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (completedNotice) {
    return (
      <div className="bg-white border-2 border-emerald-600 rounded-xl p-6 space-y-4">
        <h1 className="text-3xl font-bold text-emerald-800">Meeting Recorded & Closed</h1>
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-lg text-lg text-emerald-900">
          {completedNotice}
        </div>
        <div className="flex gap-4 pt-4">
          <button
            type="button"
            onClick={() => router.push('/admin/dashboard')}
            className="min-h-[48px] px-6 py-3 bg-blue-900 text-white text-lg font-bold rounded-lg hover:bg-blue-800"
          >
            Go to Monthly Dashboard
          </button>
          <button
            type="button"
            onClick={() => router.push('/admin/meetings')}
            className="min-h-[48px] px-6 py-3 bg-slate-200 text-slate-800 text-lg font-bold rounded-lg hover:bg-slate-300"
          >
            View Meetings
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-3xl font-bold text-slate-900">Conduct Monthly Meeting</h1>
        <p className="text-lg text-slate-700 mt-1">
          Cycle: <strong>{cycle.name}</strong> | Fixed Monthly Contribution:{' '}
          <strong>{formatPaiseToInr(cycle.monthlyContributionPaise)}</strong>
        </p>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-100 border-2 border-red-400 rounded-lg text-red-900 text-lg font-semibold">
          {error}
        </div>
      )}

      {/* SECTION 1: MEETING DETAILS */}
      <div className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">1. Meeting Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="meeting-date" className="block text-lg font-bold text-slate-800 mb-1">
              Meeting Date (IST)
            </label>
            <input
              id="meeting-date"
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
              required
            />
          </div>
          <div>
            <label htmlFor="meeting-place" className="block text-lg font-bold text-slate-800 mb-1">
              Host / Place (e.g. Ramesh Bhai’s Home)
            </label>
            <input
              id="meeting-place"
              type="text"
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="e.g. Ramesh Bhai’s Home"
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
              required
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="meeting-host" className="block text-lg font-bold text-slate-800 mb-1">
              Host Member (Optional)
            </label>
            <select
              id="meeting-host"
              value={hostMemberId}
              onChange={(e) => setHostMemberId(e.target.value)}
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
            >
              <option value="">-- Select Host --</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.mobile})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="meeting-notes" className="block text-lg font-bold text-slate-800 mb-1">
              Notes / Decisions
            </label>
            <input
              id="meeting-notes"
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Discussed festival holiday dates"
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
            />
          </div>
        </div>
      </div>

      {/* SECTION 2: ATTENDANCE & CONTRIBUTIONS */}
      <div className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">
          2. Attendance & Monthly Contributions ({members.length} members)
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-100 border-b-2 border-slate-300 text-left">
                <th className="p-3 text-lg font-bold text-slate-800">Member</th>
                <th className="p-3 text-lg font-bold text-slate-800 text-center">Present</th>
                <th className="p-3 text-lg font-bold text-slate-800 text-center">
                  Paid Contribution ({formatPaiseToInr(cycle.monthlyContributionPaise)})
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="p-3">
                    <div className="font-bold text-lg text-slate-900">{m.name}</div>
                    <div className="text-slate-600 font-mono text-sm">{m.mobile}</div>
                  </td>
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={attendance.has(m.id)}
                      onChange={() => toggleAttendance(m.id)}
                      className="w-6 h-6 rounded cursor-pointer"
                    />
                  </td>
                  <td className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={contributionsPaid.has(m.id)}
                      onChange={() => toggleContribution(m.id)}
                      className="w-6 h-6 rounded cursor-pointer"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 3: LOAN REPAYMENTS */}
      {loans.length > 0 && (
        <div className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">3. Loan Repayments</h2>
          <p className="text-slate-700">
            Authoritative Rule: Interest paid and Principal repaid are two separate entries, never auto-allocated.
          </p>
          <div className="space-y-4">
            {loans.map((l) => {
              const mem = members.find((m) => m.id === l.memberId);
              const rep = repayments.get(l.id) ?? { interest: '', principal: '' };
              return (
                <div key={l.id} className="p-4 bg-slate-50 border rounded-lg grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
                  <div>
                    <div className="font-bold text-lg text-slate-900">{mem?.name || 'Borrower'}</div>
                    <div className="text-sm text-slate-600">
                      Principal: {formatPaiseToInr(l.principalPaise)} | Mode: {l.repaymentMode}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700">Interest Paid (₹)</label>
                    <input
                      type="number"
                      min={0}
                      value={rep.interest}
                      onChange={(e) => handleRepaymentChange(l.id, 'interest', e.target.value)}
                      placeholder="0"
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-700">Principal Repaid (₹)</label>
                    <input
                      type="number"
                      min={0}
                      value={rep.principal}
                      onChange={(e) => handleRepaymentChange(l.id, 'principal', e.target.value)}
                      placeholder="0"
                      className="w-full p-2 border rounded"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SECTION 4: BANK INTEREST */}
      <div className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">4. Bank Interest Received (Optional)</h2>
        <div>
          <label htmlFor="bank-interest" className="block text-lg font-bold text-slate-800 mb-1">
            Bank Interest for this month (Rupees)
          </label>
          <input
            id="bank-interest"
            type="number"
            min={0}
            value={bankInterestRupees}
            onChange={(e) => setBankInterestRupees(e.target.value)}
            placeholder="0"
            className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
          />
          <p className="text-sm text-slate-600 mt-1">
            Bank interest is added to the interest pool shared among members at cycle end.
          </p>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="min-h-[48px] px-8 py-3 bg-emerald-700 text-white text-xl font-bold rounded-lg hover:bg-emerald-800 disabled:opacity-50"
        >
          {isSubmitting ? 'Recording Meeting...' : 'Record Meeting & Close'}
        </button>
      </div>
    </form>
  );
}

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

interface MemberReduction {
  memberId: string;
  memberName: string;
  reductionPaise: number;
}

interface PreviewResult {
  amountPaise: number;
  availableInterestPoolPaise: number;
  exceedsPool: boolean;
  memberReductions: MemberReduction[];
}

export function GoodCauseClient({
  cycle,
  members,
}: {
  cycle: { id: string; name: string };
  members: MemberSummary[];
}) {
  const router = useRouter();
  const [meetingDate, setMeetingDate] = useState(toIstDateString());
  const [recipientType, setRecipientType] = useState<'MEMBER' | 'OUTSIDER'>('OUTSIDER');
  const [recipientMemberId, setRecipientMemberId] = useState('');
  const [outsiderName, setOutsiderName] = useState('');
  const [reason, setReason] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [whoAgreedNote, setWhoAgreedNote] = useState('');

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [confirmPoolExceeded, setConfirmPoolExceeded] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const recipientName =
    recipientType === 'MEMBER'
      ? members.find((m) => m.id === recipientMemberId)?.name || ''
      : outsiderName.trim();

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMessage(null);

    if (!reason.trim()) {
      setError('A written reason is required for a Good Cause Grant');
      return;
    }
    if (!recipientName) {
      setError('Please select or specify the recipient');
      return;
    }
    if (!whoAgreedNote.trim()) {
      setError('Please enter attendance & consent note of who agreed at the meeting');
      return;
    }

    try {
      const amountPaise = parseStrictIntegerRupeesToPaise(amountRupees);
      const res = (await apiMutate('/api/admin/good-cause/preview', 'POST', {
        cycleId: cycle.id,
        amountPaise,
      })) as PreviewResult;

      setPreview(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to calculate grant preview');
    }
  };

  const handleConfirmAndSubmit = async () => {
    if (!preview) return;
    setError('');
    setIsSubmitting(true);
    try {
      await apiMutate('/api/admin/good-cause', 'POST', {
        cycleId: cycle.id,
        meetingDate,
        recipientType,
        recipientName,
        recipientMemberId: recipientType === 'MEMBER' ? recipientMemberId : undefined,
        reason: reason.trim(),
        whoAgreedNote: whoAgreedNote.trim(),
        amountPaise: preview.amountPaise,
        confirmPoolExceeded: preview.exceedsPool ? confirmPoolExceeded : undefined,
      });

      setSuccessMessage(
        `Good Cause Grant of ${formatPaiseToInr(preview.amountPaise)} submitted for second-admin approval.`
      );
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit grant');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successMessage) {
    return (
      <div className="bg-white border-2 border-emerald-600 rounded-xl p-6 space-y-4">
        <h1 className="text-3xl font-bold text-emerald-800">Grant Submitted for Approval</h1>
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-lg text-lg text-emerald-900">
          {successMessage}
        </div>
        <p className="text-lg text-slate-700">
          A second admin must approve this request in the Approvals Queue before the grant is recorded to the ledger.
        </p>
        <div className="flex gap-4 pt-4">
          <button
            type="button"
            onClick={() => router.push('/admin/approvals')}
            className="min-h-[48px] px-6 py-3 bg-blue-900 text-white text-lg font-bold rounded-lg hover:bg-blue-800"
          >
            Go to Approvals Queue
          </button>
          <button
            type="button"
            onClick={() => {
              setSuccessMessage(null);
              setAmountRupees('');
              setReason('');
              setOutsiderName('');
              setWhoAgreedNote('');
            }}
            className="min-h-[48px] px-6 py-3 bg-slate-200 text-slate-800 text-lg font-bold rounded-lg"
          >
            Create Another Grant
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 bg-amber-100 text-amber-900 text-sm font-bold uppercase rounded-full">
            Special Community Sidebar Action
          </span>
        </div>
        <h1 className="text-3xl font-bold text-slate-900 mt-2">Give for a Good Cause</h1>
        <p className="text-lg text-slate-700 mt-1">
          Cycle: <strong>{cycle.name}</strong> | Authoritative Rule 10: Deducted from interest pool, shared equally, recipient repays nothing.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-100 border-2 border-red-400 rounded-lg text-red-900 font-semibold">
          {error}
        </div>
      )}

      {/* GRANT FORM */}
      {!preview ? (
        <form onSubmit={handlePreview} className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
          <div>
            <label htmlFor="grant-date" className="block text-lg font-bold text-slate-800 mb-1">
              Meeting Date (IST)
            </label>
            <input
              id="grant-date"
              type="date"
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
              required
            />
          </div>

          <div>
            <label className="block text-lg font-bold text-slate-800 mb-2">Recipient</label>
            <div className="flex gap-4 mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="recipientType"
                  value="OUTSIDER"
                  checked={recipientType === 'OUTSIDER'}
                  onChange={() => setRecipientType('OUTSIDER')}
                  className="w-5 h-5"
                />
                <span className="text-lg font-semibold">Outsider / Community Cause</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="recipientType"
                  value="MEMBER"
                  checked={recipientType === 'MEMBER'}
                  onChange={() => setRecipientType('MEMBER')}
                  className="w-5 h-5"
                />
                <span className="text-lg font-semibold">Samiti Member</span>
              </label>
            </div>

            {recipientType === 'MEMBER' ? (
              <select
                value={recipientMemberId}
                onChange={(e) => setRecipientMemberId(e.target.value)}
                className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
                required
              >
                <option value="">-- Select Member --</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.mobile})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={outsiderName}
                onChange={(e) => setOutsiderName(e.target.value)}
                placeholder="e.g. Village Temple Fund / Local School Books"
                className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
                required
              />
            )}
          </div>

          <div>
            <label htmlFor="grant-amount" className="block text-lg font-bold text-slate-800 mb-1">
              Grant Amount (Rupees)
            </label>
            <input
              id="grant-amount"
              type="number"
              min={1}
              value={amountRupees}
              onChange={(e) => setAmountRupees(e.target.value)}
              placeholder="e.g. 500"
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
              required
            />
          </div>

          <div>
            <label htmlFor="grant-reason" className="block text-lg font-bold text-slate-800 mb-1">
              Reason / Purpose
            </label>
            <textarea
              id="grant-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Emergency medical help for neighbor in need"
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
              required
            />
          </div>

          <div>
            <label htmlFor="grant-who-agreed" className="block text-lg font-bold text-slate-800 mb-1">
              Who Agreed (Meeting Attendance & Consent Note)
            </label>
            <textarea
              id="grant-who-agreed"
              rows={2}
              value={whoAgreedNote}
              onChange={(e) => setWhoAgreedNote(e.target.value)}
              placeholder="e.g. Unanimously agreed by all 12 members present at January meeting"
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
              required
            />
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="submit"
              className="min-h-[48px] px-8 py-3 bg-blue-900 text-white text-xl font-bold rounded-lg hover:bg-blue-800"
            >
              Preview Deductions →
            </button>
          </div>
        </form>
      ) : (
        /* CONFIRMATION SCREEN WITH MEMBER REDUCTIONS */
        <div className="bg-white border-2 border-blue-900 rounded-xl p-6 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            Confirm Good Cause Grant & Equal Deductions
          </h2>

          <div className="p-4 bg-slate-100 rounded-lg text-lg text-slate-800 space-y-1">
            <p>
              <strong>Recipient:</strong> {recipientName} ({recipientType})
            </p>
            <p>
              <strong>Grant Amount:</strong> {formatPaiseToInr(preview.amountPaise)}
            </p>
            <p>
              <strong>Reason:</strong> {reason}
            </p>
            <p>
              <strong>Who Agreed:</strong> {whoAgreedNote}
            </p>
            <p>
              <strong>Available Interest Pool:</strong>{' '}
              {formatPaiseToInr(preview.availableInterestPoolPaise)}
            </p>
          </div>

          {preview.exceedsPool && (
            <div className="p-4 bg-amber-100 border-2 border-amber-500 rounded-lg space-y-2">
              <div className="font-bold text-amber-900 text-lg">
                ⚠️ Warning: Grant Exceeds Available Interest Pool!
              </div>
              <p className="text-amber-800">
                The requested grant of {formatPaiseToInr(preview.amountPaise)} exceeds the interest collected so far ({formatPaiseToInr(preview.availableInterestPoolPaise)}). Rule 4/Authoritative rules require explicit two-admin confirmation to disburse.
              </p>
              <label className="flex items-center gap-3 pt-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmPoolExceeded}
                  onChange={(e) => setConfirmPoolExceeded(e.target.checked)}
                  className="w-6 h-6 rounded"
                />
                <span className="font-bold text-amber-950">
                  I explicitly confirm disbursing this grant beyond collected interest.
                </span>
              </label>
            </div>
          )}

          <div className="border rounded-lg overflow-hidden">
            <div className="p-3 bg-slate-100 font-bold text-slate-800">
              Each Member’s Interest Share Reduction ({preview.memberReductions.length} members):
            </div>
            <div className="max-h-60 overflow-y-auto divide-y">
              {preview.memberReductions.map((r) => (
                <div key={r.memberId} className="p-3 flex justify-between">
                  <span className="font-semibold text-slate-900">{r.memberName}</span>
                  <span className="font-mono font-bold text-slate-900">
                    −{formatPaiseToInr(r.reductionPaise)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="min-h-[48px] px-6 py-3 bg-slate-200 text-slate-800 text-lg font-bold rounded-lg"
            >
              ← Edit Details
            </button>
            <button
              type="button"
              disabled={isSubmitting || (preview.exceedsPool && !confirmPoolExceeded)}
              onClick={handleConfirmAndSubmit}
              className="min-h-[48px] px-8 py-3 bg-emerald-700 text-white text-xl font-bold rounded-lg hover:bg-emerald-800 disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Confirm & Submit for Second Admin Approval'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


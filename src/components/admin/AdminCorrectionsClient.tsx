'use client';

import React, { useState } from 'react';
import { MoneyConfirmationModal } from '@/components/MoneyConfirmationModal';
import { apiMutate } from '@/lib/client-api';
import { formatDisplayDate } from '@/lib/dates';
import { formatPaiseToInr } from '@/lib/money';

interface LedgerRow {
  id: string;
  entryType: string;
  amountPaise: number;
  effectiveDate: string;
  memberName: string | null;
  reason: string | null;
  isReversed: boolean;
}

export function AdminCorrectionsClient({ initialEntries }: { initialEntries: LedgerRow[] }) {
  const [entries, setEntries] = useState<LedgerRow[]>(initialEntries);
  const [selected, setSelected] = useState<LedgerRow | null>(null);
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadEntries = async () => {
    const res = await fetch('/api/admin/ledger', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as { entries: LedgerRow[] };
      setEntries(data.entries);
    }
  };

  const handleConfirm = async () => {
    if (!selected) return;
    setSubmitting(true);
    setError('');
    setNotice('');
    try {
      const res = await apiMutate<{ status: string }>('/api/admin/ledger/reverse', 'POST', {
        ledgerEntryId: selected.id,
        reason: reason.trim(),
      });
      setConfirmOpen(false);
      setSelected(null);
      setReason('');
      setNotice(
        res.status === 'PENDING_APPROVAL'
          ? 'High-value reversal queued for second admin approval.'
          : 'Reversal entry recorded.'
      );
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reversal failed');
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-slate-900">Ledger Corrections & Reversals</h1>
      <p className="text-lg text-slate-800">
        The ledger is append-only. Mistakes are fixed by appending a reversal entry with a reason.
      </p>

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

      {selected && (
        <div className="bg-amber-50 border-2 border-amber-800 rounded-xl p-5 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">
            Reverse {selected.entryType} ({formatPaiseToInr(selected.amountPaise)})
          </h2>
          <div>
            <label htmlFor="rev-reason" className="block font-bold mb-1">
              Required Reason for Reversal
            </label>
            <input
              id="rev-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain what was wrong (min 3 characters)"
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg bg-white"
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={reason.trim().length < 3}
              className="min-h-[48px] min-w-[48px] px-5 py-3 rounded-lg bg-red-800 text-white font-bold text-lg"
            >
              Review Reversal
            </button>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="min-h-[48px] min-w-[48px] px-5 py-3 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {entries.map((e) => (
          <div
            key={e.id}
            className="bg-white border-2 border-slate-400 rounded-xl p-4 flex flex-wrap justify-between items-center gap-3"
          >
            <div>
              <div className="text-xl font-bold text-slate-900">
                {e.entryType} — {formatPaiseToInr(e.amountPaise)}
              </div>
              <div className="text-lg text-slate-800">
                {formatDisplayDate(e.effectiveDate)}
                {e.memberName ? ` | ${e.memberName}` : ''}
                {e.reason ? ` | ${e.reason}` : ''}
              </div>
            </div>
            <div>
              {e.entryType === 'REVERSAL' ? (
                <span className="px-3 py-1 rounded bg-slate-200 font-bold">Reversal Entry</span>
              ) : e.isReversed ? (
                <span className="px-3 py-1 rounded bg-amber-100 text-amber-950 font-bold">
                  Reversed
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setSelected(e);
                    setReason('');
                  }}
                  className="min-h-[48px] min-w-[48px] px-4 py-2 rounded-lg border-2 border-red-800 text-red-900 font-bold"
                >
                  Reverse Entry
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <MoneyConfirmationModal
        open={confirmOpen}
        summaryText={
          selected
            ? `You are reversing ${selected.entryType} of ${formatPaiseToInr(
                selected.amountPaise
              )} for reason: "${reason.trim()}".`
            : ''
        }
        submitting={submitting}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}


'use client';

import React, { useState } from 'react';
import { apiMutate } from '@/lib/client-api';
import { formatPaiseToInr } from '@/lib/money';

interface ApprovalRow {
  id: string;
  actionType: string;
  amountPaise: number;
  reason: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedByAdminId: string;
  decidedByAdminId: string | null;
  payloadJson: Record<string, unknown>;
}

export function AdminApprovalsClient({
  initialApprovals,
  currentUserId,
}: {
  initialApprovals: ApprovalRow[];
  currentUserId: string;
}) {
  const [approvals, setApprovals] = useState<ApprovalRow[]>(initialApprovals);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAll = async () => {
    const aRes = await fetch('/api/admin/approvals', { cache: 'no-store' });
    if (aRes.ok) {
      const data = (await aRes.json()) as { approvals: ApprovalRow[] };
      setApprovals(data.approvals);
    }
  };

  const handleDecide = async (id: string, decision: 'APPROVE' | 'REJECT') => {
    setError('');
    setNotice('');
    try {
      const res = await apiMutate<{ approval: ApprovalRow }>(
        `/api/admin/approvals/${id}/decide`,
        'POST',
        { decision }
      );
      setApprovals((prev) => prev.map((row) => (row.id === id ? res.approval : row)));
      setNotice(decision === 'APPROVE' ? 'Decision saved (granted).' : 'Decision saved (declined).');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decision failed');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-slate-900">Two-Admin Approvals Queue</h1>

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

      {approvals.length === 0 ? (
        <div className="bg-white border-2 border-slate-300 rounded-xl p-6 text-xl">
          No approval requests yet.
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((a) => {
            const isSameAdmin = currentUserId === a.requestedByAdminId;
            return (
              <div
                key={a.id}
                className="bg-white border-2 border-slate-400 rounded-xl p-5 flex flex-wrap justify-between items-center gap-4"
              >
                <div>
                  <div className="text-xl font-bold text-slate-900">
                    {a.actionType}
                    {a.amountPaise > 0 ? ` — ${formatPaiseToInr(a.amountPaise)}` : ''}
                  </div>
                  <div className="text-lg text-slate-800">
                    Status: <span className="font-bold">{a.status}</span>
                    {a.reason ? ` | Reason: ${a.reason}` : ''}
                  </div>
                  {a.status === 'PENDING' && isSameAdmin && (
                    <div className="text-lg text-amber-900 font-semibold mt-1">
                      Requested by you — a different admin must decide.
                    </div>
                  )}
                </div>

                {a.status === 'PENDING' && (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => handleDecide(a.id, 'APPROVE')}
                      className="min-h-[48px] min-w-[48px] px-5 py-3 rounded-lg bg-emerald-800 text-white font-bold text-lg hover:bg-emerald-900"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDecide(a.id, 'REJECT')}
                      className="min-h-[48px] min-w-[48px] px-5 py-3 rounded-lg border-2 border-red-800 bg-white text-red-900 font-bold text-lg hover:bg-red-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


'use client';

import React from 'react';

export function MoneyConfirmationModal({
  open,
  summaryText,
  submitting,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  summaryText: string;
  submitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-money-heading"
      data-testid="money-confirmation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 p-4"
    >
      <div className="w-full max-w-lg rounded-xl border-2 border-slate-800 bg-white p-6 shadow-xl">
        <h2 id="confirm-money-heading" className="text-2xl font-bold text-slate-900 mb-3">
          Please Confirm This Entry
        </h2>
        <p className="text-xl text-slate-900 bg-amber-50 border-2 border-amber-700 rounded-lg p-4 mb-6 font-medium">
          {summaryText}
        </p>
        <div className="flex flex-wrap gap-3 justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold text-lg hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg bg-emerald-800 text-white font-bold text-lg hover:bg-emerald-900"
          >
            {submitting ? 'Saving...' : 'Confirm and Save'}
          </button>
        </div>
      </div>
    </div>
  );
}


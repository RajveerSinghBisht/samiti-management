'use client';

import React, { useState } from 'react';
import { apiMutate } from '@/lib/client-api';

export function AdminExportClient({
  initialThresholdPaise,
  initialProvider,
}: {
  initialThresholdPaise: number;
  initialProvider: 'prepare' | 'send';
}) {
  const [thresholdPaise, setThresholdPaise] = useState(String(initialThresholdPaise));
  const [messagingProvider, setMessagingProvider] = useState<'prepare' | 'send'>(initialProvider);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setNotice('');
    setError('');
    try {
      await apiMutate('/api/admin/settings', 'PATCH', {
        reversalApprovalThresholdPaise: Number(thresholdPaise),
        messagingProvider,
      });
      setNotice('Settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-slate-900">Backups, Export & Settings</h1>

      <section className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">Download Data Export (Admin Only)</h2>
        <p className="text-lg text-slate-800">
          Exports exclude all PINs, passwords, TOTP keys, and recovery codes.
        </p>
        <div className="flex flex-wrap gap-4">
          <a
            href="/api/admin/export?format=json"
            className="min-h-[48px] min-w-[48px] inline-flex items-center px-6 py-3 rounded-lg bg-blue-900 text-white font-bold text-lg hover:bg-blue-800"
          >
            Download JSON Backup
          </a>
          <a
            href="/api/admin/export?format=csv"
            className="min-h-[48px] min-w-[48px] inline-flex items-center px-6 py-3 rounded-lg border-2 border-slate-800 bg-white text-slate-900 font-bold text-lg hover:bg-slate-100"
          >
            Download Ledger CSV
          </a>
        </div>
      </section>

      <form onSubmit={handleSaveSettings} className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">Group Policy Settings</h2>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="rev-threshold" className="block font-bold mb-1">
              Two-Admin Reversal Threshold (Paise)
            </label>
            <input
              id="rev-threshold"
              type="number"
              min={0}
              value={thresholdPaise}
              onChange={(e) => setThresholdPaise(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="msg-provider" className="block font-bold mb-1">
              Weekly Reminder Mode
            </label>
            <select
              id="msg-provider"
              value={messagingProvider}
              onChange={(e) => setMessagingProvider(e.target.value as 'prepare' | 'send')}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg bg-white"
            >
              <option value="prepare">Prepare (Click-to-Chat Links for Admin)</option>
              <option value="send">Send (Requires API Configuration)</option>
            </select>
          </div>
        </div>
        <button
          type="submit"
          className="min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg bg-emerald-800 text-white font-bold text-lg"
        >
          Save Policy Settings
        </button>
      </form>
    </div>
  );
}


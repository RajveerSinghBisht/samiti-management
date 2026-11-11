'use client';

import React, { useState } from 'react';
import { apiMutate } from '@/lib/client-api';
import { formatDisplayDate, toIstDateString } from '@/lib/dates';
import { formatPaiseToInr, parseStrictIntegerRupeesToPaise } from '@/lib/money';

export interface CycleRow {
  id: string;
  name: string;
  startDate: string;
  lengthMonths: number;
  monthlyContributionPaise: number;
  interestRateBps: number;
  interestMode: 'REDUCING_BALANCE' | 'FLAT';
  interestSharingMode: 'PROPORTIONAL_CONTRIBUTION' | 'EQUAL';
  rotationPayoutEnabled: boolean;
  status: 'ACTIVE' | 'CLOSED';
}

function parsePercentToBps(raw: string): number {
  const trimmed = raw.trim();
  const parts = trimmed.split('.');
  if (parts.length > 2) {
    throw new Error('Interest rate must be a non-negative number with up to 2 decimal places');
  }
  const wholePart = parts[0] ?? '';
  const fracPart = parts[1] ?? '';
  if (!/^\d+$/.test(wholePart) || (parts.length === 2 && !/^\d{1,2}$/.test(fracPart))) {
    throw new Error('Interest rate must be a non-negative number with up to 2 decimal places');
  }
  return Number(wholePart) * 100 + Number(fracPart.padEnd(2, '0'));
}

export function AdminCycleClient({ initialCycles }: { initialCycles: CycleRow[] }) {
  const [cycles, setCycles] = useState<CycleRow[]>(initialCycles);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(toIstDateString());
  const [lengthMonths, setLengthMonths] = useState('12');
  const [monthlyRupees, setMonthlyRupees] = useState('1000');
  const [ratePercent, setRatePercent] = useState('3');
  const [interestMode, setInterestMode] = useState<'REDUCING_BALANCE' | 'FLAT'>('REDUCING_BALANCE');
  const [sharingMode, setSharingMode] = useState<'PROPORTIONAL_CONTRIBUTION' | 'EQUAL'>(
    'PROPORTIONAL_CONTRIBUTION'
  );
  const [rotationEnabled, setRotationEnabled] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadCycles = async () => {
    const res = await fetch('/api/admin/cycles', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as { cycles: CycleRow[] };
      setCycles(data.cycles);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      const monthlyContributionPaise = parseStrictIntegerRupeesToPaise(monthlyRupees);
      const interestRateBps = parsePercentToBps(ratePercent);
      await apiMutate('/api/admin/cycles', 'POST', {
        name: name.trim(),
        startDate,
        lengthMonths: Number(lengthMonths),
        monthlyContributionPaise,
        interestRateBps,
        interestMode,
        interestSharingMode: sharingMode,
        rotationPayoutEnabled: rotationEnabled,
      });
      setName('');
      setNotice('Cycle created.');
      await loadCycles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cycle');
    }
  };

  const handleRequestClose = async (cycleId: string) => {
    setError('');
    setNotice('');
    try {
      await apiMutate(`/api/admin/cycles/${cycleId}/close`, 'POST', {
        asOfDate: toIstDateString(),
        reason: 'End of cycle closing request',
      });
      setNotice('Cycle close request added to Approvals Queue for second admin.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to request cycle close');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-slate-900">Cycle Settings</h1>

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

      <form onSubmit={handleCreate} className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">Start New Cycle</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="cycle-name" className="block font-bold mb-1">
              Cycle Name
            </label>
            <input
              id="cycle-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="cycle-start" className="block font-bold mb-1">
              Start Date
            </label>
            <input
              id="cycle-start"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="cycle-length" className="block font-bold mb-1">
              Length (Months)
            </label>
            <select
              id="cycle-length"
              value={lengthMonths}
              onChange={(e) => setLengthMonths(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg bg-white"
            >
              <option value="12">1 Year (12 months)</option>
              <option value="24">2 Years (24 months)</option>
              <option value="60">5 Years (60 months)</option>
            </select>
          </div>
          <div>
            <label htmlFor="cycle-contrib" className="block font-bold mb-1">
              Monthly Contribution (Rupees)
            </label>
            <input
              id="cycle-contrib"
              required
              inputMode="numeric"
              value={monthlyRupees}
              onChange={(e) => setMonthlyRupees(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="cycle-rate" className="block font-bold mb-1">
              Loan Interest Rate (% per month)
            </label>
            <input
              id="cycle-rate"
              required
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="cycle-int-mode" className="block font-bold mb-1">
              Interest Mode
            </label>
            <select
              id="cycle-int-mode"
              value={interestMode}
              onChange={(e) => setInterestMode(e.target.value as 'REDUCING_BALANCE' | 'FLAT')}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg bg-white"
            >
              <option value="REDUCING_BALANCE">Reducing Balance (Outstanding Principal)</option>
              <option value="FLAT">Flat Monthly Rate</option>
            </select>
          </div>
          <div>
            <label htmlFor="cycle-share-mode" className="block font-bold mb-1">
              Interest Sharing Mode
            </label>
            <select
              id="cycle-share-mode"
              value={sharingMode}
              onChange={(e) =>
                setSharingMode(e.target.value as 'PROPORTIONAL_CONTRIBUTION' | 'EQUAL')
              }
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg bg-white"
            >
              <option value="PROPORTIONAL_CONTRIBUTION">Proportional to Contributions</option>
              <option value="EQUAL">Equal Among Members</option>
            </select>
          </div>
          <div className="flex items-center gap-3 pt-6">
            <input
              id="cycle-rotation"
              type="checkbox"
              checked={rotationEnabled}
              onChange={(e) => setRotationEnabled(e.target.checked)}
              className="w-6 h-6"
            />
            <label htmlFor="cycle-rotation" className="font-bold">
              Enable Monthly Rotation Lump-Sum Payout
            </label>
          </div>
        </div>
        <button
          type="submit"
          className="min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg bg-blue-900 text-white font-bold text-lg hover:bg-blue-800"
        >
          Create Cycle
        </button>
      </form>

      <div className="space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">Existing Cycles</h2>
        {cycles.map((c) => (
          <div key={c.id} className="bg-white border-2 border-slate-400 rounded-xl p-5 flex flex-wrap justify-between items-center gap-4">
            <div>
              <div className="text-2xl font-bold text-slate-900">{c.name}</div>
              <div className="text-lg text-slate-800">
                Start: {formatDisplayDate(c.startDate)} | {c.lengthMonths} months |{' '}
                {formatPaiseToInr(c.monthlyContributionPaise)}/month | {c.interestRateBps / 100}% ({c.interestMode}) | Status: {c.status}
              </div>
            </div>
            {c.status === 'ACTIVE' && (
              <button
                type="button"
                onClick={() => handleRequestClose(c.id)}
                className="min-h-[48px] min-w-[48px] px-5 py-3 rounded-lg border-2 border-red-800 bg-white text-red-900 font-bold text-lg hover:bg-red-50"
              >
                Request Cycle Close
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


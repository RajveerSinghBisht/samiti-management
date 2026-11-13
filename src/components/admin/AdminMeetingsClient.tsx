'use client';

import React, { useState } from 'react';
import { apiMutate } from '@/lib/client-api';
import { formatDisplayDate, toIstDateString } from '@/lib/dates';

interface CycleRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'CLOSED' | 'PENDING_SECOND_ADMIN_APPROVAL';
}

interface MemberRow {
  id: string;
  name: string;
  role: string;
}

interface MeetingRow {
  id: string;
  meetingDate: string;
  place: string;
  hostName: string | null;
  notes: string | null;
}

export function AdminMeetingsClient({
  initialCycles,
  initialMembers,
  initialMeetings,
}: {
  initialCycles: CycleRow[];
  initialMembers: MemberRow[];
  initialMeetings: MeetingRow[];
}) {
  const [cycles, setCycles] = useState<CycleRow[]>(initialCycles);
  const [members, setMembers] = useState<MemberRow[]>(initialMembers);
  const [meetings, setMeetings] = useState<MeetingRow[]>(initialMeetings);
  const [meetingDate, setMeetingDate] = useState(toIstDateString());
  const [hostMemberId, setHostMemberId] = useState('');
  const [place, setPlace] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadAll = async () => {
    const [cRes, mRes, mtRes] = await Promise.all([
      fetch('/api/admin/cycles', { cache: 'no-store' }),
      fetch('/api/admin/members', { cache: 'no-store' }),
      fetch('/api/admin/meetings', { cache: 'no-store' }),
    ]);
    if (cRes.ok) setCycles(((await cRes.json()) as { cycles: CycleRow[] }).cycles);
    if (mRes.ok) setMembers(((await mRes.json()) as { members: MemberRow[] }).members);
    if (mtRes.ok) setMeetings(((await mtRes.json()) as { meetings: MeetingRow[] }).meetings);
  };

  const activeCycle = cycles.find((c) => c.status === 'ACTIVE');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!activeCycle) {
      setError('Create an active cycle first.');
      return;
    }
    try {
      await apiMutate('/api/admin/meetings', 'POST', {
        cycleId: activeCycle.id,
        meetingDate,
        hostMemberId: hostMemberId || null,
        place: place.trim(),
        notes: notes.trim() || undefined,
      });
      setPlace('');
      setNotes('');
      setNotice('Meeting scheduled.');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule meeting');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-slate-900">Meetings</h1>

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
        <h2 className="text-2xl font-bold text-slate-900">Schedule Meeting</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="meet-date" className="block font-bold mb-1">
              Meeting Date
            </label>
            <input
              id="meet-date"
              type="date"
              required
              value={meetingDate}
              onChange={(e) => setMeetingDate(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="meet-host" className="block font-bold mb-1">
              Host Member (Optional)
            </label>
            <select
              id="meet-host"
              value={hostMemberId}
              onChange={(e) => setHostMemberId(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg bg-white"
            >
              <option value="">-- Select Host --</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            <label htmlFor="meet-place" className="block font-bold mb-1">
              Place (Free Text)
            </label>
            <input
              id="meet-place"
              required
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="meet-notes" className="block font-bold mb-1">
              Notes (Optional)
            </label>
            <input
              id="meet-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
        </div>
        <button
          type="submit"
          className="min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg bg-blue-900 text-white font-bold text-lg hover:bg-blue-800"
        >
          Schedule Meeting
        </button>
      </form>

      <div className="space-y-3">
        {meetings.map((mt) => (
          <div key={mt.id} className="bg-white border-2 border-slate-400 rounded-xl p-5">
            <div className="text-xl font-bold text-slate-900">
              {formatDisplayDate(mt.meetingDate)}
            </div>
            <div className="text-lg text-slate-800">
              Place: {mt.place}
              {mt.hostName ? ` | Host: ${mt.hostName}` : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


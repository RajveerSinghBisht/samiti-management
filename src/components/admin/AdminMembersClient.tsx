'use client';

import React, { useState } from 'react';
import { apiMutate } from '@/lib/client-api';

export interface MemberRow {
  id: string;
  name: string;
  mobile: string;
  role: 'ADMIN' | 'MEMBER';
  status: 'ACTIVE' | 'INACTIVE';
  mustChangePin: boolean;
  totpEnabled: boolean;
}

export function AdminMembersClient({ initialMembers }: { initialMembers: MemberRow[] }) {
  const [members, setMembers] = useState<MemberRow[]>(initialMembers);
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [role, setRole] = useState<'MEMBER' | 'ADMIN'>('MEMBER');
  const [initialSecret, setInitialSecret] = useState('');
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);
  const [resetPinVal, setResetPinVal] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadMembers = async () => {
    const res = await fetch('/api/admin/members', { cache: 'no-store' });
    if (res.ok) {
      const data = (await res.json()) as { members: MemberRow[] };
      setMembers(data.members);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiMutate('/api/admin/members', 'POST', {
        name: name.trim(),
        mobile: mobile.trim(),
        role,
        initialSecret: initialSecret.trim(),
      });
      setName('');
      setMobile('');
      setInitialSecret('');
      setNotice('Member added.');
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    }
  };

  const handleResetPin = async (memberId: string) => {
    setError('');
    setNotice('');
    try {
      await apiMutate(`/api/admin/members/${memberId}/reset-pin`, 'POST', {
        newPin: resetPinVal.trim(),
      });
      setResetTargetId(null);
      setResetPinVal('');
      setNotice('PIN reset. Member must choose a new PIN on next sign in.');
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN reset failed');
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-slate-900">Members & Admins</h1>

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

      <form onSubmit={handleAdd} className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
        <h2 className="text-2xl font-bold text-slate-900">Add New Member or Admin</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="m-name" className="block font-bold mb-1">
              Full Name
            </label>
            <input
              id="m-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="m-mobile" className="block font-bold mb-1">
              Mobile Number
            </label>
            <input
              id="m-mobile"
              required
              inputMode="numeric"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="m-role" className="block font-bold mb-1">
              Role
            </label>
            <select
              id="m-role"
              value={role}
              onChange={(e) => setRole(e.target.value as 'MEMBER' | 'ADMIN')}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg bg-white"
            >
              <option value="MEMBER">MEMBER</option>
              <option value="ADMIN">ADMIN</option>
            </select>
          </div>
          <div>
            <label htmlFor="m-secret" className="block font-bold mb-1">
              Initial PIN or Password
            </label>
            <input
              id="m-secret"
              type="password"
              required
              value={initialSecret}
              onChange={(e) => setInitialSecret(e.target.value)}
              className="w-full min-h-[48px] px-4 py-2 border-2 border-slate-700 rounded-lg"
              placeholder={role === 'MEMBER' ? '4 to 6 digits' : 'Min 12 characters'}
            />
          </div>
        </div>
        <button
          type="submit"
          className="min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg bg-blue-900 text-white font-bold text-lg hover:bg-blue-800"
        >
          Add Member
        </button>
      </form>

      <div className="space-y-3">
        {members.map((m) => (
          <div key={m.id} className="bg-white border-2 border-slate-400 rounded-xl p-5 flex flex-wrap justify-between items-center gap-4">
            <div>
              <div className="text-xl font-bold text-slate-900">{m.name}</div>
              <div className="text-lg text-slate-800">
                {m.mobile} | {m.role} | {m.status}
              </div>
            </div>
            {m.role === 'MEMBER' && (
              <div className="flex flex-wrap items-center gap-2">
                {resetTargetId === m.id ? (
                  <>
                    <input
                      aria-label={`Temporary PIN for ${m.name}`}
                      value={resetPinVal}
                      onChange={(e) => setResetPinVal(e.target.value)}
                      placeholder="New 4-6 digit PIN"
                      className="min-h-[48px] px-3 py-2 border-2 border-slate-700 rounded-lg"
                    />
                    <button
                      type="button"
                      onClick={() => handleResetPin(m.id)}
                      className="min-h-[48px] min-w-[48px] px-4 py-2 rounded-lg bg-emerald-800 text-white font-bold"
                    >
                      Save Reset PIN
                    </button>
                    <button
                      type="button"
                      onClick={() => setResetTargetId(null)}
                      className="min-h-[48px] min-w-[48px] px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setResetTargetId(m.id);
                      setResetPinVal('');
                    }}
                    className="min-h-[48px] min-w-[48px] px-4 py-2 rounded-lg border-2 border-slate-700 bg-white text-slate-900 font-semibold"
                  >
                    Reset PIN
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


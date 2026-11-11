'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiMutate } from '@/lib/client-api';
import { AppShell } from '@/components/AppShell';
import { useLanguage } from '@/components/LanguageProvider';

export default function MemberLoginPage() {
  const { dict } = useLanguage();
  const router = useRouter();
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [mustChangePin, setMustChangePin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiMutate<{ mustChangePin: boolean }>('/api/auth/member/login', 'POST', {
        mobile: mobile.trim(),
        pin: pin.trim(),
      });
      if (res.mustChangePin) {
        setMustChangePin(true);
      } else {
        router.push('/home');
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await apiMutate('/api/auth/member/change-pin', 'POST', {
        currentPin: pin.trim(),
        newPin: newPin.trim(),
      });
      router.push('/home');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update PIN');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-lg mx-auto bg-white border-2 border-slate-300 rounded-xl p-6 shadow-sm">
        {!mustChangePin ? (
          <>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">{dict.memberLoginTitle}</h1>
            <p className="text-lg text-slate-700 mb-6">{dict.memberLoginSubtitle}</p>

            {error && (
              <div
                role="alert"
                className="mb-4 rounded-lg border-2 border-red-800 bg-red-50 p-4 text-lg font-semibold text-red-900"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label htmlFor="member-mobile" className="block text-lg font-bold text-slate-900 mb-1">
                  {dict.mobileLabel}
                </label>
                <input
                  id="member-mobile"
                  name="mobile"
                  type="tel"
                  inputMode="numeric"
                  required
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  className="w-full min-h-[48px] px-4 py-3 text-lg rounded-lg border-2 border-slate-700 bg-white text-slate-900"
                  placeholder="10-digit mobile number"
                />
              </div>

              <div>
                <label htmlFor="member-pin" className="block text-lg font-bold text-slate-900 mb-1">
                  {dict.pinLabel}
                </label>
                <input
                  id="member-pin"
                  name="pin"
                  type="password"
                  inputMode="numeric"
                  required
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="w-full min-h-[48px] px-4 py-3 text-lg rounded-lg border-2 border-slate-700 bg-white text-slate-900"
                  placeholder="4 to 6 digit PIN"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg bg-blue-900 text-white font-bold text-xl hover:bg-blue-800"
              >
                {submitting ? dict.loading : dict.signIn}
              </button>
            </form>

            <div className="mt-6 pt-5 border-t border-slate-200">
              <Link
                href="/admin/login"
                className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 text-slate-900 font-semibold text-lg hover:bg-slate-100"
              >
                {dict.adminLoginLink}
              </Link>
            </div>
          </>
        ) : (
          <>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">{dict.changePinTitle}</h1>
            <p className="text-lg text-slate-700 mb-6">{dict.changePinSubtitle}</p>

            {error && (
              <div
                role="alert"
                className="mb-4 rounded-lg border-2 border-red-800 bg-red-50 p-4 text-lg font-semibold text-red-900"
              >
                {error}
              </div>
            )}

            <form onSubmit={handleChangePin} className="space-y-5">
              <div>
                <label htmlFor="new-pin" className="block text-lg font-bold text-slate-900 mb-1">
                  {dict.newPinLabel}
                </label>
                <input
                  id="new-pin"
                  name="newPin"
                  type="password"
                  inputMode="numeric"
                  required
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value)}
                  className="w-full min-h-[48px] px-4 py-3 text-lg rounded-lg border-2 border-slate-700 bg-white text-slate-900"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg bg-emerald-800 text-white font-bold text-xl hover:bg-emerald-900"
              >
                {submitting ? dict.loading : dict.saveNewPin}
              </button>
            </form>
          </>
        )}
      </div>
    </AppShell>
  );
}


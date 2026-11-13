'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiMutate } from '@/lib/client-api';
import { AppShell } from '@/components/AppShell';
import { useLanguage } from '@/components/LanguageProvider';

export default function AdminLoginPage() {
  const { dict } = useLanguage();
  const router = useRouter();
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    document.title = 'Admin Sign In | Samiti';
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await apiMutate<{ requiresTotpSetup: boolean }>('/api/auth/admin/login', 'POST', {
        mobile: mobile.trim(),
        password,
        totpCode: totpCode.trim() || undefined,
        recoveryCode: recoveryCode.trim() || undefined,
      });
      if (res.requiresTotpSetup) {
        router.push('/admin/setup-totp');
      } else {
        router.push('/admin');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-lg mx-auto bg-white border-2 border-slate-300 rounded-xl p-6 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">{dict.adminLoginTitle}</h1>
        <p className="text-lg text-slate-700 mb-6">{dict.adminLoginSubtitle}</p>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border-2 border-red-800 bg-red-50 p-4 text-lg font-semibold text-red-900"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="admin-mobile" className="block text-lg font-bold text-slate-900 mb-1">
              {dict.mobileLabel}
            </label>
            <input
              id="admin-mobile"
              name="mobile"
              type="tel"
              inputMode="numeric"
              required
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="w-full min-h-[48px] px-4 py-3 text-lg rounded-lg border-2 border-slate-700 bg-white text-slate-900"
            />
          </div>

          <div>
            <label htmlFor="admin-password" className="block text-lg font-bold text-slate-900 mb-1">
              {dict.passwordLabel}
            </label>
            <input
              id="admin-password"
              name="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full min-h-[48px] px-4 py-3 text-lg rounded-lg border-2 border-slate-700 bg-white text-slate-900"
            />
          </div>

          <div>
            <label htmlFor="admin-totp" className="block text-lg font-bold text-slate-900 mb-1">
              {dict.totpCodeLabel}
            </label>
            <input
              id="admin-totp"
              name="totpCode"
              type="text"
              inputMode="numeric"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              className="w-full min-h-[48px] px-4 py-3 text-lg rounded-lg border-2 border-slate-700 bg-white text-slate-900"
              placeholder="6-digit code"
            />
          </div>

          <div>
            <label htmlFor="admin-recovery" className="block text-lg font-bold text-slate-900 mb-1">
              {dict.recoveryCodeLabel}
            </label>
            <input
              id="admin-recovery"
              name="recoveryCode"
              type="text"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              className="w-full min-h-[48px] px-4 py-3 text-lg rounded-lg border-2 border-slate-700 bg-white text-slate-900"
              placeholder="XXXXX-XXXXX"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg bg-blue-900 text-white font-bold text-xl hover:bg-blue-800"
          >
            {submitting ? dict.loading : dict.adminSignIn}
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-200">
          <Link
            href="/login"
            className="min-h-[48px] min-w-[48px] inline-flex items-center px-4 py-2 rounded-lg border-2 border-slate-700 text-slate-900 font-semibold text-lg hover:bg-slate-100"
          >
            {dict.memberLoginLink}
          </Link>
        </div>
      </div>
    </AppShell>
  );
}


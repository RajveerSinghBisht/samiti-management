'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiMutate } from '@/lib/client-api';
import { AppShell } from '@/components/AppShell';

export default function AdminTotpSetupPage() {
  const [manualSecret, setManualSecret] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Setup Two-Factor Authenticator | Samiti';
    let active = true;
    (async () => {
      try {
        const res = await apiMutate<{
          manualSecret: string;
          qrDataUrl: string;
        }>('/api/auth/admin/totp/setup', 'POST', {});
        if (active) {
          setManualSecret(res.manualSecret);
          setQrDataUrl(res.qrDataUrl);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to initialize authenticator setup');
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await apiMutate<{ recoveryCodes: string[] }>(
        '/api/auth/admin/totp/verify',
        'POST',
        { code: code.trim() }
      );
      setRecoveryCodes(res.recoveryCodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  return (
    <AppShell user={{ name: 'Admin', role: 'ADMIN', totpVerified: Boolean(recoveryCodes) }}>
      <div className="max-w-xl mx-auto bg-white border-2 border-slate-300 rounded-xl p-6 shadow-sm">
        <h1 className="text-3xl font-bold text-slate-900 mb-3">
          Set Up Authenticator App (Mandatory)
        </h1>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border-2 border-red-800 bg-red-50 p-4 text-lg font-semibold text-red-900"
          >
            {error}
          </div>
        )}

        {loading && <p className="text-lg text-slate-700">Preparing your authenticator key...</p>}

        {!loading && !recoveryCodes && manualSecret && (
          <div className="space-y-5">
            <p className="text-lg text-slate-800">
              Scan this QR code in Google Authenticator or enter the key manually:
            </p>
            {qrDataUrl && (
              <div className="bg-white p-3 border-2 border-slate-300 inline-block rounded-lg">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qrDataUrl} alt="Authenticator setup QR code" width={220} height={220} />
              </div>
            )}
            <div className="p-4 bg-slate-100 border-2 border-slate-400 rounded-lg">
              <div className="text-lg font-bold text-slate-900 mb-1">Manual Setup Key</div>
              <code
                data-testid="totp-manual-secret"
                className="text-xl font-mono font-bold tracking-wider text-slate-900 break-all"
              >
                {manualSecret}
              </code>
            </div>

            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label htmlFor="totp-verify-code" className="block text-lg font-bold text-slate-900 mb-1">
                  Enter 6-digit code from your authenticator app
                </label>
                <input
                  id="totp-verify-code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full min-h-[48px] px-4 py-3 text-lg rounded-lg border-2 border-slate-700 bg-white text-slate-900"
                />
              </div>
              <button
                type="submit"
                className="w-full min-h-[48px] min-w-[48px] px-6 py-3 rounded-lg bg-emerald-800 text-white font-bold text-xl hover:bg-emerald-900"
              >
                Verify and Enable Authenticator
              </button>
            </form>
          </div>
        )}

        {recoveryCodes && (
          <div className="space-y-5">
            <div className="p-4 bg-amber-50 border-2 border-amber-700 rounded-lg">
              <h2 className="text-2xl font-bold text-slate-900 mb-2">
                Save Your Single-Use Recovery Codes
              </h2>
              <p className="text-lg text-slate-800 mb-3">
                Write these down safely. Each code works once if you lose your phone.
              </p>
              <ul
                data-testid="recovery-codes"
                className="grid grid-cols-2 gap-2 font-mono text-lg font-bold text-slate-900"
              >
                {recoveryCodes.map((rc) => (
                  <li key={rc} className="bg-white border border-slate-400 rounded px-3 py-2">
                    {rc}
                  </li>
                ))}
              </ul>
            </div>
            <Link
              href="/admin"
              className="w-full min-h-[48px] min-w-[48px] inline-flex items-center justify-center px-6 py-3 rounded-lg bg-blue-900 text-white font-bold text-xl hover:bg-blue-800"
            >
              Continue to Admin Dashboard
            </Link>
          </div>
        )}
      </div>
    </AppShell>
  );
}


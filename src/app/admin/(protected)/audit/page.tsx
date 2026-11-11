import React from 'react';
import { listAuditEvents } from '@/lib/services/audit';

export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
  const events = await listAuditEvents(200);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-slate-900">Audit Log</h1>
      <div className="space-y-3">
        {events.map((ev) => (
          <div key={ev.id} className="bg-white border-2 border-slate-300 rounded-xl p-4">
            <div className="text-xl font-bold text-slate-900">{ev.action}</div>
            <div className="text-lg text-slate-800">
              Role: {ev.actorRole} | Target: {ev.targetType}
              {ev.targetId ? ` (${ev.targetId})` : ''} | {ev.createdAt.toISOString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


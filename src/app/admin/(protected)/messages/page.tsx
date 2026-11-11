import React from 'react';
import { listMessageLogs } from '@/lib/services/messaging';
import { formatPaiseToInr } from '@/lib/money';
import { formatDisplayDate } from '@/lib/dates';

export const dynamic = 'force-dynamic';

export default async function AdminMessagesPage() {
  const messages = await listMessageLogs();

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-slate-900">Weekly Loan Reminder Messages</h1>
      <p className="text-lg text-slate-800">
        Prepared weekly by the cron job for members with active loans. Use the WhatsApp link to send directly.
      </p>

      {messages.length === 0 ? (
        <div className="bg-white border-2 border-slate-300 rounded-xl p-6 text-xl">
          No reminder messages generated yet.
        </div>
      ) : (
        <div className="space-y-4">
          {messages.map((msg) => (
            <div key={msg.id} className="bg-white border-2 border-slate-400 rounded-xl p-5 space-y-3">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <div className="text-xl font-bold text-slate-900">
                  {msg.memberName} ({msg.recipientMobile}) — Week {msg.weekKey}
                </div>
                <span className="px-3 py-1 rounded bg-blue-100 text-blue-950 font-bold">
                  {msg.status} ({msg.channelMode})
                </span>
              </div>
              <div className="text-lg text-slate-800">
                Owed: {formatPaiseToInr(msg.amountOwedPaise)} | Paid Last Week:{' '}
                {formatPaiseToInr(msg.paidLastWeekPaise)} | Next Due:{' '}
                {formatDisplayDate(msg.nextDueDate)}
              </div>
              <pre className="whitespace-pre-wrap bg-slate-100 p-3 rounded-lg border border-slate-300 text-lg">
                {msg.messageText}
              </pre>
              <a
                href={msg.clickToChatUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[48px] min-w-[48px] inline-flex items-center px-5 py-3 rounded-lg bg-emerald-800 text-white font-bold text-lg hover:bg-emerald-900"
              >
                Open WhatsApp Chat
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


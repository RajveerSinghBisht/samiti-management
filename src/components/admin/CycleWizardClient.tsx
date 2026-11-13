'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiMutate } from '@/lib/client-api';
import { toIstDateString, parseIstDateParts } from '@/lib/dates';
import { formatPaiseToInr, parseStrictIntegerRupeesToPaise } from '@/lib/money';

interface AdminSummary {
  id: string;
  name: string;
  mobile: string;
}

interface MemberSummary {
  id: string;
  name: string;
  mobile: string;
}

interface MemberInput {
  name: string;
  mobile: string;
  isReturning: boolean;
}

export function CycleWizardClient({
  admins,
  existingMembers,
  hasExistingCycles,
}: {
  admins: AdminSummary[];
  existingMembers: MemberSummary[];
  hasExistingCycles: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: Basics
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(toIstDateString());
  // Default end date is 1 year from start date (or around Diwali)
  const [endDate, setEndDate] = useState(() => {
    const [y, m, d] = toIstDateString().split('-').map(Number);
    return `${(y ?? 2026) + 1}-${String(m ?? 1).padStart(2, '0')}-${String(d ?? 1).padStart(2, '0')}`;
  });
  const [meetingDay, setMeetingDay] = useState(10);

  // Step 2: Members
  const [membersList, setMembersList] = useState<MemberInput[]>([]);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberMobile, setNewMemberMobile] = useState('');

  // Step 3: Financials
  const [monthlyRupees, setMonthlyRupees] = useState('1000');
  const [ratePercent, setRatePercent] = useState('1');
  const [interestSharingMode, setInterestSharingMode] = useState<'EQUAL' | 'PROPORTIONAL_CONTRIBUTION'>('EQUAL');
  const [rotationPayoutEnabled, setRotationPayoutEnabled] = useState(false);

  // Step 4: Caps & Carry Over
  const [normalCapRupees, setNormalCapRupees] = useState('50000');
  const [emergencyCapRupees, setEmergencyCapRupees] = useState('100000');
  const [carryOverPreviousLoans, setCarryOverPreviousLoans] = useState(false);
  const [selectedAdminIds, setSelectedAdminIds] = useState<string[]>(
    admins.length >= 2 ? [admins[0]!.id, admins[1]!.id] : admins.map((a) => a.id)
  );

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [createdSummary, setCreatedSummary] = useState<string | null>(null);

  // Compute duration
  const startParts = parseIstDateParts(startDate);
  const endParts = parseIstDateParts(endDate);
  const diffMonths = Math.max(1, (endParts.year - startParts.year) * 12 + (endParts.month - startParts.month));
  const diffYears = (diffMonths / 12).toFixed(1);

  const handleCarryOverAll = () => {
    const carried: MemberInput[] = existingMembers.map((m) => ({
      name: m.name,
      mobile: m.mobile,
      isReturning: true,
    }));
    setMembersList(carried);
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const trimmedName = newMemberName.trim();
    const trimmedMobile = newMemberMobile.replace(/^\+91/, '').replace(/^0/, '').replace(/\D/g, '');
    if (trimmedName.length < 2) {
      setError('Member name must have at least 2 characters');
      return;
    }
    if (!/^\d{10}$/.test(trimmedMobile)) {
      setError('Mobile number must be exactly 10 digits');
      return;
    }
    if (membersList.some((m) => m.mobile === trimmedMobile)) {
      setError('A member with this mobile number is already in the list');
      return;
    }
    setMembersList([...membersList, { name: trimmedName, mobile: trimmedMobile, isReturning: false }]);
    setNewMemberName('');
    setNewMemberMobile('');
  };

  const handleRemoveMember = (mobile: string) => {
    setMembersList(membersList.filter((m) => m.mobile !== mobile));
  };

  const validateCurrentStep = async (nextStep: 2 | 3 | 4 | 5) => {
    setError('');
    try {
      if (step === 1) {
        if (!name.trim()) throw new Error('Cycle name is required');
        await apiMutate('/api/admin/cycle-wizard/validate-step', 'POST', {
          step: 'basics',
          data: { name: name.trim(), startDate, endDate, meetingDayOfMonth: meetingDay },
        });
      } else if (step === 2) {
        if (membersList.length < 2) throw new Error('At least two members are required');
        await apiMutate('/api/admin/cycle-wizard/validate-step', 'POST', {
          step: 'members',
          data: { members: membersList },
        });
      } else if (step === 3) {
        const monthlyPaise = parseStrictIntegerRupeesToPaise(monthlyRupees);
        const rateBps = Math.round(Number(ratePercent) * 100);
        await apiMutate('/api/admin/cycle-wizard/validate-step', 'POST', {
          step: 'financials',
          data: {
            monthlyContributionPaise: monthlyPaise,
            interestRateBps: rateBps,
            interestSharingMode,
            rotationPayoutEnabled,
          },
        });
      } else if (step === 4) {
        const normalCapPaise = parseStrictIntegerRupeesToPaise(normalCapRupees);
        const emergencyCapPaise = parseStrictIntegerRupeesToPaise(emergencyCapRupees);
        if (selectedAdminIds.length < 2) {
          throw new Error('At least two admins must be designated for this cycle');
        }
        await apiMutate('/api/admin/cycle-wizard/validate-step', 'POST', {
          step: 'caps',
          data: {
            normalLoanCapPaise: normalCapPaise,
            emergencyLoanCapPaise: emergencyCapPaise,
            carryOverPreviousLoans,
            adminIds: selectedAdminIds,
          },
        });
      }
      setStep(nextStep);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed for this step');
    }
  };

  const handleSubmitCycle = async () => {
    setError('');
    setIsSubmitting(true);
    try {
      const monthlyPaise = parseStrictIntegerRupeesToPaise(monthlyRupees);
      const rateBps = Math.round(Number(ratePercent) * 100);
      const normalCapPaise = parseStrictIntegerRupeesToPaise(normalCapRupees);
      const emergencyCapPaise = parseStrictIntegerRupeesToPaise(emergencyCapRupees);

      const res = await apiMutate('/api/admin/cycle-wizard', 'POST', {
        name: name.trim(),
        startDate,
        endDate,
        meetingDayOfMonth: meetingDay,
        monthlyContributionPaise: monthlyPaise,
        interestRateBps: rateBps,
        normalLoanCapPaise: normalCapPaise,
        emergencyLoanCapPaise: emergencyCapPaise,
        interestSharingMode,
        rotationPayoutEnabled,
        adminIds: selectedAdminIds,
        members: membersList,
      });

      setCreatedSummary(
        (res as { summary?: string }).summary ||
          `New cycle "${name}" created. A second admin approval is required in the Approvals Queue before it becomes active.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create new cycle');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (createdSummary) {
    return (
      <div className="bg-white border-2 border-emerald-600 rounded-xl p-6 space-y-4">
        <h1 className="text-3xl font-bold text-emerald-800">New Cycle Created</h1>
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-lg text-lg text-emerald-900">
          {createdSummary}
        </div>
        <p className="text-lg text-slate-700">
          The cycle is currently in <strong>PENDING_SECOND_ADMIN_APPROVAL</strong> status. A second admin must log in and approve it in the Approvals Queue to activate it.
        </p>
        <div className="flex gap-4 pt-4">
          <button
            type="button"
            onClick={() => router.push('/admin/approvals')}
            className="min-h-[48px] px-6 py-3 bg-blue-900 text-white text-lg font-bold rounded-lg hover:bg-blue-800"
          >
            Go to Approvals Queue
          </button>
          <button
            type="button"
            onClick={() => router.push('/admin/cycle')}
            className="min-h-[48px] px-6 py-3 bg-slate-200 text-slate-900 text-lg font-bold rounded-lg hover:bg-slate-300"
          >
            View Cycles
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b pb-4">
        <h1 className="text-3xl font-bold text-slate-900">New Cycle Guided Wizard</h1>
        <p className="text-lg text-slate-700 mt-1">
          Step {step} of 5:{' '}
          {step === 1
            ? 'Basics & Dates'
            : step === 2
            ? 'Members'
            : step === 3
            ? 'Financial Rules'
            : step === 4
            ? 'Loan Caps & Admins'
            : 'Review & Confirm'}
        </p>
      </div>

      {error && (
        <div role="alert" className="p-4 bg-red-100 border-2 border-red-400 rounded-lg text-red-900 text-lg font-semibold">
          {error}
        </div>
      )}

      {/* Progress Bar */}
      <div className="flex gap-2">
        {[1, 2, 3, 4, 5].map((s) => (
          <div
            key={s}
            className={`flex-1 h-3 rounded ${
              s <= step ? 'bg-blue-900' : 'bg-slate-200'
            }`}
          />
        ))}
      </div>

      {/* STEP 1: BASICS */}
      {step === 1 && (
        <div className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Step 1: Cycle Basics & Dates</h2>

          <div>
            <label htmlFor="wizard-cycle-name" className="block text-lg font-bold text-slate-800 mb-1">
              Cycle Name
            </label>
            <input
              id="wizard-cycle-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Samiti Cycle 2026-2027"
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="wizard-start-date" className="block text-lg font-bold text-slate-800 mb-1">
                Start Date (IST)
              </label>
              <input
                id="wizard-start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="wizard-end-date" className="block text-lg font-bold text-slate-800 mb-1">
                End Date (Editable, ends around Diwali)
              </label>
              <input
                id="wizard-end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
              />
            </div>
          </div>

          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-slate-800">
            <strong>Calculated Cycle Duration:</strong> {diffMonths} months ({diffYears} years)
          </div>

          <div>
            <label htmlFor="wizard-meeting-day" className="block text-lg font-bold text-slate-800 mb-1">
              Monthly Meeting Day (1-28)
            </label>
            <input
              id="wizard-meeting-day"
              type="number"
              min={1}
              max={28}
              value={meetingDay}
              onChange={(e) => setMeetingDay(Number(e.target.value))}
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
            />
          </div>

          <div className="flex justify-end pt-4">
            <button
              type="button"
              onClick={() => validateCurrentStep(2)}
              className="min-h-[48px] px-6 py-3 bg-blue-900 text-white text-lg font-bold rounded-lg hover:bg-blue-800"
            >
              Next: Members →
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: MEMBERS */}
      {step === 2 && (
        <div className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <h2 className="text-2xl font-bold text-slate-900">Step 2: Members ({membersList.length})</h2>
            {existingMembers.length > 0 && (
              <button
                type="button"
                onClick={handleCarryOverAll}
                className="min-h-[48px] px-4 py-2 border-2 border-blue-900 bg-blue-50 text-blue-900 font-bold rounded-lg hover:bg-blue-100"
              >
                Carry Over Returning Members ({existingMembers.length})
              </button>
            )}
          </div>

          <form onSubmit={handleAddMember} className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-4 bg-slate-50 border rounded-lg">
            <div>
              <label htmlFor="new-mem-name" className="block text-sm font-bold text-slate-700">Member Name</label>
              <input
                id="new-mem-name"
                type="text"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                placeholder="Full Name"
                className="w-full p-2 border rounded"
              />
            </div>
            <div>
              <label htmlFor="new-mem-mob" className="block text-sm font-bold text-slate-700">Mobile Number</label>
              <div className="flex rounded border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-blue-600">
                <span className="inline-flex items-center px-2 bg-slate-100 text-slate-800 text-sm font-bold border-r border-slate-300 select-none">
                  🇮🇳 +91
                </span>
                <input
                  id="new-mem-mob"
                  type="tel"
                  value={newMemberMobile}
                  onChange={(e) => setNewMemberMobile(e.target.value)}
                  placeholder="9876543210"
                  className="w-full p-2 focus:outline-none"
                />
              </div>
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="min-h-[44px] w-full bg-slate-800 text-white font-bold rounded hover:bg-slate-900"
              >
                + Add Member
              </button>
            </div>
          </form>

          <div className="max-h-80 overflow-y-auto divide-y border rounded-lg">
            {membersList.length === 0 ? (
              <p className="p-4 text-slate-600">No members added yet. Add members individually or carry over returning members.</p>
            ) : (
              membersList.map((m) => (
                <div key={m.mobile} className="p-3 flex justify-between items-center">
                  <div>
                    <span className="font-bold text-lg text-slate-900">{m.name}</span>
                    <span className="ml-3 text-slate-600 font-mono text-sm">{m.mobile}</span>
                    {m.isReturning && (
                      <span className="ml-2 px-2 py-0.5 bg-emerald-100 text-emerald-800 text-xs font-bold rounded">
                        Returning
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(m.mobile)}
                    className="text-red-700 hover:text-red-900 font-bold px-2 py-1"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="flex justify-between pt-4">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-[48px] px-6 py-3 bg-slate-200 text-slate-800 text-lg font-bold rounded-lg"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => validateCurrentStep(3)}
              className="min-h-[48px] px-6 py-3 bg-blue-900 text-white text-lg font-bold rounded-lg hover:bg-blue-800"
            >
              Next: Financial Rules →
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: FINANCIALS */}
      {step === 3 && (
        <div className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Step 3: Financial Rules</h2>

          <div>
            <label htmlFor="wizard-monthly-contrib" className="block text-lg font-bold text-slate-800 mb-1">
              Fixed Monthly Contribution per Member (Rupees)
            </label>
            <input
              id="wizard-monthly-contrib"
              type="number"
              min={1}
              value={monthlyRupees}
              onChange={(e) => setMonthlyRupees(e.target.value)}
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
            />
          </div>

          <div>
            <label htmlFor="wizard-rate-percent" className="block text-lg font-bold text-slate-800 mb-1">
              Default Loan Interest Rate (% per month)
            </label>
            <input
              id="wizard-rate-percent"
              type="number"
              step="0.1"
              min={0}
              max={50}
              value={ratePercent}
              onChange={(e) => setRatePercent(e.target.value)}
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
            />
            <p className="text-sm text-slate-600 mt-1">Authoritative rule default is 1% per month.</p>
          </div>

          <div>
            <label htmlFor="wizard-share-mode" className="block text-lg font-bold text-slate-800 mb-1">
              Interest Sharing Mode at Settlement
            </label>
            <select
              id="wizard-share-mode"
              value={interestSharingMode}
              onChange={(e) => setInterestSharingMode(e.target.value as 'EQUAL' | 'PROPORTIONAL_CONTRIBUTION')}
              className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
            >
              <option value="EQUAL">Equal Share across all members (Authoritative Samiti Rule)</option>
              <option value="PROPORTIONAL_CONTRIBUTION">Proportional to Contributions Paid</option>
            </select>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              id="wizard-rotation-payout"
              type="checkbox"
              checked={rotationPayoutEnabled}
              onChange={(e) => setRotationPayoutEnabled(e.target.checked)}
              className="w-6 h-6 rounded"
            />
            <label htmlFor="wizard-rotation-payout" className="text-lg font-bold text-slate-800">
              Enable Monthly Rotation Payout (Off by default)
            </label>
          </div>

          <div className="flex justify-between pt-4">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="min-h-[48px] px-6 py-3 bg-slate-200 text-slate-800 text-lg font-bold rounded-lg"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => validateCurrentStep(4)}
              className="min-h-[48px] px-6 py-3 bg-blue-900 text-white text-lg font-bold rounded-lg hover:bg-blue-800"
            >
              Next: Caps & Admins →
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: CAPS & ADMINS */}
      {step === 4 && (
        <div className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Step 4: Loan Caps & Admin Designations</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="wizard-normal-cap" className="block text-lg font-bold text-slate-800 mb-1">
                Normal Loan Cap (Rupees)
              </label>
              <input
                id="wizard-normal-cap"
                type="number"
                min={1}
                value={normalCapRupees}
                onChange={(e) => setNormalCapRupees(e.target.value)}
                className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="wizard-emergency-cap" className="block text-lg font-bold text-slate-800 mb-1">
                Emergency Loan Cap (Rupees)
              </label>
              <input
                id="wizard-emergency-cap"
                type="number"
                min={1}
                value={emergencyCapRupees}
                onChange={(e) => setEmergencyCapRupees(e.target.value)}
                className="w-full text-lg p-3 border-2 border-slate-400 rounded-lg"
              />
            </div>
          </div>

          {hasExistingCycles && (
            <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg">
              <div className="flex items-center gap-3">
                <input
                  id="wizard-carry-loans"
                  type="checkbox"
                  checked={carryOverPreviousLoans}
                  onChange={(e) => setCarryOverPreviousLoans(e.target.checked)}
                  className="w-6 h-6 rounded"
                />
                <label htmlFor="wizard-carry-loans" className="text-lg font-bold text-amber-900">
                  Carry Over Previous Cycle Open Loans (Requires explicit two-admin sign-off)
                </label>
              </div>
              <p className="text-sm text-amber-800 mt-1 ml-9">
                A new cycle cannot start while the previous one has open loans unless both admins explicitly approve a carry-over.
              </p>
            </div>
          )}

          <div>
            <label className="block text-lg font-bold text-slate-800 mb-2">
              Select Cycle Admins (At least 2 required)
            </label>
            <div className="space-y-2">
              {admins.map((a) => (
                <label key={a.id} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={selectedAdminIds.includes(a.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedAdminIds([...selectedAdminIds, a.id]);
                      } else {
                        setSelectedAdminIds(selectedAdminIds.filter((id) => id !== a.id));
                      }
                    }}
                    className="w-5 h-5 rounded"
                  />
                  <div>
                    <span className="font-bold text-slate-900">{a.name}</span>
                    <span className="ml-2 text-slate-600 font-mono text-sm">{a.mobile}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="min-h-[48px] px-6 py-3 bg-slate-200 text-slate-800 text-lg font-bold rounded-lg"
            >
              ← Back
            </button>
            <button
              type="button"
              onClick={() => validateCurrentStep(5)}
              className="min-h-[48px] px-6 py-3 bg-blue-900 text-white text-lg font-bold rounded-lg hover:bg-blue-800"
            >
              Next: Review & Confirm →
            </button>
          </div>
        </div>
      )}

      {/* STEP 5: REVIEW & SUBMIT */}
      {step === 5 && (
        <div className="bg-white border-2 border-slate-300 rounded-xl p-6 space-y-4">
          <h2 className="text-2xl font-bold text-slate-900">Step 5: Review & Confirm</h2>

          <div className="p-4 bg-slate-100 rounded-lg space-y-2 text-lg text-slate-800">
            <p>
              <strong>Cycle Name:</strong> {name}
            </p>
            <p>
              <strong>Timeline:</strong> {startDate} to {endDate} ({diffMonths} months, ends around Diwali)
            </p>
            <p>
              <strong>Members:</strong> {membersList.length} members enrolled
            </p>
            <p>
              <strong>Monthly Contribution:</strong> {formatPaiseToInr(parseStrictIntegerRupeesToPaise(monthlyRupees))} per member
            </p>
            <p>
              <strong>Loan Rate:</strong> {ratePercent}% per month on balance
            </p>
            <p>
              <strong>Caps:</strong> Normal Cap {formatPaiseToInr(parseStrictIntegerRupeesToPaise(normalCapRupees))}, Emergency Cap {formatPaiseToInr(parseStrictIntegerRupeesToPaise(emergencyCapRupees))}
            </p>
            <p>
              <strong>Settlement Rule:</strong> {interestSharingMode === 'EQUAL' ? 'Equal Share' : 'Proportional to Contributions'}
            </p>
            <p>
              <strong>Rotation Payout:</strong> {rotationPayoutEnabled ? 'Enabled' : 'Disabled'}
            </p>
            <p>
              <strong>Admins Designated:</strong> {selectedAdminIds.length} admins
            </p>
          </div>

          <div className="p-4 bg-amber-50 border border-amber-300 rounded-lg text-amber-900">
            <strong>Important:</strong> Submitting will record this cycle in <em>PENDING_SECOND_ADMIN_APPROVAL</em> status. It will not be active until a second administrator reviews and approves it in the Approvals Queue. There is no cycle deletion anywhere in the system.
          </div>

          <div className="flex justify-between pt-4">
            <button
              type="button"
              onClick={() => setStep(4)}
              className="min-h-[48px] px-6 py-3 bg-slate-200 text-slate-800 text-lg font-bold rounded-lg"
            >
              ← Back
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSubmitCycle}
              className="min-h-[48px] px-8 py-3 bg-emerald-700 text-white text-xl font-bold rounded-lg hover:bg-emerald-800 disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Cycle for Approval'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


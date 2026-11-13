# Authoritative Samiti Calculation & Accounting Rules

This document specifies every monetary, rounding, ledger, interest, sharing, meeting, loan, settlement, and Good Cause rule for the Samiti Management System. These rules are authoritative and govern all calculations, validations, and tests across the system.

---

## 1. Currency, Precision, and Rounding

1. **Integer Paise Representation**: All monetary amounts are stored and computed strictly as safe integers in **paise** (`1 Rupee = 100 paise`). Floating-point numbers are never used for money storage or arithmetic.
2. **Round Half Up Per Entry**: Whenever an exact ratio `numerator / denominator` (with `numerator >= 0`, `denominator > 0`) must be rounded to integer paise, the system uses **round half up**:
   $$\text{roundHalfUp}(n, d) = \left\lfloor \frac{2n + d}{2d} \right\rfloor$$
   computed using exact `BigInt` integer arithmetic to prevent intermediate precision loss or overflow.
   - Example: `0.5` paise rounds to `1` paisa; `0.49` paise rounds to `0` paise; `15638.7` paise rounds to `15639` paise.
3. **Largest Remainder Method (Hamilton's Method)** for Pool Distribution:
   When splitting a total integer amount $T$ across members with non-negative weights $w_1, \dots, w_k$ ($W = \sum w_i > 0$):
   - Base share: $b_i = \lfloor (T \cdot w_i) / W \rfloor$
   - Remainder numerator: $r_i = (T \cdot w_i) \bmod W$
   - Leftover paise: $L = T - \sum b_i$ (always $0 \le L < k$)
   - Sort members by $r_i$ descending, breaking ties deterministically by `memberId` ascending (lexicographical `'en'`).
   - Award $+1$ paisa to the first $L$ members.
   - Guarantee: $\sum \text{share}_i = T$ identically to the last paisa.

---

## 2. Monthly Physical Meetings & Day Ordering

1. **Time Organised by Monthly Meetings**: Financial activity is organised by monthly physical meetings. Every ledger entry, contribution, loan disbursement, repayment, bank interest, or grant is recorded against an explicit **meeting date** (in Asia/Kolkata IST, `YYYY-MM-DD`).
2. **Within-Day Order Independence**: Every calculation groups or sorts ledger entries deterministically by `(effectiveDate ASC, canonicalEntryTypeOrder ASC, id ASC)` and computes end-of-day principal balances per meeting/IST date. The physical insertion order of multiple entries recorded at the same meeting never alters any resulting balance.

---

## 3. Append-Only Ledger & Reversals

1. Every `ledger_entries` row has a strictly positive `amount_paise > 0`.
2. Database triggers and revoked privileges forbid `UPDATE`, `DELETE`, and `TRUNCATE` on `ledger_entries` and `audit_events`.
3. Mistakes are corrected exclusively by appending a `REVERSAL` entry referencing `reverses_entry_id` (enforced unique in the database so an entry cannot be reversed twice) plus a new corrected entry if needed, each with reason, acting admin, and timestamp.
4. Reversing a `REVERSAL` entry is strictly forbidden.
5. Replaying the ledger excludes any `REVERSAL` row and the exact entry referenced by `reverses_entry_id`, guaranteeing that reversing an entry restores the exact prior state.

---

## 4. Authoritative Contribution Rules

1. **Fixed Contribution**: A fixed monthly contribution per member is established for the cycle (e.g. Rs 1,000 per member per meeting).
2. **Unpaid Contributions**: If unpaid at a meeting, the amount remains pending.
3. **No Penalty, No Interest on Contributions**: Unpaid contributions carry **no penalty** and **no interest**.
4. **Visibility & Deduction**: Pending contributions are visible to admins on the monthly dashboard and deducted at final settlement.

---

## 5. Authoritative Loan, Interest & Repayment Rules

1. **Disbursement at a Meeting**: Loans are disbursed at a physical meeting.
2. **No Interest for Disbursement Meeting**: Per Rule 3, no interest is due for the meeting at which a loan is disbursed. Interest accrual begins at the next monthly meeting.
3. **Monthly Interest Formula**:
   Per Rule 4, interest due at meeting $N$ for a loan equals:
   $$\text{interestDuePaise} = \text{roundHalfUp}(\text{principalOutstanding}_{N-1} \cdot \text{interestRateBps}, 10000)$$
   where:
   - $\text{principalOutstanding}_{N-1}$ is the principal outstanding at the close of meeting $N-1$, before any repayment at meeting $N$.
   - $\text{interestRateBps}$ is the monthly interest rate in basis points (default $1\% = 100\text{ bps}$).
   - Rounded half up to paise.
   - **No proration, no compounding.**
4. **Separate Payments, Never Auto-Allocated**:
   Per Rule 5, payments are two separate entries, never automatically split or allocated:
   - `REPAYMENT_INTEREST`: Interest paid by the borrower.
   - `REPAYMENT_PRINCIPAL`: Principal repaid by the borrower.
   - The UI screen pre-fills the interest due.
   - **Interest is mandatory**. If less than the interest due is paid, the unpaid remainder carries forward as "interest due" (with **no interest on interest**), is shown prominently to admins, and is deducted at settlement.
   - **Principal repayment is optional**: any amount, at any meeting, up to the outstanding principal. It cannot exceed outstanding principal.
5. **Borrowing Again & Caps**:
   Per Rule 6, a member may borrow again after repaying (or while having an active loan within caps).
   - **Normal Loan Cap** (admin cycle setting): Total outstanding principal per member cannot exceed this cap without emergency approval.
   - **Emergency Loan Cap** (admin cycle setting): Total outstanding principal per member above the normal cap requires an explicit "emergency" flag, a written reason, and mandatory approval by a second, different admin.
   - Borrowing above the emergency loan cap is completely blocked.
6. **Pool Available to Lend**:
   Per Rule 7:
   $$\text{Pool Available} = \text{Contributions Collected} + \text{Interest Collected} + \text{Bank Interest} + \text{Principal Repaid} - \text{Principal Lent} - \text{Good Cause Grants}$$
   - If a requested loan exceeds the pool available to lend, the system issues a prominent warning and requires explicit confirmation and approval from a second admin.

---

## 6. Bank Interest & Good Cause Grants

1. **Bank Interest**: Entered manually by an admin as a ledger entry (`BANK_INTEREST`). It increases cash and forms part of the group interest pool.
2. **Give for a Good Cause**:
   - Sidebar item only; never shown in normal daily flows.
   - Records: meeting date, recipient (member or free-text outsider), reason, amount in integer paise, and admin-entered attendance/consent note.
   - Requires approval from a second admin.
   - Creates a `GOOD_CAUSE_GRANT` ledger entry that reduces the interest pool.
   - The recipient repays nothing; no loan or repayment obligation is created.
   - Deducted equally across members (or setting: equal split), using the largest remainder method so the member share deductions sum exactly to the grant amount.
   - Plain confirmation screen shows each member's reduction before saving.
   - Grants larger than the interest pool collected so far are blocked unless explicitly confirmed by both admins.
   - Grants appear in every member's statement and exports.

---

## 7. End-of-Cycle Settlement & Settlement Preview

1. **Settlement Formula**:
   At cycle end (or in the live settlement preview available at any time):
   $$\text{Member Payout} = \text{Contributions Paid} + \text{Share of Net Interest Pool} - \text{Unpaid Contributions} - \text{Unpaid Principal} - \text{Unpaid Interest Due}$$
   where:
   $$\text{Net Interest Pool} = \text{Loan Interest Collected} + \text{Bank Interest} - \text{Good Cause Grants}$$
   - Distributed equally across members (setting: equal split by default) using the Largest Remainder Method so total distributed paise equals the net pool exactly.
2. **No Cycle Deletion**: There is no delete route, no delete button, and no database delete path for cycles.

---

## 8. Rotation Payout & Settings

1. **Rotation Payout**: Exists as an optional cycle setting, off by default.
2. **New-Cycle Wizard**: Guided multi-step flow requiring two-admin confirmation. Once activated, settings are locked; any changes require two admins, a written reason, and are audit-logged.

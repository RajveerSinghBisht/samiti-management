# Samiti Calculation & Accounting Rules

This document specifies every monetary, rounding, ledger, interest, sharing, rotation, and date rule used by the Samiti Management System. Items marked **[NEEDS HUMAN CONFIRMATION]** represent reasonable defaults chosen where real-world samiti practices vary and must be confirmed with the group's treasurer/committee before production use.

---

## 1. Currency, Precision, and Rounding

1. **Integer Paise Representation**: All monetary amounts are stored and computed strictly as safe integers in **paise** (`1 Rupee = 100 paise`). Floating-point numbers are never used for money storage or arithmetic.
2. **Round Half Up Per Entry**: Whenever an exact ratio `numerator / denominator` (with `numerator >= 0`, `denominator > 0`) must be rounded to integer paise, the system uses **round half up**:
   $$\text{roundHalfUp}(n, d) = \left\lfloor \frac{2n + d}{2d} \right\rfloor$$
   computed using exact `BigInt` integer arithmetic to avoid intermediate overflow.
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

## 2. Time Zone and Day Ordering

1. **IST Calendar Dates**: All financial effective dates, month boundaries, and weekly cron keys use **Asia/Kolkata (IST, UTC+05:30)** calendar dates formatted as `YYYY-MM-DD`.
2. **Within-Day Order Independence**: Every calculation groups or sorts ledger entries deterministically by `(effectiveDate ASC, canonicalEntryTypeOrder ASC, id ASC)` and computes end-of-day principal balances per IST date. Consequently, the insertion sequence of multiple entries recorded on the same IST date never changes any resulting balance.

---

## 3. Append-Only Ledger & Reversals

1. Every `ledger_entries` row has a strictly positive `amount_paise > 0`.
2. Database triggers forbid `UPDATE`, `DELETE`, and `TRUNCATE` on `ledger_entries`.
3. Errors are corrected exclusively by appending a `REVERSAL` entry referencing `reverses_entry_id` (enforced unique in the database so an entry cannot be reversed twice) plus a new corrected entry if needed, each with reason, acting admin, and timestamp.
4. Reversing a `REVERSAL` entry is forbidden.
5. Replaying the ledger excludes any `REVERSAL` row and the exact entry referenced by `reverses_entry_id`, guaranteeing that reversing an entry restores the exact prior state.

---

## 4. Loan Interest & Repayment Rules

1. **Interest Modes** (configured per cycle):
   - `REDUCING_BALANCE` (default): Monthly interest rate (`interestRateBps`, e.g., `300` = `3.00%` per month) is applied to the loan's daily end-of-day outstanding principal.
   - `FLAT`: Monthly interest rate is applied to the loan's original disbursed principal for every day the loan remains open (end-of-day outstanding principal > 0).
2. **[NEEDS HUMAN CONFIRMATION] Partial Month & Mid-Month Repayment Pro-Rata Rule**:
   - Interest accrues per calendar day within each IST calendar month using exact calendar days in that month (`daysInMonth`, 28/29/30/31), rounded half-up once per loan per calendar month:
     $$\text{monthInterest} = \text{roundHalfUp}\left(\left(\sum_{d \in \text{activeDays}} P_d\right) \cdot \text{rateBps},\; 10000 \cdot \text{daysInMonth}\right)$$
     where $P_d$ is the end-of-day principal on IST date $d$ (for `REDUCING_BALANCE`), or the initial disbursed principal on days where end-of-day principal $> 0$ (for `FLAT`).
   - A loan disbursed on date $D_{\text{disb}}$ begins accruing on $D_{\text{disb}}$ (inclusive).
   - A repayment recorded on date $D_{\text{rep}}$ reduces principal effective immediately on $D_{\text{rep}}$, so $P_{D_{\text{rep}}}$ already reflects that repayment.
   - Queries "as of" a date $A$ include accrued days strictly before $A$ (`d < A`) unless an explicit completed-month end date is requested. Thus, on the morning of repayment date $D_{\text{rep}}$ (before the day completes), interest up to $D_{\text{rep}} - 1$ is due.
   - *Alternative common samiti practice to confirm*: Some samitis charge a full month's interest for any calendar month in which the loan is open, regardless of disbursement or repayment day.
3. **[NEEDS HUMAN CONFIRMATION] Repayment Allocation Order**:
   - Repayments are allocated **interest first, principal second**:
     - `REPAYMENT_INTEREST = min(paymentAmountPaise, unpaidAccruedInterestPaise)`
     - `REPAYMENT_PRINCIPAL = paymentAmountPaise - REPAYMENT_INTEREST`
   - Any repayment exceeding `outstandingPrincipalPaise + unpaidAccruedInterestPaise` is rejected.
4. **[NEEDS HUMAN CONFIRMATION] Late Cycle Loans & Cycle Closing**:
   - Loans may be requested in any active month of the cycle (including the final month), provided cash is available.
   - A cycle **cannot be closed** while any loan has `outstandingPrincipalPaise > 0`, `unpaidAccruedInterestPaise > 0`, or `PENDING_APPROVAL` status. All loans must be fully repaid/settled before cycle close.

---

## 5. End-of-Cycle Interest Sharing

1. **Interest Pool**: Total interest collected during the cycle (`sum(REPAYMENT_INTEREST)` net of reversals).
2. **Sharing Modes** (configured per cycle):
   - `PROPORTIONAL_CONTRIBUTION` (default): Each member's weight is their net `CONTRIBUTION` total (`sum(CONTRIBUTION)` net of reversals). A member who contributed `0` receives `0` share (unless all members contributed `0`, in which case shares fall back to equal).
   - `EQUAL`: Every member in the cycle receives weight `1`.
3. Shares are computed via the Largest Remainder Method so the sum of member shares equals the total collected interest pool exactly.

---

## 6. Rotation Payout Schedule

1. Controlled per cycle by `rotationPayoutEnabled` (`false` by default).
2. When enabled, for each cycle month $m \in \{1, \dots, \text{lengthMonths}\}$, the scheduled recipient is `orderedActiveMembers[(m - 1) % orderedActiveMembers.length]` and expected lump sum is `monthlyContributionPaise * orderedActiveMembers.length`.

---

## 7. Late Contribution Rule

1. Controlled per cycle by `lateRuleMode` (`'NONE'` by default; optional `'FIXED_PAISA'` or `'PERCENT_BPS'`).
2. Under `'NONE'`, late fee is always `0`.
3. Under `'FIXED_PAISA'`, late fee is `lateRuleValue` paise when `isLate` is true.
4. Under `'PERCENT_BPS'`, late fee is `roundHalfUp(expectedContributionPaise * lateRuleValue, 10000)`.


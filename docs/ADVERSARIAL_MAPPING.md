# Adversarial Scenarios and Test Traceability Mapping

This document provides a comprehensive traceability matrix mapping every adversarial scenario, boundary case, and security failure mode to its exact implementing automated test files, test suites, and assertions across the Samiti Management test suite.

---

## 1. Adversarial Scenarios Traceability Matrix

| Threat Category | Specific Attack / Error Scenario | Implementing Test File | Test Suite / Case Name | Key Assertions & Guard Enforcements |
|---|---|---|---|---|
| **Ledger Immutability & DB Revocation** | Attempting direct SQL `UPDATE` on `ledger_entries` using application role | `tests/acceptance/ledger-immutability.test.ts`, `tests/acceptance_v2/real-postgres-concurrency.test.ts` | `app role cannot UPDATE ledger_entries` | Database privilege check throws PostgreSQL error code `42501` (`insufficient_privilege`) or trigger `P0001`. |
| **Ledger Immutability & DB Revocation** | Attempting direct SQL `DELETE` or `TRUNCATE` on `ledger_entries` | `tests/acceptance/ledger-immutability.test.ts`, `tests/acceptance_v2/real-postgres-concurrency.test.ts` | `app role cannot DELETE from ledger_entries` | Revoked privileges block command with error code `42501`. |
| **Zero Cycle Deletion** | Attempting to delete a cycle via SQL or HTTP API | `tests/acceptance_v2/new-cycle-wizard.test.ts` | `blocks cycle deletion` | DB trigger `prevent_cycle_deletion()` throws `P0001` "Cycles cannot be deleted". |
| **Double Reversal** | Attempting to reverse an already reversed ledger entry | `tests/acceptance/adversarial.test.ts` | `rejects double reversal` | `ServiceError(409)` "Ledger entry is already reversed". |
| **Concurrent Double Reversal** | Parallel requests simultaneously attempting to reverse the same entry | `tests/adversarial/iter2-extra.test.ts` | `prevents concurrent double reversal` | Database transaction with `SELECT FOR UPDATE` ensures exactly 1 succeeds and second receives 409 conflict. |
| **Missing Reversal Reason** | Admin submitting reversal without reason | `tests/unit/auth-and-ledger.test.ts` | `covers ledger validation errors` | Rejection with 400 "Reversal reason is required". |
| **Reversal High-Value Threshold** | Reversal exceeding threshold (₹1,000 / 100,000 paise) by single admin | `tests/acceptance/two-admin-approvals.test.ts` | `two-admin approval on high-value reversal` | Routed to Approvals queue in `PENDING_APPROVAL` status; cannot execute without second-admin sign-off. |
| **Float / Floating Point Money** | Client submits floating-point number (e.g. `10.50`) for integer paise field | `tests/acceptance/adversarial.test.ts` | `rejects invalid numeric formats` | Zod strict integer parser and `parseStrictPaise` reject decimals with 400 Bad Request. |
| **Negative Money Amounts** | Client submits negative rupee or paise value | `tests/acceptance/adversarial.test.ts` | `rejects negative amounts` | Zod `z.number().int().positive()` rejects negative numbers. |
| **Scientific Notation & Infinity** | Client submits `1e5`, `NaN`, or `Infinity` | `tests/acceptance/adversarial.test.ts` | `rejects non-finite values` | Strict integer regex parser rejects scientific notation. |
| **Overpayment Beyond Balance** | Repayment amount exceeds total outstanding loan balance | `tests/acceptance/adversarial.test.ts` | `rejects overpayment` | `ServiceError(400)` "Repayment exceeds outstanding amount". |
| **Concurrent Overpayment Race** | Parallel repayment submissions race to overpay the loan | `tests/acceptance/adversarial.test.ts` | `concurrent overpayment race` | Loan record row-level lock (`SELECT ... FOR UPDATE`) serializes repayments, preventing negative balance. |
| **Cycle Close with Open Loans** | Admin attempts to close a cycle while open loan balances remain | `tests/acceptance/adversarial.test.ts` | `cycle close with open loan` | `ServiceError(400)` "Cannot close cycle with active loans". |
| **Normal Loan Cap Enforcement** | Loan exceeds normal cap (e.g. ₹50,000) without emergency flag | `tests/acceptance_v2/loans-per-loan-terms.test.ts` | `emergency cap limits` | 400 Bad Request "Loan exceeds normal cap. Emergency flag and reason required." |
| **Emergency Loan Cap Enforcement** | Loan exceeds emergency cap (e.g. ₹1,00,000) | `tests/acceptance_v2/loans-per-loan-terms.test.ts` | `emergency cap limits` | 400 Bad Request "Loan amount exceeds emergency cap". |
| **Lending Pool Exhaustion** | Loan exceeds available lending pool without second-admin sign-off | `tests/acceptance_v2/loans-per-loan-terms.test.ts` | `pool available calculation` | Requires second admin confirmation flag and approval. |
| **Good Cause Grant Pool Exhaustion** | Good cause grant exceeds available collected interest pool | `tests/acceptance_v2/good-cause-and-settlement.test.ts` | `pool balance blocking` | Blocked unless explicit double confirmation flag `confirmPoolExceeded` is provided. |
| **Good Cause Grant Sharing Property** | Sum of member interest share reductions plus grant | `tests/acceptance_v2/good-cause-and-settlement.test.ts` | `fast-check property: shares + grant == pool` | Property test over 100 arbitrary amounts verifies exact integer paise equality (`sum === total`). |
| **Admin Self-Reset of Credentials** | Admin attempting to reset their own password or TOTP | `tests/acceptance_v2/member-access-and-admin-security.test.ts` | `cross-admin reset` | 403 Forbidden "An admin cannot reset their own credentials. A different admin is required." |
| **Brute-Force PIN Lockout** | Attacker repeatedly guesses a member's 6-digit PIN | `tests/acceptance/auth-and-roles.test.ts`, `tests/acceptance_v2/member-access-and-admin-security.test.ts` | `PIN lockout and forced PIN change` | Database counter locks account for 15 minutes after 5 consecutive failures. |
| **Session Invalidation on PIN Reset** | Attacker maintains active session after admin resets member's PIN | `tests/acceptance_v2/member-access-and-admin-security.test.ts` | `session invalidation` | All existing sessions deleted from database upon admin PIN reset; old session receives 401 Unauthorized. |
| **Forced PIN Change on Temporary PIN** | Member attempts normal operations with temporary PIN | `tests/acceptance_v2/member-access-and-admin-security.test.ts` | `temporary PIN lifecycle` | Member session has `mustChangePin: true`; member is restricted until `newPin` is configured. |
| **XSS & HTML Injection** | User submits script tags in place name, member name, or notes | `tests/acceptance/adversarial.test.ts` | `safely stores XSS/SQLi strings` | React JSX auto-escaping renders raw text nodes; no `dangerouslySetInnerHTML`. |
| **SQL Injection in Inputs** | Attacker inputs `' OR '1'='1` or `; DROP TABLE --` in free-text fields | `tests/acceptance/adversarial.test.ts` | `safely stores XSS/SQLi strings` | Drizzle ORM parameterized SQL statements treat all values as string literals. |
| **Horizontal Privilege Escalation** | Member A attempts to view Member B's loan or savings data | `tests/acceptance/authz-matrix.test.ts` | `isolates member A from member B` | Routes enforce session-derived `memberId`; Member A cannot query Member B's data (403/404). |
| **Vertical Privilege Escalation** | Member attempts to call admin endpoints (e.g. `/api/admin/loans`) | `tests/acceptance/authz-matrix.test.ts` | `denies anonymous (401) and member (403)` | `requireAuthenticatedSession` enforces `requireAdmin: true`; returns 403 Forbidden. |
| **CSRF & Origin Header Tampering** | Mutating request with invalid or missing `x-csrf-token` / Origin | `tests/unit/auth-and-ledger.test.ts` | `origin/CSRF guards` | Origin mismatch or invalid CSRF token rejected with 403 Forbidden. |
| **Mid-Cycle Member Exit** | Member joins late or leaves mid-cycle | `tests/adversarial/iter2-extra.test.ts` | `mid-cycle member exit` | Largest remainder method correctly distributes pool only among eligible contributing months. |
| **Double Contribution for Same Month** | Admin attempts to record two contributions for same member/month | `tests/adversarial/iter1-extra.test.ts` | `rejects double-submit of same member/month` | Contribution schedule unique index rejects duplicate insertion with 409 Conflict. |

---

## 2. Integrity Verification
All listed test suites run against real PostgreSQL and in-memory mock harnesses without skips, passing 100% of test cases.


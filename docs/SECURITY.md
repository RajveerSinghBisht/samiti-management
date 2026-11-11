# Security Architecture & Threat Notes

## Key Protections Implemented
- **Server-Side RBAC & Member Isolation**: Every API route and Server Component validates the DB-backed session cookie and role (`ADMIN` vs `MEMBER`), plus `totpVerified` for admins and `mustChangePin` for members. Member routes always filter by `session.memberId` and ignore caller-supplied `memberId` parameters.
- **Ledger Append-Only Immutability**: Enforced in PostgreSQL via `BEFORE UPDATE OR DELETE` and `BEFORE TRUNCATE` triggers (`prevent_append_only_mutation()`) plus revoked `UPDATE, DELETE, TRUNCATE` privileges on `ledger_entries` and `audit_events`.
- **Authentication**:
  - Members: 10-digit mobile + 4–6 digit PIN hashed with `bcryptjs` (cost 10) after HMAC-SHA256 with `PIN_PEPPER`. DB-backed failure counter locks accounts after `MAX_LOGIN_FAILURES` for `LOCKOUT_MINUTES`.
  - Admins: 10-digit mobile + strong password (>= 12 chars, bcrypt + pepper) + mandatory TOTP (AES-256-GCM encrypted secret in DB using `TOTP_ENCRYPTION_KEY`) + 8 hashed single-use recovery codes.
  - Uniform `401 Invalid credentials` errors with dummy bcrypt checks to resist account enumeration and timing attacks.
- **Sessions & CSRF**:
  - `HttpOnly`, `SameSite=Lax`, `Secure` (on HTTPS) session cookies storing only a random token whose SHA-256 hash is saved in `sessions`.
  - Session token rotated on login, TOTP verification, and PIN change (defeating session fixation).
  - Explicit CSRF token validation (`x-csrf-token` constant-time matched against session or double-submit pre-login CSRF cookie) + `Origin`/`Host` validation on all state-changing routes.
- **Two-Admin Governance**: Loan approvals, cycle closures, and reversals above `reversalApprovalThresholdPaise` require approval from a second distinct admin via atomic `WHERE status = 'PENDING'` updates.
- **Backup Hygiene**: JSON and CSV exports select only non-secret columns and exclude all PIN hashes, password hashes, TOTP secrets, recovery code hashes, and session tokens.


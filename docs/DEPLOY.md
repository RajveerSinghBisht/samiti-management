# Deployment & Operations Guide (Non-Expert Step-by-Step)

This system is a private ledger and viewer for your samiti. It **never holds or moves real money**; it only records entries made by your treasurer and admins.

> [!IMPORTANT]
> **Do not deploy without reviewing `docs/RULES.md` and `docs/TRANSLATION_REVIEW.md` with your group's treasurer and 2–3 members.**

---

## Step 1: Create an External PostgreSQL Database & Two Database Roles

Vercel does not store local files permanently, so you must use an external managed PostgreSQL database (for example: Neon, Supabase, AWS RDS, or Railway).

For production defense-in-depth, configure **two database roles**:
1. **`samiti_owner` (Database Owner / Migration Role)**:
   - Superuser or schema owner used during initial setup and schema migrations (`npm run db:migrate`).
2. **`samiti_app` (Application Runtime Role)**:
   - Dedicated low-privilege role used by the deployed Next.js application runtime.
   - Database trigger and SQL permissions explicitly **REVOKE UPDATE, DELETE, and TRUNCATE** on `ledger_entries` from `samiti_app`.
   - Has `SELECT, INSERT` privileges on `ledger_entries` and normal CRUD privileges on operational tables (e.g. sessions, approvals, meetings).

```sql
-- Create app role and grant schema usage
CREATE ROLE samiti_app WITH LOGIN PASSWORD 'your_app_password';
GRANT CONNECT ON DATABASE samiti TO samiti_app;
GRANT USAGE ON SCHEMA public TO samiti_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO samiti_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO samiti_app;

-- REVOKE UPDATE, DELETE, TRUNCATE on ledger_entries from application role
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.ledger_entries FROM samiti_app;
```

Provide the `samiti_app` connection URL as `DATABASE_URL` in Vercel.

---

## Step 2: Generate Strong Random Secrets

Generate four unique random secrets (run in PowerShell or Linux/macOS terminal, or use a password manager):

- **`SESSION_SECRET`**: at least 32 random characters
- **`PIN_PEPPER`**: at least 16 random characters (never change this after users register, or existing PINs/passwords will stop matching)
- **`TOTP_ENCRYPTION_KEY`**: **exactly 64 hexadecimal characters** (32 bytes), e.g., generated via:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- **`CRON_SECRET`**: at least 16 random characters (used by Vercel Cron to trigger weekly reminders)

---

## Step 3: Configure Environment Variables on Vercel

In your Vercel project dashboard (**Settings -> Environment Variables**), add every variable listed in `.env.example`:

| Variable | Value / Guidance |
|---|---|
| `DATABASE_URL` | Your `postgresql://...` URL from Step 1 |
| `SESSION_SECRET` | Random string (>= 32 chars) |
| `PIN_PEPPER` | Random string (>= 16 chars) |
| `TOTP_ENCRYPTION_KEY` | 64-character hex key |
| `CRON_SECRET` | Random string (>= 16 chars) |
| `APP_URL` | Your production URL, e.g. `https://your-samiti.vercel.app` |
| `MESSAGING_PROVIDER` | `prepare` (recommended default: admin sees click-to-chat WhatsApp links) |
| `MEMBER_SESSION_DAYS` | `30` (longer convenience for older members) |
| `ADMIN_SESSION_DAYS` | `7` |
| `MAX_LOGIN_FAILURES` | `5` |
| `LOCKOUT_MINUTES` | `15` |
| `REVERSAL_APPROVAL_THRESHOLD_PAISE` | e.g. `100000` (₹1,000; reversals above this require a second admin) |

---

## Step 4: Run Database Migrations

From your local computer (with `DATABASE_URL` pointing to your external PostgreSQL database):

```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/samiti?sslmode=require"
$env:SESSION_SECRET="temp-or-prod-secret-min-32-chars-0001"
$env:PIN_PEPPER="temp-or-prod-pepper-16"
$env:TOTP_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
$env:CRON_SECRET="temp-or-prod-cron-16"
npm run db:migrate
```

Verify that migrations applied cleanly and that `ledger_entries` rejects `UPDATE` and `DELETE`.

---

## Step 5: Seed the First Admin (One-Time CLI Script)

There is no public sign-up route. Create the first admin from your terminal:

```powershell
$env:SEED_ADMIN_NAME="Treasurer Name"
$env:SEED_ADMIN_MOBILE="9876543210"
$env:SEED_ADMIN_PASSWORD="Choose-A-Very-Strong-Password-12+"
npm run seed:admin
```

1. Open `https://your-samiti.vercel.app/admin/login`.
2. Sign in with the seeded mobile number and password (leave the authenticator code blank on this first sign-in).
3. Scan the QR code with an authenticator app (Google Authenticator, Aegis, etc.), enter the 6-digit code, and **write down your single-use recovery codes on paper** in a safe place.
4. Create a **second admin** under **Admin -> Members** so two-admin approvals (loans, high-value reversals, cycle closing) can be verified by two different people.

---

## Step 6: Configure the Weekly Reminder Cron Job

`vercel.json` configures a weekly cron calling `/api/cron/weekly-reminders` every Monday at `04:00 UTC` (`09:30 IST`).
Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when `CRON_SECRET` is configured in Vercel Environment Variables.

- Default mode `MESSAGING_PROVIDER=prepare` builds one prepared reminder per active loan per IST week and shows click-to-chat links on **Admin -> Weekly Messages**. It sends **0 paid API messages** automatically.
- Running the cron route multiple times in the same IST week is idempotent (`message_logs` enforces a unique constraint per `(cycle_id, member_id, loan_id, week_key)`).

---

## Step 7: Backups & Restore Procedure

### Taking a Backup
1. **Application Export (Weekly / Monthly)**: Sign in as Admin -> **Export & Settings** -> click **Download JSON Backup** and **Download Ledger CSV**. Store the files in two separate offline/cloud locations (e.g., encrypted drive + USB). Note that exports deliberately omit all PINs, passwords, TOTP keys, and recovery codes.
2. **Database Provider Snapshot**: Enable automated daily snapshots in your PostgreSQL provider.

### Restoring from a JSON Backup
1. Provision a fresh empty PostgreSQL database and run `npm run db:migrate`.
2. Restore the sanitized JSON data via `restoreFromExportJson(jsonString, databaseUrl)` (verified in automated test `tests/acceptance/weekly-job-and-backup.test.ts` to reproduce identical member savings, loan balances, and group totals).
3. Re-seed an admin or reset member PINs/passwords since credentials are excluded from backups for safety.

---

## Pre-Launch Checklist: Vercel & External Limits to Verify Manually

Because platform plans and pricing change over time and could not be verified live during build, confirm the following before going live:

- [ ] **Vercel Cron Limits on Your Plan**: Verify whether your Vercel plan (Hobby vs Pro) permits the weekly cron expression (`0 4 * * 1`) and how many cron jobs / invocations per day are allowed (Hobby plans often restrict cron frequency to once per day and limit precision).
- [ ] **Vercel Function Timeout**: Verify serverless timeout limits (`10s` on Hobby vs longer on Pro) are sufficient for database cold starts and export downloads.
- [ ] **PostgreSQL Provider Limits**: Check free-tier storage, connection pool limits (`pg.Pool` max connections), and automated backup retention on your PostgreSQL provider.
- [ ] **WhatsApp / Messaging Costs & Policy**: Confirm whether `prepare` mode (free click-to-chat links opened manually by the admin) meets your group's needs before ever enabling `send` mode or purchasing WhatsApp Business Cloud API templates.
- [ ] **Local Legal & Cooperative Compliance**: Check local regulations in your Indian state regarding informal savings/lending groups ("samiti" / chit / self-help groups) and interest rate norms.


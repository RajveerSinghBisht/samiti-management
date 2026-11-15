# 🏦 Samiti Management System (समिति प्रबंधन प्रणाली)

> **A private, audit-grade savings and lending group management ledger designed for Indian communities and senior citizens.**  
> *Zero floating-point math. Database-enforced append-only ledger. Strict multi-admin governance. Never holds or moves money.*

---

## 📖 The Story & What This Solves

In Indian towns and neighborhoods, small mutual aid and community savings groups—traditionally called a **Samiti (समिति)**, **Bishi (बीसी)**, or **Chit**—operate entirely on mutual trust:
- **10 to 60 members** (often older adults and family elders) meet once a month at a member's home.
- Every member contributes a fixed monthly amount in cash to the community pool.
- Members in need borrow from the pool for business or personal needs and pay a nominal monthly interest.
- At the end of a 1, 2, or 5-year cycle (typically closing around Diwali), the interest earned is distributed equally among members.

### Why not spreadsheets or generic accounting apps?
Standard accounting apps have floating-point rounding errors, allow silent edits or deleted records, and feature cluttered, confusing interfaces with English jargon.

**Samiti Management System** acts as a tamper-proof digital register:
- **It never holds or moves money**: Physical cash remains with the group's treasurer.
- **Derived Balances**: Current balances are dynamically replayed from an immutable, append-only database ledger.
- **Senior-Friendly UI**: High contrast, minimum 18px typography, large 48px touch targets, full Devanagari Hindi toggle, and automatic `+91` Indian mobile handling.

---

## 🛡️ Non-Negotiable Core Rules

1. **Integer Paise Representation**: All currency is stored as integer paise (`₹1 = 100 paise`). Floating-point arithmetic is strictly forbidden. Rounding follows round-half-up. Distributions use the **Largest Remainder Method (Hamilton-Hare)** so splits sum to the exact total down to the single paisa.
2. **Append-Only Database Immutability**: The `ledger_entries` table cannot be updated or deleted. This is enforced at the database level using PostgreSQL triggers (`prevent_ledger_updates`) and role revocations (`REVOKE UPDATE, DELETE, TRUNCATE`). Mistakes are corrected solely via formal **reversal entries**.
3. **Zero Cycle Deletion**: No delete route, no delete button, and a PostgreSQL trigger (`prevent_cycle_deletion()`) preventing cycle destruction.
4. **Two-Admin Approval Workflow**: High-stakes actions (disbursing loans, approving emergency loan caps, cycle activation/closing, community grants, high-value reversals) strictly require approval by a second, independent administrator.
5. **Privacy & Minimum Data**: Strictly collects name, 10-digit mobile number, and role. No bank account numbers, PAN, Aadhaar, or detailed home addresses are ever collected.

---

## 📐 Authoritative Samiti Accounting Rules

```
Pool Available to Lend = (Contributions Collected + Interest Collected + Bank Interest + Principal Repaid)
                        - (Principal Disbursed + Good Cause Grants)
```

1. **Meeting-Based Accounting**: All entries are tied to monthly physical meeting dates.
2. **Disbursement Grace Period**: Loans disbursed at Meeting $N$ accrue **₹0 interest** for that meeting. Interest begins accruing at Meeting $N+1$.
3. **Monthly Interest Formula**:
   $$\text{Interest Due at Meeting } N = \text{Monthly Rate (default 1\%)} \times \text{Principal Outstanding at close of Meeting } N-1$$
   *No proration, no compounding, no interest-on-interest.*
4. **Independent Repayment Entries**: Repayments are recorded as two distinct entries: `REPAYMENT_INTEREST` and `REPAYMENT_PRINCIPAL`. Unpaid interest carries forward as "interest due" and is deducted at cycle settlement.
5. **Loan Caps**:
   - **Normal Cap** (e.g. ₹50,000): Standard borrowing limit per member.
   - **Emergency Cap** (e.g. ₹1,00,000): Requires an "Emergency" flag, written justification, and second-admin approval. Borrowing above the emergency cap is blocked.
6. **Give for a Good Cause (`GOOD_CAUSE_GRANT`)**:
   - Dedicated sidebar flow for emergency charitable assistance.
   - Deducted equally from the interest pool across all members using the largest remainder method.
   - The beneficiary repays nothing (creates no debt obligation).
7. **Cycle End Settlement**:
   $$\text{Member Payout} = \text{Contributions Paid} + \text{Equal Share of Net Interest Pool} - (\text{Unpaid Contributions} + \text{Unpaid Principal} + \text{Unpaid Interest})$$

---

## ✨ Features Overview

### 1. New-Cycle Wizard (`/admin/cycle-wizard`)
A guided 5-step wizard for starting a new cycle:
- **Basics**: Name, Start Date, End Date (calculates months and years to Diwali).
- **Members**: One-click carry over of returning members or enrollment of new members.
- **Financials**: Fixed monthly contribution (e.g. ₹1,000), default monthly interest rate.
- **Loan Caps**: Normal and emergency lending thresholds.
- **Review & Approval**: Generates a summary for second-admin sign-off.

### 2. Monthly Meeting Flow (`/admin/meetings/conduct`)
Fast, intuitive checklist to conduct monthly physical gatherings:
- Records host and place (e.g., *Ramesh Patel's Residence*).
- One-click attendance and ₹1,000 contribution checkboxes.
- Pre-filled interest due with separate principal repayment fields.
- Manual entry for samiti bank savings account interest.
- Instant ledger entry creation and meeting closure.

### 3. Monthly Mobile Dashboard (`/admin/dashboard`)
A fast, single-screen dashboard designed for phones:
- Live display of **Pool Available to Lend**.
- Instant breakdown: Who has paid this month, who owes interest, and pending loan balances.
- Group-level financial totals.

### 4. Give for a Good Cause (`/admin/good-cause`)
Community grant workflow isolated in the sidebar:
- Beneficiary details, amount, reason, and meeting consent note.
- Live preview table showing each member's exact equal share reduction before submitting.
- Balance protection: blocks grants exceeding the interest collected so far without double admin confirmation.

### 5. Senior-Friendly Member Portal (`/login`, `/home`, `/my-savings`, `/my-loan`)
- Mobile number + 6-digit PIN login with automatic `+91` prefix handling.
- Mandatory temporary PIN reset on first login.
- **My Savings**: Digital passbook of all monthly contributions with print-friendly layout.
- **My Loan**: Transparent outstanding balance cards, next meeting due date, and repayment history.
- **Language Switcher**: Instant English $\leftrightarrow$ Hindi (हिंदी) toggle.

---

## 🛠️ Architecture & Tech Stack

```mermaid
flowchart TD
    Client["Next.js 16 Web App (App Router)"] --> API["Server Actions & Route Handlers"]
    API --> Auth["Argon2id/Bcrypt + PEPPER + TOTP 2FA"]
    API --> Service["Business Logic & Service Layer"]
    Service --> Replay["Ledger Replay Engine (lib/calc)"]
    Service --> Drizzle["Drizzle ORM"]
    Drizzle --> DB[(PostgreSQL Database)]
    DB --> Trigger1["Trigger: prevent_ledger_updates"]
    DB --> Trigger2["Trigger: prevent_cycle_deletion"]
    DB --> Roles["samiti_app: No UPDATE/DELETE/TRUNCATE"]
```

- **Framework**: Next.js 16.4 (App Router, Server Components)
- **Language**: TypeScript 5 (Strict Mode, `noUncheckedIndexedAccess`)
- **Database**: PostgreSQL (Managed Neon.tech, Supabase, or AWS RDS) with Drizzle ORM
- **Validation**: Zod 4 schemas with strict sanitization
- **Security**: AES-256-GCM TOTP encryption, Argon2id/Bcrypt PIN hashing with pepper, anti-CSRF, rate-limited lockouts
- **Quality & Accessibility**: Vitest, fast-check (property testing), Playwright, axe-core (WCAG AAA contrast, 48px tap targets), Semgrep, npm audit

---

## 🚀 Quick Start Guide (Local Development)

### Prerequisites
- Node.js 20+ (LTS)
- PostgreSQL database (or Neon.tech connection string)

### 1. Clone & Install
```bash
git clone https://github.com/<your-username>/samiti-management.git
cd samiti-management
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```
Update `.env.local` with your database connection:
```env
DATABASE_URL="postgresql://neondb_owner:password@ep-xyz.aws.neon.tech/neondb?sslmode=require"
SESSION_SECRET="your-at-least-32-chars-long-random-secret"
PIN_PEPPER="your-at-least-16-chars-random-pepper"
TOTP_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
CRON_SECRET="your-at-least-16-chars-cron-secret"
APP_URL="http://localhost:3000"
```

### 3. Run Migrations & Seed Demo Data
```bash
npm run db:migrate
npm run seed:demo
```

### 4. Start Development Server
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser!

---

## 🔑 Demo Login Credentials

### Admins (Full Management & Governance)
- **Admin 1**: Mobile `9820099001` | Password `AdminPass123#2026` | TOTP `JBSWY3DPEHPK3PXP`
- **Admin 2**: Mobile `9820099002` | Password `AdminPass123#2026` | TOTP `JBSWY3DPEHPK3PXP`
- *Admin Portal*: `http://localhost:3000/admin/login`

### Members (Read-Only Statements & Loan View)
- **Mobiles**: `9820000001` through `9820000050`
- **PIN**: `123456`
- *Member Portal*: `http://localhost:3000/login`

---

## ☁️ 24/7 Production Deployment to Vercel

Because the system connects to an external managed cloud database, deploying to Vercel keeps the application online **24/7/365 without needing your local computer to stay running**.

1. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "docs: add comprehensive README"
   git push origin master
   ```
2. **Deploy on Vercel**:
   - Go to [vercel.com](https://vercel.com) and import your GitHub repository.
   - Add the Environment Variables from `.env.local` (`DATABASE_URL`, `SESSION_SECRET`, `PIN_PEPPER`, `TOTP_ENCRYPTION_KEY`, `CRON_SECRET`, `APP_URL`).
   - Click **Deploy**.
3. **Run Migrations on Neon**:
   - Run `npm run db:migrate` locally once pointing to your Neon database URL.
   - Your live cloud application is now ready for your group members to use from anywhere in India!

---

## 🧪 Quality Gates & Verification Matrix

| Gate | Description | Status |
| :--- | :--- | :---: |
| **G1: Acceptance Tests** | 38/38 tests passing across 19 suites (0 skipped) | ✅ Passing |
| **G2: Line Coverage** | `lib/calc`: 94.3%, `lib/auth`: 97.4%, `lib/services`: 95.0% (>90% requirement) | ✅ Passing |
| **G3: Static Types & Lint** | `tsc --noEmit` & `eslint .` (0 errors) | ✅ Passing |
| **G4: Security Scans** | Semgrep (74 rules across 122 files, 0 findings) & `npm audit` (0 high/crit) | ✅ Passing |
| **G5: Test Checksums** | SHA-256 verification of 11 V1 and 7 V2 acceptance test suites | ✅ Verified |
| **G6: Database Immutability** | Database-level triggers & role restrictions verified | ✅ Passing |
| **G7 & G8: UI & Accessibility** | Playwright + axe-core across Desktop & Mobile Pixel 5 (0 violations) | ✅ Passing |
| **G9: Production Build** | Next.js compilation of all 38 routes in <8 seconds | ✅ Passing |

---

## 📄 License & Attribution
Private community software created for Indian Self-Help Groups (SHGs) and Samitis.  
For technical details and security specifications, see [docs/RULES.md](docs/RULES.md) and [docs/DEPLOY.md](docs/DEPLOY.md).


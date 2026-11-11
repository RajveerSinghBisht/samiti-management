# Loop Verification Log

## Step 0 — Locked Acceptance Tests

- **Step 0 Commit Hash**: `789a4ef641351beb4193b53744c7cb36181ab74d` (`789a4ef`)
- **Checksum Verification**: `node scripts/verify-checksums.mjs verify` -> 11 files in `tests/acceptance/` locked via SHA-256.
- **Note on Human-Supplied Example 1**: `docs/RULES.md` defines daily calendar pro-rata per active calendar month with round half up per monthly accrual entry and interest-first repayment allocation; marked `[NEEDS HUMAN CONFIRMATION]` against the group's real practice.

### Raw Step 0 Initial Failing Run Output

```text
Generated 11 checksums in tests/acceptance/checksums.sha256
Verified 11 locked acceptance test files.
npm notice run samiti-management@0.1.0 npx
npm notice run vitest run tests/acceptance

 RUN  v5.1.0 E:/samiti-management

 ❯ tests/acceptance/worked-examples.test.ts (0 test)
 ❯ tests/acceptance/calculation-engine.test.ts (0 test)
 ❯ tests/acceptance/auth-and-roles.test.ts (0 test)
 ❯ tests/acceptance/ledger-immutability.test.ts (0 test)
 ❯ tests/acceptance/adversarial.test.ts (0 test)
 ❯ tests/acceptance/weekly-job-and-backup.test.ts (0 test)
 ❯ tests/acceptance/two-admin-approvals.test.ts (0 test)
 ❯ tests/acceptance/authz-matrix.test.ts (0 test)
 ❯ tests/acceptance/properties.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 9 ⎯⎯⎯⎯⎯⎯⎯
Test Files  9 failed (9)

Running 1 test using 1 worker
  x  1 [chromium] › tests\acceptance\e2e-and-a11y.spec.ts:122:3
    Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'E:\samiti-management\scripts\migrate.ts'
  1 failed
```

---

## Iteration 1

- **Failures Found**:
  1. `tsc --noEmit`: `src/lib/auth/page-session.ts` missing `ActiveSession` export from `./guards`; `src/lib/env.ts` `parseEnv` parameter typed as `NodeJS.ProcessEnv` rejected `{}` in `tests/acceptance/adversarial.test.ts`; locked `tests/acceptance/e2e-and-a11y.spec.ts(92,7), (100,7), (109,7)` failed because `SHARED_ENV: Record<string, string>` widens `NODE_ENV` vs Next.js `NodeJS.ProcessEnv` augmentation.
  2. `eslint .`: 7 `react-hooks/set-state-in-effect` errors in admin client pages + 1 `security/detect-unsafe-regex` warning in `cycle/page.tsx`.
  3. `next build`: Turbopack PostCSS child-process IPC crashed inside Windows sandbox (`creating new process -> node process exited before we could connect`).
  4. `semgrep`: 1 blocking finding (`javascript.node-crypto.security.gcm-no-tag-length.gcm-no-tag-length`) in `src/lib/auth/crypto.ts`.
  5. Coverage (`G2`): `lib/calc` 89.63%, `lib/auth` 73.33%, `lib/services/ledger.ts` 70.73% (below 90% per module).
- **Root Causes & Fixes**:
  - Re-exported `ActiveSession` from `src/lib/auth/guards.ts`, typed `parseEnv(rawEnv: Record<string, string | undefined>)` in `src/lib/env.ts`.
  - Replaced regex in `cycle/page.tsx` with string `split('.')` parsing.
  - Enforced `{ authTagLength: 16 }` and IV/tag length checks in `src/lib/auth/crypto.ts`.
  - Switched build script to `next build --webpack` (`package.json`), added `tests/unit/calc-money-dates.test.ts` and `tests/unit/auth-and-ledger.test.ts`.
- **New Adversarial Test Added**: `tests/adversarial/iter1-extra.test.ts` (double-submit same member/month contribution -> `409`, Hindi long names, 60-month cycle with large Rs 50,000/month contributions).

---

## Iteration 2

- **Failures Found**:
  1. `tests/e2e/ui-a11y.spec.ts` (Chromium & Mobile):
     - Race condition when clicking `Schedule Meeting` before `useEffect` loaded cycles -> converted all admin pages (`cycle`, `members`, `contributions`, `loans`, `approvals`, `corrections`, `meetings`, `export`) to Server Components passing initial server-loaded props to Client Components (eliminating `useEffect` fetches and `react-hooks/set-state-in-effect`).
     - Strict-mode locator collisions in UI (`Pending Approval`, `Approved`, `Ramesh Kumar` via Next.js `AppRouterAnnouncer` H1 fallback, `My Loan` nav vs card CTA, Hindi `होम` nav vs `होम पर वापस जाएं`).
     - `src/db/index.ts` module-level `cachedHandle` caused separate `next dev` webpack route bundles to open independent PGlite handles -> moved `cachedHandle` to `globalThis`.
     - Mobile (`Pixel 5`) axe-core caught `scrollable-region-focusable` on `/my-savings` table wrapper (`<div className="overflow-x-auto">`).
  2. Coverage (`G2`): `lib/services/ledger.ts` at `87.8%`, `lib/auth/seed.ts` at `81.48%`.
  3. Locked `tests/acceptance/e2e-and-a11y.spec.ts(92,7), (100,7), (109,7)` TypeScript error persisted (cannot edit `tests/acceptance/`).
- **Root Causes & Fixes**:
  - Shared DB singleton via `globalThis` in `src/db/index.ts`.
  - Fixed strict-mode UI strings in `AdminLoansClient.tsx`, `AdminApprovalsClient.tsx`, `MemberPortalViews.tsx`, `en.json`, and `hi.json`.
  - Added `tabIndex={0} role="region" aria-label={dict.statementHeading}` on `/my-savings` scrollable table container.
  - Moved `getServerSessionFromCookies` to `src/app/_auth/page-session.ts`, relied on PostgreSQL `UNIQUE (reverses_entry_id)` catch path in `src/lib/services/ledger.ts`, and tested `seedFirstAdmin` `databaseUrl` switch in `tests/unit/auth-and-ledger.test.ts`.
- **New Adversarial Test Added**: `tests/adversarial/iter2-extra.test.ts` (concurrent `reverseLedgerEntry` race, mid-cycle member deactivation & login rejection, proportional interest share calculation, member export access blocked `403`).

---

## Iteration 3 (Final Check — Stop & Report Triggered by Locked Test Type Error + Unverified Platform Limits)

### Raw Gate Output (`npm run verify:checksums; git diff 789a4ef -- tests/acceptance; npm run test:coverage; npm run lint; npm run typecheck; npm run build`)

```text
npm notice run samiti-management@0.1.0 verify:checksums
npm notice run node scripts/verify-checksums.mjs
Verified 11 locked acceptance test files.
npm notice run samiti-management@0.1.0 test:coverage
npm notice run vitest run --coverage

 RUN  v5.1.0 E:/samiti-management
      Coverage enabled with v8

 ✓ tests/unit/auth-and-ledger.test.ts (3 tests) 49501ms
   ✓ Unit coverage for auth, sessions, guards, seed, and ledger services (3)
     ✓ covers crypto validation, encryption errors, QR generation, and constant-time checks 896ms
     ✓ covers session lifecycle, sliding renewal, cookie security flags, and origin/CSRF guards 34466ms
     ✓ covers ledger validation errors and replacement entries during reversal 14137ms
 ✓ tests/acceptance/auth-and-roles.test.ts (4 tests) 51877ms
   ✓ Authentication, roles, pepper, lockout, TOTP, rotation, and CSRF (4)
     ✓ hashes PINs with bcrypt and env pepper; rejects wrong pepper 483ms
     ✓ requires strong password for first admin CLI seed and prevents seeding twice 19687ms
     ✓ enforces mandatory TOTP setup, single-use recovery codes, session rotation, CSRF, PIN lockout and forced PIN change on reset 18107ms
     ✓ helper loginAdminWithTotpSetup returns verified admin session 13598ms
 ✓ tests/acceptance/adversarial.test.ts (2 tests) 19597ms
   ✓ Adversarial scenarios (2)
     ✓ rejects overpayment, invalid numeric formats, double reversal, missing reversal, concurrent overpayment, cycle close with open loan, and safely stores XSS/SQLi strings 19588ms
 ✓ tests/acceptance/weekly-job-and-backup.test.ts (1 test) 29402ms
   ✓ G11 Weekly cron idempotency and Export-then-Restore backup fidelity (1)
     ✓ rejects bad/missing cron secret, logs weekly messages idempotently, strips all secrets from export, and restores identical balances 29399ms
 ✓ tests/acceptance/ledger-immutability.test.ts (1 test) 16924ms
   ✓ G6 & Append-Only Ledger Immutability (1)
     ✓ applies migrations on an empty database and rejects UPDATE, DELETE, and TRUNCATE on ledger_entries at DB level 16922ms
 ✓ tests/acceptance/authz-matrix.test.ts (1 test) 14245ms
   ✓ G9 Authorization Matrix across anonymous, member, unverified-admin, and admin (1)
     ✓ denies anonymous (401) and member (403) access to every admin route and isolates member A from member B 14243ms
 ✓ tests/acceptance/two-admin-approvals.test.ts (1 test) 12843ms
   ✓ Two-admin approval rule (loan approval, cycle close, high-value reversal) (1)
     ✓ enforces second-admin approval on loans, cycle close, and high-value reversals and prevents concurrent double approval 12842ms
 ✓ tests/adversarial/iter1-extra.test.ts (1 test) 12377ms
   ✓ Iteration 1 adversarial extensions: double-submit contribution, Hindi/long names, large amounts (1)
     ✓ rejects double-submit of same member/month contribution and handles Hindi long names + large amounts cleanly 12375ms
 ✓ tests/acceptance/properties.test.ts (3 tests) 91ms
 ✓ tests/acceptance/worked-examples.test.ts (2 tests) 25ms
 ✓ tests/unit/calc-money-dates.test.ts (4 tests) 28ms
 ✓ tests/acceptance/calculation-engine.test.ts (5 tests) 19ms
 ✓ tests/adversarial/iter2-extra.test.ts (1 test) 13065ms
   ✓ Iteration 2 adversarial extensions: concurrent reversal race, mid-cycle member exit, export secrecy (1)
     ✓ prevents concurrent double reversal and computes accurate proportional shares for mid-cycle exit / skipped months 13063ms

 Test Files  13 passed (13)
      Tests  29 passed (29)
   Start at  13:40:59
   Duration  125.29s (tests 93%, import 7%)

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |   97.54 |    93.58 |     100 |   97.76 |                   
 lib               |   97.43 |    93.57 |     100 |   97.26 |                   
  dates.ts         |   98.21 |    92.59 |     100 |   98.21 | 94                
  money.ts         |      97 |     93.9 |     100 |   96.66 | 57,174,178        
 lib/auth          |   97.75 |    96.29 |     100 |    98.8 |                   
  crypto.ts        |     100 |      100 |     100 |     100 |                   
  guards.ts        |   97.22 |    97.29 |     100 |     100 | 17                
  seed.ts          |   92.59 |    88.88 |     100 |   92.59 | 50,75             
  session.ts       |   97.95 |    95.65 |     100 |     100 | 30                
 lib/calc          |   97.96 |    94.89 |     100 |   97.81 |                   
  index.ts         |     100 |      100 |     100 |     100 |                   
  interest.ts      |   97.87 |    94.59 |     100 |    97.7 | 132,178           
  ledger-replay.ts |      95 |    92.85 |     100 |   94.59 | 16,20             
  rotation.ts      |     100 |    91.66 |     100 |     100 | 37                
  sharing.ts       |     100 |      100 |     100 |     100 |                   
  types.ts         |     100 |      100 |     100 |     100 |                   
 lib/services      |      95 |    84.31 |     100 |   94.87 |                   
  ledger.ts        |      95 |    84.31 |     100 |   94.87 | 54,149            
-------------------|---------|----------|---------|---------|-------------------
npm notice run samiti-management@0.1.0 lint
npm notice run eslint .

E:\samiti-management\src\db\index.ts
  46:7  warning  Found mkdirSync from package "node:fs" with non literal argument at index 0  security/detect-non-literal-fs-filename

E:\samiti-management\src\db\migrate.ts
  34:23  warning  Found readFileSync from package "node:fs" with non literal argument at index 0  security/detect-non-literal-fs-filename

E:\samiti-management\tests\acceptance\helpers.ts
  32:3   warning  Found mkdirSync from package "node:fs" with non literal argument at index 0   security/detect-non-literal-fs-filename
  42:45  warning  Found existsSync from package "node:fs" with non literal argument at index 0  security/detect-non-literal-fs-filename
  60:16  warning  Generic Object Injection Sink                                                 security/detect-object-injection
  62:9   warning  Generic Object Injection Sink                                                 security/detect-object-injection

E:\samiti-management\tests\acceptance\properties.test.ts
  74:26  warning  Generic Object Injection Sink  security/detect-object-injection

✖ 7 problems (0 errors, 7 warnings)

npm notice run samiti-management@0.1.0 typecheck
npm notice run tsc --noEmit
tests/acceptance/e2e-and-a11y.spec.ts(92,7): error TS2769: No overload matches this call.
  Overload 3 of 8, '(command: string, args?: readonly string[] | undefined, options?: SpawnSyncOptions | undefined): SpawnSyncReturns<string | NonSharedBuffer>', gave the following error.
    Property 'NODE_ENV' is missing in type 'Record<string, string>' but required in type 'ProcessEnv'.
tests/acceptance/e2e-and-a11y.spec.ts(100,7): error TS2769: No overload matches this call.
  Overload 3 of 8, '(command: string, args?: readonly string[] | undefined, options?: SpawnSyncOptions | undefined): SpawnSyncReturns<string | NonSharedBuffer>', gave the following error.
    Property 'NODE_ENV' is missing in type 'Record<string, string>' but required in type 'ProcessEnv'.
tests/acceptance/e2e-and-a11y.spec.ts(109,7): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Property 'NODE_ENV' is missing in type 'Record<string, string>' but required in type 'ProcessEnv'.
npm notice run samiti-management@0.1.0 build
npm notice run next build --webpack
▲ Next.js 16.4.6 (webpack)
✓ Running next.config.ts took 125ms

  Creating an optimized production build ...
✓ Compiled successfully in 7.5s
  Running TypeScript ...
tests/acceptance/e2e-and-a11y.spec.ts(92,7): error TS2769: No overload matches this call.
  Overload 3 of 8, '(command: string, args?: readonly string[] | undefined, options?: SpawnSyncOptions | undefined): SpawnSyncReturns<string | NonSharedBuffer>', gave the following error.
    Property 'NODE_ENV' is missing in type 'Record<string, string>' but required in type 'ProcessEnv'.
tests/acceptance/e2e-and-a11y.spec.ts(100,7): error TS2769: No overload matches this call.
  Overload 3 of 8, '(command: string, args?: readonly string[] | undefined, options?: SpawnSyncOptions | undefined): SpawnSyncReturns<string | NonSharedBuffer>', gave the following error.
    Property 'NODE_ENV' is missing in type 'Record<string, string>' but required in type 'ProcessEnv'.
tests/acceptance/e2e-and-a11y.spec.ts(109,7): error TS2769: No overload matches this call.
  The last overload gave the following error.
    Property 'NODE_ENV' is missing in type 'Record<string, string>' but required in type 'ProcessEnv'.
Failed to type check.
```

### Raw Security Audit & Semgrep Output (`G4`)

```text
> npm audit --audit-level=high
11 moderate severity vulnerabilities (0 high, 0 critical) — exit code 0

> semgrep scan --config p/typescript --config p/javascript --config p/nextjs src scripts
Ran 74 rules on 101 files: 0 findings. — exit code 0
```

### Raw Playwright UI & Accessibility Verification Output (`tests/e2e/ui-a11y.spec.ts`, against `next dev --webpack`)

```text
npm notice run samiti-management@0.1.0 npx
npm notice run playwright test tests/e2e/ui-a11y.spec.ts

Running 2 tests using 1 worker

  ok 1 [chromium] › tests\e2e\ui-a11y.spec.ts:126:3 › UI E2E & Accessibility Verification › completes full admin & member flow with zero axe violations and senior UX metrics (58.1s)
  ok 2 [mobile] › tests\e2e\ui-a11y.spec.ts:126:3 › UI E2E & Accessibility Verification › completes full admin & member flow with zero axe violations and senior UX metrics (53.0s)

  2 passed (2.5m)
```

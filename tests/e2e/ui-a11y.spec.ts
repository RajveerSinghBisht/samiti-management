import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { TOTP } from 'otpauth';

const E2E_PORT = 3101;
const BASE_URL = `http://localhost:${E2E_PORT}`;
const E2E_DB_DIR = path.resolve(process.cwd(), '.data', 'e2e-ui-pg');

const SHARED_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(E2E_PORT),
  DATABASE_URL: `pglite://${E2E_DB_DIR}`,
  SESSION_SECRET: 'e2e-session-secret-minimum-32-chars-long-001',
  PIN_PEPPER: 'e2e-pin-pepper-minimum-16-chars',
  TOTP_ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  CRON_SECRET: 'e2e-cron-secret-minimum-16-chars',
  APP_URL: BASE_URL,
  MESSAGING_PROVIDER: 'prepare',
  SEED_ADMIN_NAME: 'Chief Treasurer',
  SEED_ADMIN_MOBILE: '9999900001',
  SEED_ADMIN_PASSWORD: 'ChiefStrongPassword#2026',
};

let serverProc: ChildProcess | null = null;

async function waitForHealth(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Server did not become healthy in time');
}

async function assertAccessibilityAndSeniorUx(page: Page, routeName: string) {
  const axeResult = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(axeResult.violations, `Axe violations on ${routeName}`).toEqual([]);

  const metrics = await page.evaluate(() => {
    const bodySize = parseFloat(window.getComputedStyle(document.body).fontSize);
    const importantSizes = Array.from(
      document.querySelectorAll('[data-important-number="true"]')
    ).map((el) => parseFloat(window.getComputedStyle(el).fontSize));

    const interactive = Array.from(document.querySelectorAll('button, a'));
    const smallTargets: Array<{ tag: string; text: string; w: number; h: number }> = [];
    const iconOnlyButtons: Array<string> = [];

    for (const el of interactive) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      const text = (el as HTMLElement).innerText.trim();
      if (rect.width < 48 || rect.height < 48) {
        smallTargets.push({ tag: el.tagName, text, w: rect.width, h: rect.height });
      }
      if (el.tagName === 'BUTTON' && text.length === 0) {
        iconOnlyButtons.push(el.outerHTML.slice(0, 80));
      }
    }

    return { bodySize, importantSizes, smallTargets, iconOnlyButtons };
  });

  expect(metrics.bodySize, `Body font size on ${routeName}`).toBeGreaterThanOrEqual(18);
  for (const sz of metrics.importantSizes) {
    expect(sz, `Important number font size on ${routeName}`).toBeGreaterThanOrEqual(28);
  }
  expect(metrics.smallTargets, `Touch targets < 48px on ${routeName}`).toEqual([]);
  expect(metrics.iconOnlyButtons, `Icon-only buttons on ${routeName}`).toEqual([]);
}

test.describe('UI E2E & Accessibility Verification', () => {
  test.beforeAll(async () => {
    if (fs.existsSync(E2E_DB_DIR)) {
      fs.rmSync(E2E_DB_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(E2E_DB_DIR, { recursive: true });

    const tsxBin = path.resolve(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const migrateRun = spawnSync(process.execPath, [tsxBin, 'scripts/migrate.ts'], {
      env: SHARED_ENV,
      encoding: 'utf8',
    });
    if (migrateRun.status !== 0) {
      throw new Error(`Migration failed: ${migrateRun.stderr}\n${migrateRun.stdout}`);
    }

    const seedRun = spawnSync(process.execPath, [tsxBin, 'scripts/seed-admin.ts'], {
      env: SHARED_ENV,
      encoding: 'utf8',
    });
    if (seedRun.status !== 0) {
      throw new Error(`Seed failed: ${seedRun.stderr}\n${seedRun.stdout}`);
    }

    const nextBin = path.resolve(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
    serverProc = spawn(
      process.execPath,
      [nextBin, 'dev', '--webpack', '-p', String(E2E_PORT)],
      {
        env: SHARED_ENV,
        stdio: 'pipe',
      }
    );

    await waitForHealth();
  });

  test.afterAll(async () => {
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
  });

  test('completes full admin & member flow with zero axe violations and senior UX metrics', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto(`${BASE_URL}/login`);
    await assertAccessibilityAndSeniorUx(page, '/login');

    await page.goto(`${BASE_URL}/admin/login`);
    await page.getByLabel(/Mobile Number/i).fill('9999900001');
    await page.getByLabel(/Password/i).fill('ChiefStrongPassword#2026');
    await page.getByRole('button', { name: /Admin Sign In/i }).click();

    await page.waitForURL('**/admin/setup-totp');
    const secretText = (
      await page.locator('[data-testid="totp-manual-secret"]').innerText()
    ).trim();
    const admin1Totp = new TOTP({ secret: secretText }).generate();

    await page.getByLabel(/6-digit code/i).fill(admin1Totp);
    await page.getByRole('button', { name: /Verify and Enable Authenticator/i }).click();

    await expect(page.locator('[data-testid="recovery-codes"]')).toBeVisible();
    await page.getByRole('link', { name: /Continue to Admin Dashboard/i }).click();
    await page.waitForURL('**/admin');

    await page.goto(`${BASE_URL}/admin/cycle`);
    await page.getByLabel(/Cycle Name/i).fill('Samiti 2026');
    await page.getByLabel(/Start Date/i).fill('2026-10-01');
    await page.getByLabel(/Length/i).selectOption('12');
    await page.getByLabel(/Monthly Contribution/i).fill('1000');
    await page.getByLabel(/Interest Rate/i).fill('3');
    await page.getByRole('button', { name: /Create Cycle/i }).click();
    await expect(page.getByText(/Samiti 2026/i)).toBeVisible();

    await page.goto(`${BASE_URL}/admin/members`);
    await page.getByLabel(/Full Name/i).fill('Second Treasurer');
    await page.getByLabel(/Mobile Number/i).fill('9999900002');
    await page.getByLabel(/Role/i).selectOption('ADMIN');
    await page.getByLabel(/Initial PIN or Password/i).fill('SecondStrongPassword#2026');
    await page.getByRole('button', { name: /Add Member/i }).click();
    await expect(page.getByText('Second Treasurer')).toBeVisible();

    await page.getByLabel(/Full Name/i).fill('Ramesh Kumar');
    await page.getByLabel(/Mobile Number/i).fill('9811111111');
    await page.getByLabel(/Role/i).selectOption('MEMBER');
    await page.getByLabel(/Initial PIN or Password/i).fill('1234');
    await page.getByRole('button', { name: /Add Member/i }).click();
    await expect(page.getByText('Ramesh Kumar')).toBeVisible();

    await page.getByLabel(/Full Name/i).fill('Sunita Sharma');
    await page.getByLabel(/Mobile Number/i).fill('9822222222');
    await page.getByLabel(/Role/i).selectOption('MEMBER');
    await page.getByLabel(/Initial PIN or Password/i).fill('5678');
    await page.getByRole('button', { name: /Add Member/i }).click();
    await expect(page.getByText('Sunita Sharma')).toBeVisible();

    await page.goto(`${BASE_URL}/admin/contributions`);
    await page.getByTestId('record-contrib-9811111111').click();
    await expect(page.getByTestId('money-confirmation')).toContainText('Ramesh Kumar');
    await expect(page.getByTestId('money-confirmation')).toContainText('₹1,000');
    await page.getByRole('button', { name: /Confirm and Save/i }).click();
    await expect(page.getByTestId('contrib-status-9811111111')).toContainText(/Paid/i);

    await page.getByTestId('record-contrib-9822222222').click();
    await expect(page.getByTestId('money-confirmation')).toContainText('Sunita Sharma');
    await page.getByRole('button', { name: /Confirm and Save/i }).click();
    await expect(page.getByTestId('contrib-status-9822222222')).toContainText(/Paid/i);

    await page.goto(`${BASE_URL}/admin/meetings`);
    await page.getByLabel(/Meeting Date/i).fill('2026-11-15');
    await page.getByLabel(/Place/i).fill('Sharma Residence, Sector 7');
    await page.getByRole('button', { name: /Schedule Meeting/i }).click();
    await expect(page.getByText('Sharma Residence, Sector 7')).toBeVisible();

    await page.goto(`${BASE_URL}/admin/loans`);
    await page.getByLabel(/Member/i).selectOption({ label: 'Ramesh Kumar (9811111111)' });
    await page.getByLabel(/Loan Principal/i).fill('1500');
    await page.getByLabel(/Disbursement Date/i).fill('2026-10-10');
    await page.getByRole('button', { name: /Review Loan Request/i }).click();
    await expect(page.getByTestId('money-confirmation')).toContainText('Ramesh Kumar');
    await expect(page.getByTestId('money-confirmation')).toContainText('₹1,500');
    await page.getByRole('button', { name: /Confirm and Save/i }).click();
    await expect(page.getByText(/Pending Approval/i)).toBeVisible();

    await page.getByRole('button', { name: /Sign Out/i }).click();
    await page.waitForURL('**/login');

    await page.goto(`${BASE_URL}/admin/login`);
    await page.getByLabel(/Mobile Number/i).fill('9999900002');
    await page.getByLabel(/Password/i).fill('SecondStrongPassword#2026');
    await page.getByRole('button', { name: /Admin Sign In/i }).click();

    await page.waitForURL('**/admin/setup-totp');
    const secret2 = (await page.locator('[data-testid="totp-manual-secret"]').innerText()).trim();
    const admin2Totp = new TOTP({ secret: secret2 }).generate();
    await page.getByLabel(/6-digit code/i).fill(admin2Totp);
    await page.getByRole('button', { name: /Verify and Enable Authenticator/i }).click();
    await page.getByRole('link', { name: /Continue to Admin Dashboard/i }).click();

    await page.goto(`${BASE_URL}/admin/approvals`);
    await page.getByRole('button', { name: /^Approve$/i }).first().click();
    await expect(page.getByText(/Approved/i)).toBeVisible();

    await page.goto(`${BASE_URL}/admin/loans`);
    await page.getByRole('button', { name: /Record Repayment/i }).first().click();
    await page.getByLabel(/Repayment Amount/i).fill('500');
    await page.getByLabel(/Repayment Date/i).fill('2026-10-10');
    await page.getByRole('button', { name: /Review Repayment/i }).click();
    await expect(page.getByTestId('money-confirmation')).toContainText('₹500');
    await page.getByRole('button', { name: /Confirm and Save/i }).click();
    await expect(page.getByText(/Repayment recorded/i)).toBeVisible();

    await page.getByRole('button', { name: /Sign Out/i }).click();

    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel(/Mobile Number/i).fill('9811111111');
    await page.getByLabel(/PIN/i).fill('1234');
    await page.getByRole('button', { name: /Sign In/i }).click();

    await page.waitForURL('**/home');
    await expect(page.getByText('Ramesh Kumar')).toBeVisible();
    await expect(page.getByText('Sunita Sharma')).toHaveCount(0);
    await assertAccessibilityAndSeniorUx(page, '/home');

    await page.getByRole('link', { name: /My Loan/i }).click();
    await page.waitForURL('**/my-loan');
    await expect(page.getByText('₹1,000')).toBeVisible();
    await assertAccessibilityAndSeniorUx(page, '/my-loan');

    await page.goto(`${BASE_URL}/home`);
    await page.getByRole('link', { name: /My Savings/i }).click();
    await page.waitForURL('**/my-savings');
    await expect(page.getByTestId('printable-statement')).toBeVisible();
    await expect(page.getByTestId('printable-statement')).toContainText('₹1,000');
    await assertAccessibilityAndSeniorUx(page, '/my-savings');

    await page.goto(`${BASE_URL}/home`);
    await page.getByRole('link', { name: /Meetings/i }).click();
    await page.waitForURL('**/meetings');
    await expect(page.getByText('Sharma Residence, Sector 7')).toBeVisible();
    await expect(page.getByText('15 November 2026')).toBeVisible();
    await assertAccessibilityAndSeniorUx(page, '/meetings');

    await page.getByTestId('language-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
    await expect(page.getByRole('link', { name: /होम|मुख्य/i })).toBeVisible();
    await page.getByTestId('language-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});


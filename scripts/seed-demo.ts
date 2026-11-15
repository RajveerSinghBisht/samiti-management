import fs from 'node:fs';
import path from 'node:path';
import { applyMigrations, closeDb, getDb, members, cycles, cycleMembers, contributionSchedule, meetings, loans } from '../src/db';
import { encryptTotpSecret, hashPassword, hashPin } from '../src/lib/auth/crypto';
import { getEnv } from '../src/lib/env';
import { appendLedgerEntry } from '../src/lib/services/ledger';
import { addMonthsIst } from '../src/lib/dates';
import { formatPaiseToInr } from '../src/lib/money';

// Ensure required environment variables for standalone script execution
if (!process.env.DATABASE_URL) {
  const envLocalPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envLocalPath)) {
    const envContent = fs.readFileSync(envLocalPath, 'utf8');
    const match = envContent.match(/DATABASE_URL=["']?([^"'\r\n]+)["']?/);
    if (match) process.env.DATABASE_URL = match[1];
  }
}
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ||
    'postgresql://samiti_owner:samiti_owner_secret@127.0.0.1:5432/samiti_test';
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'demo-session-secret-at-least-32-chars-long-001';
}
if (!process.env.PIN_PEPPER) {
  process.env.PIN_PEPPER = 'demo-pin-pepper-minimum-16-chars';
}
if (!process.env.TOTP_ENCRYPTION_KEY) {
  process.env.TOTP_ENCRYPTION_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
}
if (!process.env.CRON_SECRET) {
  process.env.CRON_SECRET = 'demo-cron-secret-minimum-16-chars';
}
if (!process.env.APP_URL) {
  process.env.APP_URL = 'http://localhost:3000';
}

const INDIAN_NAMES = [
  'Ramesh Patel', 'Suresh Kumar', 'Kishore Shah', 'Dinesh Mehta', 'Mahesh Joshi',
  'Rajesh Sharma', 'Bharat Desai', 'Pravin Verma', 'Mukesh Trivedi', 'Jayesh Dave',
  'Ashok Parikh', 'Chandresh Vyas', 'Haresh Bhatt', 'Kamlesh Pandya', 'Narendra Raval',
  'Bhupendra Shukla', 'Girish Pathak', 'Hasmukh Panchal', 'Jagdish Soni', 'Kanti Mistry',
  'Manish Vora', 'Naresh Kothari', 'Pankaj Sheth', 'Raman Modi', 'Shailesh Gandhi',
  'Sunita Patel', 'Kanta Ben', 'Anandi Ben', 'Geeta Sharma', 'Hansha Joshi',
  'Kokila Mehta', 'Bhavna Shah', 'Rekha Desai', 'Usha Trivedi', 'Meena Dave',
  'Sudha Parikh', 'Tara Vyas', 'Daksha Bhatt', 'Ila Pandya', 'Jayshree Raval',
  'Kalpana Shukla', 'Lata Pathak', 'Manjula Panchal', 'Nirmala Soni', 'Pragna Mistry',
  'Pushpa Vora', 'Saroj Kothari', 'Sharda Sheth', 'Varsha Modi', 'Vimla Gandhi'
];

async function seedDemo() {
  await applyMigrations(process.env.DATABASE_URL!);
  const env = getEnv();
  const db = getDb();
  console.log('Seeding Samiti Demo Database...');

  // 1. Create Admins
  const adminPasswordHash = await hashPassword('AdminPass123#2026', env.PIN_PEPPER);
  const encryptedTotp = encryptTotpSecret('JBSWY3DPEHPK3PXP', env.TOTP_ENCRYPTION_KEY);

  const [admin1] = await db
    .insert(members)
    .values({
      name: 'Ramesh Patel (Admin)',
      mobile: '9820099001',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: adminPasswordHash,
      totpSecretEncrypted: encryptedTotp,
      totpEnabled: true,
      mustChangePin: false,
    })
    .returning();

  const [admin2] = await db
    .insert(members)
    .values({
      name: 'Suresh Kumar (Admin)',
      mobile: '9820099002',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: adminPasswordHash,
      totpSecretEncrypted: encryptedTotp,
      totpEnabled: true,
      mustChangePin: false,
    })
    .returning();

  if (!admin1 || !admin2) throw new Error('Failed to create admins');
  console.log(`Created Admins: ${admin1.name} (9820099001), ${admin2.name} (9820099002)`);

  // 2. Create 50 Regular Members
  const seededMembers: Array<{ id: string; name: string; mobile: string }> = [];
  const defaultPinHash = await hashPin('123456', env.PIN_PEPPER);

  for (const [i, name] of INDIAN_NAMES.entries()) {
    const mobile = `98200${String(i + 1).padStart(5, '0')}`;
    const [inserted] = await db
      .insert(members)
      .values({
        name,
        mobile,
        role: 'MEMBER',
        status: 'ACTIVE',
        pinHash: defaultPinHash,
        mustChangePin: false,
        totpEnabled: false,
      })
      .returning({ id: members.id, name: members.name, mobile: members.mobile });
    if (inserted) seededMembers.push(inserted);
  }
  console.log(`Seeded ${seededMembers.length} members with default PIN 123456`);

  // 3. Create Cycle
  const [cycle] = await db
    .insert(cycles)
    .values({
      name: 'Samiti Demo Cycle 2026-2027',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      lengthMonths: 12,
      monthlyContributionPaise: 100000, // Rs 1,000
      interestRateBps: 100, // 1% per month
      interestMode: 'REDUCING_BALANCE',
      interestSharingMode: 'EQUAL',
      rotationPayoutEnabled: false,
      normalLoanCapPaise: 5000000, // Rs 50,000
      emergencyLoanCapPaise: 10000000, // Rs 1,00,000
      lateRuleMode: 'NONE',
      lateRuleValue: 0,
      createdByAdminId: admin1.id,
      status: 'ACTIVE',
    })
    .returning();

  if (!cycle) throw new Error('Failed to create cycle');
  console.log(`Created Active Cycle: ${cycle.name}`);

  // 4. Enroll all 50 members and create contribution schedule
  let orderIndex = 0;
  for (const mem of seededMembers) {
    orderIndex++;
    await db.insert(cycleMembers).values({
      cycleId: cycle.id,
      memberId: mem.id,
      joinedMonthIndex: 1,
      rotationOrder: orderIndex,
      status: 'ACTIVE',
    });

    const scheduleRows = [];
    for (let m = 1; m <= 12; m++) {
      scheduleRows.push({
        cycleId: cycle.id,
        memberId: mem.id,
        monthIndex: m,
        dueDate: addMonthsIst(cycle.startDate, m - 1),
        expectedAmountPaise: cycle.monthlyContributionPaise,
        status: 'PENDING' as const,
      });
    }
    await db.insert(contributionSchedule).values(scheduleRows);
  }
  console.log(`Enrolled all members with 12-month schedules.`);

  // 5. Conduct Meeting 1: Jan 10, 2026
  const mem1 = seededMembers[0]!;
  const mem2 = seededMembers[1]!;
  const [m1] = await db
    .insert(meetings)
    .values({
      cycleId: cycle.id,
      meetingDate: '2026-01-10',
      place: "Ramesh Patel's Home",
      hostMemberId: mem1.id,
      notes: 'First meeting of the cycle. All members attended.',
      status: 'CLOSED',
      createdByAdminId: admin1.id,
    })
    .returning();

  if (!m1) throw new Error('Failed to create meeting 1');

  // Jan contributions for all 50 members
  for (const m of seededMembers) {
    await appendLedgerEntry({
      cycleId: cycle.id,
      memberId: m.id,
      loanId: null,
      entryType: 'CONTRIBUTION',
      amountPaise: 100000,
      effectiveDate: '2026-01-10',
      monthIndex: 1,
      createdByAdminId: admin1.id,
      reason: 'Jan 2026 contribution',
    }, db);
  }

  // Loan 1 disbursed to Member 1: Rs 20,000 (2,000,000 paise)
  const [loan1] = await db
    .insert(loans)
    .values({
      cycleId: cycle.id,
      memberId: mem1.id,
      principalPaise: 2000000,
      interestRateBps: 100,
      interestMode: 'REDUCING_BALANCE',
      repaymentMode: 'MONTHLY_INSTALLMENTS',
      termMonths: 12,
      disbursedDate: '2026-01-10',
      dueDate: '2026-02-10',
      status: 'ACTIVE',
      requestedByAdminId: admin1.id,
      approvedByAdminId: admin2.id,
      note: 'Loan for home renovation',
    })
    .returning();

  if (loan1) {
    await appendLedgerEntry({
      cycleId: cycle.id,
      memberId: mem1.id,
      loanId: loan1.id,
      entryType: 'LOAN_DISBURSEMENT',
      amountPaise: 2000000,
      effectiveDate: '2026-01-10',
      createdByAdminId: admin1.id,
      reason: 'Loan disbursement to Ramesh Patel',
    }, db);
  }

  // Bank interest Jan
  await appendLedgerEntry({
    cycleId: cycle.id,
    memberId: null,
    loanId: null,
    entryType: 'BANK_INTEREST',
    amountPaise: 15000, // Rs 150
    effectiveDate: '2026-01-10',
    createdByAdminId: admin1.id,
    reason: 'Jan bank savings interest',
  }, db);

  console.log('Meeting 1 (Jan 2026) recorded: Rs 50,000 contributions, Rs 20,000 loan, Rs 150 bank interest.');

  // 6. Conduct Meeting 2: Feb 10, 2026
  const [m2] = await db
    .insert(meetings)
    .values({
      cycleId: cycle.id,
      meetingDate: '2026-02-10',
      place: "Suresh Kumar's Home",
      hostMemberId: mem2.id,
      notes: 'Feb meeting. Member 1 made first loan repayment.',
      status: 'CLOSED',
      createdByAdminId: admin1.id,
    })
    .returning();

  if (!m2) throw new Error('Failed to create meeting 2');

  // Feb contributions for all 50 members
  for (const m of seededMembers) {
    await appendLedgerEntry({
      cycleId: cycle.id,
      memberId: m.id,
      loanId: null,
      entryType: 'CONTRIBUTION',
      amountPaise: 100000,
      effectiveDate: '2026-02-10',
      monthIndex: 2,
      createdByAdminId: admin1.id,
      reason: 'Feb 2026 contribution',
    }, db);
  }

  // Loan 1 Repayment at Meeting 2:
  // Rule 4: Interest due = 1% on Rs 20,000 = Rs 200 (20,000 paise)
  // Principal repaid: Rs 5,000 (500,000 paise)
  if (loan1) {
    await appendLedgerEntry({
      cycleId: cycle.id,
      memberId: mem1.id,
      loanId: loan1.id,
      entryType: 'REPAYMENT_INTEREST',
      amountPaise: 20000,
      effectiveDate: '2026-02-10',
      createdByAdminId: admin1.id,
      reason: 'Feb loan interest payment',
    }, db);

    await appendLedgerEntry({
      cycleId: cycle.id,
      memberId: mem1.id,
      loanId: loan1.id,
      entryType: 'REPAYMENT_PRINCIPAL',
      amountPaise: 500000,
      effectiveDate: '2026-02-10',
      createdByAdminId: admin1.id,
      reason: 'Feb loan principal repayment',
    }, db);
  }

  // Loan 2 disbursed to Member 2: Rs 10,000 (1,000,000 paise)
  const [loan2] = await db
    .insert(loans)
    .values({
      cycleId: cycle.id,
      memberId: mem2.id,
      principalPaise: 1000000,
      interestRateBps: 100,
      interestMode: 'REDUCING_BALANCE',
      repaymentMode: 'MONTHLY_INSTALLMENTS',
      termMonths: 6,
      disbursedDate: '2026-02-10',
      dueDate: '2026-03-10',
      status: 'ACTIVE',
      requestedByAdminId: admin1.id,
      approvedByAdminId: admin2.id,
      note: 'Small business loan',
    })
    .returning();

  if (loan2) {
    await appendLedgerEntry({
      cycleId: cycle.id,
      memberId: mem2.id,
      loanId: loan2.id,
      entryType: 'LOAN_DISBURSEMENT',
      amountPaise: 1000000,
      effectiveDate: '2026-02-10',
      createdByAdminId: admin1.id,
      reason: 'Loan disbursement to Suresh Kumar',
    }, db);
  }

  // Bank interest Feb
  await appendLedgerEntry({
    cycleId: cycle.id,
    memberId: null,
    loanId: null,
    entryType: 'BANK_INTEREST',
    amountPaise: 20000, // Rs 200
    effectiveDate: '2026-02-10',
    createdByAdminId: admin1.id,
    reason: 'Feb bank interest',
  }, db);

  console.log('Meeting 2 (Feb 2026) recorded: Rs 50,000 contributions, Rs 200 interest, Rs 5,000 principal repaid, Rs 10,000 loan 2, Rs 200 bank interest.');

  // 7. Conduct Meeting 3: Mar 10, 2026
  const mem3 = seededMembers[2]!;
  const [m3] = await db
    .insert(meetings)
    .values({
      cycleId: cycle.id,
      meetingDate: '2026-03-10',
      place: "Kanta Ben's Home",
      hostMemberId: mem3.id,
      notes: 'March meeting. Good Cause Grant approved for village library.',
      status: 'CLOSED',
      createdByAdminId: admin1.id,
    })
    .returning();

  if (!m3) throw new Error('Failed to create meeting 3');

  // Attendance & Mar contributions: 48 members paid, 2 members unpaid
  let memberIdx = 0;
  for (const m of seededMembers) {
    memberIdx++;
    const isPresent = memberIdx <= 48; // 2 members absent & unpaid
    if (isPresent) {
      await appendLedgerEntry({
        cycleId: cycle.id,
        memberId: m.id,
        loanId: null,
        entryType: 'CONTRIBUTION',
        amountPaise: 100000,
        effectiveDate: '2026-03-10',
        monthIndex: 3,
        createdByAdminId: admin1.id,
        reason: 'Mar 2026 contribution',
      }, db);
    }
  }

  // Member 1 pays interest on remaining Rs 15,000: 1% = Rs 150 (15,000 paise)
  if (loan1) {
    await appendLedgerEntry({
      cycleId: cycle.id,
      memberId: mem1.id,
      loanId: loan1.id,
      entryType: 'REPAYMENT_INTEREST',
      amountPaise: 15000,
      effectiveDate: '2026-03-10',
      createdByAdminId: admin1.id,
      reason: 'Mar loan interest payment',
    }, db);
  }

  // Member 2 pays interest on Rs 10,000: 1% = Rs 100 (10,000 paise)
  if (loan2) {
    await appendLedgerEntry({
      cycleId: cycle.id,
      memberId: mem2.id,
      loanId: loan2.id,
      entryType: 'REPAYMENT_INTEREST',
      amountPaise: 10000,
      effectiveDate: '2026-03-10',
      createdByAdminId: admin1.id,
      reason: 'Mar loan interest payment',
    }, db);
  }

  // Good Cause Grant: Rs 500 (50,000 paise) to Village Library
  await appendLedgerEntry({
    cycleId: cycle.id,
    memberId: null,
    loanId: null,
    entryType: 'GOOD_CAUSE_GRANT',
    amountPaise: 50000, // Rs 500
    effectiveDate: '2026-03-10',
    createdByAdminId: admin1.id,
    reason: 'Good Cause Grant: Village Primary School Library Books',
  }, db);

  // Bank interest Mar
  await appendLedgerEntry({
    cycleId: cycle.id,
    memberId: null,
    loanId: null,
    entryType: 'BANK_INTEREST',
    amountPaise: 18000, // Rs 180
    effectiveDate: '2026-03-10',
    createdByAdminId: admin1.id,
    reason: 'Mar bank interest',
  }, db);

  console.log('Meeting 3 (Mar 2026) recorded: Rs 48,000 contributions, Rs 250 loan interest, Rs 500 Good Cause Grant, Rs 180 bank interest.');

  // Summary
  console.log('\n=============================================');
  console.log('SAMITI DEMO SEED COMPLETED SUCCESSFULLY!');
  console.log('=============================================');
  console.log('Admins:');
  console.log('  1. Ramesh Patel: Mobile 9820099001, Password AdminPass123#2026, TOTP JBSWY3DPEHPK3PXP');
  console.log('  2. Suresh Kumar: Mobile 9820099002, Password AdminPass123#2026, TOTP JBSWY3DPEHPK3PXP');
  console.log('\nMembers:');
  console.log('  50 Members seeded (Mobiles 9820000001 through 9820000050, PIN 123456)');
  console.log('\nFinancial Summary across 3 Meetings:');
  console.log('  Contributions Collected: ' + formatPaiseToInr(14800000));
  console.log('  Loans Disbursed:         ' + formatPaiseToInr(3000000));
  console.log('  Principal Repaid:        ' + formatPaiseToInr(500000));
  console.log('  Interest Collected:      ' + formatPaiseToInr(45000));
  console.log('  Bank Interest:           ' + formatPaiseToInr(53000));
  console.log('  Good Cause Grant:        ' + formatPaiseToInr(50000));
  console.log('=============================================\n');

  await closeDb();
}

seedDemo().catch(async (err) => {
  console.error('Seed Demo failed:', err);
  await closeDb();
  process.exit(1);
});

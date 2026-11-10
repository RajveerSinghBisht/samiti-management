import { afterEach, describe, expect, it } from 'vitest';
import { createIsolatedTestDb, rawExecuteSql, type TestDbHandle } from './helpers';
import { appendLedgerEntry, getCycleLedgerEntries, reverseLedgerEntry } from '@/lib/services/ledger';
import { calculateMemberSavings } from '@/lib/calc';
import { seedFirstAdmin } from '@/lib/auth/seed';
import { createCycle } from '@/lib/services/cycles';
import { createMember } from '@/lib/services/members';

describe('G6 & Append-Only Ledger Immutability', () => {
  let dbHandle: TestDbHandle | null = null;

  afterEach(async () => {
    if (dbHandle) {
      await dbHandle.cleanup();
      dbHandle = null;
    }
  });

  it('applies migrations on an empty database and rejects UPDATE, DELETE, and TRUNCATE on ledger_entries at DB level', async () => {
    dbHandle = await createIsolatedTestDb('ledger-immutability');

    const admin = await seedFirstAdmin({
      name: 'Chief Admin',
      mobile: '9876543210',
      password: 'VeryStrongAdminPassword#123',
    });

    const cycle = await createCycle({
      name: 'Cycle 2026',
      startDate: '2026-01-01',
      lengthMonths: 12,
      monthlyContributionPaise: 100_000,
      interestRateBps: 300,
      interestMode: 'REDUCING_BALANCE',
      interestSharingMode: 'PROPORTIONAL_CONTRIBUTION',
      rotationPayoutEnabled: false,
      adminId: admin.id,
    });

    const member = await createMember({
      name: 'Ramesh Sharma',
      mobile: '9876500001',
      role: 'MEMBER',
      initialSecret: '4321',
      adminId: admin.id,
    });

    const entry = await appendLedgerEntry({
      cycleId: cycle.id,
      memberId: member.id,
      loanId: null,
      entryType: 'CONTRIBUTION',
      amountPaise: 100_000,
      effectiveDate: '2026-01-05',
      monthIndex: 1,
      reason: 'January contribution',
      createdByAdminId: admin.id,
    });

    // Database-level UPDATE MUST fail
    await expect(
      rawExecuteSql(
        dbHandle.databaseUrl,
        `UPDATE ledger_entries SET amount_paise = 999999 WHERE id = '${entry.id}'`
      )
    ).rejects.toThrow();

    // Database-level DELETE MUST fail
    await expect(
      rawExecuteSql(
        dbHandle.databaseUrl,
        `DELETE FROM ledger_entries WHERE id = '${entry.id}'`
      )
    ).rejects.toThrow();

    // Database-level TRUNCATE MUST fail
    await expect(
      rawExecuteSql(dbHandle.databaseUrl, `TRUNCATE TABLE ledger_entries`)
    ).rejects.toThrow();

    // Verify original entry is intact and reversal restores exact prior balance
    const beforeReversal = await getCycleLedgerEntries(cycle.id);
    expect(calculateMemberSavings(beforeReversal, member.id).totalContributedPaise).toBe(100_000);

    const reversal = await reverseLedgerEntry({
      ledgerEntryId: entry.id,
      reason: 'Wrong member selected',
      adminId: admin.id,
    });
    expect(reversal.reversalEntry.entryType).toBe('REVERSAL');
    expect(reversal.reversalEntry.reversesEntryId).toBe(entry.id);

    const afterReversal = await getCycleLedgerEntries(cycle.id);
    expect(afterReversal).toHaveLength(2);
    expect(calculateMemberSavings(afterReversal, member.id).totalContributedPaise).toBe(0);
  });
});


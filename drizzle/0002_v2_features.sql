-- Samiti Management System V2 Schema Enhancements

-- 1. Cycles enhancements & zero-deletion trigger
ALTER TABLE cycles DROP CONSTRAINT IF EXISTS cycles_status_check;
ALTER TABLE cycles ADD CONSTRAINT cycles_status_check CHECK (status IN ('ACTIVE', 'CLOSED', 'PENDING_SECOND_ADMIN_APPROVAL'));
ALTER TABLE cycles ADD COLUMN IF NOT EXISTS end_date text;
ALTER TABLE cycles ADD COLUMN IF NOT EXISTS normal_loan_cap_paise integer NOT NULL DEFAULT 5000000;
ALTER TABLE cycles ADD COLUMN IF NOT EXISTS emergency_loan_cap_paise integer NOT NULL DEFAULT 10000000;
ALTER TABLE cycles ADD COLUMN IF NOT EXISTS meeting_day_of_month integer NOT NULL DEFAULT 10;
ALTER TABLE cycles ADD COLUMN IF NOT EXISTS review_summary text;

CREATE OR REPLACE FUNCTION prevent_cycle_deletion()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Cycle deletion is strictly prohibited by Samiti rules'
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_cycle_deletion ON cycles;
CREATE TRIGGER trg_prevent_cycle_deletion
BEFORE DELETE ON cycles
FOR EACH ROW
EXECUTE FUNCTION prevent_cycle_deletion();

-- 2. Loans per-loan terms & emergency cap fields
ALTER TABLE loans ADD COLUMN IF NOT EXISTS repayment_mode text NOT NULL DEFAULT 'MONTHLY_INSTALLMENTS';
ALTER TABLE loans ADD COLUMN IF NOT EXISTS term_months integer;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS due_date text;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS is_emergency boolean NOT NULL DEFAULT false;
ALTER TABLE loans ADD COLUMN IF NOT EXISTS emergency_reason text;

-- 3. Meetings status & closing fields
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS summary_note text;
ALTER TABLE meetings ADD COLUMN IF NOT EXISTS closed_at timestamp with time zone;

-- 4. Update entry_type and action_type checks and ledger_entries.id type
DROP VIEW IF EXISTS member_cycle_balances_view;
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_reverses_entry_id_fkey;
ALTER TABLE ledger_entries ALTER COLUMN id TYPE text;
ALTER TABLE ledger_entries ALTER COLUMN reverses_entry_id TYPE text;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_reverses_entry_id_fkey FOREIGN KEY (reverses_entry_id) REFERENCES ledger_entries(id);

CREATE OR REPLACE VIEW member_cycle_balances_view AS
WITH active_entries AS (
  SELECT le.*
  FROM ledger_entries le
  WHERE le.entry_type <> 'REVERSAL'
    AND NOT EXISTS (
      SELECT 1 FROM ledger_entries rev
      WHERE rev.entry_type = 'REVERSAL' AND rev.reverses_entry_id = le.id
    )
)
SELECT
  cycle_id,
  member_id,
  COALESCE(SUM(CASE WHEN entry_type = 'CONTRIBUTION' THEN amount_paise ELSE 0 END), 0)::bigint AS total_contributed_paise,
  COALESCE(SUM(CASE WHEN entry_type = 'LOAN_DISBURSEMENT' THEN amount_paise ELSE 0 END), 0)::bigint AS total_loan_disbursed_paise,
  COALESCE(SUM(CASE WHEN entry_type = 'REPAYMENT_PRINCIPAL' THEN amount_paise ELSE 0 END), 0)::bigint AS total_principal_repaid_paise,
  COALESCE(SUM(CASE WHEN entry_type = 'REPAYMENT_INTEREST' THEN amount_paise ELSE 0 END), 0)::bigint AS total_interest_repaid_paise,
  COALESCE(SUM(CASE WHEN entry_type = 'SHARE_PAYOUT' THEN amount_paise ELSE 0 END), 0)::bigint AS total_share_payout_paise,
  COALESCE(SUM(CASE WHEN entry_type = 'ROTATION_PAYOUT' THEN amount_paise ELSE 0 END), 0)::bigint AS total_rotation_payout_paise
FROM active_entries
GROUP BY cycle_id, member_id;

ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
  'CONTRIBUTION',
  'LOAN_DISBURSEMENT',
  'REPAYMENT_PRINCIPAL',
  'REPAYMENT_INTEREST',
  'INTEREST_ACCRUAL',
  'ROTATION_PAYOUT',
  'SHARE_PAYOUT',
  'REVERSAL',
  'GOOD_CAUSE_GRANT',
  'BANK_INTEREST'
));

ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_action_type_check;
ALTER TABLE approvals ADD CONSTRAINT approvals_action_type_check CHECK (action_type IN (
  'LOAN_APPROVAL',
  'CYCLE_CLOSE',
  'HIGH_VALUE_REVERSAL',
  'CYCLE_ACTIVATION',
  'GOOD_CAUSE_GRANT',
  'EMERGENCY_LOAN'
));

-- 5. Role privileges: Enforce that samiti_app has NO UPDATE, DELETE, or TRUNCATE on ledger_entries or audit_events
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'samiti_app') THEN
    GRANT USAGE ON SCHEMA public TO samiti_app;
    GRANT SELECT, INSERT ON ledger_entries, audit_events TO samiti_app;
    REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries, audit_events FROM samiti_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON members, cycles, cycle_members, contribution_schedule, loans, approvals, meetings, message_logs, settings, sessions TO samiti_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO samiti_app;
  END IF;
END
$$;

-- Built-in gen_random_uuid() is native in PostgreSQL 13+ (no extension required)

CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mobile text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE')),
  pin_hash text,
  password_hash text,
  must_change_pin boolean NOT NULL DEFAULT false,
  failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until timestamptz,
  totp_secret_encrypted text,
  totp_pending_secret_encrypted text,
  totp_enabled boolean NOT NULL DEFAULT false,
  recovery_codes_hashes jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  start_date text NOT NULL,
  length_months integer NOT NULL CHECK (length_months > 0),
  monthly_contribution_paise integer NOT NULL CHECK (monthly_contribution_paise > 0),
  interest_rate_bps integer NOT NULL CHECK (interest_rate_bps >= 0),
  interest_mode text NOT NULL CHECK (interest_mode IN ('REDUCING_BALANCE', 'FLAT')),
  interest_sharing_mode text NOT NULL CHECK (interest_sharing_mode IN ('PROPORTIONAL_CONTRIBUTION', 'EQUAL')),
  rotation_payout_enabled boolean NOT NULL DEFAULT false,
  late_rule_mode text NOT NULL DEFAULT 'NONE' CHECK (late_rule_mode IN ('NONE', 'FIXED_PAISA', 'PERCENT_BPS')),
  late_rule_value integer NOT NULL DEFAULT 0 CHECK (late_rule_value >= 0),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED')),
  closed_at timestamptz,
  created_by_admin_id uuid NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cycle_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  member_id uuid NOT NULL REFERENCES members(id),
  joined_month_index integer NOT NULL DEFAULT 1 CHECK (joined_month_index >= 1),
  left_month_index integer CHECK (left_month_index IS NULL OR left_month_index >= joined_month_index),
  rotation_order integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LEFT')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cycle_members_cycle_member ON cycle_members (cycle_id, member_id);

CREATE TABLE IF NOT EXISTS contribution_schedule (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  member_id uuid NOT NULL REFERENCES members(id),
  month_index integer NOT NULL CHECK (month_index >= 1),
  due_date text NOT NULL,
  expected_amount_paise integer NOT NULL CHECK (expected_amount_paise > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'SKIPPED')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contrib_schedule_cycle_member_month ON contribution_schedule (cycle_id, member_id, month_index);

CREATE TABLE IF NOT EXISTS loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  member_id uuid NOT NULL REFERENCES members(id),
  principal_paise integer NOT NULL CHECK (principal_paise > 0),
  interest_rate_bps integer NOT NULL CHECK (interest_rate_bps >= 0),
  interest_mode text NOT NULL CHECK (interest_mode IN ('REDUCING_BALANCE', 'FLAT')),
  disbursed_date text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_APPROVAL' CHECK (status IN ('PENDING_APPROVAL', 'ACTIVE', 'CLOSED', 'REJECTED')),
  note text,
  requested_by_admin_id uuid NOT NULL REFERENCES members(id),
  approved_by_admin_id uuid REFERENCES members(id),
  approval_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  member_id uuid REFERENCES members(id),
  loan_id uuid REFERENCES loans(id),
  entry_type text NOT NULL CHECK (entry_type IN (
    'CONTRIBUTION',
    'LOAN_DISBURSEMENT',
    'REPAYMENT_PRINCIPAL',
    'REPAYMENT_INTEREST',
    'INTEREST_ACCRUAL',
    'ROTATION_PAYOUT',
    'SHARE_PAYOUT',
    'REVERSAL'
  )),
  amount_paise integer NOT NULL CHECK (amount_paise > 0),
  effective_date text NOT NULL,
  month_index integer,
  reverses_entry_id uuid REFERENCES ledger_entries(id),
  reason text,
  idempotency_key text,
  created_by_admin_id uuid NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (entry_type = 'REVERSAL' AND reverses_entry_id IS NOT NULL)
    OR (entry_type <> 'REVERSAL' AND reverses_entry_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_reverses_entry_id ON ledger_entries (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_idempotency_key ON ledger_entries (idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  action_type text NOT NULL CHECK (action_type IN ('LOAN_APPROVAL', 'CYCLE_CLOSE', 'HIGH_VALUE_REVERSAL')),
  target_id uuid NOT NULL,
  amount_paise integer NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  payload_json jsonb NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  requested_by_admin_id uuid NOT NULL REFERENCES members(id),
  decided_by_admin_id uuid REFERENCES members(id),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  meeting_date text NOT NULL,
  host_member_id uuid REFERENCES members(id),
  place text NOT NULL,
  notes text,
  created_by_admin_id uuid NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS message_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES cycles(id),
  member_id uuid NOT NULL REFERENCES members(id),
  loan_id uuid NOT NULL REFERENCES loans(id),
  week_key text NOT NULL,
  channel_mode text NOT NULL CHECK (channel_mode IN ('PREPARE', 'SEND')),
  recipient_mobile text NOT NULL,
  message_text text NOT NULL,
  click_to_chat_url text NOT NULL,
  status text NOT NULL CHECK (status IN ('PREPARED', 'SENT', 'FAILED', 'SKIPPED')),
  amount_owed_paise integer NOT NULL,
  paid_last_week_paise integer NOT NULL,
  interest_this_month_paise integer NOT NULL,
  next_due_date text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_logs_weekly_loan ON message_logs (cycle_id, member_id, loan_id, week_key);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_member_id uuid REFERENCES members(id),
  actor_role text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value_json jsonb NOT NULL,
  updated_by_admin_id uuid REFERENCES members(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  member_id uuid NOT NULL REFERENCES members(id),
  role text NOT NULL CHECK (role IN ('ADMIN', 'MEMBER')),
  totp_verified boolean NOT NULL DEFAULT false,
  must_change_pin boolean NOT NULL DEFAULT false,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  last_active_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Append-only ledger & audit enforcement at the database level
CREATE OR REPLACE FUNCTION prevent_append_only_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only: % is prohibited at database level', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_entries_no_update_delete ON ledger_entries;
CREATE TRIGGER trg_ledger_entries_no_update_delete
BEFORE UPDATE OR DELETE ON ledger_entries
FOR EACH ROW
EXECUTE FUNCTION prevent_append_only_mutation();

DROP TRIGGER IF EXISTS trg_ledger_entries_no_truncate ON ledger_entries;
CREATE TRIGGER trg_ledger_entries_no_truncate
BEFORE TRUNCATE ON ledger_entries
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_append_only_mutation();

DROP TRIGGER IF EXISTS trg_audit_events_no_update_delete ON audit_events;
CREATE TRIGGER trg_audit_events_no_update_delete
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW
EXECUTE FUNCTION prevent_append_only_mutation();

DROP TRIGGER IF EXISTS trg_audit_events_no_truncate ON audit_events;
CREATE TRIGGER trg_audit_events_no_truncate
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT
EXECUTE FUNCTION prevent_append_only_mutation();

CREATE OR REPLACE FUNCTION validate_reversal_target()
RETURNS trigger AS $$
DECLARE
  target_type text;
BEGIN
  IF NEW.entry_type = 'REVERSAL' THEN
    SELECT entry_type INTO target_type FROM ledger_entries WHERE id = NEW.reverses_entry_id;
    IF target_type IS NULL THEN
      RAISE EXCEPTION 'Target entry % does not exist', NEW.reverses_entry_id;
    END IF;
    IF target_type = 'REVERSAL' THEN
      RAISE EXCEPTION 'Cannot reverse a REVERSAL entry (%)', NEW.reverses_entry_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_entries_validate_reversal ON ledger_entries;
CREATE TRIGGER trg_ledger_entries_validate_reversal
BEFORE INSERT ON ledger_entries
FOR EACH ROW
EXECUTE FUNCTION validate_reversal_target();

-- Revoke direct UPDATE/DELETE/TRUNCATE privileges from PUBLIC as defense in depth
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC;

-- Derived view: member & cycle balances directly from active (non-reversed) ledger entries
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

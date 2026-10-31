-- =============================================================================
-- MIGRATION 0003: DOUBLE-ENTRY FINANCIAL LEDGER, PAYABLES & POLICY REGISTRY
-- Target Engine: PostgreSQL 16
-- Phase: 1B-1 Database & Redis Foundation
-- =============================================================================
-- Enforces:
-- - Live payments disabled (payments_active = FALSE).
-- - Commission rates and base prices NULL until explicit Owner authorization.
-- - AI agents prohibited from modifying financial policies or posting journals.
-- - Immutable, balanced double-entry journal postings (DEBIT === CREDIT enforced by deferred constraint trigger).
-- - Strict Creator payable, Merchant payable, and Platform revenue account separation.

-- 12. Financial Policy Configuration Registry
CREATE TABLE IF NOT EXISTS financial_policy_registry (
  engine_id VARCHAR(64) PRIMARY KEY CHECK (
    engine_id IN (
      'ENGINE_1_PREPAID_CREATOR_CALLS',
      'ENGINE_2_CREATOR_MERCHANT_AD_SERVICES',
      'ENGINE_3_SHOP_MERCHANT_COMMISSIONS',
      'ENGINE_4_BUSINESS_AD_REVENUE',
      'ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS'
    )
  ),
  display_name VARCHAR(160) NOT NULL,
  payments_active BOOLEAN NOT NULL DEFAULT FALSE CHECK (payments_active = FALSE),
  commission_basis_points INTEGER DEFAULT NULL,
  base_price_minor_units BIGINT DEFAULT NULL,
  updated_by_actor_id VARCHAR(128) NOT NULL,
  updated_by_actor_type VARCHAR(32) NOT NULL CHECK (updated_by_actor_type <> 'AI_AGENT'),
  owner_approval_ticket_id VARCHAR(128),
  owner_cryptographic_signature TEXT,
  updated_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_owner_approval_for_commercial_terms CHECK (
    (payments_active = FALSE AND commission_basis_points IS NULL AND base_price_minor_units IS NULL)
    OR (
      updated_by_actor_type = 'OWNER'
      AND owner_approval_ticket_id IS NOT NULL
      AND owner_cryptographic_signature IS NOT NULL
    )
  )
);

-- Seed the 5 unconfigured Phase 1B-1 monetisation engine policy rows
INSERT INTO financial_policy_registry (
  engine_id, display_name, payments_active, commission_basis_points, base_price_minor_units, updated_by_actor_id, updated_by_actor_type
) VALUES
  ('ENGINE_1_PREPAID_CREATOR_CALLS', '1. Prepaid User-to-Creator Calls', FALSE, NULL, NULL, 'SYSTEM_BOOTSTRAP', 'SYSTEM'),
  ('ENGINE_2_CREATOR_MERCHANT_AD_SERVICES', '2. Creator Advertising Services for Face Vid Shop Merchants', FALSE, NULL, NULL, 'SYSTEM_BOOTSTRAP', 'SYSTEM'),
  ('ENGINE_3_SHOP_MERCHANT_COMMISSIONS', '3. Face Vid Shop Merchant Sales Commissions', FALSE, NULL, NULL, 'SYSTEM_BOOTSTRAP', 'SYSTEM'),
  ('ENGINE_4_BUSINESS_AD_REVENUE', '4. Face Vid Business Advertising Revenue', FALSE, NULL, NULL, 'SYSTEM_BOOTSTRAP', 'SYSTEM'),
  ('ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS', '5. Face Vid AI Studio Subscriptions, Credits, Filters & Paid Tools', FALSE, NULL, NULL, 'SYSTEM_BOOTSTRAP', 'SYSTEM')
ON CONFLICT (engine_id) DO NOTHING;

-- 13. Segregated Financial Ledger Accounts
CREATE TABLE IF NOT EXISTS financial_ledger_accounts (
  account_id VARCHAR(128) PRIMARY KEY,
  owner_entity_id VARCHAR(128) NOT NULL,
  segregation_domain VARCHAR(64) NOT NULL CHECK (
    segregation_domain IN (
      'USER_PREPAID_WALLET',
      'CREATOR_EARNINGS_PAYABLE',
      'CREATOR_CALL_ESCROW',
      'CREATOR_AD_SERVICE_ESCROW',
      'MERCHANT_SALES_PAYABLE',
      'MERCHANT_ORDER_ESCROW',
      'MERCHANT_CHARGEBACK_RESERVE',
      'ADVERTISER_CAMPAIGN_ESCROW',
      'PLATFORM_COMMISSION_REVENUE',
      'PLATFORM_AD_REVENUE',
      'PLATFORM_AI_STUDIO_REVENUE',
      'PLATFORM_DISPUTE_HOLD'
    )
  ),
  currency_iso CHAR(3) NOT NULL,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_entity_id, segregation_domain, currency_iso)
);

-- 14. Creator Payable Accounts (Strictly Segregated from Merchant Payables)
CREATE TABLE IF NOT EXISTS creator_payable_accounts (
  creator_payable_account_id VARCHAR(64) PRIMARY KEY,
  creator_id VARCHAR(64) NOT NULL REFERENCES creator_accounts(creator_id) ON DELETE RESTRICT,
  ledger_account_id VARCHAR(128) NOT NULL UNIQUE REFERENCES financial_ledger_accounts(account_id) ON DELETE RESTRICT,
  segregation_domain VARCHAR(64) NOT NULL DEFAULT 'CREATOR_EARNINGS_PAYABLE' CHECK (
    segregation_domain = 'CREATOR_EARNINGS_PAYABLE'
  ),
  currency_iso CHAR(3) NOT NULL,
  settled_balance_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (settled_balance_minor_units >= 0),
  escrow_reserved_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (escrow_reserved_minor_units >= 0),
  payout_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (creator_id, currency_iso)
);

-- 15. Merchant Payable Accounts (Strictly Segregated from Creator Payables)
CREATE TABLE IF NOT EXISTS merchant_payable_accounts (
  merchant_payable_account_id VARCHAR(64) PRIMARY KEY,
  merchant_id VARCHAR(64) NOT NULL REFERENCES merchant_accounts(merchant_id) ON DELETE RESTRICT,
  ledger_account_id VARCHAR(128) NOT NULL UNIQUE REFERENCES financial_ledger_accounts(account_id) ON DELETE RESTRICT,
  segregation_domain VARCHAR(64) NOT NULL DEFAULT 'MERCHANT_SALES_PAYABLE' CHECK (
    segregation_domain = 'MERCHANT_SALES_PAYABLE'
  ),
  currency_iso CHAR(3) NOT NULL,
  settled_balance_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (settled_balance_minor_units >= 0),
  chargeback_reserve_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (chargeback_reserve_minor_units >= 0),
  payout_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, currency_iso)
);

-- 16. Platform Revenue Accounts
CREATE TABLE IF NOT EXISTS platform_revenue_accounts (
  revenue_account_id VARCHAR(64) PRIMARY KEY,
  engine_id VARCHAR(64) NOT NULL REFERENCES financial_policy_registry(engine_id) ON DELETE RESTRICT,
  ledger_account_id VARCHAR(128) NOT NULL UNIQUE REFERENCES financial_ledger_accounts(account_id) ON DELETE RESTRICT,
  segregation_domain VARCHAR(64) NOT NULL CHECK (
    segregation_domain IN (
      'PLATFORM_COMMISSION_REVENUE',
      'PLATFORM_AD_REVENUE',
      'PLATFORM_AI_STUDIO_REVENUE'
    )
  ),
  currency_iso CHAR(3) NOT NULL,
  settled_revenue_minor_units BIGINT NOT NULL DEFAULT 0 CHECK (settled_revenue_minor_units >= 0),
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (engine_id, currency_iso)
);

-- 17. Double-Entry Financial Journal Transactions (Idempotent Header)
CREATE TABLE IF NOT EXISTS financial_journal_transactions (
  journal_id VARCHAR(128) PRIMARY KEY,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  payload_sha256 VARCHAR(64) NOT NULL,
  engine_id VARCHAR(64) NOT NULL REFERENCES financial_policy_registry(engine_id) ON DELETE RESTRICT,
  transaction_state VARCHAR(64) NOT NULL CHECK (
    transaction_state IN (
      'PHASE_1A_CONTRACT_ONLY',
      'ESCROW_RESERVED',
      'SETTLED',
      'REFUND_REQUESTED',
      'REFUNDED',
      'CHARGEBACK_DISPUTE_OPEN',
      'CHARGEBACK_PAYOUT_FROZEN',
      'CHARGEBACK_LOST_REVERSED',
      'CHARGEBACK_WON_RELEASED'
    )
  ),
  currency_iso CHAR(3) NOT NULL,
  created_by_actor_id VARCHAR(128) NOT NULL,
  created_by_actor_type VARCHAR(32) NOT NULL CHECK (created_by_actor_type <> 'AI_AGENT'),
  audit_digest VARCHAR(128) NOT NULL,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_journals_engine ON financial_journal_transactions(engine_id, created_at_iso DESC);

-- 18. Double-Entry Financial Journal Entries (Immutable Lines)
CREATE TABLE IF NOT EXISTS financial_ledger_entries (
  line_id VARCHAR(128) PRIMARY KEY,
  journal_id VARCHAR(128) NOT NULL REFERENCES financial_journal_transactions(journal_id) ON DELETE RESTRICT,
  account_id VARCHAR(128) NOT NULL REFERENCES financial_ledger_accounts(account_id) ON DELETE RESTRICT,
  segregation_domain VARCHAR(64) NOT NULL,
  direction VARCHAR(8) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount_minor_units BIGINT NOT NULL CHECK (amount_minor_units > 0),
  currency_iso CHAR(3) NOT NULL,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_financial_entries_journal ON financial_ledger_entries(journal_id);
CREATE INDEX IF NOT EXISTS idx_financial_entries_account ON financial_ledger_entries(account_id);

-- Prevent UPDATE or DELETE on financial_journal_transactions and financial_ledger_entries
CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Security Violation: Financial journals and ledger entries are strictly append-only. Use compensating double-entry journals for refunds or chargebacks.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_financial_journals_immutable ON financial_journal_transactions;
CREATE TRIGGER trg_financial_journals_immutable
BEFORE UPDATE OR DELETE ON financial_journal_transactions
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();

DROP TRIGGER IF EXISTS trg_financial_ledger_entries_immutable ON financial_ledger_entries;
CREATE TRIGGER trg_financial_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON financial_ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();

-- Enforce Balanced Double-Entry Invariant (sum(DEBIT) === sum(CREDIT), line_count >= 2)
-- and Creator/Merchant Balance Separation at Transaction COMMIT
CREATE OR REPLACE FUNCTION verify_journal_balanced_at_commit()
RETURNS TRIGGER AS $$
DECLARE
  target_journal_id VARCHAR(128);
  journal_curr CHAR(3);
  line_cnt INTEGER;
  debit_sum BIGINT;
  credit_sum BIGINT;
  creator_payable_cnt INTEGER;
  merchant_payable_cnt INTEGER;
  escrow_cnt INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'financial_journal_transactions' THEN
    target_journal_id := NEW.journal_id;
  ELSE
    target_journal_id := NEW.journal_id;
  END IF;

  SELECT currency_iso INTO journal_curr
  FROM financial_journal_transactions
  WHERE journal_id = target_journal_id;

  SELECT
    COUNT(*),
    COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_minor_units ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount_minor_units ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN segregation_domain = 'CREATOR_EARNINGS_PAYABLE' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN segregation_domain = 'MERCHANT_SALES_PAYABLE' THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN segregation_domain IN ('CREATOR_AD_SERVICE_ESCROW', 'MERCHANT_ORDER_ESCROW') THEN 1 ELSE 0 END), 0)
  INTO line_cnt, debit_sum, credit_sum, creator_payable_cnt, merchant_payable_cnt, escrow_cnt
  FROM financial_ledger_entries
  WHERE journal_id = target_journal_id;

  IF line_cnt < 2 THEN
    RAISE EXCEPTION 'Ledger Integrity Violation: Journal % has % lines (minimum 2 required).', target_journal_id, line_cnt;
  END IF;

  IF debit_sum <> credit_sum THEN
    RAISE EXCEPTION 'Ledger Integrity Violation: Unbalanced journal % (DEBIT=% <> CREDIT=%).', target_journal_id, debit_sum, credit_sum;
  END IF;

  IF creator_payable_cnt > 0 AND merchant_payable_cnt > 0 AND escrow_cnt = 0 THEN
    RAISE EXCEPTION 'Ledger Integrity Violation: Direct commingling between Creator Payable and Merchant Payable in journal % without escrow clearing is forbidden.', target_journal_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM financial_ledger_entries e
    JOIN financial_ledger_accounts a ON a.account_id = e.account_id
    WHERE e.journal_id = target_journal_id
      AND (e.segregation_domain <> a.segregation_domain OR e.currency_iso <> journal_curr OR a.currency_iso <> journal_curr)
  ) THEN
    RAISE EXCEPTION 'Ledger Integrity Violation: Account segregation domain or currency mismatch in journal %.', target_journal_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_verify_journal_header_balanced ON financial_journal_transactions;
CREATE CONSTRAINT TRIGGER trg_verify_journal_header_balanced
AFTER INSERT ON financial_journal_transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_journal_balanced_at_commit();

DROP TRIGGER IF EXISTS trg_verify_journal_entry_balanced ON financial_ledger_entries;
CREATE CONSTRAINT TRIGGER trg_verify_journal_entry_balanced
AFTER INSERT ON financial_ledger_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION verify_journal_balanced_at_commit();

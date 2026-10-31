-- =============================================================================
-- FACE VID — PHASE 1A AUTHORITATIVE POSTGRESQL FOUNDATION & AUDIT SCHEMA
-- =============================================================================
-- Enforces tamper-resistant append-only audit trail at the database layer.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS audit_events (
  sequence_number BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL UNIQUE,
  timestamp_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id VARCHAR(128) NOT NULL,
  actor_type VARCHAR(32) NOT NULL,
  category VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  action VARCHAR(128) NOT NULL,
  target_resource_id VARCHAR(256) NOT NULL,
  owner_approval_ticket_id VARCHAR(128),
  metadata_sanitized JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash VARCHAR(128) NOT NULL,
  entry_hash VARCHAR(128) NOT NULL
);

-- Prevent UPDATE or DELETE on audit_events to guarantee tamper-resistance
CREATE OR REPLACE FUNCTION prevent_audit_event_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Security Violation: audit_events table is strictly append-only. Mutations and deletions are prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_immutable ON audit_events;
CREATE TRIGGER trg_audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

-- =============================================================================
-- FIVE MONETISATION ENGINES & DOUBLE-ENTRY LEDGER ARCHITECTURE (PHASE 1A)
-- =============================================================================
-- 1. ENGINE_1_PREPAID_CREATOR_CALLS
-- 2. ENGINE_2_CREATOR_MERCHANT_AD_SERVICES
-- 3. ENGINE_3_SHOP_MERCHANT_COMMISSIONS
-- 4. ENGINE_4_BUSINESS_AD_REVENUE
-- 5. ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS
--
-- Security Invariants:
-- - Live payment charging is disabled in Phase 1A (payments_active = FALSE).
-- - Commission rates and base prices are NULL until explicit Owner authorization.
-- - AI agents are prohibited from modifying financial policies or executing ledger entries.
-- - Creator payable balances and Merchant payable balances are strictly segregated.

CREATE TABLE IF NOT EXISTS financial_policy_registry (
  engine_id VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(160) NOT NULL,
  payments_active BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE TABLE IF NOT EXISTS financial_journal_transactions (
  journal_id VARCHAR(128) PRIMARY KEY,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  payload_sha256 VARCHAR(64) NOT NULL,
  engine_id VARCHAR(64) NOT NULL,
  transaction_state VARCHAR(64) NOT NULL,
  currency_iso CHAR(3) NOT NULL,
  created_by_actor_id VARCHAR(128) NOT NULL,
  created_by_actor_type VARCHAR(32) NOT NULL CHECK (created_by_actor_type <> 'AI_AGENT'),
  audit_digest VARCHAR(128) NOT NULL,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS financial_ledger_entries (
  line_id VARCHAR(128) PRIMARY KEY,
  journal_id VARCHAR(128) NOT NULL REFERENCES financial_journal_transactions(journal_id),
  account_id VARCHAR(128) NOT NULL REFERENCES financial_ledger_accounts(account_id),
  segregation_domain VARCHAR(64) NOT NULL,
  direction VARCHAR(8) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
  amount_minor_units BIGINT NOT NULL CHECK (amount_minor_units > 0),
  currency_iso CHAR(3) NOT NULL,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent UPDATE or DELETE on financial_ledger_entries (compensating entries required for refunds/chargebacks)
CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Security Violation: financial_ledger_entries is strictly append-only. Use compensating double-entry journals for refunds or chargebacks.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_financial_ledger_entries_immutable ON financial_ledger_entries;
CREATE TRIGGER trg_financial_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON financial_ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();


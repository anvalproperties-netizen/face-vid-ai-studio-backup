-- =============================================================================
-- MIGRATION 0002: DEVICE SESSIONS, TV PAIRING RECORDS & IMMUTABLE AUDIT EVENTS
-- Target Engine: PostgreSQL 16
-- Phase: 1B-1 Database & Redis Foundation
-- =============================================================================

-- 9. Device Sessions (Experience A & Experience B)
CREATE TABLE IF NOT EXISTS device_sessions (
  session_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  platform_id VARCHAR(48) NOT NULL CHECK (
    platform_id IN (
      'GOOGLE_PLAY_ANDROID',
      'APPLE_APP_STORE_IOS',
      'MICROSOFT_STORE_WINDOWS',
      'FACE_VID_WEB',
      'ANDROID_TV_GOOGLE_TV',
      'SAMSUNG_TIZEN_TV',
      'LG_WEBOS_TV',
      'APPLE_TVOS',
      'AMAZON_FIRE_TV'
    )
  ),
  experience_tier VARCHAR(32) NOT NULL CHECK (
    experience_tier IN ('EXPERIENCE_A_FULL', 'EXPERIENCE_B_TV_LEANBACK', 'ADMIN_ISOLATED_WEB')
  ),
  token_sha256 VARCHAR(64) NOT NULL UNIQUE,
  device_display_name VARCHAR(160) NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_reason VARCHAR(160),
  expires_at_iso TIMESTAMPTZ NOT NULL,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_sessions_user_active ON device_sessions(user_id, revoked);

-- 10. TV Device Pairing Records (Persistent Audit & Session Binding)
CREATE TABLE IF NOT EXISTS tv_pairing_records (
  pairing_request_id VARCHAR(64) PRIMARY KEY,
  short_pairing_code VARCHAR(16) NOT NULL UNIQUE,
  device_challenge_nonce_sha256 VARCHAR(64) NOT NULL,
  qr_verification_uri TEXT NOT NULL,
  device_platform VARCHAR(48) NOT NULL CHECK (
    device_platform IN (
      'ANDROID_TV_GOOGLE_TV',
      'SAMSUNG_TIZEN_TV',
      'LG_WEBOS_TV',
      'APPLE_TVOS',
      'AMAZON_FIRE_TV'
    )
  ),
  device_display_name VARCHAR(160) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING_USER_CONFIRMATION' CHECK (
    status IN (
      'PENDING_USER_CONFIRMATION',
      'AUTHORIZED_READY_FOR_TV',
      'CONSUMED_ACTIVE_SESSION',
      'EXPIRED',
      'REVOKED',
      'LOCKED_BRUTE_FORCE'
    )
  ),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  authorized_by_user_id VARCHAR(64) REFERENCES users(user_id) ON DELETE SET NULL,
  authorized_user_handle VARCHAR(64),
  issued_device_session_id VARCHAR(64) UNIQUE REFERENCES device_sessions(session_id) ON DELETE SET NULL,
  contains_permanent_credentials_in_qr BOOLEAN NOT NULL DEFAULT FALSE CHECK (
    contains_permanent_credentials_in_qr = FALSE
  ),
  expires_at_iso TIMESTAMPTZ NOT NULL,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tv_pairing_status_expires ON tv_pairing_records(status, expires_at_iso);

-- 11. Tamper-Resistant Append-Only Audit Events
CREATE TABLE IF NOT EXISTS audit_events (
  sequence_number BIGSERIAL PRIMARY KEY,
  event_id VARCHAR(64) NOT NULL UNIQUE,
  timestamp_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id VARCHAR(128) NOT NULL,
  actor_type VARCHAR(32) NOT NULL CHECK (
    actor_type IN ('USER', 'CREATOR', 'MERCHANT', 'ADVERTISER', 'ADMIN', 'SUPER_ADMIN', 'OWNER', 'AI_AGENT', 'SYSTEM')
  ),
  category VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  action VARCHAR(128) NOT NULL,
  target_resource_id VARCHAR(256) NOT NULL,
  owner_approval_ticket_id VARCHAR(128),
  metadata_sanitized JSONB NOT NULL DEFAULT '{}'::jsonb,
  previous_hash VARCHAR(128) NOT NULL,
  entry_hash VARCHAR(128) NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_audit_events_category_seq ON audit_events(category, sequence_number DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor ON audit_events(actor_id, timestamp_iso DESC);

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

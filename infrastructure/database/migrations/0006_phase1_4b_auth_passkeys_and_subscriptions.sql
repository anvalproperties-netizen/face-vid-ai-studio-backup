-- =============================================================================
-- MIGRATION 0006: SECURE AUTHENTICATION, WEBAUTHN PASSKEYS & SUBSCRIPTIONS
-- Target Engine: PostgreSQL 16
-- Phase: 1.4B Secure Authentication Backend
-- =============================================================================

-- 1. Auth Credentials Table (Password Hash & Salt)
CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  password_hash VARCHAR(255) NOT NULL,
  salt VARCHAR(64) NOT NULL,
  algo VARCHAR(32) NOT NULL DEFAULT 'argon2id',
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at_iso TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Auth Tokens Table (Email Verification & Password Reset)
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL,
  token_type VARCHAR(32) NOT NULL CHECK (token_type IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET')),
  expires_at_iso TIMESTAMPTZ NOT NULL,
  used_at_iso TIMESTAMPTZ NULL,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens (token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens (user_id);

-- 3. WebAuthn / FIDO2 Passkey Credentials Table
CREATE TABLE IF NOT EXISTS user_passkey_credentials (
  credential_id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  public_key_der_base64 TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  device_type VARCHAR(32) NOT NULL DEFAULT 'platform' CHECK (device_type IN ('platform', 'cross-platform')),
  transports TEXT[] NOT NULL DEFAULT ARRAY['internal']::TEXT[],
  aaguid VARCHAR(64) NULL,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at_iso TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_passkey_user_id ON user_passkey_credentials (user_id);

-- 4. Emergency Single-Use Recovery Codes
CREATE TABLE IF NOT EXISTS user_recovery_codes (
  code_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  code_hash VARCHAR(64) NOT NULL,
  used_at_iso TIMESTAMPTZ NULL,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON user_recovery_codes (user_id);

-- 5. User Subscriptions Table (Free vs Premium Tier Relational Boundary)
CREATE TABLE IF NOT EXISTS user_subscriptions (
  subscription_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  tier VARCHAR(32) NOT NULL DEFAULT 'FREE_STANDARD' CHECK (
    tier IN ('FREE_STANDARD', 'PREMIUM_AD_FREE', 'AI_STUDIO_PRO')
  ),
  status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE' CHECK (
    status IN ('ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')
  ),
  price_cents INT NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  billing_provider VARCHAR(32) NULL CHECK (billing_provider IN ('STRIPE', 'APPLE_IAP', 'GOOGLE_PLAY', NULL)),
  provider_subscription_id VARCHAR(128) NULL,
  current_period_start_iso TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  current_period_end_iso TIMESTAMPTZ NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at_iso TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_user_active_sub UNIQUE (user_id)
);

-- 6. Add daily verification and token rotation columns to device_sessions
ALTER TABLE device_sessions ADD COLUMN IF NOT EXISTS last_daily_verified_at_iso TIMESTAMPTZ NULL;
ALTER TABLE device_sessions ADD COLUMN IF NOT EXISTS daily_verification_method VARCHAR(32) NULL;
ALTER TABLE device_sessions ADD COLUMN IF NOT EXISTS refresh_token_hash VARCHAR(64) NULL;

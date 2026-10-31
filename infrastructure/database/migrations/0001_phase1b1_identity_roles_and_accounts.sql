-- =============================================================================
-- MIGRATION 0001: IDENTITY, ROLES, PERMISSIONS, PROFILES & DOMAIN ACCOUNTS
-- Target Engine: PostgreSQL 16
-- Phase: 1B-1 Database & Redis Foundation
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Core Users Table
CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(64) PRIMARY KEY,
  primary_email VARCHAR(255) NOT NULL UNIQUE,
  legal_full_name VARCHAR(255) NOT NULL,
  country_iso_code CHAR(2) NOT NULL,
  account_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (
    account_status IN ('PENDING_VERIFICATION', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'TERMINATED')
  ),
  subscription_tier VARCHAR(32) NOT NULL DEFAULT 'FREE_STANDARD' CHECK (
    subscription_tier IN ('FREE_STANDARD', 'PREMIUM_AD_FREE', 'AI_STUDIO_PRO')
  ),
  mfa_enrolled BOOLEAN NOT NULL DEFAULT FALSE,
  phishing_resistant_mfa_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_status ON users(account_status);
CREATE INDEX IF NOT EXISTS idx_users_country ON users(country_iso_code);

-- 2. User Profiles (Public & Avatar-Based Private Persona Separation)
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  public_display_name VARCHAR(120) NOT NULL,
  public_handle VARCHAR(64) NOT NULL UNIQUE,
  public_bio TEXT NOT NULL DEFAULT '',
  public_avatar_url TEXT NOT NULL,
  public_verified_badge BOOLEAN NOT NULL DEFAULT FALSE,
  private_pseudonym VARCHAR(120) NOT NULL UNIQUE,
  private_avatar_seed_id VARCHAR(128) NOT NULL,
  private_avatar_style VARCHAR(32) NOT NULL CHECK (
    private_avatar_style IN ('GEOMETRIC_SHIELD', 'NEON_SILHOUETTE', 'CINEMATIC_MASK')
  ),
  updated_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Public / Private Identity & Broadcast Privacy Settings
CREATE TABLE IF NOT EXISTS user_identity_settings (
  user_id VARCHAR(64) PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  active_identity_mode VARCHAR(16) NOT NULL DEFAULT 'PUBLIC' CHECK (
    active_identity_mode IN ('PUBLIC', 'PRIVATE')
  ),
  strip_legal_identity_in_peer_payloads BOOLEAN NOT NULL DEFAULT TRUE CHECK (
    strip_legal_identity_in_peer_payloads = TRUE
  ),
  default_live_audience_reach VARCHAR(32) NOT NULL DEFAULT 'COUNTRY' CHECK (
    default_live_audience_reach IN ('RADIUS_15KM', 'RADIUS_30KM', 'CITY', 'COUNTRY', 'CONTINENT', 'WORLDWIDE')
  ),
  auto_archive_live_streams BOOLEAN NOT NULL DEFAULT FALSE CHECK (
    auto_archive_live_streams = FALSE
  ),
  updated_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Roles, Permissions & Role-Based Access Control (RBAC)
CREATE TABLE IF NOT EXISTS roles (
  role_code VARCHAR(32) PRIMARY KEY CHECK (
    role_code IN (
      'GUEST',
      'USER',
      'CREATOR',
      'MERCHANT',
      'ADVERTISER',
      'MODERATOR',
      'ADMIN',
      'SUPER_ADMIN',
      'OWNER'
    )
  ),
  display_name VARCHAR(80) NOT NULL,
  requires_phishing_resistant_mfa BOOLEAN NOT NULL DEFAULT FALSE,
  allow_public_self_registration BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS permissions (
  permission_code VARCHAR(64) PRIMARY KEY,
  domain VARCHAR(32) NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code VARCHAR(32) NOT NULL REFERENCES roles(role_code) ON DELETE CASCADE,
  permission_code VARCHAR(64) NOT NULL REFERENCES permissions(permission_code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  role_code VARCHAR(32) NOT NULL REFERENCES roles(role_code) ON DELETE RESTRICT,
  granted_by_actor_id VARCHAR(64) NOT NULL,
  granted_by_actor_type VARCHAR(32) NOT NULL CHECK (granted_by_actor_type <> 'AI_AGENT'),
  granted_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role_code)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_role_code ON user_roles(role_code);

-- 5. Founding Creator Program Cap & Creator Verification
CREATE TABLE IF NOT EXISTS founding_creator_program_state (
  program_id VARCHAR(32) PRIMARY KEY DEFAULT 'FOUNDING_CREATOR_PROGRAM' CHECK (
    program_id = 'FOUNDING_CREATOR_PROGRAM'
  ),
  max_eligible_creators INTEGER NOT NULL DEFAULT 3000000 CHECK (max_eligible_creators = 3000000),
  allocated_count INTEGER NOT NULL DEFAULT 0 CHECK (
    allocated_count >= 0 AND allocated_count <= 3000000
  ),
  allocation_active BOOLEAN NOT NULL DEFAULT FALSE CHECK (allocation_active = FALSE),
  updated_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO founding_creator_program_state (
  program_id, max_eligible_creators, allocated_count, allocation_active
) VALUES ('FOUNDING_CREATOR_PROGRAM', 3000000, 0, FALSE)
ON CONFLICT (program_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS creator_verifications (
  verification_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE CASCADE,
  external_platform_name VARCHAR(64) NOT NULL,
  external_account_handle VARCHAR(128) NOT NULL,
  ownership_proof_digest VARCHAR(128) NOT NULL,
  ai_assistive_score NUMERIC(5,2) NOT NULL CHECK (
    ai_assistive_score >= 0 AND ai_assistive_score <= 100
  ),
  requires_human_review BOOLEAN NOT NULL DEFAULT TRUE CHECK (requires_human_review = TRUE),
  human_reviewer_user_id VARCHAR(64) REFERENCES users(user_id) ON DELETE SET NULL,
  verification_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_HUMAN_REVIEW' CHECK (
    verification_status IN ('PENDING_HUMAN_REVIEW', 'VERIFIED_ELIGIBLE', 'REJECTED')
  ),
  founding_slot_number INTEGER UNIQUE CHECK (
    founding_slot_number IS NULL OR (founding_slot_number >= 1 AND founding_slot_number <= 3000000)
  ),
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_human_reviewer_required_for_verified CHECK (
    verification_status <> 'VERIFIED_ELIGIBLE' OR human_reviewer_user_id IS NOT NULL
  )
);

-- 6. Creator Accounts
CREATE TABLE IF NOT EXISTS creator_accounts (
  creator_id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE RESTRICT,
  channel_handle VARCHAR(64) NOT NULL UNIQUE,
  channel_display_name VARCHAR(120) NOT NULL,
  verification_id VARCHAR(64) UNIQUE REFERENCES creator_verifications(verification_id) ON DELETE SET NULL,
  prepaid_calls_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ad_services_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  account_status VARCHAR(32) NOT NULL DEFAULT 'PENDING' CHECK (
    account_status IN ('PENDING', 'ACTIVE', 'SUSPENDED')
  ),
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Merchant Accounts (Face Vid Shop)
CREATE TABLE IF NOT EXISTS merchant_accounts (
  merchant_id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL UNIQUE REFERENCES users(user_id) ON DELETE RESTRICT,
  shop_name VARCHAR(160) NOT NULL,
  shop_slug VARCHAR(80) NOT NULL UNIQUE,
  kyb_verification_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_KYB' CHECK (
    kyb_verification_status IN ('PENDING_KYB', 'VERIFIED', 'REJECTED', 'SUSPENDED')
  ),
  registration_country_iso CHAR(2) NOT NULL,
  live_shopping_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Business Advertiser Accounts (Face Vid Business)
CREATE TABLE IF NOT EXISTS business_advertiser_accounts (
  advertiser_id VARCHAR(64) PRIMARY KEY,
  owner_user_id VARCHAR(64) NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
  organization_legal_name VARCHAR(200) NOT NULL,
  tax_registration_ref VARCHAR(128) NOT NULL UNIQUE,
  compliance_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (
    compliance_status IN ('PENDING_REVIEW', 'APPROVED', 'SUSPENDED')
  ),
  human_ad_review_mandatory BOOLEAN NOT NULL DEFAULT TRUE CHECK (human_ad_review_mandatory = TRUE),
  created_at_iso TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_advertiser_owner ON business_advertiser_accounts(owner_user_id);

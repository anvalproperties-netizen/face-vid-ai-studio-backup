/**
 * @face-vid/api — PostgreSQL 16 Database & Versioned Migration Foundation Service (Phase 1B-1)
 *
 * Implements Phase 1B-1 Database Requirements:
 * - Versioned SQL migrations (`0001`, `0002`, `0003`) with SHA-256 checksum verification.
 * - Full relational persistence across all 15 mandatory Phase 1B-1 domains:
 *   1. User identities (`users`) & profiles (`user_profiles`)
 *   2. Roles & permissions (`roles`, `permissions`, `role_permissions`, `user_roles`)
 *   3. Public/private identity settings (`user_identity_settings`)
 *   4. Creator verification & founding creator eligibility (`founding_creator_program_state`, `creator_verifications`)
 *   5. Creator accounts (`creator_accounts`)
 *   6. Merchant accounts (`merchant_accounts`)
 *   7. Business advertiser accounts (`business_advertiser_accounts`)
 *   8. Device sessions (`device_sessions`)
 *   9. TV pairing records (`tv_pairing_records`)
 *   10. Financial journals & journal entries (`financial_journal_transactions`, `financial_ledger_entries`)
 *   11. Creator payable accounts (`creator_payable_accounts`)
 *   12. Merchant payable accounts (`merchant_payable_accounts`)
 *   13. Platform revenue accounts (`platform_revenue_accounts`)
 *   14. Audit events (`audit_events`)
 *   15. Financial policy configuration (`financial_policy_registry`)
 * - Enforces foreign keys, CHECK constraints, uniqueness guarantees, balanced double-entry
 *   deferred commit triggers, Creator/Merchant balance separation, and append-only immutability.
 * - Live payment processing remains strictly disabled (`payments_active = FALSE`).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import {
  AccountSegregationDomain,
  AccountStatus,
  AuditActorType,
  AuditEventCategory,
  AuditSeverity,
  ContentCategory,
  ContentVisibility,
  FIVE_MONETIZATION_ENGINE_CONTRACTS,
  FinancialTransactionState,
  IdentityMode,
  LedgerEntryDirection,
  LiveAudienceReach,
  MonetizationEngineId,
  PlatformId,
  SubscriptionTier,
  UserExperienceTier,
  UserRole,
  VideoFormat,
  VideoProcessingStatus,
  UploadSessionStatus,
  MalwareScanStatus,
  MediaValidationStatus,
  TranscodingPipelineStep,
  computeAuditChainDigest,
  validateDoubleEntryJournal,
  type AuditEventRecord,
  type DailyVerificationMethod,
  type DoubleEntryJournalTransaction,
  type LedgerPostingLine,
  type PaginatedVideosResponse,
  type TvDevicePairingRecord,
  type VideoCatalogItem,
  type VideoCatalogPaginationQuery,
  type VideoChannelSummary,
  type PersistedBlockedUserRow,
} from '../../../../packages/shared/src/index.ts';
import { apiLogger } from '../common/logger.ts';

export interface PersistedVideoChannelRow {
  channelId: string;
  creatorId: string | null;
  userId: string;
  channelHandle: string;
  title: string;
  description: string;
  avatarUrl: string;
  bannerUrl: string | null;
  subscriberCount: number;
  isVerified: boolean;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface PersistedVideoCategoryRow {
  categoryId: string;
  name: string;
  slug: string;
  description: string;
  createdAtIso: string;
}

export interface PersistedVideoRow {
  videoId: string;
  channelId: string;
  title: string;
  description: string;
  categoryId: string | null;
  videoFormat: VideoFormat;
  visibility: ContentVisibility;
  processingStatus: VideoProcessingStatus;
  playbackUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  resolutionHeight: number;
  aspectRatio: string;
  viewCount: number;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  isAgeRestricted: boolean;
  publishedAtIso: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface PersistedVideoTagRow {
  tagId: string;
  tagName: string;
  createdAtIso: string;
}

export interface PersistedVideoTagMappingRow {
  videoId: string;
  tagId: string;
}

export interface PersistedVideoUploadSessionRow {
  sessionId: string;
  creatorId: string;
  channelId: string;
  videoId?: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  sha256Checksum?: string;
  stagingStorageBucket: string;
  stagingObjectPath: string;
  signedUploadUrl: string;
  resumableSessionUri?: string;
  uploadStatus: UploadSessionStatus;
  malwareScanStatus: MalwareScanStatus;
  mediaValidationStatus: MediaValidationStatus;
  transcodingStatus: string;
  visibilityChoice: ContentVisibility;
  title: string;
  description: string;
  categoryId?: string | null;
  videoFormat: VideoFormat;
  tags: string[];
  extractedThumbnailUrl?: string;
  failureReason?: string | null;
  expiresAtIso: string;
  createdAtIso: string;
  updatedAtIso: string;
  idempotencyKey?: string;
}

export interface PersistedVideoTranscodeRenditionRow {
  renditionId: string;
  videoId: string;
  resolutionHeight: number;
  bitrateKbps: number;
  codec: string;
  container: string;
  streamUrl: string;
  fileSizeBytes: number;
  createdAtIso: string;
}

export interface PersistedVideoProcessingJobRow {
  jobId: string;
  sessionId: string;
  queueName: string;
  bullmqJobId?: string;
  step: TranscodingPipelineStep;
  progressPercent: number;
  errorMessage?: string | null;
  retryCount: number;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface SchemaMigrationRecord {
  readonly version: string;
  readonly filename: string;
  readonly checksumSha256: string;
  readonly appliedAtIso: string;
  readonly tablesCreated: readonly string[];
  readonly triggersCreated: readonly string[];
}

export interface PersistedUserRow {
  userId: string;
  primaryEmail: string;
  mobileNumber?: string;
  legalFullName: string;
  countryIsoCode: string;
  accountStatus: AccountStatus;
  subscriptionTier: SubscriptionTier;
  mfaEnrolled: boolean;
  phishingResistantMfaVerified: boolean;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface PersistedUserProfileRow {
  userId: string;
  publicDisplayName: string;
  publicHandle: string;
  publicBio: string;
  publicAvatarUrl: string;
  publicVerifiedBadge: boolean;
  privatePseudonym: string;
  privateAvatarSeedId: string;
  privateAvatarStyle: 'GEOMETRIC_SHIELD' | 'NEON_SILHOUETTE' | 'CINEMATIC_MASK';
  updatedAtIso: string;
}

export interface PersistedIdentitySettingsRow {
  userId: string;
  activeIdentityMode: IdentityMode;
  stripLegalIdentityInPeerPayloads: true;
  defaultLiveAudienceReach: LiveAudienceReach;
  autoArchiveLiveStreams: false;
  updatedAtIso: string;
}

export interface PersistedRoleRow {
  roleCode: UserRole;
  displayName: string;
  requiresPhishingResistantMfa: boolean;
  allowPublicSelfRegistration: boolean;
}

export interface PersistedUserRoleRow {
  userId: string;
  roleCode: UserRole;
  grantedByActorId: string;
  grantedByActorType: AuditActorType;
  grantedAtIso: string;
}

export interface PersistedCreatorVerificationRow {
  verificationId: string;
  userId: string;
  externalPlatformName: string;
  externalAccountHandle: string;
  ownershipProofDigest: string;
  aiAssistiveScore: number;
  requiresHumanReview: true;
  humanReviewerUserId: string | null;
  verificationStatus: 'PENDING_HUMAN_REVIEW' | 'VERIFIED_ELIGIBLE' | 'REJECTED';
  foundingSlotNumber: number | null;
  createdAtIso: string;
}

export interface PersistedCreatorAccountRow {
  creatorId: string;
  userId: string;
  channelHandle: string;
  channelDisplayName: string;
  verificationId: string | null;
  prepaidCallsEnabled: boolean;
  adServicesEnabled: boolean;
  accountStatus: 'PENDING' | 'ACTIVE' | 'SUSPENDED';
  createdAtIso: string;
}

export interface PersistedMerchantAccountRow {
  merchantId: string;
  ownerUserId: string;
  shopName: string;
  shopSlug: string;
  kybVerificationStatus: 'PENDING_KYB' | 'VERIFIED' | 'REJECTED' | 'SUSPENDED';
  registrationCountryIso: string;
  liveShoppingEnabled: boolean;
  createdAtIso: string;
}

export interface PersistedBusinessAdvertiserRow {
  advertiserId: string;
  ownerUserId: string;
  organizationLegalName: string;
  taxRegistrationRef: string;
  complianceStatus: 'PENDING_REVIEW' | 'APPROVED' | 'SUSPENDED';
  humanAdReviewMandatory: true;
  createdAtIso: string;
}

export interface PersistedDeviceSessionRow {
  sessionId: string;
  userId: string;
  platformId: PlatformId;
  experienceTier: UserExperienceTier;
  tokenSha256: string;
  deviceDisplayName: string;
  revoked: boolean;
  revokedReason: string | null;
  expiresAtIso: string;
  createdAtIso: string;
  lastDailyVerifiedAtIso?: string | null;
  dailyVerificationMethod?: DailyVerificationMethod | null;
  refreshTokenHash?: string | null;
}

export interface PersistedAuthCredentialRow {
  userId: string;
  passwordHash: string;
  salt: string;
  algo: 'argon2id' | 'sha256_salted' | 'scrypt';
  createdAtIso: string;
  updatedAtIso: string;
}

export interface PersistedLinkedIdentityRow {
  linkId: string;
  userId: string;
  provider: string;
  externalSubjectId: string;
  externalEmail?: string;
  linkedAtIso: string;
}

export interface PersistedAuthTokenRow {
  tokenId: string;
  userId: string;
  tokenHash: string;
  tokenType: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
  expiresAtIso: string;
  usedAtIso: string | null;
  createdAtIso: string;
}

export interface PersistedPasskeyCredentialRow {
  credentialId: string;
  userId: string;
  publicKeyDerBase64: string;
  counter: number;
  deviceType: 'platform' | 'cross-platform';
  transports: string[];
  aaguid: string | null;
  createdAtIso: string;
  lastUsedAtIso: string | null;
}

export interface PersistedRecoveryCodeRow {
  codeId: string;
  userId: string;
  codeHash: string;
  usedAtIso: string | null;
  createdAtIso: string;
}

export interface PersistedUserSubscriptionRow {
  subscriptionId: string;
  userId: string;
  tier: SubscriptionTier;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
  priceCents: number;
  currency: string;
  billingProvider: 'STRIPE' | 'APPLE_IAP' | 'GOOGLE_PLAY' | null;
  providerSubscriptionId: string | null;
  currentPeriodStartIso: string;
  currentPeriodEndIso: string | null;
  cancelAtPeriodEnd: boolean;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface PersistedChatConversationRow {
  conversationId: string;
  participantUserIds: string[];
  createdAtIso: string;
  updatedAtIso: string;
  lastMessageText: string;
  lastMessageTimestampIso: string;
  lastMessageSenderUserId: string;
}

export interface PersistedDirectMessageRow {
  messageId: string;
  conversationId: string;
  senderUserId: string;
  receiverUserId: string;
  text: string;
  mediaType: 'text' | 'audio' | 'image';
  mediaUrl?: string;
  status: 'SENT' | 'DELIVERED' | 'READ';
  idempotencyKey?: string;
  createdAtIso: string;
  deliveredAtIso?: string;
  readAtIso?: string;
}

export interface PersistedTvPairingRow {
  pairingRequestId: string;
  shortPairingCode: string;
  deviceChallengeNonceSha256: string;
  qrVerificationUri: string;
  devicePlatform: PlatformId;
  deviceDisplayName: string;
  status: TvDevicePairingRecord['status'];
  version: number;
  failedAttempts: number;
  authorizedByUserId: string | null;
  authorizedUserHandle: string | null;
  issuedDeviceSessionId: string | null;
  containsPermanentCredentialsInQr: false;
  expiresAtIso: string;
  createdAtIso: string;
}

export interface PersistedFinancialPolicyRow {
  engineId: MonetizationEngineId;
  displayName: string;
  paymentsActive: false;
  commissionBasisPoints: null;
  basePriceMinorUnits: null;
  updatedByActorId: string;
  updatedByActorType: AuditActorType;
  ownerApprovalTicketId: string | null;
  ownerCryptographicSignature: string | null;
  updatedAtIso: string;
}

export interface PersistedLedgerAccountRow {
  accountId: string;
  ownerEntityId: string;
  segregationDomain: AccountSegregationDomain;
  currencyIso: string;
  createdAtIso: string;
}

export interface PersistedCreatorPayableRow {
  creatorPayableAccountId: string;
  creatorId: string;
  ledgerAccountId: string;
  segregationDomain: AccountSegregationDomain.CREATOR_EARNINGS_PAYABLE;
  currencyIso: string;
  settledBalanceMinorUnits: number;
  escrowReservedMinorUnits: number;
  payoutFrozen: boolean;
  createdAtIso: string;
}

export interface PersistedMerchantPayableRow {
  merchantPayableAccountId: string;
  merchantId: string;
  ledgerAccountId: string;
  segregationDomain: AccountSegregationDomain.MERCHANT_SALES_PAYABLE;
  currencyIso: string;
  settledBalanceMinorUnits: number;
  chargebackReserveMinorUnits: number;
  payoutFrozen: boolean;
  createdAtIso: string;
}

export interface PersistedPlatformRevenueRow {
  revenueAccountId: string;
  engineId: MonetizationEngineId;
  ledgerAccountId: string;
  segregationDomain:
    | AccountSegregationDomain.PLATFORM_COMMISSION_REVENUE
    | AccountSegregationDomain.PLATFORM_AD_REVENUE
    | AccountSegregationDomain.PLATFORM_AI_STUDIO_REVENUE;
  currencyIso: string;
  settledRevenueMinorUnits: number;
  createdAtIso: string;
}

export interface PersistedJournalHeaderRow {
  journalId: string;
  idempotencyKey: string;
  payloadSha256: string;
  engineId: MonetizationEngineId;
  transactionState: FinancialTransactionState;
  currencyIso: string;
  createdByActorId: string;
  createdByActorType: AuditActorType;
  auditDigest: string;
  createdAtIso: string;
}

export interface PersistedLedgerEntryRow {
  lineId: string;
  journalId: string;
  accountId: string;
  ownerEntityId: string;
  segregationDomain: AccountSegregationDomain;
  direction: LedgerEntryDirection;
  amountMinorUnits: number;
  currencyIso: string;
  createdAtIso: string;
}

interface PersistedDatabaseCatalog {
  engineVersion: 'PostgreSQL 16.4 (Face Vid Phase 1B-1 Relational Storage)';
  savedAtIso: string;
  schemaMigrations: SchemaMigrationRecord[];
  foundingCreatorProgramState: {
    programId: 'FOUNDING_CREATOR_PROGRAM';
    maxEligibleCreators: 3000000;
    allocatedCount: number;
    allocationActive: false;
    updatedAtIso: string;
  };
  users: Record<string, PersistedUserRow>;
  userProfiles: Record<string, PersistedUserProfileRow>;
  userIdentitySettings: Record<string, PersistedIdentitySettingsRow>;
  roles: Record<string, PersistedRoleRow>;
  permissions: Record<string, { permissionCode: string; domain: string; description: string }>;
  rolePermissions: Array<{ roleCode: UserRole; permissionCode: string }>;
  userRoles: PersistedUserRoleRow[];
  creatorVerifications: Record<string, PersistedCreatorVerificationRow>;
  creatorAccounts: Record<string, PersistedCreatorAccountRow>;
  merchantAccounts: Record<string, PersistedMerchantAccountRow>;
  businessAdvertiserAccounts: Record<string, PersistedBusinessAdvertiserRow>;
  deviceSessions: Record<string, PersistedDeviceSessionRow>;
  tvPairingRecords: Record<string, PersistedTvPairingRow>;
  auditEvents: AuditEventRecord[];
  financialPolicyRegistry: Record<string, PersistedFinancialPolicyRow>;
  financialLedgerAccounts: Record<string, PersistedLedgerAccountRow>;
  creatorPayableAccounts: Record<string, PersistedCreatorPayableRow>;
  merchantPayableAccounts: Record<string, PersistedMerchantPayableRow>;
  platformRevenueAccounts: Record<string, PersistedPlatformRevenueRow>;
  financialJournalTransactions: Record<string, PersistedJournalHeaderRow>;
  financialLedgerEntries: PersistedLedgerEntryRow[];
  videoChannels: Record<string, PersistedVideoChannelRow>;
  videoCategories: Record<string, PersistedVideoCategoryRow>;
  videos: Record<string, PersistedVideoRow>;
  videoTags: Record<string, PersistedVideoTagRow>;
  videoTagMappings: PersistedVideoTagMappingRow[];
  videoUploadSessions: Record<string, PersistedVideoUploadSessionRow>;
  videoTranscodeRenditions: Record<string, PersistedVideoTranscodeRenditionRow>;
  videoProcessingJobs: Record<string, PersistedVideoProcessingJobRow>;
  authCredentials: Record<string, PersistedAuthCredentialRow>;
  authTokens: Record<string, PersistedAuthTokenRow>;
  passkeyCredentials: Record<string, PersistedPasskeyCredentialRow>;
  recoveryCodes: Record<string, PersistedRecoveryCodeRow>;
  userSubscriptions: Record<string, PersistedUserSubscriptionRow>;
  linkedIdentities: Record<string, PersistedLinkedIdentityRow>;
  chatConversations: Record<string, PersistedChatConversationRow>;
  directMessages: Record<string, PersistedDirectMessageRow>;
  blockedUsers: Record<string, PersistedBlockedUserRow>;
}

export type PostgresConnectionMode =
  | 'REAL_EXTERNAL_POSTGRES_16'
  | 'LOCAL_JSON_TEST_ADAPTER'
  | 'DISCONNECTED_FAIL_CLOSED';

export interface ResolvedPostgresConfigSummary {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly passwordConfigured: boolean;
  readonly isPlaceholderPassword: boolean;
  readonly sslEnabled: boolean;
  readonly sslMode: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
  readonly tlsRejectUnauthorized: boolean;
  readonly customCaConfigured: boolean;
  readonly configuredViaDatabaseUrl: boolean;
  readonly connectTimeoutMs: number;
  readonly maxPoolSize: number;
}

@Injectable()
export class DatabaseFoundationService {
  private pgPool: Pool | null = null;
  private lastPoolSignature: string | null = null;
  private readonly persistencePath: string;
  private readonly migrationsDir: string;
  private catalog!: PersistedDatabaseCatalog;
  private initialized = false;
  private connectionMode: PostgresConnectionMode = 'LOCAL_JSON_TEST_ADAPTER';
  private isTestAdapter = true;
  private liveServerVersion: string | null = null;
  private lastConnectionError: string | null = null;

  constructor() {
    const dataDir = path.resolve(process.cwd(), '.data', 'postgres16');
    fs.mkdirSync(dataDir, { recursive: true });
    this.persistencePath = path.join(dataDir, 'facevid_phase1b1_catalog.json');
    this.migrationsDir = path.resolve(
      process.cwd(),
      'infrastructure',
      'database',
      'migrations'
    );
    this.initializeCatalog();
  }

  public isProductionMode(): boolean {
    return (
      process.env.NODE_ENV === 'production' ||
      process.env.REQUIRE_EXTERNAL_INFRASTRUCTURE === 'true' ||
      process.env.FACEVID_ALLOW_TEST_ADAPTERS === 'false'
    );
  }

  public resolvePostgresConfig(): {
    poolConfig: PoolConfig;
    summary: ResolvedPostgresConfigSummary;
  } {
    const rawDatabaseUrl = (process.env.DATABASE_URL || '').trim();
    let host = (process.env.POSTGRES_HOST || process.env.SQL_HOST || '127.0.0.1').trim();
    let port = Number(process.env.POSTGRES_PORT || 5432);
    let database = (
      process.env.POSTGRES_DB ||
      process.env.SQL_DB_NAME ||
      'facevid_dev'
    ).trim();
    let user = (
      process.env.POSTGRES_USER ||
      process.env.SQL_USER ||
      'facevid_local_user'
    ).trim();
    let password = (
      process.env.POSTGRES_PASSWORD ||
      process.env.SQL_PASSWORD ||
      ''
    ).trim();
    let sslModeRaw = (process.env.POSTGRES_SSL_MODE || '').trim().toLowerCase();
    let sslFlagRaw = (process.env.POSTGRES_SSL || '').trim().toLowerCase();
    let configuredViaDatabaseUrl = false;

    if (
      rawDatabaseUrl.startsWith('postgresql://') ||
      rawDatabaseUrl.startsWith('postgres://')
    ) {
      try {
        const parsed = new URL(rawDatabaseUrl);
        configuredViaDatabaseUrl = true;
        if (parsed.hostname) host = parsed.hostname;
        if (parsed.port) port = Number(parsed.port);
        if (parsed.username) user = decodeURIComponent(parsed.username);
        if (parsed.password) password = decodeURIComponent(parsed.password);
        if (parsed.pathname && parsed.pathname.length > 1) {
          database = decodeURIComponent(parsed.pathname.slice(1));
        }
        const urlSslMode = parsed.searchParams.get('sslmode')?.toLowerCase();
        if (urlSslMode && !sslModeRaw) {
          sslModeRaw = urlSslMode;
        }
        const urlSsl = parsed.searchParams.get('ssl')?.toLowerCase();
        if (urlSsl && !sslFlagRaw) {
          sslFlagRaw = urlSsl;
        }
      } catch (err) {
        throw new Error(
          `Invalid DATABASE_URL format: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    const validSslModes = [
      'disable',
      'prefer',
      'require',
      'verify-ca',
      'verify-full',
    ] as const;
    const sslMode: ResolvedPostgresConfigSummary['sslMode'] = (
      validSslModes as readonly string[]
    ).includes(sslModeRaw)
      ? (sslModeRaw as ResolvedPostgresConfigSummary['sslMode'])
      : sslFlagRaw === 'true' || sslFlagRaw === '1'
        ? 'require'
        : 'disable';

    const sslEnabled =
      sslMode !== 'disable' || sslFlagRaw === 'true' || sslFlagRaw === '1';
    const tlsRejectUnauthorized =
      process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== undefined
        ? process.env.POSTGRES_SSL_REJECT_UNAUTHORIZED !== 'false'
        : sslMode === 'verify-ca' || sslMode === 'verify-full';

    const rawCa = (process.env.POSTGRES_SSL_CA || '').trim();
    let caCert: string | undefined;
    if (rawCa) {
      if (rawCa.includes('BEGIN CERTIFICATE')) {
        caCert = rawCa.replace(/\\n/g, '\n');
      } else if (fs.existsSync(rawCa)) {
        caCert = fs.readFileSync(rawCa, 'utf8');
      }
    }

    const connectTimeoutMs = Number(process.env.POSTGRES_CONNECT_TIMEOUT_MS || 5000);
    const maxPoolSize = Number(process.env.POSTGRES_POOL_MAX || 10);
    const isPlaceholderPassword =
      !password ||
      password === 'CHANGE_ME_LOCAL_DEV_ONLY' ||
      password === 'facevid_local_pass';

    const poolConfig: PoolConfig = {
      host,
      port,
      user,
      password: password || 'facevid_local_pass',
      database,
      max: maxPoolSize,
      connectionTimeoutMillis: connectTimeoutMs,
      ...(sslEnabled
        ? {
            ssl: {
              rejectUnauthorized: tlsRejectUnauthorized,
              ...(caCert ? { ca: caCert } : {}),
            },
          }
        : {}),
    };

    return {
      poolConfig,
      summary: {
        host,
        port,
        database,
        user,
        passwordConfigured: Boolean(password) && !isPlaceholderPassword,
        isPlaceholderPassword,
        sslEnabled,
        sslMode,
        tlsRejectUnauthorized,
        customCaConfigured: Boolean(caCert),
        configuredViaDatabaseUrl,
        connectTimeoutMs,
        maxPoolSize,
      },
    };
  }

  /**
   * Configures pg.Pool using discrete Object-Method fields with TLS support.
   */
  public getPgPool(): Pool {
    const { poolConfig, summary } = this.resolvePostgresConfig();
    const signature = JSON.stringify({
      host: summary.host,
      port: summary.port,
      database: summary.database,
      user: summary.user,
      sslEnabled: summary.sslEnabled,
      sslMode: summary.sslMode,
      tlsRejectUnauthorized: summary.tlsRejectUnauthorized,
    });

    if (!this.pgPool || this.lastPoolSignature !== signature) {
      if (this.pgPool) {
        this.pgPool.end().catch(() => {});
      }
      this.pgPool = new Pool(poolConfig);
      this.lastPoolSignature = signature;
      this.pgPool.on('error', (err) => {
        this.lastConnectionError = err.message;
        apiLogger.warn('Idle PostgreSQL pool client error', { error: err.message });
      });
    }
    return this.pgPool;
  }

  private initializeCatalog(): void {
    if (fs.existsSync(this.persistencePath)) {
      try {
        const raw = fs.readFileSync(this.persistencePath, 'utf8');
        this.catalog = JSON.parse(raw) as PersistedDatabaseCatalog;
        this.catalog.videoChannels = this.catalog.videoChannels || {};
        this.catalog.videoCategories = this.catalog.videoCategories || {};
        this.catalog.videos = this.catalog.videos || {};
        this.catalog.videoTags = this.catalog.videoTags || {};
        this.catalog.videoTagMappings = this.catalog.videoTagMappings || [];
        this.catalog.videoUploadSessions = this.catalog.videoUploadSessions || {};
        this.catalog.videoTranscodeRenditions = this.catalog.videoTranscodeRenditions || {};
        this.catalog.videoProcessingJobs = this.catalog.videoProcessingJobs || {};
        this.catalog.authCredentials = this.catalog.authCredentials || {};
        this.catalog.authTokens = this.catalog.authTokens || {};
        this.catalog.passkeyCredentials = this.catalog.passkeyCredentials || {};
        this.catalog.recoveryCodes = this.catalog.recoveryCodes || {};
        this.catalog.userSubscriptions = this.catalog.userSubscriptions || {};
        this.catalog.linkedIdentities = this.catalog.linkedIdentities || {};
        this.catalog.chatConversations = this.catalog.chatConversations || {};
        this.catalog.directMessages = this.catalog.directMessages || {};
        this.runVersionedMigrations();
        this.seedBaselineRecordsIfNeeded();
        this.initialized = true;
        return;
      } catch {
        // Re-initialize below on corrupted file
      }
    }

    const nowIso = new Date().toISOString();
    this.catalog = {
      engineVersion: 'PostgreSQL 16.4 (Face Vid Phase 1B-1 Relational Storage)',
      savedAtIso: nowIso,
      schemaMigrations: [],
      foundingCreatorProgramState: {
        programId: 'FOUNDING_CREATOR_PROGRAM',
        maxEligibleCreators: 3000000,
        allocatedCount: 0,
        allocationActive: false,
        updatedAtIso: nowIso,
      },
      users: {},
      userProfiles: {},
      userIdentitySettings: {},
      roles: {},
      permissions: {},
      rolePermissions: [],
      userRoles: [],
      creatorVerifications: {},
      creatorAccounts: {},
      merchantAccounts: {},
      businessAdvertiserAccounts: {},
      deviceSessions: {},
      tvPairingRecords: {},
      auditEvents: [],
      financialPolicyRegistry: {},
      financialLedgerAccounts: {},
      creatorPayableAccounts: {},
      merchantPayableAccounts: {},
      platformRevenueAccounts: {},
      financialJournalTransactions: {},
      financialLedgerEntries: [],
      videoChannels: {},
      videoCategories: {},
      videos: {},
      videoTags: {},
      videoTagMappings: [],
      videoUploadSessions: {},
      videoTranscodeRenditions: {},
      videoProcessingJobs: {},
      authCredentials: {},
      authTokens: {},
      passkeyCredentials: {},
      recoveryCodes: {},
      userSubscriptions: {},
      linkedIdentities: {},
      chatConversations: {},
      directMessages: {},
      blockedUsers: {},
    };

    this.runVersionedMigrations();
    this.seedBaselineRecordsIfNeeded();
    this.initialized = true;
  }

  /**
   * Hardened atomic catalog persistence.
   * Writes to a unique temporary file, flushes & fsyncs to disk, then atomically renames
   * over the target path to prevent file corruption during crashes or interruptions.
   */
  public persistCatalog(): void {
    try {
      this.catalog.savedAtIso = new Date().toISOString();
      const serialized = JSON.stringify(this.catalog, null, 2);
      const dir = path.dirname(this.persistencePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const tempPath = `${this.persistencePath}.tmp.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
      const fd = fs.openSync(tempPath, 'w');
      try {
        fs.writeSync(fd, serialized, 0, 'utf8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      // Atomic rename replaces destination file without corrupted intermediate states
      fs.renameSync(tempPath, this.persistencePath);
    } catch (err) {
      apiLogger.warn('Non-fatal catalog persistence notice', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Verifies connectivity, authentication, TLS status, and PostgreSQL 16+ version
   * against a real external PostgreSQL instance.
   * Never binds a fake local TCP listener.
   * In production mode, fails closed if the external PostgreSQL 16 instance is missing or unreachable.
   */
  public async verifyExternalPostgresConnection(): Promise<{
    connected: boolean;
    connectionMode: PostgresConnectionMode;
    isTestAdapter: boolean;
    productionReady: boolean;
    host: string;
    port: number;
    serverVersion: string | null;
    error: string | null;
  }> {
    const strictProd = this.isProductionMode();
    const { summary } = this.resolvePostgresConfig();

    const isUnconfiguredLocalDefault =
      (summary.host === '127.0.0.1' || summary.host === 'localhost') &&
      summary.isPlaceholderPassword &&
      !summary.configuredViaDatabaseUrl;

    if (strictProd && isUnconfiguredLocalDefault) {
      this.connectionMode = 'DISCONNECTED_FAIL_CLOSED';
      this.isTestAdapter = false;
      this.liveServerVersion = null;
      this.lastConnectionError =
        '[FAIL_CLOSED] Production mode requires external managed PostgreSQL 16 credentials (POSTGRES_HOST/POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB or DATABASE_URL). Local JSON test adapter substitution is prohibited.';
      throw new Error(this.lastConnectionError);
    }

    const tcpReachable = await new Promise<boolean>((resolve) => {
      const sock = new net.Socket();
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        sock.destroy();
        resolve(ok);
      };
      sock.setTimeout(Math.min(summary.connectTimeoutMs, 1500));
      sock.once('connect', () => finish(true));
      sock.once('timeout', () => finish(false));
      sock.once('error', () => finish(false));
      sock.connect(summary.port, summary.host);
    });

    if (!tcpReachable) {
      const errMsg = `External PostgreSQL 16 TCP socket unreachable at ${summary.host}:${summary.port}`;
      this.lastConnectionError = errMsg;
      this.liveServerVersion = null;
      if (strictProd) {
        this.connectionMode = 'DISCONNECTED_FAIL_CLOSED';
        this.isTestAdapter = false;
        throw new Error(
          `[FAIL_CLOSED] ${errMsg}. Local JSON test adapter substitution is prohibited in production mode.`
        );
      }
      this.connectionMode = 'LOCAL_JSON_TEST_ADAPTER';
      this.isTestAdapter = true;
      return {
        connected: false,
        connectionMode: this.connectionMode,
        isTestAdapter: true,
        productionReady: false,
        host: summary.host,
        port: summary.port,
        serverVersion: null,
        error: errMsg,
      };
    }

    try {
      const pool = this.getPgPool();
      const res = await pool.query<{
        full_version: string;
        version_num: number;
      }>(
        "SELECT version() AS full_version, current_setting('server_version_num')::int AS version_num"
      );
      const row = res.rows[0];
      if (!row || row.version_num < 160000) {
        throw new Error(
          `Expected PostgreSQL 16+ (server_version_num >= 160000), received: ${row?.full_version || 'unknown'}`
        );
      }

      this.connectionMode = 'REAL_EXTERNAL_POSTGRES_16';
      this.isTestAdapter = false;
      this.liveServerVersion = row.full_version;
      this.lastConnectionError = null;

      return {
        connected: true,
        connectionMode: 'REAL_EXTERNAL_POSTGRES_16',
        isTestAdapter: false,
        productionReady: true,
        host: summary.host,
        port: summary.port,
        serverVersion: row.full_version,
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.lastConnectionError = message;
      this.liveServerVersion = null;
      if (strictProd) {
        this.connectionMode = 'DISCONNECTED_FAIL_CLOSED';
        this.isTestAdapter = false;
        throw new Error(
          `[FAIL_CLOSED] External PostgreSQL 16 handshake/authentication failed at ${summary.host}:${summary.port}: ${message}`
        );
      }
      this.connectionMode = 'LOCAL_JSON_TEST_ADAPTER';
      this.isTestAdapter = true;
      return {
        connected: false,
        connectionMode: 'LOCAL_JSON_TEST_ADAPTER',
        isTestAdapter: true,
        productionReady: false,
        host: summary.host,
        port: summary.port,
        serverVersion: null,
        error: message,
      };
    }
  }

  public async ensureListening(): Promise<{
    host: string;
    port: number;
    mode: PostgresConnectionMode;
    isTestAdapter: boolean;
    productionReady: boolean;
  }> {
    const status = await this.verifyExternalPostgresConnection();
    return {
      host: status.host,
      port: status.port,
      mode: status.connectionMode,
      isTestAdapter: status.isTestAdapter,
      productionReady: status.productionReady,
    };
  }

  /**
   * Executes the versioned SQL migration files (`0001`, `0002`, `0003`) directly
   * against a live external PostgreSQL 16 instance inside atomic `BEGIN ... COMMIT`
   * transactions with SHA-256 checksum verification in `schema_migrations`.
   */
  public async executeExternalPostgresMigrations(): Promise<{
    executedOnExternalPostgres16: true;
    serverVersion: string;
    appliedMigrations: readonly SchemaMigrationRecord[];
  }> {
    const verification = await this.verifyExternalPostgresConnection();
    if (!verification.connected || verification.connectionMode !== 'REAL_EXTERNAL_POSTGRES_16') {
      throw new Error(
        `Cannot execute live PostgreSQL 16 migrations: external PostgreSQL 16 is not connected (${verification.error || 'unreachable'}).`
      );
    }

    const pool = this.getPgPool();
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version VARCHAR(32) PRIMARY KEY,
          filename VARCHAR(255) NOT NULL UNIQUE,
          checksum_sha256 CHAR(64) NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);

      const existingRows = await client.query<{
        version: string;
        filename: string;
        checksum_sha256: string;
        applied_at: Date;
      }>('SELECT version, filename, checksum_sha256, applied_at FROM schema_migrations ORDER BY version ASC');

      const existingMap = new Map(
        existingRows.rows.map((r) => [r.filename, r])
      );

      const files = fs
        .readdirSync(this.migrationsDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      const results: SchemaMigrationRecord[] = [];

      for (const filename of files) {
        const fullPath = path.join(this.migrationsDir, filename);
        const sqlContent = fs.readFileSync(fullPath, 'utf8');
        const checksumSha256 = crypto
          .createHash('sha256')
          .update(sqlContent)
          .digest('hex');
        const version = filename.split('_')[0] || filename;

        const tableMatches = [
          ...sqlContent.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)/gi),
        ].map((m) => m[1]!);
        const triggerMatches = [
          ...sqlContent.matchAll(/CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+([a-z0-9_]+)/gi),
        ].map((m) => m[1]!);

        const prev = existingMap.get(filename);
        if (prev) {
          if (prev.checksum_sha256.trim() !== checksumSha256) {
            throw new Error(
              `Migration Checksum Mismatch on external PostgreSQL 16: ${filename} was modified after being applied.`
            );
          }
          results.push({
            version,
            filename,
            checksumSha256,
            appliedAtIso: new Date(prev.applied_at).toISOString(),
            tablesCreated: tableMatches,
            triggersCreated: triggerMatches,
          });
          continue;
        }

        await client.query('BEGIN');
        try {
          await client.query(sqlContent);
          await client.query(
            'INSERT INTO schema_migrations (version, filename, checksum_sha256) VALUES ($1, $2, $3)',
            [version, filename, checksumSha256]
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }

        results.push({
          version,
          filename,
          checksumSha256,
          appliedAtIso: new Date().toISOString(),
          tablesCreated: tableMatches,
          triggersCreated: triggerMatches,
        });
      }

      return {
        executedOnExternalPostgres16: true,
        serverVersion: verification.serverVersion || 'PostgreSQL 16',
        appliedMigrations: results,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Reads versioned SQL files from `infrastructure/database/migrations/*.sql`,
   * validates their DDL structure (tables, triggers, constraints), and records
   * SHA-256 checksums in `schema_migrations`.
   */
  public runVersionedMigrations(): readonly SchemaMigrationRecord[] {
    if (!fs.existsSync(this.migrationsDir)) {
      return this.catalog.schemaMigrations;
    }

    const files = fs
      .readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      const fullPath = path.join(this.migrationsDir, filename);
      const sqlContent = fs.readFileSync(fullPath, 'utf8');
      const checksumSha256 = crypto
        .createHash('sha256')
        .update(sqlContent)
        .digest('hex');
      const version = filename.split('_')[0] || filename;

      const existing = this.catalog.schemaMigrations.find(
        (m) => m.version === version && m.filename === filename
      );
      if (existing) {
        if (existing.checksumSha256 !== checksumSha256) {
          throw new Error(
            `Migration Checksum Mismatch: ${filename} was modified after being applied.`
          );
        }
        continue;
      }

      const tableMatches = [
        ...sqlContent.matchAll(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-z0-9_]+)/gi),
      ].map((m) => m[1]!);
      const triggerMatches = [
        ...sqlContent.matchAll(/CREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+([a-z0-9_]+)/gi),
      ].map((m) => m[1]!);

      this.catalog.schemaMigrations.push({
        version,
        filename,
        checksumSha256,
        appliedAtIso: new Date().toISOString(),
        tablesCreated: tableMatches,
        triggersCreated: triggerMatches,
      });
    }

    this.persistCatalog();
    return this.catalog.schemaMigrations;
  }

  private seedBaselineRecordsIfNeeded(): void {
    const nowIso = new Date().toISOString();

    // 1. Seed Roles
    const roleSpecs: PersistedRoleRow[] = [
      {
        roleCode: UserRole.USER,
        displayName: 'Authenticated User',
        requiresPhishingResistantMfa: false,
        allowPublicSelfRegistration: true,
      },
      {
        roleCode: UserRole.CREATOR,
        displayName: 'Verified Creator',
        requiresPhishingResistantMfa: false,
        allowPublicSelfRegistration: false,
      },
      {
        roleCode: UserRole.MERCHANT,
        displayName: 'Face Vid Shop Merchant',
        requiresPhishingResistantMfa: true,
        allowPublicSelfRegistration: false,
      },
      {
        roleCode: UserRole.ADVERTISER,
        displayName: 'Face Vid Business Advertiser',
        requiresPhishingResistantMfa: true,
        allowPublicSelfRegistration: false,
      },
      {
        roleCode: UserRole.MODERATOR,
        displayName: 'Trust & Safety Moderator',
        requiresPhishingResistantMfa: true,
        allowPublicSelfRegistration: false,
      },
      {
        roleCode: UserRole.ADMIN,
        displayName: 'Platform Administrator',
        requiresPhishingResistantMfa: true,
        allowPublicSelfRegistration: false,
      },
      {
        roleCode: UserRole.SUPER_ADMIN,
        displayName: 'Super Administrator',
        requiresPhishingResistantMfa: true,
        allowPublicSelfRegistration: false,
      },
      {
        roleCode: UserRole.OWNER,
        displayName: 'Platform Owner',
        requiresPhishingResistantMfa: true,
        allowPublicSelfRegistration: false,
      },
    ];
    for (const r of roleSpecs) {
      this.catalog.roles[r.roleCode] = r;
    }

    // 2. Seed Permissions & Role-Permission mappings
    const permSpecs = [
      {
        permissionCode: 'identity:switch_public_private',
        domain: 'IDENTITY',
        description: 'Switch between Public identity and Avatar-based Private persona',
      },
      {
        permissionCode: 'tv:authorize_device_pairing',
        domain: 'TV_PAIRING',
        description: 'Confirm QR/short-code TV pairing from authenticated phone or web session',
      },
      {
        permissionCode: 'creator:accept_prepaid_calls',
        domain: 'CREATOR',
        description: 'Receive server-authoritative prepaid user-to-creator calls',
      },
      {
        permissionCode: 'merchant:manage_shop_catalog',
        domain: 'SHOP',
        description: 'Manage Face Vid Shop merchant inventory and creator ad offers',
      },
      {
        permissionCode: 'advertiser:submit_campaign_for_human_review',
        domain: 'BUSINESS_ADS',
        description: 'Submit Face Vid Business ad campaign for mandatory human review',
      },
      {
        permissionCode: 'owner:authorize_financial_policy',
        domain: 'FINANCIAL_GOVERNANCE',
        description: 'Cryptographically authorize commission rates, pricing, and payment activation',
      },
    ];
    for (const p of permSpecs) {
      this.catalog.permissions[p.permissionCode] = p;
    }

    // 3. Seed the 5 Financial Policy Registry Rows (payments_active = FALSE, rates = NULL)
    for (const contract of FIVE_MONETIZATION_ENGINE_CONTRACTS) {
      if (!this.catalog.financialPolicyRegistry[contract.engineId]) {
        this.catalog.financialPolicyRegistry[contract.engineId] = {
          engineId: contract.engineId,
          displayName: contract.displayName,
          paymentsActive: false,
          commissionBasisPoints: null,
          basePriceMinorUnits: null,
          updatedByActorId: 'SYSTEM_MIGRATION_0003',
          updatedByActorType: AuditActorType.SYSTEM_SERVICE,
          ownerApprovalTicketId: null,
          ownerCryptographicSignature: null,
          updatedAtIso: nowIso,
        };
      }
    }

    // 4. Seed baseline Verified User, Creator, Merchant, Advertiser & Segregated Payable/Revenue Accounts
    if (!this.catalog.users['usr_verified_8841']) {
      this.upsertUserWithProfileAndSettings({
        userId: 'usr_verified_8841',
        primaryEmail: 'creator.maya@facevid.example',
        legalFullName: 'Maya Lin (Server-Protected Legal Identity)',
        countryIsoCode: 'GB',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.AI_STUDIO_PRO,
        mfaEnrolled: true,
        phishingResistantMfaVerified: true,
        publicDisplayName: 'Maya Lin Studio',
        publicHandle: '@mayalin_fv',
        publicBio: 'Real-time AI cinema & interactive live creator.',
        publicAvatarUrl: '/assets/avatars/maya-public.png',
        publicVerifiedBadge: true,
        privatePseudonym: 'NeonCipher_99',
        privateAvatarSeedId: 'seed_neon_cipher_99',
        privateAvatarStyle: 'NEON_SILHOUETTE',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.WORLDWIDE,
      });

      this.assignUserRole({
        userId: 'usr_verified_8841',
        roleCode: UserRole.USER,
        grantedByActorId: 'SYSTEM_BOOTSTRAP',
        grantedByActorType: AuditActorType.SYSTEM_SERVICE,
      });
      this.assignUserRole({
        userId: 'usr_verified_8841',
        roleCode: UserRole.CREATOR,
        grantedByActorId: 'usr_human_mod_01',
        grantedByActorType: AuditActorType.ADMIN,
      });

      this.upsertCreatorVerificationAndAccount({
        verificationId: 'ver_founding_000001',
        userId: 'usr_verified_8841',
        externalPlatformName: 'YouTube',
        externalAccountHandle: '@mayalin_cinema',
        ownershipProofDigest: crypto
          .createHash('sha256')
          .update('ownership_proof_usr_verified_8841')
          .digest('hex'),
        aiAssistiveScore: 96.5,
        humanReviewerUserId: 'usr_human_mod_01',
        verificationStatus: 'VERIFIED_ELIGIBLE',
        foundingSlotNumber: null, // Allocation inactive in Phase 1B-1
        creatorId: 'crt_maya_8841',
        channelHandle: '@mayalin_fv',
        channelDisplayName: 'Maya Lin Official',
      });
    }

    if (!this.catalog.users['usr_merchant_4410']) {
      this.upsertUserWithProfileAndSettings({
        userId: 'usr_merchant_4410',
        primaryEmail: 'merchant.lumina@facevid.example',
        legalFullName: 'Lumina Optics Ltd',
        countryIsoCode: 'GB',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.PREMIUM_AD_FREE,
        mfaEnrolled: true,
        phishingResistantMfaVerified: true,
        publicDisplayName: 'Lumina Camera Gear',
        publicHandle: '@lumina_shop',
        publicBio: 'Official Face Vid Shop Merchant for creator lighting & optics.',
        publicAvatarUrl: '/assets/avatars/lumina-shop.png',
        publicVerifiedBadge: true,
        privatePseudonym: 'GeometricShield_44',
        privateAvatarSeedId: 'seed_geo_shield_44',
        privateAvatarStyle: 'GEOMETRIC_SHIELD',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.COUNTRY,
      });

      this.assignUserRole({
        userId: 'usr_merchant_4410',
        roleCode: UserRole.MERCHANT,
        grantedByActorId: 'usr_human_mod_01',
        grantedByActorType: AuditActorType.ADMIN,
      });

      this.upsertMerchantAccount({
        merchantId: 'mrc_lumina_4410',
        ownerUserId: 'usr_merchant_4410',
        shopName: 'Lumina Camera & Studio Gear',
        shopSlug: 'lumina-camera-gear',
        kybVerificationStatus: 'VERIFIED',
        registrationCountryIso: 'GB',
        liveShoppingEnabled: false,
      });
    }

    if (!this.catalog.users['usr_advertiser_7720']) {
      this.upsertUserWithProfileAndSettings({
        userId: 'usr_advertiser_7720',
        primaryEmail: 'ads.apex@facevid.example',
        legalFullName: 'Apex Global Media Group PLC',
        countryIsoCode: 'US',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.PREMIUM_AD_FREE,
        mfaEnrolled: true,
        phishingResistantMfaVerified: true,
        publicDisplayName: 'Apex Global Media',
        publicHandle: '@apex_media',
        publicBio: 'Enterprise brand partner.',
        publicAvatarUrl: '/assets/avatars/apex-media.png',
        publicVerifiedBadge: true,
        privatePseudonym: 'CinematicMask_77',
        privateAvatarSeedId: 'seed_cinematic_77',
        privateAvatarStyle: 'CINEMATIC_MASK',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.WORLDWIDE,
      });

      this.assignUserRole({
        userId: 'usr_advertiser_7720',
        roleCode: UserRole.ADVERTISER,
        grantedByActorId: 'usr_human_mod_01',
        grantedByActorType: AuditActorType.ADMIN,
      });

      this.upsertBusinessAdvertiserAccount({
        advertiserId: 'adv_apex_7720',
        ownerUserId: 'usr_advertiser_7720',
        organizationLegalName: 'Apex Global Media Group PLC',
        taxRegistrationRef: 'US-EIN-99-4421087',
        complianceStatus: 'APPROVED',
      });
    }

    if (!this.catalog.users['usr_human_mod_01']) {
      this.upsertUserWithProfileAndSettings({
        userId: 'usr_human_mod_01',
        primaryEmail: 'admin.moderator@facevid.example',
        legalFullName: 'FACE VID Compliance Officer',
        countryIsoCode: 'GB',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.PREMIUM_AD_FREE,
        mfaEnrolled: true,
        phishingResistantMfaVerified: true,
        publicDisplayName: 'Super Admin Operations',
        publicHandle: '@admin_ops',
        publicBio: 'Platform governance, creator verification & compliance review.',
        publicAvatarUrl: '/assets/avatars/admin.png',
        publicVerifiedBadge: true,
        privatePseudonym: 'AdminShield_01',
        privateAvatarSeedId: 'seed_admin_01',
        privateAvatarStyle: 'GEOMETRIC_SHIELD',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.WORLDWIDE,
      });

      this.assignUserRole({
        userId: 'usr_human_mod_01',
        roleCode: UserRole.ADMIN,
        grantedByActorId: 'SYSTEM_BOOTSTRAP',
        grantedByActorType: AuditActorType.SYSTEM_SERVICE,
      });
      this.assignUserRole({
        userId: 'usr_human_mod_01',
        roleCode: UserRole.MODERATOR,
        grantedByActorId: 'SYSTEM_BOOTSTRAP',
        grantedByActorType: AuditActorType.SYSTEM_SERVICE,
      });
    }

    if (!this.catalog.users['usr_marcus_optics']) {
      this.upsertUserWithProfileAndSettings({
        userId: 'usr_marcus_optics',
        primaryEmail: 'marcus.vance@facevid.example',
        legalFullName: 'Marcus Vance Optics',
        countryIsoCode: 'US',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.PREMIUM_AD_FREE,
        mfaEnrolled: true,
        phishingResistantMfaVerified: false,
        publicDisplayName: 'Marcus Vance Optics',
        publicHandle: '@marcusoptics',
        publicBio: 'Cinematic optical consultation & anamorphic lenses.',
        publicAvatarUrl: '/src/assets/images/thumb_tech_review_1791448435160.jpg',
        publicVerifiedBadge: true,
        privatePseudonym: 'NeonSpecter_44',
        privateAvatarSeedId: 'seed_marcus_44',
        privateAvatarStyle: 'NEON_SILHOUETTE',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.WORLDWIDE,
      });
      this.assignUserRole({
        userId: 'usr_marcus_optics',
        roleCode: UserRole.CREATOR,
        grantedByActorId: 'SYSTEM_BOOTSTRAP',
        grantedByActorType: AuditActorType.SYSTEM_SERVICE,
      });
    }

    if (!this.catalog.users['usr_facevid_support']) {
      this.upsertUserWithProfileAndSettings({
        userId: 'usr_facevid_support',
        primaryEmail: 'concierge@facevid.com',
        legalFullName: 'FACE VID Launch Concierge',
        countryIsoCode: 'GB',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.PREMIUM_AD_FREE,
        mfaEnrolled: true,
        phishingResistantMfaVerified: true,
        publicDisplayName: 'FACE VID Launch Concierge',
        publicHandle: '@facevid_launch',
        publicBio: 'Official FACE VID concierge & platform guidance.',
        publicAvatarUrl: '/assets/owner/face-vid-official-logo.png',
        publicVerifiedBadge: true,
        privatePseudonym: 'ConciergeShield_01',
        privateAvatarSeedId: 'seed_concierge',
        privateAvatarStyle: 'GEOMETRIC_SHIELD',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.WORLDWIDE,
      });
    }

    // 5. Ensure Segregated Financial Ledger Accounts, Creator Payable, Merchant Payable, and Platform Revenue Accounts exist
    this.ensureLedgerAndPayableAccounts('USD');

    // 6. Seed Baseline Video Categories, Channels, and Videos (Phase 1 Task 1.1A)
    this.seedBaselineVideoCatalogIfNeeded();

    this.persistCatalog();
  }

  public ensureLedgerAndPayableAccounts(currencyIso = 'USD'): void {
    const nowIso = new Date().toISOString();

    const registerLedgerAccount = (
      accountId: string,
      ownerEntityId: string,
      segregationDomain: AccountSegregationDomain
    ) => {
      if (!this.catalog.financialLedgerAccounts[accountId]) {
        this.catalog.financialLedgerAccounts[accountId] = {
          accountId,
          ownerEntityId,
          segregationDomain,
          currencyIso,
          createdAtIso: nowIso,
        };
      }
    };

    registerLedgerAccount(
      'acct_user_prepaid_wallet_usr_8841',
      'usr_verified_8841',
      AccountSegregationDomain.USER_PREPAID_WALLET
    );
    registerLedgerAccount(
      'acct_creator_call_escrow_crt_8841',
      'crt_maya_8841',
      AccountSegregationDomain.CREATOR_CALL_ESCROW
    );
    registerLedgerAccount(
      'acct_creator_payable_crt_8841',
      'crt_maya_8841',
      AccountSegregationDomain.CREATOR_EARNINGS_PAYABLE
    );
    registerLedgerAccount(
      'acct_creator_ad_escrow_crt_8841',
      'crt_maya_8841',
      AccountSegregationDomain.CREATOR_AD_SERVICE_ESCROW
    );
    registerLedgerAccount(
      'acct_merchant_order_escrow_mrc_4410',
      'mrc_lumina_4410',
      AccountSegregationDomain.MERCHANT_ORDER_ESCROW
    );
    registerLedgerAccount(
      'acct_merchant_payable_mrc_4410',
      'mrc_lumina_4410',
      AccountSegregationDomain.MERCHANT_SALES_PAYABLE
    );
    registerLedgerAccount(
      'acct_merchant_chargeback_reserve_mrc_4410',
      'mrc_lumina_4410',
      AccountSegregationDomain.MERCHANT_CHARGEBACK_RESERVE
    );
    registerLedgerAccount(
      'acct_advertiser_escrow_adv_7720',
      'adv_apex_7720',
      AccountSegregationDomain.ADVERTISER_CAMPAIGN_ESCROW
    );
    registerLedgerAccount(
      'acct_platform_commission_rev_usd',
      'FACE_VID_PLATFORM',
      AccountSegregationDomain.PLATFORM_COMMISSION_REVENUE
    );
    registerLedgerAccount(
      'acct_platform_ad_rev_usd',
      'FACE_VID_PLATFORM',
      AccountSegregationDomain.PLATFORM_AD_REVENUE
    );
    registerLedgerAccount(
      'acct_platform_aistudio_rev_usd',
      'FACE_VID_PLATFORM',
      AccountSegregationDomain.PLATFORM_AI_STUDIO_REVENUE
    );

    if (!this.catalog.creatorPayableAccounts['cpay_crt_maya_8841_usd']) {
      this.catalog.creatorPayableAccounts['cpay_crt_maya_8841_usd'] = {
        creatorPayableAccountId: 'cpay_crt_maya_8841_usd',
        creatorId: 'crt_maya_8841',
        ledgerAccountId: 'acct_creator_payable_crt_8841',
        segregationDomain: AccountSegregationDomain.CREATOR_EARNINGS_PAYABLE,
        currencyIso,
        settledBalanceMinorUnits: 0,
        escrowReservedMinorUnits: 0,
        payoutFrozen: false,
        createdAtIso: nowIso,
      };
    }

    if (!this.catalog.merchantPayableAccounts['mpay_mrc_lumina_4410_usd']) {
      this.catalog.merchantPayableAccounts['mpay_mrc_lumina_4410_usd'] = {
        merchantPayableAccountId: 'mpay_mrc_lumina_4410_usd',
        merchantId: 'mrc_lumina_4410',
        ledgerAccountId: 'acct_merchant_payable_mrc_4410',
        segregationDomain: AccountSegregationDomain.MERCHANT_SALES_PAYABLE,
        currencyIso,
        settledBalanceMinorUnits: 0,
        chargebackReserveMinorUnits: 0,
        payoutFrozen: false,
        createdAtIso: nowIso,
      };
    }

    const revSpecs: PersistedPlatformRevenueRow[] = [
      {
        revenueAccountId: 'prev_eng1_calls_usd',
        engineId: MonetizationEngineId.ENGINE_1_PREPAID_CREATOR_CALLS,
        ledgerAccountId: 'acct_platform_commission_rev_usd',
        segregationDomain: AccountSegregationDomain.PLATFORM_COMMISSION_REVENUE,
        currencyIso,
        settledRevenueMinorUnits: 0,
        createdAtIso: nowIso,
      },
      {
        revenueAccountId: 'prev_eng4_ads_usd',
        engineId: MonetizationEngineId.ENGINE_4_BUSINESS_AD_REVENUE,
        ledgerAccountId: 'acct_platform_ad_rev_usd',
        segregationDomain: AccountSegregationDomain.PLATFORM_AD_REVENUE,
        currencyIso,
        settledRevenueMinorUnits: 0,
        createdAtIso: nowIso,
      },
      {
        revenueAccountId: 'prev_eng5_aistudio_usd',
        engineId: MonetizationEngineId.ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS,
        ledgerAccountId: 'acct_platform_aistudio_rev_usd',
        segregationDomain: AccountSegregationDomain.PLATFORM_AI_STUDIO_REVENUE,
        currencyIso,
        settledRevenueMinorUnits: 0,
        createdAtIso: nowIso,
      },
    ];
    for (const r of revSpecs) {
      if (!this.catalog.platformRevenueAccounts[r.revenueAccountId]) {
        this.catalog.platformRevenueAccounts[r.revenueAccountId] = r;
      }
    }

    if (!this.catalog.deviceSessions['sess_valid_user_101']) {
      this.insertDeviceSession({
        sessionId: 'sess_valid_user_101',
        userId: 'usr_101',
        platformId: PlatformId.FACE_VID_WEB,
        experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
        rawSessionToken: 'fvsess_valid_user_token_101',
        deviceDisplayName: 'Smoke Test Client',
        expiresAtIso: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    if (!this.catalog.deviceSessions['sess_admin_mod_01']) {
      this.insertDeviceSession({
        sessionId: 'sess_admin_mod_01',
        userId: 'usr_human_mod_01',
        platformId: PlatformId.FACE_VID_WEB,
        experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
        rawSessionToken: 'fvsess_admin_mod_token_01',
        deviceDisplayName: 'Admin Compliance Workstation',
        expiresAtIso: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    if (!this.catalog.users['usr_admin_no_mfa']) {
      this.upsertUserWithProfileAndSettings({
        userId: 'usr_admin_no_mfa',
        primaryEmail: 'admin.nomfa@facevid.example',
        legalFullName: 'Admin Lacking Hardware MFA',
        countryIsoCode: 'GB',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.PREMIUM_AD_FREE,
        mfaEnrolled: false,
        phishingResistantMfaVerified: false,
        publicDisplayName: 'Admin No MFA',
        publicHandle: '@admin_nomfa',
        publicBio: 'Compliance test persona with unverified MFA.',
        publicAvatarUrl: '/assets/avatars/admin.png',
        publicVerifiedBadge: true,
        privatePseudonym: 'AdminNoMfaShield',
        privateAvatarSeedId: 'seed_admin_nomfa',
        privateAvatarStyle: 'GEOMETRIC_SHIELD',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.WORLDWIDE,
      });

      this.assignUserRole({
        userId: 'usr_admin_no_mfa',
        roleCode: UserRole.ADMIN,
        grantedByActorId: 'SYSTEM_BOOTSTRAP',
        grantedByActorType: AuditActorType.SYSTEM_SERVICE,
      });

      this.insertDeviceSession({
        sessionId: 'sess_admin_no_mfa',
        userId: 'usr_admin_no_mfa',
        platformId: PlatformId.FACE_VID_WEB,
        experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
        rawSessionToken: 'fvsess_admin_no_mfa_token',
        deviceDisplayName: 'Unverified Admin Workstation',
        expiresAtIso: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }

    if (!this.catalog.deviceSessions['sess_admin_expired']) {
      this.insertDeviceSession({
        sessionId: 'sess_admin_expired',
        userId: 'usr_human_mod_01',
        platformId: PlatformId.FACE_VID_WEB,
        experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
        rawSessionToken: 'fvsess_admin_expired_token',
        deviceDisplayName: 'Expired Admin Workstation',
        expiresAtIso: new Date(Date.now() - 3600_000).toISOString(),
      });
    }
  }

  // ===========================================================================
  // DOMAIN 1-7: USERS, PROFILES, IDENTITY SETTINGS, ROLES & ACCOUNTS
  // ===========================================================================
  public upsertUserWithProfileAndSettings(params: {
    userId: string;
    primaryEmail: string;
    mobileNumber?: string;
    legalFullName: string;
    countryIsoCode: string;
    accountStatus: AccountStatus;
    subscriptionTier: SubscriptionTier;
    mfaEnrolled: boolean;
    phishingResistantMfaVerified: boolean;
    publicDisplayName: string;
    publicHandle: string;
    publicBio: string;
    publicAvatarUrl: string;
    publicVerifiedBadge: boolean;
    privatePseudonym: string;
    privateAvatarSeedId: string;
    privateAvatarStyle: 'GEOMETRIC_SHIELD' | 'NEON_SILHOUETTE' | 'CINEMATIC_MASK';
    activeIdentityMode: IdentityMode;
    defaultLiveAudienceReach: LiveAudienceReach;
  }): {
    user: PersistedUserRow;
    profile: PersistedUserProfileRow;
    identitySettings: PersistedIdentitySettingsRow;
  } {
    const nowIso = new Date().toISOString();

    for (const existing of Object.values(this.catalog.users)) {
      if (
        existing.userId !== params.userId &&
        existing.primaryEmail.toLowerCase() === params.primaryEmail.toLowerCase()
      ) {
        throw new Error(
          `Unique Constraint Violation (users.primary_email): ${params.primaryEmail}`
        );
      }
    }

    const user: PersistedUserRow = {
      userId: params.userId,
      primaryEmail: params.primaryEmail,
      mobileNumber: params.mobileNumber,
      legalFullName: params.legalFullName,
      countryIsoCode: params.countryIsoCode,
      accountStatus: params.accountStatus,
      subscriptionTier: params.subscriptionTier,
      mfaEnrolled: params.mfaEnrolled,
      phishingResistantMfaVerified: params.phishingResistantMfaVerified,
      createdAtIso: this.catalog.users[params.userId]?.createdAtIso || nowIso,
      updatedAtIso: nowIso,
    };

    const profile: PersistedUserProfileRow = {
      userId: params.userId,
      publicDisplayName: params.publicDisplayName,
      publicHandle: params.publicHandle,
      publicBio: params.publicBio,
      publicAvatarUrl: params.publicAvatarUrl,
      publicVerifiedBadge: params.publicVerifiedBadge,
      privatePseudonym: params.privatePseudonym,
      privateAvatarSeedId: params.privateAvatarSeedId,
      privateAvatarStyle: params.privateAvatarStyle,
      updatedAtIso: nowIso,
    };

    const identitySettings: PersistedIdentitySettingsRow = {
      userId: params.userId,
      activeIdentityMode: params.activeIdentityMode,
      stripLegalIdentityInPeerPayloads: true,
      defaultLiveAudienceReach: params.defaultLiveAudienceReach,
      autoArchiveLiveStreams: false,
      updatedAtIso: nowIso,
    };

    this.catalog.users[params.userId] = user;
    this.catalog.userProfiles[params.userId] = profile;
    this.catalog.userIdentitySettings[params.userId] = identitySettings;
    this.persistCatalog();

    return { user, profile, identitySettings };
  }

  public assignUserRole(params: {
    userId: string;
    roleCode: UserRole;
    grantedByActorId: string;
    grantedByActorType: AuditActorType;
  }): PersistedUserRoleRow {
    if (params.grantedByActorType === AuditActorType.AI_AGENT) {
      throw new Error(
        'Check Constraint Violation (user_roles.granted_by_actor_type): AI_AGENT is prohibited from granting roles.'
      );
    }
    if (!this.catalog.users[params.userId]) {
      throw new Error(
        `Foreign Key Violation (user_roles.user_id): User ${params.userId} does not exist.`
      );
    }
    if (!this.catalog.roles[params.roleCode]) {
      throw new Error(
        `Foreign Key Violation (user_roles.role_code): Role ${params.roleCode} does not exist.`
      );
    }

    const existing = this.catalog.userRoles.find(
      (ur) => ur.userId === params.userId && ur.roleCode === params.roleCode
    );
    if (existing) return existing;

    const row: PersistedUserRoleRow = {
      userId: params.userId,
      roleCode: params.roleCode,
      grantedByActorId: params.grantedByActorId,
      grantedByActorType: params.grantedByActorType,
      grantedAtIso: new Date().toISOString(),
    };
    this.catalog.userRoles.push(row);
    this.persistCatalog();
    return row;
  }

  public upsertCreatorVerificationAndAccount(params: {
    verificationId: string;
    userId: string;
    externalPlatformName: string;
    externalAccountHandle: string;
    ownershipProofDigest: string;
    aiAssistiveScore: number;
    humanReviewerUserId: string | null;
    verificationStatus: 'PENDING_HUMAN_REVIEW' | 'VERIFIED_ELIGIBLE' | 'REJECTED';
    foundingSlotNumber: number | null;
    creatorId: string;
    channelHandle: string;
    channelDisplayName: string;
  }): {
    verification: PersistedCreatorVerificationRow;
    creatorAccount: PersistedCreatorAccountRow;
  } {
    if (!this.catalog.users[params.userId]) {
      throw new Error(`Foreign Key Violation: User ${params.userId} does not exist.`);
    }
    if (
      params.verificationStatus === 'VERIFIED_ELIGIBLE' &&
      !params.humanReviewerUserId
    ) {
      throw new Error(
        'Check Constraint Violation (chk_human_reviewer_required_for_verified): Human reviewer required for VERIFIED_ELIGIBLE.'
      );
    }

    const nowIso = new Date().toISOString();
    const verification: PersistedCreatorVerificationRow = {
      verificationId: params.verificationId,
      userId: params.userId,
      externalPlatformName: params.externalPlatformName,
      externalAccountHandle: params.externalAccountHandle,
      ownershipProofDigest: params.ownershipProofDigest,
      aiAssistiveScore: params.aiAssistiveScore,
      requiresHumanReview: true,
      humanReviewerUserId: params.humanReviewerUserId,
      verificationStatus: params.verificationStatus,
      foundingSlotNumber: params.foundingSlotNumber,
      createdAtIso: nowIso,
    };

    const creatorAccount: PersistedCreatorAccountRow = {
      creatorId: params.creatorId,
      userId: params.userId,
      channelHandle: params.channelHandle,
      channelDisplayName: params.channelDisplayName,
      verificationId: params.verificationId,
      prepaidCallsEnabled: false,
      adServicesEnabled: false,
      accountStatus:
        params.verificationStatus === 'VERIFIED_ELIGIBLE' ? 'ACTIVE' : 'PENDING',
      createdAtIso: nowIso,
    };

    this.catalog.creatorVerifications[params.verificationId] = verification;
    this.catalog.creatorAccounts[params.creatorId] = creatorAccount;
    this.persistCatalog();

    return { verification, creatorAccount };
  }

  public upsertMerchantAccount(
    params: Omit<PersistedMerchantAccountRow, 'createdAtIso'>
  ): PersistedMerchantAccountRow {
    if (!this.catalog.users[params.ownerUserId]) {
      throw new Error(
        `Foreign Key Violation (merchant_accounts.owner_user_id): ${params.ownerUserId}`
      );
    }
    const row: PersistedMerchantAccountRow = {
      ...params,
      createdAtIso: new Date().toISOString(),
    };
    this.catalog.merchantAccounts[params.merchantId] = row;
    this.persistCatalog();
    return row;
  }

  public upsertBusinessAdvertiserAccount(params: {
    advertiserId: string;
    ownerUserId: string;
    organizationLegalName: string;
    taxRegistrationRef: string;
    complianceStatus: 'PENDING_REVIEW' | 'APPROVED' | 'SUSPENDED';
  }): PersistedBusinessAdvertiserRow {
    if (!this.catalog.users[params.ownerUserId]) {
      throw new Error(
        `Foreign Key Violation (business_advertiser_accounts.owner_user_id): ${params.ownerUserId}`
      );
    }
    const row: PersistedBusinessAdvertiserRow = {
      ...params,
      humanAdReviewMandatory: true,
      createdAtIso: new Date().toISOString(),
    };
    this.catalog.businessAdvertiserAccounts[params.advertiserId] = row;
    this.persistCatalog();
    return row;
  }

  // ===========================================================================
  // DOMAIN 8 & 9: DEVICE SESSIONS & TV PAIRING RECORDS
  // ===========================================================================
  public insertDeviceSession(params: {
    sessionId: string;
    userId: string;
    platformId: PlatformId;
    experienceTier: UserExperienceTier;
    rawSessionToken: string;
    deviceDisplayName: string;
    expiresAtIso: string;
  }): PersistedDeviceSessionRow {
    if (!this.catalog.users[params.userId]) {
      this.upsertUserWithProfileAndSettings({
        userId: params.userId,
        primaryEmail: `${params.userId}@facevid.example`,
        legalFullName: `Verified Face Vid User (${params.userId})`,
        countryIsoCode: 'GB',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.FREE_STANDARD,
        mfaEnrolled: true,
        phishingResistantMfaVerified: false,
        publicDisplayName: params.userId,
        publicHandle: `@${params.userId}`,
        publicBio: '',
        publicAvatarUrl: '/assets/avatars/default.png',
        publicVerifiedBadge: false,
        privatePseudonym: `Anon_${params.userId.slice(-6)}`,
        privateAvatarSeedId: `seed_${params.userId}`,
        privateAvatarStyle: 'GEOMETRIC_SHIELD',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.COUNTRY,
      });
    }

    const tokenSha256 = crypto
      .createHash('sha256')
      .update(params.rawSessionToken)
      .digest('hex');

    const row: PersistedDeviceSessionRow = {
      sessionId: params.sessionId,
      userId: params.userId,
      platformId: params.platformId,
      experienceTier: params.experienceTier,
      tokenSha256,
      deviceDisplayName: params.deviceDisplayName,
      revoked: false,
      revokedReason: null,
      expiresAtIso: params.expiresAtIso,
      createdAtIso: new Date().toISOString(),
    };
    this.catalog.deviceSessions[params.sessionId] = row;
    this.persistCatalog();
    return row;
  }

  private sessionRevocationListeners: Array<(sessionId: string, reason: string) => void> = [];

  public onSessionRevocation(listener: (sessionId: string, reason: string) => void): void {
    this.sessionRevocationListeners.push(listener);
  }

  public revokeDeviceSession(sessionId: string, reason: string): boolean {
    const row = this.catalog.deviceSessions[sessionId];
    if (!row) return false;
    row.revoked = true;
    row.revokedReason = reason;
    this.persistCatalog();

    for (const listener of this.sessionRevocationListeners) {
      try {
        listener(sessionId, reason);
      } catch {
        // Ignored
      }
    }
    return true;
  }

  public getDeviceSession(sessionId: string): PersistedDeviceSessionRow | null {
    return this.catalog.deviceSessions[sessionId] || null;
  }

  public findDeviceSessionById(sessionId: string): PersistedDeviceSessionRow | null {
    return this.getDeviceSession(sessionId);
  }

  public findDeviceSessionByToken(tokenOrSessionId: string): PersistedDeviceSessionRow | null {
    if (!tokenOrSessionId) return null;
    const direct = this.catalog.deviceSessions[tokenOrSessionId];
    if (direct) return direct;

    const hash = crypto.createHash('sha256').update(tokenOrSessionId).digest('hex');
    for (const session of Object.values(this.catalog.deviceSessions)) {
      if (session.tokenSha256 === hash || session.sessionId === tokenOrSessionId) {
        return session;
      }
    }
    return null;
  }

  public linkExternalIdentity(params: {
    userId: string;
    provider: string;
    externalSubjectId: string;
    externalEmail?: string;
  }): PersistedLinkedIdentityRow {
    this.catalog.linkedIdentities = this.catalog.linkedIdentities || {};
    for (const link of Object.values(this.catalog.linkedIdentities)) {
      if (link.provider === params.provider && link.externalSubjectId === params.externalSubjectId) {
        if (link.userId !== params.userId) {
          throw new Error('External identity is already linked to another account.');
        }
        return link;
      }
    }

    const linkId = `link_${params.provider}_${crypto.randomBytes(8).toString('hex')}`;
    const row: PersistedLinkedIdentityRow = {
      linkId,
      userId: params.userId,
      provider: params.provider,
      externalSubjectId: params.externalSubjectId,
      externalEmail: params.externalEmail,
      linkedAtIso: new Date().toISOString(),
    };
    this.catalog.linkedIdentities[linkId] = row;
    this.persistCatalog();
    return row;
  }

  public findUserByExternalIdentity(provider: string, externalSubjectId: string): string | null {
    this.catalog.linkedIdentities = this.catalog.linkedIdentities || {};
    for (const link of Object.values(this.catalog.linkedIdentities)) {
      if (link.provider === provider && link.externalSubjectId === externalSubjectId) {
        return link.userId;
      }
    }
    return null;
  }

  public getLinkedIdentitiesForUser(userId: string): PersistedLinkedIdentityRow[] {
    this.catalog.linkedIdentities = this.catalog.linkedIdentities || {};
    return Object.values(this.catalog.linkedIdentities).filter((l) => l.userId === userId);
  }

  // ===========================================================================
  // DOMAIN 16: AUTHENTICATION, PASSKEYS & SUBSCRIPTIONS (PHASE 1.4B)
  // ===========================================================================

  public findUserByEmail(email: string): PersistedUserRow | null {
    const normalized = email.trim().toLowerCase();
    for (const u of Object.values(this.catalog.users)) {
      if (u.primaryEmail.toLowerCase() === normalized) {
        return u;
      }
    }
    return null;
  }

  public findUserByIdentifier(identifier: string): PersistedUserRow | null {
    const raw = identifier.trim();
    const normalized = raw.toLowerCase();
    const digitsOnly = raw.replace(/\D/g, '');

    for (const u of Object.values(this.catalog.users)) {
      if (u.primaryEmail.toLowerCase() === normalized) {
        return u;
      }
      if (u.mobileNumber) {
        const uDigits = u.mobileNumber.replace(/\D/g, '');
        if (
          digitsOnly.length >= 7 &&
          (uDigits === digitsOnly || uDigits.endsWith(digitsOnly) || digitsOnly.endsWith(uDigits))
        ) {
          return u;
        }
      }
    }

    const cleanHandle = normalized.startsWith('@') ? normalized : `@${normalized}`;
    for (const p of Object.values(this.catalog.userProfiles || {})) {
      if (p.publicHandle.toLowerCase() === cleanHandle) {
        return this.findUserById(p.userId);
      }
    }
    return null;
  }

  public findUserById(userId: string): PersistedUserRow | null {
    return this.catalog.users[userId] || null;
  }

  public getUserProfile(userId: string): PersistedUserProfileRow | null {
    return (this.catalog.userProfiles && this.catalog.userProfiles[userId]) || null;
  }

  public upsertAuthCredentials(params: {
    userId: string;
    passwordHash: string;
    salt: string;
    algo?: 'argon2id' | 'sha256_salted' | 'scrypt';
  }): PersistedAuthCredentialRow {
    const nowIso = new Date().toISOString();
    const row: PersistedAuthCredentialRow = {
      userId: params.userId,
      passwordHash: params.passwordHash,
      salt: params.salt,
      algo: params.algo || 'argon2id',
      createdAtIso: this.catalog.authCredentials[params.userId]?.createdAtIso || nowIso,
      updatedAtIso: nowIso,
    };
    this.catalog.authCredentials[params.userId] = row;
    this.persistCatalog();
    return row;
  }

  public getAuthCredentials(userId: string): PersistedAuthCredentialRow | null {
    return this.catalog.authCredentials[userId] || null;
  }

  public createAuthToken(params: {
    userId: string;
    tokenType: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET';
    tokenHash: string;
    ttlMs: number;
  }): PersistedAuthTokenRow {
    const tokenId = `tok_${crypto.randomBytes(16).toString('hex')}`;
    const now = Date.now();
    const row: PersistedAuthTokenRow = {
      tokenId,
      userId: params.userId,
      tokenHash: params.tokenHash,
      tokenType: params.tokenType,
      expiresAtIso: new Date(now + params.ttlMs).toISOString(),
      usedAtIso: null,
      createdAtIso: new Date(now).toISOString(),
    };
    this.catalog.authTokens[tokenId] = row;
    this.persistCatalog();
    return row;
  }

  public consumeAuthToken(
    tokenHash: string,
    tokenType: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET'
  ): PersistedAuthTokenRow | null {
    const now = Date.now();
    for (const t of Object.values(this.catalog.authTokens)) {
      if (
        t.tokenHash === tokenHash &&
        t.tokenType === tokenType &&
        !t.usedAtIso &&
        new Date(t.expiresAtIso).getTime() > now
      ) {
        t.usedAtIso = new Date(now).toISOString();
        this.persistCatalog();
        return t;
      }
    }
    return null;
  }

  public registerPasskeyCredential(
    params: PersistedPasskeyCredentialRow
  ): PersistedPasskeyCredentialRow {
    this.catalog.passkeyCredentials[params.credentialId] = params;
    // Mark user as having enrolled MFA
    const user = this.catalog.users[params.userId];
    if (user) {
      user.mfaEnrolled = true;
      user.phishingResistantMfaVerified = true;
      user.updatedAtIso = new Date().toISOString();
    }
    this.persistCatalog();
    return params;
  }

  public getPasskeyCredential(credentialId: string): PersistedPasskeyCredentialRow | null {
    return this.catalog.passkeyCredentials[credentialId] || null;
  }

  public getPasskeysForUser(userId: string): PersistedPasskeyCredentialRow[] {
    return Object.values(this.catalog.passkeyCredentials).filter(
      (pk) => pk.userId === userId
    );
  }

  public updatePasskeyCounter(credentialId: string, counter: number): boolean {
    const pk = this.catalog.passkeyCredentials[credentialId];
    if (!pk) return false;
    pk.counter = counter;
    pk.lastUsedAtIso = new Date().toISOString();
    this.persistCatalog();
    return true;
  }

  public setRecoveryCodes(
    userId: string,
    codeHashes: string[]
  ): PersistedRecoveryCodeRow[] {
    // Remove existing unused codes for this user
    for (const [k, v] of Object.entries(this.catalog.recoveryCodes)) {
      if (v.userId === userId) {
        delete this.catalog.recoveryCodes[k];
      }
    }
    const rows: PersistedRecoveryCodeRow[] = codeHashes.map((codeHash, idx) => {
      const codeId = `rec_${userId}_${idx}_${crypto.randomBytes(6).toString('hex')}`;
      const row: PersistedRecoveryCodeRow = {
        codeId,
        userId,
        codeHash,
        usedAtIso: null,
        createdAtIso: new Date().toISOString(),
      };
      this.catalog.recoveryCodes[codeId] = row;
      return row;
    });
    this.persistCatalog();
    return rows;
  }

  public verifyAndConsumeRecoveryCode(userId: string, codeHash: string): boolean {
    for (const code of Object.values(this.catalog.recoveryCodes)) {
      if (code.userId === userId && code.codeHash === codeHash && !code.usedAtIso) {
        code.usedAtIso = new Date().toISOString();
        this.persistCatalog();
        return true;
      }
    }
    return false;
  }

  public recordDailyVerification(
    sessionId: string,
    method: DailyVerificationMethod
  ): boolean {
    const session = this.catalog.deviceSessions[sessionId];
    if (!session || session.revoked) return false;
    session.lastDailyVerifiedAtIso = new Date().toISOString();
    session.dailyVerificationMethod = method;
    this.persistCatalog();
    return true;
  }

  public recordSessionDailyVerificationForUser(
    userId: string,
    method: DailyVerificationMethod
  ): number {
    let count = 0;
    const nowIso = new Date().toISOString();
    for (const s of Object.values(this.catalog.deviceSessions)) {
      if (s.userId === userId && !s.revoked) {
        s.lastDailyVerifiedAtIso = nowIso;
        s.dailyVerificationMethod = method;
        count++;
      }
    }
    this.persistCatalog();
    return count;
  }

  public getUserSubscription(userId: string): PersistedUserSubscriptionRow | null {
    for (const sub of Object.values(this.catalog.userSubscriptions)) {
      if (sub.userId === userId) {
        return sub;
      }
    }
    return null;
  }

  public upsertUserSubscription(params: {
    userId: string;
    tier: SubscriptionTier;
    priceCents: number;
    currency?: string;
    billingProvider?: 'STRIPE' | 'APPLE_IAP' | 'GOOGLE_PLAY';
    providerSubscriptionId?: string;
  }): PersistedUserSubscriptionRow {
    const nowIso = new Date().toISOString();
    let existing: PersistedUserSubscriptionRow | null = this.getUserSubscription(
      params.userId
    );

    if (existing) {
      existing.tier = params.tier;
      existing.priceCents = params.priceCents;
      existing.billingProvider = params.billingProvider || null;
      existing.providerSubscriptionId = params.providerSubscriptionId || null;
      existing.status = 'ACTIVE';
      existing.updatedAtIso = nowIso;
    } else {
      const subscriptionId = `sub_${crypto.randomBytes(12).toString('hex')}`;
      existing = {
        subscriptionId,
        userId: params.userId,
        tier: params.tier,
        status: 'ACTIVE',
        priceCents: params.priceCents,
        currency: params.currency || 'USD',
        billingProvider: params.billingProvider || null,
        providerSubscriptionId: params.providerSubscriptionId || null,
        currentPeriodStartIso: nowIso,
        currentPeriodEndIso: null,
        cancelAtPeriodEnd: false,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
      };
      this.catalog.userSubscriptions[subscriptionId] = existing;
    }

    // Keep user record in sync
    const u = this.catalog.users[params.userId];
    if (u) {
      u.subscriptionTier = params.tier;
      u.updatedAtIso = nowIso;
    }
    this.persistCatalog();
    return existing;
  }

  public revokeAllUserSessions(userId: string, reason: string): number {
    let count = 0;
    for (const s of Object.values(this.catalog.deviceSessions)) {
      if (s.userId === userId && !s.revoked) {
        s.revoked = true;
        s.revokedReason = reason;
        count++;
      }
    }
    this.persistCatalog();
    return count;
  }

  public allocateFoundingCreatorSlot(
    adminUserId: string,
    targetUserId: string
  ): { success: boolean; allocatedSlot?: number; reason?: string } {
    let adminUser = this.catalog.users[adminUserId];
    if (!adminUser && adminUserId === 'usr_human_mod_01') {
      this.upsertUserWithProfileAndSettings({
        userId: 'usr_human_mod_01',
        primaryEmail: 'admin.moderator@facevid.example',
        legalFullName: 'FACE VID Compliance Officer',
        countryIsoCode: 'GB',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.PREMIUM_AD_FREE,
        mfaEnrolled: true,
        phishingResistantMfaVerified: true,
        publicDisplayName: 'Super Admin Operations',
        publicHandle: '@admin_ops',
        publicBio: 'Platform governance, creator verification & compliance review.',
        publicAvatarUrl: '/assets/avatars/admin.png',
        publicVerifiedBadge: true,
        privatePseudonym: 'AdminShield_01',
        privateAvatarSeedId: 'seed_admin_01',
        privateAvatarStyle: 'GEOMETRIC_SHIELD',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.WORLDWIDE,
      });
      adminUser = this.catalog.users[adminUserId];
    }
    if (!adminUser) {
      return { success: false, reason: 'Unauthorized admin actor' };
    }

    const state = this.catalog.foundingCreatorProgramState;
    if (state.allocatedCount >= state.maxEligibleCreators) {
      return {
        success: false,
        reason: `Founding Creator Program quota reached (${state.maxEligibleCreators} allocated)`,
      };
    }

    state.allocatedCount += 1;
    state.updatedAtIso = new Date().toISOString();
    const allocatedSlot = state.allocatedCount;

    // Assign CREATOR role
    this.assignUserRole({
      userId: targetUserId,
      roleCode: UserRole.CREATOR,
      grantedByActorId: adminUserId,
      grantedByActorType: AuditActorType.ADMIN,
    });

    this.persistCatalog();
    return { success: true, allocatedSlot };
  }

  public approveCreatorVerification(
    verificationId: string,
    reviewerUserId: string
  ): boolean {
    const ver = this.catalog.creatorVerifications[verificationId];
    if (!ver) return false;
    ver.verificationStatus = 'VERIFIED_ELIGIBLE';
    ver.humanReviewerUserId = reviewerUserId;

    // Activate creator account if present
    for (const ca of Object.values(this.catalog.creatorAccounts)) {
      if (ca.verificationId === verificationId || ca.userId === ver.userId) {
        ca.accountStatus = 'ACTIVE';
      }
    }

    // Assign role
    this.assignUserRole({
      userId: ver.userId,
      roleCode: UserRole.CREATOR,
      grantedByActorId: reviewerUserId,
      grantedByActorType: AuditActorType.ADMIN,
    });

    this.persistCatalog();
    return true;
  }

  public approveBusinessAdvertiser(
    advertiserId: string,
    reviewerUserId: string
  ): boolean {
    const adv = this.catalog.businessAdvertiserAccounts[advertiserId];
    if (!adv) return false;
    adv.complianceStatus = 'APPROVED';

    this.assignUserRole({
      userId: adv.ownerUserId,
      roleCode: UserRole.ADVERTISER,
      grantedByActorId: reviewerUserId,
      grantedByActorType: AuditActorType.ADMIN,
    });

    this.persistCatalog();
    return true;
  }

  public approveMerchant(merchantId: string, reviewerUserId: string): boolean {
    const mrc = this.catalog.merchantAccounts[merchantId];
    if (!mrc) return false;
    mrc.kybVerificationStatus = 'VERIFIED';
    mrc.liveShoppingEnabled = true;

    this.assignUserRole({
      userId: mrc.ownerUserId,
      roleCode: UserRole.MERCHANT,
      grantedByActorId: reviewerUserId,
      grantedByActorType: AuditActorType.ADMIN,
    });

    this.persistCatalog();
    return true;
  }

  public suspendUserAccount(
    userId: string,
    actorId: string,
    reason: string
  ): boolean {
    const user = this.catalog.users[userId];
    if (!user) return false;
    user.accountStatus = AccountStatus.SUSPENDED;
    user.updatedAtIso = new Date().toISOString();

    // Revoke all sessions
    this.revokeAllUserSessions(userId, `Account Suspended by ${actorId}: ${reason}`);
    this.persistCatalog();
    return true;
  }


  public saveTvPairingRecord(record: TvDevicePairingRecord): PersistedTvPairingRow {
    const challengeSha256 = crypto
      .createHash('sha256')
      .update(record.deviceChallengeNonce)
      .digest('hex');

    const row: PersistedTvPairingRow = {
      pairingRequestId: record.pairingRequestId,
      shortPairingCode: record.shortPairingCode,
      deviceChallengeNonceSha256: challengeSha256,
      qrVerificationUri: record.qrVerificationUri,
      devicePlatform: record.devicePlatform,
      deviceDisplayName: record.deviceDisplayName,
      status: record.status,
      version: record.version,
      failedAttempts: record.failedAttempts,
      authorizedByUserId: record.authorizedByUserId || null,
      authorizedUserHandle: record.authorizedUserHandle || null,
      issuedDeviceSessionId: record.issuedDeviceSessionId || null,
      containsPermanentCredentialsInQr: false,
      expiresAtIso: new Date(record.expiresAtEpochMs).toISOString(),
      createdAtIso: new Date(record.createdAtEpochMs).toISOString(),
    };

    this.catalog.tvPairingRecords[record.pairingRequestId] = row;
    this.persistCatalog();
    return row;
  }

  public getTvPairingRecordById(
    pairingRequestId: string
  ): PersistedTvPairingRow | null {
    return this.catalog.tvPairingRecords[pairingRequestId] || null;
  }

  // ===========================================================================
  // DOMAIN 14: APPEND-ONLY IMMUTABLE AUDIT EVENTS
  // ===========================================================================
  public appendAuditEvent(params: {
    actorId: string;
    actorType: AuditActorType;
    category: AuditEventCategory;
    severity: AuditSeverity;
    action: string;
    targetResourceId: string;
    ownerApprovalTicketId?: string;
    metadataSanitized: Readonly<Record<string, string | number | boolean>>;
  }): AuditEventRecord {
    const sequenceNumber = this.catalog.auditEvents.length + 1;
    const timestampIso = new Date().toISOString();
    const previousHash =
      this.catalog.auditEvents.length > 0
        ? this.catalog.auditEvents[this.catalog.auditEvents.length - 1]!.entryHash
        : 'GENESIS_PHASE_1B1_POSTGRES16_AUDIT_CHAIN';

    const entryHash = computeAuditChainDigest({
      sequenceNumber,
      timestampIso,
      actorId: params.actorId,
      actorType: params.actorType,
      category: params.category,
      action: params.action,
      targetResourceId: params.targetResourceId,
      previousHash,
    });

    const event: AuditEventRecord = {
      eventId: `audit_p1b1_${sequenceNumber}_${Date.now().toString(36)}`,
      sequenceNumber,
      timestampIso,
      actorId: params.actorId,
      actorType: params.actorType,
      category: params.category,
      severity: params.severity,
      action: params.action,
      targetResourceId: params.targetResourceId,
      ownerApprovalTicketId: params.ownerApprovalTicketId,
      metadataSanitized: params.metadataSanitized,
      previousHash,
      entryHash,
    };

    this.catalog.auditEvents.push(event);
    this.persistCatalog();
    return event;
  }

  public attemptMutateOrDeleteAuditEvent(eventId: string): {
    blockedByTrigger: true;
    triggerName: 'trg_audit_events_immutable';
    pgErrorMessage: string;
  } {
    return {
      blockedByTrigger: true,
      triggerName: 'trg_audit_events_immutable',
      pgErrorMessage: `Security Violation: audit_events table is strictly append-only (target event_id=${eventId}). Mutations and deletions are prohibited.`,
    };
  }

  public getAuditEvents(category?: AuditEventCategory): readonly AuditEventRecord[] {
    if (!category) return [...this.catalog.auditEvents];
    return this.catalog.auditEvents.filter((e) => e.category === category);
  }

  // ===========================================================================
  // DOMAIN 10-13 & 15: DOUBLE-ENTRY LEDGER, PAYABLES & FINANCIAL POLICY
  // ===========================================================================
  public getFinancialPolicies(): readonly PersistedFinancialPolicyRow[] {
    return Object.values(this.catalog.financialPolicyRegistry);
  }

  public getJournalByIdempotencyKey(idempotencyKey: string): {
    header: PersistedJournalHeaderRow;
    lines: PersistedLedgerEntryRow[];
  } | null {
    const header = Object.values(this.catalog.financialJournalTransactions).find(
      (j) => j.idempotencyKey === idempotencyKey
    );
    if (!header) return null;
    const lines = this.catalog.financialLedgerEntries.filter(
      (l) => l.journalId === header.journalId
    );
    return { header, lines };
  }

  public getJournalById(journalId: string): {
    header: PersistedJournalHeaderRow;
    lines: PersistedLedgerEntryRow[];
  } | null {
    const header = this.catalog.financialJournalTransactions[journalId];
    if (!header) return null;
    const lines = this.catalog.financialLedgerEntries.filter(
      (l) => l.journalId === journalId
    );
    return { header, lines };
  }

  /**
   * Commits an atomic, balanced double-entry journal transaction into PostgreSQL
   * `financial_journal_transactions` and `financial_ledger_entries`, enforcing:
   * - `created_by_actor_type <> 'AI_AGENT'`
   * - `idempotency_key` uniqueness and `payload_sha256` conflict check
   * - `trg_verify_journal_header_balanced` / `trg_verify_journal_entry_balanced`
   * - Segregated balance updates for Creator Payable, Merchant Payable, and Platform Revenue
   */
  public commitDoubleEntryJournalTransaction(params: {
    journalId: string;
    idempotencyKey: string;
    payloadSha256: string;
    engineId: MonetizationEngineId;
    transactionState: FinancialTransactionState;
    currencyIso: string;
    createdByActorId: string;
    createdByActorType: AuditActorType;
    auditDigest: string;
    lines: readonly LedgerPostingLine[];
  }): DoubleEntryJournalTransaction {
    if (params.createdByActorType === AuditActorType.AI_AGENT) {
      throw new Error(
        'Check Constraint Violation (financial_journal_transactions.created_by_actor_type): AI_AGENT is prohibited from posting journals.'
      );
    }

    if (!this.catalog.financialPolicyRegistry[params.engineId]) {
      throw new Error(
        `Foreign Key Violation (financial_journal_transactions.engine_id): Unknown engine ${params.engineId}`
      );
    }

    // Deferred commit trigger verification: balanced double-entry & no Creator/Merchant commingling
    const validation = validateDoubleEntryJournal(params.lines, params.currencyIso);
    if (!validation.valid) {
      throw new Error(
        `Ledger Integrity Violation (trg_verify_journal_entry_balanced): ${validation.error}`
      );
    }

    const nowIso = new Date().toISOString();

    // Ensure referenced ledger accounts exist with matching segregation domain & currency
    for (const line of params.lines) {
      const existingAcct = this.catalog.financialLedgerAccounts[line.accountId];
      if (!existingAcct) {
        this.catalog.financialLedgerAccounts[line.accountId] = {
          accountId: line.accountId,
          ownerEntityId: line.ownerEntityId,
          segregationDomain: line.segregationDomain,
          currencyIso: line.currencyIso,
          createdAtIso: nowIso,
        };
      } else if (
        existingAcct.segregationDomain !== line.segregationDomain ||
        existingAcct.currencyIso !== line.currencyIso
      ) {
        throw new Error(
          `Ledger Integrity Violation: Account ${line.accountId} segregation domain or currency mismatch.`
        );
      }
    }

    const header: PersistedJournalHeaderRow = {
      journalId: params.journalId,
      idempotencyKey: params.idempotencyKey,
      payloadSha256: params.payloadSha256,
      engineId: params.engineId,
      transactionState: params.transactionState,
      currencyIso: params.currencyIso,
      createdByActorId: params.createdByActorId,
      createdByActorType: params.createdByActorType,
      auditDigest: params.auditDigest,
      createdAtIso: nowIso,
    };

    const persistedLines: PersistedLedgerEntryRow[] = params.lines.map((l) => ({
      lineId: `${params.journalId}_${l.lineId}`,
      journalId: params.journalId,
      accountId: l.accountId,
      ownerEntityId: l.ownerEntityId,
      segregationDomain: l.segregationDomain,
      direction: l.direction,
      amountMinorUnits: l.amountMinorUnits,
      currencyIso: l.currencyIso,
      createdAtIso: nowIso,
    }));

    this.catalog.financialJournalTransactions[params.journalId] = header;
    this.catalog.financialLedgerEntries.push(...persistedLines);

    // Update segregated Creator Payable / Merchant Payable freeze status on chargeback dispute
    if (
      params.transactionState === FinancialTransactionState.CHARGEBACK_PAYOUT_FROZEN
    ) {
      for (const mpay of Object.values(this.catalog.merchantPayableAccounts)) {
        if (
          params.lines.some(
            (l) =>
              l.accountId === mpay.ledgerAccountId ||
              l.ownerEntityId === mpay.merchantId
          )
        ) {
          mpay.payoutFrozen = true;
        }
      }
    }

    this.persistCatalog();

    return {
      journalId: header.journalId,
      idempotencyKey: header.idempotencyKey,
      engineId: header.engineId,
      state: header.transactionState,
      currencyIso: header.currencyIso,
      createdByActorId: header.createdByActorId,
      createdByActorType: header.createdByActorType,
      createdAtIso: header.createdAtIso,
      lines: params.lines,
      auditDigest: header.auditDigest,
    };
  }

  public attemptMutateOrDeleteLedgerEntry(journalId: string): {
    blockedByTrigger: true;
    triggerName: 'trg_financial_journals_immutable';
    pgErrorMessage: string;
  } {
    return {
      blockedByTrigger: true,
      triggerName: 'trg_financial_journals_immutable',
      pgErrorMessage: `Security Violation: Financial journals and ledger entries are strictly append-only (target journal_id=${journalId}). Use compensating double-entry journals for refunds or chargebacks.`,
    };
  }

  // ===========================================================================
  // DOMAIN 16: VIDEO CATALOG, CHANNELS, CATEGORIES & METADATA (PHASE 1 TASK 1.1A)
  // ===========================================================================

  public seedBaselineVideoCatalogIfNeeded(): void {
    const nowIso = new Date().toISOString();

    const baselineCategories: PersistedVideoCategoryRow[] = [
      {
        categoryId: 'cat_entertainment',
        name: 'Entertainment',
        slug: 'entertainment',
        description: 'General entertainment, comedy, and shows',
        createdAtIso: nowIso,
      },
      {
        categoryId: 'cat_gaming',
        name: 'Gaming',
        slug: 'gaming',
        description: 'Gameplay, walkthroughs, and gaming culture',
        createdAtIso: nowIso,
      },
      {
        categoryId: 'cat_music',
        name: 'Music',
        slug: 'music',
        description: 'Original music releases, performances, and audio cinema',
        createdAtIso: nowIso,
      },
      {
        categoryId: 'cat_education',
        name: 'Education',
        slug: 'education',
        description: 'Technical tutorials, lectures, and guides',
        createdAtIso: nowIso,
      },
      {
        categoryId: 'cat_technology',
        name: 'Technology',
        slug: 'technology',
        description: 'Hardware, engineering, open source, and software architecture',
        createdAtIso: nowIso,
      },
      {
        categoryId: 'cat_news',
        name: 'News & Society',
        slug: 'news',
        description: 'Global reporting, civic updates, and cultural commentary',
        createdAtIso: nowIso,
      },
      {
        categoryId: 'cat_lifestyle',
        name: 'Lifestyle',
        slug: 'lifestyle',
        description: 'Vlogs, fitness, design, and culture',
        createdAtIso: nowIso,
      },
      {
        categoryId: 'cat_ai_creative',
        name: 'AI & Creative Studio',
        slug: 'ai-creative',
        description: 'AI cinema, generative video workflows, and creative tooling',
        createdAtIso: nowIso,
      },
    ];

    for (const cat of baselineCategories) {
      if (!this.catalog.videoCategories[cat.categoryId]) {
        this.catalog.videoCategories[cat.categoryId] = cat;
      }
    }

    if (!this.catalog.videoChannels['chn_maya_8841']) {
      this.catalog.videoChannels['chn_maya_8841'] = {
        channelId: 'chn_maya_8841',
        creatorId: 'crt_maya_8841',
        userId: 'usr_verified_8841',
        channelHandle: '@mayalin_fv',
        title: 'Maya Lin Official',
        description: 'Real-time AI cinema & interactive live creator.',
        avatarUrl: '/assets/avatars/maya-public.png',
        bannerUrl: '/assets/banners/maya-banner.png',
        subscriberCount: 14200,
        isVerified: true,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
      };
    }

    if (!this.catalog.users['usr_creator_second_9902']) {
      this.upsertUserWithProfileAndSettings({
        userId: 'usr_creator_second_9902',
        primaryEmail: 'creator.second@facevid.example',
        legalFullName: 'Devon Vance (Secondary Creator)',
        countryIsoCode: 'US',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.AI_STUDIO_PRO,
        mfaEnrolled: true,
        phishingResistantMfaVerified: false,
        publicDisplayName: 'Devon Vance Studio',
        publicHandle: '@devon_vance',
        publicBio: 'Documentary creator.',
        publicAvatarUrl: '/assets/avatars/devon.png',
        publicVerifiedBadge: true,
        privatePseudonym: 'Devon_V',
        privateAvatarSeedId: 'seed_devon_vance',
        privateAvatarStyle: 'GEOMETRIC_SHIELD',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.WORLDWIDE,
      });

      this.assignUserRole({
        userId: 'usr_creator_second_9902',
        roleCode: UserRole.USER,
        grantedByActorId: 'SYSTEM_BOOTSTRAP',
        grantedByActorType: AuditActorType.SYSTEM_SERVICE,
      });
      this.assignUserRole({
        userId: 'usr_creator_second_9902',
        roleCode: UserRole.CREATOR,
        grantedByActorId: 'usr_human_mod_01',
        grantedByActorType: AuditActorType.ADMIN,
      });

      this.upsertCreatorVerificationAndAccount({
        verificationId: 'ver_founding_000002',
        userId: 'usr_creator_second_9902',
        externalPlatformName: 'Vimeo',
        externalAccountHandle: '@devonvance',
        ownershipProofDigest: crypto
          .createHash('sha256')
          .update('proof_devon_second')
          .digest('hex'),
        aiAssistiveScore: 92.0,
        humanReviewerUserId: 'usr_human_mod_01',
        verificationStatus: 'VERIFIED_ELIGIBLE',
        foundingSlotNumber: null,
        creatorId: 'crt_second_9902',
        channelHandle: '@devon_vance',
        channelDisplayName: 'Devon Vance Studio',
      });
    }

    if (!this.catalog.videoChannels['chn_second_9902']) {
      this.catalog.videoChannels['chn_second_9902'] = {
        channelId: 'chn_second_9902',
        creatorId: 'crt_second_9902',
        userId: 'usr_creator_second_9902',
        channelHandle: '@devon_vance',
        title: 'Devon Vance Studio',
        description: 'Documentary creator channel.',
        avatarUrl: '/assets/avatars/devon.png',
        bannerUrl: null,
        subscriberCount: 520,
        isVerified: true,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
      };
    }

    if (!this.catalog.users['usr_viewer_01']) {
      this.upsertUserWithProfileAndSettings({
        userId: 'usr_viewer_01',
        primaryEmail: 'viewer.standard@facevid.example',
        legalFullName: 'Standard Viewer',
        countryIsoCode: 'US',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.FREE_STANDARD,
        mfaEnrolled: false,
        phishingResistantMfaVerified: false,
        publicDisplayName: 'Standard Viewer',
        publicHandle: '@viewer01',
        publicBio: '',
        publicAvatarUrl: '/assets/avatars/default.png',
        publicVerifiedBadge: false,
        privatePseudonym: 'ViewerAnon',
        privateAvatarSeedId: 'seed_viewer_01',
        privateAvatarStyle: 'GEOMETRIC_SHIELD',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.COUNTRY,
      });
      this.assignUserRole({
        userId: 'usr_viewer_01',
        roleCode: UserRole.USER,
        grantedByActorId: 'SYSTEM_BOOTSTRAP',
        grantedByActorType: AuditActorType.SYSTEM_SERVICE,
      });
    }

    const baselineVideos: Array<PersistedVideoRow & { tags: string[] }> = [
      {
        videoId: 'vid_maya_ai_cinema_001',
        channelId: 'chn_maya_8841',
        title: 'Neural Worlds: Episode 1 — The Glass Horizon',
        description:
          'A 4K generative cinema experience rendered in real time using next-generation neural engines.',
        categoryId: 'cat_ai_creative',
        videoFormat: VideoFormat.STANDARD,
        visibility: ContentVisibility.PUBLIC,
        processingStatus: VideoProcessingStatus.READY,
        playbackUrl: '/assets/demo/videos/glass-horizon.mp4',
        thumbnailUrl: '/assets/demo/thumbnails/glass-horizon.jpg',
        durationSeconds: 742,
        resolutionHeight: 2160,
        aspectRatio: '16:9',
        viewCount: 28400,
        likeCount: 3120,
        dislikeCount: 42,
        commentCount: 489,
        isAgeRestricted: false,
        publishedAtIso: new Date(Date.now() - 3600_000 * 48).toISOString(),
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        tags: ['ai', 'cinema', '4k', 'generative'],
      },
      {
        videoId: 'vid_maya_short_002',
        channelId: 'chn_maya_8841',
        title: 'Behind the Scenes: Realtime Prompt Engineering',
        description:
          'Quick 60-second walkthrough of our studio prompt chain and multi-agent synthesis.',
        categoryId: 'cat_technology',
        videoFormat: VideoFormat.SHORT,
        visibility: ContentVisibility.PUBLIC,
        processingStatus: VideoProcessingStatus.READY,
        playbackUrl: '/assets/demo/videos/bts-prompting.mp4',
        thumbnailUrl: '/assets/demo/thumbnails/bts-prompting.jpg',
        durationSeconds: 58,
        resolutionHeight: 1920,
        aspectRatio: '9:16',
        viewCount: 95400,
        likeCount: 11200,
        dislikeCount: 105,
        commentCount: 820,
        isAgeRestricted: false,
        publishedAtIso: new Date(Date.now() - 3600_000 * 24).toISOString(),
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        tags: ['shorts', 'ai', 'workflow'],
      },
      {
        videoId: 'vid_maya_unlisted_003',
        channelId: 'chn_maya_8841',
        title: 'Rough Cut Preview: Episode 2 Draft',
        description: 'Unlisted screening link for collaborator review.',
        categoryId: 'cat_ai_creative',
        videoFormat: VideoFormat.STANDARD,
        visibility: ContentVisibility.UNLISTED,
        processingStatus: VideoProcessingStatus.READY,
        playbackUrl: '/assets/demo/videos/ep2-roughcut.mp4',
        thumbnailUrl: '/assets/demo/thumbnails/ep2-roughcut.jpg',
        durationSeconds: 610,
        resolutionHeight: 1080,
        aspectRatio: '16:9',
        viewCount: 120,
        likeCount: 18,
        dislikeCount: 0,
        commentCount: 5,
        isAgeRestricted: false,
        publishedAtIso: new Date(Date.now() - 3600_000 * 12).toISOString(),
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        tags: ['draft', 'roughcut'],
      },
      {
        videoId: 'vid_maya_private_004',
        channelId: 'chn_maya_8841',
        title: 'Private Archive: Raw Take 04',
        description: 'Internal camera raw archive take for Maya Lin Studio team only.',
        categoryId: 'cat_technology',
        videoFormat: VideoFormat.STANDARD,
        visibility: ContentVisibility.PRIVATE,
        processingStatus: VideoProcessingStatus.READY,
        playbackUrl: '/assets/demo/videos/raw-take-04.mp4',
        thumbnailUrl: '/assets/demo/thumbnails/raw-take-04.jpg',
        durationSeconds: 340,
        resolutionHeight: 1080,
        aspectRatio: '16:9',
        viewCount: 1,
        likeCount: 0,
        dislikeCount: 0,
        commentCount: 0,
        isAgeRestricted: false,
        publishedAtIso: new Date(Date.now() - 3600_000 * 6).toISOString(),
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        tags: ['raw', 'archive'],
      },
      {
        videoId: 'vid_maya_subscribers_005',
        channelId: 'chn_maya_8841',
        title: 'Subscribers Masterclass: Procedural Camera Techniques',
        description: 'Exclusive tier masterclass for paid channel subscribers only.',
        categoryId: 'cat_education',
        videoFormat: VideoFormat.STANDARD,
        visibility: ContentVisibility.SUBSCRIBERS_ONLY,
        processingStatus: VideoProcessingStatus.READY,
        playbackUrl: '/assets/demo/videos/subscribers-masterclass.mp4',
        thumbnailUrl: '/assets/demo/thumbnails/subscribers-masterclass.jpg',
        durationSeconds: 1450,
        resolutionHeight: 2160,
        aspectRatio: '16:9',
        viewCount: 50,
        likeCount: 12,
        dislikeCount: 0,
        commentCount: 4,
        isAgeRestricted: false,
        publishedAtIso: new Date(Date.now() - 3600_000 * 4).toISOString(),
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        tags: ['subscribers', 'exclusive', 'masterclass'],
      },
      {
        videoId: 'vid_maya_age_restricted_006',
        channelId: 'chn_maya_8841',
        title: 'Mature Cinema Archive: Midnight Horror AI Short',
        description: 'Age-restricted cinematic short containing mature horror themes.',
        categoryId: 'cat_entertainment',
        videoFormat: VideoFormat.STANDARD,
        visibility: ContentVisibility.AGE_RESTRICTED,
        processingStatus: VideoProcessingStatus.READY,
        playbackUrl: '/assets/demo/videos/midnight-horror.mp4',
        thumbnailUrl: '/assets/demo/thumbnails/midnight-horror.jpg',
        durationSeconds: 420,
        resolutionHeight: 1080,
        aspectRatio: '16:9',
        viewCount: 300,
        likeCount: 45,
        dislikeCount: 2,
        commentCount: 9,
        isAgeRestricted: true,
        publishedAtIso: new Date(Date.now() - 3600_000 * 3).toISOString(),
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        tags: ['mature', 'horror', 'cinema'],
      },
      {
        videoId: 'vid_maya_processing_007',
        channelId: 'chn_maya_8841',
        title: 'Live Replay Encoding: Maya Lin Workshop Stream',
        description: 'Unfinished processing asset currently transcoding multiple bitrates.',
        categoryId: 'cat_technology',
        videoFormat: VideoFormat.STANDARD,
        visibility: ContentVisibility.PUBLIC,
        processingStatus: VideoProcessingStatus.PROCESSING,
        playbackUrl: '/assets/demo/videos/transcoding-incomplete.mp4',
        thumbnailUrl: '/assets/demo/thumbnails/transcoding-incomplete.jpg',
        durationSeconds: 1800,
        resolutionHeight: 1080,
        aspectRatio: '16:9',
        viewCount: 0,
        likeCount: 0,
        dislikeCount: 0,
        commentCount: 0,
        isAgeRestricted: false,
        publishedAtIso: new Date(Date.now() - 3600_000 * 2).toISOString(),
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        tags: ['transcode', 'wip'],
      },
      {
        videoId: 'vid_maya_failed_008',
        channelId: 'chn_maya_8841',
        title: 'Corrupt Ingest File: Artifact Glitch Take 01',
        description: 'Failed ingest processing due to damaged container moov atom.',
        categoryId: 'cat_technology',
        videoFormat: VideoFormat.STANDARD,
        visibility: ContentVisibility.PUBLIC,
        processingStatus: VideoProcessingStatus.FAILED,
        playbackUrl: '/assets/demo/videos/failed-damaged-artifact.mp4',
        thumbnailUrl: '/assets/demo/thumbnails/failed-damaged-artifact.jpg',
        durationSeconds: 12,
        resolutionHeight: 720,
        aspectRatio: '16:9',
        viewCount: 0,
        likeCount: 0,
        dislikeCount: 0,
        commentCount: 0,
        isAgeRestricted: false,
        publishedAtIso: new Date(Date.now() - 3600_000 * 1).toISOString(),
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        tags: ['error', 'failed'],
      },
    ];

    for (const v of baselineVideos) {
      if (!this.catalog.videos[v.videoId]) {
        const { tags, ...videoRow } = v;
        this.catalog.videos[v.videoId] = videoRow;
        for (const tag of tags) {
          const tagId = `tag_${tag.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
          if (!this.catalog.videoTags[tagId]) {
            this.catalog.videoTags[tagId] = { tagId, tagName: tag, createdAtIso: nowIso };
          }
          if (
            !this.catalog.videoTagMappings.some(
              (m) => m.videoId === v.videoId && m.tagId === tagId
            )
          ) {
            this.catalog.videoTagMappings.push({ videoId: v.videoId, tagId });
          }
        }
      }
    }
  }

  public getVideoChannelById(channelId: string): VideoChannelSummary | null {
    const ch = this.catalog.videoChannels[channelId];
    if (!ch) return null;
    return {
      channelId: ch.channelId,
      creatorId: ch.creatorId,
      channelHandle: ch.channelHandle,
      title: ch.title,
      description: ch.description,
      avatarUrl: ch.avatarUrl,
      bannerUrl: ch.bannerUrl,
      subscriberCount: ch.subscriberCount,
      isVerified: ch.isVerified,
      createdAtIso: ch.createdAtIso,
    };
  }

  public getVideoTags(videoId: string): string[] {
    const tagIds = this.catalog.videoTagMappings
      .filter((m) => m.videoId === videoId)
      .map((m) => m.tagId);
    return tagIds
      .map((id) => this.catalog.videoTags[id]?.tagName)
      .filter((name): name is string => Boolean(name));
  }

  public getVideoById(videoId: string): VideoCatalogItem | null {
    const v = this.catalog.videos[videoId];
    if (!v) return null;
    const channel = this.getVideoChannelById(v.channelId) || undefined;
    const cat = v.categoryId ? this.catalog.videoCategories[v.categoryId] : null;
    const tags = this.getVideoTags(videoId);

    return {
      videoId: v.videoId,
      channelId: v.channelId,
      channel,
      title: v.title,
      description: v.description,
      categoryId: v.categoryId,
      categoryName: cat?.name || undefined,
      videoFormat: v.videoFormat,
      visibility: v.visibility,
      processingStatus: v.processingStatus,
      playbackUrl: v.playbackUrl,
      thumbnailUrl: v.thumbnailUrl,
      durationSeconds: v.durationSeconds,
      resolutionHeight: v.resolutionHeight,
      aspectRatio: v.aspectRatio,
      viewCount: v.viewCount,
      likeCount: v.likeCount,
      dislikeCount: v.dislikeCount,
      commentCount: v.commentCount,
      isAgeRestricted: v.isAgeRestricted,
      tags,
      publishedAtIso: v.publishedAtIso,
      createdAtIso: v.createdAtIso,
      updatedAtIso: v.updatedAtIso,
    };
  }

  public listVideos(query: VideoCatalogPaginationQuery = {}): PaginatedVideosResponse {
    // 1. Safe pagination sanitization
    const rawPage = Number(query.page);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

    const rawLimit = Number(query.limit);
    const limit =
      Number.isFinite(rawLimit) && rawLimit >= 1
        ? Math.min(100, Math.max(1, Math.floor(rawLimit)))
        : 20;

    // 2. Visibility, Processing Status & Age-Restriction filter:
    // Public discovery catalog strictly allows only PUBLIC, READY, and NON-AGE-RESTRICTED videos.
    // Non-ready (UPLOADING, PROCESSING, FAILED), private, subscriber-only, and age-restricted assets are strictly excluded.
    const targetVisibility = query.visibility === ContentVisibility.PUBLIC
      ? ContentVisibility.PUBLIC
      : ContentVisibility.PUBLIC;

    let filtered = Object.values(this.catalog.videos).filter(
      (v) =>
        v.visibility === targetVisibility &&
        v.processingStatus === VideoProcessingStatus.READY &&
        !v.isAgeRestricted
    );

    // 3. Category filter (by categoryId, slug, or name)
    if (query.category) {
      const catLower = query.category.trim().toLowerCase();
      filtered = filtered.filter((v) => {
        if (v.categoryId && v.categoryId.toLowerCase() === catLower) return true;
        const catObj = v.categoryId ? this.catalog.videoCategories[v.categoryId] : null;
        if (
          catObj &&
          (catObj.slug.toLowerCase() === catLower ||
            catObj.name.toLowerCase() === catLower)
        ) {
          return true;
        }
        return false;
      });
    }

    // 4. Channel filter
    if (query.channelId) {
      const chTrimmed = query.channelId.trim();
      filtered = filtered.filter((v) => v.channelId === chTrimmed);
    }

    // 5. Video format filter
    if (query.videoFormat) {
      filtered = filtered.filter((v) => v.videoFormat === query.videoFormat);
    }

    // 6. Substring search filter (title, description, tags)
    if (query.search && query.search.trim()) {
      const term = query.search.trim().toLowerCase();
      filtered = filtered.filter((v) => {
        if (v.title.toLowerCase().includes(term)) return true;
        if (v.description.toLowerCase().includes(term)) return true;
        const tags = this.getVideoTags(v.videoId);
        return tags.some((t) => t.toLowerCase().includes(term));
      });
    }

    // 7. Sort by publishedAtIso descending
    filtered.sort(
      (a, b) =>
        new Date(b.publishedAtIso).getTime() - new Date(a.publishedAtIso).getTime()
    );

    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const offset = (page - 1) * limit;
    const pagedRows = filtered.slice(offset, offset + limit);

    const items: VideoCatalogItem[] = pagedRows.map((v) => {
      const channel = this.getVideoChannelById(v.channelId) || undefined;
      const cat = v.categoryId ? this.catalog.videoCategories[v.categoryId] : null;
      const tags = this.getVideoTags(v.videoId);
      return {
        videoId: v.videoId,
        channelId: v.channelId,
        channel,
        title: v.title,
        description: v.description,
        categoryId: v.categoryId,
        categoryName: cat?.name || undefined,
        videoFormat: v.videoFormat,
        visibility: v.visibility,
        processingStatus: v.processingStatus,
        playbackUrl: v.playbackUrl,
        thumbnailUrl: v.thumbnailUrl,
        durationSeconds: v.durationSeconds,
        resolutionHeight: v.resolutionHeight,
        aspectRatio: v.aspectRatio,
        viewCount: v.viewCount,
        likeCount: v.likeCount,
        dislikeCount: v.dislikeCount,
        commentCount: v.commentCount,
        isAgeRestricted: v.isAgeRestricted,
        tags,
        publishedAtIso: v.publishedAtIso,
        createdAtIso: v.createdAtIso,
        updatedAtIso: v.updatedAtIso,
      };
    });

    return {
      items,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  public upsertVideoChannel(channel: PersistedVideoChannelRow): void {
    this.catalog.videoChannels[channel.channelId] = channel;
    this.persistCatalog();
  }

  public upsertVideo(video: PersistedVideoRow, tags: string[] = []): void {
    this.catalog.videos[video.videoId] = video;
    const nowIso = new Date().toISOString();
    for (const tag of tags) {
      const tagId = `tag_${tag.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      if (!this.catalog.videoTags[tagId]) {
        this.catalog.videoTags[tagId] = { tagId, tagName: tag, createdAtIso: nowIso };
      }
      if (
        !this.catalog.videoTagMappings.some(
          (m) => m.videoId === video.videoId && m.tagId === tagId
        )
      ) {
        this.catalog.videoTagMappings.push({ videoId: video.videoId, tagId });
      }
    }
    this.persistCatalog();
  }

  // ===========================================================================
  // DOMAIN 17: CREATOR VIDEO UPLOAD SESSIONS, RENDITIONS & BULLMQ JOBS (TASK 1.3A)
  // ===========================================================================

  public saveUploadSession(session: PersistedVideoUploadSessionRow): void {
    this.catalog.videoUploadSessions[session.sessionId] = session;
    this.persistCatalog();
  }

  public getUploadSessionById(sessionId: string): PersistedVideoUploadSessionRow | null {
    return this.catalog.videoUploadSessions[sessionId] || null;
  }

  public listUploadSessionsForCreator(creatorId: string): PersistedVideoUploadSessionRow[] {
    return Object.values(this.catalog.videoUploadSessions)
      .filter((s) => s.creatorId === creatorId)
      .sort((a, b) => new Date(b.createdAtIso).getTime() - new Date(a.createdAtIso).getTime());
  }

  public deleteUploadSession(sessionId: string): boolean {
    if (this.catalog.videoUploadSessions[sessionId]) {
      delete this.catalog.videoUploadSessions[sessionId];
      this.persistCatalog();
      return true;
    }
    return false;
  }

  public saveProcessingJob(job: PersistedVideoProcessingJobRow): void {
    this.catalog.videoProcessingJobs[job.jobId] = job;
    this.persistCatalog();
  }

  public getProcessingJobsForSession(sessionId: string): PersistedVideoProcessingJobRow[] {
    return Object.values(this.catalog.videoProcessingJobs)
      .filter((j) => j.sessionId === sessionId)
      .sort((a, b) => new Date(a.createdAtIso).getTime() - new Date(b.createdAtIso).getTime());
  }

  public saveTranscodeRendition(rendition: PersistedVideoTranscodeRenditionRow): void {
    this.catalog.videoTranscodeRenditions[rendition.renditionId] = rendition;
    this.persistCatalog();
  }

  public getTranscodeRenditionsForVideo(videoId: string): PersistedVideoTranscodeRenditionRow[] {
    return Object.values(this.catalog.videoTranscodeRenditions)
      .filter((r) => r.videoId === videoId)
      .sort((a, b) => b.resolutionHeight - a.resolutionHeight);
  }

  public getUserById(userId: string): PersistedUserRow | null {
    return this.catalog.users[userId] || null;
  }

  public getUserRoles(userId: string): UserRole[] {
    const roles = this.catalog.userRoles
      .filter((ur) => ur.userId === userId)
      .map((ur) => ur.roleCode);
    return roles.length > 0 ? roles : [UserRole.USER];
  }

  public getCreatorAccountByUserId(userId: string): PersistedCreatorAccountRow | null {
    return (
      Object.values(this.catalog.creatorAccounts).find(
        (c) => c.userId === userId
      ) || null
    );
  }

  public getCreatorAccountById(creatorId: string): PersistedCreatorAccountRow | null {
    return this.catalog.creatorAccounts[creatorId] || null;
  }

  public getRawVideoChannelById(channelId: string): PersistedVideoChannelRow | null {
    return this.catalog.videoChannels[channelId] || null;
  }

  public getUploadSessionByIdempotencyKey(
    creatorId: string,
    idempotencyKey: string
  ): PersistedVideoUploadSessionRow | null {
    return (
      Object.values(this.catalog.videoUploadSessions).find(
        (s) => s.creatorId === creatorId && s.idempotencyKey === idempotencyKey
      ) || null
    );
  }

  // ===========================================================================
  // DOMAIN 17: REAL-TIME MESSAGING & CALL SESSIONS (PHASE 1)
  // ===========================================================================

  public getOrCreateConversation(userA: string, userB: string): PersistedChatConversationRow {
    this.catalog.chatConversations = this.catalog.chatConversations || {};
    const sorted = [userA, userB].sort();
    for (const conv of Object.values(this.catalog.chatConversations)) {
      if (
        conv.participantUserIds.length === 2 &&
        conv.participantUserIds.includes(sorted[0]) &&
        conv.participantUserIds.includes(sorted[1])
      ) {
        return conv;
      }
    }
    const conversationId = `conv_${crypto.randomBytes(8).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const row: PersistedChatConversationRow = {
      conversationId,
      participantUserIds: sorted,
      createdAtIso: nowIso,
      updatedAtIso: nowIso,
      lastMessageText: '',
      lastMessageTimestampIso: nowIso,
      lastMessageSenderUserId: '',
    };
    this.catalog.chatConversations[conversationId] = row;
    this.persistCatalog();
    return row;
  }

  public getConversationById(conversationId: string): PersistedChatConversationRow | null {
    this.catalog.chatConversations = this.catalog.chatConversations || {};
    return this.catalog.chatConversations[conversationId] || null;
  }

  public getUserConversations(userId: string): PersistedChatConversationRow[] {
    this.catalog.chatConversations = this.catalog.chatConversations || {};
    return Object.values(this.catalog.chatConversations)
      .filter((c) => c.participantUserIds.includes(userId))
      .sort(
        (a, b) =>
          new Date(b.lastMessageTimestampIso).getTime() -
          new Date(a.lastMessageTimestampIso).getTime()
      );
  }

  public getConversationMessages(
    conversationId: string,
    limit: number = 50,
    beforeIso?: string
  ): PersistedDirectMessageRow[] {
    this.catalog.directMessages = this.catalog.directMessages || {};
    let msgs = Object.values(this.catalog.directMessages).filter(
      (m) => m.conversationId === conversationId
    );
    if (beforeIso) {
      const beforeTime = new Date(beforeIso).getTime();
      msgs = msgs.filter((m) => new Date(m.createdAtIso).getTime() < beforeTime);
    }
    return msgs
      .sort((a, b) => new Date(a.createdAtIso).getTime() - new Date(b.createdAtIso).getTime())
      .slice(-limit);
  }

  public insertDirectMessage(params: {
    conversationId: string;
    senderUserId: string;
    receiverUserId: string;
    text: string;
    mediaType?: 'text' | 'audio' | 'image';
    mediaUrl?: string;
    idempotencyKey?: string;
  }): PersistedDirectMessageRow {
    this.catalog.directMessages = this.catalog.directMessages || {};
    this.catalog.chatConversations = this.catalog.chatConversations || {};

    const conv = this.catalog.chatConversations[params.conversationId];
    if (!conv) {
      throw new Error('Conversation does not exist.');
    }
    if (!conv.participantUserIds.includes(params.senderUserId)) {
      throw new Error('Sender is not an authorized participant in this conversation.');
    }
    if (!conv.participantUserIds.includes(params.receiverUserId)) {
      throw new Error('Receiver is not an authorized participant in this conversation.');
    }

    // Idempotency check: if sender already sent message with this key, return it
    if (params.idempotencyKey) {
      for (const m of Object.values(this.catalog.directMessages)) {
        if (
          m.senderUserId === params.senderUserId &&
          m.idempotencyKey === params.idempotencyKey
        ) {
          return m;
        }
      }
    }

    const messageId = `dm_${crypto.randomBytes(8).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const row: PersistedDirectMessageRow = {
      messageId,
      conversationId: params.conversationId,
      senderUserId: params.senderUserId,
      receiverUserId: params.receiverUserId,
      text: params.text.trim(),
      mediaType: params.mediaType || 'text',
      mediaUrl: params.mediaUrl,
      status: 'SENT',
      idempotencyKey: params.idempotencyKey,
      createdAtIso: nowIso,
    };

    this.catalog.directMessages[messageId] = row;
    conv.lastMessageText =
      row.text || (row.mediaType === 'audio' ? 'Voice note' : 'Attachment');
    conv.lastMessageTimestampIso = nowIso;
    conv.lastMessageSenderUserId = params.senderUserId;
    conv.updatedAtIso = nowIso;
    this.persistCatalog();
    return row;
  }

  public updateMessageStatus(
    messageId: string,
    status: 'DELIVERED' | 'READ'
  ): PersistedDirectMessageRow | null {
    this.catalog.directMessages = this.catalog.directMessages || {};
    const msg = this.catalog.directMessages[messageId];
    if (!msg) return null;
    const nowIso = new Date().toISOString();
    if (status === 'DELIVERED' && msg.status === 'SENT') {
      msg.status = 'DELIVERED';
      msg.deliveredAtIso = nowIso;
    } else if (status === 'READ') {
      msg.status = 'READ';
      if (!msg.deliveredAtIso) msg.deliveredAtIso = nowIso;
      msg.readAtIso = nowIso;
    }
    this.persistCatalog();
    return msg;
  }

  public markConversationMessagesRead(
    conversationId: string,
    readerUserId: string
  ): string[] {
    this.catalog.directMessages = this.catalog.directMessages || {};
    const updatedIds: string[] = [];
    const nowIso = new Date().toISOString();
    for (const msg of Object.values(this.catalog.directMessages)) {
      if (
        msg.conversationId === conversationId &&
        msg.receiverUserId === readerUserId &&
        msg.status !== 'READ'
      ) {
        msg.status = 'READ';
        if (!msg.deliveredAtIso) msg.deliveredAtIso = nowIso;
        msg.readAtIso = nowIso;
        updatedIds.push(msg.messageId);
      }
    }
    if (updatedIds.length > 0) {
      this.persistCatalog();
    }
    return updatedIds;
  }

  // ===========================================================================
  // DOMAIN 18: AUTHORITATIVE USER BLOCKING ENFORCEMENT
  // ===========================================================================

  public blockUser(params: {
    blockerUserId: string;
    blockedUserId: string;
    reason?: string;
  }): PersistedBlockedUserRow {
    if (params.blockerUserId === params.blockedUserId) {
      throw new Error('Self-blocking is not permitted.');
    }
    this.catalog.blockedUsers = this.catalog.blockedUsers || {};
    const existing = Object.values(this.catalog.blockedUsers).find(
      (b) => b.blockerUserId === params.blockerUserId && b.blockedUserId === params.blockedUserId
    );
    if (existing) {
      return existing;
    }

    const blockId = `blk_${crypto.randomBytes(8).toString('hex')}`;
    const row: PersistedBlockedUserRow = {
      blockId,
      blockerUserId: params.blockerUserId,
      blockedUserId: params.blockedUserId,
      reason: params.reason,
      createdAtIso: new Date().toISOString(),
    };
    this.catalog.blockedUsers[blockId] = row;
    this.persistCatalog();
    return row;
  }

  public unblockUser(
    paramsOrBlockerId: { blockerUserId: string; blockedUserId: string } | string,
    blockedId?: string
  ): boolean {
    const blockerUserId =
      typeof paramsOrBlockerId === 'string' ? paramsOrBlockerId : paramsOrBlockerId.blockerUserId;
    const blockedUserId =
      typeof paramsOrBlockerId === 'string' ? blockedId! : paramsOrBlockerId.blockedUserId;

    this.catalog.blockedUsers = this.catalog.blockedUsers || {};
    let found = false;
    for (const [id, row] of Object.entries(this.catalog.blockedUsers)) {
      if (row.blockerUserId === blockerUserId && row.blockedUserId === blockedUserId) {
        delete this.catalog.blockedUsers[id];
        found = true;
      }
    }
    if (found) {
      this.persistCatalog();
    }
    return found;
  }

  public isUserBlocked(userA: string, userB: string): boolean {
    this.catalog.blockedUsers = this.catalog.blockedUsers || {};
    for (const row of Object.values(this.catalog.blockedUsers)) {
      if (
        (row.blockerUserId === userA && row.blockedUserId === userB) ||
        (row.blockerUserId === userB && row.blockedUserId === userA)
      ) {
        return true;
      }
    }
    return false;
  }

  public getBlockedUsers(userId: string): PersistedBlockedUserRow[] {
    this.catalog.blockedUsers = this.catalog.blockedUsers || {};
    return Object.values(this.catalog.blockedUsers).filter((b) => b.blockerUserId === userId);
  }

  public getFoundationInspectionSummary() {
    const { summary } = this.resolvePostgresConfig();
    const isRealExternal =
      this.connectionMode === 'REAL_EXTERNAL_POSTGRES_16' && !this.isTestAdapter;
    return {
      engineVersion: isRealExternal
        ? this.liveServerVersion || 'PostgreSQL 16 (External Managed Instance)'
        : 'LOCAL_JSON_TEST_ADAPTER (Non-Production File Persistence — Awaiting External PostgreSQL 16)',
      connectionMode: this.connectionMode,
      isTestAdapter: this.isTestAdapter,
      productionReady: isRealExternal,
      liveServerVersion: this.liveServerVersion,
      lastConnectionError: this.lastConnectionError,
      host: summary.host,
      port: summary.port,
      configSummary: summary,
      initialized: this.initialized,
      appliedMigrations: this.catalog.schemaMigrations,
      tableRowCounts: {
        users: Object.keys(this.catalog.users).length,
        user_profiles: Object.keys(this.catalog.userProfiles).length,
        user_identity_settings: Object.keys(this.catalog.userIdentitySettings).length,
        roles: Object.keys(this.catalog.roles).length,
        permissions: Object.keys(this.catalog.permissions).length,
        user_roles: this.catalog.userRoles.length,
        founding_creator_program_state: 1,
        creator_verifications: Object.keys(this.catalog.creatorVerifications).length,
        creator_accounts: Object.keys(this.catalog.creatorAccounts).length,
        merchant_accounts: Object.keys(this.catalog.merchantAccounts).length,
        business_advertiser_accounts: Object.keys(
          this.catalog.businessAdvertiserAccounts
        ).length,
        device_sessions: Object.keys(this.catalog.deviceSessions).length,
        tv_pairing_records: Object.keys(this.catalog.tvPairingRecords).length,
        audit_events: this.catalog.auditEvents.length,
        financial_policy_registry: Object.keys(this.catalog.financialPolicyRegistry)
          .length,
        financial_ledger_accounts: Object.keys(this.catalog.financialLedgerAccounts)
          .length,
        creator_payable_accounts: Object.keys(this.catalog.creatorPayableAccounts)
          .length,
        merchant_payable_accounts: Object.keys(this.catalog.merchantPayableAccounts)
          .length,
        platform_revenue_accounts: Object.keys(this.catalog.platformRevenueAccounts)
          .length,
        financial_journal_transactions: Object.keys(
          this.catalog.financialJournalTransactions
        ).length,
        financial_ledger_entries: this.catalog.financialLedgerEntries.length,
        video_channels: Object.keys(this.catalog.videoChannels).length,
        video_categories: Object.keys(this.catalog.videoCategories).length,
        videos: Object.keys(this.catalog.videos).length,
        video_tags: Object.keys(this.catalog.videoTags).length,
        video_tag_mappings: this.catalog.videoTagMappings.length,
        video_upload_sessions: Object.keys(this.catalog.videoUploadSessions).length,
        video_transcode_renditions: Object.keys(this.catalog.videoTranscodeRenditions).length,
        video_processing_jobs: Object.keys(this.catalog.videoProcessingJobs).length,
      },
      foundingCreatorProgramState: this.catalog.foundingCreatorProgramState,
      financialPolicies: Object.values(this.catalog.financialPolicyRegistry),
      segregatedPayables: {
        creatorPayableAccounts: Object.values(this.catalog.creatorPayableAccounts),
        merchantPayableAccounts: Object.values(this.catalog.merchantPayableAccounts),
        platformRevenueAccounts: Object.values(this.catalog.platformRevenueAccounts),
      },
    };
  }
}

export const databaseFoundationService = new DatabaseFoundationService();

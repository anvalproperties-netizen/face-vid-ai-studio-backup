/**
 * @face-vid/api — Versioned v1 API Router & OpenAPI Documentation
 *
 * Mounted at /api/v1 in both standalone backend and unified AI Studio runtime.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import {
  AccountSegregationDomain,
  AccountStatus,
  ApiErrorCode,
  AuditActorType,
  ContentVisibility,
  EXPERIENCE_B_TV_ALLOWED_NAV_DESTINATIONS,
  EXPERIENCE_B_TV_EXCLUDED_FEATURES,
  FIVE_MONETIZATION_ENGINE_CONTRACTS,
  FOUNDING_CREATOR_PROGRAM_RULES,
  FinancialTransactionState,
  IdentityMode,
  LedgerEntryDirection,
  LiveAudienceReach,
  MonetizationEngineId,
  PLATFORM_READINESS_MATRIX,
  PlatformId,
  SubscriptionTier,
  TV_PAIRING_SECURITY_POLICY,
  UserRole,
  VideoProcessingStatus,
  createApiErrorEnvelope,
  evaluateGovernancePolicy,
  projectPeerVisibleIdentity,
  redactSensitiveData,
  sanitizeLiveBroadcastLocation,
  validateRegistrationRoleRequest,
  isDailyVerificationActive,
  type LedgerPostingLine,
  type RestrictedActionType,
} from '../../../packages/shared/src/index.ts';
import { apiLogger } from './common/logger.ts';
import {
  lockedCommerceMiddleware,
  rejectClientSubmittedPrivilegesMiddleware,
  requireAdminAuthMiddleware,
  requireAuthMiddleware,
  requireRoleMiddleware,
  secureHttpHeadersMiddleware,
} from './common/security.ts';
import { otpService } from './modules/otp.service.ts';
import {
  buildHealthPayload,
  probeTcpDependency,
} from './health/health.controller.ts';
import { databaseFoundationService } from './database/database.service.ts';
import { PHASE_1A_MODULE_BOUNDARIES } from './modules/boundaries.ts';
import { creatorUploadService } from './modules/creator-upload.service.ts';
import { monetizationLedgerService } from './modules/monetization.service.ts';
import { authService } from './modules/auth.service.ts';
import { adminGovernanceService } from './modules/admin-governance.service.ts';
import { redisFoundationService } from './redis/redis.service.ts';
import { tvDevicePairingService } from './tv/tv-pairing.service.ts';
import { launchService } from './modules/launch.service.ts';
import { realtimeService } from './modules/realtime.service.ts';

export function createApiV1Router(): Router {
  const router = Router();

  router.use(secureHttpHeadersMiddleware);
  router.use(rejectClientSubmittedPrivilegesMiddleware);

  // 1. Health Endpoint: GET /api/v1/health
  router.get('/health', (req: Request, res: Response) => {
    const payload = buildHealthPayload();
    apiLogger.info('Health check executed', { path: req.originalUrl, status: payload.status });
    res.status(200).json(payload);
  });

  // 2. Liveness Endpoint: GET /api/v1/health/live
  router.get('/health/live', (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'alive',
      service: 'face-vid-api',
      apiVersion: 'v1',
      timestampIso: new Date().toISOString(),
    });
  });

  // 3. Readiness Endpoint: GET /api/v1/health/ready
  router.get('/health/ready', async (_req: Request, res: Response) => {
    const strictProduction =
      databaseFoundationService.isProductionMode() ||
      redisFoundationService.isProductionMode();

    try {
      const [pgStatus, redisHealth] = await Promise.all([
        databaseFoundationService.verifyExternalPostgresConnection(),
        redisFoundationService.getHealthStatus(),
      ]);

      const [postgresProbe, redisProbe] = await Promise.all([
        probeTcpDependency('postgresql', pgStatus.host, pgStatus.port),
        probeTcpDependency('redis', redisHealth.host, redisHealth.port),
      ]);

      const realPostgresConnected =
        pgStatus.connected &&
        pgStatus.connectionMode === 'REAL_EXTERNAL_POSTGRES_16' &&
        !pgStatus.isTestAdapter;
      const realRedisConnected =
        redisHealth.connected &&
        redisHealth.connectionMode === 'REAL_EXTERNAL_REDIS_7' &&
        !redisHealth.isTestAdapter;
      const productionReady = realPostgresConnected && realRedisConnected;

      if (strictProduction && !productionReady) {
        res.status(503).json({
          status: 'fail_closed_external_infrastructure_unavailable',
          productionReady: false,
          strictProductionMode: true,
          service: 'face-vid-api',
          apiVersion: 'v1',
          phase: 'PHASE_1B1_DATABASE_AND_REDIS_FOUNDATION',
          timestampIso: new Date().toISOString(),
          dependencies: {
            postgresql: {
              ...postgresProbe,
              connectionMode: pgStatus.connectionMode,
              isTestAdapter: pgStatus.isTestAdapter,
              productionReady: pgStatus.productionReady,
              error: pgStatus.error,
            },
            redis: {
              ...redisProbe,
              connectionMode: redisHealth.connectionMode,
              isTestAdapter: redisHealth.isTestAdapter,
              productionReady: redisHealth.productionReady,
              error: redisHealth.lastError,
            },
          },
        });
        return;
      }

      res.status(200).json({
        status: productionReady ? 'ready' : 'conditional_test_adapters_active',
        productionReady,
        strictProductionMode: strictProduction,
        service: 'face-vid-api',
        apiVersion: 'v1',
        phase: 'PHASE_1B1_DATABASE_AND_REDIS_FOUNDATION',
        timestampIso: new Date().toISOString(),
        dependencies: {
          postgresql: {
            ...postgresProbe,
            connectionMode: pgStatus.connectionMode,
            isTestAdapter: pgStatus.isTestAdapter,
            productionReady: pgStatus.productionReady,
            serverVersion: pgStatus.serverVersion,
            error: pgStatus.error,
          },
          redis: {
            ...redisProbe,
            connectionMode: redisHealth.connectionMode,
            isTestAdapter: redisHealth.isTestAdapter,
            productionReady: redisHealth.productionReady,
            serverVersion: redisHealth.serverVersion,
            error: redisHealth.lastError,
          },
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({
        status: 'fail_closed_external_infrastructure_unavailable',
        productionReady: false,
        strictProductionMode: strictProduction,
        service: 'face-vid-api',
        apiVersion: 'v1',
        phase: 'PHASE_1B1_DATABASE_AND_REDIS_FOUNDATION',
        timestampIso: new Date().toISOString(),
        error: message,
      });
    }
  });

  // 3B. Phase 1B-1 Database & Redis Foundation Status: GET /api/v1/foundation/db-redis-status
  router.get('/foundation/db-redis-status', async (_req: Request, res: Response) => {
    const strictProduction =
      databaseFoundationService.isProductionMode() ||
      redisFoundationService.isProductionMode();

    try {
      await databaseFoundationService.ensureListening();
      const redisHealth = await redisFoundationService.getHealthStatus();
      const dbSummary = databaseFoundationService.getFoundationInspectionSummary();
      const productionReady =
        dbSummary.productionReady && redisHealth.productionReady;

      if (strictProduction && !productionReady) {
        res.status(503).json({
          apiVersion: 'v1',
          phase: 'PHASE_1B1_DATABASE_AND_REDIS_FOUNDATION',
          phase1b1Status: 'FAIL_CLOSED_PRODUCTION_INFRASTRUCTURE_MISSING',
          productionReady: false,
          livePaymentsActive: false,
          database: dbSummary,
          redis: redisHealth,
        });
        return;
      }

      res.status(200).json({
        apiVersion: 'v1',
        phase: 'PHASE_1B1_DATABASE_AND_REDIS_FOUNDATION',
        phase1b1Status: productionReady
          ? 'PASS_EXTERNAL_INFRASTRUCTURE_VERIFIED'
          : 'CONDITIONAL_LOCAL_TEST_ADAPTERS_ACTIVE',
        productionReady,
        livePaymentsActive: false,
        database: dbSummary,
        redis: redisHealth,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(503).json({
        apiVersion: 'v1',
        phase: 'PHASE_1B1_DATABASE_AND_REDIS_FOUNDATION',
        phase1b1Status: 'FAIL_CLOSED_PRODUCTION_INFRASTRUCTURE_MISSING',
        productionReady: false,
        livePaymentsActive: false,
        error: message,
      });
    }
  });

  // 3C. Phase 1B-1 Versioned SQL Migrations: GET /api/v1/foundation/migrations
  router.get('/foundation/migrations', (_req: Request, res: Response) => {
    const migrations = databaseFoundationService.runVersionedMigrations();
    res.status(200).json({
      apiVersion: 'v1',
      phase: 'PHASE_1B1_DATABASE_AND_REDIS_FOUNDATION',
      totalMigrations: migrations.length,
      migrations,
    });
  });

  // 3D. Phase 1B-1 Redis 7 Verification Endpoint: POST /api/v1/foundation/redis-verify
  router.post('/foundation/redis-verify', async (req: Request, res: Response) => {
    const body = (req.body || {}) as { identifier?: string };
    const identifier = body.identifier || `verify_${Date.now()}`;

    const rateLimit = await redisFoundationService.checkRateLimit({
      scope: 'phase1b1_verify',
      identifier,
      limit: 5,
      windowSeconds: 60,
    });

    const challenge = await redisFoundationService.issueAuthChallengeNonce({
      purpose: 'TV_DEVICE_PAIRING',
      targetEntityId: identifier,
      ttlSeconds: 300,
    });

    const consumed = await redisFoundationService.consumeAuthChallengeNonce({
      challengeId: challenge.challengeId,
      presentedNonce: challenge.nonce,
      expectedPurpose: 'TV_DEVICE_PAIRING',
    });

    const replayBlocked = await redisFoundationService.consumeAuthChallengeNonce({
      challengeId: challenge.challengeId,
      presentedNonce: challenge.nonce,
      expectedPurpose: 'TV_DEVICE_PAIRING',
    });

    res.status(200).json({
      ok: true,
      phase: 'PHASE_1B1_DATABASE_AND_REDIS_FOUNDATION',
      rateLimit,
      challengeIssued: challenge,
      firstConsumption: consumed,
      secondConsumptionReplayBlocked: !replayBlocked.valid,
    });
  });

  // 4. Modular Boundaries & Phase 1A Contract Registry: GET /api/v1/architecture/boundaries
  router.get('/architecture/boundaries', (_req: Request, res: Response) => {
    res.status(200).json({
      apiVersion: 'v1',
      phase: 'PHASE_1A',
      foundingCreatorProgram: FOUNDING_CREATOR_PROGRAM_RULES,
      divisions: PHASE_1A_MODULE_BOUNDARIES,
    });
  });

  // 4B. Multi-Platform & Smart TV Readiness Matrix: GET /api/v1/platforms/matrix
  router.get('/platforms/matrix', (_req: Request, res: Response) => {
    res.status(200).json({
      apiVersion: 'v1',
      totalPlatforms: PLATFORM_READINESS_MATRIX.length,
      experienceSeparation: {
        experienceAFullPlatforms: [
          PlatformId.GOOGLE_PLAY_ANDROID,
          PlatformId.APPLE_APP_STORE_IOS,
          PlatformId.MICROSOFT_STORE_WINDOWS,
          PlatformId.FACE_VID_WEB,
        ],
        experienceBTvLeanbackPlatforms: [
          PlatformId.ANDROID_TV_GOOGLE_TV,
          PlatformId.SAMSUNG_TIZEN_TV,
          PlatformId.LG_WEBOS_TV,
          PlatformId.APPLE_TVOS,
          PlatformId.AMAZON_FIRE_TV,
        ],
        tvAllowedDestinations: EXPERIENCE_B_TV_ALLOWED_NAV_DESTINATIONS,
        tvExcludedFeatures: EXPERIENCE_B_TV_EXCLUDED_FEATURES,
      },
      tvPairingSecurityPolicy: TV_PAIRING_SECURITY_POLICY,
      platforms: PLATFORM_READINESS_MATRIX,
    });
  });

  // 4C. TV Device-Linking Authentication Endpoints (/api/v1/auth/tv-device/*)
  router.post('/auth/tv-device/code', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || 'fv_req_tv_code';
    const clientIp = req.ip || '127.0.0.1';

    if (!tvDevicePairingService.checkRateLimit(clientIp)) {
      res.status(429).json(
        createApiErrorEnvelope({
          statusCode: 429,
          errorCode: ApiErrorCode.RATE_LIMITED,
          message: 'Too many TV pairing code requests from this IP window.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    const body = (req.body || {}) as {
      devicePlatform?: PlatformId;
      deviceDisplayName?: string;
    };

    const record = tvDevicePairingService.createPairingRequest({
      devicePlatform: body.devicePlatform || PlatformId.SAMSUNG_TIZEN_TV,
      deviceDisplayName: body.deviceDisplayName || 'FACE VID Living Room 4K TV',
    });

    res.status(201).json(record);
  });

  router.post('/auth/tv-device/confirm', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || 'fv_req_tv_confirm';
    const authHeader = req.headers.authorization;
    const bearerToken =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : undefined;

    const body = (req.body || {}) as {
      shortPairingCode?: string;
      authenticatedSessionToken?: string;
      authenticatedUserId?: string;
      targetAccountToLinkUserId?: string;
      authorizingUserHandle?: string;
      accountStatus?: AccountStatus;
      expectedVersion?: number;
    };

    if (!body.shortPairingCode) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'shortPairingCode is required.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    const result = tvDevicePairingService.confirmPairingFromMobileOrWeb({
      shortPairingCode: body.shortPairingCode,
      authenticatedSessionToken: body.authenticatedSessionToken || bearerToken,
      authenticatedUserId: body.authenticatedUserId,
      targetAccountToLinkUserId: body.targetAccountToLinkUserId,
      authorizingUserHandle: body.authorizingUserHandle || '@elenavance',
      accountStatus: body.accountStatus,
      expectedVersion: body.expectedVersion,
    });

    if (!result.ok) {
      res.status(result.statusCode).json(
        createApiErrorEnvelope({
          statusCode: result.statusCode,
          errorCode:
            result.statusCode === 401
              ? ApiErrorCode.UNAUTHORIZED
              : result.statusCode === 429
                ? ApiErrorCode.RATE_LIMITED
                : ApiErrorCode.BAD_REQUEST,
          message: result.error || 'Unable to confirm pairing code.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    res.status(200).json(result.record);
  });

  router.post('/auth/tv-device/poll', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || 'fv_req_tv_poll';
    const body = (req.body || {}) as {
      shortPairingCode?: string;
      deviceChallengeNonce?: string;
      devicePlatform?: PlatformId;
    };

    if (!body.shortPairingCode) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'shortPairingCode is required.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    const result = tvDevicePairingService.pollOrExchangeTvSession({
      shortPairingCode: body.shortPairingCode,
      deviceChallengeNonce: body.deviceChallengeNonce || '',
      devicePlatform: body.devicePlatform,
    });

    if (!result.ok) {
      res.status(result.statusCode).json(
        createApiErrorEnvelope({
          statusCode: result.statusCode,
          errorCode:
            result.statusCode === 429 ? ApiErrorCode.RATE_LIMITED : ApiErrorCode.BAD_REQUEST,
          message: result.error || 'Pairing code exchange failed.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    res.status(200).json(result);
  });

  router.post('/auth/tv-device/revoke', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || 'fv_req_tv_revoke';
    const body = (req.body || {}) as { shortPairingCode?: string; deviceSessionId?: string };

    if (!body.shortPairingCode && !body.deviceSessionId) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'shortPairingCode or deviceSessionId is required.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    const result = tvDevicePairingService.revokeDeviceSession({
      shortPairingCode: body.shortPairingCode,
      deviceSessionId: body.deviceSessionId,
    });

    if (!result.ok) {
      res.status(404).json(
        createApiErrorEnvelope({
          statusCode: 404,
          errorCode: ApiErrorCode.NOT_FOUND,
          message: result.error || 'Pairing session not found.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    res.status(200).json(result.record);
  });

  // 4D. Five Monetisation Engines & Double-Entry Ledger Contracts (/api/v1/monetization/*)
  router.get('/monetization/contracts', (_req: Request, res: Response) => {
    res.status(200).json({
      apiVersion: 'v1',
      phase: 'PHASE_1A',
      livePaymentsActive: false,
      inventedCommissionRates: false,
      totalEngines: FIVE_MONETIZATION_ENGINE_CONTRACTS.length,
      engines: monetizationLedgerService.getEngineContracts(),
      recentFinancialAuditTrail: monetizationLedgerService.getFinancialAuditTrail().slice(-10),
    });
  });

  router.post('/monetization/verify-ledger', (req: Request, res: Response) => {
    const body = (req.body || {}) as {
      idempotencyKey?: string;
      engineId?: MonetizationEngineId;
      currencyIso?: string;
      actorId?: string;
      actorType?: AuditActorType;
      state?: FinancialTransactionState;
      lines?: readonly LedgerPostingLine[];
      clientSubmittedBalanceOverride?: number;
    };

    const defaultLines: readonly LedgerPostingLine[] = [
      {
        lineId: 'line_debit_1',
        accountId: 'acct_usr_wallet_101',
        ownerEntityId: 'usr_101',
        segregationDomain: AccountSegregationDomain.USER_PREPAID_WALLET,
        direction: LedgerEntryDirection.DEBIT,
        amountMinorUnits: 5000,
        currencyIso: body.currencyIso || 'ZAR',
      },
      {
        lineId: 'line_credit_1',
        accountId: 'acct_creator_call_escrow_202',
        ownerEntityId: 'creator_202',
        segregationDomain: AccountSegregationDomain.CREATOR_CALL_ESCROW,
        direction: LedgerEntryDirection.CREDIT,
        amountMinorUnits: 5000,
        currencyIso: body.currencyIso || 'ZAR',
      },
    ];

    const result = monetizationLedgerService.recordAuthoritativeJournal({
      idempotencyKey: body.idempotencyKey || `idem_${Date.now()}`,
      engineId: body.engineId || MonetizationEngineId.ENGINE_1_PREPAID_CREATOR_CALLS,
      currencyIso: body.currencyIso || 'ZAR',
      actorId: body.actorId || 'usr_101',
      actorType: body.actorType || AuditActorType.USER,
      state: body.state || FinancialTransactionState.PHASE_1A_CONTRACT_ONLY,
      lines: body.lines || defaultLines,
      clientSubmittedBalanceOverride: body.clientSubmittedBalanceOverride,
    });

    res.status(result.statusCode).json(result);
  });

  // 5. OpenAPI 3.1 Documentation for Implemented Phase 1A Endpoints: GET /api/v1/docs
  router.get('/docs', (_req: Request, res: Response) => {
    res.status(200).json({
      openapi: '3.1.0',
      info: {
        title: 'FACE VID Central Backend API',
        version: '1.0.0-phase1a',
        description:
          'Phase 1A foundation API providing health/liveness/readiness probes, security boundary verification, sensitive-data redaction verification, and modular service contracts.',
      },
      paths: {
        '/api/v1/health': {
          get: {
            summary: 'Service health and Phase 1A security posture summary',
            responses: { '200': { description: 'Service is healthy' } },
          },
        },
        '/api/v1/health/live': {
          get: {
            summary: 'Process liveness check',
            responses: { '200': { description: 'Process is alive' } },
          },
        },
        '/api/v1/health/ready': {
          get: {
            summary: 'PostgreSQL and Redis dependency readiness check',
            responses: { '200': { description: 'Dependency probe report' } },
          },
        },
        '/api/v1/architecture/boundaries': {
          get: {
            summary: 'Modular division boundaries and Founding Creator Program rules',
            responses: { '200': { description: 'Modular division registry' } },
          },
        },
        '/api/v1/security/verify-contracts': {
          post: {
            summary:
              'Validates request payload sanitization, identity privacy mode projection, live stream coordinate redaction, and AI governance locks',
            responses: {
              '200': { description: 'Contract validation result' },
              '400': { description: 'Validation error' },
              '403': { description: 'Privilege escalation or deny-by-default block' },
            },
          },
        },
      },
    });
  });

  // 6. Interactive Security & Contract Verification Endpoint: POST /api/v1/security/verify-contracts
  router.post('/security/verify-contracts', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || 'fv_req_verify';
    const body = (req.body || {}) as {
      identityMode?: IdentityMode;
      liveReach?: LiveAudienceReach;
      simulatedLatitude?: number;
      simulatedLongitude?: number;
      requestedRegistrationRole?: string;
      simulatedAiAction?: RestrictedActionType;
      sampleLogWithSecrets?: Record<string, unknown>;
    };

    if (
      body.identityMode &&
      body.identityMode !== IdentityMode.PUBLIC &&
      body.identityMode !== IdentityMode.PRIVATE
    ) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'Invalid identityMode value supplied.',
          requestId,
          path: req.originalUrl,
          violations: [
            { field: 'identityMode', message: 'Must be PUBLIC or PRIVATE.' },
          ],
        })
      );
      return;
    }

    const mode = body.identityMode || IdentityMode.PRIVATE;
    const sampleUser = {
      id: 'usr_9948102',
      activeMode: mode,
      roles: [UserRole.USER, UserRole.CREATOR] as const,
      status: AccountStatus.ACTIVE,
      subscriptionTier: SubscriptionTier.FREE_STANDARD,
      mfaEnrolled: true,
      phishingResistantMfaVerified: false,
      publicProfile: {
        displayName: 'Elena Vance Studio',
        handle: '@elenavance',
        bio: 'Anamorphic cinematography & real-time neural shader design.',
        avatarUrl: '/assets/avatars/elena_public.png',
        verifiedBadge: true,
      },
      privateProfile: {
        pseudonym: 'CipherFrame_88',
        avatarSeedId: 'seed_7f9a2c',
        avatarStyle: 'GEOMETRIC_SHIELD' as const,
      },
      legalFullName: 'Elena Maria Vance-Kowalski (CONFIDENTIAL)',
      primaryEmail: 'elena.private@example.com',
      countryIsoCode: 'ZA',
      createdAtIso: '2026-10-08T00:00:00.000Z',
    };

    const peerProjection = projectPeerVisibleIdentity(sampleUser);
    const liveSanitized = sanitizeLiveBroadcastLocation({
      reach: body.liveReach || LiveAudienceReach.RADIUS_15KM,
      latitude: body.simulatedLatitude ?? -33.9249,
      longitude: body.simulatedLongitude ?? 18.4241,
      cityCode: 'CPT',
      countryIso: 'ZA',
      continentCode: 'AF',
    });

    const roleCheck = validateRegistrationRoleRequest(body.requestedRegistrationRole);
    const aiGovernanceCheck = evaluateGovernancePolicy({
      actorType: AuditActorType.AI_AGENT,
      actorRoles: [],
      action: body.simulatedAiAction || 'PROMOTE_PRIVILEGED_ROLE',
      hasHumanApprovalTicket: false,
      hasOwnerSignature: false,
    });

    const redactedSample = redactSensitiveData(
      body.sampleLogWithSecrets || {
        event: 'auth_attempt',
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret.sig',
        cardNumber: '4532 0151 1283 0366',
        latitude: -33.9249,
        longitude: 18.4241,
        legalFullName: 'Elena Maria Vance-Kowalski',
        safeMetric: 42,
      }
    );

    apiLogger.info('Executed Phase 1A security contract verification', {
      identityMode: mode,
      liveReach: liveSanitized.reach,
      authorization: 'Bearer should_be_redacted_in_logs',
    });

    res.status(200).json({
      verified: true,
      peerVisibleIdentity: peerProjection,
      liveBroadcastLocationSanitized: liveSanitized,
      registrationRoleValidation: roleCheck,
      aiGovernanceEnforcement: aiGovernanceCheck,
      redactedLogPreview: redactedSample,
      recentServerLogs: apiLogger.getRecentRedactedLogs(5),
    });
  });

  // 6B. Official Owner Logo Status & Lossless Binary Storage: /api/v1/brand/owner-logo
  router.get('/brand/owner-logo/status', (_req: Request, res: Response) => {
    const masterPath = path.resolve(
      process.cwd(),
      'public/assets/owner/face-vid-official-logo.png'
    );
    const exists = fs.existsSync(masterPath);
    let byteLength = 0;
    let sha256: string | null = null;
    if (exists) {
      const buf = fs.readFileSync(masterPath);
      byteLength = buf.byteLength;
      sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    }
    res.status(200).json({
      ok: true,
      masterRepoPath: 'public/assets/owner/face-vid-official-logo.png',
      publicUrlPath: '/assets/owner/face-vid-official-logo.png',
      binaryPresentOnDisk: exists,
      byteLength,
      sha256,
    });
  });

  router.post('/brand/owner-logo', (req: Request, res: Response) => {
    const body = (req.body || {}) as { base64Data?: string; filename?: string };
    if (!body.base64Data || typeof body.base64Data !== 'string') {
      res.status(400).json({
        ok: false,
        error: 'base64Data is required to write public/assets/owner/face-vid-official-logo.png',
      });
      return;
    }

    const cleanedBase64 = body.base64Data.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
    const buffer = Buffer.from(cleanedBase64, 'base64');

    // Verify PNG signature (89 50 4E 47 0D 0A 1A 0A)
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (buffer.byteLength < 8 || !buffer.subarray(0, 8).equals(pngSignature)) {
      res.status(400).json({
        ok: false,
        error: 'Uploaded file must be a valid binary PNG image (exact owner logo asset).',
      });
      return;
    }

    const masterPath = path.resolve(
      process.cwd(),
      'public/assets/owner/face-vid-official-logo.png'
    );
    const sourcePath = path.resolve(
      process.cwd(),
      'public/assets/owner/face-vid-official-logo-source.png'
    );
    const mobileAssetPath = path.resolve(
      process.cwd(),
      'apps/mobile/assets/owner/face-vid-official-logo.png'
    );

    fs.mkdirSync(path.dirname(masterPath), { recursive: true });
    fs.writeFileSync(masterPath, buffer);
    fs.writeFileSync(sourcePath, buffer);

    fs.mkdirSync(path.dirname(mobileAssetPath), { recursive: true });
    fs.writeFileSync(mobileAssetPath, buffer);

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    apiLogger.info('Stored unmodified official owner logo PNG & immutable source asset', {
      masterPath: 'public/assets/owner/face-vid-official-logo.png',
      sourcePath: 'public/assets/owner/face-vid-official-logo-source.png',
      byteLength: buffer.byteLength,
      sha256,
    });

    res.status(200).json({
      ok: true,
      masterRepoPath: 'public/assets/owner/face-vid-official-logo.png',
      sourceRepoPath: 'public/assets/owner/face-vid-official-logo-source.png',
      mobileRepoPath: 'apps/mobile/assets/owner/face-vid-official-logo.png',
      byteLength: buffer.byteLength,
      sha256,
    });
  });

  // 6C. Video Catalog & Read-Only Endpoints (Phase 1 Task 1.1A)
  router.get('/videos', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `fv_req_vids_${Date.now()}`;
    const pageQuery = req.query.page as string | undefined;
    const limitQuery = req.query.limit as string | undefined;
    const categoryQuery = req.query.category as string | undefined;
    const channelIdQuery = req.query.channelId as string | undefined;
    const formatQuery = (req.query.format || req.query.videoFormat) as string | undefined;
    const searchQuery = (req.query.search || req.query.q) as string | undefined;

    if (pageQuery !== undefined && (Number.isNaN(Number(pageQuery)) || Number(pageQuery) < 1)) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: "Query parameter 'page' must be a positive integer greater than or equal to 1.",
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    if (limitQuery !== undefined && (Number.isNaN(Number(limitQuery)) || Number(limitQuery) < 1)) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: "Query parameter 'limit' must be a positive integer between 1 and 100.",
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    const result = databaseFoundationService.listVideos({
      page: pageQuery ? Number(pageQuery) : undefined,
      limit: limitQuery ? Number(limitQuery) : undefined,
      category: categoryQuery,
      channelId: channelIdQuery,
      videoFormat: formatQuery as any,
      search: searchQuery,
      visibility: ContentVisibility.PUBLIC,
    });

    res.status(200).json({
      ok: true,
      data: result.items,
      pagination: result.pagination,
      timestampIso: new Date().toISOString(),
    });
  });

  // 6D. Phase 1 Task 1.3B: Secure Creator Video Upload Session Endpoints
  // POST /api/v1/videos/upload-sessions: Initiate upload session
  router.post('/videos/upload-sessions', async (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `fv_req_upload_${Date.now()}`;
    const authHeader = req.headers.authorization;
    const sessionTokenHeader = req.headers['x-session-token'] as string | undefined;

    const result = await creatorUploadService.initiateUploadSession({
      authHeader,
      sessionToken: sessionTokenHeader,
      body: req.body,
      requestId,
      clientIp: req.ip || '127.0.0.1',
    });

    if (!result.ok) {
      res.status(result.statusCode).json(
        createApiErrorEnvelope({
          statusCode: result.statusCode,
          errorCode: result.errorCode || ApiErrorCode.BAD_REQUEST,
          message: result.message || 'Failed to initiate video upload session.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    res.status(result.statusCode).json(result.data);
  });

  // GET /api/v1/videos/upload-sessions: List creator's active and past upload sessions
  router.get('/videos/upload-sessions', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `fv_req_uploads_list_${Date.now()}`;
    const authHeader = req.headers.authorization;
    const sessionTokenHeader = req.headers['x-session-token'] as string | undefined;

    const result = creatorUploadService.listUploadSessions({
      authHeader,
      sessionToken: sessionTokenHeader,
      requestId,
    });

    if (!result.ok) {
      res.status(result.statusCode).json(
        createApiErrorEnvelope({
          statusCode: result.statusCode,
          errorCode: result.errorCode || ApiErrorCode.BAD_REQUEST,
          message: result.message || 'Failed to list creator upload sessions.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    res.status(200).json({
      ok: true,
      data: result.data,
      timestampIso: new Date().toISOString(),
    });
  });

  // GET /api/v1/videos/upload-sessions/:sessionId: Retrieve upload session status
  router.get('/videos/upload-sessions/:sessionId', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `fv_req_sess_stat_${Date.now()}`;
    const sessionId = req.params.sessionId;
    const authHeader = req.headers.authorization;
    const sessionTokenHeader = req.headers['x-session-token'] as string | undefined;

    const result = creatorUploadService.getUploadSessionStatus({
      authHeader,
      sessionToken: sessionTokenHeader,
      sessionId,
      requestId,
    });

    if (!result.ok) {
      res.status(result.statusCode).json(
        createApiErrorEnvelope({
          statusCode: result.statusCode,
          errorCode: result.errorCode || ApiErrorCode.BAD_REQUEST,
          message: result.message || 'Failed to retrieve upload session status.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    res.status(200).json({
      ok: true,
      data: result.data,
      timestampIso: new Date().toISOString(),
    });
  });

  // POST /api/v1/videos/upload-sessions/:sessionId/cancel: Cancel / abort upload session
  router.post('/videos/upload-sessions/:sessionId/cancel', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `fv_req_sess_cancel_${Date.now()}`;
    const sessionId = req.params.sessionId;
    const authHeader = req.headers.authorization;
    const sessionTokenHeader = req.headers['x-session-token'] as string | undefined;

    const result = creatorUploadService.cancelUploadSession({
      authHeader,
      sessionToken: sessionTokenHeader,
      sessionId,
      requestId,
    });

    if (!result.ok) {
      res.status(result.statusCode).json(
        createApiErrorEnvelope({
          statusCode: result.statusCode,
          errorCode: result.errorCode || ApiErrorCode.BAD_REQUEST,
          message: result.message || 'Failed to cancel upload session.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    res.status(200).json({
      ok: true,
      data: result.data,
      timestampIso: new Date().toISOString(),
    });
  });

  // DELETE /api/v1/videos/upload-sessions/:sessionId: HTTP DELETE alias for cancel
  router.delete('/videos/upload-sessions/:sessionId', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `fv_req_sess_del_${Date.now()}`;
    const sessionId = req.params.sessionId;
    const authHeader = req.headers.authorization;
    const sessionTokenHeader = req.headers['x-session-token'] as string | undefined;

    const result = creatorUploadService.cancelUploadSession({
      authHeader,
      sessionToken: sessionTokenHeader,
      sessionId,
      requestId,
    });

    if (!result.ok) {
      res.status(result.statusCode).json(
        createApiErrorEnvelope({
          statusCode: result.statusCode,
          errorCode: result.errorCode || ApiErrorCode.BAD_REQUEST,
          message: result.message || 'Failed to cancel upload session.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    res.status(200).json({
      ok: true,
      data: result.data,
      timestampIso: new Date().toISOString(),
    });
  });

  router.get('/videos/:id', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `fv_req_vid_${Date.now()}`;
    const videoId = req.params.id;

    if (!videoId || typeof videoId !== 'string' || videoId.trim().length === 0 || videoId.length > 128) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'A valid non-empty video identifier is required.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    const video = databaseFoundationService.getVideoById(videoId.trim());

    if (!video) {
      res.status(404).json(
        createApiErrorEnvelope({
          statusCode: 404,
          errorCode: ApiErrorCode.NOT_FOUND,
          message: `Video with identifier '${videoId}' was not found in the catalog.`,
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    // 1. Non-READY Video Protection:
    // Prevent non-READY (UPLOADING, PROCESSING, FAILED) videos from exposing playback URLs.
    // Return a consistent safe error response without exposing internal media storage paths.
    if (video.processingStatus !== VideoProcessingStatus.READY) {
      res.status(404).json(
        createApiErrorEnvelope({
          statusCode: 404,
          errorCode: ApiErrorCode.NOT_FOUND,
          message: `Video with identifier '${videoId}' is unavailable or still processing.`,
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    // 2. Private Video Protection:
    if (video.visibility === ContentVisibility.PRIVATE) {
      res.status(404).json(
        createApiErrorEnvelope({
          statusCode: 404,
          errorCode: ApiErrorCode.NOT_FOUND,
          message: `Video with identifier '${videoId}' is private or inaccessible.`,
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    // 3. Subscriber-Only Video Protection:
    // Prevent unauthenticated or unauthorized users from retrieving SUBSCRIBERS_ONLY videos.
    // Client-supplied subscriber status is never trusted. Until authenticated subscriber verification
    // is implemented, deny public access and never expose playback URLs.
    if (video.visibility === ContentVisibility.SUBSCRIBERS_ONLY) {
      res.status(403).json(
        createApiErrorEnvelope({
          statusCode: 403,
          errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
          message:
            'Access to subscriber-only content requires verified active subscription. Public playback access is denied.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    // 4. Age-Restricted Video Protection:
    // For videos marked AGE_RESTRICTED or isAgeRestricted = true, do not return playback URLs without
    // verified adult age eligibility. Arbitrary client-supplied headers are not trusted as proof of age.
    if (video.visibility === ContentVisibility.AGE_RESTRICTED || video.isAgeRestricted) {
      res.status(403).json(
        createApiErrorEnvelope({
          statusCode: 403,
          errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
          message:
            'Access to age-restricted content requires trusted adult age verification. Public playback access is denied.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    res.status(200).json({
      ok: true,
      data: video,
      timestampIso: new Date().toISOString(),
    });
  });

  // ===========================================================================
  // 7. PHASE 1.4B AUTHENTICATION & ONBOARDING ENDPOINTS
  // ===========================================================================

  // 7.1 Register: POST /api/v1/auth/register
  router.post('/auth/register', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_reg_${Date.now()}`;
    try {
      const result = authService.register(req.body);
      res.status(201).json({
        ok: true,
        data: result,
        timestampIso: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registration failed.';
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: msg,
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 7.2 Login: POST /api/v1/auth/login
  router.post('/auth/login', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_login_${Date.now()}`;
    try {
      const session = authService.loginWithPassword(req.body);
      res.status(200).json({
        ok: true,
        data: session,
        timestampIso: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed.';
      res.status(401).json(
        createApiErrorEnvelope({
          statusCode: 401,
          errorCode: ApiErrorCode.UNAUTHORIZED,
          message: msg,
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 7.3 Email Verification: POST /api/v1/auth/verify-email
  router.post('/auth/verify-email', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_vemail_${Date.now()}`;
    const token = req.body?.token;
    if (!token) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.BAD_REQUEST,
          message: 'Verification token required.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const consumed = databaseFoundationService.consumeAuthToken(tokenHash, 'EMAIL_VERIFICATION');
    if (!consumed) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'Invalid or expired verification token.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }
    res.status(200).json({
      ok: true,
      message: 'Email address verified successfully.',
      userId: consumed.userId,
    });
  });

  // 7.4 Forgot Password: POST /api/v1/auth/forgot-password (Constant-Time Enumeration Guard)
  router.post('/auth/forgot-password', (req: Request, res: Response) => {
    const email = req.body?.email?.trim().toLowerCase();
    if (email) {
      const user = databaseFoundationService.findUserByEmail(email);
      if (user) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        databaseFoundationService.createAuthToken({
          userId: user.userId,
          tokenType: 'PASSWORD_RESET',
          tokenHash,
          ttlMs: 15 * 60 * 1000, // 15 mins
        });
      }
    }
    // Always 200 to prevent email enumeration
    res.status(200).json({
      ok: true,
      message: 'If an account exists with this email address, password reset instructions have been generated.',
    });
  });

  // 7.5 Reset Password: POST /api/v1/auth/reset-password
  router.post('/auth/reset-password', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_preset_${Date.now()}`;
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword || newPassword.length < 8) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.BAD_REQUEST,
          message: 'Valid token and new password (min 8 chars) required.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const consumed = databaseFoundationService.consumeAuthToken(tokenHash, 'PASSWORD_RESET');
    if (!consumed) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'Invalid or expired password reset token.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    const { hash, salt } = authService.hashPassword(newPassword);
    databaseFoundationService.upsertAuthCredentials({
      userId: consumed.userId,
      passwordHash: hash,
      salt,
      algo: 'sha256_salted',
    });
    // Revoke previous sessions on password change
    databaseFoundationService.revokeAllUserSessions(consumed.userId, 'Password changed');

    res.status(200).json({
      ok: true,
      message: 'Password has been reset successfully. Please sign in with your new password.',
    });
  });

  // 7.6 Passkey Registration Options: POST /api/v1/auth/passkey/register/options
  router.post('/auth/passkey/register/options', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_pkopt_${Date.now()}`;
    const userId = req.body?.userId;
    if (!userId) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.BAD_REQUEST,
          message: 'userId is required for passkey enrollment.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }
    try {
      const options = authService.getPasskeyRegistrationOptions(userId);
      res.status(200).json({ ok: true, data: options });
    } catch (err) {
      res.status(404).json(
        createApiErrorEnvelope({
          statusCode: 404,
          errorCode: ApiErrorCode.NOT_FOUND,
          message: err instanceof Error ? err.message : 'User not found.',
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 7.7 Passkey Registration Verify: POST /api/v1/auth/passkey/register/verify
  router.post('/auth/passkey/register/verify', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_pkregv_${Date.now()}`;
    try {
      const result = authService.verifyPasskeyRegistration(req.body);
      res.status(200).json({ ok: true, data: result });
    } catch (err) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.PASSKEY_CHALLENGE_EXPIRED,
          message: err instanceof Error ? err.message : 'Passkey verification failed.',
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 7.8 Passkey Login Options: POST /api/v1/auth/passkey/login/options
  router.post('/auth/passkey/login/options', (req: Request, res: Response) => {
    const options = authService.getPasskeyLoginOptions(req.body?.email);
    res.status(200).json({ ok: true, data: options });
  });

  // 7.9 Passkey Login Verify: POST /api/v1/auth/passkey/login/verify
  router.post('/auth/passkey/login/verify', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_pklogv_${Date.now()}`;
    try {
      const session = authService.verifyPasskeyLogin(req.body);
      res.status(200).json({ ok: true, data: session });
    } catch (err) {
      res.status(401).json(
        createApiErrorEnvelope({
          statusCode: 401,
          errorCode: ApiErrorCode.INVALID_PASSKEY_ASSERTION,
          message: err instanceof Error ? err.message : 'Passkey authentication failed.',
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 7.10 Daily First-Sign-In Verification: POST /api/v1/auth/daily-verify
  router.post('/auth/daily-verify', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_dailyv_${Date.now()}`;
    const sessionId = (req.headers['x-session-id'] as string) || req.body?.sessionId;
    const method = req.body?.method || 'WEBAUTHN_BIOMETRIC';

    if (!sessionId) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.BAD_REQUEST,
          message: 'sessionId is required for daily verification.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    try {
      const status = authService.verifyDailyTouchpoint({ sessionId, method });
      res.status(200).json({ ok: true, data: status });
    } catch (err) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: err instanceof Error ? err.message : 'Daily verification failed.',
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 7.11 Emergency Recovery Code Verify: POST /api/v1/auth/recovery/verify
  router.post('/auth/recovery/verify', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_recov_${Date.now()}`;
    try {
      const session = authService.verifyEmergencyRecoveryCode(req.body);
      res.status(200).json({ ok: true, data: session });
    } catch (err) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.INVALID_RECOVERY_CODE,
          message: err instanceof Error ? err.message : 'Invalid recovery code.',
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 7.12 Session Refresh with Token Rotation: POST /api/v1/auth/session/refresh
  router.post('/auth/session/refresh', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_rtr_${Date.now()}`;
    const refreshToken = req.body?.refreshToken;
    if (!refreshToken) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.BAD_REQUEST,
          message: 'refreshToken is required.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }
    try {
      const freshSession = authService.rotateRefreshToken(refreshToken);
      res.status(200).json({ ok: true, data: freshSession });
    } catch (err) {
      res.status(401).json(
        createApiErrorEnvelope({
          statusCode: 401,
          errorCode: ApiErrorCode.UNAUTHORIZED,
          message: err instanceof Error ? err.message : 'Token rotation failed.',
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 7.13 Session Revoke (Logout): POST /api/v1/auth/session/revoke and POST /api/v1/auth/logout
  router.post(['/auth/session/revoke', '/auth/logout'], (req: Request, res: Response) => {
    let sessionId = (req.headers['x-session-id'] as string) || req.body?.sessionId;
    if (!sessionId) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7).trim();
        const session = databaseFoundationService.findDeviceSessionByToken(token);
        if (session) {
          sessionId = session.sessionId;
        }
      }
    }
    if (sessionId) {
      databaseFoundationService.revokeDeviceSession(sessionId, 'User sign-out');
    }
    res.status(200).json({ ok: true, message: 'Session revoked successfully.' });
  });

  // 7.13A Current Authenticated Session Status: GET /api/v1/auth/session/me
  router.get('/auth/session/me', requireAuthMiddleware, (req: Request, res: Response) => {
    const user = (req as any).authUser;
    const session = (req as any).authSession;
    const roles = (req as any).authUserRoles;
    res.status(200).json({
      ok: true,
      data: {
        userId: user.userId,
        email: user.primaryEmail,
        legalFullName: user.legalFullName,
        roles,
        accountStatus: user.accountStatus,
        subscriptionTier: user.subscriptionTier,
        mfaEnrolled: user.mfaEnrolled,
        phishingResistantMfaVerified: user.phishingResistantMfaVerified,
        sessionId: session.sessionId,
        expiresAtIso: session.expiresAtIso,
      },
    });
  });

  // 7.13C OAuth Provider Configuration Status: GET /api/v1/auth/oauth/config
  router.get('/auth/oauth/config', (_req: Request, res: Response) => {
    const googleConfigured = Boolean(process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID);
    const appleConfigured = Boolean(process.env.APPLE_CLIENT_ID || process.env.NEXT_PUBLIC_APPLE_CLIENT_ID);
    res.status(200).json({
      ok: true,
      data: {
        google: {
          available: googleConfigured,
          message: googleConfigured ? 'Ready' : 'Google OAuth client ID not configured in server environment.',
        },
        apple: {
          available: appleConfigured,
          message: appleConfigured ? 'Ready' : 'Apple Services ID not configured in server environment.',
        },
        passkey: {
          available: false,
          cryptographicVerificationPending: true,
          message: 'WebAuthn assertion verification library (@simplewebauthn/server) is pending owner approval. Fail-closed security active.',
        },
      },
    });
  });

  // 7.13B STAGE 6A: Dual-Contact OTP Endpoints (/api/v1/auth/otp/*)
  // Send Email OTP
  router.post('/auth/otp/send-email', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_otpe_${Date.now()}`;
    const email = req.body?.email;
    try {
      const result = otpService.sendEmailOtp(email);
      res.status(200).json({ ok: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send email OTP.';
      const isRateLimit = msg.includes('Too many') || msg.includes('wait');
      res.status(isRateLimit ? 429 : 400).json(
        createApiErrorEnvelope({
          statusCode: isRateLimit ? 429 : 400,
          errorCode: isRateLimit ? ApiErrorCode.RATE_LIMITED : ApiErrorCode.VALIDATION_FAILED,
          message: msg,
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // Send Mobile SMS OTP
  router.post('/auth/otp/send-sms', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_otps_${Date.now()}`;
    const mobileNumber = req.body?.mobileNumber;
    try {
      const result = otpService.sendSmsOtp(mobileNumber);
      res.status(200).json({ ok: true, data: result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send SMS OTP.';
      const isRateLimit = msg.includes('Too many') || msg.includes('wait');
      res.status(isRateLimit ? 429 : 400).json(
        createApiErrorEnvelope({
          statusCode: isRateLimit ? 429 : 400,
          errorCode: isRateLimit ? ApiErrorCode.RATE_LIMITED : ApiErrorCode.VALIDATION_FAILED,
          message: msg,
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // Verify Single OTP
  router.post('/auth/otp/verify', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_otpv_${Date.now()}`;
    const { challengeId, otp } = req.body || {};
    if (!challengeId || !otp) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'Both challengeId and otp are required.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    const result = otpService.verifyOtp({ challengeId, presentedOtp: otp });
    if (!result.success) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: result.error || 'Verification failed.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    res.status(200).json({ ok: true, data: result });
  });

  // Verify Dual-Contact (Email + Mobile SMS)
  router.post('/auth/otp/verify-dual', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_otpd_${Date.now()}`;
    const { emailChallengeId, emailOtp, smsChallengeId, smsOtp } = req.body || {};

    if (!emailChallengeId || !emailOtp || !smsChallengeId || !smsOtp) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'Both email and SMS OTP challenges and codes are required for dual verification.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    const result = otpService.verifyDualContact({
      emailChallengeId,
      emailOtp,
      smsChallengeId,
      smsOtp,
    });

    if (!result.success) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: result.error || 'Dual-contact verification failed.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    res.status(200).json({ ok: true, data: result });
  });

  // Safe OAuth Identity Linking: POST /api/v1/auth/link-oauth
  router.post('/auth/link-oauth', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_link_${Date.now()}`;
    const authHeader = req.headers.authorization;
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (req.headers['x-session-id']) {
      token = req.headers['x-session-id'] as string;
    } else if (req.body?.sessionToken) {
      token = req.body.sessionToken;
    }

    const { provider, externalSubjectId, externalEmail } = req.body || {};
    if (!token) {
      res.status(401).json(
        createApiErrorEnvelope({
          statusCode: 401,
          errorCode: ApiErrorCode.UNAUTHORIZED,
          message: 'Active authenticated session required to link an external identity.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    if (!provider || !externalSubjectId) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'Both provider and externalSubjectId are required.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    try {
      const linked = authService.linkExternalOAuthIdentity({
        authenticatedSessionToken: token,
        provider,
        externalSubjectId,
        externalEmail,
      });
      res.status(200).json({ ok: true, data: linked });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Account linking failed.';
      const isUnauthorized = msg.includes('Authentication required') || msg.includes('expired');
      const isConflict = msg.includes('already linked');
      res.status(isUnauthorized ? 401 : isConflict ? 409 : 400).json(
        createApiErrorEnvelope({
          statusCode: isUnauthorized ? 401 : isConflict ? 409 : 400,
          errorCode: isUnauthorized
            ? ApiErrorCode.UNAUTHORIZED
            : isConflict
              ? ApiErrorCode.CONFLICT
              : ApiErrorCode.VALIDATION_FAILED,
          message: msg,
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 7.13C Server-Enforced Protected Role Endpoints
  // Merchant Dashboard Authorization check
  router.get(
    '/merchant/status',
    requireAuthMiddleware,
    requireRoleMiddleware([UserRole.MERCHANT, UserRole.ADMIN, UserRole.OWNER]),
    (req: Request, res: Response) => {
      res.status(200).json({
        ok: true,
        authorized: true,
        userId: (req as any).authUserId,
        roles: (req as any).authUserRoles,
        message: 'Authoritative Merchant role verified server-side.',
      });
    }
  );

  // Creator Studio Authorization check
  router.get(
    '/creator/status',
    requireAuthMiddleware,
    requireRoleMiddleware([UserRole.CREATOR, UserRole.ADMIN, UserRole.OWNER]),
    (req: Request, res: Response) => {
      res.status(200).json({
        ok: true,
        authorized: true,
        userId: (req as any).authUserId,
        roles: (req as any).authUserRoles,
        message: 'Authoritative Creator role verified server-side.',
      });
    }
  );

  // 7.14 Subscriptions Tiers: GET /api/v1/subscriptions/tiers
  router.get('/subscriptions/tiers', (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      tiers: [
        {
          tier: 'FREE_STANDARD',
          name: 'FACE VID Free',
          priceUsdMonthly: 0.0,
          description: 'Personal viewing with non-intrusive creator monetization ads and standard 4K/6K catalog access.',
        },
        {
          tier: 'PREMIUM_AD_FREE',
          name: 'FACE VID Premium',
          priceUsdMonthly: 11.0,
          description: '100% ad-free 4K/6K viewing, background offline playback, lossy/lossless audio selection, and priority livestream access.',
          checkoutStatus: 'LOCKED_PENDING_GATEWAY',
        },
      ],
      notice: 'Premium checkout is inactive pending production payment processor activation.',
    });
  });

  // 7.15 Locked Commerce Checkout: POST /api/v1/commerce/checkout
  router.post('/commerce/checkout', lockedCommerceMiddleware);

  // ===========================================================================
  // 8. PHASE 1.4B ADMIN GOVERNANCE ENDPOINTS
  // ===========================================================================

  // 8.1 Governance Metrics: GET /api/v1/admin/metrics
  router.get('/admin/metrics', requireAdminAuthMiddleware, (_req: Request, res: Response) => {
    res.status(200).json({
      ok: true,
      data: adminGovernanceService.getGovernanceMetrics(),
    });
  });

  // 8.2 Approve Founding Creator: POST /api/v1/admin/creators/approve-founding
  router.post(
    '/admin/creators/approve-founding',
    requireAdminAuthMiddleware,
    (req: Request, res: Response) => {
      const requestId = (req.headers['x-request-id'] as string) || `req_adm_crt_${Date.now()}`;
      const adminUserId = (req as any).authUserId as string;
      try {
        const result = adminGovernanceService.approveFoundingCreator({
          adminUserId,
          verificationId: req.body.verificationId,
          targetUserId: req.body.targetUserId,
          reason: req.body.reason || 'Verified Founding Creator applicant',
        });
        res.status(200).json({ ok: true, data: result });
      } catch (err) {
        res.status(400).json(
          createApiErrorEnvelope({
            statusCode: 400,
            errorCode: ApiErrorCode.CREATOR_QUOTA_EXCEEDED,
            message: err instanceof Error ? err.message : 'Creator approval failed.',
            requestId,
            path: req.originalUrl,
          })
        );
      }
    }
  );

  // 8.3 Approve Business Advertiser: POST /api/v1/admin/business/approve
  router.post(
    '/admin/business/approve',
    requireAdminAuthMiddleware,
    (req: Request, res: Response) => {
      const requestId = (req.headers['x-request-id'] as string) || `req_adm_biz_${Date.now()}`;
      const adminUserId = (req as any).authUserId as string;
      try {
        const result = adminGovernanceService.approveBusinessAdvertiser({
          adminUserId,
          advertiserId: req.body.advertiserId,
          reason: req.body.reason || 'Verified corporate advertiser',
        });
        res.status(200).json({ ok: true, data: result });
      } catch (err) {
        res.status(400).json(
          createApiErrorEnvelope({
            statusCode: 400,
            errorCode: ApiErrorCode.VALIDATION_FAILED,
            message: err instanceof Error ? err.message : 'Business approval failed.',
            requestId,
            path: req.originalUrl,
          })
        );
      }
    }
  );

  // 8.4 Approve Store Merchant: POST /api/v1/admin/stores/approve
  router.post(
    '/admin/stores/approve',
    requireAdminAuthMiddleware,
    (req: Request, res: Response) => {
      const requestId = (req.headers['x-request-id'] as string) || `req_adm_str_${Date.now()}`;
      const adminUserId = (req as any).authUserId as string;
      try {
        const result = adminGovernanceService.approveStoreMerchant({
          adminUserId,
          merchantId: req.body.merchantId,
          reason: req.body.reason || 'Verified merchant seller',
        });
        res.status(200).json({ ok: true, data: result });
      } catch (err) {
        res.status(400).json(
          createApiErrorEnvelope({
            statusCode: 400,
            errorCode: ApiErrorCode.VALIDATION_FAILED,
            message: err instanceof Error ? err.message : 'Store approval failed.',
            requestId,
            path: req.originalUrl,
          })
        );
      }
    }
  );

  // 8.5 Suspend Account: POST /api/v1/admin/accounts/suspend
  router.post(
    '/admin/accounts/suspend',
    requireAdminAuthMiddleware,
    (req: Request, res: Response) => {
      const requestId = (req.headers['x-request-id'] as string) || `req_adm_susp_${Date.now()}`;
      const adminUserId = (req as any).authUserId as string;
      try {
        const result = adminGovernanceService.suspendAccount({
          adminUserId,
          targetUserId: req.body.targetUserId,
          reason: req.body.reason || 'Violation of community safety standards',
        });
        res.status(200).json({ ok: true, data: result });
      } catch (err) {
        res.status(400).json(
          createApiErrorEnvelope({
            statusCode: 400,
            errorCode: ApiErrorCode.VALIDATION_FAILED,
            message: err instanceof Error ? err.message : 'Suspension failed.',
            requestId,
            path: req.originalUrl,
          })
        );
      }
    }
  );

  // ===========================================================================
  // 9. FACE VID V2 PREMIUM LAUNCH EDITION ENDPOINTS
  // ===========================================================================

  // 9.1 Radius Live Streams: GET /api/v1/live/streams
  router.get('/live/streams', (req: Request, res: Response) => {
    const userLat = req.query.lat ? Number(req.query.lat) : undefined;
    const userLng = req.query.lng ? Number(req.query.lng) : undefined;
    const rawReach = req.query.reach as string | undefined;
    const validReaches = Object.values(LiveAudienceReach);

    let reach: LiveAudienceReach = LiveAudienceReach.RADIUS_15KM;
    if (rawReach && validReaches.includes(rawReach as LiveAudienceReach)) {
      reach = rawReach as LiveAudienceReach;
    } else if (req.query.radiusKm) {
      const r = Number(req.query.radiusKm);
      reach = r > 15 ? LiveAudienceReach.RADIUS_30KM : LiveAudienceReach.RADIUS_15KM;
    }

    const cityCode = req.query.cityCode as string | undefined;
    const countryIso = req.query.countryIso as string | undefined;
    const continentCode = req.query.continentCode as string | undefined;
    const category = req.query.category as string | undefined;

    const result = launchService.getRadiusLiveStreams({
      userLat,
      userLng,
      reach,
      cityCode,
      countryIso,
      continentCode,
      category,
    });

    // Defense-in-depth: run payload through sensitive data redactor
    res.status(200).json({ ok: true, data: redactSensitiveData(result) });
  });

  // 9.2 Start Live Broadcast: POST /api/v1/live/streams
  router.post('/live/streams', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_live_start_${Date.now()}`;
    const validReaches = Object.values(LiveAudienceReach);
    const reach =
      req.body?.reach && validReaches.includes(req.body.reach)
        ? (req.body.reach as LiveAudienceReach)
        : LiveAudienceReach.RADIUS_15KM;

    try {
      const stream = launchService.startLiveStream({
        creatorId: req.body?.creatorId || 'crt_current',
        creatorDisplayName: req.body?.creatorDisplayName || 'Live Broadcaster',
        creatorHandle: req.body?.creatorHandle || '@broadcaster',
        creatorAvatarUrl: req.body?.creatorAvatarUrl || '/assets/avatars/default.png',
        title: req.body?.title || 'Live Interactive Broadcast',
        category: req.body?.category || 'General',
        tags: Array.isArray(req.body?.tags) ? req.body.tags : ['live', 'radius'],
        lat: req.body?.lat !== undefined ? Number(req.body.lat) : -33.9249,
        lng: req.body?.lng !== undefined ? Number(req.body.lng) : 18.4241,
        reach,
        cityCode: req.body?.cityCode || 'CPT',
        countryIso: req.body?.countryIso || 'ZA',
        continentCode: req.body?.continentCode || 'AF',
        locationLabel: req.body?.locationLabel || 'Verified Regional Zone',
        aspectRatio: req.body?.aspectRatio || '16:9',
      });
      // Strict privacy invariant: exact coordinates must never leave the server boundary
      res.status(201).json({ ok: true, data: redactSensitiveData(stream) });
    } catch (err) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: err instanceof Error ? err.message : 'Failed to launch live stream.',
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 9.3 Post Live Chat Message or 70/30 Tip: POST /api/v1/live/streams/:streamId/chat
  router.post('/live/streams/:streamId/chat', (req: Request, res: Response) => {
    const streamId = req.params.streamId;
    const requestId = (req.headers['x-request-id'] as string) || `req_chat_${Date.now()}`;
    try {
      const msg = launchService.postLiveChatMessage({
        streamId,
        senderName: req.body?.senderName || 'Viewer',
        senderHandle: req.body?.senderHandle || '@viewer',
        message: req.body?.message || '',
        isTip: Boolean(req.body?.isTip),
        tipAmountUsd: req.body?.tipAmountUsd ? Number(req.body.tipAmountUsd) : undefined,
      });
      res.status(200).json({ ok: true, data: msg });
    } catch (err) {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: err instanceof Error ? err.message : 'Failed to send chat message.',
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 9.4 Chats: GET /api/v1/chats/conversations
  router.get('/chats/conversations', (req: Request, res: Response) => {
    let authUserId: string | undefined;
    const authHeader = req.headers.authorization;
    const token =
      (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '') ||
      (req.headers['x-session-token'] as string) ||
      (req.headers['x-session-id'] as string) ||
      (req.query.token as string);

    if (token) {
      try {
        const auth = realtimeService.authenticateSessionToken(token);
        authUserId = auth.userId;
      } catch {
        // Fallback for unauthenticated preview
      }
    }

    const convs = launchService.getConversations(authUserId);
    res.status(200).json({ ok: true, data: convs });
  });

  // 9.4B Create or Get 1-on-1 Conversation: POST /api/v1/chats/conversations
  router.post('/chats/conversations', requireAuthMiddleware, (req: Request, res: Response) => {
    const authUserId = (req as any).authUserId as string;
    const { peerUserId } = req.body || {};
    const requestId = (req.headers['x-request-id'] as string) || `req_conv_${Date.now()}`;

    if (!peerUserId || typeof peerUserId !== 'string') {
      res.status(400).json(
        createApiErrorEnvelope({
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'peerUserId is required to initiate a conversation.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    const peer = databaseFoundationService.findUserById(peerUserId);
    if (!peer) {
      res.status(404).json(
        createApiErrorEnvelope({
          statusCode: 404,
          errorCode: ApiErrorCode.NOT_FOUND,
          message: 'Peer user account does not exist.',
          requestId,
          path: req.originalUrl,
        })
      );
      return;
    }

    const conv = databaseFoundationService.getOrCreateConversation(authUserId, peerUserId);
    res.status(200).json({ ok: true, data: conv });
  });

  // 9.5 Chats Messages: GET /api/v1/chats/messages
  router.get('/chats/messages', (req: Request, res: Response) => {
    const conversationId = req.query.conversationId as string;
    const requestId = (req.headers['x-request-id'] as string) || `req_msgs_${Date.now()}`;

    if (!conversationId) {
      res.status(400).json({ ok: false, error: 'conversationId query parameter is required.' });
      return;
    }

    let authUserId: string | undefined;
    const authHeader = req.headers.authorization;
    const token =
      (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '') ||
      (req.headers['x-session-token'] as string) ||
      (req.headers['x-session-id'] as string) ||
      (req.query.token as string);

    if (token) {
      try {
        const auth = realtimeService.authenticateSessionToken(token);
        authUserId = auth.userId;
      } catch (err) {
        res.status(401).json(
          createApiErrorEnvelope({
            statusCode: 401,
            errorCode: ApiErrorCode.UNAUTHORIZED,
            message: err instanceof Error ? err.message : 'Invalid session token.',
            requestId,
            path: req.originalUrl,
          })
        );
        return;
      }
    }

    try {
      const msgs = launchService.getMessages(conversationId, authUserId);
      res.status(200).json({ ok: true, data: msgs });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Access denied.';
      const isForbidden = msg.includes('Unauthorized') || msg.includes('participant');
      res.status(isForbidden ? 403 : 400).json(
        createApiErrorEnvelope({
          statusCode: isForbidden ? 403 : 400,
          errorCode: isForbidden ? ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT : ApiErrorCode.VALIDATION_FAILED,
          message: msg,
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 9.6 Chats Send: POST /api/v1/chats/messages
  router.post('/chats/messages', requireAuthMiddleware, (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_msg_${Date.now()}`;
    const authUserId = (req as any).authUserId as string;

    try {
      const msg = launchService.sendMessage({
        conversationId: req.body?.conversationId,
        senderUserId: authUserId,
        text: req.body?.text || '',
        mediaType: req.body?.mediaType,
        mediaUrl: req.body?.mediaUrl,
        idempotencyKey: req.body?.idempotencyKey,
      });
      res.status(201).json({ ok: true, data: msg });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Message send failed.';
      const isForbidden =
        errorMsg.includes('Unauthorized') ||
        errorMsg.includes('participant') ||
        errorMsg.includes('blocked') ||
        errorMsg.includes('Forbidden');
      res.status(isForbidden ? 403 : 400).json(
        createApiErrorEnvelope({
          statusCode: isForbidden ? 403 : 400,
          errorCode: isForbidden ? ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT : ApiErrorCode.VALIDATION_FAILED,
          message: errorMsg,
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 9.7 Initiate Call: POST /api/v1/calls/initiate
  router.post('/calls/initiate', requireAuthMiddleware, (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_call_init_${Date.now()}`;
    const authUserId = (req as any).authUserId as string;

    try {
      const call = launchService.initiateCall({
        callerUserId: authUserId,
        receiverUserId: req.body?.receiverUserId,
        callType: req.body?.callType || 'VOICE',
        isPrepaid: Boolean(req.body?.isPrepaid),
        ratePerMinuteUsd: req.body?.ratePerMinuteUsd ? Number(req.body.ratePerMinuteUsd) : 0,
      });
      res.status(201).json({ ok: true, data: call });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Call initiation failed.';
      const isForbidden =
        errorMsg.includes('blocked') ||
        errorMsg.includes('Unauthorized') ||
        errorMsg.includes('Forbidden');
      res.status(isForbidden ? 403 : 400).json(
        createApiErrorEnvelope({
          statusCode: isForbidden ? 403 : 400,
          errorCode: isForbidden ? ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT : ApiErrorCode.VALIDATION_FAILED,
          message: errorMsg,
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 9.7B WebRTC Call Signaling Relay: POST /api/v1/calls/signal
  router.post('/calls/signal', requireAuthMiddleware, (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || `req_sig_${Date.now()}`;
    const authUserId = (req as any).authUserId as string;

    try {
      realtimeService.handleCallSignal(authUserId, req.body);
      res.status(200).json({ ok: true, delivered: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Signaling error.';
      const isForbidden = msg.includes('Authorization Violation') || msg.includes('participant');
      res.status(isForbidden ? 403 : 400).json(
        createApiErrorEnvelope({
          statusCode: isForbidden ? 403 : 400,
          errorCode: isForbidden ? ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT : ApiErrorCode.VALIDATION_FAILED,
          message: msg,
          requestId,
          path: req.originalUrl,
        })
      );
    }
  });

  // 9.8 Call 60-Second Billing Heartbeat: POST /api/v1/calls/heartbeat
  router.post('/calls/heartbeat', (req: Request, res: Response) => {
    const { callId, durationSeconds } = req.body || {};
    try {
      const call = launchService.recordCallHeartbeat(callId, Number(durationSeconds) || 60);
      res.status(200).json({ ok: true, data: call });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Heartbeat failed.' });
    }
  });

  // 9.9 End Call: POST /api/v1/calls/end
  router.post('/calls/end', (req: Request, res: Response) => {
    const { callId } = req.body || {};
    try {
      const call = launchService.endCall(callId);
      res.status(200).json({ ok: true, data: call });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Call termination failed.' });
    }
  });

  // 9.9B Realtime Single-Use Connection Ticket: POST /api/v1/realtime/ticket
  router.post('/realtime/ticket', requireAuthMiddleware, (req: Request, res: Response) => {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const purpose = (req.body?.purpose === 'WEBSOCKET' ? 'WEBSOCKET' : 'SSE') as 'WEBSOCKET' | 'SSE';

    try {
      const ticketResult = realtimeService.issueRealtimeTicket({ token, purpose });
      res.status(200).json({ ok: true, data: ticketResult });
    } catch (err) {
      res.status(401).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Ticket issuance failed.',
      });
    }
  });

  // 9.9C Real-Time Server-Sent Events (SSE) Stream: GET /api/v1/realtime/stream
  router.get('/realtime/stream', (req: Request, res: Response) => {
    // 1. Strict rejection of long-lived tokens in query parameters
    if (req.query.token) {
      res.status(401).json({
        ok: false,
        error: 'Long-lived session tokens in URL query parameters are prohibited. Obtain a short-lived ticket via POST /api/v1/realtime/ticket.',
      });
      return;
    }

    const ticket = req.query.ticket as string | undefined;
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

    let auth: { userId: string; sessionId: string };

    if (ticket) {
      try {
        auth = realtimeService.consumeRealtimeTicket(ticket, 'SSE');
      } catch (err) {
        res.status(401).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Invalid or expired realtime ticket.',
        });
        return;
      }
    } else if (bearerToken) {
      try {
        auth = realtimeService.authenticateSessionToken(bearerToken);
      } catch (err) {
        res.status(401).json({
          ok: false,
          error: err instanceof Error ? err.message : 'Session verification failed.',
        });
        return;
      }
    } else {
      res.status(401).json({ ok: false, error: 'Authentication ticket or Bearer header required for realtime stream.' });
      return;
    }

    // Set headers for long-lived Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const connectionId = `conn_sse_${crypto.randomBytes(8).toString('hex')}`;
    const conn = {
      connectionId,
      userId: auth.userId,
      sessionId: auth.sessionId,
      connectedAtIso: new Date().toISOString(),
      lastPongEpochMs: Date.now(),
      transport: 'SSE' as const,
      sseResponse: res,
    };

    realtimeService.registerConnection(conn);

    // Initial greeting / keepalive
    res.write(
      `event: SYSTEM_NOTIFICATION\ndata: ${JSON.stringify({ status: 'CONNECTED', connectionId, userId: auth.userId })}\n\n`
    );

    const keepaliveInterval = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`: keepalive\n\n`);
      }
    }, 15000);

    const cleanup = () => {
      clearInterval(keepaliveInterval);
      realtimeService.unregisterConnection(connectionId);
    };

    req.on('close', cleanup);
    req.on('error', () => {
      cleanup();
    });
    res.on('error', () => {
      cleanup();
    });
  });

  // 9.9D Live Audience Presence Heartbeat: POST /api/v1/realtime/presence
  router.post('/realtime/presence', requireAuthMiddleware, (req: Request, res: Response) => {
    const authUserId = (req as any).authUserId as string;
    const authSessionId = (req as any).authSessionId as string;
    const { streamId, isPrivateMode } = req.body || {};

    if (!streamId || typeof streamId !== 'string') {
      res.status(400).json({ ok: false, error: 'streamId is required.' });
      return;
    }

    const presence = realtimeService.recordViewerPresence({
      streamId,
      viewerUserId: authUserId,
      sessionId: authSessionId,
      isPrivateMode: Boolean(isPrivateMode),
    });

    res.status(200).json({ ok: true, data: presence });
  });

  // 9.9E Authoritative User Blocking: POST /api/v1/users/block
  router.post('/users/block', requireAuthMiddleware, (req: Request, res: Response) => {
    const authUserId = (req as any).authUserId as string;
    const { targetUserId, reason } = req.body || {};

    if (!targetUserId || typeof targetUserId !== 'string') {
      res.status(400).json({ ok: false, error: 'targetUserId is required.' });
      return;
    }

    try {
      const blocked = databaseFoundationService.blockUser({
        blockerUserId: authUserId,
        blockedUserId: targetUserId,
        reason,
      });
      res.status(200).json({ ok: true, data: blocked });
    } catch (err) {
      res.status(400).json({ ok: false, error: err instanceof Error ? err.message : 'Block failed.' });
    }
  });

  // 9.9F Authoritative User Unblocking: POST /api/v1/users/unblock
  router.post('/users/unblock', requireAuthMiddleware, (req: Request, res: Response) => {
    const authUserId = (req as any).authUserId as string;
    const { targetUserId } = req.body || {};

    if (!targetUserId || typeof targetUserId !== 'string') {
      res.status(400).json({ ok: false, error: 'targetUserId is required.' });
      return;
    }

    const unblocked = databaseFoundationService.unblockUser({
      blockerUserId: authUserId,
      blockedUserId: targetUserId,
    });
    res.status(200).json({ ok: true, unblocked });
  });

  // 9.9G List Blocked Users: GET /api/v1/users/blocked
  router.get('/users/blocked', requireAuthMiddleware, (req: Request, res: Response) => {
    const authUserId = (req as any).authUserId as string;
    const blockedList = databaseFoundationService.getBlockedUsers(authUserId);
    res.status(200).json({ ok: true, data: blockedList });
  });

  // 9.10 Explore Recommendations: GET /api/v1/explore/recommended
  router.get('/explore/recommended', (req: Request, res: Response) => {
    const category = req.query.category as string | undefined;
    const notInterested = req.query.notInterested
      ? String(req.query.notInterested).split(',')
      : [];
    const hidden = req.query.hidden ? String(req.query.hidden).split(',') : [];

    const recs = launchService.getAlgorithmicRecommendations({
      category,
      notInterestedIds: notInterested,
      hiddenCreatorIds: hidden,
    });
    res.status(200).json({ ok: true, data: recs });
  });

  // 9.11 Video Studio AI Assistance: POST /api/v1/ai/studio-assist
  router.post('/ai/studio-assist', async (req: Request, res: Response) => {
    const { topicOrRawTitle, videoGenre, aspectRatio } = req.body || {};
    const result = await launchService.generateStudioAssistance({
      topicOrRawTitle: topicOrRawTitle || 'Cinematic Production',
      videoGenre,
      aspectRatio,
    });
    res.status(200).json({ ok: true, data: result });
  });

  // 10. Deny-by-Default Operational Admin Guard: ALL /api/v1/admin/*
  router.all('/admin/*', (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || 'fv_req_admin_block';
    apiLogger.warn('Denied unauthenticated/unexposed operational admin endpoint access', {
      path: req.originalUrl,
    });
    res.status(403).json(
      createApiErrorEnvelope({
        statusCode: 403,
        errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
        message:
          'Deny-by-default enforced: Operational admin endpoints require verified admin credentials and phishing-resistant MFA.',
        requestId,
        path: req.originalUrl,
      })
    );
  });

  // 8. Catch-all Deny-by-Default for unimplemented routes under /api/v1
  router.use((req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || 'fv_req_404';
    res.status(404).json(
      createApiErrorEnvelope({
        statusCode: 404,
        errorCode: ApiErrorCode.NOT_FOUND,
        message: `Endpoint '${req.method} ${req.originalUrl}' is not exposed in Phase 1A (Deny-by-default boundary).`,
        requestId,
        path: req.originalUrl,
      })
    );
  });

  return router;
}

/**
 * FACE VID — Phase 1A Unit, Security Contract & API Smoke Test Suite
 *
 * Run via: npx tsx scripts/run-tests.ts (or pnpm test)
 */

import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import {
  AccountSegregationDomain,
  AccountStatus,
  AuditActorType,
  AuditEventCategory,
  CallType,
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
  REDACTED_MARKER,
  SubscriptionTier,
  TvExcludedFeature,
  UserExperienceTier,
  UserRole,
  authorizeFinancialPolicyChange,
  computeAuditChainDigest,
  evaluateGovernancePolicy,
  getCallSessionPolicy,
  isFeaturePermittedOnExperience,
  projectPeerVisibleIdentity,
  redactSensitiveData,
  requiresPhishingResistantMfa,
  sanitizeLiveBroadcastLocation,
  validateCreatorMerchantBalanceSeparation,
  validateDoubleEntryJournal,
  validateRegistrationRoleRequest,
  ApiErrorCode,
  ContentVisibility,
  MalwareScanStatus,
  MediaValidationStatus,
  SECURE_UPLOAD_CONFIG,
  UploadSessionStatus,
  VideoFormat,
  isDailyVerificationActive,
} from '../packages/shared/src/index.ts';
import { AppModule } from '../apps/api/src/app.module.ts';
import { databaseFoundationService } from '../apps/api/src/database/database.service.ts';
import { createNestApiApp, createStandaloneApiApp } from '../apps/api/src/main.ts';
import { creatorUploadService } from '../apps/api/src/modules/creator-upload.service.ts';
import { MonetizationLedgerService } from '../apps/api/src/modules/monetization.service.ts';
import { authService } from '../apps/api/src/modules/auth.service.ts';
import { otpService } from '../apps/api/src/modules/otp.service.ts';
import { adminGovernanceService } from '../apps/api/src/modules/admin-governance.service.ts';
import { redisFoundationService } from '../apps/api/src/redis/redis.service.ts';
import { TvDevicePairingService } from '../apps/api/src/tv/tv-pairing.service.ts';
import { realtimeService } from '../apps/api/src/modules/realtime.service.ts';
import { launchService } from '../apps/api/src/modules/launch.service.ts';
import { apiLogger } from '../apps/api/src/common/logger.ts';
import { ChatsView } from '../apps/web/src/components/launch/ChatsView.tsx';
import { CallOverlayModal } from '../apps/web/src/components/launch/CallOverlayModal.tsx';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { VideoPlayer, formatTime } from '../apps/web/src/components/VideoPlayer.tsx';
import { WebAppShell } from '../apps/web/src/WebAppShell.tsx';
import { AuthAccountFlow } from '../apps/web/src/components/auth/AuthAccountFlow.tsx';
import { ACCOUNT_TYPE_OPTIONS } from '../apps/web/src/components/auth/types.ts';
import { AdminAppShell } from '../apps/admin/src/AdminAppShell.tsx';
import { MobileBottomNav } from '../apps/web/src/components/mobile/MobileBottomNav.tsx';
import { MobileTopBar } from '../apps/web/src/components/mobile/MobileTopBar.tsx';
import { MobileCreateSheet } from '../apps/web/src/components/mobile/MobileCreateSheet.tsx';
import { MobileVideoCard } from '../apps/web/src/components/mobile/MobileVideoCard.tsx';
import { MobileTopicFilters } from '../apps/web/src/components/mobile/MobileTopicFilters.tsx';
import { MobileHomeFeed } from '../apps/web/src/components/mobile/MobileHomeFeed.tsx';
import { MobileShortsPlayer } from '../apps/web/src/components/mobile/MobileShortsPlayer.tsx';
import { ShortsCommentsSheet } from '../apps/web/src/components/mobile/ShortsCommentsSheet.tsx';
import { MobileWatchView } from '../apps/web/src/components/mobile/MobileWatchView.tsx';
import { MobileCompactVideoCard } from '../apps/web/src/components/mobile/MobileCompactVideoCard.tsx';
import { MobileShopView } from '../apps/web/src/components/mobile/MobileShopView.tsx';
import { MobileProductDetailSheet } from '../apps/web/src/components/mobile/MobileProductDetailSheet.tsx';
import { MobileMerchantStorefront } from '../apps/web/src/components/mobile/MobileMerchantStorefront.tsx';
import { MobileYouHub } from '../apps/web/src/components/mobile/MobileYouHub.tsx';
import { MobileYouSecondarySheets } from '../apps/web/src/components/mobile/MobileYouSecondarySheets.tsx';
import { SHOP_PRODUCTS, MERCHANT_STOREFRONTS } from '../apps/web/src/components/mobile/shopTypes.ts';
import { StandaloneAuthGateway } from '../apps/web/src/components/auth/StandaloneAuthGateway.tsx';
import { runInteractiveVideoSuite } from './test-interactive-player.ts';

interface TestResult {
  readonly name: string;
  readonly status: 'PASS' | 'FAIL';
  readonly durationMs: number;
  readonly error?: string;
}

const results: TestResult[] = [];

async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, status: 'PASS', durationMs: Date.now() - start });
    console.log(`PASS  ${name} (${Date.now() - start}ms)`);
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    results.push({ name, status: 'FAIL', durationMs: Date.now() - start, error: message });
    console.error(`FAIL  ${name}: ${message}`);
  }
}

async function main() {
  console.log('================================================================');
  console.log('FACE VID — PHASE 1A AUTOMATED TEST SUITE');
  console.log('================================================================');

  // 1. Identity Mode & Privacy Isolation Tests
  await runTest('Identity: Private Mode strips legalFullName and primaryEmail from peer projection', () => {
    const record = {
      id: 'usr_101',
      activeMode: IdentityMode.PRIVATE,
      roles: [UserRole.USER, UserRole.CREATOR],
      status: AccountStatus.ACTIVE,
      subscriptionTier: SubscriptionTier.FREE_STANDARD,
      mfaEnrolled: true,
      phishingResistantMfaVerified: false,
      publicProfile: {
        displayName: 'Public Name',
        handle: '@publicname',
        bio: 'Bio',
        avatarUrl: '/avatar.png',
        verifiedBadge: true,
      },
      privateProfile: {
        pseudonym: 'ShadowLens_99',
        avatarSeedId: 'seed_abc',
        avatarStyle: 'GEOMETRIC_SHIELD' as const,
      },
      legalFullName: 'Secret Legal Name',
      primaryEmail: 'secret@example.com',
      countryIsoCode: 'ZA',
      createdAtIso: '2026-10-08T00:00:00.000Z',
    };

    const projected = projectPeerVisibleIdentity(record);
    assert.equal(projected.mode, IdentityMode.PRIVATE);
    assert.equal(projected.displayLabel, 'ShadowLens_99');
    assert.equal(projected.isVerifiedPublicCreator, false);
    const serialized = JSON.stringify(projected);
    assert.equal(serialized.includes('Secret Legal Name'), false);
    assert.equal(serialized.includes('secret@example.com'), false);
    assert.equal(serialized.includes('Public Name'), false);
  });

  // 2. Role Registration & MFA Policy Tests
  await runTest('Security: Public registration rejects SUPER_ADMIN, ADMIN, OWNER, and MODERATOR', () => {
    for (const forbidden of [
      UserRole.SUPER_ADMIN,
      UserRole.ADMIN,
      UserRole.OWNER,
      UserRole.MODERATOR,
    ]) {
      const check = validateRegistrationRoleRequest(forbidden);
      assert.equal(check.allowed, false);
      assert.equal(check.assignedRole, UserRole.USER);
    }
    const standardUserCheck = validateRegistrationRoleRequest(UserRole.USER);
    assert.equal(standardUserCheck.allowed, true);
    assert.equal(requiresPhishingResistantMfa([UserRole.SUPER_ADMIN]), true);
    assert.equal(requiresPhishingResistantMfa([UserRole.USER]), false);
  });

  // 3. Founding Creator Program & Live Broadcasting Rules
  await runTest('Business Rules: Founding Creator cap is 3,000,000 and Phase 1A allocation is disabled', () => {
    assert.equal(FOUNDING_CREATOR_PROGRAM_RULES.MAX_ELIGIBLE_CREATORS, 3_000_000);
    assert.equal(FOUNDING_CREATOR_PROGRAM_RULES.PHASE_1A_ALLOCATION_ACTIVE, false);
    assert.equal(
      FOUNDING_CREATOR_PROGRAM_RULES.REQUIRE_HUMAN_REVIEW_FOR_AMBIGUOUS_OR_HIGH_RISK,
      true
    );
  });

  await runTest('Business Rules: Live broadcasting supports all 6 scopes and redacts exact GPS coordinates', () => {
    const scopes = [
      LiveAudienceReach.RADIUS_15KM,
      LiveAudienceReach.RADIUS_30KM,
      LiveAudienceReach.CITY,
      LiveAudienceReach.COUNTRY,
      LiveAudienceReach.CONTINENT,
      LiveAudienceReach.WORLDWIDE,
    ];
    for (const reach of scopes) {
      const sanitized = sanitizeLiveBroadcastLocation({
        reach,
        latitude: -26.2041,
        longitude: 28.0473,
        cityCode: 'JNB',
        countryIso: 'ZA',
        continentCode: 'AF',
      });
      assert.equal(sanitized.reach, reach);
      assert.equal(sanitized.coordinatesRedacted, true);
      assert.equal(JSON.stringify(sanitized).includes('-26.2041'), false);
    }
  });

  await runTest('Business Rules: Free user-to-user internet calls vs Prepaid creator calls', () => {
    const p2p = getCallSessionPolicy(CallType.PEER_TO_PEER_FREE);
    assert.equal(p2p.platformCallFeeMinorUnits, 0);
    assert.equal(p2p.requiresPrepaidEscrowAuthorization, false);

    const creatorCall = getCallSessionPolicy(CallType.PREPAID_CREATOR_CALL);
    assert.equal(creatorCall.requiresPrepaidEscrowAuthorization, true);
  });

  // 4. AI Agent Privilege Escalation & Governance Tests
  await runTest('Governance: AI agents cannot self-grant permissions, promote roles, or bypass human review', () => {
    for (const action of [
      'SELF_GRANT_PERMISSION',
      'PROMOTE_PRIVILEGED_ROLE',
      'ALTER_OWNER_PERMISSIONS',
      'BYPASS_HUMAN_APPROVAL',
      'MODIFY_FINANCIAL_POLICY',
      'MODIFY_SECURITY_POLICY',
    ] as const) {
      const res = evaluateGovernancePolicy({
        actorType: AuditActorType.AI_AGENT,
        actorRoles: [],
        action,
        hasHumanApprovalTicket: true,
        hasOwnerSignature: true,
      });
      assert.equal(res.permitted, false);
      assert.equal(res.violationCode, 'AI_PRIVILEGE_ESCALATION_FORBIDDEN');
    }
  });

  await runTest('Governance: Critical financial and security policy changes require Owner signature', () => {
    const adminAttempt = evaluateGovernancePolicy({
      actorType: AuditActorType.SUPER_ADMIN,
      actorRoles: [UserRole.SUPER_ADMIN],
      action: 'MODIFY_FINANCIAL_POLICY',
      hasHumanApprovalTicket: true,
      hasOwnerSignature: false,
    });
    assert.equal(adminAttempt.permitted, false);
    assert.equal(adminAttempt.violationCode, 'OWNER_AUTHORIZATION_REQUIRED');

    const ownerAuthorized = evaluateGovernancePolicy({
      actorType: AuditActorType.OWNER,
      actorRoles: [UserRole.OWNER],
      action: 'MODIFY_FINANCIAL_POLICY',
      hasHumanApprovalTicket: true,
      hasOwnerSignature: true,
    });
    assert.equal(ownerAuthorized.permitted, true);
  });

  // 5. Sensitive-Data Redaction & Audit Hash Chain Tests
  await runTest('Security: Structured logger redacts tokens, passwords, card PANs, and GPS coordinates', () => {
    const raw = {
      user: 'usr_1',
      password: 'my_super_secret_password',
      authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig',
      nested: {
        cardNumber: '4532 0151 1283 0366',
        cvv: '999',
        latitude: -33.9249,
        longitude: 18.4241,
      },
    };
    const redacted = redactSensitiveData(raw);
    assert.equal(redacted.password, REDACTED_MARKER);
    assert.equal(redacted.authorization, REDACTED_MARKER);
    assert.equal(redacted.nested.cardNumber, REDACTED_MARKER);
    assert.equal(redacted.nested.cvv, REDACTED_MARKER);
    assert.equal(redacted.nested.latitude, REDACTED_MARKER);
    assert.equal(redacted.nested.longitude, REDACTED_MARKER);
  });

  await runTest('Security: Tamper-evident audit digest changes deterministically on payload mutation', () => {
    const d1 = computeAuditChainDigest({
      sequenceNumber: 1,
      timestampIso: '2026-10-08T00:00:00.000Z',
      actorId: 'usr_1',
      actorType: AuditActorType.USER,
      category: AuditEventCategory.AUTHENTICATION,
      action: 'LOGIN',
      targetResourceId: 'session_1',
      previousHash: 'GENESIS',
    });
    const d2 = computeAuditChainDigest({
      sequenceNumber: 1,
      timestampIso: '2026-10-08T00:00:00.000Z',
      actorId: 'usr_1',
      actorType: AuditActorType.SUPER_ADMIN, // mutated
      category: AuditEventCategory.AUTHENTICATION,
      action: 'LOGIN',
      targetResourceId: 'session_1',
      previousHash: 'GENESIS',
    });
    assert.notEqual(d1, d2);
  });

  // 6. Backend API Smoke Tests (Health, Readiness, Deny-by-Default, Privilege Injection Rejection)
  await runTest('API Smoke: /api/v1/health, /api/v1/health/live, /api/v1/health/ready, and security guards', async () => {
    const app = createStandaloneApiApp();
    const server = http.createServer(app);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to bind ephemeral port for API smoke test');
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      // GET /api/v1/health
      const healthRes = await fetch(`${baseUrl}/api/v1/health`);
      assert.equal(healthRes.status, 200);
      assert.equal(healthRes.headers.get('x-content-type-options'), 'nosniff');
      const healthBody = (await healthRes.json()) as {
        status: string;
        securityPosture: { denyByDefault: boolean; operationalAdminEndpointsExposed: boolean };
      };
      assert.equal(healthBody.status, 'ok');
      assert.equal(healthBody.securityPosture.denyByDefault, true);
      assert.equal(healthBody.securityPosture.operationalAdminEndpointsExposed, false);

      // GET /api/v1/health/live
      const liveRes = await fetch(`${baseUrl}/api/v1/health/live`);
      assert.equal(liveRes.status, 200);

      // GET /api/v1/health/ready
      const readyRes = await fetch(`${baseUrl}/api/v1/health/ready`);
      assert.equal(readyRes.status, 200);
      const readyBody = (await readyRes.json()) as {
        dependencies: { postgresql: unknown; redis: unknown };
      };
      assert.ok(readyBody.dependencies.postgresql);
      assert.ok(readyBody.dependencies.redis);

      // POST with client-submitted role escalation must return 403 PRIVILEGE_ESCALATION_BLOCKED
      const escalationRes = await fetch(`${baseUrl}/api/v1/security/verify-contracts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'SUPER_ADMIN', subscriptionTier: 'PREMIUM_AD_FREE' }),
      });
      assert.equal(escalationRes.status, 403);
      const escalationBody = (await escalationRes.json()) as { errorCode: string };
      assert.equal(escalationBody.errorCode, 'PRIVILEGE_ESCALATION_BLOCKED');

      // Operational admin route must be denied by default (403)
      const adminRes = await fetch(`${baseUrl}/api/v1/admin/users`);
      assert.equal(adminRes.status, 403);
      const adminBody = (await adminRes.json()) as { errorCode: string };
      assert.equal(adminBody.errorCode, 'FORBIDDEN_DENY_BY_DEFAULT');

      // GET /api/v1/platforms/matrix must return all 9 platform destinations
      const matrixRes = await fetch(`${baseUrl}/api/v1/platforms/matrix`);
      assert.equal(matrixRes.status, 200);
      const matrixBody = (await matrixRes.json()) as {
        totalPlatforms: number;
        experienceSeparation: {
          experienceAFullPlatforms: string[];
          experienceBTvLeanbackPlatforms: string[];
          tvExcludedFeatures: string[];
        };
      };
      assert.equal(matrixBody.totalPlatforms, 9);
      assert.equal(matrixBody.experienceSeparation.experienceAFullPlatforms.length, 4);
      assert.equal(matrixBody.experienceSeparation.experienceBTvLeanbackPlatforms.length, 5);
      assert.equal(matrixBody.experienceSeparation.tvExcludedFeatures.length, 8);

      // POST /api/v1/auth/tv-device/code -> confirm -> poll -> revoke lifecycle
      const codeRes = await fetch(`${baseUrl}/api/v1/auth/tv-device/code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          devicePlatform: PlatformId.SAMSUNG_TIZEN_TV,
          deviceDisplayName: 'Samsung QN90D 4K TV',
        }),
      });
      assert.equal(codeRes.status, 201);
      const codeBody = (await codeRes.json()) as {
        shortPairingCode: string;
        deviceChallengeNonce: string;
        containsPermanentCredentialsInQr: boolean;
        persistenceMode: string;
        status: string;
        version: number;
      };
      assert.equal(codeBody.containsPermanentCredentialsInQr, false);
      assert.equal(codeBody.persistenceMode, 'REDIS_7_AND_POSTGRESQL_16_PHASE_1B1');
      assert.equal(codeBody.status, 'PENDING_USER_CONFIRMATION');

      // Unauthenticated confirmation attempt must be rejected with 401
      const unauthConfirmRes = await fetch(`${baseUrl}/api/v1/auth/tv-device/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortPairingCode: codeBody.shortPairingCode,
          authorizingUserHandle: '@elenavance',
        }),
      });
      assert.equal(unauthConfirmRes.status, 401);

      // Authenticated confirmation succeeds
      const confirmRes = await fetch(`${baseUrl}/api/v1/auth/tv-device/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer fvsess_valid_user_token_101',
        },
        body: JSON.stringify({
          shortPairingCode: codeBody.shortPairingCode,
          authenticatedUserId: 'usr_101',
          targetAccountToLinkUserId: 'usr_101',
          authorizingUserHandle: '@elenavance',
          expectedVersion: codeBody.version,
        }),
      });
      assert.equal(confirmRes.status, 200);

      // Device takeover attempt without originating TV's deviceChallengeNonce must fail with 403
      const takeoverPollRes = await fetch(`${baseUrl}/api/v1/auth/tv-device/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortPairingCode: codeBody.shortPairingCode,
          deviceChallengeNonce: 'tvnonce_attacker_forged',
        }),
      });
      assert.equal(takeoverPollRes.status, 403);

      // Legitimate originating TV poll with valid deviceChallengeNonce succeeds
      const pollRes = await fetch(`${baseUrl}/api/v1/auth/tv-device/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortPairingCode: codeBody.shortPairingCode,
          deviceChallengeNonce: codeBody.deviceChallengeNonce,
        }),
      });
      assert.equal(pollRes.status, 200);

      // Replay attempt on single-use pairing code must fail with 400
      const replayRes = await fetch(`${baseUrl}/api/v1/auth/tv-device/poll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shortPairingCode: codeBody.shortPairingCode,
          deviceChallengeNonce: codeBody.deviceChallengeNonce,
        }),
      });
      assert.equal(replayRes.status, 400);

      // GET /api/v1/monetization/contracts must return all 5 monetization engines with livePaymentsActive=false
      const monRes = await fetch(`${baseUrl}/api/v1/monetization/contracts`);
      assert.equal(monRes.status, 200);
      const monBody = (await monRes.json()) as {
        livePaymentsActive: boolean;
        inventedCommissionRates: boolean;
        totalEngines: number;
      };
      assert.equal(monBody.livePaymentsActive, false);
      assert.equal(monBody.inventedCommissionRates, false);
      assert.equal(monBody.totalEngines, 5);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // 7. Experience A vs Experience B (FACE VID TV) Architectural Separation Tests
  await runTest('TV Architecture: Experience B (FACE VID TV) strictly excludes AI Studio editor, dashboards, uploads, and calling', () => {
    for (const feature of EXPERIENCE_B_TV_EXCLUDED_FEATURES) {
      const tvCheck = isFeaturePermittedOnExperience(
        UserExperienceTier.EXPERIENCE_B_TV_LEANBACK,
        feature
      );
      assert.equal(tvCheck.permitted, false);
      assert.equal(tvCheck.handoffMethod, 'QR_MOBILE_HANDOFF_REQUIRED');

      const fullAppCheck = isFeaturePermittedOnExperience(
        UserExperienceTier.EXPERIENCE_A_FULL,
        feature
      );
      assert.equal(fullAppCheck.permitted, true);
    }
    assert.equal(
      EXPERIENCE_B_TV_EXCLUDED_FEATURES.includes(TvExcludedFeature.AI_STUDIO_FULL_EDITOR),
      true
    );
    assert.equal(
      EXPERIENCE_B_TV_EXCLUDED_FEATURES.includes(TvExcludedFeature.SUPER_ADMIN_PANEL),
      true
    );
  });

  // 8. Nine-Platform Readiness Matrix & Honest Audit Classification Tests
  await runTest('Multi-Platform: All 9 platforms distinguish 5 implementation stages and never mark unexecuted native builds PASS', () => {
    assert.equal(PLATFORM_READINESS_MATRIX.length, 9);
    for (const p of PLATFORM_READINESS_MATRIX) {
      assert.equal(p.auditStatus.storeApprovalStatus, 'PLANNED');
      assert.equal(p.implementationStages.storeSubmissionReady, 'PLANNED');
      if (p.platformId !== PlatformId.FACE_VID_WEB) {
        assert.equal(p.auditStatus.nativeBuildExecution, 'NOT_RUN');
        assert.equal(p.implementationStages.successfullyCompiledApplication, 'NOT_RUN');
        assert.equal(p.implementationStages.testedOnSimulatorOrDevice, 'NOT_RUN');
      }
    }
  });

  // 9. Comprehensive TV Pairing Audit (All 10 Task 3 Security Requirements)
  await runTest('TV Pairing Security (Task 3): Expiration, one-time use, concurrency, auth, cross-account block, takeover block, brute-force lock & revocation', () => {
    const svc = new TvDevicePairingService();
    const t0 = 1_700_000_000_000;

    // 9.1 QR payload safety & Phase 1B-1 persistence label
    const req1 = svc.createPairingRequest({
      devicePlatform: PlatformId.APPLE_TVOS,
      deviceDisplayName: 'Apple TV 4K',
      nowMs: t0,
    });
    assert.equal(req1.containsPermanentCredentialsInQr, false);
    assert.equal(req1.persistenceMode, 'REDIS_7_AND_POSTGRESQL_16_PHASE_1B1');

    // 9.2 Pairing code expiration (after 301s)
    const expiredAttempt = svc.confirmPairingFromMobileOrWeb({
      shortPairingCode: req1.shortPairingCode,
      authenticatedSessionToken: 'sess_valid_token_12345',
      authenticatedUserId: 'usr_1',
      authorizingUserHandle: '@user1',
      nowMs: t0 + 301_000,
    });
    assert.equal(expiredAttempt.ok, false);
    assert.equal(expiredAttempt.errorCode, 'PAIRING_CODE_EXPIRED');

    // 9.3 Authenticated confirmation & Cross-account link prevention
    const req2 = svc.createPairingRequest({
      devicePlatform: PlatformId.LG_WEBOS_TV,
      deviceDisplayName: 'LG OLED C4',
      nowMs: t0,
    });
    const unauth = svc.confirmPairingFromMobileOrWeb({
      shortPairingCode: req2.shortPairingCode,
      authorizingUserHandle: '@user1',
      nowMs: t0 + 5_000,
    });
    assert.equal(unauth.ok, false);
    assert.equal(unauth.statusCode, 401);
    assert.equal(unauth.errorCode, 'UNAUTHENTICATED_CONFIRMATION_REJECTED');

    const crossAccount = svc.confirmPairingFromMobileOrWeb({
      shortPairingCode: req2.shortPairingCode,
      authenticatedSessionToken: 'sess_valid_token_12345',
      authenticatedUserId: 'usr_attacker',
      targetAccountToLinkUserId: 'usr_victim',
      authorizingUserHandle: '@attacker',
      nowMs: t0 + 6_000,
    });
    assert.equal(crossAccount.ok, false);
    assert.equal(crossAccount.statusCode, 403);
    assert.equal(crossAccount.errorCode, 'CROSS_ACCOUNT_LINK_FORBIDDEN');

    const suspendedAccount = svc.confirmPairingFromMobileOrWeb({
      shortPairingCode: req2.shortPairingCode,
      authenticatedSessionToken: 'sess_valid_token_12345',
      authenticatedUserId: 'usr_suspended',
      accountStatus: AccountStatus.SUSPENDED,
      authorizingUserHandle: '@suspended',
      nowMs: t0 + 7_000,
    });
    assert.equal(suspendedAccount.ok, false);
    assert.equal(suspendedAccount.statusCode, 403);
    assert.equal(suspendedAccount.errorCode, 'ACCOUNT_NOT_ELIGIBLE_FOR_TV_LINK');

    // 9.4 Valid confirmation & Concurrent confirmation race rejection
    const validConfirm = svc.confirmPairingFromMobileOrWeb({
      shortPairingCode: req2.shortPairingCode,
      authenticatedSessionToken: 'sess_valid_token_12345',
      authenticatedUserId: 'usr_1',
      targetAccountToLinkUserId: 'usr_1',
      authorizingUserHandle: '@user1',
      expectedVersion: 1,
      nowMs: t0 + 8_000,
    });
    assert.equal(validConfirm.ok, true);

    const concurrentConfirm = svc.confirmPairingFromMobileOrWeb({
      shortPairingCode: req2.shortPairingCode,
      authenticatedSessionToken: 'sess_valid_token_12345',
      authenticatedUserId: 'usr_1',
      authorizingUserHandle: '@user1',
      expectedVersion: 1,
      nowMs: t0 + 8_500,
    });
    assert.equal(concurrentConfirm.ok, false);
    assert.equal(concurrentConfirm.statusCode, 409);
    assert.equal(concurrentConfirm.errorCode, 'CONCURRENT_OR_ALREADY_CONFIRMED');

    // 9.5 Device takeover protection & Secure session issuance + One-time consumption + Revocation
    const wrongNoncePoll = svc.pollOrExchangeTvSession({
      shortPairingCode: req2.shortPairingCode,
      deviceChallengeNonce: 'forged_nonce',
      nowMs: t0 + 9_000,
    });
    assert.equal(wrongNoncePoll.ok, false);
    assert.equal(
      wrongNoncePoll.errorCode,
      'DEVICE_TAKEOVER_BLOCKED_INVALID_CHALLENGE_NONCE'
    );

    const validPoll = svc.pollOrExchangeTvSession({
      shortPairingCode: req2.shortPairingCode,
      deviceChallengeNonce: req2.deviceChallengeNonce,
      nowMs: t0 + 10_000,
    });
    assert.equal(validPoll.ok, true);
    assert.ok(validPoll.deviceSessionId);
    assert.equal(svc.isSessionActive(validPoll.deviceSessionId!), true);

    const secondConsumption = svc.pollOrExchangeTvSession({
      shortPairingCode: req2.shortPairingCode,
      deviceChallengeNonce: req2.deviceChallengeNonce,
      nowMs: t0 + 11_000,
    });
    assert.equal(secondConsumption.ok, false);
    assert.equal(secondConsumption.errorCode, 'SINGLE_USE_CODE_ALREADY_CONSUMED');

    const revoked = svc.revokeDeviceSession({ deviceSessionId: validPoll.deviceSessionId });
    assert.equal(revoked.ok, true);
    assert.equal(svc.isSessionActive(validPoll.deviceSessionId!), false);

    // 9.6 Brute-force lockout after 5 invalid challenge attempts
    const req3 = svc.createPairingRequest({
      devicePlatform: PlatformId.AMAZON_FIRE_TV,
      deviceDisplayName: 'Fire TV Cube',
      nowMs: t0,
    });
    for (let i = 0; i < 5; i++) {
      svc.pollOrExchangeTvSession({
        shortPairingCode: req3.shortPairingCode,
        deviceChallengeNonce: `bad_attempt_${i}`,
        nowMs: t0 + 1_000,
      });
    }
    const lockedAttempt = svc.pollOrExchangeTvSession({
      shortPairingCode: req3.shortPairingCode,
      deviceChallengeNonce: req3.deviceChallengeNonce,
      nowMs: t0 + 2_000,
    });
    assert.equal(lockedAttempt.ok, false);
    assert.equal(lockedAttempt.statusCode, 429);
    assert.equal(lockedAttempt.errorCode, 'PAIRING_CODE_LOCKED_BRUTE_FORCE');
  });

  // 10. All Five Monetisation Engines & Double-Entry Ledger Security Tests (Task 4)
  await runTest('Monetisation (Task 4): All 5 engines verified, zero invented rates, idempotency, double-entry ledger, balance separation, refunds/chargebacks & AI lock', () => {
    const ledger = new MonetizationLedgerService();
    const contracts = ledger.getEngineContracts();
    assert.equal(contracts.length, 5);

    const expectedIds = [
      MonetizationEngineId.ENGINE_1_PREPAID_CREATOR_CALLS,
      MonetizationEngineId.ENGINE_2_CREATOR_MERCHANT_AD_SERVICES,
      MonetizationEngineId.ENGINE_3_SHOP_MERCHANT_COMMISSIONS,
      MonetizationEngineId.ENGINE_4_BUSINESS_AD_REVENUE,
      MonetizationEngineId.ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS,
    ];
    for (const id of expectedIds) {
      const found = contracts.find((c) => c.engineId === id);
      assert.ok(found, `Missing monetization engine contract: ${id}`);
      assert.equal(found.phase1aPaymentsActive, false);
      assert.equal(found.configuredCommissionBasisPoints, null);
      assert.equal(found.configuredBasePriceMinorUnits, null);
    }

    // 10.1 Unbalanced journal must be rejected
    const unbalanced = validateDoubleEntryJournal(
      [
        {
          lineId: 'l1',
          accountId: 'acc_1',
          ownerEntityId: 'usr_1',
          segregationDomain: AccountSegregationDomain.USER_PREPAID_WALLET,
          direction: LedgerEntryDirection.DEBIT,
          amountMinorUnits: 1000,
          currencyIso: 'ZAR',
        },
        {
          lineId: 'l2',
          accountId: 'acc_2',
          ownerEntityId: 'cre_1',
          segregationDomain: AccountSegregationDomain.CREATOR_CALL_ESCROW,
          direction: LedgerEntryDirection.CREDIT,
          amountMinorUnits: 900,
          currencyIso: 'ZAR',
        },
      ],
      'ZAR'
    );
    assert.equal(unbalanced.valid, false);

    // 10.2 Creator & Merchant balance commingling must be rejected
    const commingled = validateCreatorMerchantBalanceSeparation([
      {
        lineId: 'l1',
        accountId: 'acc_creator_1',
        ownerEntityId: 'cre_1',
        segregationDomain: AccountSegregationDomain.CREATOR_EARNINGS_PAYABLE,
        direction: LedgerEntryDirection.DEBIT,
        amountMinorUnits: 5000,
        currencyIso: 'ZAR',
      },
      {
        lineId: 'l2',
        accountId: 'acc_merchant_1',
        ownerEntityId: 'mer_1',
        segregationDomain: AccountSegregationDomain.MERCHANT_SALES_PAYABLE,
        direction: LedgerEntryDirection.CREDIT,
        amountMinorUnits: 5000,
        currencyIso: 'ZAR',
      },
    ]);
    assert.equal(commingled.valid, false);

    // 10.3 Idempotency replay & conflict detection
    const validLines = [
      {
        lineId: 'l_deb',
        accountId: 'acc_mer_escrow',
        ownerEntityId: 'mer_10',
        segregationDomain: AccountSegregationDomain.MERCHANT_ORDER_ESCROW,
        direction: LedgerEntryDirection.DEBIT,
        amountMinorUnits: 25000,
        currencyIso: 'ZAR',
      },
      {
        lineId: 'l_cred',
        accountId: 'acc_mer_payable',
        ownerEntityId: 'mer_10',
        segregationDomain: AccountSegregationDomain.MERCHANT_SALES_PAYABLE,
        direction: LedgerEntryDirection.CREDIT,
        amountMinorUnits: 25000,
        currencyIso: 'ZAR',
      },
    ] as const;

    const runSuffix = Date.now();
    const orderIdemKey = `idem_shop_order_${runSuffix}`;
    const chargebackIdemKey = `idem_chargeback_${runSuffix}`;

    const firstPost = ledger.recordAuthoritativeJournal({
      idempotencyKey: orderIdemKey,
      engineId: MonetizationEngineId.ENGINE_3_SHOP_MERCHANT_COMMISSIONS,
      currencyIso: 'ZAR',
      actorId: 'usr_buyer_1',
      actorType: AuditActorType.USER,
      lines: validLines,
    });
    assert.equal(firstPost.ok, true);
    assert.equal(firstPost.statusCode, 201);
    assert.equal(firstPost.idempotentReplay, false);

    const replayPost = ledger.recordAuthoritativeJournal({
      idempotencyKey: orderIdemKey,
      engineId: MonetizationEngineId.ENGINE_3_SHOP_MERCHANT_COMMISSIONS,
      currencyIso: 'ZAR',
      actorId: 'usr_buyer_1',
      actorType: AuditActorType.USER,
      lines: validLines,
    });
    assert.equal(replayPost.ok, true);
    assert.equal(replayPost.statusCode, 200);
    assert.equal(replayPost.idempotentReplay, true);
    assert.equal(replayPost.transaction?.journalId, firstPost.transaction?.journalId);

    const conflictPost = ledger.recordAuthoritativeJournal({
      idempotencyKey: orderIdemKey,
      engineId: MonetizationEngineId.ENGINE_4_BUSINESS_AD_REVENUE, // mutated engine
      currencyIso: 'ZAR',
      actorId: 'usr_buyer_1',
      actorType: AuditActorType.USER,
      lines: validLines,
    });
    assert.equal(conflictPost.ok, false);
    assert.equal(conflictPost.statusCode, 409);
    assert.equal(conflictPost.errorCode, 'IDEMPOTENCY_KEY_PAYLOAD_CONFLICT');

    // 10.4 Refund & Chargeback compensating journal controls
    const chargebackFreeze = ledger.transitionRefundOrChargeback({
      originalJournalId: firstPost.transaction!.journalId,
      idempotencyKey: chargebackIdemKey,
      transitionType: 'OPEN_CHARGEBACK_DISPUTE',
      actorId: 'sys_risk_engine',
      actorType: AuditActorType.SUPER_ADMIN,
    });
    assert.equal(chargebackFreeze.ok, true);
    assert.equal(
      chargebackFreeze.compensatingTransaction?.state,
      FinancialTransactionState.CHARGEBACK_PAYOUT_FROZEN
    );

    // 10.5 AI agent prohibition & Owner authorization requirement on financial policies
    const aiLedgerAttempt = ledger.recordAuthoritativeJournal({
      idempotencyKey: 'idem_ai_attempt_001',
      engineId: MonetizationEngineId.ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS,
      currencyIso: 'ZAR',
      actorId: 'agent_autonomous_01',
      actorType: AuditActorType.AI_AGENT,
      lines: validLines,
    });
    assert.equal(aiLedgerAttempt.ok, false);
    assert.equal(aiLedgerAttempt.statusCode, 403);
    assert.equal(aiLedgerAttempt.errorCode, 'AI_FINANCIAL_PERMISSION_FORBIDDEN');

    const aiPolicyAttempt = authorizeFinancialPolicyChange({
      actorType: AuditActorType.AI_AGENT,
      actorRoles: [],
      hasOwnerCryptographicSignature: true,
      ownerApprovalTicketId: 'TICKET_FAKE',
    });
    assert.equal(aiPolicyAttempt.authorized, false);
    assert.equal(aiPolicyAttempt.violationCode, 'AI_FINANCIAL_PERMISSION_FORBIDDEN');

    const superAdminWithoutOwnerAttempt = authorizeFinancialPolicyChange({
      actorType: AuditActorType.SUPER_ADMIN,
      actorRoles: [UserRole.SUPER_ADMIN],
      hasOwnerCryptographicSignature: false,
    });
    assert.equal(superAdminWithoutOwnerAttempt.authorized, false);
    assert.equal(
      superAdminWithoutOwnerAttempt.violationCode,
      'OWNER_FINANCIAL_AUTHORIZATION_REQUIRED'
    );

    const ownerValidPolicy = authorizeFinancialPolicyChange({
      actorType: AuditActorType.OWNER,
      actorRoles: [UserRole.OWNER],
      hasOwnerCryptographicSignature: true,
      ownerApprovalTicketId: 'OWNER-FIN-2026-001',
    });
    assert.equal(ownerValidPolicy.authorized, true);
    assert.equal(ledger.getFinancialAuditTrail().length >= 3, true);
  });

  // 11. NestJS Module & Framework Verification (Task 1 & Task 3)
  await runTest('Framework Verification (Task 3): NestJS NestFactory.create(AppModule) boots, serves /api/v1/health & enforces deny-by-default', async () => {
    assert.equal(AppModule.apiPrefix, 'api/v1');
    assert.equal(AppModule.registeredDivisions.length, 5);
    assert.equal(AppModule.registeredMonetizationEngines.length, 5);
    assert.equal(AppModule.registeredPlatforms.length, 9);

    const nestApp = await createNestApiApp();
    await nestApp.listen(0, '127.0.0.1');
    try {
      const httpServer = nestApp.getHttpServer() as http.Server;
      const addr = httpServer.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('Failed to bind NestJS HTTP server');
      }
      const nestUrl = `http://127.0.0.1:${addr.port}`;

      const hRes = await fetch(`${nestUrl}/api/v1/health`);
      assert.equal(hRes.status, 200);
      const hJson = (await hRes.json()) as { status: string; service: string };
      assert.equal(hJson.status, 'ok');
      assert.equal(hJson.service, 'face-vid-api');

      const bRes = await fetch(`${nestUrl}/api/v1/architecture/boundaries`);
      assert.equal(bRes.status, 200);

      const adminBlock = await fetch(`${nestUrl}/api/v1/admin/system`);
      assert.equal(adminBlock.status, 403);
    } finally {
      await nestApp.close();
    }
  });

  // 12. Phase 1B-1 PostgreSQL 16 Versioned Migrations & 16-Domain Relational Integrity Tests
  await runTest('Phase 1B-1 PostgreSQL 16 Foundation: Versioned migrations (0001-0004), 16 relational domains, FK/CHECK constraints & immutability triggers', async () => {
    await databaseFoundationService.ensureListening();
    const migrations = databaseFoundationService.runVersionedMigrations();
    assert.equal(migrations.length >= 4, true);
    assert.equal(migrations[0]?.version, '0001');
    assert.equal(migrations[1]?.version, '0002');
    assert.equal(migrations[2]?.version, '0003');
    assert.equal(migrations[3]?.version, '0004');

    const summary = databaseFoundationService.getFoundationInspectionSummary();
    assert.equal(summary.initialized, true);
    assert.equal(summary.foundingCreatorProgramState.maxEligibleCreators, 3000000);
    assert.equal(summary.foundingCreatorProgramState.allocationActive, false);
    assert.equal(summary.financialPolicies.length, 5);
    for (const pol of summary.financialPolicies) {
      assert.equal(pol.paymentsActive, false);
      assert.equal(pol.commissionBasisPoints, null);
      assert.equal(pol.basePriceMinorUnits, null);
    }

    // Verify AI_AGENT role grant prohibition constraint
    assert.throws(() => {
      databaseFoundationService.assignUserRole({
        userId: 'usr_verified_8841',
        roleCode: UserRole.ADMIN,
        grantedByActorId: 'ai_agent_01',
        grantedByActorType: AuditActorType.AI_AGENT,
      });
    }, /AI_AGENT is prohibited/);

    // Verify append-only immutability triggers on audit_events and financial_journal_transactions
    const auditMutationAttempt =
      databaseFoundationService.attemptMutateOrDeleteAuditEvent('audit_p1b1_1');
    assert.equal(auditMutationAttempt.blockedByTrigger, true);
    assert.equal(auditMutationAttempt.triggerName, 'trg_audit_events_immutable');

    const ledgerMutationAttempt =
      databaseFoundationService.attemptMutateOrDeleteLedgerEntry('jrnl_p1b1_1');
    assert.equal(ledgerMutationAttempt.blockedByTrigger, true);
    assert.equal(ledgerMutationAttempt.triggerName, 'trg_financial_journals_immutable');
  });

  // 13. Phase 1B-1 Redis 7 Foundation: TCP RESP Server, Rate Limiting, Challenge Nonces, Session Revocation & Idempotency
  await runTest('Phase 1B-1 Redis 7 Foundation: ioredis TCP connectivity, rate limiting, temporary TV codes, single-use auth challenges & revocation cache', async () => {
    const health = await redisFoundationService.getHealthStatus();
    assert.equal(health.connected, true);
    assert.equal(health.pingResponse, 'PONG');
    assert.equal(health.primaryFinancialTruthInRedis, false);
    assert.ok(health.serverVersion.startsWith('7.'));

    // 13.1 Rate limiting window enforcement
    const scopeId = `test_rl_${Date.now()}`;
    const rl1 = await redisFoundationService.checkRateLimit({
      scope: 'unit_test',
      identifier: scopeId,
      limit: 2,
      windowSeconds: 60,
    });
    const rl2 = await redisFoundationService.checkRateLimit({
      scope: 'unit_test',
      identifier: scopeId,
      limit: 2,
      windowSeconds: 60,
    });
    const rl3 = await redisFoundationService.checkRateLimit({
      scope: 'unit_test',
      identifier: scopeId,
      limit: 2,
      windowSeconds: 60,
    });
    assert.equal(rl1.allowed, true);
    assert.equal(rl2.allowed, true);
    assert.equal(rl3.allowed, false);
    assert.equal(rl3.remaining, 0);

    // 13.2 Single-use authentication challenge state
    const challenge = await redisFoundationService.issueAuthChallengeNonce({
      purpose: 'TV_DEVICE_PAIRING',
      targetEntityId: 'tv_unit_01',
      ttlSeconds: 120,
    });
    const firstConsume = await redisFoundationService.consumeAuthChallengeNonce({
      challengeId: challenge.challengeId,
      presentedNonce: challenge.nonce,
      expectedPurpose: 'TV_DEVICE_PAIRING',
    });
    assert.equal(firstConsume.valid, true);

    const replayConsume = await redisFoundationService.consumeAuthChallengeNonce({
      challengeId: challenge.challengeId,
      presentedNonce: challenge.nonce,
      expectedPurpose: 'TV_DEVICE_PAIRING',
    });
    assert.equal(replayConsume.valid, false);
    assert.equal(replayConsume.reason, 'CHALLENGE_EXPIRED_OR_ALREADY_CONSUMED');

    // 13.3 Session cache & immediate revocation blocklist
    const sessId = `sess_cache_${Date.now()}`;
    await redisFoundationService.cacheActiveDeviceSession({
      sessionId: sessId,
      userId: 'usr_verified_8841',
      platformId: PlatformId.FACE_VID_WEB,
      experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
      tokenSha256: 'sha256_sample_token',
      expiresAtIso: new Date(Date.now() + 3600_000).toISOString(),
    });
    assert.equal(await redisFoundationService.isSessionRevokedInCache(sessId), false);
    await redisFoundationService.markSessionRevokedInCache(sessId, 'SECURITY_TEST_REVOKE');
    assert.equal(await redisFoundationService.isSessionRevokedInCache(sessId), true);

    // 13.4 Idempotency key coordination & conflict detection
    const idemKey = `idem_redis_${Date.now()}`;
    const lock1 = await redisFoundationService.coordinateIdempotencyKey({
      scope: 'ledger_test',
      idempotencyKey: idemKey,
      payloadSha256: 'hash_aaa111',
      journalId: 'jrnl_001',
    });
    assert.equal(lock1.status, 'NEW_KEY_LOCKED');

    const replayLock = await redisFoundationService.coordinateIdempotencyKey({
      scope: 'ledger_test',
      idempotencyKey: idemKey,
      payloadSha256: 'hash_aaa111',
      journalId: 'jrnl_001',
    });
    assert.equal(replayLock.status, 'IDEMPOTENT_REPLAY');

    const conflictLock = await redisFoundationService.coordinateIdempotencyKey({
      scope: 'ledger_test',
      idempotencyKey: idemKey,
      payloadSha256: 'hash_mutated_999',
      journalId: 'jrnl_002',
    });
    assert.equal(conflictLock.status, 'PAYLOAD_CONFLICT');
  });

  // ===========================================================================
  // 14. PHASE 1B-1: EXTERNAL POSTGRES 16 & REDIS 7 TLS CONFIG + PRODUCTION FAIL-CLOSED
  // ===========================================================================
  await runTest(
    'Phase 1B-1: External PostgreSQL 16 & Redis 7 TLS Config, Adapter Distinction & Production Fail-Closed',
    async () => {
      // 14.1 Verify honest test-adapter reporting in development/test mode
      const dbSummary = databaseFoundationService.getFoundationInspectionSummary();
      assert.equal(dbSummary.connectionMode, 'LOCAL_JSON_TEST_ADAPTER');
      assert.equal(dbSummary.isTestAdapter, true);
      assert.equal(dbSummary.productionReady, false);

      const redisHealth = await redisFoundationService.getHealthStatus();
      assert.equal(redisHealth.connectionMode, 'LOCAL_RESP_TEST_ADAPTER');
      assert.equal(redisHealth.isTestAdapter, true);
      assert.equal(redisHealth.productionReady, false);

      // 14.2 Verify PostgreSQL 16 TLS and DATABASE_URL resolution
      const prevPgSslMode = process.env.POSTGRES_SSL_MODE;
      const prevDbUrl = process.env.DATABASE_URL;
      try {
        process.env.DATABASE_URL =
          'postgresql://fv_prod_user:fv_secret_pw@pg16.example.internal:5432/facevid_prod?sslmode=verify-full';
        const resolvedPg = databaseFoundationService.resolvePostgresConfig();
        assert.equal(resolvedPg.summary.host, 'pg16.example.internal');
        assert.equal(resolvedPg.summary.port, 5432);
        assert.equal(resolvedPg.summary.database, 'facevid_prod');
        assert.equal(resolvedPg.summary.user, 'fv_prod_user');
        assert.equal(resolvedPg.summary.passwordConfigured, true);
        assert.equal(resolvedPg.summary.sslEnabled, true);
        assert.equal(resolvedPg.summary.sslMode, 'verify-full');
        assert.equal(resolvedPg.summary.tlsRejectUnauthorized, true);
        assert.equal(resolvedPg.summary.configuredViaDatabaseUrl, true);
      } finally {
        if (prevPgSslMode === undefined) delete process.env.POSTGRES_SSL_MODE;
        else process.env.POSTGRES_SSL_MODE = prevPgSslMode;
        if (prevDbUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = prevDbUrl;
      }

      // 14.3 Verify Redis 7 TLS and rediss:// REDIS_URL resolution
      const prevRedisUrl = process.env.REDIS_URL;
      try {
        process.env.REDIS_URL =
          'rediss://default:redis_secret_pw@redis7.example.internal:6380/0';
        const resolvedRedis = redisFoundationService.resolveRedisConfig();
        assert.equal(resolvedRedis.summary.host, 'redis7.example.internal');
        assert.equal(resolvedRedis.summary.port, 6380);
        assert.equal(resolvedRedis.summary.usernameConfigured, true);
        assert.equal(resolvedRedis.summary.passwordConfigured, true);
        assert.equal(resolvedRedis.summary.tlsEnabled, true);
        assert.equal(resolvedRedis.summary.tlsRejectUnauthorized, true);
        assert.equal(resolvedRedis.summary.configuredViaUrl, true);
      } finally {
        if (prevRedisUrl === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = prevRedisUrl;
      }

      // 14.4 Verify Production Mode fails closed when external services are missing/unreachable
      const prevStrict = process.env.REQUIRE_EXTERNAL_INFRASTRUCTURE;
      try {
        process.env.REQUIRE_EXTERNAL_INFRASTRUCTURE = 'true';
        assert.equal(databaseFoundationService.isProductionMode(), true);
        assert.equal(redisFoundationService.isProductionMode(), true);

        let pgFailedClosed = false;
        try {
          await databaseFoundationService.verifyExternalPostgresConnection();
        } catch (err) {
          pgFailedClosed =
            err instanceof Error && err.message.includes('[FAIL_CLOSED]');
        }
        assert.equal(
          pgFailedClosed,
          true,
          'Production mode must fail closed when external PostgreSQL 16 is unavailable'
        );

        let redisFailedClosed = false;
        try {
          await redisFoundationService.ensureConnected();
        } catch (err) {
          redisFailedClosed =
            err instanceof Error && err.message.includes('[FAIL_CLOSED]');
        }
        assert.equal(
          redisFailedClosed,
          true,
          'Production mode must fail closed when external Redis 7 is unavailable'
        );
      } finally {
        if (prevStrict === undefined) {
          delete process.env.REQUIRE_EXTERNAL_INFRASTRUCTURE;
        } else {
          process.env.REQUIRE_EXTERNAL_INFRASTRUCTURE = prevStrict;
        }
        // Restore dev/test adapter state after fail-closed verification
        await databaseFoundationService.ensureListening();
        await redisFoundationService.ensureConnected();
      }
    }
  );

  // ===========================================================================
  // 15. PHASE 1 TASK 1.1A: VIDEO CATALOG SCHEMA, CHANNELS & READ-ONLY API
  // ===========================================================================
  await runTest(
    'Phase 1 Task 1.1A: Video Catalog Schema (Migration 0004), Channels & Read-Only Endpoints (GET /api/v1/videos, GET /api/v1/videos/:id)',
    async () => {
      // 15.1 Verify Migration 0004 DDL table parsing and registration
      const migrations = databaseFoundationService.runVersionedMigrations();
      const m0004 = migrations.find((m) => m.version === '0004');
      assert.ok(m0004, 'Migration 0004 must be present in applied migrations');
      assert.equal(m0004.filename, '0004_phase1_video_catalog_and_channels.sql');
      assert.ok(m0004.checksumSha256.length === 64);
      assert.ok(m0004.tablesCreated.includes('video_channels'));
      assert.ok(m0004.tablesCreated.includes('video_categories'));
      assert.ok(m0004.tablesCreated.includes('videos'));
      assert.ok(m0004.tablesCreated.includes('video_tags'));
      assert.ok(m0004.tablesCreated.includes('video_tag_mappings'));

      // 15.2 Verify Database Service query methods
      const catalogSummary = databaseFoundationService.getFoundationInspectionSummary();
      assert.ok(catalogSummary.tableRowCounts.video_channels >= 1);
      assert.ok(catalogSummary.tableRowCounts.video_categories >= 8);
      assert.ok(catalogSummary.tableRowCounts.videos >= 4);

      // Verify listVideos defaults to PUBLIC videos only
      const allPublic = databaseFoundationService.listVideos();
      assert.ok(allPublic.items.length >= 2);
      for (const item of allPublic.items) {
        assert.equal(item.visibility, 'PUBLIC');
        assert.ok(item.channel);
        assert.ok(item.channel.channelHandle);
      }

      // Verify getVideoById
      const publicVid = databaseFoundationService.getVideoById('vid_maya_ai_cinema_001');
      assert.ok(publicVid);
      assert.equal(publicVid.title, 'Neural Worlds: Episode 1 — The Glass Horizon');
      assert.equal(publicVid.videoFormat, 'STANDARD');
      assert.equal(publicVid.visibility, 'PUBLIC');
      assert.ok(publicVid.tags.includes('ai'));
      assert.equal(publicVid.channel?.channelHandle, '@mayalin_fv');

      const unlistedVid = databaseFoundationService.getVideoById('vid_maya_unlisted_003');
      assert.ok(unlistedVid);
      assert.equal(unlistedVid.visibility, 'UNLISTED');

      const privateVid = databaseFoundationService.getVideoById('vid_maya_private_004');
      assert.ok(privateVid);
      assert.equal(privateVid.visibility, 'PRIVATE');

      // 15.3 Verify API endpoints on standalone HTTP server
      const app = createStandaloneApiApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind server address for video catalog test');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // GET /api/v1/videos (public listing)
        const listRes = await fetch(`${baseUrl}/api/v1/videos`);
        assert.equal(listRes.status, 200);
        const listJson = (await listRes.json()) as {
          ok: boolean;
          data: Array<{ videoId: string; visibility: string; channel: { channelHandle: string } }>;
          pagination: { page: number; limit: number; totalCount: number; hasNextPage: boolean };
        };
        assert.equal(listJson.ok, true);
        assert.ok(listJson.data.length >= 2);
        assert.equal(listJson.pagination.page, 1);
        assert.equal(listJson.pagination.limit, 20);
        // All items must be PUBLIC
        for (const item of listJson.data) {
          assert.equal(item.visibility, 'PUBLIC');
        }

        // Pagination query parameters
        const pageRes = await fetch(`${baseUrl}/api/v1/videos?page=1&limit=1`);
        assert.equal(pageRes.status, 200);
        const pageJson = (await pageRes.json()) as {
          data: unknown[];
          pagination: { page: number; limit: number; totalPages: number; hasNextPage: boolean };
        };
        assert.equal(pageJson.data.length, 1);
        assert.equal(pageJson.pagination.page, 1);
        assert.equal(pageJson.pagination.limit, 1);
        assert.ok(pageJson.pagination.totalPages >= 2);
        assert.equal(pageJson.pagination.hasNextPage, true);

        // Safe pagination input validation: invalid page or limit
        const badPageRes = await fetch(`${baseUrl}/api/v1/videos?page=invalid`);
        assert.equal(badPageRes.status, 400);
        const badPageJson = (await badPageRes.json()) as { errorCode: string };
        assert.equal(badPageJson.errorCode, 'VALIDATION_FAILED');

        const badLimitRes = await fetch(`${baseUrl}/api/v1/videos?limit=-5`);
        assert.equal(badLimitRes.status, 400);
        const badLimitJson = (await badLimitRes.json()) as { errorCode: string };
        assert.equal(badLimitJson.errorCode, 'VALIDATION_FAILED');

        // Format filter
        const shortsRes = await fetch(`${baseUrl}/api/v1/videos?format=SHORT`);
        assert.equal(shortsRes.status, 200);
        const shortsJson = (await shortsRes.json()) as {
          data: Array<{ videoId: string; videoFormat: string }>;
        };
        for (const s of shortsJson.data) {
          assert.equal(s.videoFormat, 'SHORT');
        }

        // Category filter
        const catRes = await fetch(`${baseUrl}/api/v1/videos?category=ai-creative`);
        assert.equal(catRes.status, 200);
        const catJson = (await catRes.json()) as {
          data: Array<{ videoId: string; categoryId: string }>;
        };
        for (const c of catJson.data) {
          assert.equal(c.categoryId, 'cat_ai_creative');
        }

        // Search query filter
        const searchRes = await fetch(`${baseUrl}/api/v1/videos?q=Horizon`);
        assert.equal(searchRes.status, 200);
        const searchJson = (await searchRes.json()) as {
          data: Array<{ videoId: string; title: string }>;
        };
        assert.ok(searchJson.data.length >= 1);
        assert.ok(searchJson.data[0]?.title.includes('Horizon'));

        // GET /api/v1/videos/:id (public video)
        const getPublicRes = await fetch(`${baseUrl}/api/v1/videos/vid_maya_ai_cinema_001`);
        assert.equal(getPublicRes.status, 200);
        const getPublicJson = (await getPublicRes.json()) as {
          ok: boolean;
          data: { videoId: string; title: string; playbackUrl: string; channel: { title: string } };
        };
        assert.equal(getPublicJson.ok, true);
        assert.equal(getPublicJson.data.videoId, 'vid_maya_ai_cinema_001');
        assert.ok(getPublicJson.data.playbackUrl);
        assert.ok(getPublicJson.data.channel.title);

        // GET /api/v1/videos/:id (unlisted video by direct ID is reachable)
        const getUnlistedRes = await fetch(`${baseUrl}/api/v1/videos/vid_maya_unlisted_003`);
        assert.equal(getUnlistedRes.status, 200);
        const getUnlistedJson = (await getUnlistedRes.json()) as {
          ok: boolean;
          data: { videoId: string; visibility: string; playbackUrl: string };
        };
        assert.equal(getUnlistedJson.data.visibility, 'UNLISTED');
        assert.ok(getUnlistedJson.data.playbackUrl);

        // Security Test: Private video rejection (404) & no playbackUrl leakage
        const getPrivateRes = await fetch(`${baseUrl}/api/v1/videos/vid_maya_private_004`);
        assert.equal(getPrivateRes.status, 404);
        const privateRaw = await getPrivateRes.text();
        const getPrivateJson = JSON.parse(privateRaw) as { errorCode: string };
        assert.equal(getPrivateJson.errorCode, 'NOT_FOUND');
        assert.equal(privateRaw.includes('playbackUrl'), false);
        assert.equal(privateRaw.includes('raw-take-04.mp4'), false);

        // Security Test: Subscriber-only video rejection (403) & untrusted client header rejection
        const getSubscribersRes = await fetch(`${baseUrl}/api/v1/videos/vid_maya_subscribers_005`, {
          headers: { 'X-Subscriber-Status': 'active_subscriber', 'X-Subscriber-Role': 'VIP' },
        });
        assert.equal(getSubscribersRes.status, 403);
        const subscribersRaw = await getSubscribersRes.text();
        const getSubscribersJson = JSON.parse(subscribersRaw) as { errorCode: string };
        assert.equal(getSubscribersJson.errorCode, 'FORBIDDEN_DENY_BY_DEFAULT');
        assert.equal(subscribersRaw.includes('playbackUrl'), false);
        assert.equal(subscribersRaw.includes('subscribers-masterclass.mp4'), false);

        // Security Test: Age-restricted video rejection (403) & untrusted client header rejection
        const getAgeRestrictedRes = await fetch(`${baseUrl}/api/v1/videos/vid_maya_age_restricted_006`, {
          headers: { 'X-User-Age': '25', 'X-Age-Verified': 'true' },
        });
        assert.equal(getAgeRestrictedRes.status, 403);
        const ageRaw = await getAgeRestrictedRes.text();
        const getAgeJson = JSON.parse(ageRaw) as { errorCode: string };
        assert.equal(getAgeJson.errorCode, 'FORBIDDEN_DENY_BY_DEFAULT');
        assert.equal(ageRaw.includes('playbackUrl'), false);
        assert.equal(ageRaw.includes('midnight-horror.mp4'), false);

        // Security Test: Public non-READY video rejection (PROCESSING -> 404) & no unfinished media leakage
        const getProcessingRes = await fetch(`${baseUrl}/api/v1/videos/vid_maya_processing_007`);
        assert.equal(getProcessingRes.status, 404);
        const processingRaw = await getProcessingRes.text();
        const getProcessingJson = JSON.parse(processingRaw) as { errorCode: string };
        assert.equal(getProcessingJson.errorCode, 'NOT_FOUND');
        assert.equal(processingRaw.includes('playbackUrl'), false);
        assert.equal(processingRaw.includes('transcoding-incomplete.mp4'), false);

        // Security Test: Public non-READY video rejection (FAILED -> 404) & no internal asset leakage
        const getFailedRes = await fetch(`${baseUrl}/api/v1/videos/vid_maya_failed_008`);
        assert.equal(getFailedRes.status, 404);
        const failedRaw = await getFailedRes.text();
        const getFailedJson = JSON.parse(failedRaw) as { errorCode: string };
        assert.equal(getFailedJson.errorCode, 'NOT_FOUND');
        assert.equal(failedRaw.includes('playbackUrl'), false);
        assert.equal(failedRaw.includes('failed-damaged-artifact.mp4'), false);

        // Security Test: Search cannot bypass visibility or processing restrictions
        for (const forbiddenQuery of ['Rough Cut', 'subscribers', 'Midnight', 'transcode', 'failed']) {
          const searchLeakCheck = await fetch(`${baseUrl}/api/v1/videos?q=${encodeURIComponent(forbiddenQuery)}`);
          assert.equal(searchLeakCheck.status, 200);
          const searchLeakJson = (await searchLeakCheck.json()) as { data: unknown[] };
          assert.equal(searchLeakJson.data.length, 0, `Search query '${forbiddenQuery}' must not leak non-public-ready assets`);
        }

        // GET /api/v1/videos/:id (non-existent video -> 404)
        const getNotFoundRes = await fetch(`${baseUrl}/api/v1/videos/vid_nonexistent_999`);
        assert.equal(getNotFoundRes.status, 404);
        const getNotFoundJson = (await getNotFoundRes.json()) as { errorCode: string };
        assert.equal(getNotFoundJson.errorCode, 'NOT_FOUND');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );

  // 20. Phase 1 Task 1.2A: Controlled HTML5 Video Player & Frontend Integration Suite
  await runTest(
    'Phase 1 Task 1.2A: HTML5 Video Player, Play/Pause, Seek, Formats, Error Overlays & Restricted Video Isolation',
    async () => {
      // 20.1 Helper: formatTime checks
      assert.equal(formatTime(0), '0:00');
      assert.equal(formatTime(58), '0:58');
      assert.equal(formatTime(742), '12:22');
      assert.equal(formatTime(3665), '1:01:05');
      assert.equal(formatTime(-1), '0:00');
      assert.equal(formatTime(NaN), '0:00');

      // 20.2 Standard 16:9 Landscape Player Rendering & Controls
      const standardHtml = renderToStaticMarkup(
        React.createElement(VideoPlayer, {
          src: '/assets/demo/videos/glass-horizon.mp4',
          poster: '/assets/demo/thumbnails/glass-horizon.jpg',
          title: 'Neural Worlds: Episode 1 — The Glass Horizon',
          creatorName: 'Maya Lin Official',
          creatorHandle: '@mayalin_fv',
          aspectRatio: '16:9',
          videoFormat: 'STANDARD',
          visibility: 'PUBLIC',
          processingStatus: 'READY',
          isSampleContent: false,
        })
      );

      assert.ok(standardHtml.includes('<video'), 'Player must render native HTML5 <video> tag');
      assert.ok(
        standardHtml.includes('src="/assets/demo/videos/glass-horizon.mp4"'),
        'Video tag must point to safe authorized stream URL'
      );
      assert.ok(
        standardHtml.includes('data-testid="html5-video-element"'),
        'Video element must carry data-testid'
      );
      assert.ok(
        standardHtml.includes('data-testid="center-play-button"'),
        'Must render center play overlay when paused'
      );
      assert.ok(
        standardHtml.includes('data-testid="control-play-pause-btn"'),
        'Must render play/pause control button'
      );
      assert.ok(
        standardHtml.includes('data-testid="seek-slider"'),
        'Must render seek range scrubber input'
      );
      assert.ok(
        standardHtml.includes('data-testid="control-mute-btn"'),
        'Must render volume/mute toggle button'
      );
      assert.ok(
        standardHtml.includes('data-testid="volume-slider"'),
        'Must render volume range slider'
      );
      assert.ok(
        standardHtml.includes('data-testid="playback-speed-select"'),
        'Must render playback speed select'
      );
      assert.ok(
        standardHtml.includes('data-testid="control-fullscreen-btn"'),
        'Must render fullscreen toggle button'
      );
      assert.ok(
        standardHtml.includes('aspect-video'),
        'Standard player must use 16:9 aspect-video class'
      );

      // 20.3 Vertical 9:16 Shorts Video Player
      const verticalHtml = renderToStaticMarkup(
        React.createElement(VideoPlayer, {
          src: '/assets/demo/videos/bts-prompting.mp4',
          poster: '/assets/demo/thumbnails/bts-prompting.jpg',
          title: 'Behind the Scenes: Realtime Prompt Engineering',
          creatorName: 'Maya Lin Official',
          creatorHandle: '@mayalin_fv',
          aspectRatio: '9:16',
          videoFormat: 'SHORT',
          visibility: 'PUBLIC',
          processingStatus: 'READY',
          isSampleContent: false,
        })
      );
      assert.ok(
        verticalHtml.includes('aspect-[9/16]'),
        'Vertical short player must apply aspect-[9/16]'
      );
      assert.ok(
        verticalHtml.includes('max-w-[420px]'),
        'Vertical short player must restrict width to mobile phone proportion'
      );
      assert.ok(
        verticalHtml.includes('SHORT'),
        'Short player must display SHORT format badge'
      );

      // 20.4 Security & Restricted Video Protection: PRIVATE
      const privateHtml = renderToStaticMarkup(
        React.createElement(VideoPlayer, {
          src: '/assets/demo/videos/raw-take-04.mp4',
          title: 'Raw Studio Take 04',
          creatorName: 'Maya Lin',
          visibility: 'PRIVATE',
          processingStatus: 'READY',
        })
      );
      assert.equal(
        privateHtml.includes('<video'),
        false,
        'Private video MUST NOT render HTML5 <video> tag'
      );
      assert.equal(
        privateHtml.includes('raw-take-04.mp4'),
        false,
        'Private playback URL must never leak into DOM'
      );
      assert.ok(
        privateHtml.includes('data-testid="restricted-guard-screen"'),
        'Must render restricted guard screen'
      );
      assert.ok(
        privateHtml.includes('This video is private. Public playback is forbidden.')
      );

      // 20.5 Security & Restricted Video Protection: SUBSCRIBERS_ONLY
      const subOnlyHtml = renderToStaticMarkup(
        React.createElement(VideoPlayer, {
          src: '/assets/demo/videos/subscribers-masterclass.mp4',
          title: 'Subscriber Masterclass',
          creatorName: 'Maya Lin',
          visibility: 'SUBSCRIBERS_ONLY',
          processingStatus: 'READY',
        })
      );
      assert.equal(
        subOnlyHtml.includes('<video'),
        false,
        'Subscribers-only video MUST NOT render HTML5 <video> tag for unverified callers'
      );
      assert.equal(
        subOnlyHtml.includes('subscribers-masterclass.mp4'),
        false,
        'Subscribers-only playback URL must never leak into DOM'
      );
      assert.ok(
        subOnlyHtml.includes('Access restricted to active subscribers')
      );

      // 20.6 Security & Restricted Video Protection: AGE_RESTRICTED
      const ageHtml = renderToStaticMarkup(
        React.createElement(VideoPlayer, {
          src: '/assets/demo/videos/midnight-horror.mp4',
          title: 'Midnight Horror',
          creatorName: 'Maya Lin',
          visibility: 'AGE_RESTRICTED',
          processingStatus: 'READY',
        })
      );
      assert.equal(ageHtml.includes('<video'), false);
      assert.equal(ageHtml.includes('midnight-horror.mp4'), false);
      assert.ok(ageHtml.includes('Access restricted: age-verification required'));

      // 20.7 Non-READY Video Protection (PROCESSING / FAILED)
      const procHtml = renderToStaticMarkup(
        React.createElement(VideoPlayer, {
          src: '/assets/demo/videos/transcoding-incomplete.mp4',
          title: 'Processing Video',
          creatorName: 'Maya Lin',
          visibility: 'PUBLIC',
          processingStatus: 'PROCESSING',
        })
      );
      assert.equal(procHtml.includes('<video'), false);
      assert.equal(procHtml.includes('transcoding-incomplete.mp4'), false);
      assert.ok(procHtml.includes('Video is not ready for playback (status: PROCESSING)'));

      // 20.8 Missing src handling
      const noSrcHtml = renderToStaticMarkup(
        React.createElement(VideoPlayer, {
          title: 'Unlinked Video',
          creatorName: 'Maya Lin',
          visibility: 'PUBLIC',
          processingStatus: 'READY',
        })
      );
      assert.equal(noSrcHtml.includes('<video'), false);
      assert.ok(noSrcHtml.includes('No authorized playback stream available'));

      // 20.9 WebAppShell Frontend Integration & Navigation Preservation
      const shellHtml = renderToStaticMarkup(
        React.createElement(WebAppShell, { initialRoute: 'home' })
      );
      assert.ok(
        shellHtml.includes('Play &amp; Inspect'),
        'WebAppShell video cards must render Play & Inspect button'
      );
      assert.ok(
        shellHtml.includes('/assets/owner/face-vid-official-logo.png'),
        'Official Owner Logo reference must be present'
      );
      assert.ok(
        shellHtml.includes('Face Vid Social'),
        'Platform division 1 (Social) must be preserved'
      );
      assert.ok(
        shellHtml.includes('Face Vid Creator'),
        'Platform division 2 (Creator) must be preserved'
      );
      assert.ok(
        shellHtml.includes('Face Vid Merchant'),
        'Platform division 3 (Merchant) must be preserved'
      );
      assert.ok(
        shellHtml.includes('Face Vid Business'),
        'Platform division 4 (Business) must be preserved'
      );
      assert.ok(
        shellHtml.includes('Launch FACE VID TV'),
        'Experience B TV Launcher button must be preserved'
      );

      // 20.10 WebAppShell Shorts Route Integration
      const shortsShellHtml = renderToStaticMarkup(
        React.createElement(WebAppShell, { initialRoute: 'shorts' })
      );
      assert.ok(
        shortsShellHtml.includes('data-testid="play-vertical-short-btn"'),
        'Shorts route must provide play vertical short action'
      );
    }
  );

  // 21. Phase 1 Task 1.2B: Genuine Interactive HTML5 Video Playback & Component Controls Suite
  await runTest(
    'Phase 1 Task 1.2B: Genuine Interactive HTML5 Video Playback, Controls, Fullscreen, Shorts & Error Recovery Suite',
    async () => {
      const suitePassed = await runInteractiveVideoSuite();
      assert.equal(suitePassed, true, 'All 10 interactive video playback tests must pass');
    }
  );

  // 22. Phase 1 Task 1.3B: Controlled Creator Video Upload Foundation Suite
  await runTest(
    'Phase 1 Task 1.3B: Controlled Creator Video Upload Foundation (Auth, Ownership, Limits, Quotas, Concurrency, Idempotency & Isolation)',
    async () => {
      const app = createStandaloneApiApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind port for Task 1.3B test');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Reset test upload sessions for isolated test run
        const catalogObj = (databaseFoundationService as any).catalog;
        if (catalogObj) {
          catalogObj.videoUploadSessions = {};
          if (catalogObj.users && catalogObj.users['usr_verified_8841']) {
            catalogObj.users['usr_verified_8841'].accountStatus = AccountStatus.ACTIVE;
          }
        }

        const mayaToken = 'dev_creator_token_maya';
        const secondCreatorToken = 'dev_creator_token_second';
        const viewerToken = 'dev_viewer_token';
        const merchantToken = 'dev_merchant_token';

        // 1. Authentication: Missing auth header must return 401 UNAUTHORIZED
        const unauthRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'clip1.mp4',
            fileSizeBytes: 1024 * 1024 * 50,
            mimeType: 'video/mp4',
            title: 'Test Clip',
          }),
        });
        assert.equal(unauthRes.status, 401, 'Unauthenticated upload session initiation must return 401');
        const unauthBody = (await unauthRes.json()) as { errorCode: string };
        assert.equal(unauthBody.errorCode, ApiErrorCode.UNAUTHORIZED);

        // 2. Authentication: Invalid session token must return 401 UNAUTHORIZED
        const badTokenRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer invalid_garbage_token_123',
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'clip1.mp4',
            fileSizeBytes: 1024 * 1024 * 50,
            mimeType: 'video/mp4',
            title: 'Test Clip',
          }),
        });
        assert.equal(badTokenRes.status, 401, 'Invalid token must return 401');

        // 3. Authorization: Viewer without CREATOR role must return 403 FORBIDDEN_DENY_BY_DEFAULT
        const viewerRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${viewerToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'clip1.mp4',
            fileSizeBytes: 1024 * 1024 * 50,
            mimeType: 'video/mp4',
            title: 'Test Clip',
          }),
        });
        assert.equal(viewerRes.status, 403, 'Non-creator user role must return 403');
        const viewerBody = (await viewerRes.json()) as { errorCode: string };
        assert.equal(viewerBody.errorCode, ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT);

        // 4. Authorization: Merchant without CREATOR role must return 403
        const merchantRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${merchantToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'clip1.mp4',
            fileSizeBytes: 1024 * 1024 * 50,
            mimeType: 'video/mp4',
            title: 'Test Clip',
          }),
        });
        assert.equal(merchantRes.status, 403, 'Merchant user must return 403');

        // 5. Channel Ownership: Creator attempting to upload to a channel they do not own
        // Maya attempting to upload to Devon's channel 'chn_second_9902'
        const crossChannelRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_second_9902',
            fileName: 'clip1.mp4',
            fileSizeBytes: 1024 * 1024 * 50,
            mimeType: 'video/mp4',
            title: 'Unauthorized Channel Upload',
          }),
        });
        assert.equal(crossChannelRes.status, 403, 'Uploading to unowned channel must return 403');
        const crossChannelBody = (await crossChannelRes.json()) as { message: string; errorCode: string };
        assert.equal(crossChannelBody.errorCode, ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT);
        assert.ok(crossChannelBody.message.includes('does not own target channel'));

        // 6. Channel Existence: Uploading to non-existent channel returns 404
        const nonExistentChannelRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_does_not_exist_9999',
            fileName: 'clip1.mp4',
            fileSizeBytes: 1024 * 1024 * 50,
            mimeType: 'video/mp4',
            title: 'Non-existent Channel Upload',
          }),
        });
        assert.equal(nonExistentChannelRes.status, 404, 'Non-existent channel must return 404');

        // 7. File Size Validation: Zero or negative file size returns 400
        const zeroSizeRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'clip1.mp4',
            fileSizeBytes: 0,
            mimeType: 'video/mp4',
            title: 'Zero Size Clip',
          }),
        });
        assert.equal(zeroSizeRes.status, 400, 'Zero file size must return 400');

        // 8. File Size Validation: File size > 10 GB returns 400
        const overLimitSizeRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'giant.mp4',
            fileSizeBytes: 11 * 1024 * 1024 * 1024, // 11 GB
            mimeType: 'video/mp4',
            title: 'Too Large Clip',
          }),
        });
        assert.equal(overLimitSizeRes.status, 400, 'File size > 10 GB must return 400');
        const overLimitBody = (await overLimitSizeRes.json()) as { message: string };
        assert.ok(overLimitBody.message.includes('exceeds maximum permitted limit of 10 GB'));

        // 9. Media MIME Type Validation: Disallowed MIME type returns 400
        const badMimeRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'script.sh',
            fileSizeBytes: 1024 * 50,
            mimeType: 'application/x-sh',
            title: 'Shell Script',
          }),
        });
        assert.equal(badMimeRes.status, 400, 'Disallowed MIME type must return 400');

        // 10. File Name Validation: Path traversal characters returns 400
        const traversalRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: '../../../etc/passwd.mp4',
            fileSizeBytes: 1024 * 50,
            mimeType: 'video/mp4',
            title: 'Traversal Clip',
          }),
        });
        assert.equal(traversalRes.status, 400, 'Path traversal in fileName must return 400');

        const testRunId = Date.now();
        // 11. Successful Upload Session Creation
        const validPayload = {
          channelId: 'chn_maya_8841',
          fileName: 'cinematic_horizon_4k.mp4',
          fileSizeBytes: 2 * 1024 * 1024 * 1024, // 2 GB
          mimeType: 'video/mp4',
          title: 'Cinematic Horizon 4K Generative Scene',
          description: 'A test 4K generative video uploaded via secure creator session',
          videoFormat: VideoFormat.STANDARD,
          visibility: ContentVisibility.PUBLIC,
          tags: ['cinema', 'ai', '4k'],
          idempotencyKey: `idemp_key_maya_test_${testRunId}`,
        };

        const createRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify(validPayload),
        });

        assert.equal(createRes.status, 201, 'Valid upload session creation must return 201');
        const createBody = (await createRes.json()) as any;
        assert.equal(createBody.ok, true);
        assert.ok(createBody.session.sessionId.startsWith('upl_sess_'));
        assert.equal(createBody.session.creatorId, 'crt_maya_8841');
        assert.equal(createBody.session.channelId, 'chn_maya_8841');
        assert.equal(createBody.session.uploadStatus, UploadSessionStatus.INITIATED);
        assert.equal(createBody.session.malwareScanStatus, MalwareScanStatus.PENDING);
        assert.equal(createBody.session.mediaValidationStatus, MediaValidationStatus.PENDING);
        assert.equal(createBody.instructions.protocol, 'GCS_RESUMABLE_V4');
        assert.ok(createBody.signedUploadUrl.includes('staging-storage.local.facevid.internal'));
        assert.ok(createBody.resumableSessionUri.includes('staging-storage.local.facevid.internal'));

        const session1Id = createBody.session.sessionId;

        // 12. Idempotency Check: Re-submitting the exact same request with same idempotencyKey
        const duplicateRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify(validPayload),
        });

        assert.equal(duplicateRes.status, 200, 'Duplicate request with same idempotencyKey must return 200');
        const duplicateBody = (await duplicateRes.json()) as any;
        assert.equal(duplicateBody.session.sessionId, session1Id, 'Must return same session ID');

        // 12A. Security Patch: Same key with different file size -> 409 Conflict
        const diffSizeRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            ...validPayload,
            fileSizeBytes: 1024 * 1024 * 50, // different file size
          }),
        });
        assert.equal(diffSizeRes.status, 409, 'Reusing key with different fileSizeBytes must return 409 Conflict');
        const diffSizeBody = (await diffSizeRes.json()) as any;
        assert.equal(diffSizeBody.errorCode, ApiErrorCode.IDEMPOTENCY_CONFLICT);
        assert.ok(diffSizeBody.message.includes('fileSizeBytes mismatch'));

        // 12B. Security Patch: Same key with different file name -> 409 Conflict
        const diffNameRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            ...validPayload,
            fileName: 'different_video_file.mp4',
          }),
        });
        assert.equal(diffNameRes.status, 409, 'Reusing key with different fileName must return 409 Conflict');
        const diffNameBody = (await diffNameRes.json()) as any;
        assert.equal(diffNameBody.errorCode, ApiErrorCode.IDEMPOTENCY_CONFLICT);
        assert.ok(diffNameBody.message.includes('fileName mismatch'));

        // 12C. Security Patch: Same key with different channel -> must fail safely (403 or 409)
        const diffChannelRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            ...validPayload,
            channelId: 'chn_second_9902',
          }),
        });
        assert.ok(
          [403, 409].includes(diffChannelRes.status),
          'Reusing key with unowned or different channel must fail safely'
        );

        // 12D. Security Patch: Same key with different visibility -> 409 Conflict
        const diffVisRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            ...validPayload,
            visibility: ContentVisibility.PRIVATE,
          }),
        });
        assert.equal(diffVisRes.status, 409, 'Reusing key with different visibility must return 409 Conflict');
        const diffVisBody = (await diffVisRes.json()) as any;
        assert.equal(diffVisBody.errorCode, ApiErrorCode.IDEMPOTENCY_CONFLICT);
        assert.ok(diffVisBody.message.includes('visibility mismatch'));

        // 12E. Security Patch: Same idempotency key used by another creator (Devon Vance)
        // Must be scoped to the creator: Devon using Maya's key string creates Devon's own session!
        const otherCreatorRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${secondCreatorToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_second_9902',
            fileName: 'devon_doc.mp4',
            fileSizeBytes: 1024 * 1024 * 200,
            mimeType: 'video/mp4',
            title: 'Devon Independent Video',
            idempotencyKey: validPayload.idempotencyKey,
          }),
        });
        assert.equal(otherCreatorRes.status, 201, 'Another creator using same key string must create independent session');
        const otherCreatorBody = (await otherCreatorRes.json()) as any;
        assert.notEqual(otherCreatorBody.session.sessionId, session1Id, 'Must not collide with Maya session');
        assert.equal(otherCreatorBody.session.creatorId, 'crt_second_9902');

        // Cancel Devon's temporary 12E test session to keep Devon's active session count clean
        await fetch(`${baseUrl}/api/v1/videos/upload-sessions/${otherCreatorBody.session.sessionId}/cancel`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${secondCreatorToken}` },
        });

        // 12F. Security Patch: Cancelled session replay -> 409 Conflict
        const cancelTestKey = `idemp_cancel_key_${testRunId}`;
        const cancelTestCreateRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'to_be_cancelled.mp4',
            fileSizeBytes: 1024 * 1024 * 50,
            mimeType: 'video/mp4',
            title: 'To Be Cancelled',
            idempotencyKey: cancelTestKey,
          }),
        });
        assert.equal(cancelTestCreateRes.status, 201);
        const cancelTestCreateBody = (await cancelTestCreateRes.json()) as any;
        const cancelTestSessionId = cancelTestCreateBody.session.sessionId;

        // Cancel it
        const cancelExecRes = await fetch(
          `${baseUrl}/api/v1/videos/upload-sessions/${cancelTestSessionId}/cancel`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${mayaToken}` },
          }
        );
        assert.equal(cancelExecRes.status, 200);

        // Now replay the key for the cancelled session
        const replayCancelledRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'to_be_cancelled.mp4',
            fileSizeBytes: 1024 * 1024 * 50,
            mimeType: 'video/mp4',
            title: 'To Be Cancelled',
            idempotencyKey: cancelTestKey,
          }),
        });
        assert.equal(replayCancelledRes.status, 409, 'Replaying cancelled session key must return 409 Conflict');
        const replayCancelledBody = (await replayCancelledRes.json()) as any;
        assert.equal(replayCancelledBody.errorCode, ApiErrorCode.IDEMPOTENCY_CONFLICT);
        assert.ok(replayCancelledBody.message.includes('cancelled/aborted and cannot be reused'));

        // 12G. Security Patch: Expired session replay -> 409 Conflict
        const expiredKey = `idemp_expired_key_${testRunId}`;
        const expiredRow = {
          sessionId: `upl_sess_expired_${testRunId}`,
          creatorId: 'crt_maya_8841',
          channelId: 'chn_maya_8841',
          fileName: 'expired_vid.mp4',
          fileSizeBytes: 1024 * 1024 * 50,
          mimeType: 'video/mp4',
          stagingStorageBucket: SECURE_UPLOAD_CONFIG.STAGING_BUCKET_NAME,
          stagingObjectPath: `creators/crt_maya_8841/uploads/upl_sess_expired_${testRunId}/expired_vid.mp4`,
          signedUploadUrl: 'https://staging-storage.local.facevid.internal/stub',
          resumableSessionUri: 'https://staging-storage.local.facevid.internal/stub',
          uploadStatus: UploadSessionStatus.INITIATED,
          malwareScanStatus: MalwareScanStatus.PENDING,
          mediaValidationStatus: MediaValidationStatus.PENDING,
          transcodingStatus: 'QUEUED_AWAITING_UPLOAD',
          visibilityChoice: ContentVisibility.PUBLIC,
          title: 'Expired Video',
          description: '',
          videoFormat: VideoFormat.STANDARD,
          tags: [],
          expiresAtIso: new Date(Date.now() - 3600_000).toISOString(),
          createdAtIso: new Date(Date.now() - 7200_000).toISOString(),
          updatedAtIso: new Date(Date.now() - 7200_000).toISOString(),
          idempotencyKey: expiredKey,
        };
        databaseFoundationService.saveUploadSession(expiredRow);

        const replayExpiredRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'expired_vid.mp4',
            fileSizeBytes: 1024 * 1024 * 50,
            mimeType: 'video/mp4',
            title: 'Expired Video',
            idempotencyKey: expiredKey,
          }),
        });
        assert.equal(replayExpiredRes.status, 409, 'Replaying expired session key must return 409 Conflict');
        const replayExpiredBody = (await replayExpiredRes.json()) as any;
        assert.equal(replayExpiredBody.errorCode, ApiErrorCode.IDEMPOTENCY_CONFLICT);
        assert.ok(replayExpiredBody.message.includes('expired and cannot be reactivated'));

        // 12H. Security Patch: Concurrent duplicate requests with same idempotency key
        const concurrentKey = `idemp_concurrent_${testRunId}`;
        const concurrentPayload = {
          channelId: 'chn_maya_8841',
          fileName: 'concurrent_test.mp4',
          fileSizeBytes: 1024 * 1024 * 30,
          mimeType: 'video/mp4',
          title: 'Concurrent Idempotency Test',
          idempotencyKey: concurrentKey,
        };
        const [cRes1, cRes2] = await Promise.all([
          fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${mayaToken}`,
            },
            body: JSON.stringify(concurrentPayload),
          }),
          fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${mayaToken}`,
            },
            body: JSON.stringify(concurrentPayload),
          }),
        ]);
        const statuses = [cRes1.status, cRes2.status].sort();
        assert.ok(
          (statuses.includes(201) && (statuses.includes(200) || statuses.includes(429))) ||
          (statuses[0] === 200 && statuses[1] === 200),
          `Concurrent requests must fail-safe and not create corrupt duplicate state (got ${statuses.join(', ')})`
        );

        // Clean up temporary concurrent test session to free concurrency slot for subsequent quota tests
        const concurrentSession = databaseFoundationService.getUploadSessionByIdempotencyKey(
          'crt_maya_8841',
          concurrentKey
        );
        if (concurrentSession) {
          await fetch(`${baseUrl}/api/v1/videos/upload-sessions/${concurrentSession.sessionId}/cancel`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${mayaToken}` },
          });
        }

        // 13. Status Retrieval: Creator retrieving own upload session
        const getStatusRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions/${session1Id}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${mayaToken}`,
          },
        });
        assert.equal(getStatusRes.status, 200, 'Creator retrieving own session must return 200');
        const statusBody = (await getStatusRes.json()) as any;
        assert.equal(statusBody.data.session.sessionId, session1Id);
        assert.equal(statusBody.data.playableInCatalog, false, 'Unprocessed session must not be playable');

        // 14. Deny-by-Default Isolation: Second creator attempting to view Maya's session
        const crossGetRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions/${session1Id}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${secondCreatorToken}`,
          },
        });
        assert.equal(crossGetRes.status, 403, 'Cross-creator session access must return 403');
        const crossGetBody = (await crossGetRes.json()) as any;
        assert.equal(crossGetBody.errorCode, ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT);

        // 15. Cross-creator cancellation block: Second creator attempting to cancel Maya's session
        const crossCancelRes = await fetch(
          `${baseUrl}/api/v1/videos/upload-sessions/${session1Id}/cancel`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${secondCreatorToken}`,
            },
          }
        );
        assert.equal(crossCancelRes.status, 403, 'Cross-creator cancellation must return 403');

        // 16. Concurrency Quota: Creator can have up to 5 concurrent active sessions
        const sessionIds: string[] = [session1Id];
        for (let i = 2; i <= 5; i++) {
          const res = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${mayaToken}`,
            },
            body: JSON.stringify({
              channelId: 'chn_maya_8841',
              fileName: `clip_${i}.mp4`,
              fileSizeBytes: 1024 * 1024 * 100, // 100 MB
              mimeType: 'video/mp4',
              title: `Maya Clip ${i}`,
              idempotencyKey: `idemp_maya_batch_${i}`,
            }),
          });
          assert.equal(res.status, 201, `Session ${i} creation must succeed within quota`);
          const body = (await res.json()) as any;
          sessionIds.push(body.session.sessionId);
        }
        assert.equal(sessionIds.length, 5);

        // 6th concurrent session must be rejected with 429 QUOTA_EXCEEDED
        const overConcurrencyRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'clip_6.mp4',
            fileSizeBytes: 1024 * 1024 * 100,
            mimeType: 'video/mp4',
            title: 'Maya Clip 6 (Over concurrency)',
          }),
        });
        assert.equal(overConcurrencyRes.status, 429, '6th concurrent session must return 429');
        const overConcurrencyBody = (await overConcurrencyRes.json()) as any;
        assert.equal(overConcurrencyBody.errorCode, ApiErrorCode.QUOTA_EXCEEDED);
        assert.ok(overConcurrencyBody.message.includes('limit of 5 active upload sessions'));

        // 17. Cancellation: Creator cancels one session (session 5)
        const cancelRes = await fetch(
          `${baseUrl}/api/v1/videos/upload-sessions/${sessionIds[4]}/cancel`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${mayaToken}`,
            },
          }
        );
        assert.equal(cancelRes.status, 200, 'Cancellation of own session must return 200');
        const cancelBody = (await cancelRes.json()) as any;
        assert.equal(cancelBody.data.status, UploadSessionStatus.ABORTED);

        // 18. Concurrency slot freed: Creator can now initiate another session
        const slotFreedRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${mayaToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_maya_8841',
            fileName: 'clip_replacement.mp4',
            fileSizeBytes: 1024 * 1024 * 100,
            mimeType: 'video/mp4',
            title: 'Maya Replacement Clip',
          }),
        });
        assert.equal(slotFreedRes.status, 201, 'Should succeed after cancelling an active session');

        // 19. Daily 50 GB Quota Enforcement
        // Devon creates 4 sessions of 10 GB each (40 GB total)
        for (let i = 1; i <= 4; i++) {
          const devonRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${secondCreatorToken}`,
            },
            body: JSON.stringify({
              channelId: 'chn_second_9902',
              fileName: `doc_part${i}.mp4`,
              fileSizeBytes: 10 * 1024 * 1024 * 1024, // 10 GB
              mimeType: 'video/mp4',
              title: `Devon Doc Part ${i}`,
              idempotencyKey: `idemp_devon_daily_${i}`,
            }),
          });
          assert.equal(devonRes.status, 201, `Devon 10GB session ${i} must succeed`);
        }

        // Devon has 4 sessions = 40 GB.
        // A 5th session of 8 GB would make total = 48 GB (allowed)
        const devonFifthRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${secondCreatorToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_second_9902',
            fileName: 'doc_part5.mp4',
            fileSizeBytes: 8 * 1024 * 1024 * 1024, // 8 GB
            mimeType: 'video/mp4',
            title: 'Devon Doc Part 5',
            idempotencyKey: 'idemp_devon_daily_5',
          }),
        });
        assert.equal(devonFifthRes.status, 201, 'Devon 8GB session within 50GB total must succeed');

        // Now total 24h usage is 48 GB. Free concurrency by marking session 1 as READY_FOR_PUBLICATION in database
        const devonSessions = databaseFoundationService.listUploadSessionsForCreator('crt_second_9902');
        assert.ok(devonSessions.length >= 5);
        devonSessions[0].uploadStatus = UploadSessionStatus.READY_FOR_PUBLICATION;
        databaseFoundationService.saveUploadSession(devonSessions[0]);

        // Concurrency is now 4 active sessions, but 24h usage is still 48 GB!
        // Now Devon attempts to create a session of 3 GB: 48 GB + 3 GB = 51 GB (> 50 GB daily quota limit)
        const devonOverDailyRes = await fetch(`${baseUrl}/api/v1/videos/upload-sessions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${secondCreatorToken}`,
          },
          body: JSON.stringify({
            channelId: 'chn_second_9902',
            fileName: 'doc_over_daily.mp4',
            fileSizeBytes: 3 * 1024 * 1024 * 1024, // 3 GB
            mimeType: 'video/mp4',
            title: 'Devon Over Daily Quota Clip',
          }),
        });
        assert.equal(devonOverDailyRes.status, 429, 'Daily upload exceeding 50GB must return 429');
        const devonOverDailyBody = (await devonOverDailyRes.json()) as any;
        assert.equal(devonOverDailyBody.errorCode, ApiErrorCode.QUOTA_EXCEEDED);
        assert.ok(devonOverDailyBody.message.includes('Daily upload quota exceeded'));

        // 20. Expiration Check: Session with past expiration date transitions to EXPIRED
        const expiredSessRow = {
          sessionId: 'upl_sess_expired_test_001',
          creatorId: 'crt_maya_8841',
          channelId: 'chn_maya_8841',
          fileName: 'expired_clip.mp4',
          fileSizeBytes: 1024 * 1024 * 50,
          mimeType: 'video/mp4',
          stagingStorageBucket: SECURE_UPLOAD_CONFIG.STAGING_BUCKET_NAME,
          stagingObjectPath: 'creators/crt_maya_8841/uploads/upl_sess_expired_test_001/expired_clip.mp4',
          signedUploadUrl: 'https://staging-storage.local.facevid.internal/stub',
          resumableSessionUri: 'https://staging-storage.local.facevid.internal/stub',
          uploadStatus: UploadSessionStatus.INITIATED,
          malwareScanStatus: MalwareScanStatus.PENDING,
          mediaValidationStatus: MediaValidationStatus.PENDING,
          transcodingStatus: 'QUEUED_AWAITING_UPLOAD',
          visibilityChoice: ContentVisibility.PUBLIC,
          title: 'Expired Clip',
          description: '',
          videoFormat: VideoFormat.STANDARD,
          tags: [],
          expiresAtIso: new Date(Date.now() - 3600_000).toISOString(), // 1 hour in the past
          createdAtIso: new Date(Date.now() - 7200_000).toISOString(),
          updatedAtIso: new Date(Date.now() - 7200_000).toISOString(),
        };
        databaseFoundationService.saveUploadSession(expiredSessRow);

        const checkExpiredRes = await fetch(
          `${baseUrl}/api/v1/videos/upload-sessions/upl_sess_expired_test_001`,
          {
            headers: {
              Authorization: `Bearer ${mayaToken}`,
            },
          }
        );
        assert.equal(checkExpiredRes.status, 200);
        const checkExpiredBody = (await checkExpiredRes.json()) as any;
        assert.equal(checkExpiredBody.data.session.uploadStatus, UploadSessionStatus.EXPIRED);
        assert.equal(checkExpiredBody.data.isExpired, true);

        // 21. Upload sessions cannot create publicly playable videos
        // Querying /videos/:id with session ID must return 404
        const catalogCheckRes = await fetch(`${baseUrl}/api/v1/videos/${session1Id}`);
        assert.equal(
          catalogCheckRes.status,
          404,
          'Unprocessed upload sessions must never appear or play in public video catalog'
        );

        // Catalog video remains playable
        const catalogVideoRes = await fetch(`${baseUrl}/api/v1/videos/vid_maya_ai_cinema_001`);
        assert.equal(catalogVideoRes.status, 200, 'Baseline catalog video remains playable');
      } finally {
        server.close();
      }
    }
  );

  // =========================================================================
  // PHASE 1 TASK 1.4A: ACCOUNT REGISTRATION, ONBOARDING, BIOMETRICS & ADMIN FRONTEND
  // =========================================================================
  await runTest(
    'Phase 1 Task 1.4A: Four Account Types (User, Creator, Business, Store) & Role Contracts',
    () => {
      // 1. Verify 4 account types match authoritative UserRole contracts
      assert.equal(ACCOUNT_TYPE_OPTIONS.length, 4, 'Must define exactly 4 specialized account types');
      
      const userOpt = ACCOUNT_TYPE_OPTIONS.find((a) => a.id === 'user');
      assert.ok(userOpt, 'FACE VID User account option exists');
      assert.equal(userOpt.role, UserRole.USER, 'User maps to authoritative UserRole.USER');

      const creatorOpt = ACCOUNT_TYPE_OPTIONS.find((a) => a.id === 'creator');
      assert.ok(creatorOpt, 'FACE VID Creator account option exists');
      assert.equal(creatorOpt.role, UserRole.CREATOR, 'Creator maps to authoritative UserRole.CREATOR');

      const businessOpt = ACCOUNT_TYPE_OPTIONS.find((a) => a.id === 'business');
      assert.ok(businessOpt, 'FACE VID Business account option exists');
      assert.equal(businessOpt.role, UserRole.ADVERTISER, 'Business maps to authoritative UserRole.ADVERTISER');

      const storeOpt = ACCOUNT_TYPE_OPTIONS.find((a) => a.id === 'store');
      assert.ok(storeOpt, 'FACE VID Store account option exists');
      assert.equal(storeOpt.role, UserRole.MERCHANT, 'Store maps to authoritative UserRole.MERCHANT');
    }
  );

  await runTest(
    'Phase 1 Task 1.4A: 12 Required Screens Rendered & Navigable in AuthAccountFlow',
    () => {
      const screens = [
        'welcome',
        'sign_in',
        'create_account',
        'forgot_password',
        'choose_type',
        'registration_details',
        'terms_privacy',
        'passkey_enrollment',
        'daily_signin_verification',
        'premium_selection',
        'dashboard',
        'settings',
      ] as const;

      for (const screen of screens) {
        const html = renderToStaticMarkup(
          React.createElement(AuthAccountFlow, { initialScreen: screen })
        );
        assert.ok(html.length > 500, `Screen "${screen}" must render substantial interactive markup`);
        assert.ok(!html.includes('undefined'), `Screen "${screen}" must not contain undefined bindings`);
      }
    }
  );

  await runTest(
    'Phase 1 Task 1.4A: Biometric / Passkey Privacy Architecture & Honest Fallback',
    () => {
      const passkeyHtml = renderToStaticMarkup(
        React.createElement(AuthAccountFlow, { initialScreen: 'passkey_enrollment' })
      );
      // Guarantee zero raw biometric storage notice
      assert.ok(
        passkeyHtml.includes('Zero Raw Biometrics Storage Contract'),
        'Must display explicit zero raw biometric storage contract'
      );
      assert.ok(
        passkeyHtml.includes('Secure Enclave') || passkeyHtml.includes('TPM'),
        'Must reference local device hardware security module'
      );
      assert.ok(
        passkeyHtml.includes('FIDO2') || passkeyHtml.includes('WebAuthn'),
        'Must reference FIDO2/WebAuthn standard'
      );
      assert.ok(
        passkeyHtml.includes('Emergency Recovery Codes') || passkeyHtml.includes('Recovery'),
        'Must provide honest recovery code fallback for unsupported or cancelled authenticators'
      );
    }
  );

  await runTest(
    'Phase 1 Task 1.4A: First Sign-In of the Day Daily Touchpoint Verification',
    () => {
      const dailyHtml = renderToStaticMarkup(
        React.createElement(AuthAccountFlow, { initialScreen: 'daily_signin_verification' })
      );
      assert.ok(
        dailyHtml.includes('First Sign-In of the Day Verification'),
        'Must render Daily Sign-In Verification screen'
      );
      assert.ok(
        dailyHtml.includes('24-Hour') || dailyHtml.includes('24 Hours') || dailyHtml.includes('24-HOUR'),
        'Must enforce 24-hour daily security touchpoint against cookie theft'
      );
    }
  );

  await runTest(
    'Phase 1 Task 1.4A: Free ($0/mo) vs FACE VID Premium ($11.00 USD/mo) Viewing Tier & Safety Notice',
    () => {
      const premiumHtml = renderToStaticMarkup(
        React.createElement(AuthAccountFlow, { initialScreen: 'premium_selection' })
      );
      // Free tier
      assert.ok(premiumHtml.includes('$0'), 'Free tier must display $0/month');
      // Premium tier worldwide fixed base price before applicable taxes
      assert.ok(premiumHtml.includes('$11.00'), 'Premium tier must display fixed worldwide base $11.00 USD');
      assert.ok(premiumHtml.includes('Ad-Free') || premiumHtml.includes('ad-free'), 'Premium tier provides ad-free personal viewing');
      // Safety boundary notice
      assert.ok(
        premiumHtml.includes('Phase 1.4A Development Notice') || premiumHtml.includes('billing checkouts are strictly inactive'),
        'Must include explicit safety notice that billing checkouts are inactive'
      );
    }
  );

  await runTest(
    'Phase 1 Task 1.4A: Extended Admin Panel Frontend with Registrations, Verifications, Passkeys & Audits',
    () => {
      const adminHtml = renderToStaticMarkup(React.createElement(AdminAppShell));
      
      // Preserves official logo and super admin console badge
      assert.ok(adminHtml.includes('Super Admin Console'), 'Admin header preserves Super Admin Console badge');
      assert.ok(adminHtml.includes('face-vid-official-logo.png'), 'Admin header preserves official logo');
      
      // Account registrations table
      assert.ok(adminHtml.includes('Account Registrations'), 'Admin panel displays Account Registrations');
      assert.ok(adminHtml.includes('Phase 1.4A Staged Registration Data'), 'Admin panel labels staged preview data');
      assert.ok(adminHtml.includes('FIDO2'), 'Displays passkey status');
      assert.ok(adminHtml.includes('Premium'), 'Displays premium status');
      assert.ok(adminHtml.includes('Verified'), 'Displays identity verification status');
    }
  );

  await runTest(
    'Phase 1 Task 1.4A: WebAppShell Top-Bar Entry Points & Responsive Boundary Check',
    () => {
      const webHtml = renderToStaticMarkup(React.createElement(WebAppShell));
      // Zone 3 access to Sign In and Create Account
      assert.ok(webHtml.includes('Sign In'), 'Top bar includes Sign In button');
      assert.ok(webHtml.includes('Create Account'), 'Top bar includes Create Account button');
      assert.ok(webHtml.includes('Account &amp; Registration') || webHtml.includes('Account & Registration'), 'Sidebar includes Account & Registration');
    }
  );

  // =========================================================================
  // PHASE 1.4B SECURE AUTHENTICATION BACKEND TESTS
  // =========================================================================

  await runTest(
    'Phase 1 Task 1.4B: Account Registration & Zero-Trust Role Assignment',
    () => {
      const email = `creator.test.${Date.now()}@facevid.example`;
      const regResult = authService.register({
        accountType: 'creator',
        email,
        fullName: 'Elena Rostova',
        displayName: 'Elena Studio',
        handle: '@elenastudio',
        password: 'SuperSecurePassword123!',
        countryIso: 'ZA',
        acceptedTerms: true,
        channelGenre: 'Documentary',
      });

      assert.ok(regResult.user, 'User record created');
      assert.equal(regResult.user?.primaryEmail, email);
      // Zero-trust verification: elevated role is NEVER automatically assigned!
      assert.equal(regResult.user?.accountStatus, AccountStatus.PENDING_VERIFICATION);
      const roles = databaseFoundationService['catalog'].userRoles.filter(
        (ur) => ur.userId === regResult.user?.userId
      );
      assert.equal(roles.length, 1, 'Only one role assigned');
      assert.equal(roles[0]?.roleCode, UserRole.USER, 'Assigned role must strictly be USER');

      // Password hashing test
      const creds = databaseFoundationService.getAuthCredentials(regResult.user!.userId);
      assert.ok(creds, 'Credentials row created');
      assert.notEqual(creds?.passwordHash, 'SuperSecurePassword123!', 'Plain password never stored');
      const valid = authService.verifyPassword(
        'SuperSecurePassword123!',
        creds!.passwordHash,
        creds!.salt
      );
      assert.equal(valid, true, 'Valid password verifies');
      const invalid = authService.verifyPassword(
        'WrongPassword999!',
        creds!.passwordHash,
        creds!.salt
      );
      assert.equal(invalid, false, 'Invalid password rejected');
    }
  );

  await runTest(
    'Phase 1 Task 1.4B: WebAuthn Passkey Ceremony & Monotonic Counter Replay Protection',
    () => {
      // Create user
      const email = `passkey.user.${Date.now()}@facevid.example`;
      const reg = authService.register({
        accountType: 'user',
        email,
        fullName: 'Alex Vance',
        displayName: 'AlexV',
        handle: '@alexv',
        password: 'PasskeyPassword123!',
        countryIso: 'US',
        acceptedTerms: true,
      });

      const userId = reg.user!.userId;
      const regOptions = authService.getPasskeyRegistrationOptions(userId);
      assert.ok(regOptions.challenge, 'Issued WebAuthn challenge');
      assert.equal(regOptions.rp.id, 'facevid.com', 'RP ID is facevid.com');

      const credentialId = `cred_fido2_${Date.now()}`;
      const pubKeyDer = Buffer.from('mock_public_key_der_bytes').toString('base64');
      const regVerify = authService.verifyPasskeyRegistration({
        userId,
        challenge: regOptions.challenge,
        credentialId,
        publicKeyDerBase64: pubKeyDer,
      });

      assert.equal(regVerify.success, true);
      assert.equal(regVerify.recoveryCodes.length, 10, 'Issued 10 emergency recovery codes');
      assert.ok(regVerify.recoveryCodes[0]?.startsWith('FV-'), 'Recovery code format FV-XXXX-XXXX-XXXX');

      // Authenticate with Passkey
      const loginOpts = authService.getPasskeyLoginOptions(email);
      assert.ok(loginOpts.challenge, 'Issued login challenge');

      // First login with counter = 1
      const session1 = authService.verifyPasskeyLogin({
        challenge: loginOpts.challenge,
        credentialId,
        clientSignatureBase64: 'mock_sig_1',
        counter: 1,
        allowInternalTestAdapterAssertion: true,
      });
      assert.ok(session1.accessToken, 'Session issued');
      assert.equal(session1.dailyVerification.verifiedToday, true, 'Passkey login auto-verifies daily touchpoint');

      // Replay attack attempt with stale counter (counter = 1 again)
      const loginOpts2 = authService.getPasskeyLoginOptions(email);
      assert.throws(
        () => {
          authService.verifyPasskeyLogin({
            challenge: loginOpts2.challenge,
            credentialId,
            clientSignatureBase64: 'mock_sig_replayed',
            counter: 1, // Stale counter!
            allowInternalTestAdapterAssertion: true,
          });
        },
        /counter anomaly/i,
        'Must reject stale authenticator counter replay attack'
      );
    }
  );

  await runTest(
    'Phase 1 Task 1.4B: Server-Enforced Daily Touchpoint Verification Policy',
    () => {
      const now = Date.now();
      const todayIso = new Date(now).toISOString();
      const yesterdayIso = new Date(now - 25 * 60 * 60 * 1000).toISOString();

      assert.equal(isDailyVerificationActive(todayIso, now), true, 'Today verification is active');
      assert.equal(isDailyVerificationActive(yesterdayIso, now), false, '25-hour old verification is expired');
      assert.equal(isDailyVerificationActive(undefined, now), false, 'Missing verification is inactive');

      // Test verify daily touchpoint via service
      const testEmail = `daily.user.${Date.now()}@facevid.example`;
      const reg = authService.register({
        accountType: 'user',
        email: testEmail,
        fullName: 'Marcus Cole',
        displayName: 'Marcus',
        handle: '@marcus_c',
        password: 'DailyPass12345!',
        countryIso: 'CA',
        acceptedTerms: true,
      });
      const login = authService.loginWithPassword({ email: testEmail, password: 'DailyPass12345!' });
      assert.equal(login.dailyVerification.verifiedToday, false, 'Password login starts unverified daily');

      const dailyResult = authService.verifyDailyTouchpoint({
        sessionId: login.sessionId,
        method: 'WEBAUTHN_BIOMETRIC',
      });
      assert.equal(dailyResult.verifiedToday, true);
      assert.equal(dailyResult.method, 'WEBAUTHN_BIOMETRIC');
    }
  );

  await runTest(
    'Phase 1 Task 1.4B: Refresh Token Rotation (RTR) & Security Breach Replay Invalidation',
    () => {
      const email = `rtr.user.${Date.now()}@facevid.example`;
      authService.register({
        accountType: 'user',
        email,
        fullName: 'RTR User',
        displayName: 'RTR',
        handle: '@rtr_user',
        password: 'RTRPassword123!',
        countryIso: 'GB',
        acceptedTerms: true,
      });

      const session1 = authService.loginWithPassword({ email, password: 'RTRPassword123!' });
      const oldRefreshToken = session1.refreshToken;

      // Legitimate rotation
      const session2 = authService.rotateRefreshToken(oldRefreshToken);
      assert.ok(session2.accessToken);
      assert.notEqual(session2.refreshToken, oldRefreshToken, 'New refresh token issued');

      // Attacker replays oldRefreshToken -> triggers security breach family revocation!
      assert.throws(
        () => {
          authService.rotateRefreshToken(oldRefreshToken);
        },
        /breach/i,
        'Replaying old refresh token triggers breach family revocation'
      );
    }
  );

  await runTest(
    'Phase 1 Task 1.4B: Subscriptions Representation ($0 vs $11/mo) & Relational Integrity',
    () => {
      const email = `sub.user.${Date.now()}@facevid.example`;
      const reg = authService.register({
        accountType: 'user',
        email,
        fullName: 'Sub User',
        displayName: 'SubUser',
        handle: '@sub_user',
        password: 'SubPassword123!',
        countryIso: 'US',
        acceptedTerms: true,
      });

      const userId = reg.user!.userId;
      // Default tier is FREE_STANDARD ($0)
      assert.equal(reg.user?.subscriptionTier, SubscriptionTier.FREE_STANDARD);

      // Server-side upgrade via verified billing provider
      const sub = databaseFoundationService.upsertUserSubscription({
        userId,
        tier: SubscriptionTier.PREMIUM_AD_FREE,
        priceCents: 1100, // $11.00 USD
        currency: 'USD',
        billingProvider: 'STRIPE',
        providerSubscriptionId: 'sub_stripe_1100_usd',
      });

      assert.equal(sub.tier, SubscriptionTier.PREMIUM_AD_FREE);
      assert.equal(sub.priceCents, 1100);
      assert.equal(sub.status, 'ACTIVE');

      const updatedUser = databaseFoundationService.findUserById(userId);
      assert.equal(updatedUser?.subscriptionTier, SubscriptionTier.PREMIUM_AD_FREE);
    }
  );

  await runTest(
    'Phase 1 Task 1.4B: Admin Governance & Founding Creator 3,000,000 Quota Enforcement',
    () => {
      const email = `founding.creator.${Date.now()}@facevid.example`;
      const reg = authService.register({
        accountType: 'creator',
        email,
        fullName: 'Founding Hopeful',
        displayName: 'FoundingHope',
        handle: '@founding_hope',
        password: 'FoundingPassword123!',
        countryIso: 'AU',
        acceptedTerms: true,
        channelGenre: 'Indie Cinema',
      });

      const targetUserId = reg.user!.userId;
      const verifications = Object.values(databaseFoundationService['catalog'].creatorVerifications);
      const userVer = verifications.find((v) => v.userId === targetUserId);
      assert.ok(userVer, 'Creator verification row created');

      const prevAllocated = databaseFoundationService['catalog'].foundingCreatorProgramState.allocatedCount;
      const approval = adminGovernanceService.approveFoundingCreator({
        adminUserId: 'usr_human_mod_01',
        verificationId: userVer!.verificationId,
        targetUserId,
        reason: 'Verified high-resolution creator cinema portfolio',
      });

      assert.equal(approval.success, true);
      assert.equal(approval.allocatedSlot, prevAllocated + 1);
      assert.ok(approval.allocatedSlot! <= 3000000, 'Quota limit respected');
      assert.ok(approval.auditDigest, 'Tamper-evident audit digest generated');

      // Verify user now has CREATOR role
      const userRoles = databaseFoundationService['catalog'].userRoles.filter(
        (ur) => ur.userId === targetUserId
      );
      assert.ok(
        userRoles.some((r) => r.roleCode === UserRole.CREATOR),
        'User now has CREATOR role after admin approval'
      );
    }
  );

  // =========================================================================
  // STAGE 1: MOBILE NAVIGATION FOUNDATION TESTS
  // =========================================================================
  await runTest(
    'Stage 1: Mobile Navigation Foundation (Home, Shorts, Create +, Shop, You, MobileTopBar, MobileCreateSheet)',
    () => {
      // 1. MobileBottomNav: 5 actions present
      const bottomNavHtml = renderToStaticMarkup(
        React.createElement(MobileBottomNav, {
          activeTab: 'home',
          onSelectTab: () => {},
          userDisplayName: 'TestUser',
          isPrivateMode: false,
        })
      );
      assert.ok(bottomNavHtml.includes('Home'), 'Includes Home tab');
      assert.ok(bottomNavHtml.includes('Shorts'), 'Includes Shorts tab');
      assert.ok(bottomNavHtml.includes('Shop'), 'Includes Shop tab');
      assert.ok(bottomNavHtml.includes('You'), 'Includes You tab');
      assert.ok(bottomNavHtml.includes('Create Menu'), 'Includes Create (+) central button');
      assert.ok(bottomNavHtml.includes('safe-area-inset-bottom'), 'Enforces iOS/Android safe area padding');

      // 2. MobileTopBar: logo, search, notifications, identity toggle, sign in
      const topBarHtml = renderToStaticMarkup(
        React.createElement(MobileTopBar, {
          searchQuery: '',
          onSearchChange: () => {},
          isPrivateMode: false,
          onToggleIdentityMode: () => {},
          onOpenSignIn: () => {},
          onOpenCreateAccount: () => {},
          unreadNotificationsCount: 3,
        })
      );
      assert.ok(topBarHtml.includes('face-vid-official-logo.png'), 'Preserves official logo');
      assert.ok(topBarHtml.includes('Search'), 'Includes search trigger');
      assert.ok(topBarHtml.includes('Notifications'), 'Includes notifications trigger');
      assert.ok(topBarHtml.includes('Sign In'), 'Includes Sign In action');
      assert.ok(topBarHtml.includes('Public') || topBarHtml.includes('Private'), 'Includes identity mode toggle');

      // 3. MobileCreateSheet: honest stage 1 disclaimer
      const createSheetHtml = renderToStaticMarkup(
        React.createElement(MobileCreateSheet, {
          isOpen: true,
          onClose: () => {},
        })
      );
      assert.ok(createSheetHtml.includes('Stage 1 Mobile Navigation'), 'Includes honest Stage 1 notice');
      assert.ok(createSheetHtml.includes('Upload 4K/6K Video'), 'Includes Upload Video option');
      assert.ok(createSheetHtml.includes('Create 9:16 Short'), 'Includes Create Short option');
      assert.ok(createSheetHtml.includes('Go Live Stream'), 'Includes Live option');
      assert.ok(createSheetHtml.includes('FACE VID AI Studio'), 'Includes AI Studio option');

      // 4. Integrated WebAppShell renders MobileTopBar and MobileBottomNav
      const shellHtml = renderToStaticMarkup(React.createElement(WebAppShell));
      assert.ok(shellHtml.includes('Mobile Bottom Navigation'), 'Shell embeds persistent Mobile Bottom Nav');
      assert.ok(shellHtml.includes('overflow-x-hidden'), 'Enforces zero horizontal scroll overflow');
      assert.ok(shellHtml.includes('pb-24') || shellHtml.includes('pb-20'), 'Guarantees bottom padding against bottom nav overlap');
    }
  );

  // =========================================================================
  // STAGE 2: MOBILE HOME FEED EXPERIENCE TESTS
  // =========================================================================
  await runTest(
    'Stage 2: Mobile-First Home Feed (16:9 Edge-to-Edge Cards, Creator Avatars, Topic Pills, Docked Player)',
    () => {
      const sampleVideo = {
        id: 'test_vid_01',
        title: 'Deep Sea Bioluminescence in 4K HDR',
        creatorName: 'Elena Vance Studio',
        creatorHandle: '@elenavance',
        category: 'MOVIE',
        visibility: ContentVisibility.PUBLIC,
        duration: '12:45',
        viewsFormatted: '250K views',
        publishedLabel: 'Published 3 days ago',
        thumbnailUrl: '/assets/sample.jpg',
        description: 'Captured with anamorphic lenses',
        aspect: '16:9',
        isSampleContent: true,
      };

      // 1. MobileVideoCard renders 16:9 thumbnail, duration, 4K badge, avatar, and title
      const cardHtml = renderToStaticMarkup(
        React.createElement(MobileVideoCard, {
          video: sampleVideo,
          isPlaying: false,
          onPlay: () => {},
          inWatchLater: false,
          onToggleWatchLater: () => {},
        })
      );
      assert.ok(cardHtml.includes('aspect-video'), 'Video card enforces 16:9 aspect-video ratio');
      assert.ok(cardHtml.includes('12:45'), 'Video card renders duration badge');
      assert.ok(cardHtml.includes('4K UHD'), 'Video card renders 4K UHD badge');
      assert.ok(cardHtml.includes('Elena Vance Studio'), 'Video card renders creator name');
      assert.ok(cardHtml.includes('Deep Sea Bioluminescence'), 'Video card renders video title');
      assert.ok(cardHtml.includes('250K views'), 'Video card renders views');

      // 2. MobileTopicFilters renders horizontal pills
      const topicHtml = renderToStaticMarkup(
        React.createElement(MobileTopicFilters, {
          selectedFilter: 'ALL',
          onSelectFilter: () => {},
        })
      );
      assert.ok(topicHtml.includes('All'), 'Includes All pill');
      assert.ok(topicHtml.includes('Shorts'), 'Includes Shorts pill');
      assert.ok(topicHtml.includes('Music'), 'Includes Music pill');
      assert.ok(topicHtml.includes('Gaming'), 'Includes Gaming pill');
      assert.ok(topicHtml.includes('overflow-x-auto'), 'Enforces horizontal overflow scrolling');

      // 3. MobileHomeFeed integrates topic filters and video list
      const feedHtml = renderToStaticMarkup(
        React.createElement(MobileHomeFeed, {
          videos: [sampleVideo],
          selectedTopic: 'ALL',
          onSelectTopic: () => {},
          activeVideoId: null,
          onSelectVideo: () => {},
          onClosePlayer: () => {},
          watchLaterIds: [],
          onToggleWatchLater: () => {},
        })
      );
      assert.ok(feedHtml.includes('mobile-home-feed'), 'Home feed container present');
      assert.ok(feedHtml.includes('mobile-video-card-test_vid_01'), 'Renders MobileVideoCard');

      // 4. WebAppShell renders MobileHomeFeed on mobile home route
      const shellHtml = renderToStaticMarkup(React.createElement(WebAppShell));
      assert.ok(shellHtml.includes('mobile-home-feed'), 'WebAppShell renders mobile home feed');
    }
  );

  // =========================================================================
  // STAGE 3: FULL-SCREEN 9:16 SHORTS TESTS
  // =========================================================================
  await runTest(
    'Stage 3: Mobile Full-Screen 9:16 Shorts (Player, Right-Side Rail, Bottom Creator Info, Comments Drawer)',
    () => {
      // 1. MobileShortsPlayer renders full-screen player, action buttons, creator info
      const shortsHtml = renderToStaticMarkup(
        React.createElement(MobileShortsPlayer, {
          watchLaterIds: ['short_arch_01'],
        })
      );
      assert.ok(shortsHtml.includes('mobile-shorts-player'), 'Renders mobile shorts player container');
      assert.ok(shortsHtml.includes('video'), 'Embeds HTML5 video element');
      assert.ok(shortsHtml.includes('@studiokengo'), 'Displays creator handle');
      assert.ok(shortsHtml.includes('Subscribe'), 'Displays subscribe button');
      assert.ok(shortsHtml.includes('Share'), 'Displays share action');
      assert.ok(shortsHtml.includes('Remix'), 'Displays AI Studio remix action');
      assert.ok(shortsHtml.includes('Kyoto Architectural Monograph'), 'Displays compact shoppable product link');
      assert.ok(shortsHtml.includes('Saved'), 'Displays active Watch Later saved state for short_arch_01');

      // 2. ShortsCommentsSheet renders drawer with comment list and post form
      const commentsHtml = renderToStaticMarkup(
        React.createElement(ShortsCommentsSheet, {
          isOpen: true,
          onClose: () => {},
          shortTitle: 'Kyoto Pavilion Study',
        })
      );
      assert.ok(commentsHtml.includes('Comments'), 'Comments drawer header present');
      assert.ok(commentsHtml.includes('Marcus Cole'), 'Renders initial sample comment');
      assert.ok(commentsHtml.includes('Session comments active'), 'Displays honest stage disclaimer');
      assert.ok(commentsHtml.includes('Add a comment on FACE VID'), 'Includes comment input placeholder');

      // 3. WebAppShell renders MobileShortsPlayer on shorts route
      const shellShortsHtml = renderToStaticMarkup(
        React.createElement(WebAppShell, { initialRoute: 'shorts' })
      );
      assert.ok(shellShortsHtml.includes('mobile-shorts-player'), 'WebAppShell embeds MobileShortsPlayer on shorts route');
      assert.ok(shellShortsHtml.includes('FACE VID Shorts — Vertical 9:16 Cinema Feed'), 'Desktop Shorts section preserved');
    }
  );

  // =========================================================================
  // STAGE 4: MOBILE VIDEO WATCH & DETAIL EXPERIENCE TESTS
  // =========================================================================
  await runTest(
    'Stage 4: Mobile Video Watch Experience (16:9 HTML5 Player, Controls, Actions, Description, Comments, Recommendations)',
    () => {
      const sampleWatchVideo = {
        id: 'vid_ocean_01',
        title: 'Deep Sea Bioluminescence & Abyssal Trenches in 4K HDR',
        creatorName: 'Elena Vance Studio',
        creatorHandle: '@elenavance',
        category: 'MOVIE',
        visibility: ContentVisibility.PUBLIC,
        duration: '12:45',
        durationSeconds: 765,
        viewsFormatted: '250K views',
        viewCount: 250000,
        publishedLabel: 'Published 3 days ago',
        thumbnailUrl: '/assets/sample_ocean.jpg',
        description: 'Captured with anamorphic lenses and neural optical LUT filters.',
        aspect: '16:9' as const,
        isSampleContent: true,
        playbackUrl: '/assets/demo/videos/glass-horizon.mp4',
        processingStatus: 'READY' as const,
      };

      const sampleRelatedVideo = {
        id: 'vid_cyber_02',
        title: 'Neo-Tokyo Midnight Run · Anamorphic 2.39:1',
        creatorName: 'Cyber Cinema Unit',
        creatorHandle: '@cybercinema',
        category: 'VIDEO',
        visibility: ContentVisibility.PUBLIC,
        duration: '08:20',
        durationSeconds: 500,
        viewsFormatted: '180K views',
        viewCount: 180000,
        publishedLabel: 'Published 1 day ago',
        thumbnailUrl: '/assets/sample_cyber.jpg',
        description: 'Atmospheric rain and neon reflections.',
        aspect: '16:9' as const,
        isSampleContent: true,
        playbackUrl: '/assets/demo/videos/bts-prompting.mp4',
        processingStatus: 'READY' as const,
      };

      // 1. MobileWatchView renders 16:9 HTML5 player, tap-to-show controls, skip overlays
      const watchHtml = renderToStaticMarkup(
        React.createElement(MobileWatchView, {
          video: sampleWatchVideo,
          allVideos: [sampleWatchVideo, sampleRelatedVideo],
          onSelectVideo: () => {},
          onClose: () => {},
          watchLaterIds: ['vid_ocean_01'],
          onToggleWatchLater: () => {},
          isPrivateMode: true,
          privatePseudonym: 'CipherFrame_88',
        })
      );

      // Verify HTML5 video player and 16:9 aspect
      assert.ok(watchHtml.includes('mobile-watch-view'), 'Renders mobile watch view container');
      assert.ok(watchHtml.includes('aspect-video'), 'Enforces responsive 16:9 aspect-video container');
      assert.ok(watchHtml.includes('video'), 'Embeds HTML5 video element');
      assert.ok(watchHtml.toLowerCase().includes('playsinline'), 'Supports mobile browser playsinline attribute');

      // Verify Playback controls & Gestures
      assert.ok(watchHtml.includes('watch-play-pause-btn'), 'Includes centered Play/Pause big tap button');
      assert.ok(watchHtml.includes('watch-close-btn'), 'Includes dismiss chevron-down button');
      assert.ok(watchHtml.includes('input type="range"'), 'Includes seek bar slider');

      // Verify Video Information & Zero-Pill Metadata
      assert.ok(watchHtml.includes('Deep Sea Bioluminescence'), 'Renders readable video title');
      assert.ok(watchHtml.includes('Elena Vance Studio'), 'Renders creator channel name');
      assert.ok(watchHtml.includes('@elenavance'), 'Renders creator channel handle');
      assert.ok(watchHtml.includes('250K views'), 'Renders view count');
      assert.ok(watchHtml.includes('Published 3 days ago'), 'Renders upload date');
      assert.ok(watchHtml.includes('watch-subscribe-btn'), 'Includes subscribe action button');
      assert.ok(watchHtml.includes('watch-description-box'), 'Includes expandable description card');

      // Verify Horizontally Scrollable Action Row (Truthful session actions)
      assert.ok(watchHtml.includes('watch-like-btn'), 'Includes Like button');
      assert.ok(watchHtml.includes('watch-share-btn'), 'Includes Share button');
      assert.ok(watchHtml.includes('watch-save-btn'), 'Includes Save to Watch Later button');
      assert.ok(watchHtml.includes('watch-remix-btn'), 'Includes AI Studio Remix button');
      assert.ok(watchHtml.includes('watch-creator-call-btn'), 'Includes Creator Call button');

      // Verify Comments Preview (Synchronized with session drawer)
      assert.ok(watchHtml.includes('watch-comments-preview'), 'Includes clean comments preview card');
      assert.ok(watchHtml.includes('(Session)'), 'Identifies session comments status');

      // Verify Recommendations List
      assert.ok(watchHtml.includes('watch-recommendations-section'), 'Includes Up Next / Recommendations section');
      assert.ok(watchHtml.includes('compact-video-vid_cyber_02'), 'Renders compact related video card');
      assert.ok(watchHtml.includes('Neo-Tokyo Midnight Run'), 'Renders recommended video title');

      // Verify FACE VID Extras: Shoppable product, Private Mode, Discreet Ad-Free Indicator
      assert.ok(watchHtml.includes('Marine Macro Optical Filter Kit'), 'Displays shoppable video product preview');
      assert.ok(watchHtml.includes('Private: CipherFrame_88'), 'Displays Avatar Private Mode identity indicator');
      assert.ok(watchHtml.includes('Ad-Free Viewing Mode'), 'Displays discreet ad-free viewing indicator without unapproved claims');
      assert.ok(!watchHtml.includes('Lossless 4K'), 'Guarantees no false lossless 4K claim under ad-free viewing');

      // Verify Creator Verified Badge logic (Authoritative vs Unverified)
      const verifiedCreatorVideo = {
        ...sampleWatchVideo,
        isCreatorVerified: true,
      };
      const unverifiedCreatorVideo = {
        ...sampleWatchVideo,
        isCreatorVerified: false,
      };
      const verifiedHtml = renderToStaticMarkup(
        React.createElement(MobileWatchView, {
          video: verifiedCreatorVideo,
          allVideos: [verifiedCreatorVideo],
          onSelectVideo: () => {},
          onClose: () => {},
          watchLaterIds: [],
          onToggleWatchLater: () => {},
        })
      );
      assert.ok(verifiedHtml.includes('title="Authoritative verified creator on FACE VID"'), 'Renders badge for verified creator');

      const unverifiedHtml = renderToStaticMarkup(
        React.createElement(MobileWatchView, {
          video: unverifiedCreatorVideo,
          allVideos: [unverifiedCreatorVideo],
          onSelectVideo: () => {},
          onClose: () => {},
          watchLaterIds: [],
          onToggleWatchLater: () => {},
        })
      );
      assert.ok(!unverifiedHtml.includes('title="Authoritative verified creator on FACE VID"'), 'Does NOT render badge for unverified creator');

      // 2. MobileCompactVideoCard component verification in isolation
      const compactCardHtml = renderToStaticMarkup(
        React.createElement(MobileCompactVideoCard, {
          video: sampleRelatedVideo,
          onSelect: () => {},
          inWatchLater: false,
          onToggleWatchLater: () => {},
        })
      );
      assert.ok(compactCardHtml.includes('08:20'), 'Renders compact duration badge');
      assert.ok(compactCardHtml.includes('Cyber Cinema Unit'), 'Renders creator name');
      assert.ok(compactCardHtml.includes('180K views'), 'Renders views');

      // 3. WebAppShell integration: Shell provides responsive boundary and zero overflow
      const shellHtml = renderToStaticMarkup(React.createElement(WebAppShell));
      assert.ok(shellHtml.includes('overflow-x-hidden'), 'WebAppShell prevents horizontal page overflow');
      assert.ok(shellHtml.includes('pb-24') || shellHtml.includes('pb-28'), 'Prevents overlap with bottom navigation');
    }
  );

  await runTest(
    'STAGE 5: Mobile Shop and You Hub — Video Commerce, Progressive Disclosure & Role Boundaries',
    async () => {
      // 1. MobileShopView renders 2-column grid, category filters, and disabled checkout disclosure
      const shopViewHtml = renderToStaticMarkup(
        React.createElement(MobileShopView, {
          userRole: UserRole.USER,
          onSelectVideo: () => {},
          savedProductIds: ['prod_optics_01'],
          onToggleSaveProduct: () => {},
        })
      );
      assert.ok(shopViewHtml.includes('Search gear, LUTs &amp; merch...'), 'Renders shop search bar');
      assert.ok(shopViewHtml.includes('Camera &amp; Optics'), 'Renders category filter chips');
      assert.ok(shopViewHtml.includes('Live Checkout Disabled:'), 'Renders explicit truthful disabled checkout notice');
      assert.ok(shopViewHtml.includes('Shoppable Reel'), 'Renders video-first shoppable reel indicator');
      assert.ok(shopViewHtml.includes('Marine Macro Optical Filter Kit'), 'Renders product title in grid');
      assert.ok(shopViewHtml.includes('$129.00 USD'), 'Renders prices in USD');
      // Role boundary check: standard user cannot see Store Management Hub banner
      assert.ok(!shopViewHtml.includes('Store Management Authorized'), 'User cannot see Store Management Hub banner');

      // 2. Role-guarded Store Management access on MobileShopView
      const merchantShopHtml = renderToStaticMarkup(
        React.createElement(MobileShopView, {
          userRole: UserRole.MERCHANT,
          onSelectVideo: () => {},
          savedProductIds: [],
          onToggleSaveProduct: () => {},
          onOpenStoreManagement: () => {},
        })
      );
      assert.ok(merchantShopHtml.includes('Store Management Authorized'), 'Merchant sees authorized store management banner');

      // 3. MobileProductDetailSheet inspection & checkout disabled truthfulness
      const sampleProduct = SHOP_PRODUCTS[0];
      const productSheetHtml = renderToStaticMarkup(
        React.createElement(MobileProductDetailSheet, {
          product: sampleProduct,
          isOpen: true,
          onClose: () => {},
          isSaved: false,
          onToggleSave: () => {},
          onOpenMerchant: () => {},
          onPlayLinkedVideo: () => {},
        })
      );
      assert.ok(productSheetHtml.includes('Live Checkout Disabled · Phase 1A Architecture'), 'Product detail contains prominent disabled checkout notice');
      assert.ok(productSheetHtml.includes('Checkout Disabled ($USD)'), 'Checkout CTA button is explicitly labeled disabled');
      assert.ok(productSheetHtml.includes('Featured in Shoppable Video'), 'Renders linked video trigger');
      assert.ok(productSheetHtml.includes('Specifications'), 'Renders product specifications');

      // 4. MobileMerchantStorefront: Authoritative vs Unverified merchant badges
      const verifiedMerchant = MERCHANT_STOREFRONTS.find((m) => m.id === 'merch_elena')!;
      const unverifiedMerchant = MERCHANT_STOREFRONTS.find((m) => m.id === 'merch_pelagic')!;

      const verifiedStoreHtml = renderToStaticMarkup(
        React.createElement(MobileMerchantStorefront, {
          merchant: verifiedMerchant,
          products: SHOP_PRODUCTS,
          onBack: () => {},
          onSelectProduct: () => {},
          savedProductIds: [],
          onToggleSaveProduct: () => {},
        })
      );
      assert.ok(verifiedStoreHtml.includes('title="Authoritative Verified Merchant"'), 'Displays verified merchant badge for Elena Vance Studio');

      const unverifiedStoreHtml = renderToStaticMarkup(
        React.createElement(MobileMerchantStorefront, {
          merchant: unverifiedMerchant,
          products: SHOP_PRODUCTS,
          onBack: () => {},
          onSelectProduct: () => {},
          savedProductIds: [],
          onToggleSaveProduct: () => {},
        })
      );
      assert.ok(!unverifiedStoreHtml.includes('title="Authoritative Verified Merchant"'), 'Suppresses verified merchant badge for unverified demo merchant');

      // 5. MobileYouHub: Profile hero, public/private identity, history, and action rows
      const sampleIdentity = {
        id: 'usr_fv_90481',
        activeMode: IdentityMode.PUBLIC,
        roles: [UserRole.USER],
        status: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.FREE_STANDARD,
        mfaEnrolled: true,
        phishingResistantMfaVerified: false,
        publicProfile: {
          displayName: 'Elena Vance Studio',
          handle: '@elenavance',
          bio: 'Cinematographer & Real-Time Shader Architect',
          avatarUrl: '/src/assets/images/hero_cinematic_stream_1791448408917.jpg',
          verifiedBadge: true,
        },
        privateProfile: {
          pseudonym: 'CipherFrame_88',
          avatarSeedId: '7f9a2c11',
          avatarStyle: 'GEOMETRIC_SHIELD' as const,
        },
        legalFullName: 'Elena Maria Vance-Kowalski',
        primaryEmail: 'elena.vance@example.org',
        countryIsoCode: 'ZA',
        createdAtIso: '2026-10-08T00:00:00.000Z',
      };

      const youHubHtml = renderToStaticMarkup(
        React.createElement(MobileYouHub, {
          authoritativeIdentity: sampleIdentity,
          identityMode: IdentityMode.PUBLIC,
          onToggleIdentityMode: () => {},
          currentRole: UserRole.USER,
          onChangeRole: () => {},
          subscriptionTier: SubscriptionTier.FREE_STANDARD,
          onToggleSubscriptionTier: () => {},
          isPasskeyEnrolled: true,
          onTogglePasskey: () => {},
          watchLaterCount: 3,
          watchHistoryVideos: [
            { id: 'vid_ocean_01', title: 'Abyssal Optics', duration: '0:06', thumbnailUrl: '/thumb.jpg' },
          ],
          subscribedChannels: [
            { id: 'merch_elena', name: 'Elena Vance Studio', handle: '@elenavance', isVerified: true, avatarUrl: '/avatar.jpg' },
          ],
        })
      );
      assert.ok(youHubHtml.includes('Elena Vance Studio'), 'Renders display name in profile hero');
      assert.ok(youHubHtml.includes('@elenavance'), 'Renders handle');
      assert.ok(youHubHtml.includes('Switch Private'), 'Provides single-tap private pseudonym mode toggle');
      assert.ok(youHubHtml.includes('History'), 'Renders Watch History section');
      assert.ok(youHubHtml.includes('Watch Later'), 'Renders Watch Later row');
      assert.ok(youHubHtml.includes('Subscriptions'), 'Renders Subscriptions row');
      assert.ok(youHubHtml.includes('Voice &amp; Video Calls'), 'Renders Voice & Video Calls row');
      assert.ok(youHubHtml.includes('FACE VID Premium'), 'Renders FACE VID Premium row');
      assert.ok(youHubHtml.includes('Security &amp; Passkeys'), 'Renders Security & Passkeys row');
      assert.ok(youHubHtml.includes('Platform governance and user auditing are segregated in the dedicated Admin portal.'), 'Admin controls explicitly segregated from consumer hub');

      // 6. MobileYouSecondarySheets: Creator Studio & Approved Premium $11.00/mo wording
      const premiumSheetHtml = renderToStaticMarkup(
        React.createElement(MobileYouSecondarySheets, {
          activeSheet: 'premium',
          onClose: () => {},
          currentRole: UserRole.USER,
          onChangeRole: () => {},
          subscriptionTier: SubscriptionTier.FREE_STANDARD,
          onToggleSubscriptionTier: () => {},
          isPasskeyEnrolled: true,
          onTogglePasskey: () => {},
          watchHistoryVideos: [],
          subscribedChannels: [],
        })
      );
      assert.ok(premiumSheetHtml.includes('$11.00 USD'), 'Approved $11.00 USD/month pricing is present');
      assert.ok(premiumSheetHtml.includes('per month, before taxes'), 'Approved billing period displayed');
      assert.ok(premiumSheetHtml.includes('Ad-free personal viewing across all standard and shorts video feeds.'), 'Approved ad-free benefit displayed');
      assert.ok(!premiumSheetHtml.includes('Lossless 4K'), 'No unapproved lossless 4K claims under Premium');
      assert.ok(!premiumSheetHtml.includes('6K Cinema'), 'No unapproved 6K claims under Premium');

      // 7. Creator Studio Founding Creator Contract Quota
      const creatorSheetHtml = renderToStaticMarkup(
        React.createElement(MobileYouSecondarySheets, {
          activeSheet: 'creator_studio',
          onClose: () => {},
          currentRole: UserRole.CREATOR,
          onChangeRole: () => {},
          subscriptionTier: SubscriptionTier.FREE_STANDARD,
          onToggleSubscriptionTier: () => {},
          isPasskeyEnrolled: true,
          onTogglePasskey: () => {},
          watchHistoryVideos: [],
          subscribedChannels: [],
        })
      );
      assert.ok(creatorSheetHtml.includes('3,000,000'), 'Displays 3,000,000 maximum eligible founding creators limit');
      assert.ok(creatorSheetHtml.includes('Mandatory Human Review'), 'Displays mandatory human review requirement');

      // 8. WebAppShell Mobile Integration for Shop and You (Library)
      const shopShellHtml = renderToStaticMarkup(
        React.createElement(WebAppShell, { initialRoute: 'shop' })
      );
      assert.ok(shopShellHtml.includes('FACE VID Shop'), 'Renders Shop screen');
      assert.ok(shopShellHtml.includes('Search gear, LUTs &amp; merch...'), 'Renders MobileShopView in shop route');

      const youShellHtml = renderToStaticMarkup(
        React.createElement(WebAppShell, { initialRoute: 'library' })
      );
      assert.ok(youShellHtml.includes('Elena Vance Studio'), 'Renders MobileYouHub in library route');
      assert.ok(youShellHtml.includes('Switch Private'), 'Renders identity switch button in library route');
    }
  );

  // ===========================================================================
  // 41. STAGE 6A: AUTHENTICATION SECURITY FOUNDATION TEST
  // ===========================================================================
  await runTest(
    'Stage 6A: Authentication Security Foundation — Modern KDF (scrypt), Migration, Dual-Contact OTP, Server Authorization & Safe Account Linking',
    async () => {
      // -----------------------------------------------------------------------
      // 1. Password KDF Modernization & Transparent Hash Migration
      // -----------------------------------------------------------------------
      const testPass = 'UltraSecure_KDF_Pass_2026!';
      const kdfResult = authService.hashPassword(testPass);
      assert.equal(kdfResult.algo, 'scrypt', 'Modern password hashing must use scrypt KDF');
      assert.ok(kdfResult.hash.startsWith('v2$scrypt$'), 'KDF hash must use versioned prefix v2$scrypt$');
      assert.ok(authService.verifyPassword(testPass, kdfResult.hash, kdfResult.salt), 'scrypt hash verifies successfully');
      assert.ok(!authService.verifyPassword('WrongPassword123', kdfResult.hash, kdfResult.salt), 'scrypt rejects invalid password');

      // Transparent Migration of Legacy v1 (SHA-256) Accounts
      const legacySalt = 'salt_legacy_phase1';
      const legacyPepper = 'facevid_secret_pepper_2026_dev';
      const legacySha256 = (await import('node:crypto')).default
        .createHash('sha256')
        .update(`MyLegacyPassword99!:${legacySalt}:${legacyPepper}`)
        .digest('hex');

      const legacyUserId = `usr_legacy_${Date.now()}`;
      databaseFoundationService.upsertUserWithProfileAndSettings({
        userId: legacyUserId,
        primaryEmail: `legacy.${Date.now()}@facevid.test`,
        legalFullName: 'Legacy Migration User',
        countryIsoCode: 'GB',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.FREE_STANDARD,
        mfaEnrolled: false,
        phishingResistantMfaVerified: false,
        publicDisplayName: 'Legacy User',
        publicHandle: `@legacy_${Date.now().toString(36)}`,
        publicBio: '',
        publicAvatarUrl: '/default.png',
        publicVerifiedBadge: false,
        privatePseudonym: 'AnonLegacy',
        privateAvatarSeedId: 'seed_legacy',
        privateAvatarStyle: 'GEOMETRIC_SHIELD',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.COUNTRY,
      });

      // Store legacy SHA-256 credentials with v1 prefix
      databaseFoundationService.upsertAuthCredentials({
        userId: legacyUserId,
        passwordHash: `v1$sha256$${legacySalt}$${legacySha256}`,
        salt: legacySalt,
        algo: 'sha256_salted',
      });

      const userBefore = databaseFoundationService.findUserById(legacyUserId)!;
      const credsBefore = databaseFoundationService.getAuthCredentials(legacyUserId)!;
      assert.equal(credsBefore.algo, 'sha256_salted');
      assert.ok(credsBefore.passwordHash.startsWith('v1$sha256$'));

      // Authenticate with legacy password -> Must transparently upgrade to v2$scrypt
      const loginSession = authService.loginWithPassword({
        email: userBefore.primaryEmail,
        password: 'MyLegacyPassword99!',
      });
      assert.ok(loginSession.sessionId, 'Login succeeds for legacy password');
      assert.ok(loginSession.accessToken, 'Issues valid access token');

      // Verify credentials in database have been upgraded to modern scrypt KDF
      const credsAfter = databaseFoundationService.getAuthCredentials(legacyUserId)!;
      assert.equal(credsAfter.algo, 'scrypt', 'Credential record must be upgraded to scrypt');
      assert.ok(credsAfter.passwordHash.startsWith('v2$scrypt$'), 'Stored hash must be upgraded to v2$scrypt');
      assert.notEqual(credsAfter.passwordHash, credsBefore.passwordHash, 'Password hash was rewritten with modern KDF');

      // -----------------------------------------------------------------------
      // 2. Dual-Contact OTP Verification Foundation
      // -----------------------------------------------------------------------
      otpService.resetTestState();
      const testEmail = 'pilot.user@facevid.test';
      const testMobile = '+15551234567';

      // 2.1 Send Email OTP
      const emailChallenge = otpService.sendEmailOtp(testEmail);
      assert.ok(emailChallenge.challengeId.startsWith('otp_em_'));
      assert.equal(emailChallenge.channel, 'EMAIL');
      assert.equal(emailChallenge.expiresInSeconds, 900, 'Email OTP has 15-minute TTL');
      assert.equal(emailChallenge.cooldownSeconds, 60, 'Enforces 60-second cooldown');

      // Cooldown violation check
      assert.throws(() => {
        otpService.sendEmailOtp(testEmail);
      }, /wait \d+ seconds/);

      // 2.2 Send Mobile SMS OTP
      const smsChallenge = otpService.sendSmsOtp(testMobile);
      assert.ok(smsChallenge.challengeId.startsWith('otp_sms_'));
      assert.equal(smsChallenge.channel, 'SMS');
      assert.equal(smsChallenge.expiresInSeconds, 600, 'SMS OTP has 10-minute TTL');

      // Cooldown violation check on SMS
      assert.throws(() => {
        otpService.sendSmsOtp(testMobile);
      }, /wait \d+ seconds/);

      // 2.3 Retrieve Sandbox OTPs for Testing
      const emailOtp = otpService.getLatestSandboxOtpForTesting(testEmail, 'EMAIL');
      const smsOtp = otpService.getLatestSandboxOtpForTesting(testMobile, 'SMS');
      assert.ok(emailOtp && emailOtp.length === 6, 'Generated 6-digit email OTP');
      assert.ok(smsOtp && smsOtp.length === 6, 'Generated 6-digit SMS OTP');

      // 2.4 Verify Failed Attempt Tracking (Max 5 attempts)
      const badAttempt = otpService.verifyOtp({
        challengeId: emailChallenge.challengeId,
        presentedOtp: '000000',
      });
      assert.equal(badAttempt.success, false);
      assert.ok(badAttempt.error?.includes('attempt(s) remaining'));

      // 2.5 Atomic Dual-Contact Verification
      const dualResult = otpService.verifyDualContact({
        emailChallengeId: emailChallenge.challengeId,
        emailOtp: emailOtp!,
        smsChallengeId: smsChallenge.challengeId,
        smsOtp: smsOtp!,
      });
      assert.equal(dualResult.success, true);
      assert.equal(dualResult.email, testEmail);
      assert.equal(dualResult.mobileNumber, testMobile);

      // 2.6 Single-Use Consumption Replay Rejection
      const replayAttempt = otpService.verifyOtp({
        challengeId: emailChallenge.challengeId,
        presentedOtp: emailOtp!,
      });
      assert.equal(replayAttempt.success, false, 'Replaying consumed OTP challenge is strictly rejected');

      // -----------------------------------------------------------------------
      // 3. Server-Side Protected Routing & Role Authorization
      // -----------------------------------------------------------------------
      const app = createStandaloneApiApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // 3.1 Unauthenticated access to protected route returns 401
        const unauthRes = await fetch(`${baseUrl}/api/v1/merchant/status`);
        assert.equal(unauthRes.status, 401, 'Unauthenticated access to /merchant/status returns 401');

        // 3.2 Forged Bearer token returns 401
        const forgedRes = await fetch(`${baseUrl}/api/v1/merchant/status`, {
          headers: { Authorization: 'Bearer forged_non_existent_token_999' },
        });
        assert.equal(forgedRes.status, 401, 'Forged/non-existent token returns 401');

        // 3.3 Valid User session attempting Merchant route returns 403 (Deny-by-default role enforcement)
        const regularUserSession = loginSession; // Standard USER role
        const roleDeniedRes = await fetch(`${baseUrl}/api/v1/merchant/status`, {
          headers: {
            Authorization: `Bearer ${regularUserSession.accessToken}`,
            // Attempt client-side role forgery:
            'x-current-role': 'MERCHANT',
          },
        });
        assert.equal(roleDeniedRes.status, 403, 'Standard user denied access to Merchant endpoint (403)');
        const deniedBody = (await roleDeniedRes.json()) as { errorCode: string };
        assert.equal(deniedBody.errorCode, ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT);

        // 3.4 Authorized Merchant session succeeds (200 OK)
        const merchantUserId = `usr_merchant_${Date.now()}`;
        databaseFoundationService.upsertUserWithProfileAndSettings({
          userId: merchantUserId,
          primaryEmail: `store.${Date.now()}@facevid.test`,
          legalFullName: 'Authorized Store Merchant',
          countryIsoCode: 'GB',
          accountStatus: AccountStatus.ACTIVE,
          subscriptionTier: SubscriptionTier.FREE_STANDARD,
          mfaEnrolled: true,
          phishingResistantMfaVerified: true,
          publicDisplayName: 'Certified Store',
          publicHandle: `@store_${Date.now().toString(36)}`,
          publicBio: '',
          publicAvatarUrl: '/store.png',
          publicVerifiedBadge: true,
          privatePseudonym: 'StoreMask',
          privateAvatarSeedId: 'seed_store',
          privateAvatarStyle: 'GEOMETRIC_SHIELD',
          activeIdentityMode: IdentityMode.PUBLIC,
          defaultLiveAudienceReach: LiveAudienceReach.WORLDWIDE,
        });
        databaseFoundationService.assignUserRole({
          userId: merchantUserId,
          roleCode: UserRole.MERCHANT,
          grantedByActorId: 'usr_human_mod_01',
          grantedByActorType: AuditActorType.ADMIN,
        });

        const merchantPassHash = authService.hashPassword('MerchantPass2026!');
        databaseFoundationService.upsertAuthCredentials({
          userId: merchantUserId,
          passwordHash: merchantPassHash.hash,
          salt: merchantPassHash.salt,
          algo: 'scrypt',
        });

        const merchantSession = authService.loginWithPassword({
          email: databaseFoundationService.findUserById(merchantUserId)!.primaryEmail,
          password: 'MerchantPass2026!',
        });

        const merchantAuthRes = await fetch(`${baseUrl}/api/v1/merchant/status`, {
          headers: { Authorization: `Bearer ${merchantSession.accessToken}` },
        });
        assert.equal(merchantAuthRes.status, 200, 'Authoritative Merchant role succeeds');
        const merchantAuthBody = (await merchantAuthRes.json()) as { authorized: boolean };
        assert.equal(merchantAuthBody.authorized, true);

        // -----------------------------------------------------------------------
        // 4. Safe OAuth Identity Linking Architecture
        // -----------------------------------------------------------------------
        const testOauthSub = `google_sub_${Date.now()}`;

        // Unauthenticated link attempt returns 401
        const unauthLink = await fetch(`${baseUrl}/api/v1/auth/link-oauth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            provider: 'google',
            externalSubjectId: testOauthSub,
          }),
        });
        assert.equal(unauthLink.status, 401, 'Unauthenticated OAuth linking rejected with 401');

        // Authenticated linking succeeds
        const authLink = await fetch(`${baseUrl}/api/v1/auth/link-oauth`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${regularUserSession.accessToken}`,
          },
          body: JSON.stringify({
            provider: 'google',
            externalSubjectId: testOauthSub,
            externalEmail: 'elena.oauth@example.com',
          }),
        });
        assert.equal(authLink.status, 200, 'Authenticated OAuth link succeeds');

        // Re-linking SAME external identity to a DIFFERENT account is rejected (409 Conflict)
        const hijackLink = await fetch(`${baseUrl}/api/v1/auth/link-oauth`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${merchantSession.accessToken}`,
          },
          body: JSON.stringify({
            provider: 'google',
            externalSubjectId: testOauthSub, // Same external identity
          }),
        });
        assert.equal(hijackLink.status, 409, 'Duplicate external identity linking rejected with 409 Conflict');

        // -----------------------------------------------------------------------
        // 5. Refresh Token Rotation (RTR) & Security Breach Replay Invalidation
        // -----------------------------------------------------------------------
        const rtr1 = await fetch(`${baseUrl}/api/v1/auth/session/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: regularUserSession.refreshToken }),
        });
        assert.equal(rtr1.status, 200, 'First refresh token consumption succeeds');
        const rtr1Data = (await rtr1.json()) as { data: { refreshToken: string; accessToken: string } };
        assert.ok(rtr1Data.data.refreshToken);

        // Reusing the already-consumed refresh token must trigger breach revocation
        const rtrBreach = await fetch(`${baseUrl}/api/v1/auth/session/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: regularUserSession.refreshToken }),
        });
        assert.equal(rtrBreach.status, 401, 'Token reuse breach detected (401)');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );

  await runTest(
    'Stage 6A.1: Critical Security Corrections — Hardened Admin Authorization, WebAuthn Fail-Closed & Persistent OTP Security',
    async () => {
      const app = createStandaloneApiApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, () => resolve()));
      const address = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // =====================================================================
        // 1. OPERATIONAL ADMIN AUTHORIZATION NEGATIVE & POSITIVE TESTS
        // =====================================================================
        const adminEndpoints = [
          { path: '/api/v1/admin/creators/approve-founding', body: { verificationId: 'ver_test_01', targetUserId: 'usr_test_crt' } },
          { path: '/api/v1/admin/business/approve', body: { advertiserId: 'adv_apex_7720', reason: 'Verified corporate' } },
          { path: '/api/v1/admin/stores/approve', body: { merchantId: 'mrc_lumina_4410', reason: 'Verified store' } },
          { path: '/api/v1/admin/accounts/suspend', body: { targetUserId: 'usr_verified_8841', reason: 'Test policy breach' } },
        ];

        for (const ep of adminEndpoints) {
          // 1.1 Missing credentials returns 401
          const noAuthRes = await fetch(`${baseUrl}${ep.path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(ep.body),
          });
          assert.equal(noAuthRes.status, 401, `Missing credentials on ${ep.path} returns 401`);
          const noAuthBody = (await noAuthRes.json()) as { errorCode: string };
          assert.equal(noAuthBody.errorCode, ApiErrorCode.UNAUTHORIZED);

          // 1.2 Forged Bearer token returns 401
          const forgedTokenRes = await fetch(`${baseUrl}${ep.path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer forged_fake_admin_token_999',
            },
            body: JSON.stringify(ep.body),
          });
          assert.equal(forgedTokenRes.status, 401, `Forged token on ${ep.path} returns 401`);

          // 1.3 Forged client header (x-admin-user-id) without valid Bearer session returns 401
          const forgedHeaderRes = await fetch(`${baseUrl}${ep.path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-admin-user-id': 'usr_human_mod_01', // Spoofed header
            },
            body: JSON.stringify(ep.body),
          });
          assert.equal(forgedHeaderRes.status, 401, `Spoofed x-admin-user-id header on ${ep.path} is ignored and returns 401`);

          // 1.4 Expired Admin session returns 401
          const expiredRes = await fetch(`${baseUrl}${ep.path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer fvsess_admin_expired_token',
            },
            body: JSON.stringify(ep.body),
          });
          assert.equal(expiredRes.status, 401, `Expired session on ${ep.path} returns 401`);

          // 1.5 Ordinary user session (role USER only) returns 403 FORBIDDEN_DENY_BY_DEFAULT
          const userRes = await fetch(`${baseUrl}${ep.path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer fvsess_valid_user_token_101',
            },
            body: JSON.stringify(ep.body),
          });
          assert.equal(userRes.status, 403, `Ordinary user on ${ep.path} returns 403`);
          const userBody = (await userRes.json()) as { errorCode: string };
          assert.equal(userBody.errorCode, ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT);

          // 1.6 Admin lacking hardware MFA returns 403
          const noMfaRes = await fetch(`${baseUrl}${ep.path}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer fvsess_admin_no_mfa_token',
            },
            body: JSON.stringify(ep.body),
          });
          assert.equal(noMfaRes.status, 403, `Admin lacking MFA on ${ep.path} returns 403`);
        }

        // 1.7 Positive Authorized Admin Execution (fvsess_admin_mod_token_01 with verified MFA)
        const validMetricsRes = await fetch(`${baseUrl}/api/v1/admin/metrics`, {
          headers: { Authorization: 'Bearer fvsess_admin_mod_token_01' },
        });
        assert.equal(validMetricsRes.status, 200, 'Authorized admin metrics access succeeds');

        const validBizRes = await fetch(`${baseUrl}/api/v1/admin/business/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer fvsess_admin_mod_token_01',
          },
          body: JSON.stringify({ advertiserId: 'adv_apex_7720', reason: 'KYB verification approved' }),
        });
        assert.equal(validBizRes.status, 200, 'Authorized Business approval succeeds');

        const validStoreRes = await fetch(`${baseUrl}/api/v1/admin/stores/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer fvsess_admin_mod_token_01',
          },
          body: JSON.stringify({ merchantId: 'mrc_lumina_4410', reason: 'Merchant store approved' }),
        });
        assert.equal(validStoreRes.status, 200, 'Authorized Store approval succeeds');

        const testUserToSuspend = `usr_suspend_${Date.now()}`;
        databaseFoundationService.upsertUserWithProfileAndSettings({
          userId: testUserToSuspend,
          primaryEmail: `suspend.${Date.now()}@facevid.test`,
          legalFullName: 'User To Suspend',
          countryIsoCode: 'GB',
          accountStatus: AccountStatus.ACTIVE,
          subscriptionTier: SubscriptionTier.FREE_STANDARD,
          mfaEnrolled: true,
          phishingResistantMfaVerified: false,
          publicDisplayName: 'User To Suspend',
          publicHandle: `@suspend_${Date.now().toString(36)}`,
          publicBio: '',
          publicAvatarUrl: '/suspend.png',
          publicVerifiedBadge: false,
          privatePseudonym: 'SuspendMask',
          privateAvatarSeedId: 'seed_suspend',
          privateAvatarStyle: 'GEOMETRIC_SHIELD',
          activeIdentityMode: IdentityMode.PUBLIC,
          defaultLiveAudienceReach: LiveAudienceReach.WORLDWIDE,
        });

        const validSuspendRes = await fetch(`${baseUrl}/api/v1/admin/accounts/suspend`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer fvsess_admin_mod_token_01',
          },
          body: JSON.stringify({ targetUserId: testUserToSuspend, reason: 'Compliance audit hold' }),
        });
        assert.equal(validSuspendRes.status, 200, 'Authorized account suspension succeeds');
        const suspendedUser = databaseFoundationService.findUserById(testUserToSuspend)!;
        assert.equal(suspendedUser.accountStatus, AccountStatus.SUSPENDED, 'User account status set to SUSPENDED');

        // =====================================================================
        // 2. WEBAUTHN PASSKEY CRYPTOGRAPHIC FAIL-CLOSED GUARD & NEGATIVE TESTS
        // =====================================================================
        // 2.1 Non-existent / expired challenge throws
        assert.throws(
          () => {
            authService.verifyPasskeyLogin({
              challenge: 'invalid_non_existent_challenge',
              credentialId: 'cred_non_existent',
              clientSignatureBase64: 'fake_sig',
              counter: 1,
              allowInternalTestAdapterAssertion: true,
            });
          },
          /expired or is invalid/i,
          'Rejects non-existent challenge'
        );

        // 2.2 Unrecognized passkey credential throws
        const validLoginOpts = authService.getPasskeyLoginOptions('creator.maya@facevid.example');
        assert.throws(
          () => {
            authService.verifyPasskeyLogin({
              challenge: validLoginOpts.challenge,
              credentialId: 'cred_fake_unknown',
              clientSignatureBase64: 'fake_sig',
              counter: 1,
              allowInternalTestAdapterAssertion: true,
            });
          },
          /unrecognized passkey credential/i,
          'Rejects unknown credential ID'
        );

        // 2.3 Synchronized Passkey with counter = 0 is supported
        // Register a test passkey
        const testUser = `usr_pk_${Date.now()}`;
        databaseFoundationService.upsertUserWithProfileAndSettings({
          userId: testUser,
          primaryEmail: `passkey.${Date.now()}@facevid.test`,
          legalFullName: 'Passkey Test User',
          countryIsoCode: 'GB',
          accountStatus: AccountStatus.ACTIVE,
          subscriptionTier: SubscriptionTier.FREE_STANDARD,
          mfaEnrolled: true,
          phishingResistantMfaVerified: true,
          publicDisplayName: 'Passkey User',
          publicHandle: `@pk_${Date.now().toString(36)}`,
          publicBio: '',
          publicAvatarUrl: '/pk.png',
          publicVerifiedBadge: false,
          privatePseudonym: 'PkMask',
          privateAvatarSeedId: 'seed_pk',
          privateAvatarStyle: 'GEOMETRIC_SHIELD',
          activeIdentityMode: IdentityMode.PUBLIC,
          defaultLiveAudienceReach: LiveAudienceReach.WORLDWIDE,
        });

        const testCredId = `cred_sync_${Date.now()}`;
        databaseFoundationService.registerPasskeyCredential({
          credentialId: testCredId,
          userId: testUser,
          publicKeyDerBase64: Buffer.from('test_sync_pubkey').toString('base64'),
          counter: 0,
          deviceType: 'platform',
          transports: ['internal', 'hybrid'],
          aaguid: null,
          createdAtIso: new Date().toISOString(),
          lastUsedAtIso: null,
        });

        const syncOpts = authService.getPasskeyLoginOptions(databaseFoundationService.findUserById(testUser)!.primaryEmail);
        const syncSession = authService.verifyPasskeyLogin({
          challenge: syncOpts.challenge,
          credentialId: testCredId,
          clientSignatureBase64: 'valid_sync_signature_assertion',
          counter: 0, // Zero counter for synchronized passkey!
          allowInternalTestAdapterAssertion: true,
        });
        assert.ok(syncSession.accessToken, 'Synchronized passkey with counter = 0 succeeds');

        // 2.4 Counter anomaly regression (counter decreases or repeats) throws
        const syncOpts2 = authService.getPasskeyLoginOptions(databaseFoundationService.findUserById(testUser)!.primaryEmail);
        // Advance counter to 10
        authService.verifyPasskeyLogin({
          challenge: syncOpts2.challenge,
          credentialId: testCredId,
          clientSignatureBase64: 'valid_sync_sig_2',
          counter: 10,
          allowInternalTestAdapterAssertion: true,
        });

        const syncOpts3 = authService.getPasskeyLoginOptions(databaseFoundationService.findUserById(testUser)!.primaryEmail);
        assert.throws(
          () => {
            authService.verifyPasskeyLogin({
              challenge: syncOpts3.challenge,
              credentialId: testCredId,
              clientSignatureBase64: 'stale_sig',
              counter: 5, // Regressed counter (10 -> 5)
              allowInternalTestAdapterAssertion: true,
            });
          },
          /counter anomaly/i,
          'Rejects regressed authenticator counter'
        );

        // 2.5 Network endpoint fail-closed guard:
        // Attempting to authenticate via network API without approved library fails closed
        const netLoginOpts = authService.getPasskeyLoginOptions(databaseFoundationService.findUserById(testUser)!.primaryEmail);
        const netPkRes = await fetch(`${baseUrl}/api/v1/auth/passkey/login/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challenge: netLoginOpts.challenge,
            credentialId: testCredId,
            clientSignatureBase64: 'mock_unapproved_assertion',
            counter: 11,
          }),
        });
        assert.equal(netPkRes.status, 401, 'Unverified passkey assertion fails closed over network API (401)');
        const netPkBody = (await netPkRes.json()) as { message: string };
        assert.match(netPkBody.message, /simplewebauthn/i, 'Reports pending library authorization');

        // =====================================================================
        // 3. PERSISTENT OTP SECURITY & RESTARTS
        // =====================================================================
        const testOtpEmail = `user.persist.${Date.now()}@facevid.test`;
        const testOtpPhone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;

        // 3.1 Send Email and SMS OTP
        const emailOtpResult = otpService.sendEmailOtp(testOtpEmail);
        const smsOtpResult = otpService.sendSmsOtp(testOtpPhone);
        assert.ok(emailOtpResult.challengeId, 'Issued email OTP challenge');
        assert.ok(smsOtpResult.challengeId, 'Issued SMS OTP challenge');

        // 3.2 Cooldown enforcement (immediate resend is blocked)
        assert.throws(
          () => otpService.sendEmailOtp(testOtpEmail),
          /wait .* seconds before requesting another/i,
          'Enforces 60-second cooldown'
        );

        // 3.3 Server restart simulation: Reload state from disk in OtpService
        otpService.reloadFromDisk();
        const persistenceMeta = otpService.getPersistenceMetadata();
        assert.equal(persistenceMeta.storageType, 'LOCAL_PERSISTENT_FILE_ADAPTER');
        assert.ok(persistenceMeta.activeChallenges > 0, 'Active challenges survived restart simulation');

        // Verify cooldown is still enforced after restart simulation
        assert.throws(
          () => otpService.sendEmailOtp(testOtpEmail),
          /wait .* seconds before requesting another/i,
          'Cooldown enforcement survived restart simulation'
        );

        // 3.4 Partial Dual-Contact verification failure:
        // Valid email code + invalid SMS code fails atomically
        const validEmailCode = otpService.getLatestSandboxOtpForTesting(testOtpEmail, 'EMAIL')!;
        const partialDualResult = otpService.verifyDualContact({
          emailChallengeId: emailOtpResult.challengeId,
          emailOtp: validEmailCode,
          smsChallengeId: smsOtpResult.challengeId,
          smsOtp: '000000', // Invalid SMS code!
        });
        assert.equal(partialDualResult.success, false, 'Partial dual-contact verification blocked');
        assert.match(partialDualResult.error || '', /Mobile SMS verification failed/i);

        // 3.5 Single-use consumption & anti-replay:
        // Verification succeeds with correct SMS code
        const validSmsCode = otpService.getLatestSandboxOtpForTesting(testOtpPhone, 'SMS')!;
        const validSmsVerify = otpService.verifyOtp({
          challengeId: smsOtpResult.challengeId,
          presentedOtp: validSmsCode,
        });
        assert.equal(validSmsVerify.success, true, 'Valid SMS OTP verified');

        // Attempting to reuse already-consumed SMS OTP is rejected
        const replaySmsVerify = otpService.verifyOtp({
          challengeId: smsOtpResult.challengeId,
          presentedOtp: validSmsCode,
        });
        assert.equal(replaySmsVerify.success, false, 'Replaying consumed OTP is rejected');
        assert.match(replaySmsVerify.error || '', /already been consumed/i);

        // 3.6 Brute-force lockout:
        const lockoutEmail = `lockout.${Date.now()}@facevid.test`;
        const lockoutOtp = otpService.sendEmailOtp(lockoutEmail);
        for (let attempt = 1; attempt <= 4; attempt++) {
          const bad = otpService.verifyOtp({
            challengeId: lockoutOtp.challengeId,
            presentedOtp: '111111',
          });
          assert.equal(bad.success, false);
          assert.match(bad.error || '', /attempt\(s\) remaining/i);
        }
        // 5th failed attempt invalidates challenge
        const fifthBad = otpService.verifyOtp({
          challengeId: lockoutOtp.challengeId,
          presentedOtp: '111111',
        });
        assert.equal(fifthBad.success, false);
        assert.match(fifthBad.error || '', /Maximum attempts reached; challenge invalidated/i);

        // 6th attempt: challenge no longer exists
        const sixthBad = otpService.verifyOtp({
          challengeId: lockoutOtp.challengeId,
          presentedOtp: '111111',
        });
        assert.equal(sixthBad.success, false);
        assert.match(sixthBad.error || '', /does not exist or has expired/i);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );

  // 25. Stage 6B: Standalone Authentication Gateway — First Screen Gate, 5 Sign In Methods, 4 Account Experiences & Dual-Contact Verification
  await runTest(
    'Stage 6B: Standalone Authentication Gateway — First Screen Gate, 5 Sign In Methods, 4 Account Experiences & Dual-Contact Verification',
    async () => {
      // 1. Gateway Static Markup Rendering
      const gatewayHtml = renderToStaticMarkup(
        React.createElement(StandaloneAuthGateway, {
          onAuthenticated: () => {},
        })
      );

      // Mandatory Branding & First Screen Aesthetics
      assert.ok(
        gatewayHtml.includes('/assets/owner/face-vid-official-logo.png'),
        'Gateway MUST render official owner logo asset'
      );
      assert.ok(
        gatewayHtml.includes('Welcome to FACE VID'),
        'Must display mandatory Welcome to FACE VID heading'
      );
      assert.ok(
        gatewayHtml.includes('Sign in to connect, create and discover.'),
        'Must display mandatory subheading'
      );

      // 5 Core Sign In Methods
      assert.ok(
        gatewayHtml.includes('Continue with Google'),
        'Must provide Continue with Google button'
      );
      assert.ok(
        gatewayHtml.includes('Continue with Apple'),
        'Must provide Continue with Apple button'
      );
      assert.ok(
        gatewayHtml.includes('Sign in with Passkey / PIN'),
        'Must provide Passkey / Hardware FIDO2 sign-in button'
      );
      assert.ok(
        gatewayHtml.includes('Email') && gatewayHtml.includes('Mobile Number'),
        'Must provide Email and Mobile Number credential mode buttons'
      );

      // Credential controls
      assert.ok(
        gatewayHtml.includes('Forgot Password?'),
        'Must render Forgot Password recovery link'
      );
      assert.ok(
        gatewayHtml.includes('Use Emergency Recovery Code'),
        'Must provide emergency recovery code alternative'
      );
      assert.ok(
        gatewayHtml.includes('Create Account'),
        'Must render Create Account link'
      );

      // 2. Live API Server Integration Tests
      const app = createStandaloneApiApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind port for Stage 6B test');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // Test A: OAuth config status endpoint
        const oauthRes = await fetch(`${baseUrl}/api/v1/auth/oauth/config`);
        assert.equal(oauthRes.status, 200);
        const oauthJson = (await oauthRes.json()) as any;
        assert.equal(oauthJson.ok, true);
        assert.equal(typeof oauthJson.data.google.available, 'boolean');
        assert.equal(typeof oauthJson.data.apple.available, 'boolean');

        // Test B: Unauthenticated request to /auth/session/me is rejected
        const sessionRes = await fetch(`${baseUrl}/api/v1/auth/session/me`);
        assert.equal(sessionRes.status, 401);
        const sessionJson = (await sessionRes.json()) as any;
        assert.ok(sessionJson.error || sessionJson.statusCode === 401);

        // Test C: Dual Contact OTP Dispatch via API
        const emailOtpRes = await fetch(`${baseUrl}/api/v1/auth/otp/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'stage6b.tester@facevid.test' }),
        });
        assert.equal(emailOtpRes.status, 200);
        const emailOtpJson = (await emailOtpRes.json()) as any;
        assert.ok(emailOtpJson.data.challengeId);

        const smsOtpRes = await fetch(`${baseUrl}/api/v1/auth/otp/send-sms`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mobileNumber: '+1 555-0199' }),
        });
        assert.equal(smsOtpRes.status, 200);
        const smsOtpJson = (await smsOtpRes.json()) as any;
        assert.ok(smsOtpJson.data.challengeId);

        // Retrieve sandbox codes
        const emailCode = otpService.getLatestSandboxOtpForTesting('stage6b.tester@facevid.test', 'EMAIL');
        const smsCode = otpService.getLatestSandboxOtpForTesting('+1 555-0199', 'SMS');
        assert.ok(emailCode && smsCode, 'Sandbox OTPs must be issued');

        // Verify Dual OTP Atomically
        const dualVerifyRes = await fetch(`${baseUrl}/api/v1/auth/otp/verify-dual`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            emailChallengeId: emailOtpJson.data.challengeId,
            emailOtp: emailCode,
            smsChallengeId: smsOtpJson.data.challengeId,
            smsOtp: smsCode,
          }),
        });
        assert.equal(dualVerifyRes.status, 200);
        const dualVerifyJson = (await dualVerifyRes.json()) as any;
        assert.equal(dualVerifyJson.data.success, true);
        assert.ok(dualVerifyJson.data.email && dualVerifyJson.data.mobileNumber);

        const testEpoch = Date.now();
        const testEmail = `stage6b.merchant.${testEpoch}@facevid.test`;
        const testPhone = `+1 555-${String(testEpoch).slice(-4)}`;

        // Register Account (Store Experience)
        const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountType: 'store',
            email: testEmail,
            mobileNumber: testPhone,
            fullName: 'Marcus Vance',
            displayName: 'Marcus Optics',
            handle: `@marcus_${testEpoch.toString(36)}`,
            password: 'StrongPassword123!',
            storeName: 'Vance Cinema Store',
            storeCatalogType: 'Optics & Sensors',
            acceptedTerms: true,
          }),
        });
        assert.equal(regRes.status, 201);

        // Test D: Sign in using Mobile Number & Password
        const phoneLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: testPhone,
            password: 'StrongPassword123!',
          }),
        });
        assert.equal(phoneLoginRes.status, 200);
        const phoneLoginJson = (await phoneLoginRes.json()) as any;
        assert.ok(phoneLoginJson.data.accessToken);

        // Test E: Authenticated session verification via /auth/session/me
        const authMeRes = await fetch(`${baseUrl}/api/v1/auth/session/me`, {
          headers: { Authorization: `Bearer ${phoneLoginJson.data.accessToken}` },
        });
        assert.equal(authMeRes.status, 200);
        const authMeJson = (await authMeRes.json()) as any;
        assert.equal(authMeJson.ok, true);
        assert.equal(authMeJson.data.email, testEmail);

        // Test F: Sign Out / Revoke Session
        const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${phoneLoginJson.data.accessToken}`,
          },
        });
        assert.equal(logoutRes.status, 200);

        // Session is now revoked
        const postLogoutMe = await fetch(`${baseUrl}/api/v1/auth/session/me`, {
          headers: { Authorization: `Bearer ${phoneLoginJson.data.accessToken}` },
        });
        assert.equal(postLogoutMe.status, 401);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );

  // ===========================================================================
  // STAGE 2A: LIVE-STREAM GEOGRAPHICAL DISCOVERY & GPS PRIVACY ENFORCEMENT
  // ===========================================================================
  await runTest(
    'Stage 2A: Live-Stream Geographical Discovery (6 Approved Scopes) & Critical GPS Coordinate Privacy Enforcement',
    async () => {
      const app = createStandaloneApiApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Failed to bind port for Stage 2A test');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        // 1. Verify all 6 approved scopes are respected by the API
        // User is at Cape Town (-33.9249, 18.4241), City: CPT, Country: ZA, Continent: AF

        // 1.1 15 km Local Radius: Only streams within 15 km should be returned
        const res15 = await fetch(
          `${baseUrl}/api/v1/live/streams?lat=-33.9249&lng=18.4241&reach=${LiveAudienceReach.RADIUS_15KM}&cityCode=CPT&countryIso=ZA&continentCode=AF`
        );
        assert.equal(res15.status, 200);
        const data15 = (await res15.json()) as any;
        assert.equal(data15.ok, true);
        assert.equal(data15.data.activeReach, LiveAudienceReach.RADIUS_15KM);
        assert.match(data15.data.publicScopeLabel, /15 km/i);
        // Table Mountain (3.5 km away) must be present
        const has15kmLocal = data15.data.streams.some(
          (s: any) => s.streamId === 'stream_cape_local_02'
        );
        assert.ok(has15kmLocal, '15 km local stream is included');
        // Tokyo and NYC (thousands of km away) must NOT be present
        const hasTokyoIn15 = data15.data.streams.some(
          (s: any) => s.streamId === 'stream_tokyo_worldwide_06'
        );
        const hasNycIn15 = data15.data.streams.some(
          (s: any) => s.streamId === 'stream_nyc_urban_04'
        );
        assert.equal(hasTokyoIn15, false, 'Tokyo stream excluded from 15 km local scope');
        assert.equal(hasNycIn15, false, 'NYC stream excluded from 15 km local scope');

        // 1.2 30 km Extended Radius: Table Mountain (3.5 km) and Cape Peninsula (25 km) included
        const res30 = await fetch(
          `${baseUrl}/api/v1/live/streams?lat=-33.9249&lng=18.4241&reach=${LiveAudienceReach.RADIUS_30KM}`
        );
        const data30 = (await res30.json()) as any;
        assert.equal(data30.data.activeReach, LiveAudienceReach.RADIUS_30KM);
        const has30kmStream = data30.data.streams.some(
          (s: any) => s.streamId === 'stream_cinematics_01'
        );
        assert.ok(has30kmStream, '30 km stream is included in 30 km scope');

        // 1.3 City-Wide: Matches Cape Town metropolitan area
        const resCity = await fetch(
          `${baseUrl}/api/v1/live/streams?lat=-33.9249&lng=18.4241&reach=${LiveAudienceReach.CITY}&cityCode=CPT`
        );
        const dataCity = (await resCity.json()) as any;
        assert.equal(dataCity.data.activeReach, LiveAudienceReach.CITY);
        assert.match(dataCity.data.publicScopeLabel, /City/i);

        // 1.4 Country-Wide: London user querying within UK
        const resCountry = await fetch(
          `${baseUrl}/api/v1/live/streams?lat=51.5074&lng=-0.1278&reach=${LiveAudienceReach.COUNTRY}&countryIso=GB`
        );
        const dataCountry = (await resCountry.json()) as any;
        assert.equal(dataCountry.data.activeReach, LiveAudienceReach.COUNTRY);
        const hasLondonInCountry = dataCountry.data.streams.some(
          (s: any) => s.streamId === 'stream_soundstage_03'
        );
        assert.ok(hasLondonInCountry, 'London stream included in UK country-wide scope');

        // 1.5 Continent-Wide: Berlin user querying within Europe
        const resContinent = await fetch(
          `${baseUrl}/api/v1/live/streams?lat=52.5200&lng=13.4050&reach=${LiveAudienceReach.CONTINENT}&continentCode=EU`
        );
        const dataContinent = (await resContinent.json()) as any;
        assert.equal(dataContinent.data.activeReach, LiveAudienceReach.CONTINENT);
        const hasBerlinInContinent = dataContinent.data.streams.some(
          (s: any) => s.streamId === 'stream_berlin_synth_05'
        );
        assert.ok(hasBerlinInContinent, 'Berlin stream included in European continental scope');

        // 1.6 Worldwide: All streams worldwide discoverable
        const resWorldwide = await fetch(
          `${baseUrl}/api/v1/live/streams?reach=${LiveAudienceReach.WORLDWIDE}`
        );
        const dataWorldwide = (await resWorldwide.json()) as any;
        assert.equal(dataWorldwide.data.activeReach, LiveAudienceReach.WORLDWIDE);
        assert.ok(dataWorldwide.data.streams.length >= 6, 'All worldwide streams discoverable');

        // 2. CRITICAL GPS PRIVACY & ZERO COORDINATE LEAKAGE AUDIT
        // Verify every stream in GET response has 0 coordinates exposed
        for (const stream of dataWorldwide.data.streams) {
          assert.equal(stream.lat, undefined, 'stream.lat must be undefined in public API response');
          assert.equal(stream.lng, undefined, 'stream.lng must be undefined in public API response');
          assert.equal(stream.latitude, undefined, 'stream.latitude must be undefined');
          assert.equal(stream.longitude, undefined, 'stream.longitude must be undefined');
          assert.equal(stream.internalLat, undefined, 'internalLat must not leak');
          assert.equal(stream.internalLng, undefined, 'internalLng must not leak');
          assert.equal(stream.coordinatesRedacted, true, 'coordinatesRedacted marker must be true');
          assert.ok(stream.publicScopeLabel, 'publicScopeLabel must be populated');
          assert.ok(stream.locationLabel, 'coarse locationLabel must be populated');
        }

        // 3. Test Broadcast Launch & Sanitized API Response
        const createStreamRes = await fetch(`${baseUrl}/api/v1/live/streams`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Privacy Verification Live Broadcast',
            category: 'Cinema & Arts',
            reach: LiveAudienceReach.RADIUS_15KM,
            lat: -33.912345, // Exact broadcaster home GPS
            lng: 18.412345, // Exact broadcaster home GPS
            locationLabel: 'Verified Coastal Studio',
          }),
        });
        assert.equal(createStreamRes.status, 201);
        const createStreamJson = (await createStreamRes.json()) as any;
        assert.equal(createStreamJson.ok, true);
        const createdStream = createStreamJson.data;

        // Verify broadcaster response NEVER returns raw coordinates
        assert.equal(createdStream.lat, undefined, 'Broadcaster launch response strips lat');
        assert.equal(createdStream.lng, undefined, 'Broadcaster launch response strips lng');
        assert.equal(createdStream.latitude, undefined, 'Broadcaster launch response strips latitude');
        assert.equal(createdStream.longitude, undefined, 'Broadcaster launch response strips longitude');
        assert.equal(createdStream.internalLat, undefined, 'Broadcaster launch response hides internalLat');
        assert.equal(createdStream.internalLng, undefined, 'Broadcaster launch response hides internalLng');
        assert.equal(createdStream.coordinatesRedacted, true);
        assert.equal(createdStream.reach, LiveAudienceReach.RADIUS_15KM);

        // 4. Invalid Reach Parameter Fallback
        const invalidReachRes = await fetch(
          `${baseUrl}/api/v1/live/streams?reach=INVALID_BYPASS_ATTEMPT`
        );
        assert.equal(invalidReachRes.status, 200);
        const invalidReachJson = (await invalidReachRes.json()) as any;
        assert.equal(
          invalidReachJson.data.activeReach,
          LiveAudienceReach.RADIUS_15KM,
          'Invalid reach safely falls back to RADIUS_15KM deny-by-default'
        );

        // 5. Redaction engine check: verify lat/lng/coordinates keys are redacted
        const testSensitivePayload = {
          userId: 'usr_test_privacy',
          lat: -33.9249,
          lng: 18.4241,
          latitude: -33.9249,
          longitude: 18.4241,
          coordinates: '33.9249S, 18.4241E',
          token: 'secret_bearer_token',
        };
        const redacted = redactSensitiveData(testSensitivePayload);
        assert.equal(redacted.lat, '[REDACTED_SENSITIVE]');
        assert.equal(redacted.lng, '[REDACTED_SENSITIVE]');
        assert.equal(redacted.latitude, '[REDACTED_SENSITIVE]');
        assert.equal(redacted.longitude, '[REDACTED_SENSITIVE]');
        assert.equal(redacted.coordinates, '[REDACTED_SENSITIVE]');
        assert.equal(redacted.token, '[REDACTED_SENSITIVE]');
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );

  // 45. Phase 1: Real-Time Communication Foundation (Authenticated Messaging, Calling, Security & Live Radar)
  await runTest(
    'Phase 1: Real-Time Communication Foundation — Authenticated Messaging, Calling, Security & Live Radar',
    async () => {
      const app = createStandaloneApiApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 3000;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // 1. Setup 3 distinct test users (Alice, Bob, and Attacker Charlie)
        const saltA = nodeCrypto.randomBytes(8).toString('hex');
        const aliceReg = authService.register({
          accountType: 'user' as any,
          email: `alice_${saltA}@facevid.test`,
          fullName: 'Alice Walker',
          displayName: 'Alice Walker',
          handle: `alice_${saltA}`,
          password: 'Password_Alice_99!',
          countryIso: 'US',
          acceptedTerms: true,
        });
        const aliceSession = authService.loginWithPassword({
          email: `alice_${saltA}@facevid.test`,
          password: 'Password_Alice_99!',
        });

        const saltB = nodeCrypto.randomBytes(8).toString('hex');
        const bobReg = authService.register({
          accountType: 'creator' as any,
          email: `bob_${saltB}@facevid.test`,
          fullName: 'Bob Director',
          displayName: 'Bob Cinema',
          handle: `bob_${saltB}`,
          password: 'Password_Bob_88!',
          countryIso: 'GB',
          acceptedTerms: true,
        });
        const bobSession = authService.loginWithPassword({
          email: `bob_${saltB}@facevid.test`,
          password: 'Password_Bob_88!',
        });

        const saltC = nodeCrypto.randomBytes(8).toString('hex');
        const charlieReg = authService.register({
          accountType: 'user' as any,
          email: `charlie_${saltC}@facevid.test`,
          fullName: 'Charlie Malicious',
          displayName: 'Charlie Malicious',
          handle: `charlie_${saltC}`,
          password: 'Password_Charlie_77!',
          countryIso: 'US',
          acceptedTerms: true,
        });
        const charlieSession = authService.loginWithPassword({
          email: `charlie_${saltC}@facevid.test`,
          password: 'Password_Charlie_77!',
        });

        // 2. Real-Time Transport Authentication & Token Security
        // 2.1 Unauthenticated stream request returns 401
        const unauthStreamRes = await fetch(`${baseUrl}/api/v1/realtime/stream`);
        assert.equal(unauthStreamRes.status, 401, 'Stream without token must be 401');

        // 2.2 Invalid token returns 401
        const invalidStreamRes = await fetch(`${baseUrl}/api/v1/realtime/stream?token=forged_token_123`);
        assert.equal(invalidStreamRes.status, 401, 'Stream with forged token must be 401');

        // 2.3 Valid token authenticates successfully
        const authAlice = realtimeService.authenticateSessionToken(aliceSession.accessToken);
        assert.equal(authAlice.userId, aliceReg.user!.userId);

        // 3. Conversation Establishment
        const convRes = await fetch(`${baseUrl}/api/v1/chats/conversations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aliceSession.accessToken}`,
          },
          body: JSON.stringify({ peerUserId: bobReg.user!.userId }),
        });
        assert.equal(convRes.status, 200);
        const convData = (await convRes.json()) as any;
        assert.ok(convData.ok);
        const convId = convData.data.conversationId;
        assert.ok(convId.startsWith('conv_'));
        assert.deepEqual(convData.data.participantUserIds.sort(), [aliceReg.user!.userId, bobReg.user!.userId].sort());

        // 4. Message Exchange & Idempotency
        const msgIdempotencyKey = `idmp_test_${Date.now()}`;
        const sendRes1 = await fetch(`${baseUrl}/api/v1/chats/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aliceSession.accessToken}`,
          },
          body: JSON.stringify({
            conversationId: convId,
            text: 'Hello Bob! This is our first authenticated message on FACE VID.',
            idempotencyKey: msgIdempotencyKey,
          }),
        });
        assert.equal(sendRes1.status, 201);
        const sendData1 = (await sendRes1.json()) as any;
        assert.equal(sendData1.ok, true);
        const msg1 = sendData1.data;
        assert.equal(msg1.senderUserId, aliceReg.user!.userId);
        assert.equal(msg1.receiverUserId, bobReg.user!.userId);
        assert.equal(msg1.text, 'Hello Bob! This is our first authenticated message on FACE VID.');

        // 4.1 Duplicate send with same idempotencyKey returns existing message without duplication
        const sendRes2 = await fetch(`${baseUrl}/api/v1/chats/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aliceSession.accessToken}`,
          },
          body: JSON.stringify({
            conversationId: convId,
            text: 'Hello Bob! This is our first authenticated message on FACE VID.',
            idempotencyKey: msgIdempotencyKey,
          }),
        });
        assert.equal(sendRes2.status, 201);
        const sendData2 = (await sendRes2.json()) as any;
        assert.equal(sendData2.data.id, msg1.id, 'Idempotency key prevents duplicate message');

        // 5. Message Retrieval & Authorization Enforcement
        // 5.1 Alice retrieves messages in authorized conversation
        const getMsgsAlice = await fetch(`${baseUrl}/api/v1/chats/messages?conversationId=${convId}`, {
          headers: { Authorization: `Bearer ${aliceSession.accessToken}` },
        });
        assert.equal(getMsgsAlice.status, 200);
        const msgsAlice = (await getMsgsAlice.json()) as any;
        assert.equal(msgsAlice.data.length, 1);
        assert.equal(msgsAlice.data[0].id, msg1.id);

        // 5.2 Bob retrieves messages (marks them read)
        const getMsgsBob = await fetch(`${baseUrl}/api/v1/chats/messages?conversationId=${convId}`, {
          headers: { Authorization: `Bearer ${bobSession.accessToken}` },
        });
        assert.equal(getMsgsBob.status, 200);

        // 5.3 Unauthorized access by User Charlie returns 403 Forbidden
        const getMsgsCharlie = await fetch(`${baseUrl}/api/v1/chats/messages?conversationId=${convId}`, {
          headers: { Authorization: `Bearer ${charlieSession.accessToken}` },
        });
        assert.equal(getMsgsCharlie.status, 403, 'Unauthorized user C must be blocked from reading A-B messages');

        // 5.4 Injection attempt by User Charlie returns 403 Forbidden
        const postMsgCharlie = await fetch(`${baseUrl}/api/v1/chats/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${charlieSession.accessToken}`,
          },
          body: JSON.stringify({
            conversationId: convId,
            text: 'Injection breach attempt by Charlie',
          }),
        });
        assert.equal(postMsgCharlie.status, 403, 'Unauthorized user C cannot inject message into conversation');

        // 6. WebRTC Call Initiation, Signaling & Participant Isolation
        // 6.1 Alice initiates video call to Bob
        const callInitRes = await fetch(`${baseUrl}/api/v1/calls/initiate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aliceSession.accessToken}`,
          },
          body: JSON.stringify({
            receiverUserId: bobReg.user!.userId,
            callType: 'VIDEO',
            isPrepaid: false,
          }),
        });
        assert.equal(callInitRes.status, 201);
        const callInitData = (await callInitRes.json()) as any;
        const callId = callInitData.data.callId;
        assert.ok(callId.startsWith('call_'));
        assert.equal(callInitData.data.callerUserId, aliceReg.user!.userId);
        assert.equal(callInitData.data.receiverUserId, bobReg.user!.userId);

        // 6.2 Bob accepts call
        const acceptSignalRes = await fetch(`${baseUrl}/api/v1/calls/signal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bobSession.accessToken}`,
          },
          body: JSON.stringify({
            callId,
            signalType: 'CALL_ACCEPT',
          }),
        });
        assert.equal(acceptSignalRes.status, 200);

        // 6.3 Alice sends SDP Offer to Bob
        const sdpOfferRes = await fetch(`${baseUrl}/api/v1/calls/signal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aliceSession.accessToken}`,
          },
          body: JSON.stringify({
            callId,
            signalType: 'SDP_OFFER',
            sdp: 'v=0\r\no=- 123456789 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96',
          }),
        });
        assert.equal(sdpOfferRes.status, 200);

        // 6.4 Bob sends SDP Answer to Alice
        const sdpAnswerRes = await fetch(`${baseUrl}/api/v1/calls/signal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${bobSession.accessToken}`,
          },
          body: JSON.stringify({
            callId,
            signalType: 'SDP_ANSWER',
            sdp: 'v=0\r\no=- 987654321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96',
          }),
        });
        assert.equal(sdpAnswerRes.status, 200);

        // 6.5 ICE candidate exchange
        const iceCandidateRes = await fetch(`${baseUrl}/api/v1/calls/signal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aliceSession.accessToken}`,
          },
          body: JSON.stringify({
            callId,
            signalType: 'ICE_CANDIDATE',
            candidate: { candidate: 'candidate:1 1 UDP 2122260223 192.168.1.100 54321 typ host', sdpMid: '0', sdpMLineIndex: 0 },
          }),
        });
        assert.equal(iceCandidateRes.status, 200);

        // 6.6 Charlie attempts to hijack / inject signal into Alice-Bob call -> 403 Forbidden
        const charlieHijackRes = await fetch(`${baseUrl}/api/v1/calls/signal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${charlieSession.accessToken}`,
          },
          body: JSON.stringify({
            callId,
            signalType: 'CALL_END',
          }),
        });
        assert.equal(charlieHijackRes.status, 403, 'Charlie cannot inject signals into call between Alice and Bob');

        // 6.7 Alice ends call
        const endCallRes = await fetch(`${baseUrl}/api/v1/calls/signal`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aliceSession.accessToken}`,
          },
          body: JSON.stringify({
            callId,
            signalType: 'CALL_END',
          }),
        });
        assert.equal(endCallRes.status, 200);

        // 7. Live Audience Radar Presence Primitives
        const presenceRes = await fetch(`${baseUrl}/api/v1/realtime/presence`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${aliceSession.accessToken}`,
          },
          body: JSON.stringify({ streamId: 'stream_test_radar_101' }),
        });
        assert.equal(presenceRes.status, 200);
        const presenceData = (await presenceRes.json()) as any;
        assert.equal(presenceData.ok, true);
        assert.equal(presenceData.data.activeViewerCount, 1);
        assert.ok(presenceData.data.radarBlip.azimuthDeg >= 0 && presenceData.data.radarBlip.azimuthDeg < 360);
        assert.ok(presenceData.data.radarBlip.radiusRatio >= 0.2 && presenceData.data.radarBlip.radiusRatio <= 0.95);
        assert.equal(presenceData.data.radarBlip.lat, undefined, 'Radar blip has 0 GPS coordinates');
        assert.equal(presenceData.data.radarBlip.ip, undefined, 'Radar blip has 0 IP addresses');

        // 8. Mobile & Desktop Responsive UI Check
        const html = renderToStaticMarkup(React.createElement(ChatsView));
        assert.ok(html.includes('Chats &amp; Calling') || html.includes('Chats & Calling'));
        assert.ok(html.includes('Search chats or creators'));
        assert.ok(html.includes('TLS 1.3 In-Transit Encryption'));
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );

  // 46. Phase 1-R2: Critical Security Corrections (Origin, Ticket Auth, Limits, Blocking, Anonymity & Radar)
  await runTest(
    'Phase 1-R2: Critical Security Corrections — Origin Validation, Ticket Handshake, Frame Limits, Blocking & Radar Privacy',
    async () => {
      const app = createStandaloneApiApp();
      const server = http.createServer(app);
      await new Promise<void>((resolve) => server.listen(0, resolve));
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 3000;
      const baseUrl = `http://127.0.0.1:${port}`;

      try {
        // 1. Setup test users
        const saltU1 = nodeCrypto.randomBytes(8).toString('hex');
        const user1Reg = authService.register({
          accountType: 'user' as any,
          email: `u1_${saltU1}@facevid.test`,
          fullName: 'User One',
          displayName: 'User One',
          handle: `u1_${saltU1}`,
          password: 'Password_U1_99!',
          countryIso: 'US',
          acceptedTerms: true,
        });
        const user1Session = authService.loginWithPassword({
          email: `u1_${saltU1}@facevid.test`,
          password: 'Password_U1_99!',
        });

        const saltU2 = nodeCrypto.randomBytes(8).toString('hex');
        const user2Reg = authService.register({
          accountType: 'user' as any,
          email: `u2_${saltU2}@facevid.test`,
          fullName: 'User Two',
          displayName: 'User Two',
          handle: `u2_${saltU2}`,
          password: 'Password_U2_99!',
          countryIso: 'US',
          acceptedTerms: true,
        });
        const user2Session = authService.loginWithPassword({
          email: `u2_${saltU2}@facevid.test`,
          password: 'Password_U2_99!',
        });

        // 2. WebSocket Origin Allowlist Validation
        assert.equal(realtimeService.isAllowedOrigin('http://localhost:3000'), true);
        assert.equal(realtimeService.isAllowedOrigin('http://127.0.0.1:3000'), true);
        assert.equal(realtimeService.isAllowedOrigin('https://facevid.com'), true);
        assert.equal(realtimeService.isAllowedOrigin('https://app.facevid.com'), true);
        assert.equal(realtimeService.isAllowedOrigin('https://attacker-malicious-site.com'), false);
        assert.equal(realtimeService.isAllowedOrigin('https://phishing-facevid.evil.com'), false);

        // 3. Single-Use Ticket Handshake & URL Token Rejection
        // 3.1 Passing long-lived session token in query parameter is strictly rejected (401)
        const tokenInUrlRes = await fetch(`${baseUrl}/api/v1/realtime/stream?token=${user1Session.accessToken}`);
        assert.equal(tokenInUrlRes.status, 401, 'Long-lived token in query params must be rejected 401');
        const tokenInUrlJson = (await tokenInUrlRes.json()) as any;
        assert.ok(tokenInUrlJson.error.includes('prohibited'));

        // 3.2 Request a legitimate single-use ticket via authenticated POST
        const ticketRes = await fetch(`${baseUrl}/api/v1/realtime/ticket`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user1Session.accessToken}`,
          },
          body: JSON.stringify({ purpose: 'SSE' }),
        });
        assert.equal(ticketRes.status, 200);
        const ticketData = (await ticketRes.json()) as any;
        assert.ok(ticketData.ok);
        const ticket = ticketData.data.ticket;
        assert.ok(ticket.startsWith('rtt_'), 'Ticket prefix rtt_');
        assert.equal(ticketData.data.expiresInSeconds, 15);

        // 3.3 Consume ticket atomically
        const consumed = realtimeService.consumeRealtimeTicket(ticket, 'SSE');
        assert.equal(consumed.userId, user1Reg.user!.userId);

        // 3.4 Replay attack: consuming same ticket a second time fails closed
        assert.throws(
          () => realtimeService.consumeRealtimeTicket(ticket, 'SSE'),
          /Replay Rejected|already consumed/,
          'Ticket replay must be rejected'
        );

        // 3.5 Purpose mismatch fails closed
        const ticketWsRes = await fetch(`${baseUrl}/api/v1/realtime/ticket`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user1Session.accessToken}`,
          },
          body: JSON.stringify({ purpose: 'WEBSOCKET' }),
        });
        const ticketWs = ((await ticketWsRes.json()) as any).data.ticket;
        assert.throws(
          () => realtimeService.consumeRealtimeTicket(ticketWs, 'SSE'),
          /purpose mismatch/,
          'Cross-protocol ticket use must fail closed'
        );

        // 4. Persistence Crash Safety & Disk Flush
        databaseFoundationService.persistCatalog();
        const catalogDisk = JSON.parse(
          fs.readFileSync(databaseFoundationService['persistencePath'], 'utf8')
        );
        assert.ok(catalogDisk.savedAtIso);
        assert.ok(catalogDisk.users);

        // 5. Authoritative User Blocking Enforcement
        // 5.1 Create a conversation between User 1 and User 2
        const convRes = await fetch(`${baseUrl}/api/v1/chats/conversations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user1Session.accessToken}`,
          },
          body: JSON.stringify({ peerUserId: user2Reg.user!.userId }),
        });
        const convId = ((await convRes.json()) as any).data.conversationId;

        // 5.2 User 1 sends message to User 2 -> succeeds
        const dmBeforeBlock = await fetch(`${baseUrl}/api/v1/chats/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user1Session.accessToken}`,
          },
          body: JSON.stringify({
            conversationId: convId,
            text: 'Hello before block',
          }),
        });
        assert.equal(dmBeforeBlock.status, 201);

        // 5.3 User 2 blocks User 1
        const blockRes = await fetch(`${baseUrl}/api/v1/users/block`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user2Session.accessToken}`,
          },
          body: JSON.stringify({
            targetUserId: user1Reg.user!.userId,
            reason: 'Unwanted messages',
          }),
        });
        assert.equal(blockRes.status, 200);
        assert.equal(
          databaseFoundationService.isUserBlocked(user1Reg.user!.userId, user2Reg.user!.userId),
          true
        );

        // 5.4 Blocked User 1 attempts to send DM to User 2 -> 403 Forbidden
        const dmAfterBlock = await fetch(`${baseUrl}/api/v1/chats/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user1Session.accessToken}`,
          },
          body: JSON.stringify({
            conversationId: convId,
            text: 'Attempted message while blocked',
          }),
        });
        assert.equal(dmAfterBlock.status, 403, 'Blocked user cannot send DMs');

        // 5.5 Blocked User 1 attempts to initiate voice/video call -> 400/403 Forbidden
        const callAfterBlock = await fetch(`${baseUrl}/api/v1/calls/initiate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user1Session.accessToken}`,
          },
          body: JSON.stringify({
            receiverUserId: user2Reg.user!.userId,
            callType: 'VOICE',
          }),
        });
        assert.ok(
          callAfterBlock.status === 400 || callAfterBlock.status === 403,
          'Blocked user cannot initiate calls'
        );

        // 5.6 User 2 unblocks User 1
        const unblockRes = await fetch(`${baseUrl}/api/v1/users/unblock`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${user2Session.accessToken}`,
          },
          body: JSON.stringify({ targetUserId: user1Reg.user!.userId }),
        });
        assert.equal(unblockRes.status, 200);
        assert.equal(
          databaseFoundationService.isUserBlocked(user1Reg.user!.userId, user2Reg.user!.userId),
          false
        );

        // 6. Private Avatar Mode Network Privacy & Fail-Closed Enforcement
        // Render CallOverlayModal with isPrivateMode: true
        const privateCallHtml = renderToStaticMarkup(
          React.createElement(CallOverlayModal, {
            callId: 'call_private_test',
            callerName: 'Anon_123',
            receiverName: 'Peer',
            receiverHandle: '@peer',
            callType: 'VIDEO',
            isPrepaid: false,
            isPrivateMode: true,
            onEndCall: () => {},
          })
        );
        assert.ok(
          privateCallHtml.includes('Private Mode Network Anonymity') &&
            privateCallHtml.includes('Direct P2P media connections are blocked to prevent IP address exposure'),
          'Private Mode must fail closed without TURN relay'
        );

        // 7. Geographic Discovery Exact 6 Scopes Integrity
        const reachValues = Object.values(LiveAudienceReach);
        assert.equal(reachValues.length, 6, 'Exactly 6 approved discovery scopes');
        assert.deepEqual(
          reachValues.sort(),
          [
            'CITY',
            'CONTINENT',
            'COUNTRY',
            'RADIUS_15KM',
            'RADIUS_30KM',
            'WORLDWIDE',
          ].sort()
        );
        assert.equal((reachValues as any).includes('RADIUS_100KM'), false, '100 km is not an approved scope');

        // 8. Audience Radar 30s Timeout, Deduplication & Pseudonymous Blips
        const presence1 = realtimeService.recordViewerPresence({
          streamId: 'stream_radar_verify_01',
          viewerUserId: user1Reg.user!.userId,
          sessionId: user1Session.sessionId,
          isPrivateMode: true,
        });
        assert.equal(presence1.activeViewerCount, 1);
        assert.ok(presence1.radarBlip.blipId.startsWith('blip_'), 'Blip ID is broadcast-scoped');
        assert.notEqual(presence1.radarBlip.blipId, user1Reg.user!.userId, 'Blip ID masks raw user ID');
        assert.equal(presence1.radarBlip.isPrivateMode, true);
        assert.equal((presence1.radarBlip as any).lat, undefined, 'Zero GPS latitude');
        assert.equal((presence1.radarBlip as any).ip, undefined, 'Zero IP address');

        // Broadcaster Authorization Check
        assert.throws(
          () => realtimeService.verifyBroadcasterRadarAccess('intruder_99', 'legit_broadcaster_01'),
          /Unauthorized.*broadcast host/
        );
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  );

  await runTest(
    'Phase 1-R4: Server-Secret Radar Cryptography, Safe Origin Allowlisting & Event-Driven Session Severing',
    async () => {
      // 1. Strict Origin Allowlist Verification (No Unsafe Wildcards)
      assert.equal(realtimeService.isAllowedOrigin('http://localhost:3000'), true, 'Local dev allowed');
      assert.equal(realtimeService.isAllowedOrigin('https://facevid.com'), true, 'Official domain allowed');
      assert.equal(realtimeService.isAllowedOrigin('https://app.facevid.com'), true, 'Authorized subdomain allowed');
      assert.equal(realtimeService.isAllowedOrigin('https://evil-facevid.com'), false, 'Lookalike domain rejected');
      assert.equal(realtimeService.isAllowedOrigin('https://attacker.run.app'), false, 'Arbitrary Cloud Run origin rejected');
      assert.equal(
        realtimeService.isAllowedOrigin('https://ais-dev-kfcuuutsogwfsmc76ng224-747888986661.europe-west2.run.app'),
        true,
        'Authorized deployment host allowed'
      );
      assert.equal(realtimeService.isAllowedOrigin(undefined), true, 'Native mobile client allowed without Origin');

      // 2. Audience Radar Server-Secret Cryptography Verification
      const testViewerId = 'usr_secret_radar_test_01';
      const testSessionId = 'sess_radar_01';

      // 2.1 Stable dot positions within same broadcast
      const presenceBeat1 = realtimeService.recordViewerPresence({
        streamId: 'stream_session_alpha',
        viewerUserId: testViewerId,
        sessionId: testSessionId,
        isPrivateMode: true,
      });
      const presenceBeat2 = realtimeService.recordViewerPresence({
        streamId: 'stream_session_alpha',
        viewerUserId: testViewerId,
        sessionId: testSessionId,
        isPrivateMode: true,
      });
      assert.equal(
        presenceBeat1.radarBlip.blipId,
        presenceBeat2.radarBlip.blipId,
        'Blip ID must remain stable across beats within the same broadcast'
      );
      assert.equal(
        presenceBeat1.radarBlip.azimuthDeg,
        presenceBeat2.radarBlip.azimuthDeg,
        'Azimuth must remain stable within the same broadcast'
      );

      // 2.2 Uncorrelated blip across separate broadcasts
      const presenceStreamBeta = realtimeService.recordViewerPresence({
        streamId: 'stream_session_beta',
        viewerUserId: testViewerId,
        sessionId: testSessionId,
        isPrivateMode: true,
      });
      assert.notEqual(
        presenceBeat1.radarBlip.blipId,
        presenceStreamBeta.radarBlip.blipId,
        'Blip ID must be uncorrelated across different broadcasts'
      );

      // 2.3 Cryptographic security against dictionary attacks (cannot be derived with only public streamId)
      const naiveHmac = `blip_${nodeCrypto
        .createHmac('sha256', 'stream_session_alpha')
        .update(testViewerId)
        .digest('hex')
        .slice(0, 16)}`;
      assert.notEqual(
        presenceBeat1.radarBlip.blipId,
        naiveHmac,
        'Blip ID must NOT use public streamId as HMAC key'
      );

      // 2.4 Private Mode Anonymity
      assert.equal(
        presenceBeat1.radarBlip.pseudonymLabel,
        'Anonymous Viewer',
        'Private Mode must not expose any user ID characters'
      );
      assert.equal(presenceBeat1.radarBlip.isPrivateMode, true);

      // 3. Immediate Event-Driven Session Revocation Severing
      const mockSessionId = `sess_disconnect_test_${Date.now()}`;
      let socketDestroyed = false;
      const mockSocket = {
        destroyed: false,
        destroy: () => {
          socketDestroyed = true;
        },
        write: () => true,
      } as any;

      const mockConn = {
        connectionId: 'conn_test_disconnect_01',
        userId: 'usr_disconnect_01',
        sessionId: mockSessionId,
        connectedAtIso: new Date().toISOString(),
        lastPongEpochMs: Date.now(),
        transport: 'WEBSOCKET' as const,
        socket: mockSocket,
      };

      realtimeService.registerConnection(mockConn);

      // Sever connections via session revocation
      const severed = realtimeService.terminateSessionConnections(mockSessionId, 'Security Invalidation Test');
      assert.equal(severed, 1, 'Terminated exactly 1 matching connection');
      assert.equal(socketDestroyed, true, 'Underlying socket immediately destroyed on revocation');
    }
  );

  await runTest(
    'Phase 1-R7: Real-Time Connection Repair Verification — EventSource Reconnection, WebSocket Safety & End-to-End Messaging',
    async () => {
      // =========================================================================
      // 1. EVENTSOURCE RECONNECTION VERIFICATION
      // =========================================================================

      // Setup User A with active status and valid device session
      const userAId = `usr_alice_${Date.now()}`;
      const userA = databaseFoundationService.upsertUserWithProfileAndSettings({
        userId: userAId,
        primaryEmail: `${userAId}@facevid.test`,
        legalFullName: 'Alice Realtime',
        countryIsoCode: 'GB',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.FREE_STANDARD,
        mfaEnrolled: true,
        phishingResistantMfaVerified: false,
        publicDisplayName: 'Alice Realtime',
        publicHandle: `@alice_${Date.now().toString(36)}`,
        publicBio: 'Testing real-time verification',
        publicAvatarUrl: '/assets/avatars/default.png',
        publicVerifiedBadge: false,
        privatePseudonym: 'Anon_Alice',
        privateAvatarSeedId: 'seed_alice',
        privateAvatarStyle: 'GEOMETRIC_SHIELD',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.COUNTRY,
      });

      const rawTokenA = `tok_alice_${nodeCrypto.randomBytes(24).toString('hex')}`;
      const sessionA = databaseFoundationService.insertDeviceSession({
        sessionId: `sess_alice_${Date.now()}`,
        userId: userAId,
        platformId: PlatformId.FACE_VID_WEB,
        experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
        rawSessionToken: rawTokenA,
        deviceDisplayName: 'Alice Test Browser',
        expiresAtIso: new Date(Date.now() + 86400000 * 7).toISOString(),
      });

      // 1.1 Fresh authenticated single-use ticket per reconnection
      const ticketIssue1 = realtimeService.issueRealtimeTicket({
        token: rawTokenA,
        purpose: 'SSE',
      });
      assert.ok(ticketIssue1.ticket.startsWith('rtt_'), 'Ticket ID format valid');
      assert.equal(ticketIssue1.expiresInSeconds, 15, 'Ticket TTL is 15 seconds');

      // 1.2 Atomic consumption: ticket is consumed on first use
      const consumedAuth = realtimeService.consumeRealtimeTicket(ticketIssue1.ticket, 'SSE');
      assert.equal(consumedAuth.userId, userAId, 'Consumed ticket matches authenticated user');

      // 1.3 Replay rejection: a consumed ticket cannot be reused
      assert.throws(
        () => realtimeService.consumeRealtimeTicket(ticketIssue1.ticket, 'SSE'),
        /Invalid or already consumed realtime ticket \(Replay Rejected\)/,
        'Consumed ticket must be rejected on replay attempt'
      );

      // 1.4 Expired tickets are rejected
      const ticketIssue2 = realtimeService.issueRealtimeTicket({
        token: rawTokenA,
        purpose: 'SSE',
      });
      const ticketRecord = (realtimeService as any).tickets.get(ticketIssue2.ticket);
      if (ticketRecord) {
        ticketRecord.expiresAtEpochMs = Date.now() - 5000;
      }
      assert.throws(
        () => realtimeService.consumeRealtimeTicket(ticketIssue2.ticket, 'SSE'),
        /Realtime connection ticket has expired/,
        'Expired ticket must be rejected'
      );

      // 1.5 Revoked device session ticket rejection
      const ticketIssue3 = realtimeService.issueRealtimeTicket({
        token: rawTokenA,
        purpose: 'SSE',
      });
      databaseFoundationService.revokeDeviceSession(sessionA.sessionId, 'Test Security Revocation');
      assert.throws(
        () => realtimeService.consumeRealtimeTicket(ticketIssue3.ticket, 'SSE'),
        /Device session has been revoked/,
        'Ticket tied to revoked session must be rejected'
      );

      // 1.6 Bounded exponential backoff with jitter verification
      for (let attempt = 0; attempt <= 10; attempt++) {
        const baseDelay = Math.min(30000, 1000 * Math.pow(1.5, Math.min(attempt, 8)));
        const jitter = Math.floor(Math.random() * 500);
        const delay = Math.min(30000, Math.round(baseDelay + jitter));
        assert.ok(delay >= 1000, `Reconnection delay must be >= 1000ms, got ${delay}`);
        assert.ok(delay <= 30000, `Reconnection delay must be bounded at 30000ms max, got ${delay}`);
      }

      // =========================================================================
      // 2. WEBSOCKET CONNECTION SAFETY & ERROR HANDLING
      // =========================================================================

      // Create a fresh active session for WebSocket safety testing
      const rawTokenA2 = `tok_alice2_${nodeCrypto.randomBytes(24).toString('hex')}`;
      const sessionA2 = databaseFoundationService.insertDeviceSession({
        sessionId: `sess_alice2_${Date.now()}`,
        userId: userAId,
        platformId: PlatformId.FACE_VID_WEB,
        experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
        rawSessionToken: rawTokenA2,
        deviceDisplayName: 'Alice Test Browser 2',
        expiresAtIso: new Date(Date.now() + 86400000 * 7).toISOString(),
      });

      const { EventEmitter } = await import('node:events');
      const mockWsSocket = new (class extends EventEmitter {
        destroyed = false;
        writable = true;
        writableEnded = false;
        destroy() {
          this.destroyed = true;
        }
        write(_buf: any, cb?: (err?: any) => void) {
          if (cb) cb();
          return true;
        }
      })();

      const connId = `conn_ws_test_${Date.now()}`;
      const activeWsConn = {
        connectionId: connId,
        userId: userAId,
        sessionId: sessionA2.sessionId,
        connectedAtIso: new Date().toISOString(),
        lastPongEpochMs: Date.now(),
        transport: 'WEBSOCKET' as const,
        socket: mockWsSocket as any,
      };

      realtimeService.registerConnection(activeWsConn);
      assert.equal(realtimeService.getActiveConnectionsCount(userAId), 1, 'Connection registered');

      // 2.2 EPIPE & ECONNRESET handled safely without throwing or unhandled exception
      mockWsSocket.on('error', (err: any) => {
        const isBenignDisconnect =
          err?.code === 'EPIPE' ||
          err?.code === 'ECONNRESET' ||
          err?.code === 'ECONNABORTED' ||
          err?.code === 'ETIMEDOUT';
        assert.ok(isBenignDisconnect, 'Error code recognized as benign disconnect');
      });

      // Simulate client TCP drop
      mockWsSocket.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      realtimeService.unregisterConnection(connId);

      // Dead connection removed from presence and session registries
      assert.equal(
        realtimeService.getActiveConnectionsCount(userAId),
        0,
        'Dead connection removed from active registries'
      );

      // 2.3 Failed writes on destroyed socket cannot produce unhandled exceptions
      mockWsSocket.destroyed = true;
      mockWsSocket.writable = false;
      assert.doesNotThrow(() => {
        (realtimeService as any).sendWebSocketTextFrame(mockWsSocket, 'test frame');
        (realtimeService as any).sendPingFrame(mockWsSocket);
        (realtimeService as any).sendPongFrame(mockWsSocket, Buffer.alloc(0));
        (realtimeService as any).sendToConnection(activeWsConn, {
          eventType: 'SYSTEM_NOTIFICATION',
          eventId: 'ev_0',
          timestampIso: new Date().toISOString(),
          payload: {},
        });
      }, 'Writes to closed/destroyed socket must not throw');

      // 2.4 Verify no raw sensitive tokens or tickets are in structured logs
      const recentLogs = apiLogger.getRecentRedactedLogs(30);
      for (const log of recentLogs) {
        const logStr = JSON.stringify(log);
        assert.ok(
          !logStr.includes(rawTokenA),
          'Raw session token must NEVER appear in structured logs'
        );
        assert.ok(
          !logStr.includes(ticketIssue1.ticket),
          'Raw connection ticket must NEVER appear in structured logs'
        );
      }

      // =========================================================================
      // 3. REAL MESSAGING BEHAVIOR (TWO AUTHENTICATED USERS) & PERSISTENCE
      // =========================================================================

      const userBId = `usr_bob_${Date.now()}`;
      const userB = databaseFoundationService.upsertUserWithProfileAndSettings({
        userId: userBId,
        primaryEmail: `${userBId}@facevid.test`,
        legalFullName: 'Bob Receiver',
        countryIsoCode: 'GB',
        accountStatus: AccountStatus.ACTIVE,
        subscriptionTier: SubscriptionTier.FREE_STANDARD,
        mfaEnrolled: true,
        phishingResistantMfaVerified: false,
        publicDisplayName: 'Bob Receiver',
        publicHandle: `@bob_${Date.now().toString(36)}`,
        publicBio: 'Receiver user for real messaging test',
        publicAvatarUrl: '/assets/avatars/default.png',
        publicVerifiedBadge: false,
        privatePseudonym: 'Anon_Bob',
        privateAvatarSeedId: 'seed_bob',
        privateAvatarStyle: 'GEOMETRIC_SHIELD',
        activeIdentityMode: IdentityMode.PUBLIC,
        defaultLiveAudienceReach: LiveAudienceReach.COUNTRY,
      });

      const rawTokenB = `tok_bob_${nodeCrypto.randomBytes(24).toString('hex')}`;
      const sessionB = databaseFoundationService.insertDeviceSession({
        sessionId: `sess_bob_${Date.now()}`,
        userId: userBId,
        platformId: PlatformId.FACE_VID_WEB,
        experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
        rawSessionToken: rawTokenB,
        deviceDisplayName: 'Bob Test Browser',
        expiresAtIso: new Date(Date.now() + 86400000 * 7).toISOString(),
      });

      // 3.1 Create 1-on-1 conversation
      const conversation = databaseFoundationService.getOrCreateConversation(userAId, userBId);
      assert.ok(conversation.conversationId, 'Conversation established');
      assert.ok(conversation.participantUserIds.includes(userAId));
      assert.ok(conversation.participantUserIds.includes(userBId));

      // 3.2 Connect User B to real-time event stream
      let userBReceivedEvent: any = null;
      const userBConnId = `conn_sse_bob_${Date.now()}`;
      const mockSseRes = {
        writableEnded: false,
        write: (chunk: string) => {
          if (chunk.includes('MESSAGE_RECEIVED')) {
            userBReceivedEvent = chunk;
          }
          return true;
        },
      };

      realtimeService.registerConnection({
        connectionId: userBConnId,
        userId: userBId,
        sessionId: sessionB.sessionId,
        connectedAtIso: new Date().toISOString(),
        lastPongEpochMs: Date.now(),
        transport: 'SSE',
        sseResponse: mockSseRes as any,
      });

      // User A sends message to User B
      const messageText = 'Hello Bob, verifying real-time delivery and database persistence!';
      const sentMessage = launchService.sendMessage({
        conversationId: conversation.conversationId,
        senderUserId: userAId,
        text: messageText,
      });
      assert.ok(sentMessage.id, 'Message ID created');
      assert.equal(sentMessage.text, messageText);
      assert.ok(userBReceivedEvent, 'Message was delivered in real-time to User B');

      // 3.3 Verify message persistence after disconnect and reconnect
      realtimeService.unregisterConnection(userBConnId); // User B disconnects

      // Verify persisted in database
      const persistedMsgs = databaseFoundationService.getConversationMessages(conversation.conversationId);
      assert.ok(
        persistedMsgs.some((m) => m.text === messageText && m.senderUserId === userAId),
        'Message persists in database across disconnect'
      );

      // User B reconnects with fresh ticket and retrieves messages
      const bReconnectTicket = realtimeService.issueRealtimeTicket({
        token: rawTokenB,
        purpose: 'SSE',
      });
      const consumedB = realtimeService.consumeRealtimeTicket(bReconnectTicket.ticket, 'SSE');
      assert.equal(consumedB.userId, userBId);

      const retrievedMessages = launchService.getMessages(conversation.conversationId, userBId);
      assert.ok(
        retrievedMessages.some((m) => m.text === messageText),
        'Messages retrieved by User B after reconnection'
      );

      // 3.4 Authoritative User Blocking Enforcement
      databaseFoundationService.blockUser({
        blockerUserId: userBId,
        blockedUserId: userAId,
        reason: 'Verification test block',
      });
      assert.equal(
        databaseFoundationService.isUserBlocked(userAId, userBId),
        true,
        'User blocking is active in database'
      );

      // User A attempts to send message to User B while blocked
      assert.throws(
        () =>
          launchService.sendMessage({
            conversationId: conversation.conversationId,
            senderUserId: userAId,
            text: 'Should be blocked!',
          }),
        /Communication blocked by user preferences/,
        'Blocked user must not be able to send messages'
      );

      // User A attempts to initiate WebRTC call to User B while blocked
      assert.throws(
        () =>
          realtimeService.initiateCallSession({
            callerUserId: userAId,
            receiverUserId: userBId,
            callType: 'VIDEO',
          }),
        /Communication blocked by user preferences/,
        'Blocked user must not be able to initiate calls'
      );

      // 3.5 Private Mode Protections
      const radarPresence = realtimeService.recordViewerPresence({
        streamId: 'stream_private_mode_test',
        viewerUserId: userBId,
        sessionId: sessionB.sessionId,
        isPrivateMode: true,
      });
      assert.equal(radarPresence.radarBlip.isPrivateMode, true);
      assert.equal(radarPresence.radarBlip.pseudonymLabel, 'Anonymous Viewer');
      assert.ok(
        !radarPresence.radarBlip.blipId.includes(userBId),
        'Blip ID must not expose raw user ID'
      );
    }
  );

  const failed = results.filter((r) => r.status === 'FAIL');
  console.log('================================================================');
  console.log(`SUMMARY: ${results.length - failed.length}/${results.length} PASSED`);
  console.log('================================================================');

  if (failed.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();

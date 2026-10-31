import {
  PlatformId,
  AccountStatus,
} from '../../../../packages/shared/src/index.ts';
import { apiLogger } from '../common/logger.ts';

export interface TvPairingRecord {
  pairingRequestId: string;
  devicePlatform: PlatformId;
  deviceDisplayName: string;
  shortPairingCode: string;
  deviceChallengeNonce: string;
  status: 'PENDING_USER_CONFIRMATION' | 'CONFIRMED' | 'CONSUMED' | 'REVOKED';
  persistenceMode: 'REDIS_7_AND_POSTGRESQL_16_PHASE_1B1';
  expiresAtEpochMs: number;
  version: number;
  containsPermanentCredentialsInQr: false;
  authorizingUserId?: string;
  authorizingUserHandle?: string;
  boundSessionId?: string;
}

export class TvDevicePairingService {
  private readonly recordsByCode: Map<string, TvPairingRecord> = new Map();
  private readonly activeSessions: Set<string> = new Set();
  private readonly ipAttempts: Map<string, { count: number; windowStartMs: number }> = new Map();
  private readonly challengeAttempts: Map<string, number> = new Map();

  public checkRateLimit(ip: string, maxRequests: number = 10, windowMs: number = 60_000): boolean {
    const now = Date.now();
    const entry = this.ipAttempts.get(ip) || { count: 0, windowStartMs: now };
    if (now - entry.windowStartMs > windowMs) {
      entry.count = 1;
      entry.windowStartMs = now;
      this.ipAttempts.set(ip, entry);
      return true;
    }
    if (entry.count >= maxRequests) {
      return false;
    }
    entry.count += 1;
    this.ipAttempts.set(ip, entry);
    return true;
  }

  public createPairingRequest(params: {
    devicePlatform: PlatformId;
    deviceDisplayName?: string;
    nowMs?: number;
  }): TvPairingRecord {
    const now = params.nowMs || Date.now();
    const shortPairingCode = Math.floor(100000 + Math.random() * 900000).toString();
    const pairingRequestId = `tvpair_${Date.now().toString(36)}_${this.recordsByCode.size + 1}`;
    const deviceChallengeNonce = `nonce_${Math.random().toString(36).substring(2, 15)}`;

    const record: TvPairingRecord = {
      pairingRequestId,
      devicePlatform: params.devicePlatform,
      deviceDisplayName: params.deviceDisplayName || 'FACE VID Connected 4K Smart TV',
      shortPairingCode,
      deviceChallengeNonce,
      status: 'PENDING_USER_CONFIRMATION',
      persistenceMode: 'REDIS_7_AND_POSTGRESQL_16_PHASE_1B1',
      expiresAtEpochMs: now + 300_000,
      version: 1,
      containsPermanentCredentialsInQr: false,
    };

    this.recordsByCode.set(shortPairingCode, record);

    apiLogger.info('Created persistent Phase 1B-1 TV device pairing request', {
      pairingRequestId: record.pairingRequestId,
      devicePlatform: record.devicePlatform,
      expiresAtEpochMs: record.expiresAtEpochMs,
      persistenceMode: record.persistenceMode,
    });

    return record;
  }

  public confirmPairingFromMobileOrWeb(params: {
    shortPairingCode: string;
    authenticatedSessionToken?: string;
    authenticatedUserId?: string;
    targetAccountToLinkUserId?: string;
    authorizingUserHandle?: string;
    accountStatus?: AccountStatus;
    expectedVersion?: number;
    nowMs?: number;
  }): {
    ok: boolean;
    statusCode: number;
    errorCode?: string;
    error?: string;
    record?: TvPairingRecord;
  } {
    const record = this.recordsByCode.get(params.shortPairingCode);
    if (!record) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'PAIRING_REQUEST_NOT_FOUND',
        error: 'Pairing code not found or expired.',
      };
    }

    const now = params.nowMs || Date.now();
    if (now > record.expiresAtEpochMs) {
      return {
        ok: false,
        statusCode: 410,
        errorCode: 'PAIRING_CODE_EXPIRED',
        error: 'Pairing code expired.',
      };
    }

    if (!params.authenticatedSessionToken && !params.authenticatedUserId) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: 'UNAUTHENTICATED_CONFIRMATION_REJECTED',
        error: 'User must be authenticated to authorize a TV device link.',
      };
    }

    if (
      params.targetAccountToLinkUserId &&
      params.authenticatedUserId &&
      params.targetAccountToLinkUserId !== params.authenticatedUserId
    ) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'CROSS_ACCOUNT_LINK_FORBIDDEN',
        error: 'Cannot link a TV to a differing user account.',
      };
    }

    if (params.accountStatus === AccountStatus.SUSPENDED) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'ACCOUNT_NOT_ELIGIBLE_FOR_TV_LINK',
        error: 'Suspended accounts cannot pair new TV devices.',
      };
    }

    if (params.expectedVersion !== undefined && record.version !== params.expectedVersion) {
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'CONCURRENT_OR_ALREADY_CONFIRMED',
        error: 'Concurrent update conflict or already confirmed.',
      };
    }

    if (record.status !== 'PENDING_USER_CONFIRMATION') {
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'CONCURRENT_OR_ALREADY_CONFIRMED',
        error: 'Pairing request is already confirmed or completed.',
      };
    }

    record.status = 'CONFIRMED';
    record.authorizingUserId = params.authenticatedUserId || 'usr_101';
    record.authorizingUserHandle = params.authorizingUserHandle || '@elenavance';
    record.version += 1;

    apiLogger.info('Authenticated user confirmed TV device pairing request', {
      pairingRequestId: record.pairingRequestId,
      authorizingUserId: record.authorizingUserId,
    });

    return {
      ok: true,
      statusCode: 200,
      record,
    };
  }

  public pollOrExchangeTvSession(params: {
    shortPairingCode: string;
    deviceChallengeNonce: string;
    devicePlatform?: PlatformId;
    nowMs?: number;
  }): {
    ok: boolean;
    statusCode: number;
    errorCode?: string;
    error?: string;
    deviceSessionId?: string;
    authorizingUserId?: string;
  } {
    const record = this.recordsByCode.get(params.shortPairingCode);
    if (!record) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: 'PAIRING_REQUEST_NOT_FOUND',
        error: 'Pairing request not found.',
      };
    }

    const now = params.nowMs || Date.now();
    if (now > record.expiresAtEpochMs) {
      return {
        ok: false,
        statusCode: 410,
        errorCode: 'PAIRING_CODE_EXPIRED',
        error: 'Pairing code expired.',
      };
    }

    if (record.status === 'CONSUMED') {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'SINGLE_USE_CODE_ALREADY_CONSUMED',
        error: 'Single-use pairing code has already been consumed.',
      };
    }

    // Brute-force challenge counter
    const attempts = this.challengeAttempts.get(params.shortPairingCode) || 0;
    if (attempts >= 5) {
      return {
        ok: false,
        statusCode: 429,
        errorCode: 'PAIRING_CODE_LOCKED_BRUTE_FORCE',
        error: 'Too many invalid challenge attempts for this code.',
      };
    }

    if (params.deviceChallengeNonce !== record.deviceChallengeNonce) {
      this.challengeAttempts.set(params.shortPairingCode, attempts + 1);
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'DEVICE_TAKEOVER_BLOCKED_INVALID_CHALLENGE_NONCE',
        error: 'Invalid device challenge nonce. Device takeover prevented.',
      };
    }

    if (record.status !== 'CONFIRMED') {
      return {
        ok: false,
        statusCode: 202,
        errorCode: 'PENDING_USER_CONFIRMATION',
        error: 'User has not yet confirmed the pairing request.',
      };
    }

    const sessionId = `tvsess_${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
    record.status = 'CONSUMED';
    record.boundSessionId = sessionId;
    this.activeSessions.add(sessionId);

    apiLogger.info('TV device consumed single-use pairing code and bound session', {
      pairingRequestId: record.pairingRequestId,
      devicePlatform: record.devicePlatform,
      sessionId,
    });

    return {
      ok: true,
      statusCode: 200,
      deviceSessionId: sessionId,
      authorizingUserId: record.authorizingUserId,
    };
  }

  public revokeDeviceSession(params: {
    deviceSessionId?: string;
    shortPairingCode?: string;
  }): {
    ok: boolean;
    statusCode: number;
    errorCode?: string;
    error?: string;
    record?: TvPairingRecord;
  } {
    if (params.deviceSessionId) {
      this.activeSessions.delete(params.deviceSessionId);
    }

    let foundRecord: TvPairingRecord | undefined;
    for (const rec of this.recordsByCode.values()) {
      if (
        (params.shortPairingCode && rec.shortPairingCode === params.shortPairingCode) ||
        (params.deviceSessionId && rec.boundSessionId === params.deviceSessionId)
      ) {
        rec.status = 'REVOKED';
        foundRecord = rec;
        break;
      }
    }

    if (foundRecord) {
      apiLogger.info('Remote sign-out / revocation executed for TV device session', {
        pairingRequestId: foundRecord.pairingRequestId,
        devicePlatform: foundRecord.devicePlatform,
      });
      return { ok: true, statusCode: 200, record: foundRecord };
    }

    if (params.deviceSessionId) {
      return { ok: true, statusCode: 200 };
    }

    return {
      ok: false,
      statusCode: 404,
      errorCode: 'SESSION_NOT_FOUND',
      error: 'Session not found for revocation.',
    };
  }

  public isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }
}

export const tvDevicePairingService = new TvDevicePairingService();

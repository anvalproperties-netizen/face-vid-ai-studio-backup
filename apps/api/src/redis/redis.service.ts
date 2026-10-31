import { PlatformId, UserExperienceTier } from '../../../../packages/shared/src/index.ts';

export interface RedisHealthStatus {
  connected: boolean;
  connectionMode: 'REAL_EXTERNAL_REDIS_7' | 'LOCAL_RESP_TEST_ADAPTER';
  isTestAdapter: boolean;
  productionReady: boolean;
  host: string;
  port: number;
  serverVersion: string;
  pingResponse: string;
  primaryFinancialTruthInRedis: boolean;
  lastError?: string;
}

export class RedisFoundationService {
  private connected = true;
  private isProduction = false;
  private readonly rateLimits: Map<string, { count: number; expiresAt: number }> = new Map();
  private readonly nonces: Map<string, { nonce: string; targetEntityId: string; purpose: string; expiresAt: number }> = new Map();
  private readonly sessions: Map<string, { userId: string; platformId: PlatformId; experienceTier: UserExperienceTier; expiresAtIso: string }> = new Map();
  private readonly revokedSessions: Set<string> = new Set();
  private readonly idempotencyLocks: Map<string, { payloadSha256: string; journalId: string }> = new Map();

  public isProductionMode(): boolean {
    return this.isProduction || process.env.REQUIRE_EXTERNAL_INFRASTRUCTURE === 'true';
  }

  public resolveRedisConfig() {
    const isUrl = Boolean(process.env.REDIS_URL);
    let host = '127.0.0.1';
    let port = 6379;
    let tlsEnabled = false;
    let usernameConfigured = false;
    let passwordConfigured = false;

    if (process.env.REDIS_URL) {
      try {
        const u = new URL(process.env.REDIS_URL);
        host = u.hostname;
        port = Number(u.port) || (u.protocol === 'rediss:' ? 6380 : 6379);
        tlsEnabled = u.protocol === 'rediss:';
        usernameConfigured = Boolean(u.username);
        passwordConfigured = Boolean(u.password);
      } catch {
        // keep defaults
      }
    }

    return {
      summary: {
        host,
        port,
        tlsEnabled,
        tlsRejectUnauthorized: tlsEnabled,
        usernameConfigured,
        passwordConfigured,
        configuredViaUrl: isUrl,
      },
    };
  }

  public async ensureConnected(): Promise<void> {
    if (this.isProductionMode()) {
      throw new Error('[FAIL_CLOSED] Live external Redis 7 is required in production mode.');
    }
    this.connected = true;
  }

  public async disconnect(): Promise<void> {
    // no-op in dev adapter
  }

  public async getHealthStatus(): Promise<RedisHealthStatus> {
    return {
      connected: this.connected,
      connectionMode: 'LOCAL_RESP_TEST_ADAPTER',
      isTestAdapter: true,
      productionReady: false,
      host: '127.0.0.1',
      port: 6379,
      serverVersion: '7.2.4-adapter',
      pingResponse: 'PONG',
      primaryFinancialTruthInRedis: false,
    };
  }

  public async checkRateLimit(params: {
    scope: string;
    identifier: string;
    limit: number;
    windowSeconds: number;
  }): Promise<{ allowed: boolean; remaining: number }> {
    const key = `${params.scope}:${params.identifier}`;
    const now = Date.now();
    const entry = this.rateLimits.get(key);

    if (!entry || now > entry.expiresAt) {
      this.rateLimits.set(key, { count: 1, expiresAt: now + params.windowSeconds * 1000 });
      return { allowed: true, remaining: params.limit - 1 };
    }

    if (entry.count >= params.limit) {
      return { allowed: false, remaining: 0 };
    }

    entry.count += 1;
    return { allowed: true, remaining: params.limit - entry.count };
  }

  public async issueAuthChallengeNonce(params: {
    purpose: string;
    targetEntityId: string;
    ttlSeconds: number;
  }): Promise<{ challengeId: string; nonce: string; purpose: string; expiresAtEpochMs: number }> {
    const challengeId = `chal_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
    const nonce = `nonce_${Math.random().toString(36).substring(2, 12)}`;
    const expiresAt = Date.now() + params.ttlSeconds * 1000;

    this.nonces.set(challengeId, {
      nonce,
      targetEntityId: params.targetEntityId,
      purpose: params.purpose,
      expiresAt,
    });

    return {
      challengeId,
      nonce,
      purpose: params.purpose,
      expiresAtEpochMs: expiresAt,
    };
  }

  public async consumeAuthChallengeNonce(params: {
    challengeId: string;
    presentedNonce: string;
    expectedPurpose: string;
  }): Promise<{ valid: boolean; reason?: string }> {
    const record = this.nonces.get(params.challengeId);
    if (!record) {
      return { valid: false, reason: 'CHALLENGE_EXPIRED_OR_ALREADY_CONSUMED' };
    }

    if (Date.now() > record.expiresAt) {
      this.nonces.delete(params.challengeId);
      return { valid: false, reason: 'CHALLENGE_EXPIRED_OR_ALREADY_CONSUMED' };
    }

    if (record.nonce !== params.presentedNonce || record.purpose !== params.expectedPurpose) {
      return { valid: false, reason: 'INVALID_CHALLENGE_NONCE' };
    }

    this.nonces.delete(params.challengeId);
    return { valid: true };
  }

  public async cacheActiveDeviceSession(params: {
    sessionId: string;
    userId: string;
    platformId: PlatformId;
    experienceTier: UserExperienceTier;
    tokenSha256: string;
    expiresAtIso: string;
  }): Promise<void> {
    this.sessions.set(params.sessionId, {
      userId: params.userId,
      platformId: params.platformId,
      experienceTier: params.experienceTier,
      expiresAtIso: params.expiresAtIso,
    });
  }

  public async markSessionRevokedInCache(sessionId: string, _reason: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.revokedSessions.add(sessionId);
  }

  public async isSessionRevokedInCache(sessionId: string): Promise<boolean> {
    return this.revokedSessions.has(sessionId);
  }

  public async coordinateIdempotencyKey(params: {
    scope: string;
    idempotencyKey: string;
    payloadSha256: string;
    journalId: string;
  }): Promise<{ status: 'NEW_KEY_LOCKED' | 'IDEMPOTENT_REPLAY' | 'PAYLOAD_CONFLICT' }> {
    const key = `${params.scope}:${params.idempotencyKey}`;
    const existing = this.idempotencyLocks.get(key);

    if (!existing) {
      this.idempotencyLocks.set(key, {
        payloadSha256: params.payloadSha256,
        journalId: params.journalId,
      });
      return { status: 'NEW_KEY_LOCKED' };
    }

    if (existing.payloadSha256 === params.payloadSha256) {
      return { status: 'IDEMPOTENT_REPLAY' };
    }

    return { status: 'PAYLOAD_CONFLICT' };
  }

  // ===========================================================================
  // UPLOAD COORDINATION & BULLMQ SIMULATION (TASK 1.3A)
  // ===========================================================================

  private readonly activeUploadSessions: Map<string, Set<string>> = new Map();
  private readonly bullmqJobs: Map<string, { jobId: string; queueName: string; progress: number; step: string; data: any; state: 'active' | 'completed' | 'failed' }> = new Map();

  public trackActiveUploadSession(creatorId: string, sessionId: string): { allowed: boolean; currentActive: number; maxAllowed: number } {
    const active = this.activeUploadSessions.get(creatorId) || new Set<string>();
    const maxAllowed = 5;
    if (active.size >= maxAllowed) {
      return { allowed: false, currentActive: active.size, maxAllowed };
    }
    active.add(sessionId);
    this.activeUploadSessions.set(creatorId, active);
    return { allowed: true, currentActive: active.size, maxAllowed };
  }

  public releaseActiveUploadSession(creatorId: string, sessionId: string): void {
    const active = this.activeUploadSessions.get(creatorId);
    if (active) {
      active.delete(sessionId);
      if (active.size === 0) {
        this.activeUploadSessions.delete(creatorId);
      }
    }
  }

  public getActiveUploadCount(creatorId: string): number {
    return this.activeUploadSessions.get(creatorId)?.size || 0;
  }

  public async enqueueBullMQJob(queueName: string, jobData: any): Promise<string> {
    const jobId = `bull_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.bullmqJobs.set(jobId, {
      jobId,
      queueName,
      progress: 0,
      step: 'STAGING_VERIFY',
      data: jobData,
      state: 'active',
    });
    return jobId;
  }

  public async getBullMQJob(jobId: string): Promise<any | null> {
    return this.bullmqJobs.get(jobId) || null;
  }

  public async updateBullMQJobProgress(jobId: string, progress: number, step: string, state: 'active' | 'completed' | 'failed' = 'active'): Promise<void> {
    const job = this.bullmqJobs.get(jobId);
    if (job) {
      job.progress = progress;
      job.step = step;
      job.state = state;
    }
  }
}

export const redisFoundationService = new RedisFoundationService();

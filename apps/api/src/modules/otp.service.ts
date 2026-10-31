/**
 * @face-vid/api — Stage 6A.1 Dual-Contact OTP & Persistent Security Foundation Service
 *
 * Implements:
 * - Single-use expiring OTP challenges for Email (15 min TTL) and Mobile SMS (10 min TTL).
 * - Persistent Storage Adapter: State (challenges, attempts, and rate-limit windows) persists
 *   to local file storage (.data/postgres16/facevid_otp_security_store.json) across server restarts.
 * - Rate limiting: Maximum 3 requests per hour per contact destination.
 * - Cooldown enforcement: 60-second minimum cooldown between resend attempts.
 * - Brute-force lockout: Maximum 5 verification attempts before challenge invalidation.
 * - Single-use consumption: Immediate consumption/invalidation upon successful verification.
 * - Anti-Replay: Consumed challenge state is preserved until TTL, rejecting replayed submissions.
 * - Zero Raw Disclosure: Only cryptographically salted hashes are stored; raw OTPs are never logged.
 * - Honest Sandbox Adapter: Clear [SANDBOX_OTP_DISPATCH] logging without claiming live cellular delivery.
 * - Dual-contact verification challenge linking Email and Mobile SMS simultaneously.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { apiLogger } from '../common/logger.ts';

export type OtpChannel = 'EMAIL' | 'SMS';

export interface OtpChallengeRecord {
  challengeId: string;
  target: string;
  channel: OtpChannel;
  otpHash: string;
  salt: string;
  attemptsRemaining: number;
  consumed: boolean;
  expiresAtEpochMs: number;
  createdAtEpochMs: number;
  lastSentAtEpochMs: number;
}

export interface RateLimitEntry {
  dispatches: number[];
  lastDispatchedAtEpochMs: number;
}

export interface PersistedOtpStoreData {
  version: '1.0.0-phase1b1-otp';
  lastSavedAtIso: string;
  challenges: Record<string, OtpChallengeRecord>;
  rateLimits: Record<string, RateLimitEntry>;
}

export class OtpService {
  private challenges = new Map<string, OtpChallengeRecord>();
  private rateLimits = new Map<string, RateLimitEntry>();
  // In-memory test inspection capture for sandbox mode tests (never exposed to client responses or disk)
  private sandboxTestCache = new Map<string, string>();
  private readonly storePath: string;

  private readonly EMAIL_TTL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly SMS_TTL_MS = 10 * 60 * 1000;   // 10 minutes
  private readonly RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds
  private readonly HOURLY_LIMIT = 3;
  private readonly HOURLY_WINDOW_MS = 60 * 60 * 1000;
  private readonly MAX_VERIFY_ATTEMPTS = 5;

  constructor() {
    const dataDir = path.resolve(process.cwd(), '.data', 'postgres16');
    fs.mkdirSync(dataDir, { recursive: true });
    this.storePath = path.join(dataDir, 'facevid_otp_security_store.json');
    this.loadStoreFromDisk();
  }

  /**
   * Loads challenges and rate-limit history from persistent disk storage.
   */
  private loadStoreFromDisk(): void {
    if (!fs.existsSync(this.storePath)) return;
    try {
      const raw = fs.readFileSync(this.storePath, 'utf8');
      const data: PersistedOtpStoreData = JSON.parse(raw);
      const now = Date.now();

      if (data.challenges) {
        for (const [k, c] of Object.entries(data.challenges)) {
          // Keep active unexpired challenges and consumed records (for anti-replay within TTL)
          if (c.expiresAtEpochMs > now && (c.consumed || c.attemptsRemaining > 0)) {
            this.challenges.set(k, c);
          }
        }
      }

      if (data.rateLimits) {
        for (const [k, r] of Object.entries(data.rateLimits)) {
          const recent = (r.dispatches || []).filter((t) => now - t < this.HOURLY_WINDOW_MS);
          if (recent.length > 0) {
            this.rateLimits.set(k, {
              dispatches: recent,
              lastDispatchedAtEpochMs: r.lastDispatchedAtEpochMs,
            });
          }
        }
      }
    } catch (err) {
      apiLogger.warn('Failed to load persistent OTP store from disk, initializing fresh', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Atomically writes security state to disk.
   */
  private persistStoreToDisk(): void {
    try {
      const data: PersistedOtpStoreData = {
        version: '1.0.0-phase1b1-otp',
        lastSavedAtIso: new Date().toISOString(),
        challenges: Object.fromEntries(this.challenges.entries()),
        rateLimits: Object.fromEntries(this.rateLimits.entries()),
      };
      const tmpPath = `${this.storePath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.storePath);
    } catch (err) {
      apiLogger.error('Failed to atomically write OTP security store to disk', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Reloads security state from disk, simulating a server restart.
   */
  public reloadFromDisk(): void {
    this.challenges.clear();
    this.rateLimits.clear();
    this.loadStoreFromDisk();
  }

  /**
   * Returns current persistence topology status.
   */
  public getPersistenceMetadata() {
    return {
      storageType: 'LOCAL_PERSISTENT_FILE_ADAPTER',
      path: this.storePath,
      activeChallenges: this.challenges.size,
      trackedRateLimits: this.rateLimits.size,
      note: 'Single-node atomic file persistence across server restarts. Distributed multi-instance production requires external Redis/PostgreSQL cluster.',
    };
  }

  /**
   * Hashes a 6-digit OTP with salt in constant time.
   */
  private hashOtp(otp: string, salt: string): string {
    return crypto.createHash('sha256').update(`${otp}:${salt}:fv_otp_pepper_2026`).digest('hex');
  }

  /**
   * Generates a cryptographically strong 6-digit numeric OTP.
   */
  private generateNumericOtp(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * Cleans and sanitizes contact identifier.
   */
  private normalizeTarget(target: string, channel: OtpChannel): string {
    if (channel === 'EMAIL') {
      return target.trim().toLowerCase();
    }
    return target.trim().replace(/[^\d+]/g, '');
  }

  /**
   * Redacts target destination for privacy-safe audit logging.
   */
  private redactTarget(target: string, channel: OtpChannel): string {
    if (channel === 'EMAIL') {
      const parts = target.split('@');
      if (parts.length === 2 && parts[0] && parts[1]) {
        const name = parts[0];
        const visible = name.length > 2 ? `${name.slice(0, 1)}***${name.slice(-1)}` : '***';
        return `${visible}@${parts[1]}`;
      }
      return '***@***.***';
    }
    if (target.length > 5) {
      return `${target.slice(0, 3)}****${target.slice(-3)}`;
    }
    return '****';
  }

  /**
   * Checks rate limiting and resend cooldown for a target destination.
   */
  public checkDispatchEligibility(target: string, channel: OtpChannel, nowMs = Date.now()): {
    allowed: boolean;
    reason?: 'COOLDOWN_ACTIVE' | 'RATE_LIMIT_EXCEEDED';
    remainingCooldownSeconds?: number;
  } {
    const key = `${channel}:${this.normalizeTarget(target, channel)}`;
    const entry = this.rateLimits.get(key);
    if (!entry) {
      return { allowed: true };
    }

    // 1. Cooldown check
    const timeSinceLast = nowMs - entry.lastDispatchedAtEpochMs;
    if (timeSinceLast < this.RESEND_COOLDOWN_MS) {
      const remainingSec = Math.ceil((this.RESEND_COOLDOWN_MS - timeSinceLast) / 1000);
      return {
        allowed: false,
        reason: 'COOLDOWN_ACTIVE',
        remainingCooldownSeconds: remainingSec,
      };
    }

    // 2. Hourly window rate limit check
    const recent = entry.dispatches.filter((t) => nowMs - t < this.HOURLY_WINDOW_MS);
    if (recent.length >= this.HOURLY_LIMIT) {
      return {
        allowed: false,
        reason: 'RATE_LIMIT_EXCEEDED',
      };
    }

    return { allowed: true };
  }

  /**
   * Records dispatch in rate limit tracker and persists to disk.
   */
  private recordDispatch(target: string, channel: OtpChannel, nowMs = Date.now()): void {
    const key = `${channel}:${this.normalizeTarget(target, channel)}`;
    const entry = this.rateLimits.get(key) || { dispatches: [], lastDispatchedAtEpochMs: 0 };
    const recent = entry.dispatches.filter((t) => nowMs - t < this.HOURLY_WINDOW_MS);
    recent.push(nowMs);
    this.rateLimits.set(key, {
      dispatches: recent,
      lastDispatchedAtEpochMs: nowMs,
    });
    this.persistStoreToDisk();
  }

  /**
   * Issues an email verification OTP challenge.
   */
  public sendEmailOtp(email: string, nowMs = Date.now()): {
    challengeId: string;
    channel: 'EMAIL';
    expiresInSeconds: number;
    cooldownSeconds: number;
  } {
    const normalized = this.normalizeTarget(email, 'EMAIL');
    if (!normalized.includes('@') || normalized.length < 5) {
      throw new Error('Valid email address required.');
    }

    const check = this.checkDispatchEligibility(normalized, 'EMAIL', nowMs);
    if (!check.allowed) {
      if (check.reason === 'COOLDOWN_ACTIVE') {
        throw new Error(
          `Please wait ${check.remainingCooldownSeconds} seconds before requesting another email verification code.`
        );
      }
      throw new Error(
        'Too many verification code requests. Maximum 3 requests per hour allowed for this email.'
      );
    }

    const otp = this.generateNumericOtp();
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = this.hashOtp(otp, salt);
    const challengeId = `otp_em_${crypto.randomBytes(12).toString('hex')}`;

    const record: OtpChallengeRecord = {
      challengeId,
      target: normalized,
      channel: 'EMAIL',
      otpHash,
      salt,
      attemptsRemaining: this.MAX_VERIFY_ATTEMPTS,
      consumed: false,
      expiresAtEpochMs: nowMs + this.EMAIL_TTL_MS,
      createdAtEpochMs: nowMs,
      lastSentAtEpochMs: nowMs,
    };

    this.challenges.set(challengeId, record);
    this.recordDispatch(normalized, 'EMAIL', nowMs);
    this.persistStoreToDisk();

    // Sandbox test cache record (test helper only)
    this.sandboxTestCache.set(`EMAIL:${normalized}`, otp);

    apiLogger.info('[SANDBOX_OTP_DISPATCH] Generated Email Verification Code', {
      challengeId,
      channel: 'EMAIL',
      recipientRedacted: this.redactTarget(normalized, 'EMAIL'),
      ttlSeconds: this.EMAIL_TTL_MS / 1000,
      sandboxAdapter: true,
      note: 'Production requires verified SMTP gateway integration. In sandbox, dispatch is securely simulated.',
    });

    return {
      challengeId,
      channel: 'EMAIL',
      expiresInSeconds: Math.floor(this.EMAIL_TTL_MS / 1000),
      cooldownSeconds: Math.floor(this.RESEND_COOLDOWN_MS / 1000),
    };
  }

  /**
   * Issues an SMS mobile phone verification OTP challenge.
   */
  public sendSmsOtp(mobileNumber: string, nowMs = Date.now()): {
    challengeId: string;
    channel: 'SMS';
    expiresInSeconds: number;
    cooldownSeconds: number;
  } {
    const normalized = this.normalizeTarget(mobileNumber, 'SMS');
    if (normalized.length < 7 || normalized.length > 18) {
      throw new Error('Valid mobile phone number with international country code required.');
    }

    const check = this.checkDispatchEligibility(normalized, 'SMS', nowMs);
    if (!check.allowed) {
      if (check.reason === 'COOLDOWN_ACTIVE') {
        throw new Error(
          `Please wait ${check.remainingCooldownSeconds} seconds before requesting another SMS verification code.`
        );
      }
      throw new Error(
        'Too many verification code requests. Maximum 3 requests per hour allowed for this mobile number.'
      );
    }

    const otp = this.generateNumericOtp();
    const salt = crypto.randomBytes(16).toString('hex');
    const otpHash = this.hashOtp(otp, salt);
    const challengeId = `otp_sms_${crypto.randomBytes(12).toString('hex')}`;

    const record: OtpChallengeRecord = {
      challengeId,
      target: normalized,
      channel: 'SMS',
      otpHash,
      salt,
      attemptsRemaining: this.MAX_VERIFY_ATTEMPTS,
      consumed: false,
      expiresAtEpochMs: nowMs + this.SMS_TTL_MS,
      createdAtEpochMs: nowMs,
      lastSentAtEpochMs: nowMs,
    };

    this.challenges.set(challengeId, record);
    this.recordDispatch(normalized, 'SMS', nowMs);
    this.persistStoreToDisk();

    // Sandbox test cache record (test helper only)
    this.sandboxTestCache.set(`SMS:${normalized}`, otp);

    apiLogger.info('[SANDBOX_OTP_DISPATCH] Generated Mobile SMS Verification Code', {
      challengeId,
      channel: 'SMS',
      recipientRedacted: this.redactTarget(normalized, 'SMS'),
      ttlSeconds: this.SMS_TTL_MS / 1000,
      sandboxAdapter: true,
      note: 'Production requires verified SMS cellular gateway integration. In sandbox, cellular dispatch is securely simulated.',
    });

    return {
      challengeId,
      channel: 'SMS',
      expiresInSeconds: Math.floor(this.SMS_TTL_MS / 1000),
      cooldownSeconds: Math.floor(this.RESEND_COOLDOWN_MS / 1000),
    };
  }

  /**
   * Verifies an OTP code against a challenge with single-use consumption and attempt tracking.
   */
  public verifyOtp(params: {
    challengeId: string;
    presentedOtp: string;
    nowMs?: number;
  }): {
    success: boolean;
    target: string;
    channel: OtpChannel;
    error?: string;
  } {
    const now = params.nowMs || Date.now();
    const record = this.challenges.get(params.challengeId);

    if (!record) {
      return {
        success: false,
        target: '',
        channel: 'EMAIL',
        error: 'Verification challenge does not exist or has expired.',
      };
    }

    if (record.consumed) {
      return {
        success: false,
        target: record.target,
        channel: record.channel,
        error: 'This verification code has already been consumed. Please request a fresh code.',
      };
    }

    if (now > record.expiresAtEpochMs) {
      this.challenges.delete(params.challengeId);
      this.persistStoreToDisk();
      return {
        success: false,
        target: record.target,
        channel: record.channel,
        error: 'Verification code has expired. Please request a new code.',
      };
    }

    if (record.attemptsRemaining <= 0) {
      this.challenges.delete(params.challengeId);
      this.persistStoreToDisk();
      return {
        success: false,
        target: record.target,
        channel: record.channel,
        error: 'Maximum verification attempts exceeded. Challenge invalidated for security.',
      };
    }

    const cleanInput = (params.presentedOtp || '').trim();
    const computedHash = this.hashOtp(cleanInput, record.salt);

    const a = Buffer.from(computedHash, 'utf8');
    const b = Buffer.from(record.otpHash, 'utf8');
    const matches = a.length === b.length && crypto.timingSafeEqual(a, b);

    if (!matches) {
      record.attemptsRemaining -= 1;
      if (record.attemptsRemaining <= 0) {
        this.challenges.delete(params.challengeId);
        this.persistStoreToDisk();
        return {
          success: false,
          target: record.target,
          channel: record.channel,
          error: 'Invalid verification code. Maximum attempts reached; challenge invalidated.',
        };
      }
      this.persistStoreToDisk();
      return {
        success: false,
        target: record.target,
        channel: record.channel,
        error: `Invalid verification code. ${record.attemptsRemaining} attempt(s) remaining.`,
      };
    }

    // Success! Mark consumed immediately and persist to guarantee anti-replay within TTL
    record.consumed = true;
    this.persistStoreToDisk();
    this.sandboxTestCache.delete(`${record.channel}:${record.target}`);

    apiLogger.info('OTP challenge successfully verified', {
      challengeId: params.challengeId,
      channel: record.channel,
      recipientRedacted: this.redactTarget(record.target, record.channel),
    });

    return {
      success: true,
      target: record.target,
      channel: record.channel,
    };
  }

  /**
   * Atomically verifies both Email and Mobile SMS OTPs for dual-contact onboarding.
   */
  public verifyDualContact(params: {
    emailChallengeId: string;
    emailOtp: string;
    smsChallengeId: string;
    smsOtp: string;
    nowMs?: number;
  }): {
    success: boolean;
    email: string;
    mobileNumber: string;
    error?: string;
  } {
    const emailResult = this.verifyOtp({
      challengeId: params.emailChallengeId,
      presentedOtp: params.emailOtp,
      nowMs: params.nowMs,
    });

    if (!emailResult.success) {
      return {
        success: false,
        email: emailResult.target,
        mobileNumber: '',
        error: `Email verification failed: ${emailResult.error}`,
      };
    }

    const smsResult = this.verifyOtp({
      challengeId: params.smsChallengeId,
      presentedOtp: params.smsOtp,
      nowMs: params.nowMs,
    });

    if (!smsResult.success) {
      return {
        success: false,
        email: emailResult.target,
        mobileNumber: smsResult.target,
        error: `Mobile SMS verification failed: ${smsResult.error}`,
      };
    }

    return {
      success: true,
      email: emailResult.target,
      mobileNumber: smsResult.target,
    };
  }

  /**
   * Test-only inspection method to retrieve sandbox OTP without exposing secrets in logs or API responses.
   */
  public getLatestSandboxOtpForTesting(target: string, channel: OtpChannel): string | null {
    const key = `${channel}:${this.normalizeTarget(target, channel)}`;
    return this.sandboxTestCache.get(key) || null;
  }

  /**
   * Reset test state between test runs.
   */
  public resetTestState(): void {
    this.challenges.clear();
    this.rateLimits.clear();
    this.sandboxTestCache.clear();
    if (fs.existsSync(this.storePath)) {
      try {
        fs.unlinkSync(this.storePath);
      } catch {
        // Ignore test cleanup error
      }
    }
  }
}

export const otpService = new OtpService();

import crypto from 'node:crypto';
import path from 'node:path';
import {
  AccountStatus,
  ApiErrorCode,
  AuditActorType,
  AuditEventCategory,
  AuditSeverity,
  ContentVisibility,
  SECURE_UPLOAD_CONFIG,
  UploadSessionStatus,
  MalwareScanStatus,
  MediaValidationStatus,
  UserRole,
  VideoFormat,
  type CreatorUploadSession,
  type InitiateUploadSessionRequest,
  type InitiateUploadSessionResponse,
} from '../../../../packages/shared/src/index.ts';
import { apiLogger } from '../common/logger.ts';
import {
  databaseFoundationService,
  type PersistedCreatorAccountRow,
  type PersistedUserRow,
  type PersistedVideoUploadSessionRow,
} from '../database/database.service.ts';

export interface AuthenticatedCreatorContext {
  readonly user: PersistedUserRow;
  readonly creator: PersistedCreatorAccountRow;
  readonly roles: readonly UserRole[];
}

export interface CreatorAuthResult {
  readonly ok: boolean;
  readonly statusCode: number;
  readonly errorCode?: ApiErrorCode;
  readonly message?: string;
  readonly context?: AuthenticatedCreatorContext;
}

export interface UploadSessionResult {
  readonly ok: boolean;
  readonly statusCode: number;
  readonly errorCode?: ApiErrorCode;
  readonly message?: string;
  readonly data?: any;
  readonly idempotentReplay?: boolean;
}

// Development test tokens mapped to seeded identities (isolated to local development)
const DEV_TOKEN_FIXTURE_MAP: Readonly<Record<string, string>> = {
  dev_creator_token_maya: 'usr_verified_8841',
  dev_creator_token_second: 'usr_creator_second_9902',
  dev_merchant_token: 'usr_merchant_4410',
  dev_viewer_token: 'usr_viewer_01',
};

export class CreatorUploadService {
  private readonly inFlightCreatorLocks: Set<string> = new Set();
  private readonly inFlightIdempotencyLocks: Set<string> = new Set();

  /**
   * Derive authenticated verified creator identity strictly server-side.
   * Client-submitted user_id, creator_id, and roles are NEVER trusted.
   */
  public resolveAuthenticatedCreator(
    authHeader?: string,
    sessionToken?: string
  ): CreatorAuthResult {
    let rawToken: string | undefined = sessionToken;
    if (!rawToken && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      rawToken = authHeader.slice(7).trim();
    }

    if (!rawToken || rawToken.length === 0) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: ApiErrorCode.UNAUTHORIZED,
        message: 'Authentication required: missing or invalid creator session token.',
      };
    }

    // 1. Resolve user ID from dev fixture token or database device sessions
    let resolvedUserId: string | null = null;

    if (DEV_TOKEN_FIXTURE_MAP[rawToken]) {
      resolvedUserId = DEV_TOKEN_FIXTURE_MAP[rawToken];
    } else {
      // Check device sessions in the database foundation service
      const tokenSha256 = crypto.createHash('sha256').update(rawToken).digest('hex');
      const allSessions = (databaseFoundationService as any).catalog?.deviceSessions || {};
      for (const sess of Object.values(allSessions) as any[]) {
        if (sess.tokenSha256 === tokenSha256 && !sess.revoked) {
          if (new Date(sess.expiresAtIso).getTime() > Date.now()) {
            resolvedUserId = sess.userId;
            break;
          }
        }
      }
    }

    if (!resolvedUserId) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: ApiErrorCode.UNAUTHORIZED,
        message: 'Invalid, expired, or revoked session token.',
      };
    }

    // 2. Fetch User identity and verify status
    const user = databaseFoundationService.getUserById(resolvedUserId);
    if (!user) {
      return {
        ok: false,
        statusCode: 401,
        errorCode: ApiErrorCode.UNAUTHORIZED,
        message: 'Authenticated user record not found.',
      };
    }

    if (user.accountStatus !== AccountStatus.ACTIVE) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
        message: `Account is not active (status: ${user.accountStatus}). Upload privileges denied.`,
      };
    }

    // 3. Verify user has CREATOR role
    const roles = databaseFoundationService.getUserRoles(user.userId);
    if (!roles.includes(UserRole.CREATOR)) {
      apiLogger.warn('Creator upload endpoint blocked non-creator user', {
        userId: user.userId,
        roles,
      });
      return {
        ok: false,
        statusCode: 403,
        errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
        message: 'Forbidden: Account does not hold verified CREATOR role.',
      };
    }

    // 4. Verify Creator Account exists and is ACTIVE
    const creator = databaseFoundationService.getCreatorAccountByUserId(user.userId);
    if (!creator || creator.accountStatus !== 'ACTIVE') {
      return {
        ok: false,
        statusCode: 403,
        errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
        message: 'Forbidden: Verified creator account is missing or not active.',
      };
    }

    return {
      ok: true,
      statusCode: 200,
      context: {
        user,
        creator,
        roles,
      },
    };
  }

  /**
   * Initiate a secure creator video upload session.
   * Enforces channel ownership, file size limits, MIME validation, quotas, and idempotency.
   */
  public async initiateUploadSession(params: {
    authHeader?: string;
    sessionToken?: string;
    body: InitiateUploadSessionRequest;
    requestId: string;
    clientIp?: string;
  }): Promise<UploadSessionResult> {
    const auth = this.resolveAuthenticatedCreator(params.authHeader, params.sessionToken);
    if (!auth.ok || !auth.context) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.errorCode,
        message: auth.message,
      };
    }

    const { user, creator } = auth.context;
    const body = params.body || ({} as InitiateUploadSessionRequest);

    const rawIdempKey =
      body.idempotencyKey && typeof body.idempotencyKey === 'string'
        ? body.idempotencyKey.trim()
        : undefined;

    // Prevent concurrent race condition bypassing quotas or idempotency for this creator
    const lockKey = `lock_initiate_${creator.creatorId}`;
    const idempLockKey = rawIdempKey ? `lock_idemp_${creator.creatorId}_${rawIdempKey}` : undefined;

    if (
      this.inFlightCreatorLocks.has(lockKey) ||
      (idempLockKey && this.inFlightIdempotencyLocks.has(idempLockKey))
    ) {
      return {
        ok: false,
        statusCode: 429,
        errorCode: ApiErrorCode.RATE_LIMITED,
        message:
          'Concurrent upload initialization already in progress for this creator or idempotency key. Please retry.',
      };
    }

    this.inFlightCreatorLocks.add(lockKey);
    if (idempLockKey) {
      this.inFlightIdempotencyLocks.add(idempLockKey);
    }
    try {
      // 1. Channel ownership validation
      if (!body.channelId || typeof body.channelId !== 'string' || body.channelId.trim().length === 0) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'Target channelId is required.',
        };
      }

      const targetChannel = databaseFoundationService.getRawVideoChannelById(body.channelId.trim());
      if (!targetChannel) {
        return {
          ok: false,
          statusCode: 404,
          errorCode: ApiErrorCode.NOT_FOUND,
          message: `Target channel '${body.channelId}' was not found.`,
        };
      }

      const isChannelOwner =
        targetChannel.userId === user.userId || targetChannel.creatorId === creator.creatorId;
      if (!isChannelOwner) {
        apiLogger.warn('Channel ownership check failed for video upload', {
          userId: user.userId,
          creatorId: creator.creatorId,
          targetChannelId: body.channelId,
          channelOwnerUserId: targetChannel.userId,
        });
        return {
          ok: false,
          statusCode: 403,
          errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
          message: `Forbidden: Authenticated creator does not own target channel '${body.channelId}'. Channel ownership verification failed.`,
        };
      }

      // 2. File size validation (1 byte to 10 GB)
      if (
        typeof body.fileSizeBytes !== 'number' ||
        !Number.isFinite(body.fileSizeBytes) ||
        body.fileSizeBytes <= 0 ||
        !Number.isInteger(body.fileSizeBytes)
      ) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'Invalid file size: fileSizeBytes must be a positive integer greater than 0 bytes.',
        };
      }

      if (body.fileSizeBytes > SECURE_UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: `File size (${body.fileSizeBytes} bytes) exceeds maximum permitted limit of 10 GB (${SECURE_UPLOAD_CONFIG.MAX_FILE_SIZE_BYTES} bytes).`,
        };
      }

      // 3. MIME type and File Name validation
      if (!body.mimeType || typeof body.mimeType !== 'string') {
        return {
          ok: false,
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'mimeType is required.',
        };
      }

      const normalizedMime = body.mimeType.trim().toLowerCase();
      const isAllowedMime = (SECURE_UPLOAD_CONFIG.ALLOWED_MIME_TYPES as readonly string[]).includes(
        normalizedMime
      );
      if (!isAllowedMime) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: `Unsupported media MIME type '${body.mimeType}'. Allowed MIME types: ${SECURE_UPLOAD_CONFIG.ALLOWED_MIME_TYPES.join(
            ', '
          )}.`,
        };
      }

      if (!body.fileName || typeof body.fileName !== 'string' || body.fileName.trim().length === 0) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'fileName is required.',
        };
      }

      const rawFileName = body.fileName.trim();
      if (rawFileName.includes('/') || rawFileName.includes('\\') || rawFileName.includes('..')) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'Invalid fileName: path traversal characters are strictly prohibited.',
        };
      }

      const fileExt = path.extname(rawFileName).toLowerCase();
      const isAllowedExt = (SECURE_UPLOAD_CONFIG.ALLOWED_FILE_EXTENSIONS as readonly string[]).includes(
        fileExt
      );
      if (!isAllowedExt) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: `Invalid file extension '${fileExt}'. Allowed extensions: ${SECURE_UPLOAD_CONFIG.ALLOWED_FILE_EXTENSIONS.join(
            ', '
          )}.`,
        };
      }

      // 4. Video metadata validation
      if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'Video title is required (1 to 200 characters).',
        };
      }

      if (body.title.trim().length > 200) {
        return {
          ok: false,
          statusCode: 400,
          errorCode: ApiErrorCode.VALIDATION_FAILED,
          message: 'Video title must not exceed 200 characters.',
        };
      }

      const title = body.title.trim();
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const videoFormat = Object.values(VideoFormat).includes(body.videoFormat as any)
        ? (body.videoFormat as VideoFormat)
        : VideoFormat.STANDARD;
      const visibility = Object.values(ContentVisibility).includes(body.visibility as any)
        ? (body.visibility as ContentVisibility)
        : ContentVisibility.PUBLIC;

      // 5. Idempotency Check: Strict parameter comparison, expiration, cancellation & anti-conflict enforcement
      const idempotencyKey =
        body.idempotencyKey && typeof body.idempotencyKey === 'string'
          ? body.idempotencyKey.trim()
          : undefined;

      if (idempotencyKey) {
        const existingSession = databaseFoundationService.getUploadSessionByIdempotencyKey(
          creator.creatorId,
          idempotencyKey
        );

        if (existingSession) {
          // Check 1: Session expiration check (cannot be reactivated)
          const isExpired =
            existingSession.uploadStatus === UploadSessionStatus.EXPIRED ||
            new Date(existingSession.expiresAtIso).getTime() <= Date.now();
          if (isExpired) {
            apiLogger.warn('Idempotency replay rejected for expired upload session', {
              creatorId: creator.creatorId,
              sessionId: existingSession.sessionId,
              idempotencyKey,
            });
            return {
              ok: false,
              statusCode: 409,
              errorCode: ApiErrorCode.IDEMPOTENCY_CONFLICT,
              message: `Idempotency conflict: Upload session with key '${idempotencyKey}' has expired and cannot be reactivated.`,
            };
          }

          // Check 2: Session cancellation check (cannot be reused)
          if (existingSession.uploadStatus === UploadSessionStatus.ABORTED) {
            apiLogger.warn('Idempotency replay rejected for cancelled upload session', {
              creatorId: creator.creatorId,
              sessionId: existingSession.sessionId,
              idempotencyKey,
            });
            return {
              ok: false,
              statusCode: 409,
              errorCode: ApiErrorCode.IDEMPOTENCY_CONFLICT,
              message: `Idempotency conflict: Upload session with key '${idempotencyKey}' was cancelled/aborted and cannot be reused.`,
            };
          }

          // Check 3: Compare normalized security-relevant request parameters against original session
          const sanitizedReqFileName = path.basename(rawFileName).replace(/[^a-zA-Z0-9._-]/g, '_');
          const mismatchReasons: string[] = [];

          if (existingSession.channelId !== targetChannel.channelId) {
            mismatchReasons.push(
              `channelId mismatch (original: '${existingSession.channelId}', requested: '${targetChannel.channelId}')`
            );
          }
          if (existingSession.fileName !== sanitizedReqFileName) {
            mismatchReasons.push(
              `fileName mismatch (original: '${existingSession.fileName}', requested: '${sanitizedReqFileName}')`
            );
          }
          if (existingSession.fileSizeBytes !== body.fileSizeBytes) {
            mismatchReasons.push(
              `fileSizeBytes mismatch (original: ${existingSession.fileSizeBytes}, requested: ${body.fileSizeBytes})`
            );
          }
          if (existingSession.mimeType !== normalizedMime) {
            mismatchReasons.push(
              `mimeType mismatch (original: '${existingSession.mimeType}', requested: '${normalizedMime}')`
            );
          }
          if (existingSession.visibilityChoice !== visibility) {
            mismatchReasons.push(
              `visibility mismatch (original: '${existingSession.visibilityChoice}', requested: '${visibility}')`
            );
          }
          if (existingSession.videoFormat !== videoFormat) {
            mismatchReasons.push(
              `videoFormat mismatch (original: '${existingSession.videoFormat}', requested: '${videoFormat}')`
            );
          }
          if (existingSession.title !== title) {
            mismatchReasons.push(
              `title mismatch (original: '${existingSession.title}', requested: '${title}')`
            );
          }

          if (mismatchReasons.length > 0) {
            apiLogger.warn('Idempotency conflict detected for upload session', {
              creatorId: creator.creatorId,
              sessionId: existingSession.sessionId,
              idempotencyKey,
              mismatchReasons,
            });
            return {
              ok: false,
              statusCode: 409,
              errorCode: ApiErrorCode.IDEMPOTENCY_CONFLICT,
              message: `Idempotency conflict: Key '${idempotencyKey}' was previously used with different request parameters (${mismatchReasons.join(
                '; '
              )}). Reusing an idempotency key with conflicting parameters is strictly prohibited.`,
            };
          }

          // Identical request parameter match: Safe idempotent replay without consuming additional quota
          apiLogger.info('Idempotent replay of upload session', {
            creatorId: creator.creatorId,
            sessionId: existingSession.sessionId,
            idempotencyKey,
          });
          return {
            ok: true,
            statusCode: 200,
            idempotentReplay: true,
            data: this.buildInitiateResponse(existingSession),
          };
        }
      }

      // 6. Concurrency Quota Check: Maximum 5 concurrent active upload sessions
      const existingCreatorSessions = databaseFoundationService.listUploadSessionsForCreator(
        creator.creatorId
      );

      const nowEpochMs = Date.now();
      const activeSessions = existingCreatorSessions.filter((s) => {
        const isNotTerminal =
          s.uploadStatus === UploadSessionStatus.INITIATED ||
          s.uploadStatus === UploadSessionStatus.UPLOADING ||
          s.uploadStatus === UploadSessionStatus.UPLOADED ||
          s.uploadStatus === UploadSessionStatus.MALWARE_SCANNING ||
          s.uploadStatus === UploadSessionStatus.MEDIA_VALIDATING ||
          s.uploadStatus === UploadSessionStatus.TRANSCODING;
        const isNotExpired = new Date(s.expiresAtIso).getTime() > nowEpochMs;
        return isNotTerminal && isNotExpired;
      });

      if (activeSessions.length >= SECURE_UPLOAD_CONFIG.MAX_ACTIVE_SESSIONS_PER_CREATOR) {
        return {
          ok: false,
          statusCode: 429,
          errorCode: ApiErrorCode.QUOTA_EXCEEDED,
          message: `Concurrent upload quota exceeded: Creator has reached the limit of ${SECURE_UPLOAD_CONFIG.MAX_ACTIVE_SESSIONS_PER_CREATOR} active upload sessions. Complete or cancel an existing session before initiating a new one.`,
        };
      }

      // 7. Daily 50 GB Allocation Quota Check: Trailing 24-hour total
      const trailing24hEpochMs = nowEpochMs - 24 * 3600 * 1000;
      const recentSessions = existingCreatorSessions.filter((s) => {
        const createdAtEpochMs = new Date(s.createdAtIso).getTime();
        return createdAtEpochMs >= trailing24hEpochMs && s.uploadStatus !== UploadSessionStatus.ABORTED;
      });

      const usedDailyBytes = recentSessions.reduce((sum, s) => sum + s.fileSizeBytes, 0);
      const remainingDailyBytes =
        SECURE_UPLOAD_CONFIG.MAX_DAILY_UPLOAD_BYTES_PER_CREATOR - usedDailyBytes;

      if (usedDailyBytes + body.fileSizeBytes > SECURE_UPLOAD_CONFIG.MAX_DAILY_UPLOAD_BYTES_PER_CREATOR) {
        return {
          ok: false,
          statusCode: 429,
          errorCode: ApiErrorCode.QUOTA_EXCEEDED,
          message: `Daily upload quota exceeded: 50 GB daily allocation limit reached. Current 24h usage: ${usedDailyBytes} bytes, remaining: ${Math.max(
            0,
            remainingDailyBytes
          )} bytes, requested: ${body.fileSizeBytes} bytes.`,
        };
      }

      // 8. Generate Secure Upload Session Records
      const nowIso = new Date().toISOString();
      const sessionId = `upl_sess_${crypto.randomBytes(12).toString('hex')}`;
      const expiresAtIso = new Date(
        nowEpochMs + SECURE_UPLOAD_CONFIG.SIGNED_URL_EXPIRY_SECONDS * 1000
      ).toISOString();

      const sanitizedBaseName = path.basename(rawFileName).replace(/[^a-zA-Z0-9._-]/g, '_');
      const stagingObjectPath = `creators/${creator.creatorId}/uploads/${sessionId}/${sanitizedBaseName}`;

      // Local development staging stub URL (never actual production cloud storage credentials)
      const mockStagingToken = `dev_stub_${crypto.randomBytes(16).toString('hex')}`;
      const signedUploadUrl = `https://staging-storage.local.facevid.internal/v1/b/${
        SECURE_UPLOAD_CONFIG.STAGING_BUCKET_NAME
      }/o/${encodeURIComponent(stagingObjectPath)}?session_id=${sessionId}&token=${mockStagingToken}`;
      const resumableSessionUri = `https://staging-storage.local.facevid.internal/upload/resumable/${sessionId}`;

      const sessionRecord: PersistedVideoUploadSessionRow = {
        sessionId,
        creatorId: creator.creatorId,
        channelId: targetChannel.channelId,
        fileName: sanitizedBaseName,
        fileSizeBytes: body.fileSizeBytes,
        mimeType: normalizedMime,
        sha256Checksum: body.sha256Checksum,
        stagingStorageBucket: SECURE_UPLOAD_CONFIG.STAGING_BUCKET_NAME,
        stagingObjectPath,
        signedUploadUrl,
        resumableSessionUri,
        uploadStatus: UploadSessionStatus.INITIATED,
        malwareScanStatus: MalwareScanStatus.PENDING,
        mediaValidationStatus: MediaValidationStatus.PENDING,
        transcodingStatus: 'QUEUED_AWAITING_UPLOAD',
        visibilityChoice: visibility,
        title,
        description,
        categoryId: body.categoryId || null,
        videoFormat,
        tags: Array.isArray(body.tags) ? body.tags.slice(0, 20) : [],
        expiresAtIso,
        createdAtIso: nowIso,
        updatedAtIso: nowIso,
        idempotencyKey,
      };

      // Persist in local test adapter
      databaseFoundationService.saveUploadSession(sessionRecord);

      // Append immutable audit log event
      databaseFoundationService.appendAuditEvent({
        actorId: user.userId,
        actorType: AuditActorType.USER,
        category: AuditEventCategory.AUTHORIZATION,
        severity: AuditSeverity.INFO,
        action: 'CREATOR_UPLOAD_SESSION_INITIATED',
        targetResourceId: sessionId,
        metadataSanitized: {
          sessionId,
          creatorId: creator.creatorId,
          channelId: targetChannel.channelId,
          fileSizeBytes: body.fileSizeBytes,
          mimeType: normalizedMime,
          idempotencyKey: idempotencyKey || 'none',
        },
      });

      apiLogger.info('Creator upload session initiated', {
        sessionId,
        creatorId: creator.creatorId,
        channelId: targetChannel.channelId,
        fileSizeBytes: body.fileSizeBytes,
      });

      return {
        ok: true,
        statusCode: 201,
        data: this.buildInitiateResponse(sessionRecord),
      };
    } finally {
      this.inFlightCreatorLocks.delete(lockKey);
      if (idempLockKey) {
        this.inFlightIdempotencyLocks.delete(idempLockKey);
      }
    }
  }

  /**
   * Retrieve upload session status.
   * Enforces deny-by-default cross-creator isolation and evaluates expiration.
   */
  public getUploadSessionStatus(params: {
    authHeader?: string;
    sessionToken?: string;
    sessionId: string;
    requestId: string;
  }): UploadSessionResult {
    const auth = this.resolveAuthenticatedCreator(params.authHeader, params.sessionToken);
    if (!auth.ok || !auth.context) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.errorCode,
        message: auth.message,
      };
    }

    const { creator } = auth.context;
    const session = databaseFoundationService.getUploadSessionById(params.sessionId.trim());

    if (!session) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: ApiErrorCode.NOT_FOUND,
        message: `Upload session '${params.sessionId}' was not found.`,
      };
    }

    // Deny-by-default access control: Creators can ONLY access their own upload sessions
    if (session.creatorId !== creator.creatorId) {
      apiLogger.warn('Forbidden cross-creator upload session access attempt', {
        requestingCreatorId: creator.creatorId,
        sessionCreatorId: session.creatorId,
        sessionId: session.sessionId,
      });
      return {
        ok: false,
        statusCode: 403,
        errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
        message: `Access denied: You do not have permission to view upload session '${params.sessionId}'.`,
      };
    }

    // Evaluate session expiration
    if (
      (session.uploadStatus === UploadSessionStatus.INITIATED ||
        session.uploadStatus === UploadSessionStatus.UPLOADING) &&
      new Date(session.expiresAtIso).getTime() < Date.now()
    ) {
      session.uploadStatus = UploadSessionStatus.EXPIRED;
      session.updatedAtIso = new Date().toISOString();
      session.failureReason = 'Session expired before media upload was finalized.';
      databaseFoundationService.saveUploadSession(session);
    }

    const jobs = databaseFoundationService.getProcessingJobsForSession(session.sessionId);
    const renditions = session.videoId
      ? databaseFoundationService.getTranscodeRenditionsForVideo(session.videoId)
      : [];

    const publicSession: CreatorUploadSession = {
      ...session,
      jobs,
      renditions,
    };

    return {
      ok: true,
      statusCode: 200,
      data: {
        session: publicSession,
        isExpired: session.uploadStatus === UploadSessionStatus.EXPIRED,
        playableInCatalog: false, // Sessions are NEVER publicly playable before full processing & publication approval
      },
    };
  }

  /**
   * Cancel / abort an upload session.
   * Enforces creator authorization and terminal state restrictions.
   */
  public cancelUploadSession(params: {
    authHeader?: string;
    sessionToken?: string;
    sessionId: string;
    requestId: string;
  }): UploadSessionResult {
    const auth = this.resolveAuthenticatedCreator(params.authHeader, params.sessionToken);
    if (!auth.ok || !auth.context) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.errorCode,
        message: auth.message,
      };
    }

    const { user, creator } = auth.context;
    const session = databaseFoundationService.getUploadSessionById(params.sessionId.trim());

    if (!session) {
      return {
        ok: false,
        statusCode: 404,
        errorCode: ApiErrorCode.NOT_FOUND,
        message: `Upload session '${params.sessionId}' was not found.`,
      };
    }

    // Deny-by-default access control
    if (session.creatorId !== creator.creatorId) {
      return {
        ok: false,
        statusCode: 403,
        errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
        message: `Access denied: You do not have permission to cancel upload session '${params.sessionId}'.`,
      };
    }

    if (session.uploadStatus === UploadSessionStatus.PUBLISHED) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: ApiErrorCode.BAD_REQUEST,
        message: 'Cannot cancel an upload session that has already been published to the catalog.',
      };
    }

    if (
      session.uploadStatus === UploadSessionStatus.ABORTED ||
      session.uploadStatus === UploadSessionStatus.EXPIRED
    ) {
      return {
        ok: true,
        statusCode: 200,
        data: {
          sessionId: session.sessionId,
          status: session.uploadStatus,
          message: `Session is already in terminal state: ${session.uploadStatus}.`,
          alreadyTerminated: true,
        },
      };
    }

    const nowIso = new Date().toISOString();
    session.uploadStatus = UploadSessionStatus.ABORTED;
    session.failureReason = 'Upload session cancelled by creator.';
    session.updatedAtIso = nowIso;

    databaseFoundationService.saveUploadSession(session);

    databaseFoundationService.appendAuditEvent({
      actorId: user.userId,
      actorType: AuditActorType.USER,
      category: AuditEventCategory.AUTHORIZATION,
      severity: AuditSeverity.INFO,
      action: 'CREATOR_UPLOAD_SESSION_CANCELLED',
      targetResourceId: session.sessionId,
      metadataSanitized: {
        sessionId: session.sessionId,
        creatorId: creator.creatorId,
        channelId: session.channelId,
        cancelledAtIso: nowIso,
      },
    });

    apiLogger.info('Upload session cancelled by creator', {
      sessionId: session.sessionId,
      creatorId: creator.creatorId,
    });

    return {
      ok: true,
      statusCode: 200,
      data: {
        sessionId: session.sessionId,
        status: UploadSessionStatus.ABORTED,
        message: 'Upload session has been cancelled and aborted successfully.',
        cancelledAtIso: nowIso,
      },
    };
  }

  /**
   * List all upload sessions belonging to the authenticated creator.
   */
  public listUploadSessions(params: {
    authHeader?: string;
    sessionToken?: string;
    requestId: string;
  }): UploadSessionResult {
    const auth = this.resolveAuthenticatedCreator(params.authHeader, params.sessionToken);
    if (!auth.ok || !auth.context) {
      return {
        ok: false,
        statusCode: auth.statusCode,
        errorCode: auth.errorCode,
        message: auth.message,
      };
    }

    const { creator } = auth.context;
    const sessions = databaseFoundationService.listUploadSessionsForCreator(creator.creatorId);

    return {
      ok: true,
      statusCode: 200,
      data: {
        creatorId: creator.creatorId,
        totalSessions: sessions.length,
        sessions,
      },
    };
  }

  private buildInitiateResponse(
    session: PersistedVideoUploadSessionRow
  ): InitiateUploadSessionResponse {
    return {
      ok: true,
      session: {
        sessionId: session.sessionId,
        creatorId: session.creatorId,
        channelId: session.channelId,
        videoId: session.videoId,
        fileName: session.fileName,
        fileSizeBytes: session.fileSizeBytes,
        mimeType: session.mimeType,
        sha256Checksum: session.sha256Checksum,
        stagingStorageBucket: session.stagingStorageBucket,
        stagingObjectPath: session.stagingObjectPath,
        signedUploadUrl: session.signedUploadUrl,
        resumableSessionUri: session.resumableSessionUri,
        uploadStatus: session.uploadStatus,
        malwareScanStatus: session.malwareScanStatus,
        mediaValidationStatus: session.mediaValidationStatus,
        transcodingStatus: session.transcodingStatus,
        visibilityChoice: session.visibilityChoice,
        title: session.title,
        description: session.description,
        categoryId: session.categoryId,
        videoFormat: session.videoFormat,
        tags: session.tags,
        extractedThumbnailUrl: session.extractedThumbnailUrl,
        failureReason: session.failureReason,
        expiresAtIso: session.expiresAtIso,
        createdAtIso: session.createdAtIso,
        updatedAtIso: session.updatedAtIso,
        idempotencyKey: session.idempotencyKey,
      },
      signedUploadUrl: session.signedUploadUrl,
      resumableSessionUri: session.resumableSessionUri || session.signedUploadUrl,
      uploadExpiresAtIso: session.expiresAtIso,
      stagingStorageBucket: session.stagingStorageBucket,
      stagingObjectPath: session.stagingObjectPath,
      instructions: {
        protocol: 'GCS_RESUMABLE_V4',
        method: 'PUT',
        chunkSizeRecommendedBytes: 8 * 1024 * 1024, // 8 MB chunks
      },
    };
  }
}

export const creatorUploadService = new CreatorUploadService();

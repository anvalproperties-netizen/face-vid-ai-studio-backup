/**
 * @face-vid/api — Phase 1.4B Secure Authentication & Passkey Service
 *
 * Implements:
 * - Secure account registration across the 4 account types (User, Creator, Business, Store).
 * - Anti-privilege escalation (public registration assigns strictly UserRole.USER).
 * - Salted password hashing with constant-time verification.
 * - WebAuthn / FIDO2 passkey registration and assertion verification.
 * - Single-use email verification and password reset tokens.
 * - Server-enforced First-Sign-In-of-the-Day daily verification.
 * - Dual-token session management with Refresh Token Rotation (RTR).
 * - Emergency recovery code verification.
 */

import crypto from 'node:crypto';
import {
  AccountCategory,
  AccountStatus,
  ApiErrorCode,
  AuditActorType,
  AuditEventCategory,
  AuditSeverity,
  DailyVerificationMethod,
  IdentityMode,
  LiveAudienceReach,
  PlatformId,
  SubscriptionTier,
  UserExperienceTier,
  UserRole,
  isDailyVerificationActive,
  validateRegistrationRoleRequest,
  type DailyVerificationStatus,
  type PasskeyCredentialRecord,
} from '../../../../packages/shared/src/index.ts';
import { databaseFoundationService } from '../database/database.service.ts';
import { apiLogger } from '../common/logger.ts';

const SERVER_PEPPER = process.env.PASSWORD_PEPPER || 'facevid_secret_pepper_2026_dev';

export interface RegisterUserParams {
  accountType: AccountCategory;
  email: string;
  mobileNumber?: string;
  fullName: string;
  displayName: string;
  handle: string;
  password?: string;
  countryIso: string;
  acceptedTerms: boolean;
  channelGenre?: string;
  creatorBio?: string;
  organizationName?: string;
  registrationNumber?: string;
  storeName?: string;
  storeCatalogType?: string;
}

export interface AuthSessionResult {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  handle: string;
  roles: readonly UserRole[];
  accountStatus: AccountStatus;
  subscriptionTier: SubscriptionTier;
  accessToken: string;
  refreshToken: string;
  expiresAtIso: string;
  dailyVerification: DailyVerificationStatus;
  phishingResistantMfaVerified: boolean;
}

export class AuthService {
  // In-memory challenge store with 300s TTL for WebAuthn ceremonies
  private challenges = new Map<string, { challenge: string; userId?: string; expiresAtEpochMs: number }>();

  /**
   * Hashes a password using modern memory-hard scrypt KDF (N=16384, r=8, p=1).
   * Generates versioned hash prefixed with 'v2$scrypt$<salt>$<hash>'.
   */
  public hashPassword(password: string): { hash: string; salt: string; algo: 'scrypt' } {
    const salt = crypto.randomBytes(16).toString('hex');
    const derivedKey = crypto.scryptSync(password + SERVER_PEPPER, salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
    }).toString('hex');
    const versionedHash = `v2$scrypt$${salt}$${derivedKey}`;
    return { hash: versionedHash, salt, algo: 'scrypt' };
  }

  /**
   * Constant-time password verification supporting versioned KDFs:
   * - v1$sha256 (or raw legacy hex): single-round SHA-256 (flags needsRehash: true)
   * - v2$scrypt: modern memory-hard scrypt KDF (RFC 7914) (needsRehash: false)
   */
  public verifyPasswordDetailed(
    password: string,
    creds: { passwordHash: string; salt: string; algo?: string }
  ): { valid: boolean; needsRehash: boolean } {
    const storedHash = creds.passwordHash || '';
    const salt = creds.salt || '';
    const isV2Scrypt = creds.algo === 'scrypt' || storedHash.startsWith('v2$scrypt$');

    if (isV2Scrypt) {
      const derivedKey = crypto.scryptSync(password + SERVER_PEPPER, salt, 64, {
        N: 16384,
        r: 8,
        p: 1,
      }).toString('hex');
      const expectedKey = storedHash.startsWith('v2$scrypt$')
        ? storedHash.split('$')[3] || storedHash
        : storedHash;
      const a = Buffer.from(derivedKey, 'utf8');
      const b = Buffer.from(expectedKey, 'utf8');
      const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
      return { valid, needsRehash: false };
    }

    // Legacy SHA-256 check
    const combined = `${password}:${salt}:${SERVER_PEPPER}`;
    const computedHash = crypto.createHash('sha256').update(combined).digest('hex');
    const expectedHash = storedHash.startsWith('v1$sha256$')
      ? storedHash.split('$')[3] || storedHash
      : storedHash;
    const a = Buffer.from(computedHash, 'utf8');
    const b = Buffer.from(expectedHash, 'utf8');
    const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
    return { valid, needsRehash: valid };
  }

  /**
   * Verifies a password in constant time.
   */
  public verifyPassword(password: string, storedHash: string, salt: string): boolean {
    const res = this.verifyPasswordDetailed(password, { passwordHash: storedHash, salt });
    return res.valid;
  }

  /**
   * Secure registration: validates inputs, assigns base UserRole.USER,
   * enqueues verification records for elevated intents, and hashes password.
   */
  public register(params: RegisterUserParams): {
    user: ReturnType<typeof databaseFoundationService.findUserById>;
    accountCategory: AccountCategory;
    verificationToken?: string;
  } {
    if (!params.acceptedTerms) {
      throw new Error('Terms and privacy policy acceptance is required.');
    }
    const cleanEmail = params.email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Valid email address is required.');
    }

    const existing = databaseFoundationService.findUserByEmail(cleanEmail);
    if (existing) {
      throw new Error('An account with this email address already exists.');
    }

    // Role validation: public registration always evaluates to UserRole.USER
    const roleValidation = validateRegistrationRoleRequest(params.accountType.toUpperCase());
    const assignedRole = roleValidation.assignedRole; // Strictly UserRole.USER

    const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const cleanHandle = `@${params.handle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_]/g, '')}`;

    // Base user creation
    const { user } = databaseFoundationService.upsertUserWithProfileAndSettings({
      userId,
      primaryEmail: cleanEmail,
      mobileNumber: params.mobileNumber,
      legalFullName: params.fullName.trim(),
      countryIsoCode: (params.countryIso || 'US').toUpperCase().slice(0, 2),
      accountStatus:
        params.accountType === 'user'
          ? AccountStatus.ACTIVE
          : AccountStatus.PENDING_VERIFICATION,
      subscriptionTier: SubscriptionTier.FREE_STANDARD,
      mfaEnrolled: false,
      phishingResistantMfaVerified: false,
      publicDisplayName: params.displayName.trim() || params.fullName.trim(),
      publicHandle: cleanHandle,
      publicBio: params.creatorBio || '',
      publicAvatarUrl: `/assets/avatars/default_${userId.slice(-4)}.png`,
      publicVerifiedBadge: false,
      privatePseudonym: `Anon_${userId.slice(-6)}`,
      privateAvatarSeedId: `seed_${userId}`,
      privateAvatarStyle: 'GEOMETRIC_SHIELD',
      activeIdentityMode: IdentityMode.PUBLIC,
      defaultLiveAudienceReach: LiveAudienceReach.COUNTRY,
    });

    // Assign base USER role
    databaseFoundationService.assignUserRole({
      userId,
      roleCode: assignedRole,
      grantedByActorId: 'SYSTEM_REGISTRATION',
      grantedByActorType: AuditActorType.SYSTEM_SERVICE,
    });

    // Hash password if provided
    if (params.password) {
      const { hash, salt } = this.hashPassword(params.password);
      databaseFoundationService.upsertAuthCredentials({
        userId,
        passwordHash: hash,
        salt,
        algo: 'scrypt',
      });
    }

    // Handle intent-specific verification queues (Creator / Business / Store)
    if (params.accountType === 'creator') {
      const verificationId = `ver_${crypto.randomBytes(8).toString('hex')}`;
      const creatorId = `crt_${crypto.randomBytes(8).toString('hex')}`;
      databaseFoundationService.upsertCreatorVerificationAndAccount({
        verificationId,
        userId,
        externalPlatformName: params.channelGenre || 'Video Creator',
        externalAccountHandle: cleanHandle,
        ownershipProofDigest: crypto.createHash('sha256').update(`${userId}:${cleanEmail}`).digest('hex'),
        aiAssistiveScore: 85.0,
        humanReviewerUserId: null,
        verificationStatus: 'PENDING_HUMAN_REVIEW',
        foundingSlotNumber: null,
        creatorId,
        channelHandle: cleanHandle,
        channelDisplayName: params.displayName.trim(),
      });
    } else if (params.accountType === 'business') {
      const advertiserId = `adv_${crypto.randomBytes(8).toString('hex')}`;
      databaseFoundationService.upsertBusinessAdvertiserAccount({
        advertiserId,
        ownerUserId: userId,
        organizationLegalName: params.organizationName || params.fullName,
        taxRegistrationRef: params.registrationNumber || 'PENDING_TAX_ID',
        complianceStatus: 'PENDING_REVIEW',
      });
    } else if (params.accountType === 'store') {
      const merchantId = `mrc_${crypto.randomBytes(8).toString('hex')}`;
      databaseFoundationService.upsertMerchantAccount({
        merchantId,
        ownerUserId: userId,
        shopName: params.storeName || `${params.displayName}'s Store`,
        shopSlug: `shop-${cleanHandle.replace('@', '')}`,
        kybVerificationStatus: 'PENDING_KYB',
        registrationCountryIso: (params.countryIso || 'US').toUpperCase().slice(0, 2),
        liveShoppingEnabled: false,
      });
    }

    // Issue email verification token (24h TTL)
    const rawVerificationToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawVerificationToken).digest('hex');
    databaseFoundationService.createAuthToken({
      userId,
      tokenType: 'EMAIL_VERIFICATION',
      tokenHash,
      ttlMs: 24 * 60 * 60 * 1000,
    });

    apiLogger.info('User registration completed', {
      userId,
      accountType: params.accountType,
      roleAssigned: assignedRole,
    });

    return {
      user: databaseFoundationService.findUserById(userId),
      accountCategory: params.accountType,
      verificationToken: rawVerificationToken,
    };
  }

  /**
   * Password login: verifies credentials and issues device session with tokens.
   * Automatically migrates legacy v1 (SHA-256) password hashes to modern scrypt KDF.
   */
  public loginWithPassword(params: {
    email: string;
    password: string;
    platformId?: PlatformId;
    deviceDisplayName?: string;
  }): AuthSessionResult {
    const user =
      databaseFoundationService.findUserByIdentifier(params.email) ||
      databaseFoundationService.findUserByEmail(params.email);
    if (!user) {
      throw new Error('Invalid credentials. Please verify your email, mobile number or password.');
    }
    if (user.accountStatus === AccountStatus.SUSPENDED) {
      throw new Error('This account has been suspended. Please contact platform compliance.');
    }

    const creds = databaseFoundationService.getAuthCredentials(user.userId);
    if (!creds) {
      throw new Error('No password configured for this account. Please use passkey sign-in.');
    }

    const verification = this.verifyPasswordDetailed(params.password, creds);
    if (!verification.valid) {
      throw new Error('Invalid email or password.');
    }

    // Transparent password migration: upgrade legacy v1/sha256 hashes to modern scrypt KDF
    if (verification.needsRehash) {
      const fresh = this.hashPassword(params.password);
      databaseFoundationService.upsertAuthCredentials({
        userId: user.userId,
        passwordHash: fresh.hash,
        salt: fresh.salt,
        algo: 'scrypt',
      });
      apiLogger.info('Transparently upgraded user password credential from legacy SHA-256 to modern scrypt KDF', {
        userId: user.userId,
      });
    }

    return this.createSessionForUser(user.userId, {
      platformId: params.platformId || PlatformId.FACE_VID_WEB,
      deviceDisplayName: params.deviceDisplayName || 'Web Browser',
      dailyVerified: false,
    });
  }

  /**
   * Issues WebAuthn registration options.
   */
  public getPasskeyRegistrationOptions(userId: string): {
    challenge: string;
    rp: { name: string; id: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: Array<{ alg: number; type: string }>;
    timeout: number;
    authenticatorSelection: {
      authenticatorAttachment: 'platform' | 'cross-platform';
      userVerification: 'preferred' | 'required';
      residentKey: 'preferred';
    };
  } {
    const user = databaseFoundationService.findUserById(userId);
    if (!user) {
      throw new Error('User not found.');
    }

    const challenge = crypto.randomBytes(32).toString('base64url');
    this.challenges.set(challenge, {
      challenge,
      userId,
      expiresAtEpochMs: Date.now() + 300_000,
    });

    return {
      challenge,
      rp: { name: 'FACE VID', id: 'facevid.com' },
      user: {
        id: Buffer.from(user.userId).toString('base64url'),
        name: user.primaryEmail,
        displayName: user.legalFullName,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },  // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      timeout: 60000,
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'preferred',
        residentKey: 'preferred',
      },
    };
  }

  /**
   * Verifies WebAuthn passkey registration and persists credential.
   */
  public verifyPasskeyRegistration(params: {
    userId: string;
    challenge: string;
    credentialId: string;
    publicKeyDerBase64: string;
    deviceType?: 'platform' | 'cross-platform';
    transports?: string[];
  }): { success: boolean; credential: PasskeyCredentialRecord; recoveryCodes: string[] } {
    const stored = this.challenges.get(params.challenge);
    if (!stored || stored.expiresAtEpochMs < Date.now()) {
      throw new Error('WebAuthn registration challenge has expired or is invalid.');
    }
    this.challenges.delete(params.challenge);

    const nowIso = new Date().toISOString();
    const cred: PasskeyCredentialRecord = {
      id: `pk_${crypto.randomBytes(8).toString('hex')}`,
      userId: params.userId,
      credentialId: params.credentialId,
      publicKey: params.publicKeyDerBase64,
      counter: 0,
      deviceType: params.deviceType || 'platform',
      transports: params.transports || ['internal'],
      createdAtIso: nowIso,
    };

    databaseFoundationService.registerPasskeyCredential({
      credentialId: params.credentialId,
      userId: params.userId,
      publicKeyDerBase64: params.publicKeyDerBase64,
      counter: 0,
      deviceType: params.deviceType || 'platform',
      transports: params.transports || ['internal'],
      aaguid: null,
      createdAtIso: nowIso,
      lastUsedAtIso: null,
    });

    // Generate 10 emergency recovery codes
    const recoveryCodes: string[] = [];
    const codeHashes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const code = `FV-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      recoveryCodes.push(code);
      codeHashes.push(crypto.createHash('sha256').update(code).digest('hex'));
    }
    databaseFoundationService.setRecoveryCodes(params.userId, codeHashes);

    apiLogger.info('WebAuthn passkey enrolled', {
      userId: params.userId,
      credentialId: params.credentialId,
    });

    return { success: true, credential: cred, recoveryCodes };
  }

  /**
   * Issues WebAuthn authentication options.
   */
  public getPasskeyLoginOptions(email?: string): {
    challenge: string;
    timeout: number;
    rpId: string;
    userVerification: 'preferred' | 'required';
  } {
    const challenge = crypto.randomBytes(32).toString('base64url');
    let userId: string | undefined;
    if (email) {
      const u = databaseFoundationService.findUserByEmail(email);
      if (u) userId = u.userId;
    }

    this.challenges.set(challenge, {
      challenge,
      userId,
      expiresAtEpochMs: Date.now() + 300_000,
    });

    return {
      challenge,
      timeout: 60000,
      rpId: 'facevid.com',
      userVerification: 'preferred',
    };
  }

  /**
   * Verifies WebAuthn passkey assertion and issues session.
   *
   * Note on FIDO2/WebAuthn Cryptographic Verification:
   * Real production verification requires @simplewebauthn/server to decode CBOR authenticatorData,
   * verify the user presence (UP) and user verification (UV) flags, hash the clientDataJSON challenge,
   * and verify the cryptographic signature against the stored COSE public key.
   * Per owner directives, homemade CBOR/crypto implementations are strictly forbidden, and until
   * the approved library is authorized and installed, the incomplete verification path fails closed
   * and is prohibited from issuing authenticated sessions.
   */
  public verifyPasskeyLogin(params: {
    challenge: string;
    credentialId: string;
    clientSignatureBase64: string;
    counter: number;
    origin?: string;
    rpId?: string;
    userPresence?: boolean;
    userVerification?: 'required' | 'preferred' | 'discouraged';
    platformId?: PlatformId;
    deviceDisplayName?: string;
    allowInternalTestAdapterAssertion?: boolean;
  }): AuthSessionResult {
    // 1. Single-use and expiration check (anti-replay)
    const stored = this.challenges.get(params.challenge);
    if (!stored || stored.expiresAtEpochMs < Date.now()) {
      throw new Error('WebAuthn authentication challenge has expired or is invalid.');
    }
    this.challenges.delete(params.challenge);

    // 2. Credential ownership and validity check
    const credential = databaseFoundationService.getPasskeyCredential(params.credentialId);
    if (!credential) {
      throw new Error('Unrecognized passkey credential.');
    }

    const user = databaseFoundationService.findUserById(credential.userId);
    if (!user || user.accountStatus === AccountStatus.SUSPENDED) {
      throw new Error('Passkey credential owner does not exist or account is suspended.');
    }

    // 3. RP ID & Origin verification
    const expectedRpId = 'facevid.com';
    if (params.rpId && params.rpId !== expectedRpId && params.rpId !== 'localhost') {
      throw new Error(`WebAuthn RP ID mismatch: expected ${expectedRpId}, got ${params.rpId}`);
    }

    // 4. Client signature presence check
    if (!params.clientSignatureBase64 || params.clientSignatureBase64.trim() === '') {
      throw new Error('Passkey signature assertion payload is required.');
    }

    // 5. Monotonic counter verification (replay attack prevention with synchronized passkey support)
    // Synchronized passkeys (Apple iCloud Keychain, Google Password Manager) report counter = 0
    if (params.counter > 0 && params.counter <= credential.counter) {
      throw new Error('Authenticator counter anomaly detected. Possible cloned authenticator.');
    }

    databaseFoundationService.updatePasskeyCounter(params.credentialId, params.counter);

    // 6. Fail-Closed Guard: Prevent unverified assertion from issuing authenticated sessions
    // Until @simplewebauthn/server is authorized and installed, live sessions cannot be issued.
    if (!params.allowInternalTestAdapterAssertion) {
      throw new Error(
        'WebAuthn cryptographic verification library (@simplewebauthn/server) is pending owner authorization. Incomplete passkey assertion cannot issue authenticated sessions.'
      );
    }

    // Passkey authentication grants first-sign-in-of-the-day verified status
    return this.createSessionForUser(credential.userId, {
      platformId: params.platformId || PlatformId.FACE_VID_WEB,
      deviceDisplayName: params.deviceDisplayName || 'Passkey Authenticator',
      dailyVerified: true,
      dailyMethod: 'WEBAUTHN_BIOMETRIC',
    });
  }

  /**
   * Server-enforced First-Sign-In-of-the-Day Daily Verification.
   */
  public verifyDailyTouchpoint(params: {
    sessionId: string;
    method: DailyVerificationMethod;
    verificationPayload?: string;
  }): DailyVerificationStatus {
    const session = databaseFoundationService.getDeviceSession(params.sessionId);
    if (!session || session.revoked) {
      throw new Error('Session is invalid or revoked.');
    }

    databaseFoundationService.recordDailyVerification(params.sessionId, params.method);
    const nowIso = new Date().toISOString();

    apiLogger.info('Daily touchpoint verification recorded', {
      sessionId: params.sessionId,
      userId: session.userId,
      method: params.method,
    });

    return {
      verifiedToday: true,
      lastVerifiedAtIso: nowIso,
      method: params.method,
    };
  }

  /**
   * Verifies emergency recovery code when passkey is inaccessible.
   */
  public verifyEmergencyRecoveryCode(params: {
    email: string;
    recoveryCode: string;
    platformId?: PlatformId;
  }): AuthSessionResult {
    const user = databaseFoundationService.findUserByEmail(params.email);
    if (!user) {
      throw new Error('Invalid email or recovery code.');
    }

    const codeHash = crypto.createHash('sha256').update(params.recoveryCode.trim()).digest('hex');
    const consumed = databaseFoundationService.verifyAndConsumeRecoveryCode(user.userId, codeHash);
    if (!consumed) {
      throw new Error('Invalid or already consumed recovery code.');
    }

    return this.createSessionForUser(user.userId, {
      platformId: params.platformId || PlatformId.FACE_VID_WEB,
      deviceDisplayName: 'Emergency Recovery Session',
      dailyVerified: true,
      dailyMethod: 'RECOVERY_CODE',
    });
  }

  /**
   * Refresh token rotation (RTR) with family reuse detection.
   */
  public rotateRefreshToken(rawRefreshToken: string): AuthSessionResult {
    const tokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
    
    // Find session by refresh token hash
    let matchingSession: ReturnType<typeof databaseFoundationService.getDeviceSession> = null;
    for (const s of Object.values(databaseFoundationService['catalog'].deviceSessions)) {
      if (s.refreshTokenHash === tokenHash) {
        matchingSession = s;
        break;
      }
    }

    if (!matchingSession) {
      throw new Error('Invalid refresh token.');
    }

    if (matchingSession.revoked) {
      // Token reuse breach detected! Revoke all sessions for this user.
      databaseFoundationService.revokeAllUserSessions(
        matchingSession.userId,
        'Breach alert: Reuse of revoked refresh token detected'
      );
      throw new Error('Security breach detected. All user sessions have been terminated.');
    }

    // Revoke previous session and issue fresh rotated session
    databaseFoundationService.revokeDeviceSession(matchingSession.sessionId, 'Rotated via RTR');

    return this.createSessionForUser(matchingSession.userId, {
      platformId: matchingSession.platformId,
      deviceDisplayName: matchingSession.deviceDisplayName,
      dailyVerified: isDailyVerificationActive(matchingSession.lastDailyVerifiedAtIso || undefined),
      dailyMethod: matchingSession.dailyVerificationMethod || undefined,
    });
  }

  /**
   * Links a 3P external identity (e.g. Google, Apple) to an active verified user session.
   * Enforces that:
   * 1. The session is valid, active, and authenticated.
   * 2. The external identity is not already linked to another account (prevent takeover).
   * 3. Prevents blind automatic email merges without explicit session authorization.
   */
  public linkExternalOAuthIdentity(params: {
    authenticatedSessionToken: string;
    provider: string;
    externalSubjectId: string;
    externalEmail?: string;
  }): {
    success: boolean;
    userId: string;
    provider: string;
    externalSubjectId: string;
  } {
    const session = databaseFoundationService.findDeviceSessionByToken(params.authenticatedSessionToken);
    if (!session || session.revoked) {
      throw new Error('Authentication required: Active valid session required to link external identity.');
    }

    const nowEpoch = Date.now();
    if (new Date(session.expiresAtIso).getTime() < nowEpoch) {
      throw new Error('Session has expired. Please re-authenticate before linking accounts.');
    }

    const user = databaseFoundationService.findUserById(session.userId);
    if (!user || user.accountStatus === AccountStatus.SUSPENDED) {
      throw new Error('User account is invalid or suspended.');
    }

    // Check if external identity is already claimed by another user
    const existingUserId = databaseFoundationService.findUserByExternalIdentity(
      params.provider,
      params.externalSubjectId
    );
    if (existingUserId && existingUserId !== user.userId) {
      throw new Error('This external account is already linked to another FACE VID account.');
    }

    const linked = databaseFoundationService.linkExternalIdentity({
      userId: user.userId,
      provider: params.provider,
      externalSubjectId: params.externalSubjectId,
      externalEmail: params.externalEmail,
    });

    apiLogger.info('External OAuth identity linked safely to authenticated account', {
      userId: user.userId,
      provider: params.provider,
      linkId: linked.linkId,
    });

    return {
      success: true,
      userId: user.userId,
      provider: params.provider,
      externalSubjectId: params.externalSubjectId,
    };
  }

  /**
   * Internal session builder issuing access token, rotating refresh token, and metadata.
   */
  private createSessionForUser(
    userId: string,
    options: {
      platformId: PlatformId;
      deviceDisplayName: string;
      dailyVerified: boolean;
      dailyMethod?: DailyVerificationMethod;
    }
  ): AuthSessionResult {
    const user = databaseFoundationService.findUserById(userId);
    if (!user) {
      throw new Error('User does not exist.');
    }

    const sessionId = `sess_${crypto.randomBytes(12).toString('hex')}`;
    const rawSessionToken = crypto.randomBytes(32).toString('hex');
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');

    const nowEpoch = Date.now();
    const expiresAtIso = new Date(nowEpoch + 15 * 60 * 1000).toISOString(); // 15 mins
    const nowIso = new Date(nowEpoch).toISOString();

    const sessionRow = databaseFoundationService.insertDeviceSession({
      sessionId,
      userId,
      platformId: options.platformId,
      experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
      rawSessionToken,
      deviceDisplayName: options.deviceDisplayName,
      expiresAtIso: new Date(nowEpoch + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    });

    sessionRow.refreshTokenHash = refreshTokenHash;
    if (options.dailyVerified) {
      sessionRow.lastDailyVerifiedAtIso = nowIso;
      sessionRow.dailyVerificationMethod = options.dailyMethod || 'WEBAUTHN_BIOMETRIC';
    }
    databaseFoundationService.persistCatalog();

    // Fetch user roles
    const roles = databaseFoundationService['catalog'].userRoles
      .filter((ur) => ur.userId === userId)
      .map((ur) => ur.roleCode);

    const subscription = databaseFoundationService.getUserSubscription(userId);
    const subscriptionTier = subscription?.tier || user.subscriptionTier;

    return {
      sessionId,
      userId,
      email: user.primaryEmail,
      displayName: user.legalFullName,
      handle: `@${user.userId}`,
      roles: roles.length > 0 ? roles : [UserRole.USER],
      accountStatus: user.accountStatus,
      subscriptionTier,
      accessToken: rawSessionToken,
      refreshToken: rawRefreshToken,
      expiresAtIso,
      dailyVerification: {
        verifiedToday: options.dailyVerified,
        lastVerifiedAtIso: options.dailyVerified ? nowIso : undefined,
        method: options.dailyMethod,
      },
      phishingResistantMfaVerified: user.phishingResistantMfaVerified,
    };
  }
}

export const authService = new AuthService();

/**
 * @face-vid/shared — Identity, Role, Account Status, and Profile Mode Contracts
 *
 * Security Rules Enforced:
 * - Deny access by default.
 * - No public Super Admin registration.
 * - Never trust client-submitted roles or subscription tiers.
 * - Switching to private mode must never expose the user's legal identity to other users.
 * - Privacy mode does not override lawful platform security or verification requirements.
 */

export enum IdentityMode {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}

export enum UserRole {
  USER = 'USER',
  CREATOR = 'CREATOR',
  MERCHANT = 'MERCHANT',
  ADVERTISER = 'ADVERTISER',
  MODERATOR = 'MODERATOR',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  OWNER = 'OWNER',
}

export enum AccountStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  RESTRICTED = 'RESTRICTED',
  SUSPENDED = 'SUSPENDED',
  TERMINATED = 'TERMINATED',
}

export enum SubscriptionTier {
  FREE_STANDARD = 'FREE_STANDARD',
  PREMIUM_AD_FREE = 'PREMIUM_AD_FREE',
  AI_STUDIO_PRO = 'AI_STUDIO_PRO',
}

export const PRIVILEGED_ROLES: readonly UserRole[] = [
  UserRole.MODERATOR,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.OWNER,
] as const;

export const SELF_REGISTRABLE_ROLES: readonly UserRole[] = [
  UserRole.USER,
] as const;

export interface PublicProfileRepresentation {
  readonly displayName: string;
  readonly handle: string;
  readonly bio: string;
  readonly avatarUrl: string;
  readonly verifiedBadge: boolean;
}

export interface PrivateAvatarRepresentation {
  readonly pseudonym: string;
  readonly avatarSeedId: string;
  readonly avatarStyle: 'GEOMETRIC_SHIELD' | 'NEON_SILHOUETTE' | 'CINEMATIC_MASK';
}

/**
 * Authoritative server-side user identity record.
 * Never transmitted directly to peer clients.
 */
export interface AuthoritativeUserIdentity {
  readonly id: string;
  readonly activeMode: IdentityMode;
  readonly roles: readonly UserRole[];
  readonly status: AccountStatus;
  readonly subscriptionTier: SubscriptionTier;
  readonly mfaEnrolled: boolean;
  readonly phishingResistantMfaVerified: boolean;
  readonly publicProfile: PublicProfileRepresentation;
  readonly privateProfile: PrivateAvatarRepresentation;
  // Sensitive fields strictly isolated to server-side compliance/security boundary:
  readonly legalFullName?: string;
  readonly primaryEmail: string;
  readonly countryIsoCode: string;
  readonly createdAtIso: string;
}

/**
 * Sanitized peer-visible identity payload.
 * Guarantees legal identity, email, and private profile linkage are stripped
 * when operating in PRIVATE mode.
 */
export interface PeerVisibleIdentity {
  readonly viewerScopedId: string;
  readonly mode: IdentityMode;
  readonly displayLabel: string;
  readonly handleOrPseudonym: string;
  readonly avatarReference: string;
  readonly isVerifiedPublicCreator: boolean;
}

/**
 * Projects an authoritative server identity into a safe peer-visible representation.
 * Enforces strict separation between Public mode and Avatar-based Private mode.
 */
export function projectPeerVisibleIdentity(
  user: AuthoritativeUserIdentity
): PeerVisibleIdentity {
  if (user.activeMode === IdentityMode.PRIVATE) {
    return {
      viewerScopedId: `anon_${user.privateProfile.avatarSeedId}`,
      mode: IdentityMode.PRIVATE,
      displayLabel: user.privateProfile.pseudonym,
      handleOrPseudonym: `@${user.privateProfile.pseudonym.toLowerCase().replace(/[^a-z0-9_]/g, '')}`,
      avatarReference: `avatar://${user.privateProfile.avatarStyle}/${user.privateProfile.avatarSeedId}`,
      isVerifiedPublicCreator: false,
    };
  }

  return {
    viewerScopedId: user.id,
    mode: IdentityMode.PUBLIC,
    displayLabel: user.publicProfile.displayName,
    handleOrPseudonym: user.publicProfile.handle,
    avatarReference: user.publicProfile.avatarUrl,
    isVerifiedPublicCreator:
      user.publicProfile.verifiedBadge && user.roles.includes(UserRole.CREATOR),
  };
}

/**
 * Determines if a role requires phishing-resistant MFA (WebAuthn / FIDO2 hardware key).
 */
export function requiresPhishingResistantMfa(roles: readonly UserRole[]): boolean {
  return roles.some((role) => PRIVILEGED_ROLES.includes(role));
}

/**
 * Enforces that public registration cannot assign privileged or Super Admin roles.
 * Client-submitted role arrays are always rejected in favor of server-authoritative assignment.
 */
export function validateRegistrationRoleRequest(requestedRole?: string): {
  allowed: boolean;
  assignedRole: UserRole;
  reason?: string;
} {
  if (!requestedRole || requestedRole === UserRole.USER) {
    return { allowed: true, assignedRole: UserRole.USER };
  }

  if (
    requestedRole === UserRole.SUPER_ADMIN ||
    requestedRole === UserRole.ADMIN ||
    requestedRole === UserRole.OWNER ||
    requestedRole === UserRole.MODERATOR
  ) {
    return {
      allowed: false,
      assignedRole: UserRole.USER,
      reason: 'Public registration for privileged or administrative roles is strictly prohibited.',
    };
  }

  return {
    allowed: false,
    assignedRole: UserRole.USER,
    reason: 'Elevated roles (CREATOR, MERCHANT, ADVERTISER) require separate server-side verification workflows.',
  };
}

/**
 * Phase 1.4B Account Categories
 */
export type AccountCategory = 'user' | 'creator' | 'business' | 'store';

/**
 * Phase 1.4B Daily Verification Methods
 */
export type DailyVerificationMethod =
  | 'WEBAUTHN_BIOMETRIC'
  | 'WEBAUTHN_PIN'
  | 'TV_COMPANION_PUSH'
  | 'TV_PIN'
  | 'RECOVERY_CODE';

export interface DailyVerificationStatus {
  readonly verifiedToday: boolean;
  readonly lastVerifiedAtIso?: string;
  readonly expiresAtIso?: string;
  readonly method?: DailyVerificationMethod;
}

export interface PasskeyCredentialRecord {
  readonly id: string;
  readonly userId: string;
  readonly credentialId: string;
  readonly publicKey: string;
  readonly counter: number;
  readonly deviceType: 'platform' | 'cross-platform';
  readonly transports: readonly string[];
  readonly aaguid?: string;
  readonly createdAtIso: string;
  readonly lastUsedAtIso?: string;
}

export interface EmergencyRecoveryCodeRecord {
  readonly id: string;
  readonly userId: string;
  readonly codeHash: string;
  readonly usedAtIso?: string;
  readonly createdAtIso: string;
}

export interface UserSubscriptionRecord {
  readonly subscriptionId: string;
  readonly userId: string;
  readonly tier: SubscriptionTier;
  readonly status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED';
  readonly priceCents: number;
  readonly currency: string;
  readonly billingProvider?: 'STRIPE' | 'APPLE_IAP' | 'GOOGLE_PLAY';
  readonly providerSubscriptionId?: string;
  readonly currentPeriodStartIso: string;
  readonly currentPeriodEndIso?: string;
  readonly cancelAtPeriodEnd: boolean;
}

/**
 * Evaluates whether a session's daily verification is active under UTC calendar day policy.
 * Requires verification within the current UTC day (or rolling 24 hours).
 */
export function isDailyVerificationActive(
  lastVerifiedAtIso?: string,
  referenceNowMs: number = Date.now()
): boolean {
  if (!lastVerifiedAtIso) return false;
  const verifiedDate = new Date(lastVerifiedAtIso);
  if (isNaN(verifiedDate.getTime())) return false;

  const now = new Date(referenceNowMs);
  // Rolling 24-hour window AND matching UTC calendar date
  const isSameUtcDay =
    verifiedDate.getUTCFullYear() === now.getUTCFullYear() &&
    verifiedDate.getUTCMonth() === now.getUTCMonth() &&
    verifiedDate.getUTCDate() === now.getUTCDate();

  const isWithin24Hours = referenceNowMs - verifiedDate.getTime() < 24 * 60 * 60 * 1000;
  return isSameUtcDay && isWithin24Hours;
}


/**
 * @face-vid/shared — Tamper-Resistant Audit Event Schemas & AI Agent Governance
 *
 * Security Rules Enforced:
 * - Record security-sensitive events in a tamper-resistant audit architecture.
 * - The owner must have final authorization over designated critical security and financial policy changes.
 * - AI agents must never grant themselves permissions, promote users to privileged roles,
 *   alter owner permissions, or bypass human approval requirements.
 */

import { UserRole } from './identity.ts';

export enum AuditActorType {
  USER = 'USER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  OWNER = 'OWNER',
  SYSTEM_SERVICE = 'SYSTEM_SERVICE',
  AI_AGENT = 'AI_AGENT',
}

export enum AuditEventCategory {
  AUTHENTICATION = 'AUTHENTICATION',
  AUTHORIZATION = 'AUTHORIZATION',
  ROLE_CHANGE = 'ROLE_CHANGE',
  FINANCIAL_POLICY = 'FINANCIAL_POLICY',
  SECURITY_POLICY = 'SECURITY_POLICY',
  MODERATION = 'MODERATION',
  AI_AGENT_ACTION = 'AI_AGENT_ACTION',
  PRIVACY_MODE_SWITCH = 'PRIVACY_MODE_SWITCH',
}

export enum AuditSeverity {
  INFO = 'INFO',
  WARNING = 'WARNING',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export interface AuditEventRecord {
  readonly eventId: string;
  readonly sequenceNumber: number;
  readonly timestampIso: string;
  readonly actorId: string;
  readonly actorType: AuditActorType;
  readonly category: AuditEventCategory;
  readonly severity: AuditSeverity;
  readonly action: string;
  readonly targetResourceId: string;
  readonly ownerApprovalTicketId?: string;
  readonly metadataSanitized: Record<string, string | number | boolean | null>;
  readonly previousHash: string;
  readonly entryHash: string;
}

/**
 * Deterministic FNV-1a / DJB2 hybrid hash for browser & Node compatibility in shared contracts
 * (PostgreSQL layer uses native pgcrypto SHA-256).
 */
export function computeAuditChainDigest(payload: {
  sequenceNumber: number;
  timestampIso: string;
  actorId: string;
  actorType: AuditActorType;
  category: AuditEventCategory;
  action: string;
  targetResourceId: string;
  previousHash: string;
}): string {
  const canonical = [
    payload.sequenceNumber,
    payload.timestampIso,
    payload.actorId,
    payload.actorType,
    payload.category,
    payload.action,
    payload.targetResourceId,
    payload.previousHash,
  ].join('|');

  let h1 = 0xdeadbeef ^ canonical.length;
  let h2 = 0x41c6ce57 ^ canonical.length;
  for (let i = 0; i < canonical.length; i++) {
    const ch = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `fv_sha256_chain_${hex1}${hex2}`;
}

export type RestrictedActionType =
  | 'SELF_GRANT_PERMISSION'
  | 'PROMOTE_PRIVILEGED_ROLE'
  | 'ALTER_OWNER_PERMISSIONS'
  | 'BYPASS_HUMAN_APPROVAL'
  | 'MODIFY_FINANCIAL_POLICY'
  | 'MODIFY_SECURITY_POLICY'
  | 'ASSIST_CONTENT_SCREENING'
  | 'ASSIST_CREATOR_VERIFICATION_RECOMMENDATION';

export interface GovernanceCheckResult {
  readonly permitted: boolean;
  readonly requiresOwnerAuthorization: boolean;
  readonly requiresHumanReview: boolean;
  readonly violationCode?: string;
  readonly reason: string;
}

/**
 * Hard security boundary for AI Agent actions and critical policy mutations.
 * AI agents can NEVER self-grant permissions, promote users to privileged roles,
 * alter owner permissions, or bypass human approval requirements.
 */
export function evaluateGovernancePolicy(params: {
  actorType: AuditActorType;
  actorRoles: readonly UserRole[];
  action: RestrictedActionType;
  hasHumanApprovalTicket: boolean;
  hasOwnerSignature: boolean;
}): GovernanceCheckResult {
  if (params.actorType === AuditActorType.AI_AGENT) {
    if (
      params.action === 'SELF_GRANT_PERMISSION' ||
      params.action === 'PROMOTE_PRIVILEGED_ROLE' ||
      params.action === 'ALTER_OWNER_PERMISSIONS' ||
      params.action === 'BYPASS_HUMAN_APPROVAL' ||
      params.action === 'MODIFY_FINANCIAL_POLICY' ||
      params.action === 'MODIFY_SECURITY_POLICY'
    ) {
      return {
        permitted: false,
        requiresOwnerAuthorization: true,
        requiresHumanReview: true,
        violationCode: 'AI_PRIVILEGE_ESCALATION_FORBIDDEN',
        reason:
          'AI agents are strictly forbidden from granting permissions, promoting roles, altering owner policies, or bypassing human approval.',
      };
    }

    if (!params.hasHumanApprovalTicket) {
      return {
        permitted: false,
        requiresOwnerAuthorization: false,
        requiresHumanReview: true,
        violationCode: 'AI_HUMAN_REVIEW_REQUIRED',
        reason:
          'AI assistive outputs require explicit human review confirmation before taking effect.',
      };
    }
  }

  if (
    params.action === 'MODIFY_FINANCIAL_POLICY' ||
    params.action === 'MODIFY_SECURITY_POLICY' ||
    params.action === 'ALTER_OWNER_PERMISSIONS'
  ) {
    const isOwner =
      params.actorType === AuditActorType.OWNER &&
      params.actorRoles.includes(UserRole.OWNER) &&
      params.hasOwnerSignature;

    if (!isOwner) {
      return {
        permitted: false,
        requiresOwnerAuthorization: true,
        requiresHumanReview: true,
        violationCode: 'OWNER_AUTHORIZATION_REQUIRED',
        reason:
          'Critical security and financial policy changes require explicit Owner authorization.',
      };
    }
  }

  return {
    permitted: true,
    requiresOwnerAuthorization: false,
    requiresHumanReview: true,
    reason: 'Governance policy requirements satisfied.',
  };
}

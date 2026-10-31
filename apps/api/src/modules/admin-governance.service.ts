/**
 * @face-vid/api — Phase 1.4B Admin Governance & Immutable Audit Service
 *
 * Implements:
 * - Founding Creator Program review and atomic 3,000,000 quota management.
 * - Business / Advertiser corporate compliance review and approval.
 * - Store / Merchant commercial registry review and approval.
 * - Account suspension and real-time session termination.
 * - Tamper-evident hash-chained audit event logging.
 */

import crypto from 'node:crypto';
import {
  AuditActorType,
  AuditEventCategory,
  AuditSeverity,
  UserRole,
  computeAuditChainDigest,
  type AuditEventRecord,
} from '../../../../packages/shared/src/index.ts';
import { databaseFoundationService } from '../database/database.service.ts';
import { apiLogger } from '../common/logger.ts';

export interface GovernanceReviewResult {
  success: boolean;
  message: string;
  targetId: string;
  auditDigest: string;
  allocatedSlot?: number;
}

export class AdminGovernanceService {
  /**
   * Appends an audit event to the immutable hash chain.
   */
  public logAuditEvent(params: {
    actorId: string;
    actorType: AuditActorType;
    category: AuditEventCategory;
    action: string;
    targetId: string;
    details: Record<string, unknown>;
  }): AuditEventRecord {
    const catalog = databaseFoundationService['catalog'];
    const prevDigest =
      catalog.auditEvents.length > 0
        ? catalog.auditEvents[catalog.auditEvents.length - 1]!.entryHash
        : 'GENESIS_DIGEST_PHASE_1B1';

    const eventId = `aud_${crypto.randomBytes(12).toString('hex')}`;
    const sequenceNumber = catalog.auditEvents.length + 1;
    const timestampIso = new Date().toISOString();

    const entryHash = computeAuditChainDigest({
      sequenceNumber,
      timestampIso,
      actorId: params.actorId,
      actorType: params.actorType,
      category: params.category,
      action: params.action,
      targetResourceId: params.targetId,
      previousHash: prevDigest,
    });

    const sanitizedDetails: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(params.details)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) {
        sanitizedDetails[k] = v;
      } else {
        sanitizedDetails[k] = String(v);
      }
    }

    const record: AuditEventRecord = {
      eventId,
      sequenceNumber,
      timestampIso,
      actorId: params.actorId,
      actorType: params.actorType,
      category: params.category,
      severity: AuditSeverity.HIGH,
      action: params.action,
      targetResourceId: params.targetId,
      metadataSanitized: sanitizedDetails,
      previousHash: prevDigest,
      entryHash,
    };

    catalog.auditEvents.push(record);
    databaseFoundationService.persistCatalog();
    return record;
  }

  /**
   * Reviews and approves a Founding Creator application under the 3,000,000 quota limit.
   */
  public approveFoundingCreator(params: {
    adminUserId: string;
    verificationId: string;
    targetUserId: string;
    reason: string;
  }): GovernanceReviewResult {
    const allocation = databaseFoundationService.allocateFoundingCreatorSlot(
      params.adminUserId,
      params.targetUserId
    );

    if (!allocation.success) {
      throw new Error(allocation.reason || 'Failed to allocate Founding Creator slot.');
    }

    databaseFoundationService.approveCreatorVerification(
      params.verificationId,
      params.adminUserId
    );

    const audit = this.logAuditEvent({
      actorId: params.adminUserId,
      actorType: AuditActorType.ADMIN,
      category: AuditEventCategory.ROLE_CHANGE,
      action: 'APPROVE_FOUNDING_CREATOR',
      targetId: params.targetUserId,
      details: {
        verificationId: params.verificationId,
        allocatedSlot: allocation.allocatedSlot,
        quotaMax: 3000000,
        reason: params.reason,
      },
    });

    apiLogger.info('Founding creator approved', {
      adminUserId: params.adminUserId,
      targetUserId: params.targetUserId,
      slot: allocation.allocatedSlot,
    });

    return {
      success: true,
      message: `Creator approved with Founding Creator Slot #${allocation.allocatedSlot}.`,
      targetId: params.targetUserId,
      auditDigest: audit.entryHash,
      allocatedSlot: allocation.allocatedSlot,
    };
  }

  /**
   * Reviews and approves a Business Advertiser account.
   */
  public approveBusinessAdvertiser(params: {
    adminUserId: string;
    advertiserId: string;
    reason: string;
  }): GovernanceReviewResult {
    const success = databaseFoundationService.approveBusinessAdvertiser(
      params.advertiserId,
      params.adminUserId
    );
    if (!success) {
      throw new Error('Business advertiser record not found.');
    }

    const audit = this.logAuditEvent({
      actorId: params.adminUserId,
      actorType: AuditActorType.ADMIN,
      category: AuditEventCategory.ROLE_CHANGE,
      action: 'APPROVE_BUSINESS_ADVERTISER',
      targetId: params.advertiserId,
      details: { reason: params.reason },
    });

    return {
      success: true,
      message: 'Business Advertiser approved and granted ADVERTISER role.',
      targetId: params.advertiserId,
      auditDigest: audit.entryHash,
    };
  }

  /**
   * Reviews and approves a Store / Merchant account.
   */
  public approveStoreMerchant(params: {
    adminUserId: string;
    merchantId: string;
    reason: string;
  }): GovernanceReviewResult {
    const success = databaseFoundationService.approveMerchant(
      params.merchantId,
      params.adminUserId
    );
    if (!success) {
      throw new Error('Merchant record not found.');
    }

    const audit = this.logAuditEvent({
      actorId: params.adminUserId,
      actorType: AuditActorType.ADMIN,
      category: AuditEventCategory.ROLE_CHANGE,
      action: 'APPROVE_STORE_MERCHANT',
      targetId: params.merchantId,
      details: { reason: params.reason },
    });

    return {
      success: true,
      message: 'Store approved and granted MERCHANT role with live shopping capabilities.',
      targetId: params.merchantId,
      auditDigest: audit.entryHash,
    };
  }

  /**
   * Suspends a user account and terminates all active sessions immediately.
   */
  public suspendAccount(params: {
    adminUserId: string;
    targetUserId: string;
    reason: string;
  }): GovernanceReviewResult {
    const success = databaseFoundationService.suspendUserAccount(
      params.targetUserId,
      params.adminUserId,
      params.reason
    );
    if (!success) {
      throw new Error('Target user not found.');
    }

    const audit = this.logAuditEvent({
      actorId: params.adminUserId,
      actorType: AuditActorType.ADMIN,
      category: AuditEventCategory.SECURITY_POLICY,
      action: 'SUSPEND_ACCOUNT',
      targetId: params.targetUserId,
      details: { reason: params.reason },
    });

    return {
      success: true,
      message: `Account ${params.targetUserId} has been suspended and all sessions revoked.`,
      targetId: params.targetUserId,
      auditDigest: audit.entryHash,
    };
  }

  /**
   * Retrieves high-level governance and verification metrics.
   */
  public getGovernanceMetrics(): {
    foundingCreatorsAllocated: number;
    foundingCreatorsCeiling: number;
    pendingCreatorReviews: number;
    pendingBusinessReviews: number;
    pendingStoreReviews: number;
    totalAudits: number;
  } {
    const catalog = databaseFoundationService['catalog'];
    const pendingCreators = Object.values(catalog.creatorVerifications).filter(
      (v) => v.verificationStatus === 'PENDING_HUMAN_REVIEW'
    ).length;
    const pendingBiz = Object.values(catalog.businessAdvertiserAccounts).filter(
      (b) => b.complianceStatus === 'PENDING_REVIEW'
    ).length;
    const pendingStores = Object.values(catalog.merchantAccounts).filter(
      (m) => m.kybVerificationStatus === 'PENDING_KYB'
    ).length;

    return {
      foundingCreatorsAllocated: catalog.foundingCreatorProgramState.allocatedCount,
      foundingCreatorsCeiling: catalog.foundingCreatorProgramState.maxEligibleCreators,
      pendingCreatorReviews: pendingCreators,
      pendingBusinessReviews: pendingBiz,
      pendingStoreReviews: pendingStores,
      totalAudits: catalog.auditEvents.length,
    };
  }
}

export const adminGovernanceService = new AdminGovernanceService();

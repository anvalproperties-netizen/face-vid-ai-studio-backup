/**
 * @face-vid/shared — Five Monetisation Engines & Server-Authoritative Double-Entry Ledger Contracts
 *
 * Implements Phase 1A Task 4 Requirements:
 * 1. Prepaid user-to-creator calls (ENGINE_1_PREPAID_CREATOR_CALLS)
 * 2. Creator advertising services for Face Vid Shop merchants (ENGINE_2_CREATOR_MERCHANT_AD_SERVICES)
 * 3. Face Vid Shop merchant sales commissions (ENGINE_3_SHOP_MERCHANT_COMMISSIONS)
 * 4. Face Vid Business advertising revenue (ENGINE_4_BUSINESS_AD_REVENUE)
 * 5. Face Vid AI Studio subscriptions, credits, filters and paid tools (ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS)
 *
 * Mandatory Financial Security Controls:
 * - No active payment gateway charging in Phase 1A.
 * - Zero invented commission percentages (rates remain null/unconfigured until Owner authorization).
 * - Server-authoritative financial operations only.
 * - Mandatory idempotency keys with payload-hash conflict detection.
 * - Balanced double-entry ledger invariant (sum(DEBIT) === sum(CREDIT) in integer minor units).
 * - Strict Creator and Merchant balance separation (no commingling).
 * - Refund and chargeback state machine with automatic reserve encumbrance.
 * - Owner cryptographic authorization required for protected financial policy changes.
 * - AI agents strictly prohibited from changing financial permissions or policies.
 */

import { AuditActorType } from './audit.ts';
import { UserRole } from './identity.ts';

export enum MonetizationEngineId {
  ENGINE_1_PREPAID_CREATOR_CALLS = 'ENGINE_1_PREPAID_CREATOR_CALLS',
  ENGINE_2_CREATOR_MERCHANT_AD_SERVICES = 'ENGINE_2_CREATOR_MERCHANT_AD_SERVICES',
  ENGINE_3_SHOP_MERCHANT_COMMISSIONS = 'ENGINE_3_SHOP_MERCHANT_COMMISSIONS',
  ENGINE_4_BUSINESS_AD_REVENUE = 'ENGINE_4_BUSINESS_AD_REVENUE',
  ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS = 'ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS',
}

export enum FinancialTransactionState {
  PHASE_1A_CONTRACT_ONLY = 'PHASE_1A_CONTRACT_ONLY',
  ESCROW_RESERVED = 'ESCROW_RESERVED',
  SETTLED = 'SETTLED',
  REFUND_REQUESTED = 'REFUND_REQUESTED',
  REFUNDED = 'REFUNDED',
  CHARGEBACK_DISPUTE_OPEN = 'CHARGEBACK_DISPUTE_OPEN',
  CHARGEBACK_PAYOUT_FROZEN = 'CHARGEBACK_PAYOUT_FROZEN',
  CHARGEBACK_LOST_REVERSED = 'CHARGEBACK_LOST_REVERSED',
  CHARGEBACK_WON_RELEASED = 'CHARGEBACK_WON_RELEASED',
}

export enum AccountSegregationDomain {
  USER_PREPAID_WALLET = 'USER_PREPAID_WALLET',
  CREATOR_EARNINGS_PAYABLE = 'CREATOR_EARNINGS_PAYABLE',
  CREATOR_CALL_ESCROW = 'CREATOR_CALL_ESCROW',
  CREATOR_AD_SERVICE_ESCROW = 'CREATOR_AD_SERVICE_ESCROW',
  MERCHANT_SALES_PAYABLE = 'MERCHANT_SALES_PAYABLE',
  MERCHANT_ORDER_ESCROW = 'MERCHANT_ORDER_ESCROW',
  MERCHANT_CHARGEBACK_RESERVE = 'MERCHANT_CHARGEBACK_RESERVE',
  ADVERTISER_CAMPAIGN_ESCROW = 'ADVERTISER_CAMPAIGN_ESCROW',
  PLATFORM_COMMISSION_REVENUE = 'PLATFORM_COMMISSION_REVENUE',
  PLATFORM_AD_REVENUE = 'PLATFORM_AD_REVENUE',
  PLATFORM_AI_STUDIO_REVENUE = 'PLATFORM_AI_STUDIO_REVENUE',
  PLATFORM_DISPUTE_HOLD = 'PLATFORM_DISPUTE_HOLD',
}

export enum LedgerEntryDirection {
  DEBIT = 'DEBIT',
  CREDIT = 'CREDIT',
}

/**
 * Unconfigured Phase 1A financial policy contract.
 * No commission percentages or prices are invented; all values are null until Owner sign-off.
 */
export interface MonetizationEnginePolicyContract {
  readonly engineId: MonetizationEngineId;
  readonly displayName: string;
  readonly description: string;
  readonly phase1aPaymentsActive: false;
  readonly commercialRateStatus: 'UNCONFIGURED_AWAITING_OWNER_APPROVAL';
  readonly configuredCommissionBasisPoints: null;
  readonly configuredBasePriceMinorUnits: null;
  readonly requiredEscrowAccount: AccountSegregationDomain;
  readonly primarySettlementAccount: AccountSegregationDomain;
  readonly refundAndChargebackPolicy: string;
}

export const FIVE_MONETIZATION_ENGINE_CONTRACTS: readonly MonetizationEnginePolicyContract[] = [
  {
    engineId: MonetizationEngineId.ENGINE_1_PREPAID_CREATOR_CALLS,
    displayName: '1. Prepaid User-to-Creator Calls',
    description:
      'Prepaid 1-to-1 video/voice sessions with verified creators. Distinct from free user-to-user internet calls.',
    phase1aPaymentsActive: false,
    commercialRateStatus: 'UNCONFIGURED_AWAITING_OWNER_APPROVAL',
    configuredCommissionBasisPoints: null,
    configuredBasePriceMinorUnits: null,
    requiredEscrowAccount: AccountSegregationDomain.CREATOR_CALL_ESCROW,
    primarySettlementAccount: AccountSegregationDomain.CREATOR_EARNINGS_PAYABLE,
    refundAndChargebackPolicy:
      'Unconnected or prematurely dropped creator calls automatically refund unspent escrow to User Prepaid Wallet.',
  },
  {
    engineId: MonetizationEngineId.ENGINE_2_CREATOR_MERCHANT_AD_SERVICES,
    displayName: '2. Creator Advertising Services for Face Vid Shop Merchants',
    description:
      'Sponsored creator product showcases and promotional integrations commissioned by verified Face Vid Shop merchants.',
    phase1aPaymentsActive: false,
    commercialRateStatus: 'UNCONFIGURED_AWAITING_OWNER_APPROVAL',
    configuredCommissionBasisPoints: null,
    configuredBasePriceMinorUnits: null,
    requiredEscrowAccount: AccountSegregationDomain.CREATOR_AD_SERVICE_ESCROW,
    primarySettlementAccount: AccountSegregationDomain.CREATOR_EARNINGS_PAYABLE,
    refundAndChargebackPolicy:
      'Merchant campaign funds are held in Creator Ad Service Escrow until deliverable verification; disputed deliverables freeze payout.',
  },
  {
    engineId: MonetizationEngineId.ENGINE_3_SHOP_MERCHANT_COMMISSIONS,
    displayName: '3. Face Vid Shop Merchant Sales Commissions',
    description:
      'Video commerce and live shopping product orders with server-authoritative platform sales commission and merchant reserve holds.',
    phase1aPaymentsActive: false,
    commercialRateStatus: 'UNCONFIGURED_AWAITING_OWNER_APPROVAL',
    configuredCommissionBasisPoints: null,
    configuredBasePriceMinorUnits: null,
    requiredEscrowAccount: AccountSegregationDomain.MERCHANT_ORDER_ESCROW,
    primarySettlementAccount: AccountSegregationDomain.MERCHANT_SALES_PAYABLE,
    refundAndChargebackPolicy:
      'Customer refunds and chargebacks debit Merchant Order Escrow / Merchant Chargeback Reserve; strictly segregated from Creator Earnings.',
  },
  {
    engineId: MonetizationEngineId.ENGINE_4_BUSINESS_AD_REVENUE,
    displayName: '4. Face Vid Business Advertising Revenue',
    description:
      'Platform advertising campaigns with AI-assisted pre-screening, mandatory human approval, and server-authoritative budget pacing.',
    phase1aPaymentsActive: false,
    commercialRateStatus: 'UNCONFIGURED_AWAITING_OWNER_APPROVAL',
    configuredCommissionBasisPoints: null,
    configuredBasePriceMinorUnits: null,
    requiredEscrowAccount: AccountSegregationDomain.ADVERTISER_CAMPAIGN_ESCROW,
    primarySettlementAccount: AccountSegregationDomain.PLATFORM_AD_REVENUE,
    refundAndChargebackPolicy:
      'Rejected or unserved ad campaign balances remain refundable from Advertiser Campaign Escrow; invalid traffic is credited back.',
  },
  {
    engineId: MonetizationEngineId.ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS,
    displayName: '5. Face Vid AI Studio Subscriptions, Credits, Filters & Paid Tools',
    description:
      'Recurring AI Studio subscriptions, metered neural rendering credits, real-time optical filters, and paid production tools.',
    phase1aPaymentsActive: false,
    commercialRateStatus: 'UNCONFIGURED_AWAITING_OWNER_APPROVAL',
    configuredCommissionBasisPoints: null,
    configuredBasePriceMinorUnits: null,
    requiredEscrowAccount: AccountSegregationDomain.USER_PREPAID_WALLET,
    primarySettlementAccount: AccountSegregationDomain.PLATFORM_AI_STUDIO_REVENUE,
    refundAndChargebackPolicy:
      'Failed server-side AI Studio render jobs automatically restore deducted compute credits via idempotent compensating journal entries.',
  },
] as const;

export interface LedgerPostingLine {
  readonly lineId: string;
  readonly accountId: string;
  readonly ownerEntityId: string;
  readonly segregationDomain: AccountSegregationDomain;
  readonly direction: LedgerEntryDirection;
  readonly amountMinorUnits: number; // Positive integer minor units only
  readonly currencyIso: string;
}

export interface DoubleEntryJournalTransaction {
  readonly journalId: string;
  readonly idempotencyKey: string;
  readonly engineId: MonetizationEngineId;
  readonly state: FinancialTransactionState;
  readonly currencyIso: string;
  readonly createdByActorId: string;
  readonly createdByActorType: AuditActorType;
  readonly createdAtIso: string;
  readonly lines: readonly LedgerPostingLine[];
  readonly auditDigest: string;
}

/**
 * Enforces that Creator balances and Merchant balances are strictly segregated.
 * Prohibits commingling Creator earnings and Merchant sales in the same ledger account
 * or directly transferring between Creator payable and Merchant payable without escrow clearing.
 */
export function validateCreatorMerchantBalanceSeparation(
  lines: readonly LedgerPostingLine[]
): { valid: boolean; reason?: string } {
  const accountDomainMap = new Map<string, AccountSegregationDomain>();

  for (const line of lines) {
    const existingDomain = accountDomainMap.get(line.accountId);
    if (existingDomain && existingDomain !== line.segregationDomain) {
      return {
        valid: false,
        reason: `Account '${line.accountId}' cannot commingle multiple segregation domains (${existingDomain} vs ${line.segregationDomain}).`,
      };
    }
    accountDomainMap.set(line.accountId, line.segregationDomain);
  }

  const hasCreatorPayable = lines.some(
    (l) => l.segregationDomain === AccountSegregationDomain.CREATOR_EARNINGS_PAYABLE
  );
  const hasMerchantPayable = lines.some(
    (l) => l.segregationDomain === AccountSegregationDomain.MERCHANT_SALES_PAYABLE
  );
  const hasEscrowIntermediary = lines.some(
    (l) =>
      l.segregationDomain === AccountSegregationDomain.CREATOR_AD_SERVICE_ESCROW ||
      l.segregationDomain === AccountSegregationDomain.MERCHANT_ORDER_ESCROW
  );

  if (hasCreatorPayable && hasMerchantPayable && !hasEscrowIntermediary) {
    return {
      valid: false,
      reason:
        'Direct balance commingling between Creator Payable and Merchant Payable without an escrow clearing account is prohibited.',
    };
  }

  return { valid: true };
}

/**
 * Validates a double-entry financial journal transaction:
 * 1. At least 2 posting lines.
 * 2. All amounts must be positive integer minor units (> 0).
 * 3. All lines must share the journal currency.
 * 4. Total DEBIT minor units must equal Total CREDIT minor units.
 * 5. Creator and Merchant balance separation must hold.
 */
export function validateDoubleEntryJournal(
  lines: readonly LedgerPostingLine[],
  expectedCurrencyIso: string
): {
  valid: boolean;
  totalDebitMinorUnits: number;
  totalCreditMinorUnits: number;
  error?: string;
} {
  if (lines.length < 2) {
    return {
      valid: false,
      totalDebitMinorUnits: 0,
      totalCreditMinorUnits: 0,
      error: 'Double-entry journal requires at least two posting lines.',
    };
  }

  let totalDebit = 0;
  let totalCredit = 0;

  for (const line of lines) {
    if (!Number.isInteger(line.amountMinorUnits) || line.amountMinorUnits <= 0) {
      return {
        valid: false,
        totalDebitMinorUnits: totalDebit,
        totalCreditMinorUnits: totalCredit,
        error: `Line '${line.lineId}' has invalid amountMinorUnits (${line.amountMinorUnits}). Must be a positive integer.`,
      };
    }

    if (line.currencyIso !== expectedCurrencyIso) {
      return {
        valid: false,
        totalDebitMinorUnits: totalDebit,
        totalCreditMinorUnits: totalCredit,
        error: `Currency mismatch on line '${line.lineId}': expected ${expectedCurrencyIso}, got ${line.currencyIso}.`,
      };
    }

    if (line.direction === LedgerEntryDirection.DEBIT) {
      totalDebit += line.amountMinorUnits;
    } else {
      totalCredit += line.amountMinorUnits;
    }
  }

  if (totalDebit !== totalCredit) {
    return {
      valid: false,
      totalDebitMinorUnits: totalDebit,
      totalCreditMinorUnits: totalCredit,
      error: `Unbalanced double-entry journal: DEBIT (${totalDebit}) !== CREDIT (${totalCredit}).`,
    };
  }

  const separationCheck = validateCreatorMerchantBalanceSeparation(lines);
  if (!separationCheck.valid) {
    return {
      valid: false,
      totalDebitMinorUnits: totalDebit,
      totalCreditMinorUnits: totalCredit,
      error: separationCheck.reason,
    };
  }

  return {
    valid: true,
    totalDebitMinorUnits: totalDebit,
    totalCreditMinorUnits: totalCredit,
  };
}

/**
 * Validates authorization to modify protected financial policies (commission rates,
 * pricing tables, reserve ratios, payout thresholds).
 * - AI Agents are strictly prohibited.
 * - Super Admins cannot override Owner-protected financial policies without Owner signature.
 */
export function authorizeFinancialPolicyChange(params: {
  actorType: AuditActorType;
  actorRoles: readonly UserRole[];
  hasOwnerCryptographicSignature: boolean;
  ownerApprovalTicketId?: string;
}): {
  authorized: boolean;
  violationCode?:
    | 'AI_FINANCIAL_PERMISSION_FORBIDDEN'
    | 'OWNER_FINANCIAL_AUTHORIZATION_REQUIRED';
  reason: string;
} {
  if (params.actorType === AuditActorType.AI_AGENT) {
    return {
      authorized: false,
      violationCode: 'AI_FINANCIAL_PERMISSION_FORBIDDEN',
      reason:
        'AI agents are strictly prohibited from changing financial permissions, commission rates, or ledger policies.',
    };
  }

  const isVerifiedOwner =
    params.actorType === AuditActorType.OWNER &&
    params.actorRoles.includes(UserRole.OWNER) &&
    params.hasOwnerCryptographicSignature &&
    Boolean(params.ownerApprovalTicketId && params.ownerApprovalTicketId.trim().length > 0);

  if (!isVerifiedOwner) {
    return {
      authorized: false,
      violationCode: 'OWNER_FINANCIAL_AUTHORIZATION_REQUIRED',
      reason:
        'Protected financial policy mutations (commissions, pricing, payout thresholds) require explicit Project Owner cryptographic authorization.',
    };
  }

  return {
    authorized: true,
    reason: 'Owner financial policy authorization verified.',
  };
}

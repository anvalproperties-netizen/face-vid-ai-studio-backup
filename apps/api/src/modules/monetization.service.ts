import crypto from 'node:crypto';
import {
  AccountSegregationDomain,
  AuditActorType,
  FIVE_MONETIZATION_ENGINE_CONTRACTS,
  FinancialTransactionState,
  LedgerEntryDirection,
  MonetizationEngineId,
  validateCreatorMerchantBalanceSeparation,
  validateDoubleEntryJournal,
  type LedgerPostingLine,
} from '../../../../packages/shared/src/index.ts';
import { apiLogger } from '../common/logger.ts';

export interface AuthoritativeJournalTransaction {
  readonly journalId: string;
  readonly idempotencyKey: string;
  readonly payloadSha256: string;
  readonly engineId: MonetizationEngineId;
  readonly currencyIso: string;
  readonly actorId: string;
  readonly actorType: AuditActorType;
  readonly state: FinancialTransactionState;
  readonly lines: readonly LedgerPostingLine[];
  readonly totalMinorUnits: number;
  readonly createdAtIso: string;
}

export class MonetizationLedgerService {
  private readonly transactionsById: Map<string, AuthoritativeJournalTransaction> = new Map();
  private readonly transactionsByIdemKey: Map<string, AuthoritativeJournalTransaction> = new Map();
  private readonly auditTrail: Array<{ timestampIso: string; action: string; journalId?: string; actorId?: string }> = [];

  public getEngineContracts() {
    return FIVE_MONETIZATION_ENGINE_CONTRACTS;
  }

  public getFinancialAuditTrail() {
    return this.auditTrail;
  }

  public recordAuthoritativeJournal(params: {
    idempotencyKey: string;
    engineId: MonetizationEngineId;
    currencyIso?: string;
    actorId: string;
    actorType: AuditActorType;
    state?: FinancialTransactionState;
    lines: readonly LedgerPostingLine[];
    clientSubmittedBalanceOverride?: number;
  }): {
    ok: boolean;
    statusCode: number;
    errorCode?: string;
    message?: string;
    idempotentReplay?: boolean;
    transaction?: AuthoritativeJournalTransaction;
  } {
    // 1. Strict AI Agent prohibition
    if (params.actorType === AuditActorType.AI_AGENT) {
      this.auditTrail.push({
        timestampIso: new Date().toISOString(),
        action: 'AI_AGENT_FINANCIAL_ATTEMPT_BLOCKED',
        actorId: params.actorId,
      });
      return {
        ok: false,
        statusCode: 403,
        errorCode: 'AI_FINANCIAL_PERMISSION_FORBIDDEN',
        message: 'AI agents are strictly forbidden from recording or modifying financial journals.',
      };
    }

    // 2. Reject client-submitted balance overrides
    if (params.clientSubmittedBalanceOverride !== undefined) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'CLIENT_SUBMITTED_BALANCE_OVERRIDE_REJECTED',
        message: 'Client-submitted balance overrides are rejected; ledger entries are strictly server-authoritative.',
      };
    }

    // 3. Double-entry balanced verification (DEBITS === CREDITS)
    const currencyIso = params.currencyIso || 'ZAR';
    const balancedCheck = validateDoubleEntryJournal(params.lines, currencyIso);
    if (!balancedCheck.valid) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'UNBALANCED_JOURNAL_ENTRIES',
        message: balancedCheck.error || 'Journal entries are not balanced.',
      };
    }

    // 4. Creator/Merchant balance separation check
    const commingleCheck = validateCreatorMerchantBalanceSeparation(params.lines);
    if (!commingleCheck.valid) {
      return {
        ok: false,
        statusCode: 400,
        errorCode: 'CREATOR_MERCHANT_COMMINGLING_FORBIDDEN',
        message: commingleCheck.reason || 'Creator and merchant funds must remain segregated.',
      };
    }

    // Compute payload hash for idempotency conflict detection
    const canonicalPayload = JSON.stringify({
      engineId: params.engineId,
      currencyIso: params.currencyIso || 'ZAR',
      actorId: params.actorId,
      lines: params.lines.map((l) => ({
        accountId: l.accountId,
        direction: l.direction,
        amountMinorUnits: l.amountMinorUnits,
      })),
    });
    const payloadSha256 = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

    // 5. Check idempotency
    const existing = this.transactionsByIdemKey.get(params.idempotencyKey);
    if (existing) {
      if (existing.payloadSha256 === payloadSha256 && existing.engineId === params.engineId) {
        return {
          ok: true,
          statusCode: 200,
          idempotentReplay: true,
          transaction: existing,
        };
      }
      return {
        ok: false,
        statusCode: 409,
        errorCode: 'IDEMPOTENCY_KEY_PAYLOAD_CONFLICT',
        message: 'A journal with this idempotency key exists with differing payload parameters.',
      };
    }

    const journalId = `jrnl_p1b1_${this.transactionsById.size + 1}_${Date.now().toString(36)}`;
    const tx: AuthoritativeJournalTransaction = {
      journalId,
      idempotencyKey: params.idempotencyKey,
      payloadSha256,
      engineId: params.engineId,
      currencyIso: params.currencyIso || 'ZAR',
      actorId: params.actorId,
      actorType: params.actorType,
      state: params.state || FinancialTransactionState.PHASE_1A_CONTRACT_ONLY,
      lines: params.lines,
      totalMinorUnits: balancedCheck.totalDebitMinorUnits,
      createdAtIso: new Date().toISOString(),
    };

    this.transactionsById.set(journalId, tx);
    this.transactionsByIdemKey.set(params.idempotencyKey, tx);
    this.auditTrail.push({
      timestampIso: tx.createdAtIso,
      action: 'JOURNAL_POSTED',
      journalId,
      actorId: params.actorId,
    });

    apiLogger.info('Recorded server-authoritative Phase 1B-1 double-entry journal', {
      journalId,
      engineId: params.engineId,
      totalMinorUnits: tx.totalMinorUnits,
    });

    return {
      ok: true,
      statusCode: 201,
      idempotentReplay: false,
      transaction: tx,
    };
  }

  public transitionRefundOrChargeback(params: {
    originalJournalId: string;
    idempotencyKey: string;
    transitionType: 'OPEN_CHARGEBACK_DISPUTE' | 'EXECUTE_REFUND';
    actorId: string;
    actorType: AuditActorType;
  }): {
    ok: boolean;
    compensatingTransaction?: AuthoritativeJournalTransaction;
    error?: string;
  } {
    const orig = this.transactionsById.get(params.originalJournalId);
    if (!orig) {
      return { ok: false, error: 'Original journal not found.' };
    }

    const compensatingLines = orig.lines.map((l) => ({
      ...l,
      lineId: `${l.lineId}_cb`,
      direction: l.direction === LedgerEntryDirection.DEBIT ? LedgerEntryDirection.CREDIT : LedgerEntryDirection.DEBIT,
    }));

    const compTx: AuthoritativeJournalTransaction = {
      journalId: `jrnl_cb_${Date.now().toString(36)}`,
      idempotencyKey: params.idempotencyKey,
      payloadSha256: 'compensating_hash',
      engineId: orig.engineId,
      currencyIso: orig.currencyIso,
      actorId: params.actorId,
      actorType: params.actorType,
      state: FinancialTransactionState.CHARGEBACK_PAYOUT_FROZEN,
      lines: compensatingLines,
      totalMinorUnits: orig.totalMinorUnits,
      createdAtIso: new Date().toISOString(),
    };

    this.auditTrail.push({
      timestampIso: compTx.createdAtIso,
      action: params.transitionType,
      journalId: compTx.journalId,
      actorId: params.actorId,
    });

    return {
      ok: true,
      compensatingTransaction: compTx,
    };
  }
}

export const monetizationLedgerService = new MonetizationLedgerService();

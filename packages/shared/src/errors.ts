/**
 * @face-vid/shared — Standardized API Error & Validation Contracts
 */

export enum ApiErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN_DENY_BY_DEFAULT = 'FORBIDDEN_DENY_BY_DEFAULT',
  PRIVILEGE_ESCALATION_BLOCKED = 'PRIVILEGE_ESCALATION_BLOCKED',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  IDEMPOTENCY_CONFLICT = 'IDEMPOTENCY_CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  CREATOR_QUOTA_EXCEEDED = 'CREATOR_QUOTA_EXCEEDED',
  DAILY_VERIFICATION_REQUIRED = 'DAILY_VERIFICATION_REQUIRED',
  PASSKEY_CHALLENGE_EXPIRED = 'PASSKEY_CHALLENGE_EXPIRED',
  INVALID_PASSKEY_ASSERTION = 'INVALID_PASSKEY_ASSERTION',
  INVALID_RECOVERY_CODE = 'INVALID_RECOVERY_CODE',
  COMMERCE_LOCKED = 'COMMERCE_LOCKED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface ApiFieldViolation {
  readonly field: string;
  readonly message: string;
}

export interface ApiErrorEnvelope {
  readonly statusCode: number;
  readonly errorCode: ApiErrorCode;
  readonly message: string;
  readonly requestId: string;
  readonly timestampIso: string;
  readonly path: string;
  readonly violations?: readonly ApiFieldViolation[];
}

export function createApiErrorEnvelope(params: {
  statusCode: number;
  errorCode: ApiErrorCode;
  message: string;
  requestId: string;
  path: string;
  violations?: readonly ApiFieldViolation[];
}): ApiErrorEnvelope {
  return {
    statusCode: params.statusCode,
    errorCode: params.errorCode,
    message: params.message,
    requestId: params.requestId,
    timestampIso: new Date().toISOString(),
    path: params.path,
    ...(params.violations && params.violations.length > 0
      ? { violations: params.violations }
      : {}),
  };
}

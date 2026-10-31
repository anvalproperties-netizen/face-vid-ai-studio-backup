import { Request, Response, NextFunction } from 'express';
import {
  AccountStatus,
  ApiErrorCode,
  UserRole,
  createApiErrorEnvelope,
  requiresPhishingResistantMfa,
} from '../../../../packages/shared/src/index.ts';
import { databaseFoundationService } from '../database/database.service.ts';
import { apiLogger } from './logger.ts';

export function secureHttpHeadersMiddleware(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
}

const PRIVILEGED_FIELDS = [
  'role',
  'roles',
  'subscriptionTier',
  'permissions',
  'isOwner',
  'accountStatus',
];

export function rejectClientSubmittedPrivilegesMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && typeof req.body === 'object') {
    const detected: string[] = [];
    for (const field of PRIVILEGED_FIELDS) {
      if (field in req.body) {
        detected.push(field);
      }
    }

    // Certain explicit endpoints handle authorized or simulated roles safely (e.g. verify-contracts, tv confirm)
    const isExcludedPath =
      req.path.includes('/auth/tv-device/confirm') ||
      req.originalUrl?.includes('/auth/tv-device/confirm');

    if (detected.length > 0 && !isExcludedPath) {
      const requestId = (req.headers['x-request-id'] as string) || `req_sec_${Date.now()}`;
      apiLogger.warn('Blocked client-submitted privilege field injection attempt', {
        path: req.originalUrl || req.path,
        detectedFields: detected,
        ip: req.ip || '127.0.0.1',
      });

      res.status(403).json(
        createApiErrorEnvelope({
          statusCode: 403,
          errorCode: ApiErrorCode.PRIVILEGE_ESCALATION_BLOCKED,
          message: `Client submission of privileged security/account fields (${detected.join(', ')}) is strictly prohibited.`,
          requestId,
          path: req.originalUrl || req.path,
        })
      );
      return;
    }
  }

  next();
}

/**
 * Authoritative session authentication middleware:
 * Validates session token against the database, rejects forged, revoked, or expired sessions,
 * verifies user account status, and binds authoritative user roles to the request.
 */
export function requireAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const sessionIdHeader = req.headers['x-session-id'] as string;
  const sessionTokenHeader = req.headers['x-session-token'] as string;
  const requestId = (req.headers['x-request-id'] as string) || `req_auth_${Date.now()}`;

  let token: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (sessionIdHeader) {
    token = sessionIdHeader.trim();
  } else if (sessionTokenHeader) {
    token = sessionTokenHeader.trim();
  }

  if (!token) {
    res.status(401).json(
      createApiErrorEnvelope({
        statusCode: 401,
        errorCode: ApiErrorCode.UNAUTHORIZED,
        message: 'Authentication required. Missing Bearer token or session header.',
        requestId,
        path: req.originalUrl || req.path,
      })
    );
    return;
  }

  // Look up session authoritatively in database
  const session = databaseFoundationService.findDeviceSessionByToken(token);
  if (!session) {
    res.status(401).json(
      createApiErrorEnvelope({
        statusCode: 401,
        errorCode: ApiErrorCode.UNAUTHORIZED,
        message: 'Invalid or unrecognized session token.',
        requestId,
        path: req.originalUrl || req.path,
      })
    );
    return;
  }

  if (session.revoked) {
    res.status(401).json(
      createApiErrorEnvelope({
        statusCode: 401,
        errorCode: ApiErrorCode.UNAUTHORIZED,
        message: 'Session has been revoked. Please sign in again.',
        requestId,
        path: req.originalUrl || req.path,
      })
    );
    return;
  }

  const nowEpoch = Date.now();
  if (new Date(session.expiresAtIso).getTime() < nowEpoch) {
    res.status(401).json(
      createApiErrorEnvelope({
        statusCode: 401,
        errorCode: ApiErrorCode.UNAUTHORIZED,
        message: 'Session token has expired. Please refresh your session.',
        requestId,
        path: req.originalUrl || req.path,
      })
    );
    return;
  }

  const user = databaseFoundationService.findUserById(session.userId);
  if (!user) {
    res.status(401).json(
      createApiErrorEnvelope({
        statusCode: 401,
        errorCode: ApiErrorCode.UNAUTHORIZED,
        message: 'User associated with session was not found.',
        requestId,
        path: req.originalUrl || req.path,
      })
    );
    return;
  }

  if (user.accountStatus === AccountStatus.SUSPENDED) {
    res.status(403).json(
      createApiErrorEnvelope({
        statusCode: 403,
        errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
        message: 'This account has been suspended by platform compliance.',
        requestId,
        path: req.originalUrl || req.path,
      })
    );
    return;
  }

  const roles = databaseFoundationService.getUserRoles(user.userId);

  // Attach authoritative security context (client-supplied roles/headers are never trusted)
  (req as any).authSession = session;
  (req as any).authSessionToken = token;
  (req as any).authSessionId = session.sessionId;
  (req as any).authUser = user;
  (req as any).authUserId = user.userId;
  (req as any).authUserRoles = roles;
  next();
}

/**
 * Enforces that the authenticated user possesses at least one of the specified authoritative roles.
 */
export function requireRoleMiddleware(allowedRoles: readonly UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userRoles = (req as any).authUserRoles as readonly UserRole[] | undefined;
    const requestId = (req.headers['x-request-id'] as string) || `req_role_${Date.now()}`;

    if (!userRoles || !userRoles.some((r) => allowedRoles.includes(r))) {
      const allowedStr = allowedRoles.join(', ');
      res.status(403).json(
        createApiErrorEnvelope({
          statusCode: 403,
          errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
          message: `Access denied. Endpoint requires one of the following authoritative roles: [${allowedStr}]. Client-submitted role state is ignored.`,
          requestId,
          path: req.originalUrl || req.path,
        })
      );
      return;
    }

    next();
  };
}

/**
 * Enforces verified administrative authentication, authoritative admin role,
 * and phishing-resistant MFA compliance for privileged admin operations.
 */
export function requireAdminAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  requireAuthMiddleware(req, res, () => {
    const userRoles = (req as any).authUserRoles as readonly UserRole[] | undefined;
    const user = (req as any).authUser;
    const requestId = (req.headers['x-request-id'] as string) || `req_admin_${Date.now()}`;

    const isAdmin =
      userRoles &&
      (userRoles.includes(UserRole.ADMIN) ||
        userRoles.includes(UserRole.SUPER_ADMIN) ||
        userRoles.includes(UserRole.OWNER));

    if (!isAdmin) {
      res.status(403).json(
        createApiErrorEnvelope({
          statusCode: 403,
          errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
          message: 'Operational admin access strictly denied: Authoritative admin role required.',
          requestId,
          path: req.originalUrl || req.path,
        })
      );
      return;
    }

    if (requiresPhishingResistantMfa(userRoles || []) && !user?.phishingResistantMfaVerified) {
      res.status(403).json(
        createApiErrorEnvelope({
          statusCode: 403,
          errorCode: ApiErrorCode.FORBIDDEN_DENY_BY_DEFAULT,
          message: 'Privileged admin access requires verified phishing-resistant hardware passkey / WebAuthn MFA.',
          requestId,
          path: req.originalUrl || req.path,
        })
      );
      return;
    }

    next();
  });
}

/**
 * Enforces first-sign-in-of-the-day daily verification for protected operations.
 */
export function requireDailyVerificationMiddleware(
  isDailyVerificationActiveFn: (lastVerifiedAtIso?: string) => boolean,
  getSessionFn: (sessionId: string) => { lastDailyVerifiedAtIso?: string | null; revoked: boolean } | null
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const sessionId = (req.headers['x-session-id'] as string) || ((req as any).authSessionId as string);
    const requestId = (req.headers['x-request-id'] as string) || `req_daily_${Date.now()}`;

    if (!sessionId) {
      res.status(401).json(
        createApiErrorEnvelope({
          statusCode: 401,
          errorCode: ApiErrorCode.UNAUTHORIZED,
          message: 'Valid session ID required for daily verification check.',
          requestId,
          path: req.originalUrl || req.path,
        })
      );
      return;
    }

    const session = getSessionFn(sessionId);
    if (!session || session.revoked) {
      res.status(401).json(
        createApiErrorEnvelope({
          statusCode: 401,
          errorCode: ApiErrorCode.UNAUTHORIZED,
          message: 'Session is revoked or does not exist.',
          requestId,
          path: req.originalUrl || req.path,
        })
      );
      return;
    }

    const isVerified = isDailyVerificationActiveFn(session.lastDailyVerifiedAtIso || undefined);
    if (!isVerified) {
      res.status(403).json(
        createApiErrorEnvelope({
          statusCode: 403,
          errorCode: ApiErrorCode.DAILY_VERIFICATION_REQUIRED,
          message:
            'First-sign-in-of-the-day verification required. Please verify presence using your registered passkey or PIN.',
          requestId,
          path: req.originalUrl || req.path,
        })
      );
      return;
    }

    next();
  };
}

/**
 * Enforces that live store commerce checkout remains safely disabled pending processor integration.
 */
export function lockedCommerceMiddleware(
  req: Request,
  res: Response
): void {
  const requestId = (req.headers['x-request-id'] as string) || `req_comm_${Date.now()}`;
  res.status(503).json(
    createApiErrorEnvelope({
      statusCode: 503,
      errorCode: ApiErrorCode.COMMERCE_LOCKED,
      message:
        'Store checkout is disabled pending live payment processor integration (financial_policy_registry.payments_active = FALSE). No financial transactions have occurred.',
      requestId,
      path: req.originalUrl || req.path,
    })
  );
}


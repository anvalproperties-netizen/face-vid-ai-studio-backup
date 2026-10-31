# FACE VID — Phase 1A Security & Privacy Baseline

## 1. Core Security Controls Implemented in Phase 1A

| Control Domain | Implementation File | Verification Method |
| :--- | :--- | :--- |
| **Deny Access by Default** | `apps/api/src/router.ts` | Unexposed admin routes (`/api/v1/admin/*`) return `403 FORBIDDEN_DENY_BY_DEFAULT`; unknown routes return `404`. |
| **No Public Super Admin Registration** | `packages/shared/src/identity.ts` | `validateRegistrationRoleRequest` rejects `SUPER_ADMIN`, `ADMIN`, `OWNER`, and `MODERATOR`. |
| **Reject Client-Submitted Privileges** | `apps/api/src/common/security.ts` | `rejectClientSubmittedPrivilegesMiddleware` returns `403 PRIVILEGE_ESCALATION_BLOCKED` if body contains `role`, `roles`, `subscriptionTier`, `permissions`, or `isOwner`. |
| **Sensitive-Data Log Redaction** | `packages/shared/src/redaction.ts` | `redactSensitiveData` strips Bearer tokens, JWTs, passwords, secrets, payment PANs/CVVs, `latitude`/`longitude`, and `legalFullName`. |
| **AI Agent Privilege Hard-Lock** | `packages/shared/src/audit.ts` | `evaluateGovernancePolicy` blocks `AI_AGENT` from self-granting permissions, promoting roles, altering owner policies, or bypassing human review. |
| **Owner Final Authorization Gate** | `packages/shared/src/audit.ts` | Financial and security policy mutations require `actorType === OWNER` and valid `hasOwnerSignature`. |
| **Tamper-Resistant Audit Architecture** | `packages/shared/src/audit.ts` & `infrastructure/database/init.sql` | Cryptographic hash-chaining (`computeAuditChainDigest`) + PostgreSQL trigger blocking `UPDATE` and `DELETE` on `audit_events`. |
| **Identity Mode Privacy Isolation** | `packages/shared/src/identity.ts` | `projectPeerVisibleIdentity` strips legal name, email, and public handle when user is in `PRIVATE` avatar mode. |
| **Live Broadcast Location Privacy** | `packages/shared/src/content.ts` | `sanitizeLiveBroadcastLocation` redacts exact GPS coordinates and defaults `autoArchiveEnabled` to `false`. |

## 2. POPIA & GDPR Privacy-by-Design Baseline

1. **Data Minimization**: Exact GPS coordinates are never persisted or exposed to peers; only coarse regional scope (`15 km`, `30 km`, `City`, `Country`, `Continent`, `Worldwide`) is published.
2. **Ephemeral Operational Retention**: Regional live-stream routing tokens expire after 15 minutes or immediately on stream end. Live streams are not archived by default.
3. **Lawful Accountability vs. Peer Privacy**: Switching to Private Avatar Mode conceals legal identity from other users while preserving server-side auditability for lawful security and verification obligations.

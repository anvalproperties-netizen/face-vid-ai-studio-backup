# FACE VID — PHASE 1A CONTROLLED FOUNDATION LOCK (`phase1a-verified-foundation`)

## 1. CHECKPOINT AUTHORIZATION

- **Checkpoint Tag**: `phase1a-verified-foundation`
- **Owner Decision**: `APPROVE PHASE 1A FOUNDATION WITH DOCUMENTED LIMITATIONS`
- **Phase Boundary**: Phase 1A Locked. Phase 1B is **NOT STARTED** and requires separate explicit Owner authorization.

---

## 2. MANDATORY DOCUMENTED LIMITATIONS

The following nine limitations are formally recorded and bound to the `phase1a-verified-foundation` checkpoint:

1. **Native platform binaries are not yet compiled**: Android (`.aab`/`.apk`), iOS/iPadOS (`.ipa`), Windows 10/11 (`.msix`), Android TV / Google TV, Samsung Tizen (`.wgt`), LG webOS (`.ipk`), Apple tvOS, and Amazon Fire TV native binary builds are **NOT RUN** in this container environment.
2. **Store submissions have not occurred**: No applications have been submitted to or approved by Google Play Store, Apple App Store, Microsoft Store, Samsung Seller Office, LG Seller Lounge, or Amazon Appstore (`PLANNED`).
3. **PostgreSQL and Redis persistence is not yet active**: `infrastructure/database/init.sql` and `infrastructure/docker/docker-compose.yml` define the relational and cache schemas, but live database/cache persistence is in `foundation_standby` during Phase 1A.
4. **TV pairing uses prototype in-memory storage**: `TvDevicePairingService` (`apps/api/src/tv/tv-pairing.service.ts`) enforces all 10 pairing security controls against `IN_MEMORY_PHASE_1A_PROTOTYPE_STORE`.
5. **Financial ledger persistence is not yet production-ready**: `MonetizationLedgerService` (`apps/api/src/modules/monetization.service.ts`) enforces server-authoritative double-entry invariants, SHA-256 idempotency conflict detection, Creator/Merchant balance separation, and refund/chargeback compensating entries in memory prior to Phase 1B PostgreSQL activation.
6. **Live payments remain disabled**: `phase1aPaymentsActive: false` and `livePaymentsActive: false` are enforced across all 5 monetisation engines.
7. **Commission rates and pricing remain unconfigured**: `configuredCommissionBasisPoints: null` and `configuredBasePriceMinorUnits: null` (`UNCONFIGURED_AWAITING_OWNER_APPROVAL`) across all 5 monetisation engines:
   - `ENGINE_1_PREPAID_CREATOR_CALLS`
   - `ENGINE_2_CREATOR_MERCHANT_AD_SERVICES`
   - `ENGINE_3_SHOP_MERCHANT_COMMISSIONS`
   - `ENGINE_4_BUSINESS_AD_REVENUE`
   - `ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS`
8. **Official owner logo must still be supplied to the workspace**: `/public/assets/owner/face-vid-official-logo.png` is not yet present; `FaceVidLogo` renders the Phase 1A placeholder and reports the missing file.
9. **Production administrative authentication remains pending**: `apps/admin` renders the non-operational Phase 1A login and governance placeholders, and `ALL /api/v1/admin/*` routes enforce `403 FORBIDDEN_DENY_BY_DEFAULT`.

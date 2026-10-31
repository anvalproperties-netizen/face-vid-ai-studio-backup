# FACE VID — Phase 1A Architecture Overview

## 1. Division Boundaries

Phase 1A establishes strict modular boundaries across five core application divisions without prematurely activating unapproved commercial or privileged mutations:

1. **FACE VID SOCIAL (`apps/web`, `packages/shared/src/content.ts`)**
   - Discovery feed across Videos, Shorts, Music, Movies, TV, Podcasts, Gaming, Sports, and News.
   - Public identity mode vs. Avatar-based Private mode (`projectPeerVisibleIdentity`), guaranteeing that switching to Private mode strips `legalFullName` and `primaryEmail` from peer-visible payloads.
   - Free user-to-user internet voice/video call policy (`CallType.PEER_TO_PEER_FREE` with `$0.00` platform fee; network data charges remain the user's responsibility).
   - Live streaming with selectable geographic audience reach (`15 km`, `30 km`, `City`, `Country`, `Continent`, `Worldwide`), automatic GPS coordinate redaction, and `autoArchiveEnabled: false` by default.

2. **FACE VID CREATOR (`apps/web/app/creator`, `packages/shared/src/content.ts`)**
   - Founding Creator Program boundary capped at `3,000,000` verified eligible external creators (`PHASE_1A_ALLOCATION_ACTIVE = false`).
   - Requires proof of external account ownership and genuine creator activity; AI assists with screening while ambiguous or high-risk cases require mandatory human review.
   - Prepaid creator calls isolated as a separate server-authoritative paid boundary (`CallType.PREPAID_CREATOR_CALL`).
   - AI Studio real-time video filter pipeline boundary.

3. **FACE VID MERCHANT (`apps/web/app/merchant`, `apps/api/src/modules/boundaries.ts`)**
   - Modular boundary for shop registration, merchant KYB verification, video commerce, live shopping, carts, and server-authoritative orders/refunds via `PaymentProviderPort`.

4. **FACE VID BUSINESS (`apps/web/app/business`, `apps/api/src/modules/boundaries.ts`)**
   - Modular boundary for advertising accounts, campaign budget governance, AI-assisted ad screening (`AiProviderPort`), and mandatory human review prior to ad serving.

5. **FACE VID ADMIN (`apps/admin`, `apps/api/src/router.ts`)**
   - Separately structured Super Admin console with `/login` placeholder route and sections for Users, Creators, Merchants, Advertising, Finance, AI Agent Controls, Security & Audit Chain, and System Operations.
   - All nonfunctional features are explicitly labeled as Phase 1A placeholders.
   - Zero operational admin endpoints are exposed (`ALL /api/v1/admin/*` returns `403 FORBIDDEN_DENY_BY_DEFAULT`).

## 2. Infrastructure & Provider Abstractions

- **Relational Database**: PostgreSQL 16 (`infrastructure/docker/docker-compose.yml` & `infrastructure/database/init.sql`) with an immutable append-only `audit_events` table protected by a `BEFORE UPDATE OR DELETE` PostgreSQL trigger.
- **Caching & Ephemeral State**: Redis 7 (`infrastructure/docker/docker-compose.yml`) for job coordination and 15-minute ephemeral coarse regional live-stream geohash tokens.
- **Provider Ports (`apps/api/src/modules/boundaries.ts`)**:
  - `AiProviderPort`
  - `PaymentProviderPort`
  - `WebRtcSignalingPort`
  - `LiveBroadcastDeliveryPort`

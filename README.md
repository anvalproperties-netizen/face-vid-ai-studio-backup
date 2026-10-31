# FACE VID — Phase 1A Production Foundation

Global video, live broadcast, creator AI Studio, commerce, advertising, and administration monorepo for **FACE VID**.

---

## 1. Monorepo Structure

```text
face-vid/
  apps/
    web/                    # Experience A: Public-facing FACE VID website (Next.js App Router + React shell)
    admin/                  # Isolated Super Admin frontend (Next.js App Router + React shell)
    api/                    # Central backend API service (/api/v1/*) shared by all 9 platforms
    mobile/                 # Experience A: Shared Flutter application (Android, iOS/iPadOS, Windows target)
    windows/                # Experience A: Windows 10/11 Microsoft Store MSIX packaging configuration
    tv/                     # Experience B: Dedicated 10-foot Smart TV interface & 5 TV OS targets
      src/                  # 10-foot Lean-Back TV UI (D-Pad navigation, QR sign-in, full-screen player)
      android-tv/           # Android TV / Google TV Leanback manifest
      samsung-tizen/        # Samsung Smart TV Tizen OS config.xml
      lg-webos/             # LG Smart TV webOS appinfo.json
      apple-tvos/           # Apple TV tvOS native Swift/SwiftUI target
      fire-tv/              # Amazon Fire TV Leanback manifest
  packages/
    shared/                 # Validated identity, content, audit, error, redaction & 9-platform contracts
    ui/                     # Shared FACE VID brand tokens and official logo placeholder component
    config/                 # Shared TypeScript strict baseline and ESLint configuration
  infrastructure/
    docker/                 # Local PostgreSQL 16 and Redis 7 Docker Compose definition
    database/               # Immutable append-only audit_events SQL schema and readiness probe
  docs/
    architecture/           # Modular architecture, Multi-Platform & Smart TV specifications
    audits/                 # Phase 1A Multi-Platform & Smart TV Audit Report
    security/               # Security baseline, POPIA/GDPR privacy rules, and AI governance
  scripts/                  # Automated unit/API smoke test runner, secret scanner, Docker & 9-platform validators
  .github/
    workflows/              # Pull request CI pipeline
  pnpm-workspace.yaml
  package.json
  .env.example
  README.md
```

---

## 2. Exact Installation Commands

```bash
# Using pnpm (recommended for monorepo workspaces):
pnpm install --frozen-lockfile

# Or in environments with npm/bun preconfigured:
npm install
```

---

## 3. Exact Local Startup Commands

```bash
# 1. Copy environment variable template for local development:
cp .env.example .env.local

# 2. (Optional) Start local PostgreSQL 16 & Redis 7 containers:
docker compose -f infrastructure/docker/docker-compose.yml up -d

# 3. Start unified development server (Web + Admin + /api/v1/* on port 3000):
npm run dev

# 4. Run standalone backend API service directly:
npx tsx apps/api/src/main.ts
```

---

## 4. Verification & Audit Commands

```bash
# TypeScript strict typechecking across all packages and apps:
npm run typecheck

# Linting & secret/credential exposure scan:
npm run lint

# Unit, security contract, redaction, AI governance, and API HTTP smoke tests:
npm test

# Validate Docker Compose configuration & security bindings:
npm run validate:docker

# Production bundle build:
npm run build
```

---

## 5. Missing Owner Logo Asset Disclosure

Per Section 1 of the Phase 1A specification:
- Expected owner asset path: `/public/assets/owner/face-vid-official-logo.png` (White stylized FV symbol and FACE VID wordmark outlined in `#356DFF` electric blue on `#080B12` black background).
- Because the binary image file was not uploaded to the initial workspace, `@face-vid/ui` (`FaceVidLogo`) provides an explicit, documented asset placeholder and reports the missing file across the Web, Admin, and Audit surfaces without inventing a counterfeit logo.

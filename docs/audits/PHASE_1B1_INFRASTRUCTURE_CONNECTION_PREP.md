# FACE VID — POSTGRESQL & REDIS CONNECTION REQUIREMENTS (PHASE 1B-1)

## 1. EXACT REQUIRED ENVIRONMENT VARIABLE NAMES

### 1.1 External Managed PostgreSQL 16 (`DatabaseFoundationService`)
| Environment Variable | Required / Optional | Default (Dev Only) | Purpose |
| :--- | :--- | :--- | :--- |
| `POSTGRES_HOST` *(or `SQL_HOST`)* | **Required** (unless `DATABASE_URL` is set) | `127.0.0.1` | Hostname or IP of the managed PostgreSQL 16 instance |
| `POSTGRES_PORT` | **Required** | `5432` | TCP port of the managed PostgreSQL 16 instance |
| `POSTGRES_DB` *(or `SQL_DB_NAME`)* | **Required** | `facevid_dev` | Target PostgreSQL 16 database name |
| `POSTGRES_USER` *(or `SQL_USER`)* | **Required** | `facevid_local_user` | Database role/user with DDL (`CREATE TABLE`/`TRIGGER`) and DML privileges |
| `POSTGRES_PASSWORD` *(or `SQL_PASSWORD`)* | **Required** | *(Rejected in production if placeholder)* | Database user password injected via secret manager / runtime environment |
| `POSTGRES_SSL` | **Required for Managed Cloud DB** | `false` | Set to `"true"` to enable TLS on `pg.Pool` |
| `POSTGRES_SSL_MODE` | **Required for Managed Cloud DB** | `disable` | Supported values: `disable`, `prefer`, `require`, `verify-ca`, `verify-full` |
| `POSTGRES_SSL_REJECT_UNAUTHORIZED` | **Optional** | `true` (when `verify-ca`/`verify-full`) | Set to `"true"` to enforce strict server certificate chain verification |
| `POSTGRES_SSL_CA` | **Optional** | `""` | PEM-encoded root CA certificate string (or path to `.pem`/`.crt` file) for `verify-ca` / `verify-full` |
| `POSTGRES_CONNECT_TIMEOUT_MS` | **Optional** | `5000` | Connection acquisition timeout in milliseconds |
| `POSTGRES_POOL_MAX` | **Optional** | `10` | Maximum concurrent connections in `pg.Pool` |
| `DATABASE_URL` | **Optional Alternative** | `""` | Standard PostgreSQL URI (`postgresql://...`), parsed into discrete `pg.PoolConfig` fields |

### 1.2 External Managed Redis 7 (`RedisFoundationService`)
| Environment Variable | Required / Optional | Default (Dev Only) | Purpose |
| :--- | :--- | :--- | :--- |
| `REDIS_HOST` | **Required** (unless `REDIS_URL` is set) | `127.0.0.1` | Hostname or IP of the managed Redis 7 instance |
| `REDIS_PORT` | **Required** | `6379` | TCP/TLS port of the managed Redis 7 instance (often `6379` or `6380`) |
| `REDIS_USERNAME` | **Optional** (Redis 7 ACLs) | `default` | Redis 7 ACL username (leave unset or `"default"` if using default ACL user) |
| `REDIS_PASSWORD` | **Required for Managed Cloud Redis** | `""` | Managed Redis 7 authentication password / token |
| `REDIS_DB` | **Optional** | `0` | Logical Redis database index (`0` required for managed cluster/serverless offerings) |
| `REDIS_TLS` | **Required for Managed Cloud Redis** | `false` | Set to `"true"` to enable TLS (`ioredis` `tls: {}` socket) |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | **Optional** | `true` | Enforce strict TLS certificate verification |
| `REDIS_TLS_CA` | **Optional** | `""` | PEM-encoded root CA certificate string (or path to `.pem`/`.crt` file) |
| `REDIS_CONNECT_TIMEOUT_MS` | **Optional** | `5000` | TCP/TLS connection timeout in milliseconds |
| `REDIS_URL` | **Optional Alternative** | `""` | Standard Redis URI (`redis://` or `rediss://` for TLS), parsed into `ioredis` options |

### 1.3 Production Mode & Fail-Closed Enforcement Variables
| Environment Variable | Production Value | Development / Local Test Value | Behavior |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | `"production"` | `"development"` | Enables strict fail-closed enforcement when set to `"production"` |
| `REQUIRE_EXTERNAL_INFRASTRUCTURE` | `"true"` | `"false"` | Forces fail-closed external PostgreSQL 16 + Redis 7 verification even in non-production environments |
| `FACEVID_ALLOW_TEST_ADAPTERS` | `"false"` | `"true"` | Explicitly disables the local JSON catalog and local RESP test adapter when set to `"false"` |

---

## 2. SUPPORTED CONNECTION FORMATS & TLS REQUIREMENTS

### 2.1 Supported PostgreSQL 16 Connection Formats
1. **Discrete Object-Method Format (Recommended)**:
   ```env
   POSTGRES_HOST="<managed-postgres16-host>"
   POSTGRES_PORT="5432"
   POSTGRES_DB="facevid_prod"
   POSTGRES_USER="facevid_app"
   POSTGRES_PASSWORD="<injected-from-secret-manager>"
   POSTGRES_SSL="true"
   POSTGRES_SSL_MODE="verify-full"
   POSTGRES_SSL_REJECT_UNAUTHORIZED="true"
   ```
2. **URI Format (`DATABASE_URL`)**:
   ```env
   DATABASE_URL="postgresql://facevid_app:<url-encoded-password>@<managed-postgres16-host>:5432/facevid_prod?sslmode=require"
   ```
   *(Automatically parsed into discrete `pg.PoolConfig` fields by `DatabaseFoundationService.resolvePostgresConfig()`.)*

### 2.2 Supported Redis 7 Connection Formats
1. **Discrete Host/Port/TLS Format (Recommended)**:
   ```env
   REDIS_HOST="<managed-redis7-host>"
   REDIS_PORT="6379"
   REDIS_USERNAME="default"
   REDIS_PASSWORD="<injected-from-secret-manager>"
   REDIS_DB="0"
   REDIS_TLS="true"
   REDIS_TLS_REJECT_UNAUTHORIZED="true"
   ```
2. **TLS URI Format (`REDIS_URL`)**:
   ```env
   REDIS_URL="rediss://default:<url-encoded-password>@<managed-redis7-host>:6379/0"
   ```

### 2.3 TLS Requirements
- **PostgreSQL 16**: Supports TLS 1.2 / TLS 1.3 via `POSTGRES_SSL="true"` and `POSTGRES_SSL_MODE` (`require`, `verify-ca`, or `verify-full`). If the cloud provider uses a private root CA (e.g., AWS RDS CA bundle, Google Cloud SQL server CA, DigitalOcean Managed DB CA), supply the PEM certificate via `POSTGRES_SSL_CA`.
- **Redis 7**: Supports TLS 1.2 / TLS 1.3 via `REDIS_TLS="true"` or a `rediss://` scheme in `REDIS_URL`. Custom CA certificates are supported via `REDIS_TLS_CA`.

---

## 3. REMOVAL OF FALSE PRODUCTION READINESS (TASK 3)

1. **Fake PostgreSQL Port-5432 Socket Removed**: `DatabaseFoundationService` no longer binds a dummy `net.Server` on `127.0.0.1:5432`. Readiness is determined exclusively by executing a live PostgreSQL wire-protocol query (`SELECT version(), current_setting('server_version_num')::int`) via `pg.Pool` and verifying `server_version_num >= 160000`.
2. **Explicit Adapter Classification**:
   - External PostgreSQL 16: `connectionMode: "REAL_EXTERNAL_POSTGRES_16"`, `isTestAdapter: false`, `productionReady: true`
   - Local JSON Persistence Fallback (Dev/Test only): `connectionMode: "LOCAL_JSON_TEST_ADAPTER"`, `isTestAdapter: true`, `productionReady: false`
   - External Redis 7: `connectionMode: "REAL_EXTERNAL_REDIS_7"`, `isTestAdapter: false`, `productionReady: true`
   - Local RESP Test Adapter (Dev/Test only): `connectionMode: "LOCAL_RESP_TEST_ADAPTER"`, `isTestAdapter: true`, `productionReady: false`
3. **Fail-Closed Production Mode**: When `NODE_ENV="production"`, `REQUIRE_EXTERNAL_INFRASTRUCTURE="true"`, or `FACEVID_ALLOW_TEST_ADAPTERS="false"`, both services refuse to start or fall back to test adapters, throw `[FAIL_CLOSED]` errors when external services are missing/unreachable, and `/api/v1/health/ready` returns HTTP `503 Service Unavailable` (`status: "fail_closed_external_infrastructure_unavailable"`, `productionReady: false`).

---

## 4. DURABLE SOURCE BACKUP & GIT STATE AUDIT (TASK 4)

- **Current `.git` Directory Status**: The `.git/` directory **has disappeared** from `/app/applet` (stripped by AI Studio's workspace persistence layer during the `2026-10-09` Cloud Run container scale-to-zero rehydration). `git status` exits with code `128` (`fatal: not a git repository`).
- **Phase 1A Checkpoint Availability**: Because `.git/` is no longer present in the container filesystem and no remote Git URL or credentials exist in the container environment (`env` / `git config`), the Phase 1A Git commit object (`510533e90fc463c067de95b69950a2f4e0bf65ca`) and tag (`phase1a-verified-foundation`) **are not available in local Git storage and cannot be fetched from a remote repository from inside this container**.
- **Source File Integrity**: All Phase 1A and Phase 1B-1 source files, SQL migrations (`0001`–`0003`), and audit reports remain intact on disk in `/app/applet` and were not overwritten.

---

## 5. MIGRATION & VERIFICATION COMMANDS

Once external PostgreSQL 16 and Redis 7 environment variables are configured in the runtime environment:

1. **Verify Live External PostgreSQL 16 & Redis 7 Connectivity (Fail-Closed Mode)**:
   ```bash
   REQUIRE_EXTERNAL_INFRASTRUCTURE=true npm run infra:verify
   ```
2. **Execute Versioned SQL Migrations (`0001`, `0002`, `0003`) Against External PostgreSQL 16**:
   ```bash
   npm run db:migrate
   ```
3. **Run Full Phase 1A + Phase 1B-1 Test Suite, TypeScript Check, and Secret Scan**:
   ```bash
   npm run test
   npm run typecheck
   npm run check:secrets
   ```
4. **Verify HTTP Readiness Probe**:
   ```bash
   curl -s http://localhost:3000/api/v1/health/ready | jq .
   curl -s http://localhost:3000/api/v1/foundation/db-redis-status | jq .
   ```

#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# FACE VID — PHASE 1A DATABASE & REDIS READINESS CHECK SCRIPT
# ==============================================================================

PG_HOST="${POSTGRES_HOST:-127.0.0.1}"
PG_PORT="${POSTGRES_PORT:-5432}"
PG_USER="${POSTGRES_USER:-facevid_local_user}"
PG_DB="${POSTGRES_DB:-facevid_dev}"
RD_HOST="${REDIS_HOST:-127.0.0.1}"
RD_PORT="${REDIS_PORT:-6379}"

echo "[FACE VID] Checking PostgreSQL readiness at ${PG_HOST}:${PG_PORT}..."
if command -v pg_isready >/dev/null 2>&1; then
  pg_isready -h "${PG_HOST}" -p "${PG_PORT}" -U "${PG_USER}" -d "${PG_DB}"
else
  echo "[WARN] pg_isready binary not installed locally; use API /api/v1/health/ready TCP probe."
fi

echo "[FACE VID] Checking Redis readiness at ${RD_HOST}:${RD_PORT}..."
if command -v redis-cli >/dev/null 2>&1; then
  redis-cli -h "${RD_HOST}" -p "${RD_PORT}" ping
else
  echo "[WARN] redis-cli binary not installed locally; use API /api/v1/health/ready TCP probe."
fi

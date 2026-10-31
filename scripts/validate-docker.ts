/**
 * FACE VID — Phase 1A Docker Compose Static Security & Structure Validator
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

function main() {
  const composePath = path.resolve(
    process.cwd(),
    'infrastructure/docker/docker-compose.yml'
  );
  assert.equal(
    fs.existsSync(composePath),
    true,
    'infrastructure/docker/docker-compose.yml must exist'
  );

  const raw = fs.readFileSync(composePath, 'utf8');

  // Verify PostgreSQL & Redis services exist
  assert.equal(raw.includes('postgres:16.4-alpine'), true, 'PostgreSQL 16 service must be defined');
  assert.equal(raw.includes('redis:7.4-alpine'), true, 'Redis 7 service must be defined');

  // Verify localhost-only port bindings (127.0.0.1)
  assert.equal(
    raw.includes('127.0.0.1:${POSTGRES_PORT:-5432}:5432'),
    true,
    'PostgreSQL port must bind strictly to 127.0.0.1'
  );
  assert.equal(
    raw.includes('127.0.0.1:${REDIS_PORT:-6379}:6379'),
    true,
    'Redis port must bind strictly to 127.0.0.1'
  );

  // Verify healthchecks exist for both services
  assert.equal(raw.includes('pg_isready'), true, 'PostgreSQL healthcheck must use pg_isready');
  assert.equal(raw.includes('redis-cli'), true, 'Redis healthcheck must use redis-cli ping');

  // Verify no hardcoded plaintext password fallback for POSTGRES_PASSWORD
  assert.equal(
    raw.includes('${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env.local}'),
    true,
    'POSTGRES_PASSWORD must require explicit local configuration'
  );

  console.log(
    '[DOCKER COMPOSE VALIDATION PASS] infrastructure/docker/docker-compose.yml verified (PostgreSQL 16 + Redis 7, 127.0.0.1 bindings, healthchecks, no hardcoded password).'
  );
}

main();

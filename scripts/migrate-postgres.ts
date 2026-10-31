/**
 * @face-vid/scripts — Live External PostgreSQL 16 Versioned Migration Runner
 *
 * Usage:
 *   npm run db:migrate
 *
 * Connects to the configured external managed PostgreSQL 16 instance using
 * discrete Object-Method parameters (or DATABASE_URL), verifies PostgreSQL 16+
 * and TLS settings, creates `schema_migrations`, verifies SHA-256 checksums,
 * and executes `0001`, `0002`, and `0003` inside atomic transactions.
 *
 * Fails closed with exit code 1 if no real external PostgreSQL 16 server is reachable.
 */

import { databaseFoundationService } from '../apps/api/src/database/database.service.ts';

async function main(): Promise<void> {
  const { summary } = databaseFoundationService.resolvePostgresConfig();
  console.log('====================================================================');
  console.log('FACE VID — PHASE 1B-1 EXTERNAL POSTGRESQL 16 MIGRATION RUNNER');
  console.log('====================================================================');
  console.log(
    JSON.stringify(
      {
        host: summary.host,
        port: summary.port,
        database: summary.database,
        user: summary.user,
        passwordConfigured: summary.passwordConfigured,
        sslEnabled: summary.sslEnabled,
        sslMode: summary.sslMode,
        tlsRejectUnauthorized: summary.tlsRejectUnauthorized,
        customCaConfigured: summary.customCaConfigured,
      },
      null,
      2
    )
  );

  try {
    const result = await databaseFoundationService.executeExternalPostgresMigrations();
    console.log('\n[MIGRATION PASS] Executed versioned SQL migrations on real PostgreSQL 16:');
    console.log(`Server Version: ${result.serverVersion}`);
    for (const m of result.appliedMigrations) {
      console.log(
        `  - [${m.version}] ${m.filename} (sha256=${m.checksumSha256.slice(0, 16)}..., tables=${m.tablesCreated.length}, triggers=${m.triggersCreated.length})`
      );
    }
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n[MIGRATION BLOCKED / FAIL-CLOSED] ${message}`);
    console.error(
      'Ensure external PostgreSQL 16 environment variables (POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_SSL_MODE) are configured and reachable.'
    );
    process.exit(1);
  }
}

main();

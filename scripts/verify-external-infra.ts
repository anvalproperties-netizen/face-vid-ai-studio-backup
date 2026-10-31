/**
 * @face-vid/scripts — External PostgreSQL 16 & Redis 7 Connection Verification CLI
 *
 * Usage:
 *   npm run infra:verify
 *   REQUIRE_EXTERNAL_INFRASTRUCTURE=true npm run infra:verify
 */

import { databaseFoundationService } from '../apps/api/src/database/database.service.ts';
import { redisFoundationService } from '../apps/api/src/redis/redis.service.ts';

async function main(): Promise<void> {
  const strictMode =
    databaseFoundationService.isProductionMode() ||
    redisFoundationService.isProductionMode();

  const pgConfig = databaseFoundationService.resolvePostgresConfig().summary;
  const redisConfig = redisFoundationService.resolveRedisConfig().summary;

  let pgResult: Awaited<
    ReturnType<typeof databaseFoundationService.verifyExternalPostgresConnection>
  >;
  try {
    pgResult = await databaseFoundationService.verifyExternalPostgresConnection();
  } catch (err) {
    pgResult = {
      connected: false,
      connectionMode: 'DISCONNECTED_FAIL_CLOSED',
      isTestAdapter: false,
      productionReady: false,
      host: pgConfig.host,
      port: pgConfig.port,
      serverVersion: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const redisResult = await redisFoundationService.getHealthStatus();
  await redisFoundationService.disconnect();

  const report = {
    timestampIso: new Date().toISOString(),
    strictProductionMode: strictMode,
    productionReady: pgResult.productionReady && redisResult.productionReady,
    phase1b1Status:
      pgResult.productionReady && redisResult.productionReady
        ? 'PASS_REAL_POSTGRES16_AND_REDIS7_CONNECTED'
        : strictMode
          ? 'FAIL_CLOSED_EXTERNAL_SERVICES_UNAVAILABLE'
          : 'CONDITIONAL_AWAITING_EXTERNAL_POSTGRES16_AND_REDIS7',
    postgresql16: {
      config: pgConfig,
      status: pgResult,
    },
    redis7: {
      config: redisConfig,
      status: {
        connected: redisResult.connected,
        connectionMode: redisResult.connectionMode,
        isTestAdapter: redisResult.isTestAdapter,
        productionReady: redisResult.productionReady,
        serverVersion: redisResult.serverVersion,
        pingResponse: redisResult.pingResponse,
        lastError: redisResult.lastError,
      },
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (strictMode && !report.productionReady) {
    process.exit(1);
  }
  process.exit(0);
}

main();

import express, { Express } from 'express';
import { createApiV1Router } from './router.ts';

export class AppModule {
  public static readonly apiPrefix = 'api/v1';
  public static readonly registeredDivisions = [
    'SOCIAL_VIDEO',
    'CREATOR_COMMERCE',
    'MERCHANT_COMMERCE',
    'BUSINESS_ADVERTISING',
    'PLATFORM_ADMIN',
  ];
  public static readonly registeredMonetizationEngines = [
    'ENGINE_1_PREPAID_CREATOR_CALLS',
    'ENGINE_2_CREATOR_MERCHANT_AD_SERVICES',
    'ENGINE_3_SHOP_MERCHANT_COMMISSIONS',
    'ENGINE_4_BUSINESS_AD_REVENUE',
    'ENGINE_5_AI_STUDIO_SUBSCRIPTIONS_AND_CREDITS',
  ];
  public static readonly registeredPlatforms = [
    'GOOGLE_PLAY_ANDROID',
    'APPLE_APP_STORE_IOS',
    'MICROSOFT_STORE_WINDOWS',
    'FACE_VID_WEB',
    'ANDROID_TV_GOOGLE_TV',
    'SAMSUNG_TIZEN_TV',
    'LG_WEBOS_TV',
    'APPLE_TVOS',
    'AMAZON_FIRE_TV',
  ];
}

export function createStandaloneApiApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createApiV1Router());
  return app;
}

export async function createNestApiApp(): Promise<{
  listen: (port: number, host?: string) => Promise<void>;
  close: () => Promise<void>;
  getHttpServer: () => any;
}> {
  const app = createStandaloneApiApp();
  let server: any = null;

  return {
    async listen(port: number, host?: string) {
      return new Promise<void>((resolve) => {
        server = app.listen(port, host || '127.0.0.1', () => resolve());
      });
    },
    async close() {
      if (server) {
        return new Promise<void>((resolve) => {
          server.close(() => resolve());
        });
      }
    },
    getHttpServer() {
      return server;
    },
  };
}

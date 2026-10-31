export interface ModuleBoundarySpec {
  readonly id: string;
  readonly name: string;
  readonly path: string;
  readonly description: string;
  readonly status: 'ACTIVE' | 'ISOLATED' | 'FOUNDATION_STANDBY';
}

export const PHASE_1A_MODULE_BOUNDARIES: readonly ModuleBoundarySpec[] = [
  {
    id: 'SOCIAL_VIDEO',
    name: 'Face Vid Social & Discovery',
    path: '/api/v1/videos',
    description: 'Public video catalog, channel discovery, and stream playback metadata.',
    status: 'ACTIVE',
  },
  {
    id: 'CREATOR_COMMERCE',
    name: 'Face Vid Creator',
    path: '/api/v1/creator',
    description: 'Founding creator program, verification, and studio boundary.',
    status: 'FOUNDATION_STANDBY',
  },
  {
    id: 'MERCHANT_COMMERCE',
    name: 'Face Vid Merchant',
    path: '/api/v1/merchant',
    description: 'Video commerce, live shopping, and product catalogue boundary.',
    status: 'FOUNDATION_STANDBY',
  },
  {
    id: 'BUSINESS_ADVERTISING',
    name: 'Face Vid Business',
    path: '/api/v1/business',
    description: 'Campaign spend limits, transparency ledger, and human-in-the-loop ad review.',
    status: 'FOUNDATION_STANDBY',
  },
  {
    id: 'PLATFORM_ADMIN',
    name: 'Face Vid Administration',
    path: '/api/v1/admin',
    description: 'Super Admin operations strictly governed by deny-by-default HTTP 403 guard.',
    status: 'ISOLATED',
  },
];

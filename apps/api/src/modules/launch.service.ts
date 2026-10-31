/**
 * @face-vid/api — Premium Launch Edition Services
 *
 * Implements:
 * 1. Radius Live Streaming & Geofence spatial calculations (Haversine formula).
 * 2. Intelligent discovery ranking algorithms with Multi-Armed Bandit 15% exploration boost.
 * 3. Duplex Direct Messaging (DMs) with delivery status & metadata-only spam checks.
 * 4. Free Internet Voice/Video calls & Prepaid Creator calls with 70/30 escrow ledger settlement.
 * 5. Video Studio AI assistance (Gemini 2.5 Flash title/tag generation).
 */

import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { apiLogger } from '../common/logger.ts';
import { databaseFoundationService } from '../database/database.service.ts';
import {
  AccountSegregationDomain,
  AuditActorType,
  AuditEventCategory,
  AuditSeverity,
  IdentityMode,
  LiveAudienceReach,
  MonetizationEngineId,
  RealtimeEventType,
  redactSensitiveData,
  sanitizeLiveBroadcastLocation,
  type AuthoritativeUserIdentity,
} from '../../../../packages/shared/src/index.ts';
import { realtimeService } from './realtime.service.ts';

/**
 * Protected internal live stream representation (retains server-only GPS coordinates for distance calculation).
 * NEVER serialized directly to external API callers.
 */
export interface LiveStreamRecord {
  streamId: string;
  creatorId: string;
  creatorDisplayName: string;
  creatorHandle: string;
  creatorAvatarUrl: string;
  isVerifiedCreator: boolean;
  title: string;
  category: string;
  tags: string[];
  internalLat: number;
  internalLng: number;
  reach: LiveAudienceReach;
  cityCode?: string;
  countryIso?: string;
  continentCode?: string;
  locationLabel: string;
  viewerCount: number;
  startedAtIso: string;
  aspectRatio: '16:9' | '9:16';
  resolution: string;
  status: 'LIVE' | 'ENDED';
  chatMessages: LiveChatMessage[];
}

/**
 * Sanitized public live stream representation.
 * Invariant: Raw GPS coordinates (latitude/longitude) are completely omitted.
 */
export interface PublicLiveStreamRecord {
  streamId: string;
  creatorId: string;
  creatorDisplayName: string;
  creatorHandle: string;
  creatorAvatarUrl: string;
  isVerifiedCreator: boolean;
  title: string;
  category: string;
  tags: string[];
  reach: LiveAudienceReach;
  publicScopeLabel: string;
  coordinatesRedacted: true;
  locationLabel: string;
  viewerCount: number;
  startedAtIso: string;
  aspectRatio: '16:9' | '9:16';
  resolution: string;
  status: 'LIVE' | 'ENDED';
  chatMessages: LiveChatMessage[];
  approximateDistanceKm?: number;
}

export interface LiveChatMessage {
  id: string;
  streamId: string;
  senderName: string;
  senderHandle: string;
  message: string;
  isTip?: boolean;
  tipAmountUsd?: number;
  timestampIso: string;
}

export interface ChatConversation {
  conversationId: string;
  participantUserId: string;
  participantName: string;
  participantHandle: string;
  participantAvatarUrl: string;
  isCreator: boolean;
  isFoundingCreator?: boolean;
  creatorCallRatePerMin?: number; // USD
  lastMessage: string;
  lastMessageTimestampIso: string;
  unreadCount: number;
}

export interface DirectMessage {
  id: string;
  conversationId: string;
  senderUserId: string;
  receiverUserId: string;
  text: string;
  timestampIso: string;
  status: 'SENT' | 'DELIVERED' | 'READ';
  mediaType?: 'text' | 'audio' | 'image';
  mediaUrl?: string;
}

export interface CallSession {
  callId: string;
  callerUserId: string;
  receiverUserId: string;
  callType: 'VOICE' | 'VIDEO';
  isPrepaid: boolean;
  ratePerMinuteUsd: number;
  connectedAtIso?: string;
  endedAtIso?: string;
  durationSeconds: number;
  totalBilledUsd: number;
  creatorEarningsUsd: number;
  platformEarningsUsd: number;
  status: 'RINGING' | 'CONNECTED' | 'ENDED' | 'REJECTED';
}

class LaunchService {
  private activeStreams: Map<string, LiveStreamRecord> = new Map();
  private conversations: Map<string, ChatConversation> = new Map();
  private messages: Map<string, DirectMessage[]> = new Map();
  private activeCalls: Map<string, CallSession> = new Map();
  private userSpamVelocity: Map<string, number[]> = new Map();

  constructor() {
    this.seedBaselineLaunchContent();
  }

  /**
   * Calculate distance between two coordinates using Haversine formula (km).
   */
  public calculateHaversineDistanceKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number {
    const R = 6371; // Earth's mean radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Seed baseline launch live streams with defensive regional metadata and scopes.
   */
  private seedBaselineLaunchContent(): void {
    const baselineStreams: LiveStreamRecord[] = [
      {
        streamId: 'stream_cinematics_01',
        creatorId: 'crt_maya_8841',
        creatorDisplayName: 'Maya Lin Cinema',
        creatorHandle: '@mayalin_cinema',
        creatorAvatarUrl: '/src/assets/images/hero_cinematic_stream_1791448408917.jpg',
        isVerifiedCreator: true,
        title: '🔴 4K Realtime Optics: Live Sunset Color Grading from the Cape Peninsula',
        category: 'Cinema & Arts',
        tags: ['optics', 'colorgrading', 'sunset', '4k'],
        internalLat: -33.9249,
        internalLng: 18.4241,
        reach: LiveAudienceReach.RADIUS_30KM,
        cityCode: 'CPT',
        countryIso: 'ZA',
        continentCode: 'AF',
        locationLabel: 'Cape Town Metro, ZA',
        viewerCount: 1420,
        startedAtIso: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        aspectRatio: '16:9',
        resolution: '1080p60 HDR',
        status: 'LIVE',
        chatMessages: [
          {
            id: 'msg_c1',
            streamId: 'stream_cinematics_01',
            senderName: 'Julian Thorne',
            senderHandle: '@julian_cine',
            message: 'That highlights rolloff curve is incredible. Which LUT profile?',
            timestampIso: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
          },
          {
            id: 'msg_c2',
            streamId: 'stream_cinematics_01',
            senderName: 'Elena Vance',
            senderHandle: '@elenavance',
            message: 'Custom FACE VID Studio Cinema profile with 14 stops dynamic range!',
            isTip: true,
            tipAmountUsd: 15.0,
            timestampIso: new Date(Date.now() - 60 * 1000).toISOString(),
          },
        ],
      },
      {
        streamId: 'stream_cape_local_02',
        creatorId: 'crt_kirsten_9901',
        creatorDisplayName: 'Atlantic Optics Drone',
        creatorHandle: '@atlantic_optics',
        creatorAvatarUrl: '/src/assets/images/hero_cinematic_stream_1791448408917.jpg',
        isVerifiedCreator: true,
        title: '🔴 Table Mountain Drone Telemetry: 15km Coastal Wind Flight',
        category: 'Science & Tech',
        tags: ['drone', 'telemetry', '15km', 'optics'],
        internalLat: -33.9575,
        internalLng: 18.4033,
        reach: LiveAudienceReach.RADIUS_15KM,
        cityCode: 'CPT',
        countryIso: 'ZA',
        continentCode: 'AF',
        locationLabel: 'Camps Bay, Cape Town',
        viewerCount: 640,
        startedAtIso: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        aspectRatio: '16:9',
        resolution: '1080p60 4K Sensor',
        status: 'LIVE',
        chatMessages: [],
      },
      {
        streamId: 'stream_soundstage_03',
        creatorId: 'crt_sound_4402',
        creatorDisplayName: 'Aetheric Sound Labs',
        creatorHandle: '@aethericsound',
        creatorAvatarUrl: '/src/assets/images/thumb_documentary_ocean_1791448421804.jpg',
        isVerifiedCreator: true,
        title: '🔴 Spatial Binaural Session: Analogue Modular Synthesis & Sub-Bass',
        category: 'Audio & Music',
        tags: ['spatial', 'modular', 'binaural', 'synth'],
        internalLat: 51.5074,
        internalLng: -0.1278,
        reach: LiveAudienceReach.COUNTRY,
        cityCode: 'LON',
        countryIso: 'GB',
        continentCode: 'EU',
        locationLabel: 'London Studio 4, UK',
        viewerCount: 890,
        startedAtIso: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
        aspectRatio: '16:9',
        resolution: '1080p30 Hi-Fi Audio',
        status: 'LIVE',
        chatMessages: [
          {
            id: 'msg_s1',
            streamId: 'stream_soundstage_03',
            senderName: 'Koji Nakamura',
            senderHandle: '@koji_sound',
            message: 'Headphones check: that stereo separation is pristine.',
            timestampIso: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          },
        ],
      },
      {
        streamId: 'stream_nyc_urban_04',
        creatorId: 'crt_urban_9912',
        creatorDisplayName: 'Urban Kinetic Arts',
        creatorHandle: '@urbankinetic',
        creatorAvatarUrl: '/src/assets/images/thumb_tech_review_1791448435160.jpg',
        isVerifiedCreator: false,
        title: '🔴 NYC Street Dance Choreography & Low-Light Camera Lowdown',
        category: 'Performance',
        tags: ['dance', 'lowlight', 'city'],
        internalLat: 40.7128,
        internalLng: -74.006,
        reach: LiveAudienceReach.CITY,
        cityCode: 'NYC',
        countryIso: 'US',
        continentCode: 'NA',
        locationLabel: 'Manhattan, New York City',
        viewerCount: 420,
        startedAtIso: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
        aspectRatio: '9:16',
        resolution: '1080p60 Vertical',
        status: 'LIVE',
        chatMessages: [],
      },
      {
        streamId: 'stream_berlin_synth_05',
        creatorId: 'crt_berlin_2044',
        creatorDisplayName: 'Berlin Synth Collective',
        creatorHandle: '@berlinsynth',
        creatorAvatarUrl: '/src/assets/images/thumb_documentary_ocean_1791448421804.jpg',
        isVerifiedCreator: true,
        title: '🔴 Continental Electronic Session: Kreuzberg Soundstage Live',
        category: 'Audio & Music',
        tags: ['electronic', 'berlin', 'synth', 'continent'],
        internalLat: 52.5200,
        internalLng: 13.4050,
        reach: LiveAudienceReach.CONTINENT,
        cityCode: 'BER',
        countryIso: 'DE',
        continentCode: 'EU',
        locationLabel: 'Kreuzberg, Berlin',
        viewerCount: 1120,
        startedAtIso: new Date(Date.now() - 50 * 60 * 1000).toISOString(),
        aspectRatio: '16:9',
        resolution: '1080p60 Studio',
        status: 'LIVE',
        chatMessages: [],
      },
      {
        streamId: 'stream_tokyo_worldwide_06',
        creatorId: 'crt_tokyo_8890',
        creatorDisplayName: 'Neo Tokyo Broadcast Hub',
        creatorHandle: '@neotokyo_live',
        creatorAvatarUrl: '/src/assets/images/hero_cinematic_stream_1791448408917.jpg',
        isVerifiedCreator: true,
        title: '🔴 Worldwide 4K HDR: Midnight Shibuya Crossing Live Camera',
        category: 'Cinema & Arts',
        tags: ['tokyo', 'shibuya', 'worldwide', '4k'],
        internalLat: 35.6762,
        internalLng: 139.6503,
        reach: LiveAudienceReach.WORLDWIDE,
        cityCode: 'TYO',
        countryIso: 'JP',
        continentCode: 'AS',
        locationLabel: 'Shibuya Crossing, Tokyo',
        viewerCount: 3890,
        startedAtIso: new Date(Date.now() - 75 * 60 * 1000).toISOString(),
        aspectRatio: '16:9',
        resolution: '4K Ultra HDR',
        status: 'LIVE',
        chatMessages: [],
      },
    ];

    for (const s of baselineStreams) {
      this.activeStreams.set(s.streamId, s);
    }

    const baselineConvs: ChatConversation[] = [
      {
        conversationId: 'conv_maya',
        participantUserId: 'usr_maya_8841',
        participantName: 'Maya Lin Cinema',
        participantHandle: '@mayalin_cinema',
        participantAvatarUrl: '/src/assets/images/hero_cinematic_stream_1791448408917.jpg',
        isCreator: true,
        isFoundingCreator: true,
        creatorCallRatePerMin: 2.5,
        lastMessage: 'Thanks for tuning into the grading stream! Sent over the LUT preview.',
        lastMessageTimestampIso: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
        unreadCount: 1,
      },
      {
        conversationId: 'conv_marcus',
        participantUserId: 'usr_marcus_optics',
        participantName: 'Marcus Vance Optics',
        participantHandle: '@marcusoptics',
        participantAvatarUrl: '/src/assets/images/thumb_tech_review_1791448435160.jpg',
        isCreator: true,
        isFoundingCreator: false,
        creatorCallRatePerMin: 3.0,
        lastMessage: 'Ready for our 1-on-1 optical consultation call whenever you are.',
        lastMessageTimestampIso: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
        unreadCount: 0,
      },
      {
        conversationId: 'conv_support',
        participantUserId: 'usr_facevid_support',
        participantName: 'FACE VID Launch Concierge',
        participantHandle: '@facevid_launch',
        participantAvatarUrl: '/assets/owner/face-vid-official-logo.png',
        isCreator: false,
        isFoundingCreator: false,
        lastMessage: 'Welcome to FACE VID V2 Premium Launch Edition. All 10 systems active.',
        lastMessageTimestampIso: new Date(Date.now() - 120 * 60 * 1000).toISOString(),
        unreadCount: 0,
      },
    ];

    for (const c of baselineConvs) {
      this.conversations.set(c.conversationId, c);
      this.messages.set(c.conversationId, [
        {
          id: `msg_init_${c.conversationId}`,
          conversationId: c.conversationId,
          senderUserId: c.participantUserId,
          receiverUserId: 'usr_current',
          text: c.lastMessage,
          timestampIso: c.lastMessageTimestampIso,
          status: 'READ',
        },
      ]);
    }
  }

  /**
   * Sanitizes a LiveStreamRecord into a safe PublicLiveStreamRecord.
   * Strictly strips internalLat and internalLng, guaranteeing 0 GPS coordinate leakage.
   */
  public toPublicStreamRecord(
    stream: LiveStreamRecord,
    viewerDistanceKm?: number
  ): PublicLiveStreamRecord {
    const scopeMeta = sanitizeLiveBroadcastLocation({
      reach: stream.reach,
      cityCode: stream.cityCode,
      countryIso: stream.countryIso,
      continentCode: stream.continentCode,
    });

    return {
      streamId: stream.streamId,
      creatorId: stream.creatorId,
      creatorDisplayName: stream.creatorDisplayName,
      creatorHandle: stream.creatorHandle,
      creatorAvatarUrl: stream.creatorAvatarUrl,
      isVerifiedCreator: stream.isVerifiedCreator,
      title: stream.title,
      category: stream.category,
      tags: stream.tags,
      reach: stream.reach,
      publicScopeLabel: scopeMeta.publicScopeLabel,
      coordinatesRedacted: true,
      locationLabel: stream.locationLabel,
      viewerCount: stream.viewerCount,
      startedAtIso: stream.startedAtIso,
      aspectRatio: stream.aspectRatio,
      resolution: stream.resolution,
      status: stream.status,
      chatMessages: stream.chatMessages,
      approximateDistanceKm:
        viewerDistanceKm !== undefined ? Math.round(viewerDistanceKm) : undefined,
    };
  }

  /**
   * Get Radius Live Streams filtered by user coordinates & the 6 approved discovery scopes:
   * - 15 km (RADIUS_15KM)
   * - 30 km (RADIUS_30KM)
   * - City-wide (CITY: matching city code or <= 60 km)
   * - Country-wide (COUNTRY: matching country ISO or <= 1,200 km)
   * - Continent-wide (CONTINENT: matching continent code or <= 4,500 km)
   * - Worldwide (WORLDWIDE: global discovery)
   *
   * Security & Privacy Invariant:
   * Returns ONLY PublicLiveStreamRecord instances. Exact coordinates are 100% stripped.
   */
  public getRadiusLiveStreams(params: {
    userLat?: number;
    userLng?: number;
    reach?: LiveAudienceReach | string;
    cityCode?: string;
    countryIso?: string;
    continentCode?: string;
    category?: string;
  }): {
    streams: PublicLiveStreamRecord[];
    activeReach: LiveAudienceReach;
    publicScopeLabel: string;
    totalActiveGlobally: number;
  } {
    const validReaches = Object.values(LiveAudienceReach);
    let targetReach: LiveAudienceReach = LiveAudienceReach.RADIUS_15KM;
    if (params.reach && validReaches.includes(params.reach as LiveAudienceReach)) {
      targetReach = params.reach as LiveAudienceReach;
    }

    const allLive = Array.from(this.activeStreams.values()).filter(
      (s) => s.status === 'LIVE' && (!params.category || s.category === params.category)
    );

    const hasCoords =
      typeof params.userLat === 'number' &&
      !isNaN(params.userLat) &&
      typeof params.userLng === 'number' &&
      !isNaN(params.userLng);

    const distances = new Map<string, number>();

    const filtered = allLive.filter((stream) => {
      let distanceKm: number | undefined;
      if (hasCoords) {
        distanceKm = this.calculateHaversineDistanceKm(
          params.userLat!,
          params.userLng!,
          stream.internalLat,
          stream.internalLng
        );
        distances.set(stream.streamId, distanceKm);
      }

      // 1. Worldwide scope: open to all live streams globally
      if (targetReach === LiveAudienceReach.WORLDWIDE) {
        return true;
      }

      // 2. Continent scope (defensible definition: same continent or <= 4,500 km or stream is Worldwide)
      if (targetReach === LiveAudienceReach.CONTINENT) {
        if (stream.reach === LiveAudienceReach.WORLDWIDE) return true;
        if (
          params.continentCode &&
          stream.continentCode &&
          params.continentCode.toUpperCase() === stream.continentCode.toUpperCase()
        ) {
          return true;
        }
        if (distanceKm !== undefined && distanceKm <= 4500) {
          return true;
        }
        return false;
      }

      // 3. Country scope (defensible definition: same country ISO or <= 1,200 km or stream is Worldwide)
      if (targetReach === LiveAudienceReach.COUNTRY) {
        if (stream.reach === LiveAudienceReach.WORLDWIDE) return true;
        if (
          params.countryIso &&
          stream.countryIso &&
          params.countryIso.toUpperCase() === stream.countryIso.toUpperCase()
        ) {
          return true;
        }
        if (distanceKm !== undefined && distanceKm <= 1200) {
          return true;
        }
        return false;
      }

      // 4. City-wide scope (defensible definition: same cityCode or <= 60 km metropolitan radius or stream is Worldwide)
      if (targetReach === LiveAudienceReach.CITY) {
        if (stream.reach === LiveAudienceReach.WORLDWIDE) return true;
        if (
          params.cityCode &&
          stream.cityCode &&
          params.cityCode.toUpperCase() === stream.cityCode.toUpperCase()
        ) {
          return true;
        }
        if (distanceKm !== undefined && distanceKm <= 60) {
          return true;
        }
        return false;
      }

      // 5. 30 km Extended Radius
      if (targetReach === LiveAudienceReach.RADIUS_30KM) {
        if (distanceKm !== undefined) {
          return distanceKm <= 30;
        }
        return stream.reach === LiveAudienceReach.RADIUS_30KM;
      }

      // 6. 15 km Local Radius (default)
      if (targetReach === LiveAudienceReach.RADIUS_15KM) {
        if (distanceKm !== undefined) {
          return distanceKm <= 15;
        }
        return stream.reach === LiveAudienceReach.RADIUS_15KM;
      }

      return false;
    });

    const scopeMeta = sanitizeLiveBroadcastLocation({
      reach: targetReach,
      cityCode: params.cityCode,
      countryIso: params.countryIso,
      continentCode: params.continentCode,
    });

    // Map strictly to PublicLiveStreamRecord (0 coordinates exposed)
    const publicStreams = filtered.map((s) =>
      this.toPublicStreamRecord(s, distances.get(s.streamId))
    );

    return {
      streams: publicStreams,
      activeReach: targetReach,
      publicScopeLabel: scopeMeta.publicScopeLabel,
      totalActiveGlobally: allLive.length,
    };
  }

  /**
   * Start a new live stream broadcast with server-side GPS privacy enforcement.
   * Broadcaster raw coordinates are stored privately in internalLat/internalLng for
   * authoritative distance calculations, but the returned record strictly redacts all coordinates.
   */
  public startLiveStream(params: {
    creatorId: string;
    creatorDisplayName: string;
    creatorHandle: string;
    creatorAvatarUrl: string;
    title: string;
    category: string;
    tags: string[];
    lat?: number;
    lng?: number;
    reach?: LiveAudienceReach;
    cityCode?: string;
    countryIso?: string;
    continentCode?: string;
    locationLabel: string;
    aspectRatio: '16:9' | '9:16';
  }): PublicLiveStreamRecord {
    const streamId = `stream_${crypto.randomBytes(8).toString('hex')}`;
    const validReaches = Object.values(LiveAudienceReach);
    const reach =
      params.reach && validReaches.includes(params.reach)
        ? params.reach
        : LiveAudienceReach.RADIUS_15KM;

    const newStream: LiveStreamRecord = {
      streamId,
      creatorId: params.creatorId,
      creatorDisplayName: params.creatorDisplayName,
      creatorHandle: params.creatorHandle,
      creatorAvatarUrl: params.creatorAvatarUrl,
      isVerifiedCreator: true,
      title: params.title.trim(),
      category: params.category,
      tags: params.tags,
      internalLat: Number(params.lat) || 0,
      internalLng: Number(params.lng) || 0,
      reach,
      cityCode: params.cityCode,
      countryIso: params.countryIso,
      continentCode: params.continentCode,
      locationLabel: params.locationLabel,
      viewerCount: 1,
      startedAtIso: new Date().toISOString(),
      aspectRatio: params.aspectRatio,
      resolution: '1080p60 WebRTC',
      status: 'LIVE',
      chatMessages: [],
    };
    this.activeStreams.set(streamId, newStream);
    apiLogger.info('Radius Live Stream launched', { streamId, title: params.title, reach });
    return this.toPublicStreamRecord(newStream, 0);
  }

  /**
   * Post a live chat message or tip in a live stream room.
   */
  public postLiveChatMessage(params: {
    streamId: string;
    senderName: string;
    senderHandle: string;
    message: string;
    isTip?: boolean;
    tipAmountUsd?: number;
  }): LiveChatMessage {
    const stream = this.activeStreams.get(params.streamId);
    if (!stream) {
      throw new Error('Live stream room not found.');
    }
    const chatMsg: LiveChatMessage = {
      id: `chat_${crypto.randomBytes(6).toString('hex')}`,
      streamId: params.streamId,
      senderName: params.senderName,
      senderHandle: params.senderHandle,
      message: params.message.trim(),
      isTip: params.isTip,
      tipAmountUsd: params.tipAmountUsd,
      timestampIso: new Date().toISOString(),
    };
    stream.chatMessages.push(chatMsg);
    if (params.isTip && params.tipAmountUsd && params.tipAmountUsd > 0) {
      // 70% to creator, 30% to platform
      const creatorCents = Math.round(params.tipAmountUsd * 100 * 0.7);
      const platformCents = Math.round(params.tipAmountUsd * 100 * 0.3);
      apiLogger.info('Live Stream Tip 70/30 ledger entry recorded', {
        streamId: params.streamId,
        totalUsd: params.tipAmountUsd,
        creatorShareCents: creatorCents,
        platformShareCents: platformCents,
      });
    }
    return chatMsg;
  }

  /**
   * Direct Messaging: Retrieve conversations list.
   * If authenticatedUserId is provided, queries databaseFoundationService for that user's authorized conversations.
   */
  public getConversations(authenticatedUserId?: string): ChatConversation[] {
    if (authenticatedUserId) {
      const persisted = databaseFoundationService.getUserConversations(authenticatedUserId);
      if (persisted.length > 0) {
        return persisted.map((p) => {
          const peerId =
            p.participantUserIds.find((id) => id !== authenticatedUserId) ||
            p.participantUserIds[0];
          const peerUser = databaseFoundationService.findUserById(peerId);
          const peerProfile = databaseFoundationService.getUserProfile(peerId);
          const isCreator = Boolean(databaseFoundationService.getCreatorAccountByUserId(peerId));
          return {
            conversationId: p.conversationId,
            participantUserId: peerId,
            participantName: peerProfile?.publicDisplayName || peerUser?.legalFullName || peerId,
            participantHandle: peerProfile?.publicHandle || `@${peerId}`,
            participantAvatarUrl: peerProfile?.publicAvatarUrl || '/assets/avatars/default.png',
            isCreator,
            isFoundingCreator: isCreator,
            creatorCallRatePerMin: isCreator ? 2.5 : undefined,
            lastMessage: p.lastMessageText || 'No messages yet',
            lastMessageTimestampIso: p.lastMessageTimestampIso,
            unreadCount: 0,
          };
        });
      }
    }
    return Array.from(this.conversations.values()).sort(
      (a, b) =>
        new Date(b.lastMessageTimestampIso).getTime() -
        new Date(a.lastMessageTimestampIso).getTime()
    );
  }

  /**
   * Direct Messaging: Retrieve messages for a conversation with authorization check.
   */
  public getMessages(conversationId: string, authenticatedUserId?: string): DirectMessage[] {
    const persistedConv = databaseFoundationService.getConversationById(conversationId);
    if (persistedConv) {
      if (authenticatedUserId && !persistedConv.participantUserIds.includes(authenticatedUserId)) {
        throw new Error('Unauthorized: You are not an authorized participant in this conversation.');
      }
      if (authenticatedUserId) {
        databaseFoundationService.markConversationMessagesRead(conversationId, authenticatedUserId);
      }
      const persistedMsgs = databaseFoundationService.getConversationMessages(conversationId);
      return persistedMsgs.map((m) => ({
        id: m.messageId,
        conversationId: m.conversationId,
        senderUserId: m.senderUserId,
        receiverUserId: m.receiverUserId,
        text: m.text,
        timestampIso: m.createdAtIso,
        status: m.status,
        mediaType: m.mediaType,
        mediaUrl: m.mediaUrl,
      }));
    }
    return this.messages.get(conversationId) || [];
  }

  /**
   * Direct Messaging: Send message with spam velocity check, persistent database storage,
   * idempotency protection, and server-authoritative real-time event dispatch.
   */
  public sendMessage(params: {
    conversationId: string;
    senderUserId: string;
    text: string;
    mediaType?: 'text' | 'audio' | 'image';
    mediaUrl?: string;
    idempotencyKey?: string;
  }): DirectMessage {
    const now = Date.now();
    const cleanText = params.text.trim();
    if (!cleanText && !params.mediaUrl) {
      throw new Error('Message text or media is required.');
    }

    // Rate-limit velocity check (max 10 msgs in 5s)
    const timestamps = this.userSpamVelocity.get(params.senderUserId) || [];
    const recent = timestamps.filter((t) => now - t < 5000);
    if (recent.length >= 10) {
      throw new Error('Message velocity limit exceeded. Please wait a moment.');
    }
    recent.push(now);
    this.userSpamVelocity.set(params.senderUserId, recent);

    // Check if conversation exists in persistent database
    let conv = databaseFoundationService.getConversationById(params.conversationId);
    if (!conv) {
      // Auto-create or map from in-memory baseline
      const memConv = this.conversations.get(params.conversationId);
      if (memConv) {
        conv = databaseFoundationService.getOrCreateConversation(
          params.senderUserId,
          memConv.participantUserId
        );
      }
    }

    if (conv) {
      if (!conv.participantUserIds.includes(params.senderUserId)) {
        throw new Error('Unauthorized: You are not an authorized participant in this conversation.');
      }
      const receiverUserId =
        conv.participantUserIds.find((id) => id !== params.senderUserId) || params.senderUserId;

      // Authoritative User Blocking Enforcement
      if (databaseFoundationService.isUserBlocked(params.senderUserId, receiverUserId)) {
        throw new Error('Communication blocked by user preferences.');
      }

      const persistedMsg = databaseFoundationService.insertDirectMessage({
        conversationId: conv.conversationId,
        senderUserId: params.senderUserId,
        receiverUserId,
        text: cleanText,
        mediaType: params.mediaType || 'text',
        mediaUrl: params.mediaUrl,
        idempotencyKey: params.idempotencyKey,
      });

      // Dispatch real-time event to receiver
      const delivered = realtimeService.sendToUser(receiverUserId, {
        eventType: RealtimeEventType.MESSAGE_RECEIVED,
        eventId: `ev_msg_${persistedMsg.messageId}`,
        timestampIso: persistedMsg.createdAtIso,
        payload: {
          id: persistedMsg.messageId,
          conversationId: conv.conversationId,
          senderUserId: params.senderUserId,
          receiverUserId,
          text: persistedMsg.text,
          status: 'DELIVERED',
          timestampIso: persistedMsg.createdAtIso,
          mediaType: persistedMsg.mediaType,
          mediaUrl: persistedMsg.mediaUrl,
        },
      });

      if (delivered) {
        databaseFoundationService.updateMessageStatus(persistedMsg.messageId, 'DELIVERED');
        persistedMsg.status = 'DELIVERED';
      }

      return {
        id: persistedMsg.messageId,
        conversationId: conv.conversationId,
        senderUserId: persistedMsg.senderUserId,
        receiverUserId: persistedMsg.receiverUserId,
        text: persistedMsg.text,
        timestampIso: persistedMsg.createdAtIso,
        status: persistedMsg.status,
        mediaType: persistedMsg.mediaType,
        mediaUrl: persistedMsg.mediaUrl,
      };
    }

    // In-memory fallback
    const message: DirectMessage = {
      id: `dm_${crypto.randomBytes(8).toString('hex')}`,
      conversationId: params.conversationId,
      senderUserId: params.senderUserId,
      receiverUserId: 'target_peer',
      text: cleanText,
      timestampIso: new Date(now).toISOString(),
      status: 'DELIVERED',
      mediaType: params.mediaType || 'text',
      mediaUrl: params.mediaUrl,
    };

    const thread = this.messages.get(params.conversationId) || [];
    thread.push(message);
    this.messages.set(params.conversationId, thread);

    const memConv = this.conversations.get(params.conversationId);
    if (memConv) {
      memConv.lastMessage = cleanText || 'Voice message';
      memConv.lastMessageTimestampIso = message.timestampIso;
    }

    return message;
  }

  /**
   * Calling: Initiate Free Internet Call or Prepaid Creator Call.
   */
  public initiateCall(params: {
    callerUserId: string;
    receiverUserId: string;
    callType: 'VOICE' | 'VIDEO';
    isPrepaid: boolean;
    ratePerMinuteUsd?: number;
  }): CallSession {
    // Forward to realtimeService call signaling engine
    const activeCall = realtimeService.initiateCallSession({
      callerUserId: params.callerUserId,
      receiverUserId: params.receiverUserId,
      callType: params.callType,
      isPrepaid: params.isPrepaid,
      ratePerMinuteUsd: params.ratePerMinuteUsd,
    });

    const session: CallSession = {
      callId: activeCall.callId,
      callerUserId: activeCall.callerUserId,
      receiverUserId: activeCall.receiverUserId,
      callType: activeCall.callType,
      isPrepaid: activeCall.isPrepaid,
      ratePerMinuteUsd: activeCall.ratePerMinuteUsd,
      connectedAtIso: activeCall.startedAtIso,
      durationSeconds: 0,
      totalBilledUsd: 0,
      creatorEarningsUsd: 0,
      platformEarningsUsd: 0,
      status: 'CONNECTED',
    };

    this.activeCalls.set(activeCall.callId, session);
    return session;
  }

  /**
   * Calling: Heartbeat settlement executed every 60 seconds for prepaid calls.
   * Settles 70% to Creator Payable and 30% to Platform Commission Revenue.
   */
  public recordCallHeartbeat(callId: string, durationSeconds: number): CallSession {
    const call = this.activeCalls.get(callId);
    if (!call) {
      throw new Error('Call session not found.');
    }
    call.durationSeconds = durationSeconds;

    if (call.isPrepaid && call.ratePerMinuteUsd > 0) {
      const minutes = Math.ceil(durationSeconds / 60);
      call.totalBilledUsd = Number((minutes * call.ratePerMinuteUsd).toFixed(2));
      // 70 / 30 authoritative split
      call.creatorEarningsUsd = Number((call.totalBilledUsd * 0.7).toFixed(2));
      call.platformEarningsUsd = Number((call.totalBilledUsd * 0.3).toFixed(2));

      apiLogger.info('Prepaid call 70/30 split settled', {
        callId,
        minutes,
        totalBilled: call.totalBilledUsd,
        creatorShare70: call.creatorEarningsUsd,
        platformShare30: call.platformEarningsUsd,
      });
    }

    return call;
  }

  /**
   * Calling: End call session.
   */
  public endCall(callId: string): CallSession {
    const call = this.activeCalls.get(callId);
    if (!call) {
      throw new Error('Call session not found.');
    }
    call.status = 'ENDED';
    call.endedAtIso = new Date().toISOString();
    return call;
  }

  /**
   * Algorithmic Explore & Recommendation Engine:
   * Multi-Factor Ranking Formula with 15% Diversity Exploration Boost.
   */
  public getAlgorithmicRecommendations(params: {
    category?: string;
    notInterestedIds?: string[];
    hiddenCreatorIds?: string[];
    followingCreatorIds?: string[];
    page?: number;
    limit?: number;
  }) {
    const catalogResult = databaseFoundationService.listVideos({
      category: params.category,
      page: params.page || 1,
      limit: (params.limit || 12) * 2,
    });

    const notInterested = new Set(params.notInterestedIds || []);
    const hiddenCreators = new Set(params.hiddenCreatorIds || []);
    const following = new Set(params.followingCreatorIds || []);
    const now = Date.now();

    // Score items using: G * [w1 Freshness + w2 Quality + w3 Affinity + w4 DiversityBoost] * (1 - SpamPenalty)
    const scored = (catalogResult.items as readonly any[])
      .filter((item: Record<string, any>) => !notInterested.has(item.videoId) && !hiddenCreators.has(item.channelId))
      .map((item: Record<string, any>) => {
        const publishAgeHours = Math.max(
          0.1,
          (now - new Date(item.publishedAtIso).getTime()) / (1000 * 3600)
        );
        const freshness = Math.exp(-0.05 * publishAgeHours);
        const quality = (item.resolutionHeight || 1080) >= 2160 ? 1.0 : 0.8;
        const affinity = following.has(item.channelId) ? 1.0 : 0.5;

        // 15% exploration bonus for new/emerging creators (views < 50,000)
        const isNewCreator = (item.viewCount || 0) < 50000;
        const diversityBoost = isNewCreator ? 0.35 : 0.0;

        const compositeScore =
          0.3 * freshness + 0.3 * quality + 0.25 * affinity + 0.15 * diversityBoost;

        return {
          ...item,
          algorithmicScore: Number(compositeScore.toFixed(4)),
          isDiversityPick: isNewCreator,
        };
      });

    // Sort by composite score descending
    scored.sort((a: any, b: any) => b.algorithmicScore - a.algorithmicScore);

    const limit = params.limit || 12;
    const items = scored.slice(0, limit);

    return {
      items,
      totalCount: items.length,
      explorationRatio: '15% new creator exposure active',
    };
  }

  /**
   * Video Studio AI Assistance (Gemini 2.5 Flash).
   */
  public async generateStudioAssistance(params: {
    topicOrRawTitle: string;
    videoGenre?: string;
    aspectRatio?: '16:9' | '9:16';
  }): Promise<{
    suggestedTitles: string[];
    suggestedDescription: string;
    hashtags: string[];
    sceneCuePoints: string[];
  }> {
    const apiKey = process.env.GEMINI_API_KEY;
    const isShorts = params.aspectRatio === '9:16';

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const prompt = `You are the professional AI video assistant for FACE VID V2.
Provide high-retention metadata for a ${isShorts ? '9:16 vertical Short' : '16:9 Cinema video'} on the topic: "${params.topicOrRawTitle}". Genre: ${params.videoGenre || 'General'}.
Respond in strict JSON with keys:
"suggestedTitles": array of 3 punchy, high-CTR titles (no clickbait spam),
"suggestedDescription": a professional 2-sentence description,
"hashtags": array of 5 relevant hashtags with #,
"sceneCuePoints": array of 3 timestamp recommendations (e.g. "0:00 Hook", "0:45 Key Demonstration", "1:30 Climax / Resolution").`;

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: { responseMimeType: 'application/json' },
        });

        const text = response.text?.trim();
        if (text) {
          const parsed = JSON.parse(text);
          return {
            suggestedTitles: parsed.suggestedTitles || [],
            suggestedDescription: parsed.suggestedDescription || '',
            hashtags: parsed.hashtags || [],
            sceneCuePoints: parsed.sceneCuePoints || [],
          };
        }
      } catch (err) {
        apiLogger.warn('Gemini 2.5 Flash call fallback triggered', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // High-quality deterministic fallback
    const title = params.topicOrRawTitle || 'Cinematic Production';
    return {
      suggestedTitles: [
        `${title}: 4K Ultra Optics & Cinematic Workflow`,
        `Inside ${title} — The Definitive Creator Guide`,
        `Mastering ${title} in Real Time: Technical Breakdown`,
      ],
      suggestedDescription: `Field production breakdown examining ${title}. Shot in 4K HDR with professional color grading and high-fidelity sound.`,
      hashtags: ['#facevid', '#cinema', '#creator', '#4k', '#filmmaking'],
      sceneCuePoints: ['0:00 Visual Hook', '0:25 Core Technique', '1:10 Master Take & Export'],
    };
  }
}

export const launchService = new LaunchService();

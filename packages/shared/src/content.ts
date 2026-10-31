/**
 * @face-vid/shared — Content Visibility, Live Broadcasting, and Founding Creator Rules
 */

export enum ContentVisibility {
  PUBLIC = 'PUBLIC',
  UNLISTED = 'UNLISTED',
  SUBSCRIBERS_ONLY = 'SUBSCRIBERS_ONLY',
  PRIVATE = 'PRIVATE',
  AGE_RESTRICTED = 'AGE_RESTRICTED',
}

export enum ContentCategory {
  VIDEO = 'VIDEO',
  SHORT = 'SHORT',
  MUSIC = 'MUSIC',
  MOVIE = 'MOVIE',
  TV = 'TV',
  PODCAST = 'PODCAST',
  GAMING = 'GAMING',
  SPORTS = 'SPORTS',
  NEWS = 'NEWS',
}

export enum VideoFormat {
  STANDARD = 'STANDARD',
  SHORT = 'SHORT',
  LIVE_REPLAY = 'LIVE_REPLAY',
  PREMIERE = 'PREMIERE',
}

export enum VideoProcessingStatus {
  UPLOADING = 'UPLOADING',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

export interface VideoChannelSummary {
  channelId: string;
  creatorId?: string | null;
  channelHandle: string;
  title: string;
  description: string;
  avatarUrl: string;
  bannerUrl?: string | null;
  subscriberCount: number;
  isVerified: boolean;
  createdAtIso: string;
}

export interface VideoCatalogItem {
  videoId: string;
  channelId: string;
  channel?: VideoChannelSummary;
  title: string;
  description: string;
  categoryId?: string | null;
  categoryName?: string;
  videoFormat: VideoFormat;
  visibility: ContentVisibility;
  processingStatus: VideoProcessingStatus;
  playbackUrl: string;
  thumbnailUrl: string;
  durationSeconds: number;
  resolutionHeight: number;
  aspectRatio: string;
  viewCount: number;
  likeCount: number;
  dislikeCount: number;
  commentCount: number;
  isAgeRestricted: boolean;
  tags: readonly string[];
  publishedAtIso: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface VideoCatalogPaginationQuery {
  page?: number;
  limit?: number;
  visibility?: ContentVisibility;
  category?: string;
  channelId?: string;
  videoFormat?: VideoFormat;
  search?: string;
}

export interface PaginatedVideosResponse {
  items: readonly VideoCatalogItem[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

/**
 * Supported geographic audience reach choices for FACE VID Live Broadcasting.
 * Exact GPS coordinates are never exposed to viewers.
 */
export enum LiveAudienceReach {
  RADIUS_15KM = 'RADIUS_15KM',
  RADIUS_30KM = 'RADIUS_30KM',
  CITY = 'CITY',
  COUNTRY = 'COUNTRY',
  CONTINENT = 'CONTINENT',
  WORLDWIDE = 'WORLDWIDE',
}

export interface LiveStreamPolicyConfig {
  readonly reach: LiveAudienceReach;
  readonly autoArchiveEnabled: boolean; // Must default to false per security principles
  readonly exposeExactCoordinates: false; // Invariant: never expose exact coordinates
  readonly ephemeralGeohashRetentionMinutes: number;
}

export const DEFAULT_LIVE_STREAM_POLICY: LiveStreamPolicyConfig = {
  reach: LiveAudienceReach.WORLDWIDE,
  autoArchiveEnabled: false,
  exposeExactCoordinates: false,
  ephemeralGeohashRetentionMinutes: 15,
};

/**
 * Sanitizes location metadata for a live broadcast session.
 * Strips raw latitude/longitude and retains only coarse regional scope.
 */
export function sanitizeLiveBroadcastLocation(input: {
  reach: LiveAudienceReach;
  latitude?: number;
  longitude?: number;
  cityCode?: string;
  countryIso?: string;
  continentCode?: string;
}): {
  reach: LiveAudienceReach;
  publicScopeLabel: string;
  coordinatesRedacted: true;
} {
  const scopeLabels: Record<LiveAudienceReach, string> = {
    [LiveAudienceReach.RADIUS_15KM]: 'Local Radius (15 km regional zone)',
    [LiveAudienceReach.RADIUS_30KM]: 'Extended Radius (30 km regional zone)',
    [LiveAudienceReach.CITY]: input.cityCode ? `City Zone (${input.cityCode})` : 'City Zone',
    [LiveAudienceReach.COUNTRY]: input.countryIso ? `Country (${input.countryIso})` : 'National Broadcast',
    [LiveAudienceReach.CONTINENT]: input.continentCode
      ? `Continent (${input.continentCode})`
      : 'Continental Broadcast',
    [LiveAudienceReach.WORLDWIDE]: 'Worldwide Broadcast',
  };

  return {
    reach: input.reach,
    publicScopeLabel: scopeLabels[input.reach],
    coordinatesRedacted: true,
  };
}

/**
 * Founding Creator Program Policy Contract (Phase 1A Boundary)
 * - Maximum of 3,000,000 verified eligible existing creators from external platforms.
 * - Do NOT allocate real founding slots during Phase 1A.
 * - Human review is required for ambiguous or high-risk cases.
 */
export const FOUNDING_CREATOR_PROGRAM_RULES = {
  MAX_ELIGIBLE_CREATORS: 3_000_000,
  PHASE_1A_ALLOCATION_ACTIVE: false,
  REQUIRE_EXTERNAL_OWNERSHIP_PROOF: true,
  REQUIRE_GENUINE_ACTIVITY_VERIFICATION: true,
  AI_ROLE: 'ASSISTIVE_SCREENING_ONLY',
  REQUIRE_HUMAN_REVIEW_FOR_AMBIGUOUS_OR_HIGH_RISK: true,
  COMMERCIAL_TERMS_STATUS: 'PENDING_OWNER_APPROVAL',
} as const;

export enum CallType {
  PEER_TO_PEER_FREE = 'PEER_TO_PEER_FREE',
  PREPAID_CREATOR_CALL = 'PREPAID_CREATOR_CALL',
}

export interface CallSessionPolicy {
  readonly callType: CallType;
  readonly platformCallFeeMinorUnits: number;
  readonly networkDataNotice: string;
  readonly requiresPrepaidEscrowAuthorization: boolean;
}

export function getCallSessionPolicy(callType: CallType): CallSessionPolicy {
  if (callType === CallType.PEER_TO_PEER_FREE) {
    return {
      callType,
      platformCallFeeMinorUnits: 0,
      networkDataNotice:
        'Ordinary user-to-user internet calls are free of Face Vid call charges. Standard ISP/mobile network data charges remain the user’s responsibility.',
      requiresPrepaidEscrowAuthorization: false,
    };
  }

  return {
    callType,
    platformCallFeeMinorUnits: -1, // Server-authoritative creator rate configured in Phase 1B+
    networkDataNotice:
      'Prepaid creator call. Rate is server-authoritative and subject to owner-approved commercial terms.',
    requiresPrepaidEscrowAuthorization: true,
  };
}

/**
 * Phase 1 Task 1.3A: Secure Creator Video Upload Lifecycle Enums & Types
 */
export enum UploadSessionStatus {
  INITIATED = 'INITIATED',
  UPLOADING = 'UPLOADING',
  UPLOADED = 'UPLOADED',
  MALWARE_SCANNING = 'MALWARE_SCANNING',
  MEDIA_VALIDATING = 'MEDIA_VALIDATING',
  TRANSCODING = 'TRANSCODING',
  READY_FOR_PUBLICATION = 'READY_FOR_PUBLICATION',
  PUBLISHED = 'PUBLISHED',
  FAILED = 'FAILED',
  EXPIRED = 'EXPIRED',
  ABORTED = 'ABORTED',
}

export enum MalwareScanStatus {
  PENDING = 'PENDING',
  SCANNING = 'SCANNING',
  CLEAN = 'CLEAN',
  INFECTED = 'INFECTED',
  BYPASSED_DEV = 'BYPASSED_DEV',
}

export enum MediaValidationStatus {
  PENDING = 'PENDING',
  VALIDATING = 'VALIDATING',
  VALID = 'VALID',
  INVALID_CONTAINER = 'INVALID_CONTAINER',
  UNSUPPORTED_CODEC = 'UNSUPPORTED_CODEC',
}

export enum TranscodingPipelineStep {
  STAGING_VERIFY = 'STAGING_VERIFY',
  VIRUS_SCAN = 'VIRUS_SCAN',
  CONTAINER_VALIDATE = 'CONTAINER_VALIDATE',
  THUMBNAIL_EXTRACT = 'THUMBNAIL_EXTRACT',
  HLS_DASH_TRANSCODE = 'HLS_DASH_TRANSCODE',
  READY_FINALIZE = 'READY_FINALIZE',
}

export const SECURE_UPLOAD_CONFIG = {
  MAX_FILE_SIZE_BYTES: 10 * 1024 * 1024 * 1024, // 10 GB
  STAGING_BUCKET_NAME: 'face-vid-staging-private',
  SIGNED_URL_EXPIRY_SECONDS: 3600, // 1 hour
  MAX_ACTIVE_SESSIONS_PER_CREATOR: 5,
  MAX_SESSIONS_PER_24H_PER_CREATOR: 50,
  MAX_DAILY_UPLOAD_BYTES_PER_CREATOR: 50 * 1024 * 1024 * 1024, // 50 GB
  ALLOWED_MIME_TYPES: [
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-matroska',
  ] as const,
  ALLOWED_FILE_EXTENSIONS: ['.mp4', '.mov', '.webm', '.mkv'] as const,
  TARGET_RESOLUTIONS: [
    { height: 1080, bitrateKbps: 4500, label: '1080p (FHD)' },
    { height: 720, bitrateKbps: 2500, label: '720p (HD)' },
    { height: 480, bitrateKbps: 1200, label: '480p (SD)' },
    { height: 360, bitrateKbps: 600, label: '360p (Mobile)' },
  ] as const,
};

export interface TranscodingJobRecord {
  jobId: string;
  sessionId: string;
  queueName: string;
  bullmqJobId?: string;
  step: TranscodingPipelineStep;
  progressPercent: number;
  errorMessage?: string | null;
  retryCount: number;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface TranscodeRendition {
  renditionId: string;
  videoId: string;
  resolutionHeight: number;
  bitrateKbps: number;
  codec: string;
  container: string;
  streamUrl: string;
  fileSizeBytes: number;
  createdAtIso: string;
}

export interface CreatorUploadSession {
  sessionId: string;
  creatorId: string;
  channelId: string;
  videoId?: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  sha256Checksum?: string;
  stagingStorageBucket: string;
  stagingObjectPath: string;
  signedUploadUrl: string;
  resumableSessionUri?: string;
  uploadStatus: UploadSessionStatus;
  malwareScanStatus: MalwareScanStatus;
  mediaValidationStatus: MediaValidationStatus;
  transcodingStatus: string;
  visibilityChoice: ContentVisibility;
  title: string;
  description: string;
  categoryId?: string | null;
  videoFormat: VideoFormat;
  tags: readonly string[];
  extractedThumbnailUrl?: string;
  failureReason?: string | null;
  expiresAtIso: string;
  createdAtIso: string;
  updatedAtIso: string;
  idempotencyKey?: string;
  jobs?: readonly TranscodingJobRecord[];
  renditions?: readonly TranscodeRendition[];
}

export interface InitiateUploadSessionRequest {
  channelId: string;
  fileName: string;
  fileSizeBytes: number;
  mimeType: string;
  sha256Checksum?: string;
  title: string;
  description?: string;
  categoryId?: string;
  videoFormat?: VideoFormat;
  visibility?: ContentVisibility;
  tags?: string[];
  idempotencyKey?: string;
}

export interface InitiateUploadSessionResponse {
  ok: true;
  session: CreatorUploadSession;
  signedUploadUrl: string;
  resumableSessionUri: string;
  uploadExpiresAtIso: string;
  stagingStorageBucket: string;
  stagingObjectPath: string;
  instructions: {
    protocol: 'GCS_RESUMABLE_V4';
    method: 'PUT';
    chunkSizeRecommendedBytes: number;
  };
}

/**
 * Real-time event types supported by FACE VID authenticated communication foundation.
 */
export enum RealtimeEventType {
  MESSAGE_RECEIVED = 'MESSAGE_RECEIVED',
  MESSAGE_STATUS = 'MESSAGE_STATUS',
  CALL_INCOMING = 'CALL_INCOMING',
  CALL_ACCEPTED = 'CALL_ACCEPTED',
  CALL_DECLINED = 'CALL_DECLINED',
  CALL_SIGNAL = 'CALL_SIGNAL',
  CALL_ENDED = 'CALL_ENDED',
  PRESENCE_UPDATE = 'PRESENCE_UPDATE',
  SYSTEM_NOTIFICATION = 'SYSTEM_NOTIFICATION',
}

export interface RealtimeEventEnvelope<T = unknown> {
  eventType: RealtimeEventType;
  eventId: string;
  timestampIso: string;
  payload: T;
}

export interface ChatConversationRecord {
  conversationId: string;
  participantUserIds: readonly string[];
  lastMessageText: string;
  lastMessageTimestampIso: string;
  lastMessageSenderUserId: string;
  createdAtIso: string;
  updatedAtIso: string;
}

export interface DirectMessageRecord {
  messageId: string;
  conversationId: string;
  senderUserId: string;
  receiverUserId: string;
  text: string;
  mediaType?: 'text' | 'audio' | 'image';
  mediaUrl?: string;
  status: 'SENT' | 'DELIVERED' | 'READ';
  idempotencyKey?: string;
  createdAtIso: string;
  deliveredAtIso?: string;
  readAtIso?: string;
}

export type WebRtcSignalType =
  | 'SDP_OFFER'
  | 'SDP_ANSWER'
  | 'ICE_CANDIDATE'
  | 'CALL_RING'
  | 'CALL_ACCEPT'
  | 'CALL_DECLINE'
  | 'CALL_END';

export interface CallSignalingPayload {
  callId: string;
  callerUserId: string;
  receiverUserId: string;
  callType: 'VOICE' | 'VIDEO';
  isPrepaid: boolean;
  ratePerMinuteUsd?: number;
  signalType: WebRtcSignalType;
  sdp?: string;
  candidate?: {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
  };
  reason?: string;
  timestampIso: string;
}

export interface PersistedBlockedUserRow {
  blockId: string;
  blockerUserId: string;
  blockedUserId: string;
  reason?: string;
  createdAtIso: string;
}

export interface LiveRadarBlip {
  blipId: string;
  azimuthDeg: number;
  radiusRatio: number;
  isPrivateMode: boolean;
  pseudonymLabel: string;
}



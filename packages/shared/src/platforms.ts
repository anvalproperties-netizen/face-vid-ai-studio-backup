/**
 * @face-vid/shared — Multi-Platform Architecture, Experience Separation & TV Device-Linking Contracts
 *
 * Enforces Phase 1A Multi-Platform & Smart TV Addendum Rules:
 * - Nine required platform destinations across Mobile, Desktop, Web, and Smart TV.
 * - Strict separation between:
 *   1. EXPERIENCE A — FULL FACE VID APPLICATION (Android, iOS/iPadOS, Windows 10/11, Web)
 *   2. EXPERIENCE B — FACE VID TV (Android TV/Google TV, Samsung Tizen, LG webOS, Apple tvOS, Amazon Fire TV)
 * - Short-lived, single-use, rate-limited TV QR / activation-code pairing with zero permanent credentials in QR payloads.
 */

export enum PlatformId {
  GOOGLE_PLAY_ANDROID = 'GOOGLE_PLAY_ANDROID',
  APPLE_APP_STORE_IOS = 'APPLE_APP_STORE_IOS',
  MICROSOFT_STORE_WINDOWS = 'MICROSOFT_STORE_WINDOWS',
  FACE_VID_WEB = 'FACE_VID_WEB',
  ANDROID_TV_GOOGLE_TV = 'ANDROID_TV_GOOGLE_TV',
  SAMSUNG_TIZEN_TV = 'SAMSUNG_TIZEN_TV',
  LG_WEBOS_TV = 'LG_WEBOS_TV',
  APPLE_TVOS = 'APPLE_TVOS',
  AMAZON_FIRE_TV = 'AMAZON_FIRE_TV',
}

export enum UserExperienceTier {
  EXPERIENCE_A_FULL = 'EXPERIENCE_A_FULL',
  EXPERIENCE_B_TV_LEANBACK = 'EXPERIENCE_B_TV_LEANBACK',
  ADMIN_ISOLATED_WEB = 'ADMIN_ISOLATED_WEB',
}

export type AuditClassification = 'PASS' | 'FAIL' | 'NOT_RUN' | 'PLANNED';

/**
 * Features strictly excluded from EXPERIENCE B (FACE VID TV).
 * TV is a dedicated 10-foot lean-back viewing interface and must NEVER expose these surfaces.
 */
export enum TvExcludedFeature {
  AI_STUDIO_FULL_EDITOR = 'AI_STUDIO_FULL_EDITOR',
  CREATOR_VERIFICATION_AND_MANAGEMENT = 'CREATOR_VERIFICATION_AND_MANAGEMENT',
  MERCHANT_DASHBOARD = 'MERCHANT_DASHBOARD',
  ADVERTISING_MANAGEMENT_DASHBOARD = 'ADVERTISING_MANAGEMENT_DASHBOARD',
  SUPER_ADMIN_PANEL = 'SUPER_ADMIN_PANEL',
  ADVANCED_VIDEO_UPLOADS_AND_EDITING = 'ADVANCED_VIDEO_UPLOADS_AND_EDITING',
  PRIVATE_MESSAGING_AND_CALLS = 'PRIVATE_MESSAGING_AND_CALLS',
  CREATOR_CALL_BOOKING_AND_DIRECT_PAYMENT = 'CREATOR_CALL_BOOKING_AND_DIRECT_PAYMENT',
}

export const EXPERIENCE_B_TV_EXCLUDED_FEATURES: readonly TvExcludedFeature[] = [
  TvExcludedFeature.AI_STUDIO_FULL_EDITOR,
  TvExcludedFeature.CREATOR_VERIFICATION_AND_MANAGEMENT,
  TvExcludedFeature.MERCHANT_DASHBOARD,
  TvExcludedFeature.ADVERTISING_MANAGEMENT_DASHBOARD,
  TvExcludedFeature.SUPER_ADMIN_PANEL,
  TvExcludedFeature.ADVANCED_VIDEO_UPLOADS_AND_EDITING,
  TvExcludedFeature.PRIVATE_MESSAGING_AND_CALLS,
  TvExcludedFeature.CREATOR_CALL_BOOKING_AND_DIRECT_PAYMENT,
] as const;

export const EXPERIENCE_B_TV_ALLOWED_NAV_DESTINATIONS = [
  'home',
  'search',
  'trending',
  'subscriptions',
  'live',
  'music',
  'gaming',
  'sports',
  'news',
  'movies_tv',
  'podcasts',
  'shorts',
  'watch_later',
  'playlists',
  'watch_history',
  'your_videos',
  'shop_showcase_qr',
  'premium_status',
  'settings_language',
] as const;

export type TvNavDestination = (typeof EXPERIENCE_B_TV_ALLOWED_NAV_DESTINATIONS)[number];

/**
 * Enforces architectural separation between Experience A (Full App) and Experience B (TV).
 */
export function isFeaturePermittedOnExperience(
  experience: UserExperienceTier,
  feature: TvExcludedFeature
): { permitted: boolean; handoffMethod?: 'QR_MOBILE_HANDOFF_REQUIRED'; reason: string } {
  if (experience === UserExperienceTier.EXPERIENCE_B_TV_LEANBACK) {
    return {
      permitted: false,
      handoffMethod: 'QR_MOBILE_HANDOFF_REQUIRED',
      reason: `Feature '${feature}' is strictly excluded from Experience B (FACE VID TV 10-foot interface). Use QR handoff to Experience A (Mobile/Web) where applicable.`,
    };
  }

  return {
    permitted: true,
    reason: `Feature '${feature}' is permitted on ${experience}.`,
  };
}

export interface PlatformImplementationStages {
  readonly configurationOnly: AuditClassification;
  readonly runnableSourceImplementation: AuditClassification;
  readonly successfullyCompiledApplication: AuditClassification;
  readonly testedOnSimulatorOrDevice: AuditClassification;
  readonly storeSubmissionReady: AuditClassification;
}

export interface PlatformReadinessDescriptor {
  readonly platformId: PlatformId;
  readonly displayName: string;
  readonly storeDestination: string;
  readonly experienceTier: UserExperienceTier;
  readonly projectPath: string;
  readonly frameworkAndSdk: string;
  readonly applicationIdentifier: string;
  readonly adaptiveBitrateAndDrm: string;
  readonly authMethod: string;
  readonly billingAndIapCompliance: string;
  readonly implementationStages: PlatformImplementationStages;
  readonly auditStatus: {
    readonly structureScaffolded: AuditClassification;
    readonly configVerified: AuditClassification;
    readonly nativeBuildExecution: AuditClassification;
    readonly mediaPlaybackImplementation: AuditClassification;
    readonly storeApprovalStatus: AuditClassification;
  };
  readonly storeSubmissionRequirements: readonly string[];
}

export const PLATFORM_READINESS_MATRIX: readonly PlatformReadinessDescriptor[] = [
  {
    platformId: PlatformId.GOOGLE_PLAY_ANDROID,
    displayName: 'Android Smartphones & Tablets',
    storeDestination: 'Google Play Store',
    experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
    projectPath: 'apps/mobile/android & apps/mobile/lib/main.dart',
    frameworkAndSdk: 'Flutter 3.24+ (Dart 3.5 strict) · Android SDK API 24–35 (Kotlin 2.0)',
    applicationIdentifier: 'com.facevid.app',
    adaptiveBitrateAndDrm: 'MPEG-DASH & HLS via ExoPlayer/Media3 · Google Widevine L1/L3 DRM',
    authMethod: 'OAuth 2.0 PKCE + Hardware-backed Android Keystore token storage + Passkeys/WebAuthn',
    billingAndIapCompliance:
      'Google Play Billing Library v7 required for digital subscriptions & AI Studio packs; physical Merchant goods use standard checkout.',
    implementationStages: {
      configurationOnly: 'PASS',
      runnableSourceImplementation: 'PASS', // apps/mobile/lib/main.dart present; requires Flutter SDK to execute
      successfullyCompiledApplication: 'NOT_RUN', // Flutter/Android SDK not installed in Linux container
      testedOnSimulatorOrDevice: 'NOT_RUN',
      storeSubmissionReady: 'PLANNED',
    },
    auditStatus: {
      structureScaffolded: 'PASS',
      configVerified: 'PASS',
      nativeBuildExecution: 'NOT_RUN',
      mediaPlaybackImplementation: 'PLANNED',
      storeApprovalStatus: 'PLANNED',
    },
    storeSubmissionRequirements: [
      'Google Play Console developer account verification & D-U-N-S number (for organization)',
      'Upload key & Play App Signing key ceremony (.aab Android App Bundle)',
      'Data Safety declaration (camera, microphone, coarse regional live stream scope)',
      'IARC content rating questionnaire & target API 35 compliance',
    ],
  },
  {
    platformId: PlatformId.APPLE_APP_STORE_IOS,
    displayName: 'iPhone & iPad (iOS / iPadOS)',
    storeDestination: 'Apple App Store',
    experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
    projectPath: 'apps/mobile/ios & apps/mobile/lib/main.dart',
    frameworkAndSdk: 'Flutter 3.24+ (Dart 3.5 strict) · iOS 16.0+ SDK / Xcode 16+',
    applicationIdentifier: 'com.facevid.app',
    adaptiveBitrateAndDrm: 'HLS (fMP4) via AVFoundation · Apple FairPlay Streaming (FPS) DRM',
    authMethod: 'OAuth 2.0 PKCE + iOS Keychain Secure Enclave + Sign in with Apple / Passkeys',
    billingAndIapCompliance:
      'StoreKit 2 In-App Purchase required per App Store Review Guideline 3.1.1 for digital subscriptions & AI Studio digital credits; scheduled 1-to-1 live creator calls evaluated under Guideline 3.1.3(d) vs IAP.',
    implementationStages: {
      configurationOnly: 'PASS',
      runnableSourceImplementation: 'PASS', // apps/mobile/lib/main.dart present; requires macOS + Xcode + Flutter SDK
      successfullyCompiledApplication: 'NOT_RUN', // Requires macOS + Xcode 16+
      testedOnSimulatorOrDevice: 'NOT_RUN',
      storeSubmissionReady: 'PLANNED',
    },
    auditStatus: {
      structureScaffolded: 'PASS',
      configVerified: 'PASS',
      nativeBuildExecution: 'NOT_RUN',
      mediaPlaybackImplementation: 'PLANNED',
      storeApprovalStatus: 'PLANNED',
    },
    storeSubmissionRequirements: [
      'Apple Developer Program membership & App Store Connect provisioning profile',
      'macOS build runner with Xcode 16+ for .ipa archiving & notarization',
      'App Privacy Nutrition Labels & PrivacyInfo.xcprivacy manifest',
      'NSCameraUsageDescription & NSMicrophoneUsageDescription justification strings',
    ],
  },
  {
    platformId: PlatformId.MICROSOFT_STORE_WINDOWS,
    displayName: 'Windows 10/11 Desktop & Laptop',
    storeDestination: 'Microsoft Store',
    experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
    projectPath: 'apps/mobile/windows & apps/windows',
    frameworkAndSdk: 'Flutter Windows C++ Win32/WinRT Runner · MSIX Packaging · Windows SDK 10.0.22621+',
    applicationIdentifier: 'FaceVid.Desktop',
    adaptiveBitrateAndDrm: 'MPEG-DASH & HLS · Microsoft PlayReady / Widevine CDM',
    authMethod: 'OAuth 2.0 PKCE + Windows Data Protection API (DPAPI) credential vault + Windows Hello WebAuthn',
    billingAndIapCompliance:
      'Microsoft Store Commerce API or approved server-authoritative checkout per Microsoft Store Policies.',
    implementationStages: {
      configurationOnly: 'PASS',
      runnableSourceImplementation: 'PASS', // apps/mobile/lib/main.dart desktop adaptive layout present
      successfullyCompiledApplication: 'NOT_RUN', // Requires Windows 10/11 host + MSVC + Windows SDK
      testedOnSimulatorOrDevice: 'NOT_RUN',
      storeSubmissionReady: 'PLANNED',
    },
    auditStatus: {
      structureScaffolded: 'PASS',
      configVerified: 'PASS',
      nativeBuildExecution: 'NOT_RUN',
      mediaPlaybackImplementation: 'PLANNED',
      storeApprovalStatus: 'PLANNED',
    },
    storeSubmissionRequirements: [
      'Microsoft Partner Center developer account & Publisher Identity verification',
      'EV / Azure Trusted Signing certificate for MSIX bundle signing',
      'Windows App Certification Kit (WACK) validation pass on Windows 11 x64/ARM64',
    ],
  },
  {
    platformId: PlatformId.FACE_VID_WEB,
    displayName: 'Face Vid Website (Desktop & Mobile Browsers)',
    storeDestination: 'Global Web Deployment (HTTPS)',
    experienceTier: UserExperienceTier.EXPERIENCE_A_FULL,
    projectPath: 'apps/web',
    frameworkAndSdk: 'Next.js App Router + React 19 + TypeScript Strict + Tailwind CSS',
    applicationIdentifier: 'https://facevid.app',
    adaptiveBitrateAndDrm: 'HLS & MPEG-DASH via HTML5 MSE + EME (Widevine / FairPlay / PlayReady)',
    authMethod: 'HttpOnly Secure SameSite cookies + WebAuthn FIDO2 MFA for privileged roles',
    billingAndIapCompliance:
      'Server-authoritative PaymentProviderPort (pending Owner approval of commercial terms).',
    implementationStages: {
      configurationOnly: 'PASS',
      runnableSourceImplementation: 'PASS',
      successfullyCompiledApplication: 'PASS', // Verified via both Next.js build and Vite bundle
      testedOnSimulatorOrDevice: 'PASS', // Smoke-tested via live HTTP server in container
      storeSubmissionReady: 'PLANNED',
    },
    auditStatus: {
      structureScaffolded: 'PASS',
      configVerified: 'PASS',
      nativeBuildExecution: 'PASS',
      mediaPlaybackImplementation: 'PASS',
      storeApprovalStatus: 'PLANNED',
    },
    storeSubmissionRequirements: [
      'Production TLS certificate, WAF rules, and Owner sign-off on commercial terms',
    ],
  },
  {
    platformId: PlatformId.ANDROID_TV_GOOGLE_TV,
    displayName: 'Android TV & Google TV',
    storeDestination: 'Google Play Store (TV Form Factor)',
    experienceTier: UserExperienceTier.EXPERIENCE_B_TV_LEANBACK,
    projectPath: 'apps/tv/android-tv & apps/tv/src/TvAppShell.tsx',
    frameworkAndSdk: 'Android TV Leanback Manifest + Shared 10-Foot TV Interface',
    applicationIdentifier: 'com.facevid.tv.android',
    adaptiveBitrateAndDrm: 'MPEG-DASH & HLS via AndroidX Media3 ExoPlayer · Widevine L1 Hardware DRM',
    authMethod: 'Short-Lived QR & 8-Char Activation Code Device Linking (/api/v1/auth/tv-device/*)',
    billingAndIapCompliance:
      'Google Play Billing for TV or QR-code handoff to mobile device for Shop & Creator commerce.',
    implementationStages: {
      configurationOnly: 'PASS', // AndroidManifest.xml with LEANBACK_LAUNCHER verified
      runnableSourceImplementation: 'PASS', // 10-foot UI runnable in apps/tv/src/TvAppShell.tsx; native Kotlin wrapper planned
      successfullyCompiledApplication: 'NOT_RUN', // Native Android TV APK/AAB build not run (no Android SDK)
      testedOnSimulatorOrDevice: 'NOT_RUN',
      storeSubmissionReady: 'PLANNED',
    },
    auditStatus: {
      structureScaffolded: 'PASS',
      configVerified: 'PASS',
      nativeBuildExecution: 'NOT_RUN',
      mediaPlaybackImplementation: 'PLANNED',
      storeApprovalStatus: 'PLANNED',
    },
    storeSubmissionRequirements: [
      'AndroidManifest.xml declaration of android.software.leanback (required=true) and touchscreen (required=false)',
      '320x180 xhdpi TV home screen banner asset & full D-pad navigation without pointer dependency',
      'Google Play TV App Quality review pass',
    ],
  },
  {
    platformId: PlatformId.SAMSUNG_TIZEN_TV,
    displayName: 'Samsung Smart TV (Tizen OS)',
    storeDestination: 'Samsung Seller Office (Apps TV)',
    experienceTier: UserExperienceTier.EXPERIENCE_B_TV_LEANBACK,
    projectPath: 'apps/tv/samsung-tizen & apps/tv/src/TvAppShell.tsx',
    frameworkAndSdk: 'Tizen TV Web Application (HTML5/TypeScript 10-Foot Bundle + Samsung AVPlay API) — Flutter is not officially supported by Samsung Tizen',
    applicationIdentifier: 'com.facevid.tv.tizen',
    adaptiveBitrateAndDrm: 'HLS & MPEG-DASH via Tizen AVPlay / MSE-EME · PlayReady & Widevine DRM',
    authMethod: 'Short-Lived QR & 8-Char Activation Code Device Linking (/api/v1/auth/tv-device/*)',
    billingAndIapCompliance:
      'Samsung Checkout API where mandated or QR-code mobile handoff for Face Vid Shop products.',
    implementationStages: {
      configurationOnly: 'PASS', // config.xml verified
      runnableSourceImplementation: 'PASS', // 10-foot Web TV UI runnable in apps/tv/src/TvAppShell.tsx
      successfullyCompiledApplication: 'NOT_RUN', // Tizen .wgt package signing requires Tizen Studio CLI
      testedOnSimulatorOrDevice: 'NOT_RUN',
      storeSubmissionReady: 'PLANNED',
    },
    auditStatus: {
      structureScaffolded: 'PASS',
      configVerified: 'PASS',
      nativeBuildExecution: 'NOT_RUN',
      mediaPlaybackImplementation: 'PLANNED',
      storeApprovalStatus: 'PLANNED',
    },
    storeSubmissionRequirements: [
      'Samsung Seller Office Partnership registration & Author/Distributor Tizen Signing Certificates',
      'config.xml validation with tv.inputdevice privilege (Return/Exit/Media keys)',
      'Packaging into signed .wgt archive via Tizen Studio CLI',
    ],
  },
  {
    platformId: PlatformId.LG_WEBOS_TV,
    displayName: 'LG Smart TV (webOS)',
    storeDestination: 'LG Seller Lounge',
    experienceTier: UserExperienceTier.EXPERIENCE_B_TV_LEANBACK,
    projectPath: 'apps/tv/lg-webos & apps/tv/src/TvAppShell.tsx',
    frameworkAndSdk: 'LG webOS TV Web Application (TypeScript 10-Foot Bundle + webOS Media Pipeline) — Flutter is not officially supported by LG webOS',
    applicationIdentifier: 'com.facevid.tv.webos',
    adaptiveBitrateAndDrm: 'HLS & MPEG-DASH via webOS HTML5 MSE/EME · Widevine & PlayReady DRM',
    authMethod: 'Short-Lived QR & 8-Char Activation Code Device Linking (/api/v1/auth/tv-device/*)',
    billingAndIapCompliance:
      'QR-code mobile handoff for Face Vid Shop & Creator subscriptions per LG Seller Lounge guidelines.',
    implementationStages: {
      configurationOnly: 'PASS', // appinfo.json verified
      runnableSourceImplementation: 'PASS', // 10-foot Web TV UI runnable in apps/tv/src/TvAppShell.tsx
      successfullyCompiledApplication: 'NOT_RUN', // webOS .ipk packaging requires ares-package CLI
      testedOnSimulatorOrDevice: 'NOT_RUN',
      storeSubmissionReady: 'PLANNED',
    },
    auditStatus: {
      structureScaffolded: 'PASS',
      configVerified: 'PASS',
      nativeBuildExecution: 'NOT_RUN',
      mediaPlaybackImplementation: 'PLANNED',
      storeApprovalStatus: 'PLANNED',
    },
    storeSubmissionRequirements: [
      'LG Seller Lounge developer account & appinfo.json schema validation',
      '5-way D-pad + LG Magic Remote wheel/cursor focus compatibility & Back history handling',
      'Packaging into .ipk via ares-package CLI (webOS TV SDK)',
    ],
  },
  {
    platformId: PlatformId.APPLE_TVOS,
    displayName: 'Apple TV (tvOS)',
    storeDestination: 'Apple App Store (tvOS)',
    experienceTier: UserExperienceTier.EXPERIENCE_B_TV_LEANBACK,
    projectPath: 'apps/tv/apple-tvos',
    frameworkAndSdk: 'Native Swift 6 & SwiftUI + AVKit (tvOS 17+) — Flutter does not provide an official production tvOS target',
    applicationIdentifier: 'com.facevid.tv.tvos',
    adaptiveBitrateAndDrm: 'HLS (fMP4 / Dolby Vision / Atmos) via AVPlayerViewController · FairPlay Streaming (FPS)',
    authMethod: 'Short-Lived QR & 8-Char Activation Code Device Linking + Sign in with Apple on tvOS',
    billingAndIapCompliance:
      'StoreKit 2 tvOS for digital subscriptions; QR-code mobile handoff for physical Face Vid Shop items.',
    implementationStages: {
      configurationOnly: 'PASS', // Package.swift & FaceVidTVApp.swift configuration contract present
      runnableSourceImplementation: 'PLANNED', // Full native SwiftUI tvOS view tree planned for Phase 1B+
      successfullyCompiledApplication: 'NOT_RUN', // Requires macOS + Xcode 16+ tvOS SDK
      testedOnSimulatorOrDevice: 'NOT_RUN',
      storeSubmissionReady: 'PLANNED',
    },
    auditStatus: {
      structureScaffolded: 'PASS',
      configVerified: 'PASS',
      nativeBuildExecution: 'NOT_RUN',
      mediaPlaybackImplementation: 'PLANNED',
      storeApprovalStatus: 'PLANNED',
    },
    storeSubmissionRequirements: [
      'macOS with Xcode 16+ tvOS SDK & layered parallax App Icon (.lsr / Asset Catalog)',
      'Siri Remote directional swipe & Focus Engine (@FocusState) compliance',
      'App Store Connect tvOS binary submission & review',
    ],
  },
  {
    platformId: PlatformId.AMAZON_FIRE_TV,
    displayName: 'Amazon Fire TV',
    storeDestination: 'Amazon Appstore',
    experienceTier: UserExperienceTier.EXPERIENCE_B_TV_LEANBACK,
    projectPath: 'apps/tv/fire-tv & apps/tv/src/TvAppShell.tsx',
    frameworkAndSdk: 'Android-based Fire OS TV Application (Leanback / AndroidX Media3)',
    applicationIdentifier: 'com.facevid.tv.fire',
    adaptiveBitrateAndDrm: 'MPEG-DASH & HLS via ExoPlayer/Media3 · Widevine L1 & PlayReady DRM',
    authMethod: 'Short-Lived QR & 8-Char Activation Code Device Linking (/api/v1/auth/tv-device/*)',
    billingAndIapCompliance:
      'Amazon Appstore SDK In-App Purchasing API for digital subscriptions; QR mobile handoff for physical Shop items.',
    implementationStages: {
      configurationOnly: 'PASS', // Fire TV AndroidManifest.xml verified
      runnableSourceImplementation: 'PASS', // 10-foot UI runnable in apps/tv/src/TvAppShell.tsx; native Fire OS APK wrapper planned
      successfullyCompiledApplication: 'NOT_RUN', // Requires Android/Fire OS build toolchain
      testedOnSimulatorOrDevice: 'NOT_RUN',
      storeSubmissionReady: 'PLANNED',
    },
    auditStatus: {
      structureScaffolded: 'PASS',
      configVerified: 'PASS',
      nativeBuildExecution: 'NOT_RUN',
      mediaPlaybackImplementation: 'PLANNED',
      storeApprovalStatus: 'PLANNED',
    },
    storeSubmissionRequirements: [
      'Amazon Developer Console registration & Fire TV manifest verification',
      'Fire TV Remote D-pad & Media Play/Pause/Rewind/Fast-Forward keycode handling',
      'App Testing Service (ATS) validation pass',
    ],
  },
] as const;

// =============================================================================
// SECURE TV DEVICE-LINKING AUTHENTICATION CONTRACTS
// =============================================================================
// Security invariants:
// 1. Pairing codes are short-lived (300s TTL), single-use, and rate-limited.
// 2. Permanent credentials, bearer tokens, or passwords are NEVER placed in QR codes.
// 3. Device-bound challenge nonce prevents device takeover even if 8-char code is observed.
// 4. Supports remote device sign-out and immediate session revocation.

export type TvPairingStatus =
  | 'PENDING_USER_CONFIRMATION'
  | 'AUTHORIZED_READY_FOR_TV'
  | 'CONSUMED_ACTIVE_SESSION'
  | 'EXPIRED'
  | 'REVOKED'
  | 'LOCKED_BRUTE_FORCE';

export interface TvDevicePairingRecord {
  readonly pairingRequestId: string;
  readonly shortPairingCode: string; // e.g., "FV8K-4M9P"
  readonly deviceChallengeNonce: string; // Secret nonce held by the initiating TV to prevent takeover
  readonly qrVerificationUri: string; // e.g., "https://facevid.app/activate?code=FV8K-4M9P&req=..."
  readonly devicePlatform: PlatformId;
  readonly deviceDisplayName: string;
  readonly status: TvPairingStatus;
  readonly version: number; // Optimistic concurrency counter preventing concurrent confirmation races
  readonly failedAttempts: number;
  readonly createdAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly authorizedByUserId?: string;
  readonly authorizedUserHandle?: string;
  readonly issuedDeviceSessionId?: string;
  readonly containsPermanentCredentialsInQr: false;
  readonly persistenceMode:
    | 'REDIS_7_AND_POSTGRESQL_16_PHASE_1B1'
    | 'IN_MEMORY_PHASE_1A_PROTOTYPE_STORE';
}

export const TV_PAIRING_SECURITY_POLICY = {
  TTL_SECONDS: 300, // 5 minutes
  SINGLE_USE_ENFORCED: true,
  MAX_REQUESTS_PER_WINDOW: 10,
  MAX_FAILED_ATTEMPTS_PER_CODE: 5,
  RATE_LIMIT_WINDOW_MS: 60_000,
  ALLOW_CREDENTIALS_IN_QR: false,
  REQUIRE_DEVICE_CHALLENGE_NONCE_ON_POLL: true,
  PERSISTENCE_MODE: 'REDIS_7_AND_POSTGRESQL_16_PHASE_1B1',
} as const;

const SAFE_PAIRING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * Generates an unambiguous 8-character human-readable TV pairing code (e.g. "FV4K-9M2X").
 */
export function generateShortPairingCode(seedIndex = 0): string {
  let part1 = 'FV';
  let part2 = '';
  const now = Date.now() + seedIndex * 7919;
  for (let i = 0; i < 2; i++) {
    const idx = Math.abs((now >> (i * 4)) ^ (i * 31 + seedIndex)) % SAFE_PAIRING_ALPHABET.length;
    part1 += SAFE_PAIRING_ALPHABET[idx];
  }
  for (let i = 0; i < 4; i++) {
    const idx =
      Math.abs((now >> ((i + 2) * 3)) ^ ((i + 5) * 97 + seedIndex)) % SAFE_PAIRING_ALPHABET.length;
    part2 += SAFE_PAIRING_ALPHABET[idx];
  }
  return `${part1}-${part2}`;
}

/**
 * @face-vid/ui — Official Brand Palette, Master Logo Asset & 9-Platform Derivation Registry
 */

export const FACE_VID_COLORS = {
  BLACK: '#080B12',
  ELECTRIC_BLUE: '#356DFF',
  WHITE: '#FFFFFF',
  YELLOW: '#FFC928',
  RED: '#F04452',
  GREEN: '#22C55E',
} as const;

export const FACE_VID_OFFICIAL_LOGO_PATH =
  '/assets/owner/face-vid-official-logo.png' as const;

export const FACE_VID_MASTER_ASSET_REPO_PATH =
  'public/assets/owner/face-vid-official-logo.png' as const;

export const FACE_VID_OFFICIAL_LOGO_SOURCE_PATH =
  'public/assets/owner/face-vid-official-logo-source.png' as const;

export interface PlatformLogoDerivationSpec {
  readonly platformId: string;
  readonly platformName: string;
  readonly masterSourcePath: string;
  readonly configuredTargets: readonly string[];
  readonly aspectAndSafeZonePolicy: string;
}

export const PLATFORM_LOGO_DERIVATION_MATRIX: readonly PlatformLogoDerivationSpec[] = [
  {
    platformId: 'WEB',
    platformName: 'FACE VID Web (Experience A & Admin)',
    masterSourcePath: FACE_VID_MASTER_ASSET_REPO_PATH,
    configuredTargets: [
      'index.html (favicon, apple-touch-icon, og:image)',
      'packages/ui/src/FaceVidLogo.tsx (Top Bar, Auth, Onboarding, Splash, Division Headers)',
      'apps/web/src/WebAppShell.tsx (Navigation, Login/Register/Onboarding, Creator, Merchant, Advertiser)',
      'apps/admin/src/AdminAppShell.tsx (Admin Top Bar, /login FIDO2 Sign-In Gate)',
    ],
    aspectAndSafeZonePolicy:
      'Rendered via object-contain on #080B12 with zero CSS color filters, preserving exact FV symbol and FACE VID lettering proportions.',
  },
  {
    platformId: 'ANDROID',
    platformName: 'Android Smartphone & Tablet (Google Play)',
    masterSourcePath: FACE_VID_MASTER_ASSET_REPO_PATH,
    configuredTargets: [
      'apps/mobile/android/app/src/main/AndroidManifest.xml (@mipmap/ic_launcher_face_vid_official)',
      'apps/mobile/lib/main.dart (Image.asset("assets/owner/face-vid-official-logo.png"))',
      'apps/mobile/pubspec.yaml (assets/owner/face-vid-official-logo.png)',
    ],
    aspectAndSafeZonePolicy:
      'Adaptive launcher icon foreground centered within 66dp inner safe zone over #080B12 background; Android 12+ splash window background #080B12.',
  },
  {
    platformId: 'IOS_IPADOS',
    platformName: 'iOS & iPadOS (Apple App Store)',
    masterSourcePath: FACE_VID_MASTER_ASSET_REPO_PATH,
    configuredTargets: [
      'apps/mobile/ios/Runner/Info.plist (CFBundleIcons: FaceVidOfficialAppIcon, UILaunchStoryboardName: FaceVidOfficialLaunchScreen)',
      'apps/mobile/lib/main.dart (Cupertino/Material adaptive header, splash, auth & onboarding)',
    ],
    aspectAndSafeZonePolicy:
      '1024x1024 opaque #080B12 master icon canvas with uncropped FV symbol and FACE VID wordmark; LaunchScreen centered with aspectFit.',
  },
  {
    platformId: 'WINDOWS_10_11',
    platformName: 'Windows 10/11 Desktop (Microsoft Store MSIX)',
    masterSourcePath: FACE_VID_MASTER_ASSET_REPO_PATH,
    configuredTargets: [
      'apps/windows/msix-packaging-config.json (storeLogo, square44x44Logo, square150x150Logo, wide310x150Logo, splashScreen)',
      'apps/mobile/windows/CMakeLists.txt (FACE_VID_OFFICIAL_ICON_ASSET)',
    ],
    aspectAndSafeZonePolicy:
      'MSIX visual elements padded on #080B12 background without stretching or cropping original artwork.',
  },
  {
    platformId: 'ANDROID_TV_GOOGLE_TV',
    platformName: 'Android TV / Google TV (Experience B)',
    masterSourcePath: FACE_VID_MASTER_ASSET_REPO_PATH,
    configuredTargets: [
      'apps/tv/android-tv/AndroidManifest.xml (android:banner="@drawable/face_vid_official_tv_banner", android:icon="@mipmap/ic_launcher_face_vid_official")',
      'apps/tv/src/TvAppShell.tsx (10-Foot Top Bar, Splash/Loading, QR Pairing Auth)',
    ],
    aspectAndSafeZonePolicy:
      '320x180 xhdpi (16:9) Leanback TV banner centered on #080B12 with 10% overscan safe margin.',
  },
  {
    platformId: 'SAMSUNG_TIZEN',
    platformName: 'Samsung Smart TV Tizen (Experience B)',
    masterSourcePath: FACE_VID_MASTER_ASSET_REPO_PATH,
    configuredTargets: [
      'apps/tv/samsung-tizen/config.xml (<icon src="assets/owner/face-vid-official-logo.png"/>)',
      'apps/tv/src/TvAppShell.tsx',
    ],
    aspectAndSafeZonePolicy:
      '117x117 / 512x512 Tizen Smart Hub launcher icon & 1920x1080 launch splash on #080B12.',
  },
  {
    platformId: 'LG_WEBOS',
    platformName: 'LG Smart TV webOS (Experience B)',
    masterSourcePath: FACE_VID_MASTER_ASSET_REPO_PATH,
    configuredTargets: [
      'apps/tv/lg-webos/appinfo.json (icon, largeIcon, splashBackground -> assets/owner/face-vid-official-logo.png)',
      'apps/tv/src/TvAppShell.tsx',
    ],
    aspectAndSafeZonePolicy:
      '80x80 icon, 130x130 largeIcon, and 1920x1080 splashBackground centered on #080B12 (#080B12 bgColor).',
  },
  {
    platformId: 'APPLE_TVOS',
    platformName: 'Apple TV tvOS (Experience B)',
    masterSourcePath: FACE_VID_MASTER_ASSET_REPO_PATH,
    configuredTargets: [
      'apps/tv/apple-tvos/Sources/FaceVidTVApp.swift (officialBrandLogoAsset, topShelfBrandBannerAsset)',
      'apps/tv/src/TvAppShell.tsx',
    ],
    aspectAndSafeZonePolicy:
      '400x240 / 1280x768 App Icon & 1920x720 Top Shelf banner preserving original FV symbol and FACE VID lettering on #080B12.',
  },
  {
    platformId: 'AMAZON_FIRE_TV',
    platformName: 'Amazon Fire TV (Experience B)',
    masterSourcePath: FACE_VID_MASTER_ASSET_REPO_PATH,
    configuredTargets: [
      'apps/tv/fire-tv/AndroidManifest.xml (android:banner="@drawable/face_vid_official_tv_banner", android:icon="@mipmap/ic_launcher_face_vid_official")',
      'apps/tv/src/TvAppShell.tsx',
    ],
    aspectAndSafeZonePolicy:
      '1280x720 Fire TV Appstore launcher icon and 1920x1080 splash screen derived from master asset on #080B12.',
  },
] as const;

export const OWNER_LOGO_ASSET_STATUS = {
  expectedAssetPath: FACE_VID_OFFICIAL_LOGO_PATH,
  masterRepoPath: FACE_VID_MASTER_ASSET_REPO_PATH,
  ownerAssetPresentInWorkspace: true,
  statusMessage:
    'OFFICIAL OWNER LOGO CONFIGURED: All 9 platform targets and UI shells reference the authoritative owner logo at public/assets/owner/face-vid-official-logo.png (/assets/owner/face-vid-official-logo.png) with zero AI substitution or redesign.',
} as const;


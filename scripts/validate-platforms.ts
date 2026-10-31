/**
 * FACE VID — Phase 1A Multi-Platform & Smart TV Configuration Validator
 *
 * Verifies project structure, manifests, permissions, and security flags across:
 * 1. Android (apps/mobile/android)
 * 2. iOS / iPadOS (apps/mobile/ios)
 * 3. Windows 10/11 Desktop & MSIX (apps/mobile/windows & apps/windows)
 * 4. Web (apps/web)
 * 5. Android TV / Google TV (apps/tv/android-tv)
 * 6. Samsung Smart TV Tizen (apps/tv/samsung-tizen)
 * 7. LG Smart TV webOS (apps/tv/lg-webos)
 * 8. Apple TV tvOS (apps/tv/apple-tvos)
 * 9. Amazon Fire TV (apps/tv/fire-tv)
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

function readRequiredFile(relPath: string): string {
  const full = path.resolve(process.cwd(), relPath);
  assert.equal(fs.existsSync(full), true, `Required platform file missing: ${relPath}`);
  return fs.readFileSync(full, 'utf8');
}

function main() {
  // 1. Flutter Shared Mobile & Windows Project
  const pubspec = readRequiredFile('apps/mobile/pubspec.yaml');
  assert.equal(pubspec.includes('name: face_vid_mobile'), true);

  const analysis = readRequiredFile('apps/mobile/analysis_options.yaml');
  assert.equal(analysis.includes('strict-casts: true'), true);

  const mainDart = readRequiredFile('apps/mobile/lib/main.dart');
  assert.equal(mainDart.includes('0xFF080B12'), true);
  assert.equal(mainDart.includes('0xFF356DFF'), true);

  // 2. Android Smartphone/Tablet Manifest
  const androidManifest = readRequiredFile(
    'apps/mobile/android/app/src/main/AndroidManifest.xml'
  );
  assert.equal(androidManifest.includes('package="com.facevid.app"'), true);
  assert.equal(androidManifest.includes('android.permission.CAMERA'), true);
  assert.equal(androidManifest.includes('android.permission.RECORD_AUDIO'), true);
  assert.equal(androidManifest.includes('android:usesCleartextTraffic="false"'), true);

  // 3. iOS / iPadOS Info.plist
  const iosPlist = readRequiredFile('apps/mobile/ios/Runner/Info.plist');
  assert.equal(iosPlist.includes('com.facevid.app'), true);
  assert.equal(iosPlist.includes('NSCameraUsageDescription'), true);
  assert.equal(iosPlist.includes('NSMicrophoneUsageDescription'), true);

  // 4. Windows Desktop & Microsoft Store MSIX Config
  const winCmake = readRequiredFile('apps/mobile/windows/CMakeLists.txt');
  assert.equal(winCmake.includes('com.facevid.desktop'), true);
  const msixConfig = JSON.parse(readRequiredFile('apps/windows/msix-packaging-config.json')) as {
    identityName: string;
    storeApprovalStatus: string;
  };
  assert.equal(msixConfig.identityName, 'FaceVid.Desktop');
  assert.equal(msixConfig.storeApprovalStatus, 'PLANNED_NOT_SUBMITTED');

  // 5. Smart TV Platforms (Experience B)
  const androidTvManifest = readRequiredFile('apps/tv/android-tv/AndroidManifest.xml');
  assert.equal(androidTvManifest.includes('android.software.leanback'), true);
  assert.equal(androidTvManifest.includes('android.intent.category.LEANBACK_LAUNCHER'), true);

  const tizenConfig = readRequiredFile('apps/tv/samsung-tizen/config.xml');
  assert.equal(tizenConfig.includes('http://tizen.org/privilege/tv.inputdevice'), true);

  const webosAppInfo = JSON.parse(readRequiredFile('apps/tv/lg-webos/appinfo.json')) as {
    id: string;
    resolution: string;
  };
  assert.equal(webosAppInfo.id, 'com.facevid.tv.webos');
  assert.equal(webosAppInfo.resolution, '1920x1080');

  const tvosSwift = readRequiredFile('apps/tv/apple-tvos/Sources/FaceVidTVApp.swift');
  assert.equal(tvosSwift.includes('com.facevid.tv.tvos'), true);
  assert.equal(tvosSwift.includes('EXPERIENCE_B_TV_LEANBACK'), true);

  const fireTvManifest = readRequiredFile('apps/tv/fire-tv/AndroidManifest.xml');
  assert.equal(fireTvManifest.includes('package="com.facevid.tv.fire"'), true);
  assert.equal(fireTvManifest.includes('android.software.leanback'), true);

  // 6. Official Owner Logo Restoration Verification across all 9 platforms
  assert.equal(
    pubspec.includes('assets/owner/face-vid-official-logo.png'),
    true,
    'Flutter pubspec must reference assets/owner/face-vid-official-logo.png'
  );
  assert.equal(
    mainDart.includes('assets/owner/face-vid-official-logo.png'),
    true,
    'Flutter main.dart must reference assets/owner/face-vid-official-logo.png'
  );
  assert.equal(
    androidManifest.includes('assets/owner/face-vid-official-logo.png'),
    true,
    'Android manifest must reference assets/owner/face-vid-official-logo.png'
  );
  assert.equal(
    iosPlist.includes('assets/owner/face-vid-official-logo.png'),
    true,
    'iOS Info.plist must reference assets/owner/face-vid-official-logo.png'
  );
  assert.equal(
    winCmake.includes('public/assets/owner/face-vid-official-logo.png'),
    true,
    'Windows CMakeLists.txt must reference public/assets/owner/face-vid-official-logo.png'
  );
  assert.equal(
    androidTvManifest.includes('tv_banner_placeholder'),
    false,
    'Android TV manifest must not contain tv_banner_placeholder'
  );
  assert.equal(
    androidTvManifest.includes('assets/owner/face-vid-official-logo.png'),
    true,
    'Android TV manifest must reference assets/owner/face-vid-official-logo.png'
  );
  assert.equal(
    tizenConfig.includes('assets/owner/face-vid-official-logo.png'),
    true,
    'Samsung Tizen config.xml must reference assets/owner/face-vid-official-logo.png'
  );
  const webosRaw = readRequiredFile('apps/tv/lg-webos/appinfo.json');
  assert.equal(
    webosRaw.includes('placeholder'),
    false,
    'LG webOS appinfo.json must not contain placeholder icon filenames'
  );
  assert.equal(
    webosRaw.includes('assets/owner/face-vid-official-logo.png'),
    true,
    'LG webOS appinfo.json must reference assets/owner/face-vid-official-logo.png'
  );
  assert.equal(
    tvosSwift.includes('assets/owner/face-vid-official-logo.png'),
    true,
    'Apple tvOS Swift entry point must reference assets/owner/face-vid-official-logo.png'
  );
  assert.equal(
    fireTvManifest.includes('assets/owner/face-vid-official-logo.png'),
    true,
    'Amazon Fire TV manifest must reference assets/owner/face-vid-official-logo.png'
  );
  const indexHtml = readRequiredFile('index.html');
  assert.equal(
    indexHtml.includes('/assets/owner/face-vid-official-logo.png'),
    true,
    'Web index.html must reference /assets/owner/face-vid-official-logo.png'
  );
  const logoComponent = readRequiredFile('packages/ui/src/FaceVidLogo.tsx');
  assert.equal(
    logoComponent.includes('LOGO ASSET PLACEHOLDER'),
    false,
    'FaceVidLogo.tsx must not render fake LOGO ASSET PLACEHOLDER box'
  );

  console.log(
    '[PLATFORM VALIDATION PASS] Verified all 9 platform configurations and Official Owner Logo bindings (Android, iOS/iPadOS, Windows 10/11, Web, Android TV/Google TV, Samsung Tizen, LG webOS, Apple tvOS, Amazon Fire TV).'
  );
}

main();

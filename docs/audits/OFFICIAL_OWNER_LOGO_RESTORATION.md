# FACE VID — OFFICIAL OWNER LOGO RESTORATION AUDIT

## 1. AUTHORITATIVE BRAND ASSET POLICY

- **Master Asset Repository Path**: `public/assets/owner/face-vid-official-logo.png`
- **Public Runtime URL Path**: `/assets/owner/face-vid-official-logo.png`
- **Mobile/Desktop Bundle Asset Path**: `assets/owner/face-vid-official-logo.png`
- **Strict Non-Modification Guarantee**:
  - Zero AI-generated replacements, SVG recreations, recoloring, or CSS filter distortions.
  - Preserves exact proportions (`object-contain` / `BoxFit.contain`), colors (`#FFFFFF` FV symbol and FACE VID wordmark outlined in `#356DFF` on `#080B12`), FV symbol, and FACE VID lettering.

---

## 2. PLACEHOLDERS & FAKE LOGOS REMOVED ACROSS MONOREPO

| File Path | Removed Placeholder / Substitute | Restored Official Logo Reference |
| :--- | :--- | :--- |
| `packages/ui/src/FaceVidLogo.tsx` | Hardcoded `<div ...>FV</div>` box and `"FACE VID — LOGO ASSET PLACEHOLDER"` notice | `<img src="/assets/owner/face-vid-official-logo.png" alt="FACE VID" ... />` (`object-contain`, zero CSS filters) + lossless PNG binary sync |
| `packages/ui/src/brand.ts` | `ownerAssetPresentInWorkspace: false` & missing-asset warning string | `FACE_VID_OFFICIAL_LOGO_PATH`, `FACE_VID_MASTER_ASSET_REPO_PATH`, and `PLATFORM_LOGO_DERIVATION_MATRIX` |
| `public/assets/owner/README_MISSING_LOGO_ASSET.txt` | Legacy Phase 1A missing-logo placeholder text file | Deleted |
| `src/App.tsx` | Yellow `Missing Logo Asset Report Card` with `<FaceVidLogo variant="placeholder-box" />` | Official Owner Logo & 9-Platform Brand Derivation Matrix with `<FaceVidLogo variant="hero" />` |
| `apps/web/src/WebAppShell.tsx` | Yellow `Missing Owner Logo Asset Disclosure Banner` | Official Brand Identity header + Login, Registration, Onboarding, Splash/Loading, Creator, Merchant, and Advertiser (`business`) headers |
| `apps/admin/src/AdminAppShell.tsx` | `<FaceVidLogo variant="placeholder-box" />` in Admin notice | `<FaceVidLogo variant="division" />` in Admin Shell and `<FaceVidLogo variant="auth" />` in `/login` Super Admin authentication view |
| `apps/tv/src/TvAppShell.tsx` | Yellow `FACE VID TV · BRAND ASSET PLACEHOLDER NOTICE` | `<FaceVidLogo variant="tv-header" />` in 10-foot Top Bar, `<FaceVidLogo variant="splash" />` in launch splash banner, `<FaceVidLogo variant="auth" />` in QR Sign-In modal, and `<FaceVidLogo variant="division" />` in mobile commerce handoff modal |
| `apps/mobile/lib/main.dart` | Yellow `'MISSING OWNER ASSET...'` warning box and plain-text AppBar title | `Image.asset('assets/owner/face-vid-official-logo.png', fit: BoxFit.contain)` across AppBar, Splash/Loading, Login/Registration/Onboarding, Creator, Merchant, Advertiser, and Administration views |
| `apps/tv/android-tv/AndroidManifest.xml` | `android:banner="@drawable/tv_banner_placeholder"` | `android:icon="@mipmap/ic_launcher_face_vid_official"`, `android:banner="@drawable/face_vid_official_tv_banner"`, and `com.facevid.master_logo_asset="assets/owner/face-vid-official-logo.png"` |
| `apps/tv/lg-webos/appinfo.json` | `"icon": "icon-80x80-placeholder.png"`, `"largeIcon": "icon-130x130-placeholder.png"` | `"icon": "assets/owner/face-vid-official-logo.png"`, `"largeIcon": "assets/owner/face-vid-official-logo.png"`, `"splashBackground": "assets/owner/face-vid-official-logo.png"` |

---

## 3. NINE-PLATFORM BRANDING COVERAGE

1. **Android (`apps/mobile/android/app/src/main/AndroidManifest.xml` & `apps/mobile/lib/main.dart`)**:
   - Launcher icon (`@mipmap/ic_launcher_face_vid_official`), round icon (`@mipmap/ic_launcher_face_vid_official_round`), and `com.facevid.master_logo_asset` bound to `assets/owner/face-vid-official-logo.png`.
2. **iOS / iPadOS (`apps/mobile/ios/Runner/Info.plist` & `apps/mobile/lib/main.dart`)**:
   - `CFBundleIcons` (`FaceVidOfficialAppIcon`), `UILaunchStoryboardName` (`FaceVidOfficialLaunchScreen`), and `FaceVidMasterLogoAsset` bound to `assets/owner/face-vid-official-logo.png`.
3. **Windows 10/11 (`apps/windows/msix-packaging-config.json` & `apps/mobile/windows/CMakeLists.txt`)**:
   - MSIX `visualElements` (`storeLogo`, `square44x44Logo`, `square150x150Logo`, `wide310x150Logo`, `splashScreen`) and `FACE_VID_OFFICIAL_LOGO_ASSET` bound to `public/assets/owner/face-vid-official-logo.png` on `#080B12`.
4. **Web (`index.html`, `apps/web/app/layout.tsx`, `apps/admin/app/layout.tsx`, `apps/web/src/WebAppShell.tsx`, `apps/admin/src/AdminAppShell.tsx`)**:
   - Favicon, Apple touch icon, OpenGraph image (`og:image`), and all UI surfaces bound to `/assets/owner/face-vid-official-logo.png`.
5. **Android TV / Google TV (`apps/tv/android-tv/AndroidManifest.xml` & `apps/tv/src/TvAppShell.tsx`)**:
   - Leanback launcher banner (`@drawable/face_vid_official_tv_banner`), launcher icon (`@mipmap/ic_launcher_face_vid_official`), and 10-foot UI bound to `assets/owner/face-vid-official-logo.png`.
6. **Samsung Tizen (`apps/tv/samsung-tizen/config.xml` & `apps/tv/src/TvAppShell.tsx`)**:
   - `<icon src="assets/owner/face-vid-official-logo.png"/>` and 10-foot UI bound to the master logo.
7. **LG webOS (`apps/tv/lg-webos/appinfo.json` & `apps/tv/src/TvAppShell.tsx`)**:
   - `icon`, `largeIcon`, and `splashBackground` bound to `assets/owner/face-vid-official-logo.png` with `#080B12` `bgColor`.
8. **Apple tvOS (`apps/tv/apple-tvos/Sources/FaceVidTVApp.swift` & `apps/tv/src/TvAppShell.tsx`)**:
   - `officialBrandLogoAsset` and `topShelfBrandBannerAsset` bound to `assets/owner/face-vid-official-logo.png`.
9. **Amazon Fire TV (`apps/tv/fire-tv/AndroidManifest.xml` & `apps/tv/src/TvAppShell.tsx`)**:
   - Leanback `android:icon`, `android:banner`, and `com.facevid.master_logo_asset` bound to `assets/owner/face-vid-official-logo.png`.

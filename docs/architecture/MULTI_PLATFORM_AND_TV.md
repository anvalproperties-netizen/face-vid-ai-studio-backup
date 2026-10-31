# FACE VID — Multi-Platform & Smart TV Architecture Specification (Phase 1A Addendum)

## 1. Two Distinct User Experiences (Strict Architectural Separation)

FACE VID enforces a strict architectural separation between interactive creation/management clients (**Experience A**) and 10-foot living-room television clients (**Experience B**). **FACE VID TV is never a resized mobile, desktop, or web application.**

### Experience A — Full FACE VID Application
- **Target Platforms**:
  1. **Google Play Store**: Android smartphones and tablets (`apps/mobile/android`, `com.facevid.app`)
  2. **Apple App Store**: iPhone and iPad (`apps/mobile/ios`, `com.facevid.app`)
  3. **Microsoft Store**: Windows 10/11 desktop and laptop (`apps/mobile/windows` & `apps/windows`, `FaceVid.Desktop`)
  4. **Face Vid Website**: Responsive desktop and mobile browsers (`apps/web`, `https://facevid.app`)
- **Included Capabilities**:
  - Full FACE VID Social (Videos, Shorts, feeds, playlists, comments, Public vs. Avatar Private Mode, free P2P voice/video calls, geographic Live streaming).
  - Full FACE VID Creator (Channels, analytics, prepaid creator calls, AI Studio real-time video/audio filters, Founding Creator Program boundary).
  - Full FACE VID Merchant (Shop registration, KYB verification, product listings, carts, orders, refunds).
  - Full FACE VID Business (Advertising accounts, campaign budgets, AI-assisted ad screening).

### Experience B — FACE VID TV (10-Foot Lean-Back Smart TV Interface)
- **Target Platforms**:
  5. **Android TV / Google TV**: Compatible smart TVs and streaming boxes (`apps/tv/android-tv`, `com.facevid.tv.android`)
  6. **Samsung Smart TV (Tizen OS)**: Tizen 6.0+ Smart TVs (`apps/tv/samsung-tizen`, `com.facevid.tv.tizen`)
  7. **LG Smart TV (webOS)**: webOS Smart TVs (`apps/tv/lg-webos`, `com.facevid.tv.webos`)
  8. **Apple TV (tvOS)**: tvOS 17+ (`apps/tv/apple-tvos`, `com.facevid.tv.tvos`)
  9. **Amazon Fire TV**: Fire OS TV devices (`apps/tv/fire-tv`, `com.facevid.tv.fire`)
- **Included Capabilities**:
  - Dark cinematic 10-foot home screen (`#080B12`) with left-side collapsible navigation rail, large widescreen thumbnails, horizontal content rows, and personalized recommendations.
  - D-pad directional remote navigation (`Up`, `Down`, `Left`, `Right`, `OK/Select`, `Back/Return`) with high-contrast `#356DFF` focus rings (`4px` ring + `1.03x` scale).
  - Full-screen 4K/1080p playback with captions/subtitles (`CC`), multi-language audio tracks, Continue Watching progress bars, and ad-supported vs. Premium ad-free entitlement enforcement.
  - Vertical `Shorts` adapted for television viewing, Live broadcasts (respecting geographic privacy rules and `autoArchiveEnabled: false`), Music, Gaming, Sports, News, Movies & TV, Podcasts, Watch Later, Playlists, Watch History, and Your Videos.
  - Short-lived, single-use QR-code and 8-character activation code sign-in (`/api/v1/auth/tv-device/*`).
  - QR-code handoff to Experience A (Mobile) for Face Vid Shop product purchases and creator event actions.
- **Strictly Excluded from Experience B (`EXPERIENCE_B_TV_EXCLUDED_FEATURES`)**:
  - Full AI Studio editing (`AI_STUDIO_FULL_EDITOR`)
  - Creator verification and creator management (`CREATOR_VERIFICATION_AND_MANAGEMENT`)
  - Merchant dashboard (`MERCHANT_DASHBOARD`)
  - Advertising management dashboard (`ADVERTISING_MANAGEMENT_DASHBOARD`)
  - Super Admin Panel (`SUPER_ADMIN_PANEL`)
  - Advanced video uploads and editing (`ADVANCED_VIDEO_UPLOADS_AND_EDITING`)
  - Full messaging and private video calling (`PRIVATE_MESSAGING_AND_CALLS`)
  - Creator-call booking and direct TV payment processing (`CREATOR_CALL_BOOKING_AND_DIRECT_PAYMENT`)

---

## 2. Honest Framework & SDK Compatibility Analysis

A single Flutter build **cannot** automatically publish to all television operating systems:
- **Android, iOS/iPadOS, Windows 10/11**: Officially supported first-tier Flutter targets (`apps/mobile`).
- **Android TV & Amazon Fire TV**: Run Android-based OSes; require Leanback launcher declarations (`android.software.leanback` required=`true`, `android.hardware.touchscreen` required=`false`) and D-pad keycode bindings (`apps/tv/android-tv`, `apps/tv/fire-tv`).
- **Samsung Tizen & LG webOS**: Do **not** have official production-grade Flutter support from Google. Both platforms natively execute W3C/HTML5/TypeScript 10-foot TV web bundles packaged as `.wgt` (Tizen Studio) and `.ipk` (webOS `ares-package`) utilizing `apps/tv/src/TvAppShell.tsx` and native MSE/EME media pipelines (`apps/tv/samsung-tizen`, `apps/tv/lg-webos`).
- **Apple tvOS**: Does **not** have official Flutter support. Requires native Swift / SwiftUI + `AVPlayerViewController` + tvOS Focus Engine (`apps/tv/apple-tvos`).

---

## 3. TV 10-Foot Design System & Remote Navigation Specification

- **Viewing Distance**: 10 feet (3 meters) on 1080p (`1920x1080`) and 4K (`3840x2160`) displays with 5% overscan safe-title margins (`48px` horizontal, `36px` vertical).
- **Color Palette**:
  - Canvas: `#080B12` (Deep Cinema Black)
  - Focus Ring & Active Accent: `#356DFF` (`4px` solid electric blue ring with white inner contrast border)
  - Typography: Minimum `18px` metadata, `24px–28px` card titles, `36px–48px` hero spotlight headers.
- **Remote Keycode Mapping**:
  - Directional `Up / Down / Left / Right`: Deterministic 2D spatial focus matrix (`rail` zone $\leftrightarrow$ `grid` row/column coordinates).
  - `OK / Enter / Select`: Activates focused navigation rail item or launches full-screen playback on focused video card.
  - `Back / Return / Escape`: Exits full-screen player or modal back to content grid, or moves focus from content grid back to the left navigation rail before prompting exit.

---

## 4. Secure TV Device-Linking Authentication Protocol

Implemented in `packages/shared/src/platforms.ts` and `apps/api/src/tv/tv-pairing.service.ts`:
1. `POST /api/v1/auth/tv-device/code`: Generates a short-lived (`300 seconds` TTL), single-use 8-character pairing code (`FVxx-xxxx`) and QR verification URL (`https://facevid.app/activate?code=...`). Rate-limited per IP window. **Never** embeds permanent credentials, passwords, or session tokens in the QR payload (`containsPermanentCredentialsInQr: false`).
2. `POST /api/v1/auth/tv-device/confirm`: Called by an authenticated phone/computer session after scanning the QR code or entering the short code. Transitions status from `PENDING_USER_CONFIRMATION` to `AUTHORIZED_READY_FOR_TV`.
3. `POST /api/v1/auth/tv-device/poll`: Called by the TV client. Exchanges an `AUTHORIZED_READY_FOR_TV` code for a device-bound session (`CONSUMED_ACTIVE_SESSION`). Subsequent replay attempts with the same code are rejected with `400 BAD_REQUEST`.
4. `POST /api/v1/auth/tv-device/revoke`: Allows immediate remote sign-out and session revocation (`REVOKED`).

---

## 5. Adaptive Bitrate Video Playback & DRM Matrix

| Platform | Container & Streaming Protocol | Video / Audio Codecs | DRM System |
| :--- | :--- | :--- | :--- |
| **Android & Android TV & Fire TV** | MPEG-DASH & HLS (fMP4) via Media3 ExoPlayer | HEVC (H.265), AV1, H.264 · AAC-LC, E-AC-3 (Dolby Digital Plus) | Google Widevine L1 (Hardware) / L3 |
| **iOS/iPadOS & Apple tvOS** | HLS (fMP4) via AVFoundation / AVKit | HEVC (Dolby Vision / HDR10), H.264 · AAC, Dolby Atmos (E-AC-3) | Apple FairPlay Streaming (FPS) |
| **Windows 10/11 & Web** | MPEG-DASH & HLS via MSE/EME | AV1, HEVC, VP9, H.264 · AAC, Opus | Widevine / Microsoft PlayReady / FairPlay |
| **Samsung Tizen & LG webOS** | HLS & MPEG-DASH via AVPlay / WebOS MSE-EME | HEVC (4K UHD), H.264 · AAC, Dolby Digital Plus | PlayReady & Widevine Modular |

---

## 6. In-App Purchase (IAP), Commerce & Billing Compliance

- **Apple App Store (iOS/iPadOS & tvOS)**: Digital subscriptions (`PREMIUM_AD_FREE`) and in-app digital AI Studio credit packs must use **StoreKit 2 In-App Purchase** per App Store Review Guideline 3.1.1. Real-time 1-to-1 scheduled creator calls are evaluated under Guideline 3.1.3(d) (Person-to-Person Services) vs. StoreKit IAP prior to Phase 1B billing activation. Physical merchandise sold in Face Vid Shop must use standard external payment processing (`PaymentProviderPort`).
- **Google Play Store (Android & Android TV)**: Digital subscriptions and AI Studio virtual features must use **Google Play Billing Library v7+**. Physical merchant goods use `PaymentProviderPort`.
- **Microsoft Store (Windows 10/11)**: Supports Microsoft Store Commerce API or compliant server-authoritative checkout per Microsoft Store policies.
- **Smart TVs (Tizen, webOS, Fire TV, Android TV, tvOS)**: Browsing Face Vid Shop products and creator events on TV uses **QR-code mobile handoff** so users complete verification and checkout securely on their phone without entering payment credentials via a TV remote.

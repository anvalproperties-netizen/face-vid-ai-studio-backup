'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  FACE_VID_OFFICIAL_LOGO_PATH,
  FACE_VID_MASTER_ASSET_REPO_PATH,
} from './brand.ts';

export interface FaceVidLogoProps {
  /**
   * Controls sizing context while always preserving the exact proportions,
   * colors, FV symbol, and FACE VID lettering of the master image.
   */
  variant?:
    | 'topbar'
    | 'hero'
    | 'auth'
    | 'splash'
    | 'division'
    | 'tv-header'
    | 'modal'
    | 'placeholder-box';
  onClick?: () => void;
  className?: string;
  /**
   * Enables the signature 5-second cinematic breathing pulse with enhanced
   * electric-blue luminous glow. Automatically disabled under prefers-reduced-motion.
   */
  animated?: boolean;
}

/**
 * Official FACE VID Brand Component.
 * Always references `/assets/owner/face-vid-official-logo.png` (`public/assets/owner/face-vid-official-logo.png`).
 * Never substitutes fake FV symbols, CSS-altered colors, or AI-generated logos.
 */
export const FaceVidLogo: React.FC<FaceVidLogoProps> = ({
  variant = 'topbar',
  onClick,
  className = '',
  animated = true,
}) => {
  const [cacheBust, setCacheBust] = useState<number>(0);
  const [imageLoadFailed, setImageLoadFailed] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const handleLogoUpdated = () => {
      setImageLoadFailed(false);
      setCacheBust(Date.now());
    };
    window.addEventListener('facevid:owner-logo-updated', handleLogoUpdated);
    return () => {
      window.removeEventListener('facevid:owner-logo-updated', handleLogoUpdated);
    };
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadNotice(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64Data = window.btoa(binary);

      const res = await fetch('/api/v1/brand/owner-logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Data,
          filename: file.name,
        }),
      });
      const payload = (await res.json()) as {
        ok?: boolean;
        sha256?: string;
        byteLength?: number;
        error?: string;
      };

      if (res.ok && payload.ok) {
        setImageLoadFailed(false);
        setCacheBust(Date.now());
        setUploadNotice(
          `Saved exact original file (${payload.byteLength?.toLocaleString()} bytes · SHA-256 ${payload.sha256?.slice(0, 12)}...)`
        );
        window.dispatchEvent(new CustomEvent('facevid:owner-logo-updated'));
      } else {
        setUploadNotice(payload.error || 'Failed to save master logo file.');
      }
    } catch (err) {
      setUploadNotice(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const imgSrc = cacheBust
    ? `${FACE_VID_OFFICIAL_LOGO_PATH}?v=${cacheBust}`
    : FACE_VID_OFFICIAL_LOGO_PATH;

  // Sizing increased to maximize visibility, legibility, and premium brand presence across the app
  const sizeClasses: Record<NonNullable<FaceVidLogoProps['variant']>, string> = {
    topbar: 'h-13 sm:h-15 md:h-17 lg:h-18 w-auto max-w-[300px] sm:max-w-[340px]',
    'tv-header': 'h-24 sm:h-28 w-auto max-w-[460px]',
    division: 'h-24 sm:h-28 w-auto max-w-[460px]',
    auth: 'h-32 sm:h-42 w-auto max-w-[540px]',
    modal: 'h-16 sm:h-20 md:h-22 w-auto max-w-[360px] sm:max-w-[420px]',
    hero: 'h-42 sm:h-56 md:h-64 w-auto max-w-[700px]',
    splash: 'h-50 sm:h-64 md:h-72 w-auto max-w-[800px]',
    'placeholder-box': 'h-24 w-auto max-w-[380px]',
  };

  const animationClass = animated
    ? 'facevid-cinematic-pulse'
    : 'drop-shadow-[0_0_12px_rgba(53,109,255,0.7)] drop-shadow-[0_0_24px_rgba(53,109,255,0.4)]';

  const pulseStyles = `
    @keyframes facevid-cinematic-pulse {
      0% {
        transform: scale(1);
        filter: drop-shadow(0 0 10px rgba(53, 109, 255, 0.75)) drop-shadow(0 0 22px rgba(53, 109, 255, 0.45)) drop-shadow(0 0 45px rgba(53, 109, 255, 0.20));
      }
      20% {
        transform: scale(1.06);
        filter: drop-shadow(0 0 18px rgba(53, 109, 255, 1.0)) drop-shadow(0 0 38px rgba(53, 109, 255, 0.85)) drop-shadow(0 0 70px rgba(53, 109, 255, 0.55));
      }
      40% {
        transform: scale(1);
        filter: drop-shadow(0 0 10px rgba(53, 109, 255, 0.75)) drop-shadow(0 0 22px rgba(53, 109, 255, 0.45)) drop-shadow(0 0 45px rgba(53, 109, 255, 0.20));
      }
      100% {
        transform: scale(1);
        filter: drop-shadow(0 0 10px rgba(53, 109, 255, 0.75)) drop-shadow(0 0 22px rgba(53, 109, 255, 0.45)) drop-shadow(0 0 45px rgba(53, 109, 255, 0.20));
      }
    }
    .facevid-cinematic-pulse {
      animation: facevid-cinematic-pulse 5s cubic-bezier(0.4, 0, 0.2, 1) infinite;
      transform-origin: center center;
      will-change: transform, filter;
    }
    @media (prefers-reduced-motion: reduce) {
      .facevid-cinematic-pulse {
        animation: none !important;
        transform: none !important;
      }
    }
  `;

  if (variant === 'topbar' || variant === 'tv-header') {
    return (
      <>
        <style dangerouslySetInnerHTML={{ __html: pulseStyles }} />
        <a
          href="#top"
          onClick={(e) => {
            if (onClick) {
              e.preventDefault();
              onClick();
            }
          }}
          aria-label="FACE VID"
          className={`inline-flex items-center gap-3 pt-1 sm:pt-1.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#356DFF] whitespace-nowrap shrink-0 group ${className}`}
        >
          {!imageLoadFailed ? (
            <img
              src={imgSrc}
              alt="FACE VID"
              referrerPolicy="no-referrer"
              onError={() => setImageLoadFailed(true)}
              className={`${sizeClasses[variant]} object-contain select-none transition-transform duration-200 group-hover:scale-105 ${animationClass}`}
            />
          ) : (
            <span className="font-display text-2xl font-bold tracking-tight text-white">
              FACE VID
            </span>
          )}
        </a>
      </>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: pulseStyles }} />
      <div
        className={`inline-flex flex-col items-start gap-2 pt-1.5 sm:pt-2 ${className}`}
        data-master-logo-path={FACE_VID_MASTER_ASSET_REPO_PATH}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          onChange={handleFileChange}
          className="hidden"
          aria-label="Upload original owner FACE VID PNG logo"
        />
        {!imageLoadFailed ? (
          <div className="inline-flex items-center justify-center select-none p-1">
            <img
              src={imgSrc}
              alt="FACE VID Official Logo"
              referrerPolicy="no-referrer"
              onError={() => setImageLoadFailed(true)}
              className={`${sizeClasses[variant]} object-contain select-none ${animationClass}`}
            />
          </div>
        ) : (
          <div className="inline-flex flex-col sm:flex-row items-start sm:items-center gap-3 px-4 py-3 bg-[#080B12] border border-[#356DFF]/60 rounded-lg">
            <div className="text-left space-y-0.5">
              <div className="font-display text-xs font-bold text-white tracking-tight">
                FACE VID — Master Logo Binary Sync ({FACE_VID_MASTER_ASSET_REPO_PATH})
              </div>
              <div className="text-[11px] text-slate-300 font-mono">
                Select the original owner PNG file to write unmodified bytes directly to{' '}
                {FACE_VID_MASTER_ASSET_REPO_PATH}
              </div>
              {uploadNotice && (
                <div className="text-[11px] text-[#FFC928] font-mono">{uploadNotice}</div>
              )}
            </div>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded bg-[#356DFF] hover:bg-[#356DFF]/90 text-xs font-semibold text-white whitespace-nowrap shrink-0"
            >
              {uploading ? 'Writing Master PNG...' : 'Attach Original PNG'}
            </button>
          </div>
        )}
      </div>
    </>
  );
};


/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { WebAppShell } from '../apps/web/src/WebAppShell.tsx';
import { AdminAppShell } from '../apps/admin/src/AdminAppShell.tsx';
import { TvAppShell } from '../apps/tv/src/TvAppShell.tsx';
import {
  FaceVidLogo,
  OWNER_LOGO_ASSET_STATUS,
  PLATFORM_LOGO_DERIVATION_MATRIX,
} from '../packages/ui/src/index.ts';
import { PHASE_1A_MODULE_BOUNDARIES } from '../apps/api/src/modules/boundaries.ts';
import {
  PLATFORM_READINESS_MATRIX,
  EXPERIENCE_B_TV_EXCLUDED_FEATURES,
  UserRole,
  AccountStatus,
  SubscriptionTier,
} from '../packages/shared/src/index.ts';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { StandaloneAuthGateway } from '../apps/web/src/components/auth/StandaloneAuthGateway.tsx';

type ActiveSurface = 'web' | 'tv' | 'admin' | 'audit';

export default function App() {
  const [surface, setSurface] = useState<ActiveSurface>('web');
  const [healthJson, setHealthJson] = useState<string | null>(null);
  const [readyJson, setReadyJson] = useState<string | null>(null);
  const [foundationJson, setFoundationJson] = useState<string | null>(null);
  const [contractJson, setContractJson] = useState<string | null>(null);
  const [privilegeRejectJson, setPrivilegeRejectJson] = useState<string | null>(null);
  const [loadingProbe, setLoadingProbe] = useState(false);

  // Stage 6B Mandated Authentication State
  const [authSession, setAuthSession] = useState<{
    accessToken: string;
    refreshToken: string;
    user: {
      userId: string;
      email: string;
      legalFullName: string;
      roles: UserRole[];
      accountStatus: AccountStatus;
      subscriptionTier: SubscriptionTier;
    };
  } | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    const verifyInitialSession = async () => {
      try {
        const stored =
          typeof window !== 'undefined'
            ? localStorage.getItem('facevid_auth_session')
            : null;
        if (!stored) {
          if (isMounted) {
            setAuthSession(null);
            setIsCheckingSession(false);
          }
          return;
        }

        const parsed = JSON.parse(stored);
        const token = parsed?.accessToken;
        if (!token) {
          if (isMounted) {
            setAuthSession(null);
            setIsCheckingSession(false);
          }
          return;
        }

        const res = await fetch('/api/v1/auth/session/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const body = await res.json();
          if (body.ok && body.data && isMounted) {
            setAuthSession({
              accessToken: token,
              refreshToken: parsed.refreshToken || '',
              user: body.data,
            });
          } else if (isMounted) {
            localStorage.removeItem('facevid_auth_session');
            setAuthSession(null);
          }
        } else if (isMounted) {
          localStorage.removeItem('facevid_auth_session');
          setAuthSession(null);
        }
      } catch {
        if (isMounted) setAuthSession(null);
      } finally {
        if (isMounted) setIsCheckingSession(false);
      }
    };

    void verifyInitialSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('facevid_auth_session');
    }
    setAuthSession(null);
    setSurface('web');
  };

  const runLiveBackendProbes = async () => {
    setLoadingProbe(true);
    try {
      const [hRes, rRes, fRes, cRes, pRes] = await Promise.all([
        fetch('/api/v1/health'),
        fetch('/api/v1/health/ready'),
        fetch('/api/v1/foundation/db-redis-status'),
        fetch('/api/v1/security/verify-contracts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identityMode: 'PRIVATE',
            liveReach: 'RADIUS_15KM',
            requestedRegistrationRole: 'SUPER_ADMIN',
            simulatedAiAction: 'PROMOTE_PRIVILEGED_ROLE',
          }),
        }),
        fetch('/api/v1/security/verify-contracts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            role: 'SUPER_ADMIN',
            subscriptionTier: 'PREMIUM_AD_FREE',
          }),
        }),
      ]);

      setHealthJson(JSON.stringify(await hRes.json(), null, 2));
      setReadyJson(JSON.stringify(await rRes.json(), null, 2));
      setFoundationJson(JSON.stringify(await fRes.json(), null, 2));
      setContractJson(JSON.stringify(await cRes.json(), null, 2));
      setPrivilegeRejectJson(JSON.stringify(await pRes.json(), null, 2));
    } catch (err) {
      setHealthJson(
        JSON.stringify(
          { error: err instanceof Error ? err.message : 'Probe error' },
          null,
          2
        )
      );
    } finally {
      setLoadingProbe(false);
    }
  };

  useEffect(() => {
    if (surface === 'audit' && !healthJson) {
      void runLiveBackendProbes();
    }
  }, [surface, healthJson]);

  if (isCheckingSession) {
    return (
      <div className="min-h-screen bg-[#080B12] text-white flex flex-col items-center justify-center p-6 selection:bg-[#356DFF]/30">
        <FaceVidLogo variant="modal" animated={true} />
        <div className="mt-6 flex items-center gap-2.5 text-xs font-mono text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin text-[#356DFF]" />
          <span>Verifying Secure Session...</span>
        </div>
      </div>
    );
  }

  // Mandatory Stage 6B Gate:
  // When a visitor opens FACE VID, the first screen must be the standalone authentication gateway.
  // Do not open directly into the Home feed.
  if (!authSession) {
    return (
      <StandaloneAuthGateway
        onAuthenticated={(newSession) => {
          setAuthSession(newSession);
        }}
      />
    );
  }

  if (surface === 'web') {
    return (
      <WebAppShell
        session={authSession}
        onSignOut={handleSignOut}
        onNavigateToAdmin={() => setSurface('admin')}
        onNavigateToTv={() => setSurface('tv')}
        onNavigateToAudit={() => setSurface('audit')}
      />
    );
  }

  if (surface === 'tv') {
    return (
      <TvAppShell
        onSwitchToExperienceAWeb={() => setSurface('web')}
        onSwitchToAudit={() => setSurface('audit')}
      />
    );
  }

  if (surface === 'admin') {
    return (
      <AdminAppShell
        onNavigateToWeb={() => setSurface('web')}
        onNavigateToAudit={() => setSurface('audit')}
      />
    );
  }

  return (
    <div id="top" className="min-h-screen bg-[#080B12] text-white flex flex-col">
      {/* Top Bar Contract */}
      <header className="sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6 py-3 bg-[#080B12]/95 backdrop-blur border-b border-white/10 gap-3 md:gap-4 flex-wrap lg:flex-nowrap">
        <FaceVidLogo variant="topbar" onClick={() => setSurface('web')} />

        <nav
          aria-label="Phase 1A Surface Switcher"
          className="hidden md:flex items-center gap-3 lg:gap-6 text-sm lg:text-base font-semibold overflow-x-auto scrollbar-none py-1"
        >
          <button
            type="button"
            onClick={() => setSurface('web')}
            className="py-1 text-slate-300 hover:text-white transition-colors whitespace-nowrap"
          >
            Experience A: Full Web/Mobile
          </button>
          <button
            type="button"
            onClick={() => setSurface('tv')}
            className="py-1 text-slate-300 hover:text-white transition-colors whitespace-nowrap"
          >
            Experience B: FACE VID TV (10-Foot UI)
          </button>
          <button
            type="button"
            onClick={() => setSurface('admin')}
            className="py-1 text-slate-300 hover:text-white transition-colors whitespace-nowrap"
          >
            Super Admin Shell
          </button>
          <button
            type="button"
            onClick={() => setSurface('audit')}
            className="py-1 text-white border-b-2 border-[#356DFF] whitespace-nowrap"
          >
            9-Platform & API Audit
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={runLiveBackendProbes}
            disabled={loadingProbe}
            className="px-4 py-2.5 text-sm font-semibold bg-[#356DFF] hover:bg-[#356DFF]/90 text-white rounded-lg transition-colors whitespace-nowrap shadow-sm"
          >
            {loadingProbe ? 'Running Probes...' : 'Re-Run Live API Probes'}
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-[1440px] w-full mx-auto p-6 lg:p-10 space-y-10">
        <section className="space-y-2 border-b border-white/10 pb-6">
          <div className="text-xs font-mono text-[#356DFF]">
            FACE VID — PHASE 1A MULTI-PLATFORM & SMART TV AUDIT INSPECTOR
          </div>
          <h1 className="font-display text-3xl font-bold text-white">
            Nine-Platform Readiness Matrix, Experience A/B Separation & Live API Probes
          </h1>
          <p className="text-sm text-slate-300 max-w-3xl">
            Audits all 9 required platform targets (Android, iOS/iPadOS, Windows 10/11, Web,
            Android TV/Google TV, Samsung Tizen, LG webOS, Apple tvOS, Amazon Fire TV), Experience A
            vs. Experience B feature isolation, and live `/api/v1/*` backend responses.
          </p>
        </section>

        {/* Official Owner Logo & 9-Platform Brand Derivation Card */}
        <section className="p-5 rounded-lg border border-[#356DFF]/40 bg-[#356DFF]/[0.05] space-y-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-[#22C55E]">
                <CheckCircle2 className="w-4 h-4" />
                <span>Official Owner Logo Restoration — Master Asset & 9-Platform Derivation</span>
              </div>
              <p className="text-xs text-slate-300 max-w-3xl">
                {OWNER_LOGO_ASSET_STATUS.statusMessage}
              </p>
              <div className="pt-2 flex flex-wrap items-center gap-3">
                <label className="cursor-pointer px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#356DFF] hover:bg-[#356DFF]/90 text-white transition-colors flex items-center gap-2 shadow-sm">
                  <input
                    type="file"
                    accept="image/png"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
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
                        body: JSON.stringify({ base64Data, filename: file.name }),
                      });
                      if (res.ok) {
                        window.dispatchEvent(new CustomEvent('facevid:owner-logo-updated'));
                      }
                    }}
                    className="hidden"
                  />
                  <span>Upload & Lock Authoritative Owner PNG</span>
                </label>
                <span className="text-[11px] font-mono text-slate-400">
                  Writes exact source bytes to public/assets/owner/face-vid-official-logo-source.png
                </span>
              </div>
            </div>
            <FaceVidLogo variant="hero" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-white/10 text-xs">
            {PLATFORM_LOGO_DERIVATION_MATRIX.map((spec) => (
              <div
                key={spec.platformId}
                className="p-3 rounded bg-[#080B12] border border-white/10 space-y-1"
              >
                <div className="font-semibold text-white">{spec.platformName}</div>
                <div className="font-mono text-[11px] text-[#356DFF]">
                  Master: {spec.masterSourcePath}
                </div>
                <p className="text-[11px] text-slate-400">{spec.aspectAndSafeZonePolicy}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Nine-Platform Readiness Matrix */}
        <section className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-xl font-bold text-white">
                01. Nine-Platform Readiness & Audit Classification Matrix
              </h2>
              <p className="text-xs text-slate-400">
                Classifications: PASS (Tested & Verified) · NOT_RUN (Requires Native Host SDK) ·
                PLANNED (Future Phase)
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSurface('tv')}
              className="px-4 py-2 text-xs font-semibold bg-[#356DFF] text-white rounded-lg whitespace-nowrap"
            >
              Open Experience B (FACE VID TV)
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.03] text-slate-300">
                  <th className="p-3 font-semibold">Platform & Store</th>
                  <th className="p-3 font-semibold">Experience Tier</th>
                  <th className="p-3 font-semibold">Framework / SDK</th>
                  <th className="p-3 font-semibold">App ID & Path</th>
                  <th className="p-3 font-semibold">Structure / Config</th>
                  <th className="p-3 font-semibold">Native Build</th>
                  <th className="p-3 font-semibold">Store Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 font-mono tabular-nums">
                {PLATFORM_READINESS_MATRIX.map((p) => (
                  <tr key={p.platformId} className="hover:bg-white/[0.02]">
                    <td className="p-3 font-sans">
                      <div className="font-semibold text-white">{p.displayName}</div>
                      <div className="text-slate-400">{p.storeDestination}</div>
                    </td>
                    <td className="p-3 text-slate-200">{p.experienceTier}</td>
                    <td className="p-3 font-sans text-slate-300 max-w-xs">{p.frameworkAndSdk}</td>
                    <td className="p-3 text-slate-300">
                      <div>{p.applicationIdentifier}</div>
                      <div className="text-slate-500">{p.projectPath}</div>
                    </td>
                    <td className="p-3 text-[#22C55E]">
                      {p.auditStatus.structureScaffolded} / {p.auditStatus.configVerified}
                    </td>
                    <td className="p-3 text-[#FFC928]">{p.auditStatus.nativeBuildExecution}</td>
                    <td className="p-3 text-slate-400">{p.auditStatus.storeApprovalStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Live Backend API Probe Outputs */}
        <section className="space-y-4">
          <h2 className="font-display text-xl font-bold text-white">
            02. Live Backend Health, Readiness & Security Guard Probes
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="p-5 rounded-lg border border-white/10 bg-white/[0.02] space-y-2">
              <div className="text-xs font-mono text-[#22C55E]">
                GET /api/v1/health (200 OK)
              </div>
              <pre className="text-xs font-mono text-slate-200 bg-[#080B12] p-4 rounded border border-white/10 overflow-x-auto max-h-64">
                {healthJson || 'Executing probe...'}
              </pre>
            </div>

            <div className="p-5 rounded-lg border border-white/10 bg-white/[0.02] space-y-2">
              <div className="text-xs font-mono text-[#356DFF]">
                GET /api/v1/health/ready (PostgreSQL & Redis TCP Socket Probe)
              </div>
              <pre className="text-xs font-mono text-slate-200 bg-[#080B12] p-4 rounded border border-white/10 overflow-x-auto max-h-64">
                {readyJson || 'Executing probe...'}
              </pre>
            </div>

            <div className="p-5 rounded-lg border border-white/10 bg-white/[0.02] space-y-2">
              <div className="text-xs font-mono text-[#22C55E]">
                POST /api/v1/security/verify-contracts (Redaction, Privacy & AI Governance)
              </div>
              <pre className="text-xs font-mono text-slate-200 bg-[#080B12] p-4 rounded border border-white/10 overflow-x-auto max-h-64">
                {contractJson || 'Executing probe...'}
              </pre>
            </div>

            <div className="p-5 rounded-lg border border-white/10 bg-white/[0.02] space-y-2">
              <div className="text-xs font-mono text-[#F04452]">
                POST /api/v1/security/verify-contracts with Client Role Escalation (403 Blocked)
              </div>
              <pre className="text-xs font-mono text-slate-200 bg-[#080B12] p-4 rounded border border-white/10 overflow-x-auto max-h-64">
                {privilegeRejectJson || 'Executing probe...'}
              </pre>
            </div>
            <div className="p-5 rounded-lg border border-white/10 bg-white/[0.02] space-y-2 lg:col-span-2">
              <div className="text-xs font-mono text-[#22C55E]">
                GET /api/v1/foundation/db-redis-status (Phase 1B-1 PostgreSQL 16 Migrations, 15 Domains & Redis 7 Status)
              </div>
              <pre className="text-xs font-mono text-slate-200 bg-[#080B12] p-4 rounded border border-white/10 overflow-x-auto max-h-72">
                {foundationJson || 'Executing probe...'}
              </pre>
            </div>
          </div>
        </section>
        <section className="space-y-4">
          <h2 className="font-display text-xl font-bold text-white">
            03. Experience A Divisions vs. Experience B (FACE VID TV) Exclusions
          </h2>
          <div className="p-5 rounded-lg border border-white/10 bg-white/[0.02] space-y-2">
            <div className="text-xs font-semibold text-[#F04452]">
              Features Strictly Excluded from Experience B (FACE VID TV 10-Foot App):
            </div>
            <div className="text-xs font-mono text-slate-300">
              {EXPERIENCE_B_TV_EXCLUDED_FEATURES.join(' · ')}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {PHASE_1A_MODULE_BOUNDARIES.map((div) => (
              <div
                key={div.id}
                className="p-5 rounded-lg border border-white/10 bg-white/[0.02] space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-base font-bold text-white">{div.name}</h3>
                  <span className="text-xs font-mono text-[#22C55E]">
                    {div.status}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Route Boundary: <span className="text-slate-200 font-mono">{div.path}</span>
                </p>
                <p className="text-xs text-slate-300">
                  {div.description}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}



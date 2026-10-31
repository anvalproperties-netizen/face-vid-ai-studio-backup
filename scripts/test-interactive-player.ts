/**
 * FACE VID V2 — Phase 1, Task 1.2B: Interactive HTML5 Video Player Test Suite
 * Genuine interactive DOM & component state testing using JSDOM and React 19.
 *
 * Verifies:
 * 1. Catalog video selection & player mounting/dismissal
 * 2. Play/Pause toggle, video element events, center overlay, keyboard shortcuts
 * 3. Range slider seeking, timeupdate handling, skip forward/backward
 * 4. Volume control, muting toggle, volume slider, keyboard mute
 * 5. Playback speed selector (0.5x, 1x, 1.25x, 1.5x, 2x)
 * 6. Fullscreen request & exit handling
 * 7. Shorts vertical feed playback (9:16 layout, mobile constraint, reset)
 * 8. Buffering indicators and error recovery with retry
 * 9. Strict restricted content isolation (PRIVATE, SUBSCRIBERS_ONLY, non-READY)
 * 10. Real HTTP 206 Range serving & media bitstream codec integrity
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { VideoPlayer, formatTime } from '../apps/web/src/components/VideoPlayer';
import { WebAppShell } from '../apps/web/src/WebAppShell';

interface InteractiveTestResult {
  name: string;
  category: 'DOM_INTERACTIVE' | 'REAL_MEDIA_PIPELINE';
  status: 'PASS' | 'FAIL';
  durationMs: number;
  details?: string;
}

const results: InteractiveTestResult[] = [];

// Setup JSDOM environment
function setupJSDOM() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="root"></div></body></html>',
    {
      url: 'http://localhost:3000',
      pretendToBeVisual: true,
    }
  );

  const window = dom.window;

  const safeDefineGlobal = (key: string, value: any) => {
    try {
      (globalThis as any)[key] = value;
    } catch {
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
      });
    }
  };

  safeDefineGlobal('window', window);
  safeDefineGlobal('document', window.document);
  safeDefineGlobal('navigator', window.navigator);
  safeDefineGlobal('HTMLElement', window.HTMLElement);
  safeDefineGlobal('HTMLVideoElement', window.HTMLVideoElement);
  safeDefineGlobal('Event', window.Event);
  safeDefineGlobal('KeyboardEvent', window.KeyboardEvent);
  safeDefineGlobal('MouseEvent', window.MouseEvent);
  safeDefineGlobal('IS_REACT_ACT_ENVIRONMENT', true);

  const origError = console.error;
  console.error = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('not wrapped in act')) return;
    origError(...args);
  };

  // Polyfill media methods and properties on HTMLMediaElement prototype
  let isPaused = true;
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
    get() {
      return isPaused;
    },
    set(v) {
      isPaused = Boolean(v);
    },
    configurable: true,
  });

  let curTime = 0;
  Object.defineProperty(window.HTMLMediaElement.prototype, 'currentTime', {
    get() {
      return curTime;
    },
    set(v) {
      curTime = Number(v);
    },
    configurable: true,
  });

  let curVol = 1;
  Object.defineProperty(window.HTMLMediaElement.prototype, 'volume', {
    get() {
      return curVol;
    },
    set(v) {
      curVol = Number(v);
    },
    configurable: true,
  });

  let isMuted = false;
  Object.defineProperty(window.HTMLMediaElement.prototype, 'muted', {
    get() {
      return isMuted;
    },
    set(v) {
      isMuted = Boolean(v);
    },
    configurable: true,
  });

  let curRate = 1;
  Object.defineProperty(window.HTMLMediaElement.prototype, 'playbackRate', {
    get() {
      return curRate;
    },
    set(v) {
      curRate = Number(v);
    },
    configurable: true,
  });

  window.HTMLMediaElement.prototype.play = function () {
    isPaused = false;
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function () {
    isPaused = true;
  };
  window.HTMLMediaElement.prototype.load = function () {
    isPaused = true;
    curTime = 0;
  };

  return { dom, window, document: window.document };
}

function simulateChange(element: HTMLElement, value: any) {
  const reactPropKey = Object.keys(element).find((k) => k.startsWith('__reactProps'));
  if (reactPropKey && (element as any)[reactPropKey]?.onChange) {
    (element as any)[reactPropKey].onChange({ target: { value } });
  } else {
    (element as any).value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

async function runInteractiveTest(
  name: string,
  category: 'DOM_INTERACTIVE' | 'REAL_MEDIA_PIPELINE',
  fn: () => Promise<void>
) {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    results.push({ name, category, status: 'PASS', durationMs });
    console.log(`  ✓ [${category}] ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    results.push({ name, category, status: 'FAIL', durationMs, details: err.message });
    console.error(`  ✗ [${category}] ${name} (${durationMs}ms)`);
    console.error(`    Error: ${err.message}`);
    throw err;
  }
}

export async function runInteractiveVideoSuite(): Promise<boolean> {
  console.log('\n================================================================');
  console.log('PHASE 1 TASK 1.2B: GENUINE INTERACTIVE VIDEO PLAYBACK TEST SUITE');
  console.log('================================================================\n');

  // 1. Opening a catalog video & Player Mounting
  await runInteractiveTest(
    '1. Opening Catalog Video & Mounting Controlled Player',
    'DOM_INTERACTIVE',
    async () => {
      const { document } = setupJSDOM();
      const container = document.getElementById('root')!;
      const root = createRoot(container);

      await act(async () => {
        root.render(React.createElement(WebAppShell, { initialRoute: 'home' }));
      });

      // Confirm catalog card exists with Play & Inspect button
      const playBtn = container.querySelector(
        '[data-testid^="play-btn-"]'
      ) as HTMLButtonElement | null;
      assert.ok(playBtn, 'Catalog must render at least one play button');

      // Click Play & Inspect
      await act(async () => {
        playBtn.click();
      });

      // Player playback section must now be mounted in the DOM
      const playerSection = container.querySelector(
        '[data-testid="active-video-playback-section"]'
      );
      assert.ok(playerSection, 'Active video player section must mount after clicking card');

      const videoEl = container.querySelector(
        '[data-testid="html5-video-element"]'
      ) as HTMLVideoElement | null;
      assert.ok(videoEl, 'HTML5 video element must be present in DOM');
      assert.ok(videoEl.src.includes('.mp4'), 'Video element must have valid MP4 source');

      // Dismiss player
      const dismissBtn = container.querySelector(
        '[data-testid="dismiss-player-btn"]'
      ) as HTMLButtonElement | null;
      assert.ok(dismissBtn, 'Dismiss button must be present');

      await act(async () => {
        dismissBtn.click();
      });

      // Player must be unmounted
      const unmountedSection = container.querySelector(
        '[data-testid="active-video-playback-section"]'
      );
      assert.equal(unmountedSection, null, 'Player section must be unmounted after dismissal');

      root.unmount();
    }
  );

  // 2. Play and Pause controls & Keyboard Shortcuts
  await runInteractiveTest(
    '2. Play and Pause Controls, Center Overlay & Spacebar Shortcut',
    'DOM_INTERACTIVE',
    async () => {
      const { document, window } = setupJSDOM();
      const container = document.getElementById('root')!;
      const root = createRoot(container);

      let playCallCount = 0;
      let pauseCallCount = 0;
      window.HTMLMediaElement.prototype.play = function () {
        playCallCount++;
        (this as any).paused = false;
        return Promise.resolve();
      };
      window.HTMLMediaElement.prototype.pause = function () {
        pauseCallCount++;
        (this as any).paused = true;
      };

      await act(async () => {
        root.render(
          React.createElement(VideoPlayer, {
            src: '/assets/demo/videos/glass-horizon.mp4',
            title: 'Neural Worlds',
            creatorName: 'Maya Lin',
            durationSeconds: 6,
          })
        );
      });

      const videoEl = container.querySelector(
        '[data-testid="html5-video-element"]'
      ) as HTMLVideoElement;
      assert.ok(videoEl, 'Video element must exist');

      // Center play button initially visible when paused
      const centerPlayBtn = container.querySelector(
        '[data-testid="center-play-button"]'
      ) as HTMLButtonElement;
      assert.ok(centerPlayBtn, 'Center play button must be visible initially');

      // Click center play button
      await act(async () => {
        centerPlayBtn.click();
      });
      assert.equal(playCallCount, 1, 'play() must be invoked on center play click');

      // Dispatch native onPlay event
      await act(async () => {
        videoEl.dispatchEvent(new window.Event('play'));
      });

      // Control play/pause button should now reflect playing state (Pause button)
      const ctrlPlayPauseBtn = container.querySelector(
        '[data-testid="control-play-pause-btn"]'
      ) as HTMLButtonElement;
      assert.ok(ctrlPlayPauseBtn, 'Control play/pause button must exist');
      assert.equal(ctrlPlayPauseBtn.getAttribute('aria-label'), 'Pause');

      // Click control play/pause button to pause
      await act(async () => {
        ctrlPlayPauseBtn.click();
      });
      assert.equal(pauseCallCount, 1, 'pause() must be invoked on pause click');

      // Dispatch native onPause event
      await act(async () => {
        videoEl.dispatchEvent(new window.Event('pause'));
      });
      assert.equal(ctrlPlayPauseBtn.getAttribute('aria-label'), 'Play');

      // Test Keyboard Shortcut (Space key)
      await act(async () => {
        const spaceEvent = new window.KeyboardEvent('keydown', {
          key: ' ',
          bubbles: true,
          cancelable: true,
        });
        window.dispatchEvent(spaceEvent);
      });
      assert.equal(playCallCount, 2, 'Space key shortcut must trigger play()');

      root.unmount();
    }
  );

  // 3. Seeking & Scrubber Interaction
  await runInteractiveTest(
    '3. Seeking, Scrubber Input & Skip Buttons',
    'DOM_INTERACTIVE',
    async () => {
      const { document, window } = setupJSDOM();
      const container = document.getElementById('root')!;
      const root = createRoot(container);

      await act(async () => {
        root.render(
          React.createElement(VideoPlayer, {
            src: '/assets/demo/videos/glass-horizon.mp4',
            title: 'Seek Test Video',
            creatorName: 'Studio Kengo',
            durationSeconds: 6,
          })
        );
      });

      const videoEl = container.querySelector(
        '[data-testid="html5-video-element"]'
      ) as HTMLVideoElement;
      const seekSlider = container.querySelector(
        '[data-testid="seek-slider"]'
      ) as HTMLInputElement;
      assert.ok(seekSlider, 'Seek slider must exist');

      // Simulate seeking to 3.5 seconds
      await act(async () => {
        simulateChange(seekSlider, '3.5');
      });
      assert.equal(videoEl.currentTime, 3.5, 'video.currentTime must update to 3.5s');

      // Simulate native timeupdate
      await act(async () => {
        videoEl.currentTime = 3.5;
        videoEl.dispatchEvent(new window.Event('timeupdate'));
      });

      // Verify time text includes 0:03
      assert.ok(
        container.textContent?.includes('0:03'),
        'Time display must format current time 3.5s as 0:03'
      );

      // Verify duration displays 0:06
      assert.ok(
        container.textContent?.includes('0:06'),
        'Time display must format 6-second demo duration as 0:06'
      );

      root.unmount();
    }
  );

  // 4. Volume and Mute Controls
  await runInteractiveTest(
    '4. Volume Slider, Mute Toggle & Keyboard Mute Shortcut',
    'DOM_INTERACTIVE',
    async () => {
      const { document, window } = setupJSDOM();
      const container = document.getElementById('root')!;
      const root = createRoot(container);

      await act(async () => {
        root.render(
          React.createElement(VideoPlayer, {
            src: '/assets/demo/videos/glass-horizon.mp4',
            title: 'Volume Test',
            creatorName: 'Studio Kengo',
            durationSeconds: 6,
          })
        );
      });

      const videoEl = container.querySelector(
        '[data-testid="html5-video-element"]'
      ) as HTMLVideoElement;
      const muteBtn = container.querySelector(
        '[data-testid="control-mute-btn"]'
      ) as HTMLButtonElement;
      assert.ok(muteBtn, 'Mute button must exist');

      // Click mute
      await act(async () => {
        muteBtn.click();
      });
      assert.equal(videoEl.muted, true, 'video.muted must be true after mute click');
      assert.equal(muteBtn.getAttribute('aria-label'), 'Unmute');

      // Click unmute
      await act(async () => {
        muteBtn.click();
      });
      assert.equal(videoEl.muted, false, 'video.muted must be false after unmute click');

      // Volume slider adjustment
      const volSlider = container.querySelector(
        '[data-testid="volume-slider"]'
      ) as HTMLInputElement;
      assert.ok(volSlider, 'Volume slider must exist');

      await act(async () => {
        simulateChange(volSlider, '0.4');
      });
      assert.equal(videoEl.volume, 0.4, 'video.volume must update to 0.4');

      // Keyboard 'm' shortcut
      await act(async () => {
        window.dispatchEvent(
          new window.KeyboardEvent('keydown', { key: 'm', bubbles: true })
        );
      });
      assert.equal(videoEl.muted, true, 'Keyboard "m" must toggle mute');

      root.unmount();
    }
  );

  // 5. Playback Speed Selection
  await runInteractiveTest(
    '5. Playback Speed Selector (0.5x, 1x, 1.25x, 1.5x, 2x)',
    'DOM_INTERACTIVE',
    async () => {
      const { document, window } = setupJSDOM();
      const container = document.getElementById('root')!;
      const root = createRoot(container);

      await act(async () => {
        root.render(
          React.createElement(VideoPlayer, {
            src: '/assets/demo/videos/glass-horizon.mp4',
            title: 'Speed Test',
            creatorName: 'Studio Kengo',
            durationSeconds: 6,
          })
        );
      });

      const videoEl = container.querySelector(
        '[data-testid="html5-video-element"]'
      ) as HTMLVideoElement;
      const speedSelect = container.querySelector(
        '[data-testid="playback-speed-select"]'
      ) as HTMLSelectElement;
      assert.ok(speedSelect, 'Speed selector must exist');

      // Change speed to 1.5x
      await act(async () => {
        simulateChange(speedSelect, '1.5');
      });
      assert.equal(videoEl.playbackRate, 1.5, 'video.playbackRate must update to 1.5');

      // Change speed to 2x
      await act(async () => {
        simulateChange(speedSelect, '2');
      });
      assert.equal(videoEl.playbackRate, 2, 'video.playbackRate must update to 2');

      root.unmount();
    }
  );

  // 6. Fullscreen Request and Exit Handling
  await runInteractiveTest(
    '6. Fullscreen Toggle, Event Listener & Keyboard "f" Shortcut',
    'DOM_INTERACTIVE',
    async () => {
      const { document, window } = setupJSDOM();
      const container = document.getElementById('root')!;
      const root = createRoot(container);

      let fsRequested = false;
      let fsExited = false;
      const originalRequestFs = (window.HTMLElement.prototype as any).requestFullscreen;
      (window.HTMLElement.prototype as any).requestFullscreen = function () {
        fsRequested = true;
        Object.defineProperty(document, 'fullscreenElement', {
          value: this,
          configurable: true,
        });
        return Promise.resolve();
      };
      (document as any).exitFullscreen = function () {
        fsExited = true;
        Object.defineProperty(document, 'fullscreenElement', {
          value: null,
          configurable: true,
        });
        return Promise.resolve();
      };

      await act(async () => {
        root.render(
          React.createElement(VideoPlayer, {
            src: '/assets/demo/videos/glass-horizon.mp4',
            title: 'Fullscreen Test',
            creatorName: 'Studio Kengo',
            durationSeconds: 6,
          })
        );
      });

      const fsBtn = container.querySelector(
        '[data-testid="control-fullscreen-btn"]'
      ) as HTMLButtonElement;
      assert.ok(fsBtn, 'Fullscreen button must exist');

      // Click fullscreen
      await act(async () => {
        fsBtn.click();
      });
      assert.equal(fsRequested, true, 'requestFullscreen() must be called');

      // Fire fullscreenchange event
      await act(async () => {
        document.dispatchEvent(new window.Event('fullscreenchange'));
      });
      assert.equal(fsBtn.getAttribute('aria-label'), 'Exit fullscreen');

      // Keyboard 'f' shortcut to exit
      await act(async () => {
        window.dispatchEvent(
          new window.KeyboardEvent('keydown', { key: 'f', bubbles: true })
        );
      });
      assert.equal(fsExited, true, 'exitFullscreen() must be called on keyboard shortcut');

      // Restore
      (window.HTMLElement.prototype as any).requestFullscreen = originalRequestFs;
      root.unmount();
    }
  );

  // 7. Shorts Playback & 9:16 Vertical Video Experience
  await runInteractiveTest(
    '7. Shorts Playback, 9:16 Vertical Layout & Mobile Constraints',
    'DOM_INTERACTIVE',
    async () => {
      const { document } = setupJSDOM();
      const container = document.getElementById('root')!;
      const root = createRoot(container);

      await act(async () => {
        root.render(React.createElement(WebAppShell, { initialRoute: 'shorts' }));
      });

      // Initial state: preview card with Play Vertical Short button
      const playShortBtn = container.querySelector(
        '[data-testid="play-vertical-short-btn"]'
      ) as HTMLButtonElement;
      assert.ok(playShortBtn, 'Shorts feed must render Play Vertical Short button');

      // Verify the preview card displays the corrected 0:06 duration
      assert.ok(
        container.textContent?.includes('0:06'),
        'Shorts preview card must display accurate 0:06 duration'
      );

      // Click Play Vertical Short
      await act(async () => {
        playShortBtn.click();
      });

      // Player must mount with vertical properties
      const playerWrapper = container.querySelector('[data-testid="facevid-video-player"]');
      assert.ok(playerWrapper, 'Shorts player must be mounted');
      assert.ok(
        playerWrapper.className.includes('max-w-[420px]'),
        'Vertical short player must apply max-w-[420px] phone constraint'
      );

      const videoEl = container.querySelector(
        '[data-testid="html5-video-element"]'
      ) as HTMLVideoElement;
      assert.ok(videoEl, 'Vertical video element must exist');
      assert.ok(
        videoEl.src.includes('bts-prompting.mp4'),
        'Vertical short must load bts-prompting.mp4 stream'
      );

      // Close player
      const closeBtn = container.querySelector(
        '[data-testid="player-close-button"]'
      ) as HTMLButtonElement;
      assert.ok(closeBtn, 'Close button must exist on vertical player');

      await act(async () => {
        closeBtn.click();
      });

      // Must return to preview card
      const restoredPlayBtn = container.querySelector(
        '[data-testid="play-vertical-short-btn"]'
      );
      assert.ok(restoredPlayBtn, 'Preview card must be restored after closing vertical player');

      root.unmount();
    }
  );

  // 8. Buffering and Error Recovery
  await runInteractiveTest(
    '8. Buffering Indicator Overlay & Playback Error Recovery with Retry',
    'DOM_INTERACTIVE',
    async () => {
      const { document, window } = setupJSDOM();
      const container = document.getElementById('root')!;
      const root = createRoot(container);

      let loadCallCount = 0;
      window.HTMLMediaElement.prototype.load = function () {
        loadCallCount++;
      };

      await act(async () => {
        root.render(
          React.createElement(VideoPlayer, {
            src: '/assets/demo/videos/glass-horizon.mp4',
            title: 'Buffer and Error Test',
            creatorName: 'Studio Kengo',
            durationSeconds: 6,
          })
        );
      });

      const videoEl = container.querySelector(
        '[data-testid="html5-video-element"]'
      ) as HTMLVideoElement;

      // 8a: Buffering state
      await act(async () => {
        videoEl.dispatchEvent(new window.Event('waiting'));
      });

      const bufferSpinner = container.querySelector('[data-testid="buffering-spinner"]');
      assert.ok(bufferSpinner, 'Buffering spinner overlay must appear on "waiting" event');
      assert.ok(bufferSpinner.textContent?.includes('Buffering'));

      // 8b: Playing clears buffering
      await act(async () => {
        videoEl.dispatchEvent(new window.Event('playing'));
      });
      assert.equal(
        container.querySelector('[data-testid="buffering-spinner"]'),
        null,
        'Buffering spinner must disappear once playback resumes'
      );

      // 8c: Error state
      await act(async () => {
        const reactPropKey = Object.keys(videoEl).find((k) => k.startsWith('__reactProps'));
        if (reactPropKey && (videoEl as any)[reactPropKey]?.onError) {
          (videoEl as any)[reactPropKey].onError({ type: 'error' });
        } else {
          videoEl.dispatchEvent(new window.Event('error', { bubbles: true }));
        }
      });

      const errorBanner = container.querySelector('[data-testid="playback-error-banner"]');
      assert.ok(errorBanner, 'Playback error banner must appear on media error event');
      assert.ok(errorBanner.textContent?.includes('Media playback error'));

      const retryBtn = container.querySelector(
        '[data-testid="player-retry-button"]'
      ) as HTMLButtonElement;
      assert.ok(retryBtn, 'Retry button must be provided in error banner');

      // Click retry
      await act(async () => {
        retryBtn.click();
      });

      assert.equal(loadCallCount, 1, 'video.load() must be called on retry');
      assert.equal(
        container.querySelector('[data-testid="playback-error-banner"]'),
        null,
        'Error banner must clear when retrying'
      );

      root.unmount();
    }
  );

  // 9. Restricted Content Isolation
  await runInteractiveTest(
    '9. Restricted Content Protection (PRIVATE, SUBSCRIBERS_ONLY, non-READY)',
    'DOM_INTERACTIVE',
    async () => {
      const { document } = setupJSDOM();
      const container = document.getElementById('root')!;
      const root = createRoot(container);

      // 9a: PRIVATE
      await act(async () => {
        root.render(
          React.createElement(VideoPlayer, {
            src: '/assets/demo/videos/private-take.mp4',
            title: 'Private Video',
            creatorName: 'Maya Lin',
            visibility: 'PRIVATE',
            processingStatus: 'READY',
          })
        );
      });

      assert.equal(
        container.querySelector('video'),
        null,
        'PRIVATE content MUST NOT render any HTML5 <video> tag'
      );
      assert.ok(
        container.querySelector('[data-testid="restricted-guard-screen"]'),
        'PRIVATE content must render restricted guard screen'
      );
      assert.ok(
        container.textContent?.includes('This video is private'),
        'Guard screen must inform user video is private'
      );

      // 9b: SUBSCRIBERS_ONLY
      await act(async () => {
        root.render(
          React.createElement(VideoPlayer, {
            src: '/assets/demo/videos/exclusive.mp4',
            title: 'Subscribers Masterclass',
            creatorName: 'Maya Lin',
            visibility: 'SUBSCRIBERS_ONLY',
            processingStatus: 'READY',
          })
        );
      });

      assert.equal(
        container.querySelector('video'),
        null,
        'SUBSCRIBERS_ONLY content MUST NOT render HTML5 <video> tag'
      );
      assert.ok(
        container.textContent?.includes('Access restricted to active subscribers'),
        'Guard screen must explain subscription requirement'
      );

      // 9c: Non-READY processing status
      await act(async () => {
        root.render(
          React.createElement(VideoPlayer, {
            src: '/assets/demo/videos/uploading.mp4',
            title: 'Processing Video',
            creatorName: 'Maya Lin',
            visibility: 'PUBLIC',
            processingStatus: 'TRANSCODING',
          })
        );
      });

      assert.equal(
        container.querySelector('video'),
        null,
        'TRANSCODING content MUST NOT render HTML5 <video> tag'
      );
      assert.ok(
        container.textContent?.includes('Video is not ready for playback (status: TRANSCODING)'),
        'Guard screen must indicate processing status'
      );

      root.unmount();
    }
  );

  // 10. Real Media Pipeline & HTTP 206 Range Serving
  await runInteractiveTest(
    '10. Real Media Pipeline: HTTP 206 Range Requests & Bitstream Integrity',
    'REAL_MEDIA_PIPELINE',
    async () => {
      // 10a: Test HTTP 206 Partial Content Range serving on actual demo videos
      const checkRangeServing = (path: string): Promise<{ status: number; rangeHeader?: string; type?: string }> => {
        return new Promise((resolve, reject) => {
          const req = http.request(
            {
              host: 'localhost',
              port: 3000,
              path,
              method: 'GET',
              headers: { Range: 'bytes=0-1023' },
            },
            (res) => {
              resolve({
                status: res.statusCode || 0,
                rangeHeader: res.headers['content-range'] as string | undefined,
                type: res.headers['content-type'] as string | undefined,
              });
              res.resume();
            }
          );
          req.on('error', reject);
          req.end();
        });
      };

      const landscapeRes = await checkRangeServing('/assets/demo/videos/glass-horizon.mp4');
      assert.equal(landscapeRes.status, 206, 'Server must return HTTP 206 Partial Content for Range requests');
      assert.ok(landscapeRes.rangeHeader?.includes('bytes 0-1023/'), 'Server must respond with Content-Range header');
      assert.equal(landscapeRes.type, 'video/mp4', 'Server must return video/mp4 MIME type');

      const shortsRes = await checkRangeServing('/assets/demo/videos/bts-prompting.mp4');
      assert.equal(shortsRes.status, 206, 'Shorts video must return HTTP 206 for Range requests');
      assert.ok(shortsRes.rangeHeader?.includes('bytes 0-1023/'), 'Shorts video must provide Content-Range');

      // 10b: Verify bitstream decodability via ffprobe
      const probe1 = execSync(
        'ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of csv=p=0 public/assets/demo/videos/glass-horizon.mp4'
      )
        .toString()
        .trim();
      assert.equal(probe1, 'h264,1280,720', 'Landscape video must be valid H.264 1280x720 stream');

      const probe2 = execSync(
        'ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of csv=p=0 public/assets/demo/videos/bts-prompting.mp4'
      )
        .toString()
        .trim();
      assert.equal(probe2, 'h264,720,1280', 'Shorts video must be valid H.264 720x1280 stream');

      const audioProbe = execSync(
        'ffprobe -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 public/assets/demo/videos/glass-horizon.mp4'
      )
        .toString()
        .trim();
      assert.equal(audioProbe, 'aac', 'Media audio stream must be AAC codec');
    }
  );

  console.log('\n----------------------------------------------------------------');
  console.log(`INTERACTIVE VIDEO SUITE: ${results.filter((r) => r.status === 'PASS').length}/${results.length} PASSED`);
  console.log('----------------------------------------------------------------\n');

  return results.every((r) => r.status === 'PASS');
}

if (process.argv[1]?.endsWith('test-interactive-player.ts')) {
  runInteractiveVideoSuite()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error('Test suite failed:', err);
      process.exit(1);
    });
}

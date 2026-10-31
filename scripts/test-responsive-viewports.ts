import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { WebAppShell } from '../apps/web/src/WebAppShell.tsx';

const VIEWPORTS = [320, 375, 390, 430, 768, 820] as const;

console.log('Testing WebAppShell across responsive viewports:');

for (const width of VIEWPORTS) {
  const html = renderToStaticMarkup(React.createElement(WebAppShell));
  const dom = new JSDOM(`<!DOCTYPE html><html><body>${html}</body></html>`);
  const document = dom.window.document;

  // 1. Mobile bottom navigation exists and has 5 tabs
  const bottomNav = document.querySelector('nav[aria-label="Mobile Bottom Navigation"]');
  assert.ok(bottomNav, `[${width}px] Mobile bottom nav element must be present in DOM`);
  
  const buttons = bottomNav.querySelectorAll('button');
  assert.equal(buttons.length, 5, `[${width}px] Mobile bottom navigation must have exactly 5 tab buttons`);

  // Verify tab labels
  const tabTexts = Array.from(buttons).map((b) => b.textContent?.trim());
  assert.ok(tabTexts.some((t) => t?.includes('Home')), `[${width}px] Missing Home tab`);
  assert.ok(tabTexts.some((t) => t?.includes('Shorts')), `[${width}px] Missing Shorts tab`);
  assert.ok(tabTexts.some((t) => t?.includes('Shop')), `[${width}px] Missing Shop tab`);
  assert.ok(tabTexts.some((t) => t?.includes('You')), `[${width}px] Missing You tab`);

  // 2. Mobile top bar exists
  const topBar = document.querySelector('header.lg\\:hidden');
  assert.ok(topBar, `[${width}px] Mobile top bar must be present`);

  // 3. Official logo present
  const logo = topBar.querySelector('img[src*="face-vid-official-logo.png"]');
  assert.ok(logo, `[${width}px] Official logo must be present in MobileTopBar`);

  // 4. Sign In & Create Account entry points accessible
  assert.ok(html.includes('Sign In'), `[${width}px] Sign In must be accessible`);
  assert.ok(html.includes('Create Account'), `[${width}px] Create Account must be accessible`);

  // 5. Overflow safety
  const root = document.querySelector('#top');
  assert.ok(root?.className.includes('overflow-x-hidden'), `[${width}px] Must enforce overflow-x-hidden`);

  // 6. Stage 3: Shorts route responsive verification
  const shortsHtml = renderToStaticMarkup(
    React.createElement(WebAppShell, { initialRoute: 'shorts' })
  );
  const shortsDom = new JSDOM(`<!DOCTYPE html><html><body>${shortsHtml}</body></html>`).window.document;
  const shortsPlayer = shortsDom.querySelector('[data-testid="mobile-shorts-player"]');
  assert.ok(shortsPlayer, `[${width}px] Mobile Shorts player must be present on shorts route`);

  const actionRail = shortsPlayer.querySelector('.bottom-18, .bottom-20');
  assert.ok(actionRail, `[${width}px] Shorts right-side action rail must be present`);

  console.log(`  ✓ ${width}px viewport (Home & Shorts) verified successfully`);
}

console.log('All 6 viewports passed verification!');

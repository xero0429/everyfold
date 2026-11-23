// 팝업 접근성 smoke: 키보드만으로 연결 → 동기화 → 정리 제안 → 설정(스위치·연결 해제 확인) → Esc 로 돌아오기,
// 그리고 모든 조작 요소에 이름이 있는지·포커스 링이 보이는지 확인한다. 가짜 runtime 으로 돈다(서버 없음).
// 실행: node scripts/a11y-smoke.mjs
import { rmSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { buildMockPopup } from './shots/build-mock.mjs';

const { work, url } = await buildMockPopup();
const browser = await chromium.launch({ channel: 'chromium' });
const fail = [];
const check = (ok, what) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${what}`); if (!ok) fail.push(what); };

async function unnamed(p) {
  return p.$$eval('button, input, select, [role="switch"]', (els) => els
    .filter((e) => e.offsetParent !== null || e.id === 'importFile')
    .filter((e) => {
      const lab = e.id && document.querySelector(`label[for="${e.id}"]`);
      return !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || lab?.textContent?.trim() || e.textContent?.trim());
    })
    .map((e) => e.id || e.outerHTML.slice(0, 60)));
}
const focused = (p) => p.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const ringVisible = (p) => p.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; });

try {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ colorScheme: scheme, locale: 'en-US', viewport: { width: 360, height: 600 } });
    await ctx.addInitScript(() => {
      window.__EF = {
        log: [], hang: [], responses: {},
        status: { connected: false, serverUrl: null, deviceName: null, lastSyncAt: null, lastError: null, lastImport: null, pendingMassDelete: null, failed: [], failedCount: 0, moveCaptures: false, showMoveHint: false },
        suggestions: [{ id: 's1', kind: 'remove_empty', title: 'Remove 2 empty categories', actions: [{}, {}] }],
      };
    });
    const p = await ctx.newPage();
    await p.goto(url);
    await p.waitForTimeout(150);
    console.log(`— ${scheme}`);

    check((await unnamed(p)).length === 0, `connect view: every control has a name ${JSON.stringify(await unnamed(p))}`);
    const order = [];
    for (let i = 0; i < 6; i++) { await p.keyboard.press('Tab'); order.push(await focused(p)); }
    check(order.join() === 'serverUrl,tokenKind,token,tokenReveal,deviceName,connectBtn', `connect tab order ${order.join(' → ')}`);
    await p.focus('#serverUrl');
    check(await ringVisible(p), 'focus ring on input');
    await p.keyboard.type('https://everyfold.example.workers.dev');
    await p.keyboard.press('Tab'); await p.keyboard.press('Tab');
    await p.keyboard.type('secret');
    await p.keyboard.press('Enter');
    await p.waitForSelector('#main:not([hidden])', { timeout: 3000 });
    check(true, 'connect with Enter from the token field');

    check((await unnamed(p)).length === 0, `main view: every control has a name ${JSON.stringify(await unnamed(p))}`);
    await p.focus('#openSettings');
    const mainOrder = ['openSettings'];
    for (let i = 0; i < 3; i++) { await p.keyboard.press('Tab'); mainOrder.push(await focused(p)); }
    check(mainOrder.join() === 'openSettings,syncNow,importFile,suggestNow', `main tab order ${mainOrder.join(' → ')}`);
    await p.focus('#syncNow');
    check(await ringVisible(p), 'focus ring on primary button');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.__EF.log.includes('sync'));
    check(true, 'Sync now with Enter');
    await p.focus('#importFile');
    check(await p.evaluate(() => { const r = document.getElementById('importRow'); return getComputedStyle(r).outlineStyle !== 'none'; }), 'file input focus shows ring on its row');
    await p.focus('#suggestNow');
    await p.keyboard.press('Space');
    await p.waitForSelector('#sugBox:not([hidden])', { timeout: 3000 });
    await p.keyboard.press('Tab');
    check((await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Apply: Remove 2 empty categories', 'suggestion Apply reachable with a specific name');

    await p.focus('#openSettings');
    await p.keyboard.press('Enter');
    check((await focused(p)) === 'settingsTitle' && !(await p.isHidden('#settings')), 'settings opens and moves focus to its title');
    await p.keyboard.press('Tab');
    check((await focused(p)) === 'moveCaptures', 'Tab from title reaches the Move switch');
    await p.keyboard.press('Space');
    await p.waitForFunction(() => window.__EF.log.includes('setMoveCaptures'));
    check(await p.isChecked('#moveCaptures'), 'Space toggles the Move switch');
    await p.keyboard.press('Tab');
    check((await focused(p)) === 'disconnect', 'Tab reaches Disconnect');
    await p.keyboard.press('Enter');
    check((await focused(p)) === 'disconnectNo' && !(await p.isHidden('#disconnectConfirm')), 'Disconnect asks first; focus on Cancel');
    await p.keyboard.press('Enter');
    check((await focused(p)) === 'disconnect' && !(await p.evaluate(() => window.__EF.log.includes('disconnect'))), 'Cancel returns focus, nothing sent');
    await p.keyboard.press('Escape');
    check((await focused(p)) === 'openSettings' && !(await p.isHidden('#main')), 'Esc closes settings and returns focus to the gear');
    await ctx.close();
  }
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}
if (fail.length) {
  console.log(`a11y smoke: ${fail.length} FAIL`);
  process.exitCode = 1;
} else console.log('a11y smoke: PASS');

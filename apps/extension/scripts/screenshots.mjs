// 팝업 상태별 스크린샷(라이트/다크). 백그라운드·서버 없이 가짜 runtime(shots/mock-browser.mjs)으로 그린다.
// 실행: node scripts/screenshots.mjs <출력 폴더> [접두어]
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildMockPopup } from './shots/build-mock.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? join(root, 'dist', 'shots'));
const prefix = process.argv[3] ?? '';
mkdirSync(outDir, { recursive: true });
const { work, url } = await buildMockPopup();

const hour = 3600_000;
const base = {
  connected: true, serverUrl: 'https://everyfold.example.workers.dev', deviceName: 'Work laptop · Chrome', lastSyncAt: Date.now() - 4 * 60_000,
  lastError: null, lastImport: { created: 214, mergedExisting: 12, mergedInFile: 3 }, pendingMassDelete: null, failed: [], failedCount: 0,
  moveCaptures: false, showMoveHint: false,
};
const sugs = [
  { id: 's1', kind: 'new_category', title: 'Create “Recipes” and move 6 bookmarks into it', actions: Array(7).fill({}) },
  { id: 's2', kind: 'remove_empty', title: 'Remove 2 empty categories', actions: Array(2).fill({}) },
];
const scenarios = [
  { name: 'connect', status: { ...base, connected: false, serverUrl: null, deviceName: null, lastSyncAt: null, lastImport: null } },
  {
    name: 'connect-error', status: { ...base, connected: false, serverUrl: null, deviceName: null, lastSyncAt: null, lastImport: null },
    responses: { connect: { error: 'HTTP 401 unauthorized' } },
    run: async (p) => {
      await p.fill('#serverUrl', 'https://everyfold.example.workers.dev');
      await p.fill('#token', 'wrong-token');
      await p.click('#connectBtn');
      await p.waitForTimeout(400);
    },
  },
  { name: 'connected', status: base, suggestions: sugs },
  { name: 'syncing', status: base, hang: ['sync'], run: async (p) => { await p.click('#syncNow'); await p.waitForTimeout(150); } },
  {
    name: 'failed',
    status: {
      ...base, lastSyncAt: Date.now() - 3 * hour, lastError: 'Failed to fetch', failedCount: 2,
      failed: [
        { title: 'Quarterly report draft', url: 'https://docs.example.com/q3', error: "Can't find parent bookmark", attempts: 2, gaveUp: false },
        { title: '', url: 'chrome://settings/', error: 'Invalid URL', attempts: 5, gaveUp: true },
      ],
    },
  },
  { name: 'mass', status: { ...base, pendingMassDelete: { deletes: 48, live: 60 } } },
  { name: 'server-outdated', status: { ...base, compat: 'server_outdated', serverVersion: '0.1.0' } },
  { name: 'server-blocked', status: { ...base, compat: 'server_blocked', serverVersion: '0.0.9', lastError: 'server_outdated' } },
  { name: 'move-hint', status: { ...base, showMoveHint: true, lastImport: { created: 214, mergedExisting: 12, mergedInFile: 3 } } },
  { name: 'suggest', status: base, suggestions: sugs, run: async (p) => { await p.click('#suggestNow'); await p.waitForTimeout(400); } },
  {
    name: 'import', status: base,
    responses: { importFile: { received: 3, created: 2, mergedExisting: 1, mergedInFile: 0, skippedUnsafe: 0 } },
    run: async (p) => {
      await p.setInputFiles('#importFile', { name: 'raindrop.csv', mimeType: 'text/csv', buffer: Buffer.from('url,title\n') });
      await p.waitForTimeout(400);
    },
  },
  { name: 'settings', status: { ...base, moveCaptures: true }, run: async (p) => { if (await p.$('#openSettings')) { await p.click('#openSettings'); await p.waitForTimeout(150); } else return 'skip'; } },
];

const browser = await chromium.launch({ channel: 'chromium' });
const made = [];
for (const scheme of ['light', 'dark']) {
  for (const sc of scenarios) {
    const ctx = await browser.newContext({ colorScheme: scheme, locale: 'en-US', reducedMotion: 'reduce', viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((s) => { window.__EF = { ...s, log: [] }; }, { status: sc.status, suggestions: sc.suggestions ?? [], hang: sc.hang ?? [], responses: sc.responses ?? {} });
    const p = await ctx.newPage();
    await p.goto(url);
    await p.waitForTimeout(200);
    if (sc.run && (await sc.run(p)) === 'skip') { await ctx.close(); continue; }
    // 팝업처럼 문서 몸통만 자른다(Chrome 팝업 최대 높이 600). 뷰포트를 줄였다 찍으면 헤드리스가 타일을 반복해 그려서 clip 을 쓴다.
    const box = await p.evaluate(() => { const r = document.body.getBoundingClientRect(); return { w: Math.ceil(r.width), h: Math.ceil(r.height) }; });
    const file = join(outDir, `${prefix}${sc.name}-${scheme}.png`);
    await p.screenshot({ path: file, clip: { x: 0, y: 0, width: box.w, height: Math.min(box.h, 600) } });
    made.push(file);
    await ctx.close();
  }
}
await browser.close();
rmSync(work, { recursive: true, force: true });
console.log(made.join('\n'));

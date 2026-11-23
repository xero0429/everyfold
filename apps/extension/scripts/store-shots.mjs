// 스토어 스크린샷 1280x800(Chrome Web Store 권장 크기, AMO 도 그대로 쓴다). 팝업은 screenshots.mjs 와 같은 가짜 runtime 으로 그린다.
// 실행: node scripts/store-shots.mjs [출력 폴더=dist/store/screenshots]
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildMockPopup } from './shots/build-mock.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? join(root, 'dist', 'store', 'screenshots'));
mkdirSync(outDir, { recursive: true });
const { work } = await buildMockPopup();

const base = {
  connected: true, serverUrl: 'https://everyfold.example.workers.dev', deviceName: 'Work laptop · Chrome', lastSyncAt: Date.now() - 4 * 60_000,
  lastError: null, lastImport: { created: 214, mergedExisting: 12, mergedInFile: 3 }, pendingMassDelete: null, failed: [], failedCount: 0,
  moveCaptures: false, showMoveHint: false, compat: 'ok', serverVersion: '0.1.0',
};
const sugs = [
  { id: 's1', kind: 'new_category', title: 'Create “Recipes” and move 6 bookmarks into it', actions: Array(7).fill({}) },
  { id: 's2', kind: 'apply_rules', title: 'Sort 9 uncategorized bookmarks by rules', actions: Array(9).fill({}) },
];
const scenes = [
  { name: '1-synced', title: 'One bookmark library for every browser', text: 'Chrome, Edge, Brave and Firefox share one <b>Everyfold</b> folder — kept in sync on a server you own.', status: base, suggestions: sugs },
  { name: '2-connect', title: 'Your own server, one-click deploy', text: 'Deploy the free Cloudflare Worker from GitHub, then paste its URL and your admin token. No account with us — there is no “us”.', status: { ...base, connected: false, serverUrl: null, deviceName: null, lastSyncAt: null, lastImport: null } },
  { name: '3-cleanup', title: 'Auto-organized, with your approval', text: 'New bookmarks land in category folders by rules and what you taught it. Cleanups are suggestions until you apply them.', status: base, suggestions: sugs, run: async (f) => { await f.click('#suggestNow'); await f.waitForTimeout(400); } },
  { name: '4-safety', title: 'Big deletes wait for you', text: 'Removing 20% or more of your bookmarks in one go pauses sync and asks first. Every change can be undone on the server.', status: { ...base, pendingMassDelete: { deletes: 48, live: 60 } } },
  { name: '5-settings', title: 'Copy or move — your call', text: 'Keep originals where you saved them, or move new bookmarks straight into their category.', status: { ...base, moveCaptures: true }, run: async (f) => { await f.click('#openSettings'); await f.waitForTimeout(150); } },
];

const esc = (s) => s.replace(/&(?!amp;)/g, '&amp;');
const page = (sc, scheme) => `<!doctype html><html><head><meta charset="utf-8"><style>
  :root { color-scheme: ${scheme}; }
  html, body { margin: 0; width: 1280px; height: 800px; overflow: hidden; }
  body { display: grid; grid-template-columns: 1fr 420px; align-items: center; gap: 72px; padding: 0 112px; box-sizing: border-box;
    font: 18px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif;
    background: ${scheme === 'dark' ? 'linear-gradient(135deg,#0f1320,#1b2140)' : 'linear-gradient(135deg,#eef1fb,#dfe5fb)'}; color: ${scheme === 'dark' ? '#e7e9f2' : '#141a33'}; }
  h1 { font-size: 44px; line-height: 1.15; margin: 0 0 20px; letter-spacing: -0.02em; }
  p { margin: 0; font-size: 21px; opacity: .85; max-width: 560px; }
  .brand { font-weight: 700; font-size: 18px; letter-spacing: .02em; margin-bottom: 28px; color: ${scheme === 'dark' ? '#8ea3ff' : '#3150d0'}; }
  .frame { width: 360px; height: 600px; border-radius: 14px; overflow: hidden; box-shadow: 0 24px 60px rgba(10,20,60,.28), 0 0 0 1px rgba(10,20,60,.12); justify-self: center; }
  iframe { width: 360px; height: 600px; border: 0; display: block; }
</style></head><body>
  <div><div class="brand">Everyfold</div><h1>${esc(sc.title)}</h1><p>${esc(sc.text)}</p></div>
  <div class="frame"><iframe src="popup.html" title="Everyfold popup"></iframe></div>
</body></html>`;

const browser = await chromium.launch({ channel: 'chromium' });
const made = [];
for (const scheme of ['light', 'dark']) {
  for (const sc of scenes) {
    const file = join(work, `store-${sc.name}-${scheme}.html`);
    writeFileSync(file, page(sc, scheme));
    const ctx = await browser.newContext({ colorScheme: scheme, locale: 'en-US', reducedMotion: 'reduce', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    await ctx.addInitScript((s) => { window.__EF = { ...s, log: [] }; }, { status: sc.status, suggestions: sc.suggestions ?? [], hang: [], responses: {} });
    const p = await ctx.newPage();
    await p.goto(`file://${file}`);
    await p.waitForTimeout(300);
    const frame = p.frames().find((f) => f.url().endsWith('popup.html'));
    if (!frame) throw new Error('popup frame not found');
    if (sc.run) await sc.run(frame);
    const shot = join(outDir, `${sc.name}-${scheme}.png`);
    await p.screenshot({ path: shot });
    made.push(shot);
    await ctx.close();
  }
}
await browser.close();
rmSync(work, { recursive: true, force: true });
console.log(made.join('\n'));

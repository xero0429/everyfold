// README 의 Hero GIF(docs/assets/everyfold-demo.gif)와 팝업 화면 캡처(docs/assets/screens/)를 만든다.
// 서버·실제 브라우저 북마크 없이: 팝업은 진짜 popup.html 을 가짜 runtime(shots/mock-browser.mjs)으로 그리고,
// 양옆의 "Chrome / Firefox 북마크" 창은 예시 데이터로 그린 그림이다(실데이터 없음). headless 로만 돈다.
// 실행: pnpm --filter @everyfold/extension readme-media [출력 폴더=docs/assets]   (ffmpeg 필요)
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { buildMockPopup } from './shots/build-mock.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(process.argv[2] ?? join(root, '..', '..', 'docs', 'assets'));
mkdirSync(outDir, { recursive: true });
const { work } = await buildMockPopup();
const frames = mkdtempSync(join(tmpdir(), 'everyfold-frames-'));

const W = 1200, H = 720;
const status0 = {
  connected: false, serverUrl: null, deviceName: null, lastSyncAt: null, lastError: null, lastImport: null,
  pendingMassDelete: null, failed: [], failedCount: 0, moveCaptures: false, showMoveHint: false, compat: 'ok', serverVersion: '0.1.1',
};
const sugs = [
  { id: 's1', kind: 'new_category', title: 'Create “Reading” and move 5 bookmarks into it', actions: Array(6).fill({}) },
  { id: 's2', kind: 'remove_empty', title: 'Remove 1 empty category', actions: Array(1).fill({}) },
];

// 예시 북마크(공개 사이트 이름 + example 도메인만)
const b = (name, host, hl = false) => ({ t: 'b', name, host, hl });
const f = (name, children, opts = {}) => ({ t: 'f', name, children, ...opts });
const library = (extra = {}) => f('Everyfold', [
  f('Dev', [b('MDN Web Docs', 'developer.mozilla.org'), b('GitHub', 'github.com')], { closed: !extra.open }),
  f('Reference', [b('Wikipedia', 'wikipedia.org')], { closed: true }),
  f('Travel', [b('Trip ideas', 'travel.example.com')], { closed: true }),
  f('Recipes', extra.ramen ? [b('Sourdough basics', 'bread.example.com'), b('Weeknight ramen', 'recipes.example.com', extra.hl)] : [b('Sourdough basics', 'bread.example.com')], { closed: !extra.open && !extra.ramen }),
], { hl: extra.hlRoot, tag: true });
// Everyfold 폴더는 실제처럼 Chrome "Other bookmarks" / Firefox "Other Bookmarks" 안에 생긴다
const chrome = (lib, ramen = 0) => [
  f('Bookmarks bar', [b('MDN Web Docs', 'developer.mozilla.org'), b('Team wiki', 'wiki.example.com'), ...(ramen ? [b('Weeknight ramen', 'recipes.example.com', ramen === 2)] : [])]),
  f('Other bookmarks', [f('old stuff', [b('Trip ideas', 'travel.example.com')], { closed: true }), ...(lib ? [library(lib)] : [])]),
];
const firefox = (lib) => [
  f('Bookmarks Toolbar', [b('Wikipedia', 'wikipedia.org')]),
  f('Other Bookmarks', [b('Weather', 'weather.example.com'), ...(lib ? [library(lib)] : [])]),
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { font: 14px/1.4 -apple-system, "Segoe UI", system-ui, sans-serif; color: #141a33;
    background: linear-gradient(135deg,#eef1fb,#dfe5fb); padding: 22px 40px 0; }
  .cap { height: 64px; display: flex; align-items: center; gap: 14px; }
  .step { flex: none; width: 34px; height: 34px; border-radius: 50%; background: #3150d0; color: #fff; font-weight: 700; display: grid; place-items: center; font-size: 17px; }
  .cap h1 { margin: 0; font-size: 26px; letter-spacing: -0.01em; }
  .cap .brand { margin-left: auto; font-weight: 700; color: #3150d0; font-size: 18px; }
  .row { display: grid; grid-template-columns: 1fr 360px 1fr; gap: 32px; align-items: start; margin-top: 10px; }
  .win { background: #fff; border-radius: 12px; box-shadow: 0 16px 40px rgba(10,20,60,.16), 0 0 0 1px rgba(10,20,60,.08); overflow: hidden; height: 600px; }
  .bar { height: 38px; display: flex; align-items: center; gap: 7px; padding: 0 12px; background: #f1f3f8; border-bottom: 1px solid #e2e6f0; font-weight: 600; font-size: 13px; color: #3b4263; }
  .dot { width: 11px; height: 11px; border-radius: 50%; background: #d5d9e6; }
  .bar .name { margin-left: 8px; }
  .bar .sub { margin-left: auto; font-weight: 500; color: #7a819c; font-size: 12px; }
  .tree { padding: 10px 8px; }
  .tree ul { list-style: none; margin: 0; padding-left: 16px; }
  .tree > ul { padding-left: 0; }
  .tree li { margin: 1px 0; }
  .it { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 6px; white-space: nowrap; transition: none; }
  .it .host { color: #8a90a8; font-size: 12px; overflow: hidden; text-overflow: ellipsis; }
  .ico { flex: none; width: 15px; height: 12px; border-radius: 2px; background: #f0b429; position: relative; }
  .ico::before { content: ''; position: absolute; left: 0; top: -3px; width: 7px; height: 4px; border-radius: 2px 2px 0 0; background: #f0b429; }
  .ico.bm { width: 14px; height: 14px; border-radius: 50%; background: #c9d1ea; }
  .ico.bm::before { display: none; }
  .ico.ef { background: #3150d0; } .ico.ef::before { background: #3150d0; }
  .tag { font-size: 11px; font-weight: 600; color: #3150d0; background: #e5eafc; border-radius: 999px; padding: 1px 7px; }
  .hl > .it { background: #fff4c2; box-shadow: inset 0 0 0 1.5px #f0b429; }
  .new { font-size: 11px; font-weight: 700; color: #9a6b00; }
  .popup { height: 600px; border-radius: 12px; overflow: hidden; box-shadow: 0 24px 60px rgba(10,20,60,.28), 0 0 0 1px rgba(10,20,60,.12); background: Canvas; }
  iframe { width: 360px; height: 600px; border: 0; display: block; }
  .lbl { text-align: center; font-size: 12px; color: #6a7190; margin-top: 8px; }
</style></head><body>
  <div class="cap"><div class="step" id="step">1</div><h1 id="title"></h1><div class="brand">Everyfold</div></div>
  <div class="row">
    <div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="name">Chrome</span><span class="sub">Bookmarks</span></div><div class="tree" id="chrome"></div></div>
    <div><div class="popup"><iframe src="popup.html" title="Everyfold popup"></iframe></div></div>
    <div class="win"><div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="name">Firefox</span><span class="sub">Bookmarks</span></div><div class="tree" id="firefox"></div></div>
  </div>
<script>
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const node = (n) => n.t === 'b'
    ? '<li class="' + (n.hl ? 'hl' : '') + '"><div class="it"><span class="ico bm"></span>' + esc(n.name) + ' <span class="host">' + esc(n.host) + '</span>' + (n.hl ? ' <span class="new">NEW</span>' : '') + '</div></li>'
    : '<li class="' + (n.hl ? 'hl' : '') + '"><div class="it"><span class="ico' + (n.tag ? ' ef' : '') + '"></span>' + esc(n.name) + (n.tag ? ' <span class="tag">synced</span>' : '') + (n.closed ? ' <span class="host">(' + n.children.length + ')</span>' : '') + '</div>' + (n.closed ? '' : '<ul>' + n.children.map(node).join('') + '</ul>') + '</li>';
  window.scene = (s) => {
    document.getElementById('step').textContent = s.step;
    document.getElementById('title').textContent = s.title;
    document.getElementById('chrome').innerHTML = '<ul>' + s.chrome.map(node).join('') + '</ul>';
    document.getElementById('firefox').innerHTML = '<ul>' + s.firefox.map(node).join('') + '</ul>';
  };
</script></body></html>`;
writeFileSync(join(work, 'stage.html'), html);

const browser = await chromium.launch({ channel: 'chromium' });
const ctx = await browser.newContext({ colorScheme: 'light', locale: 'en-US', reducedMotion: 'reduce', viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await ctx.addInitScript((s) => { window.__EF = { ...s, log: [] }; }, { status: status0, suggestions: [], hang: [], responses: {}, delay: { connect: 900, sync: 900, generateSuggestions: 700 } });
const p = await ctx.newPage();
await p.goto(`file://${join(work, 'stage.html')}`);
await p.waitForTimeout(300);
const pop = p.frames().find((fr) => fr.url().endsWith('popup.html'));
if (!pop) throw new Error('popup frame not found');

const list = [];
let n = 0;
async function shot(sec) {
  const file = join(frames, `f${String(n++).padStart(3, '0')}.png`);
  await p.screenshot({ path: file });
  list.push(`file '${file}'\nduration ${sec}`);
}
const scene = (s) => p.evaluate((x) => window.scene(x), s);

// 1. 연결
await scene({ step: 1, title: 'Connect each browser to your own server', chrome: chrome(), firefox: firefox() });
await shot(1.4);
await pop.fill('#serverUrl', 'https://everyfold.example.workers.dev');
await shot(0.6);
await pop.fill('#token', 'a1b2c3d4e5f6a7b8c9d0');
await pop.fill('#deviceName', 'Work laptop · Chrome');
await shot(0.8);
await pop.evaluate(() => { window.__EF.status = { ...window.__EF.status, lastImport: { created: 214, mergedExisting: 12, mergedInFile: 3 } }; });
await pop.click('#connectBtn');
await p.waitForTimeout(120);
await shot(0.8);
await p.waitForTimeout(1100);
// 2. 라이브러리 생김
await scene({ step: 2, title: 'Your bookmarks are copied into one Everyfold library', chrome: chrome({ hlRoot: true, open: true }), firefox: firefox({ hlRoot: true, open: true }) });
await shot(2.6);
// 3. 아무 데나 새 북마크
await scene({ step: 3, title: 'Save a bookmark anywhere in any browser…', chrome: chrome({}, 2), firefox: firefox({}) });
await shot(2.0);
await pop.click('#syncNow');
await p.waitForTimeout(120);
await shot(0.8);
await p.waitForTimeout(1100);
// 4. 모든 브라우저의 카테고리 폴더에
await scene({ step: 3, title: '…it lands in the right category, in every browser', chrome: chrome({ ramen: true, hl: true }, 1), firefox: firefox({ ramen: true, hl: true }) });
await shot(2.8);
// 5. 정리 제안
await scene({ step: 4, title: 'Cleanup ideas wait for your approval', chrome: chrome({ ramen: true }, 1), firefox: firefox({ ramen: true }) });
await pop.evaluate((x) => { window.__EF.suggestions = x; }, sugs);
await pop.click('#suggestNow');
await p.waitForTimeout(120);
await shot(0.7);
await p.waitForTimeout(900);
await shot(3.2);
list.push(list.at(-1).split('\n')[0]); // concat demuxer: 마지막 프레임을 한 번 더 적어야 마지막 duration 이 먹는다
writeFileSync(join(frames, 'list.txt'), list.join('\n') + '\n');
await browser.close();

const gif = join(outDir, 'everyfold-demo.gif');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'),
  '-vf', 'fps=10,scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a',
  '-loop', '0', gif]);
rmSync(work, { recursive: true, force: true });
rmSync(frames, { recursive: true, force: true });
// 화면 캡처: 팝업만(screenshots.mjs 와 같은 장면, 라이트/다크) 중 README 에 쓰는 4장
const screens = join(outDir, 'screens');
const tmpShots = mkdtempSync(join(tmpdir(), 'everyfold-shots-'));
execFileSync('node', [join(root, 'scripts', 'screenshots.mjs'), tmpShots], { stdio: 'ignore' });
rmSync(screens, { recursive: true, force: true });
mkdirSync(screens, { recursive: true });
for (const name of ['connect', 'connected', 'mass', 'settings']) for (const s of ['light', 'dark']) cpSync(join(tmpShots, `${name}-${s}.png`), join(screens, `${name}-${s}.png`));
rmSync(tmpShots, { recursive: true, force: true });
console.log(gif + '\n' + screens);

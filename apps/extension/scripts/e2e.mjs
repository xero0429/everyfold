// 실제 브라우저 e2e: 로컬 wrangler dev(로컬 D1) + Playwright Chromium(Chrome for Testing) 에 dist/chrome 언팩 로드.
// 1) popup 에서 연결 → 첫 업로드  2) 브라우저에서 북마크를 만들면 서버에 들어간다  3) 서버(다른 기기)에서 만든 것이 브라우저에 내려온다.
// 4) 열린 창 저장(#3241): tabs 권한을 준 두 번째 프로필에서 저장 → 첫 프로필(tabs 권한 없음)이 동기화로 받아 복구 → 창·주소 확인.
//    headless 로만 돈다(사용자 화면에 창을 띄우거나 포커스를 뺏지 않는다). E2E_HEADED 는 사람이 직접 볼 때만.
// 실행: pnpm build && pnpm e2e   (Chromium 없으면: npx playwright-core install chromium)
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, '..', 'dist', 'chrome');
const serverDir = join(here, '..', '..', 'server');
const wrangler = join(serverDir, 'node_modules', '.bin', 'wrangler');
const config = join(serverDir, '..', '..', 'wrangler.toml');
const PORT = Number(process.env.E2E_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = 'e2e-admin-token';
const work = mkdtempSync(join(tmpdir(), 'everyfold-e2e-'));
const persist = join(work, 'state');
const step = (s) => console.log(`[e2e] ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, what, ms = 30000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${what}: ${last}`);
}

let dev;
let ctx;
let ctx2;
try {
  step('apply D1 migrations (local)');
  execFileSync(wrangler, ['d1', 'migrations', 'apply', 'DB', '--local', '-c', config, '--persist-to', persist], { cwd: serverDir, stdio: 'inherit', env: { ...process.env, CI: '1' } });
  step('start wrangler dev');
  dev = spawn(wrangler, ['dev', '-c', config, '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist, '--var', `ADMIN_TOKEN:${ADMIN}`], { cwd: serverDir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
  dev.stdout.on('data', (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  dev.stderr.on('data', (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  await waitFor(async () => (await fetch(BASE + '/')).ok, 'server');

  step('launch Chromium with extension');
  ctx = await chromium.launchPersistentContext(join(work, 'profile'), {
    headless: process.env.E2E_HEADED ? false : true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--lang=en-US'],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  const extId = new URL(sw.url()).host;
  step(`extension id ${extId}`);

  // 기존 북마크(첫 업로드 대상)
  await sw.evaluate(() => chrome.bookmarks.create({ parentId: '1', title: 'Existing GitHub', url: 'https://github.com/' }));

  step('connect from popup');
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  if (process.env.E2E_SHOTS) await popup.screenshot({ path: join(process.env.E2E_SHOTS, 'e2e-connect.png'), clip: { x: 0, y: 0, width: 360, height: 560 } });
  await popup.fill('#serverUrl', BASE);
  await popup.fill('#token', ADMIN);
  await popup.fill('#deviceName', 'e2e-chromium');
  await popup.click('#connectBtn');
  await popup.waitForSelector('#main:not([hidden])', { timeout: 20000 });
  // E2E_SHOTS=<폴더> 면 실제 확장(실 CSP) 팝업 화면을 남긴다
  const shot = async (name) => process.env.E2E_SHOTS && popup.screenshot({ path: join(process.env.E2E_SHOTS, `e2e-${name}.png`), clip: { x: 0, y: 0, width: 360, height: Math.min(600, await popup.evaluate(() => Math.ceil(document.body.getBoundingClientRect().height))) } });
  const token = await sw.evaluate(async () => (await chrome.storage.local.get('everyfold.state'))['everyfold.state'].token);
  const api = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return r.json();
  };
  const serverUrls = async () => (await api('GET', '/sync/pull?since=0&limit=5000')).nodes.filter((n) => n.kind === 'bookmark' && !n.deleted).map((n) => n.url);

  await waitFor(async () => (await serverUrls()).includes('https://github.com/'), 'first upload on server');
  step('OK first upload reached server');
  // 서버 판 확인(GET /version): 같은 리포의 서버면 호환 경고가 없어야 한다
  const srv = await sw.evaluate(async () => (await chrome.storage.local.get('everyfold.state'))['everyfold.state'].server);
  if (srv?.compat !== 'ok' || !srv.version) throw new Error(`server version check: ${JSON.stringify(srv)}`);
  if (!(await popup.$eval('#compat', (e) => e.hidden))) throw new Error('compat warning shown against a current server');
  step(`OK server v${srv.version} (api ${srv.api}) compatible, no warning`);

  step('create bookmark in browser (outside Everyfold folder) → background sync');
  await sw.evaluate(() => chrome.bookmarks.create({ parentId: '1', title: 'MDN', url: 'https://developer.mozilla.org/' }));
  await waitFor(async () => (await serverUrls()).includes('https://developer.mozilla.org/'), 'captured bookmark on server');
  step('OK browser bookmark reached server');

  step('server-side change (another device) → pulled into browser');
  const other = await (await fetch(BASE + '/devices', { method: 'POST', headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'other' }) })).json();
  const imp = await (await fetch(BASE + '/import', { method: 'POST', headers: { authorization: `Bearer ${other.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ items: [{ url: 'https://news.ycombinator.com/', title: 'HN' }] }) })).json();
  if (!imp.created) throw new Error('other-device import failed ' + JSON.stringify(imp));
  await popup.click('#syncNow');
  await waitFor(async () => (await sw.evaluate(() => chrome.bookmarks.search({ url: 'https://news.ycombinator.com/' }))).length > 0, 'pulled bookmark in browser');
  step('OK server bookmark appeared in browser');

  step('import a Raindrop CSV from the popup');
  await popup.setInputFiles('#importFile', join(here, '..', '..', '..', 'packages', 'core', 'test', 'fixtures', 'import', 'raindrop.csv'));
  await popup.waitForFunction(() => /^Imported|failed/.test(document.getElementById('importResult')?.textContent ?? ''), null, { timeout: 20000 });
  const msg = await popup.textContent('#importResult');
  if (!/^Imported 3/.test(msg ?? '')) throw new Error('popup import: ' + msg);
  await waitFor(async () => (await sw.evaluate(() => chrome.bookmarks.search({ url: 'https://example.net/' }))).length > 0, 'imported bookmark in browser');
  step(`OK ${msg}`);

  step('one-time Move hint → "Turn on" → a new bookmark is moved (one copy in the browser)');
  await popup.reload();
  await popup.waitForSelector('#moveHint:not([hidden])', { timeout: 10000 });
  await popup.click('#moveHintOn');
  await popup.waitForSelector('#moveHint[hidden]', { state: 'attached', timeout: 10000 });
  if (!(await popup.isChecked('#moveCaptures'))) throw new Error('move setting not on after Turn on');
  await sw.evaluate(() => chrome.bookmarks.create({ parentId: '1', title: 'Moved', url: 'https://moved.example/1' }));
  await waitFor(async () => (await serverUrls()).includes('https://moved.example/1'), 'moved bookmark on server');
  await popup.click('#syncNow');
  await waitFor(async () => {
    const hits = await sw.evaluate(() => chrome.bookmarks.search({ url: 'https://moved.example/1' }));
    return hits.length === 1 && hits[0].parentId !== '1';
  }, 'bookmark moved out of the bookmarks bar (single copy)');
  step('OK moved into Everyfold');

  step('Suggest cleanup button');
  await popup.click('#suggestNow');
  await popup.waitForFunction(() => {
    const t = document.getElementById('sugResult')?.textContent ?? '';
    return !document.getElementById('sugBox')?.hidden || (t && t !== 'Looking for cleanups…');
  }, null, { timeout: 20000 });
  step(`OK suggestions: ${await popup.$$eval('#suggestions li', (l) => l.length)} · ${await popup.textContent('#sugResult')}`);
  await shot('connected');

  /* ── 열린 창 저장·복구(#3241) ── */
  step('sessions: tabs is an optional permission in the shipped build (not granted on install)');
  const hasTabs = await sw.evaluate(() => chrome.permissions.contains({ permissions: ['tabs'] }));
  if (hasTabs) throw new Error('tabs granted without asking');
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  if (manifest.permissions.includes('tabs') || !manifest.optional_permissions?.includes('tabs')) throw new Error('manifest tabs permission: ' + JSON.stringify(manifest));
  step('OK tabs optional, not granted');

  // 저장 쪽 프로필: 사람이 "허용" 을 누른 상태를 흉내 내려고 tabs 를 필수 권한으로 넣은 사본을 쓴다(headless 에서는 권한 창을 누를 수 없다)
  const extTabs = join(work, 'ext-tabs');
  cpSync(ext, extTabs, { recursive: true });
  const mf = JSON.parse(readFileSync(join(extTabs, 'manifest.json'), 'utf8'));
  mf.permissions = [...mf.permissions, 'tabs'];
  writeFileSync(join(extTabs, 'manifest.json'), JSON.stringify(mf, null, 2));
  ctx2 = await chromium.launchPersistentContext(join(work, 'profile2'), {
    headless: process.env.E2E_HEADED ? false : true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${extTabs}`, `--load-extension=${extTabs}`, '--lang=en-US'],
  });
  const sw2 = ctx2.serviceWorkers()[0] ?? (await ctx2.waitForEvent('serviceworker', { timeout: 20000 }));
  const extId2 = new URL(sw2.url()).host;
  const popup2 = await ctx2.newPage();
  await popup2.goto(`chrome-extension://${extId2}/popup.html`);
  await popup2.fill('#serverUrl', BASE);
  await popup2.fill('#token', ADMIN);
  await popup2.fill('#deviceName', 'e2e-saver');
  await popup2.click('#connectBtn');
  await popup2.waitForSelector('#main:not([hidden])', { timeout: 20000 });
  step('sessions: second browser connected; opening 3 web pages in 2 windows');
  const p1 = await ctx2.newPage();
  await p1.goto(BASE + '/');
  const p2 = await ctx2.newPage();
  await p2.goto(BASE + '/version');
  // 두 번째 창(windows.create — headless 라 화면에 안 뜬다)
  await sw2.evaluate((u) => chrome.windows.create({ url: [u + '/?w=2', 'chrome://version/'] }), BASE);
  await waitFor(async () => ctx2.pages().some((p) => p.url() === BASE + '/?w=2'), 'second window page');
  const winsBefore = await sw2.evaluate(() => chrome.windows.getAll({ populate: true, windowTypes: ['normal'] }).then((ws) => ws.map((w) => w.tabs.map((t) => t.url))));
  step(`sessions: windows before save ${JSON.stringify(winsBefore)}`);

  await popup2.bringToFront();
  // 세션 문구는 브라우저 UI 언어를 따른다(macOS Chromium 은 --lang 을 무시하고 시스템 언어를 쓴다) → 기대 문구를 UI 언어로 고른다
  const uiLang = await sw2.evaluate(() => chrome.i18n.getUILanguage());
  const T = /^ko/i.test(uiLang)
    ? { saved: /^창 2개 · 탭 3개 저장 · \d+개 건너뜀/, restored: '창 2개를 열었습니다.', meta: '창 2개 · 탭 3개', done: /열었습니다|실패|없습니다/, deleted: /지웠습니다/ }
    : { saved: /^Saved 2 windows, 3 tabs · \d+ skipped/, restored: 'Opened 2 windows.', meta: '2 windows · 3 tabs', done: /^Opened|failed|gone/i, deleted: /Deleted/ };
  step(`sessions: browser UI language ${uiLang}`);
  await popup2.click('#saveSession');
  await popup2.waitForFunction(() => /^Saved|needs|Update|No tabs|failed|저장 ·|저장$|권한|서버를|탭이 없/i.test(document.getElementById('sessionResult')?.textContent ?? ''), null, { timeout: 30000 })
    .catch(async (e) => { throw new Error(`save never finished: ${JSON.stringify(await popup2.textContent('#sessionResult'))} (${e.message})`); });
  const saved = await popup2.textContent('#sessionResult');
  if (!T.saved.test(saved ?? '')) throw new Error('save: ' + saved);
  step(`OK popup: ${saved}`);
  const all = (await api('GET', '/sync/pull?since=0&limit=5000')).nodes.filter((n) => !n.deleted);
  const sessionsFolder = all.find((n) => n.key === 'sessions');
  if (!sessionsFolder || sessionsFolder.parentId !== null) throw new Error('sessions folder on server: ' + JSON.stringify(sessionsFolder));
  const sessionNode = all.find((n) => n.parentId === sessionsFolder.id);
  const winFolders = all.filter((n) => n.parentId === sessionNode?.id).sort((a, b) => a.position - b.position);
  const tabsOn = (w) => all.filter((n) => n.parentId === w.id).sort((a, b) => a.position - b.position).map((n) => n.url);
  const serverShape = winFolders.map((w) => [w.title, tabsOn(w)]);
  step(`sessions: server ${sessionsFolder.title}/${sessionNode?.title} ${JSON.stringify(serverShape)}`);
  const want = [[BASE + '/', BASE + '/version'], [BASE + '/?w=2']];
  if (JSON.stringify(serverShape.map((x) => x[1])) !== JSON.stringify(want)) throw new Error('server session shape');
  step('OK session reached the server as <Sessions>/<date · device>/<Window n>/<tabs>');

  step('sessions: first browser (no tabs permission) syncs and restores');
  await popup.click('#syncNow');
  // 동기화가 끝나기 전에 열면 창 일부만 보인다 → 목록이 2창·3탭이 될 때까지 다시 연다
  await waitFor(async () => {
    await popup.reload();
    await popup.waitForSelector('#sessions li', { timeout: 5000 }).catch(() => undefined);
    return (await popup.$$eval('#sessions li', (l) => l.map((x) => x.textContent ?? ''))).some((t) => t.includes(T.meta));
  }, 'session listed with 2 windows · 3 tabs', 30000);
  const listed = await popup.$$eval('#sessions li', (l) => l.map((x) => x.textContent));
  step(`sessions: listed ${JSON.stringify(listed)}`);
  const pagesBefore = ctx.pages().length;
  await popup.click('#sessions li button.primary');
  await popup.waitForFunction((src) => new RegExp(src, 'i').test(document.getElementById('sessionResult')?.textContent ?? ''), T.done.source, { timeout: 20000 });
  const restored = await popup.textContent('#sessionResult');
  if (restored !== T.restored) throw new Error('restore: ' + restored);
  await waitFor(async () => {
    const urls = ctx.pages().map((p) => p.url());
    return want.flat().every((u) => urls.includes(u));
  }, 'restored pages');
  const restoredWins = await sw.evaluate(() => chrome.windows.getAll({ windowTypes: ['normal'] }).then((ws) => ws.length));
  step(`OK restore without tabs permission: ${restored} pages ${pagesBefore}→${ctx.pages().length}, normal windows now ${restoredWins}`);
  if (await sw.evaluate(() => chrome.permissions.contains({ permissions: ['tabs'] }))) throw new Error('restore needed tabs?');

  step('sessions: Save in the browser without tabs permission (headless permission prompt)');
  await popup.bringToFront().catch(() => undefined);
  await popup.click('#saveSession');
  const deniedText = await popup.waitForFunction((r) => document.getElementById('sessionResult')?.textContent !== r && document.getElementById('sessionResult')?.textContent, T.restored, { timeout: 8000 })
    .then((h) => h.jsonValue()).catch(() => '(no answer in 8s — prompt left open)');
  step(`sessions: refused/unanswered prompt → ${JSON.stringify(deniedText)}`);
  // 권한이 없어도 나머지 기능은 그대로
  await popup.click('#syncNow');
  await waitFor(async () => (await popup.textContent('#syncBadgeText')) === 'Up to date', 'sync still ok after refusal', 20000);
  step('OK sync still works after the permission was not granted');

  step('sessions: delete from the first browser → gone on the saver after sync');
  await popup.click('#sessions li button.ghost');
  await popup.click('#sessions li button.danger');
  await popup.waitForFunction((src) => new RegExp(src).test(document.getElementById('sessionResult')?.textContent ?? ''), T.deleted.source, { timeout: 20000 });
  await popup2.click('#syncNow');
  await waitFor(async () => (await sw2.evaluate((u) => chrome.bookmarks.search({ url: u }), BASE + '/?w=2')).length === 0, 'deleted on the other browser');
  step('OK session deleted everywhere');
  console.log('[e2e] PASS');
} catch (e) {
  console.error('[e2e] FAIL', e);
  process.exitCode = 1;
} finally {
  await ctx?.close().catch(() => undefined);
  await ctx2?.close().catch(() => undefined);
  dev?.kill('SIGTERM');
  rmSync(work, { recursive: true, force: true });
}

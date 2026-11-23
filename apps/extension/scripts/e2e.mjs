// 실제 브라우저 e2e: 로컬 wrangler dev(로컬 D1) + Playwright Chromium(Chrome for Testing) 에 dist/chrome 언팩 로드.
// 1) popup 에서 연결 → 첫 업로드  2) 브라우저에서 북마크를 만들면 서버에 들어간다  3) 서버(다른 기기)에서 만든 것이 브라우저에 내려온다.
// 실행: pnpm build && pnpm e2e   (Chromium 없으면: npx playwright-core install chromium)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
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
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 20000 }));
  const extId = new URL(sw.url()).host;
  step(`extension id ${extId}`);

  // 기존 북마크(첫 업로드 대상)
  await sw.evaluate(() => chrome.bookmarks.create({ parentId: '1', title: 'Existing GitHub', url: 'https://github.com/' }));

  step('connect from popup');
  const popup = await ctx.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.fill('#serverUrl', BASE);
  await popup.fill('#token', ADMIN);
  await popup.fill('#deviceName', 'e2e-chromium');
  await popup.click('#connectBtn');
  await popup.waitForSelector('#main:not([hidden])', { timeout: 20000 });
  const token = await sw.evaluate(async () => (await chrome.storage.local.get('everyfold.state'))['everyfold.state'].token);
  const api = async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return r.json();
  };
  const serverUrls = async () => (await api('GET', '/sync/pull?since=0&limit=5000')).nodes.filter((n) => n.kind === 'bookmark' && !n.deleted).map((n) => n.url);

  await waitFor(async () => (await serverUrls()).includes('https://github.com/'), 'first upload on server');
  step('OK first upload reached server');

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
  console.log('[e2e] PASS');
} catch (e) {
  console.error('[e2e] FAIL', e);
  process.exitCode = 1;
} finally {
  await ctx?.close().catch(() => undefined);
  dev?.kill('SIGTERM');
  rmSync(work, { recursive: true, force: true });
}

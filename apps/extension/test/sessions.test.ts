import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from '@everyfold/server/testing';
import { app } from '@everyfold/server';
import { SESSIONS_KEY, type SessionWindowInput } from '@everyfold/core';
import { SESSION_EMPTY, SESSIONS_SERVER_OUTDATED, SyncEngine } from '../src/engine.js';
import { restoreSession, saveOpenWindows, sessionPermissions, TABS_PERMISSION, type SessionDeps } from '../src/sessions.js';
import { SESSION_TEXT, sessionError, sessionText } from '../src/popup-text.js';
import { FakeBookmarks, MemKV } from './fake-bookmarks.js';

/**
 * #3241 열린 창 저장·복구 — 실제 Worker 앱 + 로컬 D1 에 가짜 북마크 두 브라우저(A=Chrome 모양, B=Firefox 모양)를 붙여 끝까지 돌린다.
 *  (a) 저장 → 북마크 트리 모양  (b) 못 담는 주소 건너뜀·개수  (d) 권한 거절 때 나머지 기능 정상  (e) 복구가 창 수·주소대로 연다
 *  ((c) 서버 분류·정리 제외는 apps/server/test/sessions.test.ts)
 */
let t: Awaited<ReturnType<typeof setup>>;
let oldServer = false;
const fetchVia = async (input: string, init?: RequestInit) => {
  if (oldServer && new URL(input).pathname === '/version') return Response.json({ service: 'everyfold', version: '0.1.2', api: 1, minClientApi: 1 });
  return app.fetch(new Request(input, init), t.env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
};

type Dev = { bm: FakeBookmarks; e: SyncEngine; kv: MemKV };
let A: Dev;
let B: Dev;
const mk = (flavor: 'chrome' | 'firefox'): Dev => {
  const bm = new FakeBookmarks(flavor);
  const kv = new MemKV();
  return { bm, kv, e: new SyncEngine(bm, kv, fetchVia) };
};
const root = (x: Dev) => x.e.state.rootId!;

/** 가짜 창 API — getAll 은 정해 둔 창을 돌려주고, create 는 받은 주소를 기록한다 */
function fakeDeps(windows: SessionWindowInput[], opts: { granted?: boolean; lang?: string } = {}) {
  const created: string[][] = [];
  let getAllCalls = 0;
  const deps: SessionDeps = {
    hasTabsPermission: async () => opts.granted ?? true,
    windows: {
      getAll: async () => {
        getAllCalls++;
        return structuredClone(windows);
      },
      create: async (d) => {
        created.push(d.url);
        return {};
      },
    },
    uiLanguage: () => opts.lang ?? 'ko-KR',
  };
  return { deps, created, get getAllCalls() { return getAllCalls; } };
}

const tab = (url: string, title = url) => ({ url, title });
/** 일반 창 2개 + 시크릿 창 + devtools·팝업 창 + 못 담는 탭만 있는 창 */
const WINDOWS: SessionWindowInput[] = [
  { type: 'normal', tabs: [tab('https://github.com/xero0429/everyfold', 'Everyfold repo'), tab('chrome://settings/'), tab('https://news.ycombinator.com/', 'HN'), tab('about:blank')] },
  { type: 'normal', tabs: [tab('https://www.youtube.com/watch?v=abc', 'Video'), { url: '', pendingUrl: 'https://developer.mozilla.org/en-US/', title: '' }, tab('file:///Users/me/notes.txt'), tab('edge://flags/')] },
  { type: 'normal', incognito: true, tabs: [tab('https://secret.example/')] },
  { type: 'popup', tabs: [tab('https://popup.example/')] },
  { type: 'normal', tabs: [tab('chrome-extension://abcdefghijklmnop/popup.html'), tab('moz-extension://1234/popup.html'), tab('javascript:alert(1)'), tab('data:text/html,hi'), tab('view-source:https://x.example/')] },
];

beforeAll(async () => {
  t = await setup();
  A = mk('chrome');
  B = mk('firefox');
  await A.bm.create({ parentId: '1', title: 'GitHub', url: 'https://github.com/xero0429/everyfold' });
  await A.e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'Mac Chrome' });
  await A.e.sync();
  await B.e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'Win Firefox' });
  await B.e.sync();
});
afterAll(() => t.close());

describe('save open windows', () => {
  let sessionId = '';

  it('(a)(b) saves normal windows as <Sessions>/<date · device>/<Window n>/<tabs>, skips what can’t be bookmarked and private/popup windows', async () => {
    const f = fakeDeps(WINDOWS);
    const r = await saveOpenWindows(A.e, f.deps);
    expect(r).toMatchObject({ windows: 2, tabs: 4, skipped: 9, synced: true, title: expect.stringMatching(/^\d{4}-\d\d-\d\d \d\d:\d\d · Mac Chrome$/) });
    if ('error' in r) throw new Error(r.error);
    sessionId = r.id;
    const s = `/세션/${r.title}`;
    expect(A.bm.dump(root(A)).filter((l) => l.startsWith('/세션/'))).toEqual([
      '/세션/',
      `${s}/`,
      `${s}/창 1/`,
      `${s}/창 1/Everyfold repo|https://github.com/xero0429/everyfold`,
      `${s}/창 1/HN|https://news.ycombinator.com/`,
      `${s}/창 2/`,
      `${s}/창 2/Video|https://www.youtube.com/watch?v=abc`,
      `${s}/창 2/https://developer.mozilla.org/en-US/|https://developer.mozilla.org/en-US/`,
    ].sort());
    // 탭 순서 그대로
    const [tree] = await A.bm.getSubTree(r.id);
    expect(tree!.children!.map((w) => w.title)).toEqual(['창 1', '창 2']);
    expect(tree!.children![0]!.children!.map((x) => x.url)).toEqual(['https://github.com/xero0429/everyfold', 'https://news.ycombinator.com/']);
    // 시크릿·팝업 창 주소는 어디에도 없다
    expect(A.bm.findUrl('https://secret.example/')).toEqual([]);
    expect(A.bm.findUrl('https://popup.example/')).toEqual([]);
    // 같은 주소의 라이브러리 북마크(개발)는 그대로 — 세션으로 끌려가지 않는다
    expect(A.bm.dump(root(A))).toContain('/개발/GitHub|https://github.com/xero0429/everyfold');
    // 서버: 세션 폴더는 예약 키로
    const sf = Object.values(A.e.state.shadow).find((e) => e.key === SESSIONS_KEY);
    expect(sf).toMatchObject({ parent: null, title: '세션' });
    expect(await A.e.listSessions()).toEqual([{ id: r.id, title: r.title, windows: 2, tabs: 4 }]);
  });

  it('syncing again changes nothing (session tabs are not captured, merged or moved)', async () => {
    const before = A.bm.dump(root(A));
    const rep = await A.e.sync();
    expect(rep.blocked).toBeUndefined();
    await A.e.sync();
    expect(A.bm.dump(root(A))).toEqual(before);
  });

  it('(e) another browser sees the session and restore opens one window per saved window with the saved addresses', async () => {
    await B.e.sync();
    const list = await B.e.listSessions();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ windows: 2, tabs: 4 });
    expect(B.bm.dump(root(B)).filter((l) => l.startsWith('/세션/'))).toEqual(A.bm.dump(root(A)).filter((l) => l.startsWith('/세션/')));
    const f = fakeDeps([]);
    const r = await restoreSession(B.e, f.deps, list[0]!.id);
    expect(r).toEqual({ windows: 2, tabs: 4 });
    expect(f.created).toEqual([
      ['https://github.com/xero0429/everyfold', 'https://news.ycombinator.com/'],
      ['https://www.youtube.com/watch?v=abc', 'https://developer.mozilla.org/en-US/'],
    ]);
    // 세션 폴더 밖 폴더는 복구 대상이 아니다
    await expect(B.e.sessionWindows(B.bm.findFolder('개발', root(B))!)).rejects.toThrow('session_not_found');
  });

  it('restore skips addresses a user added later that can’t be opened, and empty windows', async () => {
    const [tree] = await A.bm.getSubTree(sessionId);
    const w3 = await A.bm.create({ parentId: sessionId, title: '창 3' });
    await A.bm.create({ parentId: w3.id, title: 'x', url: 'chrome://settings/' });
    await A.bm.create({ parentId: tree!.children![0]!.id, title: 'bad', url: 'about:config' });
    expect(await A.e.sessionWindows(sessionId)).toEqual([
      ['https://github.com/xero0429/everyfold', 'https://news.ycombinator.com/'],
      ['https://www.youtube.com/watch?v=abc', 'https://developer.mozilla.org/en-US/'],
    ]);
    await A.bm.removeTree(w3.id);
    const bad = A.bm.findUrl('about:config')[0]!;
    await A.bm.removeTree(bad);
    await A.e.sync();
  });

  it('a second save in the same minute gets its own folder (not merged into the first)', async () => {
    const at = new Date(2026, 10, 26, 9, 30);
    const f = fakeDeps([{ type: 'normal', tabs: [tab('https://example.com/one')] }]);
    const one = await A.e.saveSession({ windows: [[{ url: 'https://example.com/one', title: 'one' }]], skipped: 0, tabs: 1 }, { locale: 'en', at });
    const two = await A.e.saveSession({ windows: [[{ url: 'https://example.com/two', title: 'two' }]], skipped: 0, tabs: 1 }, { locale: 'en', at });
    expect(one.title).toBe('2026-11-26 09:30 · Mac Chrome');
    expect(two.title).toBe('2026-11-26 09:30 · Mac Chrome (2)');
    expect(A.bm.dump(root(A))).toContain(`/세션/${one.title}/Window 1/one|https://example.com/one`);
    expect(A.bm.dump(root(A))).toContain(`/세션/${two.title}/Window 1/two|https://example.com/two`);
    expect(f.getAllCalls).toBe(0);
    await B.e.sync();
    expect((await B.e.listSessions()).map((s) => s.title).slice(0, 2)).toEqual([two.title, one.title]); // 새것 먼저
  });

  it('nothing savable → session_empty, nothing created', async () => {
    const before = A.bm.dump(root(A));
    await expect(saveOpenWindows(A.e, fakeDeps([{ type: 'normal', tabs: [tab('chrome://newtab/')] }, { incognito: true, tabs: [tab('https://x.example/')] }]).deps)).rejects.toThrow(SESSION_EMPTY);
    expect(A.bm.dump(root(A))).toEqual(before);
  });

  it('delete removes one session everywhere without the mass-delete pause, leaving library bookmarks alone', async () => {
    // 세션 탭(4개 + 2개) 이 라이브러리 북마크보다 많아도 사용자가 고른 한 세션 지우기는 멈추지 않는다
    const list = await B.e.listSessions();
    const target = list.find((s) => s.tabs === 4)!;
    expect(await B.e.deleteSession(target.id)).toEqual({ deleted: true });
    expect(B.e.state.pendingMassDelete).toBeNull();
    await A.e.sync();
    expect(A.bm.findUrl('https://news.ycombinator.com/')).toEqual([]);
    expect(A.bm.findUrl('https://github.com/xero0429/everyfold')).toHaveLength(2); // 북마크바 원본 + 개발 카테고리
    expect((await A.e.listSessions()).map((s) => s.tabs)).toEqual([1, 1]);
    await B.e.sync();
    expect(B.bm.dump(root(B))).toEqual(A.bm.dump(root(A)));
  });
});

describe('(d) tabs permission refused', () => {
  it('reads no tabs and writes nothing; sync and the rest keep working', async () => {
    const before = A.bm.dump(root(A));
    const f = fakeDeps(WINDOWS, { granted: false });
    expect(await saveOpenWindows(A.e, f.deps)).toEqual({ error: TABS_PERMISSION });
    expect(f.getAllCalls).toBe(0);
    expect(A.bm.dump(root(A))).toEqual(before);
    // 나머지 기능: 북마크 동기화·세션 목록·복구는 그대로
    const dev = A.bm.findFolder('개발', root(A))!;
    await A.bm.create({ parentId: dev, title: 'MDN', url: 'https://developer.mozilla.org/docs' });
    expect((await A.e.sync()).pushed).toBeGreaterThan(0);
    await B.e.sync();
    expect(B.bm.dump(root(B))).toContain('/개발/MDN|https://developer.mozilla.org/docs');
    const list = await A.e.listSessions();
    expect(list.length).toBe(2);
    const r = fakeDeps([], { granted: false });
    expect(await restoreSession(A.e, r.deps, list[0]!.id)).toEqual({ windows: 1, tabs: 1 });
  });

  it('popup text explains the refusal in en/ko; Firefox also asks for the browsingActivity data-collection opt-in', () => {
    expect(sessionError(TABS_PERMISSION, sessionText('en-US'))).toMatch(/permission/);
    expect(sessionError(TABS_PERMISSION, sessionText('ko'))).toMatch(/권한/);
    expect(sessionError('HTTP 401', sessionText('en'))).toMatch(/token/);
    expect(sessionPermissions(false)).toEqual({ permissions: ['tabs'] });
    expect(sessionPermissions(true)).toEqual({ permissions: ['tabs'], data_collection: ['browsingActivity'] });
    expect(Object.keys(SESSION_TEXT.ko).sort()).toEqual(Object.keys(SESSION_TEXT.en).sort());
    expect(SESSION_TEXT.en.saved({ windows: 2, tabs: 5, skipped: 3, synced: true })).toBe('Saved 2 windows, 5 tabs · 3 skipped (can’t be bookmarked)');
    expect(SESSION_TEXT.ko.saved({ windows: 2, tabs: 5, skipped: 3, synced: true })).toBe('창 2개 · 탭 5개 저장 · 3개 건너뜀(북마크로 못 담는 주소)');
  });

  it('manifest: tabs is optional (never required — required would disable existing installs on update)', () => {
    const build = readFileSync(join(__dirname, '..', 'scripts', 'build.mjs'), 'utf8');
    expect(build).toMatch(/permissions: \['bookmarks', 'storage', 'alarms'\],/);
    expect(build).toMatch(/optional_permissions: \['tabs'\],/);
    expect(build).toMatch(/optional: \['browsingActivity'\]/);
  });
});

describe('server compatibility', () => {
  it('an old server (api 1) → sessions_server_outdated, nothing created', async () => {
    const C = mk('chrome');
    oldServer = true;
    try {
      await C.e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'old' });
      await C.e.sync();
      const before = C.bm.dump(root(C));
      await expect(saveOpenWindows(C.e, fakeDeps(WINDOWS).deps)).rejects.toThrow(SESSIONS_SERVER_OUTDATED);
      expect(C.bm.dump(root(C))).toEqual(before);
      expect(sessionError(SESSIONS_SERVER_OUTDATED, sessionText('en'))).toMatch(/Update your server/);
    } finally {
      oldServer = false;
    }
  });

  it('a browser that got the sessions folder before it knew about keys finds it again via /categories', async () => {
    // 옛 확장(0.1.2)이 받아 둔 상태 흉내: shadow 에 key 가 없다
    const state = structuredClone(B.kv.v!);
    for (const e of Object.values(state.shadow)) delete e.key;
    const kv = new MemKV();
    kv.v = state;
    const e2 = new SyncEngine(B.bm, kv, fetchVia);
    await e2.load();
    expect((await e2.listSessions()).length).toBe(2);
    expect(Object.values(e2.state.shadow).filter((x) => x.key === SESSIONS_KEY)).toHaveLength(1);
  });
});

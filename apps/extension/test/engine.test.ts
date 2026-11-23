import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from '@everyfold/server/testing';
import { app } from '@everyfold/server';
import { BRAND } from '@everyfold/core';
import { MAX_APPLY_ATTEMPTS, SyncEngine } from '../src/engine.js';
import { FakeBookmarks, MemKV } from './fake-bookmarks.js';

/**
 * 두 브라우저(Chrome 모양 A, Firefox 모양 B) 를 가짜 북마크로 만들고, 실제 Worker 앱 + 로컬 D1(miniflare) 에 붙여 끝까지 돌린다.
 */
let t: Awaited<ReturnType<typeof setup>>;
const fetchVia = (input: string, init?: RequestInit) =>
  Promise.resolve(app.fetch(new Request(input, init), t.env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext));

let A: { bm: FakeBookmarks; e: SyncEngine };
let B: { bm: FakeBookmarks; e: SyncEngine };

beforeAll(async () => {
  t = await setup();
  const mk = (flavor: 'chrome' | 'firefox') => {
    const bm = new FakeBookmarks(flavor);
    return { bm, e: new SyncEngine(bm, new MemKV(), fetchVia) };
  };
  A = mk('chrome');
  B = mk('firefox');
  // A 에는 기존 북마크가 있다(북마크바 + 하위 폴더), B 에도 일부 겹치게
  await A.bm.create({ parentId: '1', title: 'GitHub', url: 'https://github.com/' });
  const work = await A.bm.create({ parentId: '1', title: 'work' });
  await A.bm.create({ parentId: work.id, title: 'Notion', url: 'https://www.notion.so/team' });
  await A.bm.create({ parentId: '2', title: 'Recipe', url: 'https://recipes.example/kimchi' });
  await B.bm.create({ parentId: 'toolbar_____', title: 'GitHub (ff)', url: 'https://github.com/?utm_source=ff' });
  await B.bm.create({ parentId: 'unfiled_____', title: 'YouTube', url: 'https://www.youtube.com/watch?v=1' });
});
afterAll(() => t.close());

const root = (x: { e: SyncEngine }) => x.e.state.rootId!;

describe('extension engine against real server (local D1)', () => {
  it('first connect: uploads all bookmarks (dedup) and mirrors categories into the root folder', async () => {
    await A.e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'A' });
    const ra = await A.e.sync();
    expect(ra.imported).toEqual({ created: 3, mergedExisting: 0, mergedInFile: 0 });
    await B.e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'B' });
    const rb = await B.e.sync();
    expect(rb.imported).toMatchObject({ created: 1, mergedExisting: 1 }); // github 은 이미 있음
    await A.e.sync();
    // 전용 루트 폴더 위치: Chrome=기타 북마크(2), Firefox=Other Bookmarks(unfiled)
    expect(A.bm.findFolder(BRAND.rootFolderTitle, '2')).toBe(root(A));
    expect(B.bm.findFolder(BRAND.rootFolderTitle, 'unfiled_____')).toBe(root(B));
    // 기존 폴더·북마크는 그대로
    expect(A.bm.findFolder('work', '1')).toBeTruthy();
    // 두 브라우저의 Everyfold 폴더 내용이 같다
    expect(A.bm.dump(root(A))).toEqual(B.bm.dump(root(B)));
    expect(A.bm.dump(root(A))).toContain('/개발/GitHub|https://github.com/');
    expect(A.bm.dump(root(A))).toContain('/영상·음악/YouTube|https://www.youtube.com/watch?v=1');
    expect(A.bm.dump(root(A))).toContain('/업무·도구/Notion|https://www.notion.so/team');
  });

  it('edits inside the root folder sync both ways (create / rename / move / delete)', async () => {
    const dev = A.bm.findFolder('개발', root(A))!;
    const shop = A.bm.findFolder('쇼핑', root(A))!;
    const mdn = await A.bm.create({ parentId: dev, title: 'MDN', url: 'https://developer.mozilla.org/' });
    await A.e.sync();
    await B.e.sync();
    expect(B.bm.dump(root(B))).toContain('/개발/MDN|https://developer.mozilla.org/');

    await A.bm.update(mdn.id, { title: 'MDN Web Docs' });
    await A.bm.move(mdn.id, { parentId: shop });
    await A.e.sync();
    await B.e.sync();
    expect(B.bm.dump(root(B))).toContain('/쇼핑/MDN Web Docs|https://developer.mozilla.org/');

    // B 에서 지우면 A 에서도 사라진다
    const [bMdn] = B.bm.findUrl('https://developer.mozilla.org/');
    await B.bm.removeTree(bMdn!);
    await B.e.sync();
    await A.e.sync();
    expect(A.bm.findUrl('https://developer.mozilla.org/')).toEqual([]);
    expect(A.bm.dump(root(A))).toEqual(B.bm.dump(root(B)));
  });

  it('new folder made in browser B appears in A', async () => {
    const f = await B.bm.create({ parentId: root(B), title: 'Reading' });
    await B.bm.create({ parentId: f.id, title: 'Essay', url: 'https://essay.example/1' });
    await B.e.sync();
    await A.e.sync();
    expect(A.bm.dump(root(A))).toContain('/Reading/Essay|https://essay.example/1');
  });

  it('bookmark created outside the root is captured and auto-categorized; original stays', async () => {
    const n = await A.bm.create({ parentId: '1', title: 'Coupang', url: 'https://www.coupang.com/np/x' });
    await A.e.noteCreated(n);
    await A.e.sync();
    await B.e.sync();
    expect(B.bm.dump(root(B))).toContain('/쇼핑/Coupang|https://www.coupang.com/np/x');
    expect(A.bm.findUrl('https://www.coupang.com/np/x')).toHaveLength(2); // 원본 + Everyfold 사본
  });

  it('mass delete in the browser is stopped and can be restored', async () => {
    // 북마크를 충분히 만든다
    const dev = A.bm.findFolder('개발', root(A))!;
    for (let i = 0; i < 10; i++) await A.bm.create({ parentId: dev, title: `doc ${i}`, url: `https://docs.example/${i}` });
    await A.e.sync();
    await B.e.sync();
    const before = B.bm.dump(root(B));
    // A 에서 개발 폴더째 지운다(=북마크 대부분)
    await A.bm.removeTree(dev);
    const r = await A.e.sync();
    expect(r.blocked).toMatchObject({ error: 'mass_delete_local' });
    expect(A.e.state.pendingMassDelete?.deletes).toBeGreaterThanOrEqual(11);
    await B.e.sync();
    expect(B.bm.dump(root(B))).toEqual(before); // 서버엔 아무것도 안 지워졌다
    // 사용자가 "되돌리기" 선택 → 서버 상태대로 A 에 다시 생긴다
    await A.e.restorePendingDeletes();
    expect(A.e.state.pendingMassDelete).toBeNull();
    expect(A.bm.dump(root(A))).toEqual(before);
  });

  it('confirmed mass delete goes through', async () => {
    const dev = A.bm.findFolder('개발', root(A))!;
    await A.bm.removeTree(dev);
    expect((await A.e.sync()).blocked).toBeTruthy();
    await A.e.sync({ confirmMassDelete: true });
    await B.e.sync();
    expect(B.bm.findFolder('개발', root(B))).toBeUndefined();
    expect(A.bm.dump(root(A))).toEqual(B.bm.dump(root(B)));
  });

  it('concurrent rename of the same bookmark converges to the server winner', async () => {
    const [aYt] = A.bm.findUrl('https://www.youtube.com/watch?v=1').filter((id) => A.e.state.map[id]);
    const [bYt] = B.bm.findUrl('https://www.youtube.com/watch?v=1').filter((id) => B.e.state.map[id]);
    await A.bm.update(aYt!, { title: 'from A' });
    await B.bm.update(bYt!, { title: 'from B' });
    await A.e.sync();
    await B.e.sync(); // B 의 수정은 충돌 → 서버(A) 값으로 B 가 고쳐진다
    await A.e.sync();
    const [aNow] = await A.bm.get(aYt!);
    const [bNow] = await B.bm.get(bYt!);
    expect(aNow!.title).toBe('from A');
    expect(bNow!.title).toBe('from A');
  });

  it('a second run with no changes is quiet', async () => {
    await A.e.sync();
    const r = await A.e.sync();
    expect(r).toMatchObject({ pushed: 0, applied: 0 });
  });

  it('a node this browser refuses does not stop sync: others apply, rev advances, failure is recorded and retried with a cap (M1)', async () => {
    const C = { bm: new FakeBookmarks('chrome'), e: undefined as unknown as SyncEngine };
    C.e = new SyncEngine(C.bm, new MemKV(), fetchVia);
    C.bm.rejectUrl = (u) => u.includes('refused.example');
    await C.e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'C' });
    await C.e.sync();
    // A 가 3개를 만든다 — 그중 하나는 C 가 못 받는 URL
    const dev = A.bm.findFolder('개발', root(A)) ?? (await A.bm.create({ parentId: root(A), title: '개발' })).id;
    await A.bm.create({ parentId: dev, title: 'ok1', url: 'https://m1.example/1' });
    await A.bm.create({ parentId: dev, title: 'bad', url: 'https://refused.example/x' });
    await A.bm.create({ parentId: dev, title: 'ok2', url: 'https://m1.example/2' });
    await A.e.sync();
    const r = await C.e.sync();
    expect(r.failed).toBe(1);
    expect(C.bm.findUrl('https://m1.example/1')).toHaveLength(1);
    expect(C.bm.findUrl('https://m1.example/2')).toHaveLength(1);
    const failed = Object.values(C.e.state.failed);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ error: 'Invalid URL.', attempts: 1 });
    const revAfter = C.e.state.rev;
    expect(revAfter).toBeGreaterThan(0);
    // 다음 sync 도 예외 없이 돈다 — 나중 변경도 계속 받는다
    await A.bm.create({ parentId: dev, title: 'ok3', url: 'https://m1.example/3' });
    await A.e.sync();
    await C.e.sync();
    expect(C.bm.findUrl('https://m1.example/3')).toHaveLength(1);
    expect(C.e.state.rev).toBeGreaterThan(revAfter);
    // 상한까지 시도하면 멈춘다
    for (let i = 0; i < MAX_APPLY_ATTEMPTS + 2; i++) await C.e.sync();
    expect(Object.values(C.e.state.failed)[0]!.attempts).toBe(MAX_APPLY_ATTEMPTS);
    // 브라우저가 받게 되면(또는 서버에서 바뀌면) 다시 시도해서 성공한다
    C.bm.rejectUrl = null;
    const [badA] = A.bm.findUrl('https://refused.example/x');
    await A.bm.update(badA!, { title: 'bad renamed' });
    await A.e.sync();
    await C.e.sync();
    expect(C.bm.findUrl('https://refused.example/x')).toHaveLength(1);
    expect(C.e.state.failed).toEqual({});
  });
});

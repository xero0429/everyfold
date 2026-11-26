import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SESSIONS_KEY } from '@everyfold/core';
import { setLlmOverride } from '../src/categorize.js';
import { setup, SimDevice } from './helpers.js';

/**
 * #3241 세션 폴더(열린 창 저장) — 서버는 cat_key='sessions' 폴더와 그 아래를 카테고리로 보지 않는다.
 * 분류(규칙·학습·LLM)·정리 제안(apply_rules·remove_empty·new_category)·캡처·가져오기·중복 URL 합치기 어느 것도
 * 세션 안 노드를 옮기거나 지우거나 합치지 않는다.
 */
let t: Awaited<ReturnType<typeof setup>>;
let A: SimDevice;
let B: SimDevice;

beforeAll(async () => {
  t = await setup();
  A = new SimDevice('A', (await t.register('mac-chrome')).token, t.call);
  B = new SimDevice('B', (await t.register('win-firefox')).token, t.call);
  await A.pull();
  await B.pull();
});
afterAll(async () => {
  setLlmOverride(undefined);
  await t.close();
});

const res = (r: { json: any }, i = 0) => r.json.results[i];
const sessionsOp = (clientRef = 'api:sessions') => ({ op: 'create', clientRef, kind: 'folder', parent: null, title: 'whatever', key: SESSIONS_KEY });

let sessionsId = '';
/** 세션 하나를 push 한다: 세션 폴더 → 창 폴더 → 탭 북마크 */
async function pushSession(dev: SimDevice, title: string, windows: string[][]) {
  const ops: any[] = [{ op: 'create', clientRef: `s:${title}`, kind: 'folder', parent: { serverId: sessionsId }, title }];
  windows.forEach((urls, w) => {
    ops.push({ op: 'create', clientRef: `s:${title}:w${w}`, kind: 'folder', parent: { clientRef: `s:${title}` }, title: `창 ${w + 1}` });
    urls.forEach((url, i) => ops.push({ op: 'create', clientRef: `s:${title}:w${w}:${i}`, kind: 'bookmark', parent: { clientRef: `s:${title}:w${w}` }, title: url, url }));
  });
  const r = await dev.push(ops);
  expect(r.status).toBe(200);
  await dev.pull();
  return r.json.results as any[];
}

describe('reserved sessions folder', () => {
  it('create with key → one folder named by server locale, key on pull; again → merged into the same folder', async () => {
    const r = await A.push([sessionsOp()]);
    expect(res(r)).toMatchObject({ status: 'applied' });
    sessionsId = res(r).serverId;
    await B.pull();
    const node = B.nodes.get(sessionsId);
    expect(node).toMatchObject({ kind: 'folder', parentId: null, title: '세션', key: SESSIONS_KEY });
    const again = await B.push([sessionsOp('api:sessions-b')]);
    expect(res(again)).toMatchObject({ status: 'merged', serverId: sessionsId });
    // 사용자가 이름을 바꿔도 키로 찾는다
    await A.pull();
    await A.push([{ op: 'update', id: sessionsId, baseRev: A.nodes.get(sessionsId).rev, title: 'My windows' }]);
    expect(res(await B.push([sessionsOp('api:sessions-c')]))).toMatchObject({ status: 'merged', serverId: sessionsId });
    // 기본 카테고리도 key 를 싣는다(확장은 무시해도 된다)
    expect(B.folder('개발')).toMatchObject({ key: 'dev' });
  });

  it('rejects unknown reserved keys and a reserved folder under a parent', async () => {
    const r = await A.push([
      { op: 'create', clientRef: 'x1', kind: 'folder', parent: null, title: 'x', key: 'trash' },
      { op: 'create', clientRef: 'x2', kind: 'folder', parent: { serverId: A.folder('개발').id }, title: 'x', key: SESSIONS_KEY },
    ]);
    expect(r.json.results.map((x: any) => x.status)).toEqual(['rejected', 'rejected']);
  });

  it('English server names it "Sessions"', async () => {
    const en = await setup({ locale: null });
    try {
      const d = new SimDevice('E', (await en.register('e')).token, en.call);
      const r = await d.push([sessionsOp()]);
      await d.pull();
      expect(d.nodes.get(res(r).serverId)).toMatchObject({ title: 'Sessions', key: SESSIONS_KEY });
    } finally {
      await en.close();
    }
  });
});

describe('session bookmarks are never merged, moved or used as categories', () => {
  it('saving a tab whose URL is already in the library creates a new bookmark — the library one stays in its category', async () => {
    const lib = await A.push([{ op: 'create', clientRef: 'lib-gh', kind: 'bookmark', parent: { serverId: A.folder('개발').id }, title: 'GitHub', url: 'https://github.com/everyfold' }]);
    const libId = res(lib).serverId;
    const out = await pushSession(A, '2026-11-26 10:00 · A', [['https://github.com/everyfold', 'https://news.ycombinator.com/'], ['https://www.youtube.com/watch?v=s']]);
    expect(out.map((x) => x.status)).toEqual(Array(out.length).fill('applied'));
    expect(A.nodes.get(libId)).toMatchObject({ parentId: A.folder('개발').id, deleted: false });
    // 두 번째 세션에 같은 주소 → 또 새로 만든다(첫 세션에서 빼 오지 않는다)
    const firstTab = [...A.nodes.values()].find((n) => n.url === 'https://news.ycombinator.com/' && !n.deleted)!;
    const out2 = await pushSession(A, '2026-11-26 11:00 · A', [['https://news.ycombinator.com/']]);
    expect(out2.every((x) => x.status === 'applied')).toBe(true);
    expect(A.nodes.get(firstTab.id)).toMatchObject({ parentId: firstTab.parentId, deleted: false });
    expect(A.live().filter((n) => n.url === 'https://news.ycombinator.com/')).toHaveLength(2);
  });

  it('capture (bookmark made outside Everyfold) of a URL saved only in a session goes to a category, not into the session', async () => {
    const before = A.live().filter((n) => n.url === 'https://www.youtube.com/watch?v=s');
    expect(before).toHaveLength(1);
    const r = await A.push([{ op: 'create', clientRef: 'capture:yt', kind: 'bookmark', parent: null, autoCategorize: true, title: 'yt', url: 'https://www.youtube.com/watch?v=s' }]);
    expect(res(r).status).toBe('applied');
    await A.pull();
    expect(A.nodes.get(res(r).serverId).parentId).toBe(A.folder('영상·음악').id);
    expect(A.nodes.get(before[0]!.id)).toMatchObject({ parentId: before[0]!.parentId, deleted: false });
  });

  it('a non-session create with a URL that exists only in a session is not merged into the session', async () => {
    const tab = A.live().find((n) => n.url === 'https://news.ycombinator.com/')!;
    const r = await B.push([{ op: 'create', clientRef: 'b-hn', kind: 'bookmark', parent: { serverId: A.folder('뉴스').id }, title: 'HN', url: 'https://news.ycombinator.com/' }]);
    expect(res(r).status).toBe('applied');
    await A.pull();
    expect(A.nodes.get(tab.id)).toMatchObject({ parentId: tab.parentId, deleted: false });
  });

  it('import: a URL saved only in a session is created in the library (not "already there"); import paths never land in the session folder', async () => {
    const r = await t.call('POST', '/import', {
      token: A.token,
      body: { items: [{ url: 'https://only-in-session.example/a', title: 'a', path: ['세션'] }] },
    });
    // 먼저 세션에만 넣어 둔 주소로 한 번 더
    await pushSession(A, '2026-11-26 12:00 · A', [['https://only-in-session.example/b']]);
    const r2 = await t.call('POST', '/import', { token: A.token, body: { items: [{ url: 'https://only-in-session.example/b', title: 'b', path: ['My windows'] }] } });
    expect(r.json).toMatchObject({ created: 1, mergedExisting: 0 });
    expect(r2.json).toMatchObject({ created: 1, mergedExisting: 0 });
    await A.pull();
    const sessionIds = sessionSubtree();
    for (const u of ['https://only-in-session.example/a', 'https://only-in-session.example/b']) {
      const lib = A.live().filter((n) => n.url === u && !sessionIds.has(n.parentId));
      expect(lib, u).toHaveLength(1);
    }
  });

  it('LLM and rule classification never see session folders as categories', async () => {
    const seen: string[][] = [];
    setLlmOverride({
      name: 'spy',
      categorize: async (items, cats) => {
        seen.push(cats.map((c) => c.id));
        return items.map((i) => ({ itemId: i.id, skip: true as const }));
      },
    });
    try {
      await t.call('POST', '/import', { token: A.token, body: { items: [{ url: 'https://unknown-host.example/1', title: 'x' }] } });
      await A.push([{ op: 'create', clientRef: 'capture:u2', kind: 'bookmark', parent: null, autoCategorize: true, title: 'y', url: 'https://unknown-host.example/2' }]);
    } finally {
      setLlmOverride(undefined);
    }
    expect(seen.length).toBe(2);
    const sessionIds = sessionSubtree();
    for (const ids of seen) {
      expect(ids.length).toBeGreaterThan(5);
      expect(ids.filter((id) => sessionIds.has(id))).toEqual([]);
    }
  });

  it('moves into a session folder do not teach a rule', async () => {
    await A.pull();
    const sessionIds = sessionSubtree();
    const win = A.live().find((n) => n.kind === 'folder' && sessionIds.has(n.id) && n.parentId !== sessionsId)!;
    const imp = await t.call('POST', '/import', { token: A.token, body: { items: [1, 2, 3].map((i) => ({ url: `https://teach.example/${i}`, title: `t${i}` })) } });
    expect(imp.json.byCategory).toEqual({ 미분류: 3 });
    await A.pull();
    const moves = [1, 2, 3].map((i) => A.byUrl(`https://teach.example/${i}`)).map((n) => ({ op: 'move', id: n.id, baseRev: n.rev, parent: { serverId: win.id } }));
    expect((await A.push(moves)).json.results.every((x: any) => x.status === 'applied')).toBe(true);
    const next = await t.call('POST', '/import', { token: A.token, body: { items: [{ url: 'https://teach.example/4', title: 't4' }] } });
    expect(next.json.byCategory).toEqual({ 미분류: 1 });
    const cap = await A.push([{ op: 'create', clientRef: 'capture:t5', kind: 'bookmark', parent: null, autoCategorize: true, title: 't5', url: 'https://teach.example/5' }]);
    await A.pull();
    expect(A.nodes.get(res(cap).serverId).parentId).toBe(A.folder('미분류').id);
  });
});

describe('cleanup suggestions leave the sessions folder alone', () => {
  it('remove_empty never lists the sessions folder or an empty session/window folder; apply_rules never moves session tabs', async () => {
    // 빈 세션(창 폴더도 빈 것)
    const r = await A.push([
      { op: 'create', clientRef: 'empty-s', kind: 'folder', parent: { serverId: sessionsId }, title: 'empty session' },
      { op: 'create', clientRef: 'empty-w', kind: 'folder', parent: { clientRef: 'empty-s' }, title: '창 1' },
    ]);
    const emptyIds = r.json.results.map((x: any) => x.serverId);
    const gen = (await t.call('POST', '/suggestions/generate', { token: A.token })).json.suggestions;
    await A.pull();
    const sessionIds = sessionSubtree();
    const touched = gen.flatMap((s: any) => s.actions).map((a: any) => a.nodeId ?? a.id ?? a.to).filter(Boolean);
    expect(touched.filter((id: string) => sessionIds.has(id) || sessionIds.has(A.nodes.get(id)?.parentId))).toEqual([]);
    for (const id of emptyIds) expect(sessionIds.has(id)).toBe(true);
    // 세션 폴더만 있고 비어 있는 서버에서도 그 폴더는 "빈 카테고리" 가 아니다

    const fresh = await setup();
    try {
      const d = new SimDevice('F', (await fresh.register('f')).token, fresh.call);
      const s = res(await d.push([sessionsOp()])).serverId;
      const g = (await fresh.call('POST', '/suggestions/generate', { token: d.token })).json.suggestions;
      const del = g.find((x: any) => x.kind === 'remove_empty');
      expect(del.actions.length).toBeGreaterThan(0); // 빈 기본 카테고리는 나온다
      expect(del.actions.map((a: any) => a.id)).not.toContain(s);
    } finally {
      await fresh.close();
    }
  });

  it('a stale suggestion that targets session nodes is skipped on approve (nothing moved or deleted)', async () => {
    await A.pull();
    const sessionIds = sessionSubtree();
    const tab = A.live().find((n) => n.kind === 'bookmark' && sessionIds.has(n.parentId))!;
    const winFolder = A.live().find((n) => n.kind === 'folder' && sessionIds.has(n.id) && n.parentId !== sessionsId)!;
    const lib = A.live().find((n) => n.url === 'https://github.com/everyfold' && !sessionIds.has(n.parentId))!;
    const actions = [
      { type: 'move', nodeId: tab.id, to: A.folder('개발').id },
      { type: 'move', nodeId: lib.id, to: winFolder.id },
      { type: 'delete_folder', id: sessionsId },
      { type: 'rename', id: winFolder.id, title: 'hacked' },
    ];
    const id = crypto.randomUUID();
    await t.DB.prepare(`INSERT INTO suggestions (id, kind, title, payload_json, status, created_at) VALUES (?, 'apply_rules', 'stale', ?, 'pending', ?)`).bind(id, JSON.stringify({ actions }), Date.now()).run();
    const ok = await t.call('POST', `/suggestions/${id}/approve`, { token: A.token });
    expect(ok.json).toMatchObject({ status: 'approved', applied: 0, skipped: 4 });
    await A.pull();
    expect(A.nodes.get(tab.id)).toMatchObject({ parentId: tab.parentId, deleted: false });
    expect(A.nodes.get(lib.id)).toMatchObject({ parentId: lib.parentId });
    expect(A.nodes.get(sessionsId)).toMatchObject({ deleted: false });
    expect(A.nodes.get(winFolder.id)).toMatchObject({ title: winFolder.title });
  });
});

describe('#3242 follow-ups', () => {
  it('sessions folder moved under a category → create(key: sessions) puts it back at the root (recorded change, every device pulls it) and saving works', async () => {
    await A.pull();
    await B.pull();
    const dev = A.folder('개발').id;
    const mv = await A.push([{ op: 'move', id: sessionsId, baseRev: A.nodes.get(sessionsId).rev, parent: { serverId: dev } }]);
    expect(res(mv).status).toBe('applied'); // 옮기기 자체는 막지 않는다
    await B.pull();
    expect(B.nodes.get(sessionsId)).toMatchObject({ parentId: dev, key: SESSIONS_KEY });
    const r = await A.push([sessionsOp('api:sessions-restore')]);
    expect(res(r)).toMatchObject({ status: 'merged', serverId: sessionsId, node: { id: sessionsId, parentId: null, key: SESSIONS_KEY } });
    expect(res(r).rev).toBe(res(r).node.rev);
    const ch = await t.DB.prepare(`SELECT op, before_json, after_json FROM changes WHERE node_id=? ORDER BY rev DESC LIMIT 1`).bind(sessionsId).first<any>();
    expect(ch.op).toBe('move');
    expect(JSON.parse(ch.before_json).parentId).toBe(dev);
    expect(JSON.parse(ch.after_json).parentId).toBeNull();
    await B.pull();
    expect(B.nodes.get(sessionsId)).toMatchObject({ parentId: null, key: SESSIONS_KEY, deleted: false });
    // 이미 루트면 또 쓰지 않는다
    const again = await B.push([sessionsOp('api:sessions-again')]);
    expect(res(again)).toMatchObject({ status: 'merged', serverId: sessionsId, rev: res(r).rev });
    const out = await pushSession(A, '2026-11-27 08:00 · A', [['https://after-restore.example/']]);
    expect(out.every((x) => x.status === 'applied')).toBe(true);
    expect(A.nodes.get(out[0].serverId).parentId).toBe(sessionsId);
  });

  it('import with a path starting with the sessions folder name goes to the inbox — no second root folder of that name', async () => {
    await A.pull();
    const current = A.nodes.get(sessionsId).title; // 앞 시험에서 'My windows' 로 바꿨다
    const items = [
      { url: 'https://imp-sess.example/ko', title: 'ko', path: ['세션', '2026-11-20 10:00 · X', '창 1'] },
      { url: 'https://imp-sess.example/en', title: 'en', path: ['Bookmarks bar', 'Sessions', 'Window 1'] },
      { url: 'https://imp-sess.example/cur', title: 'cur', path: [current] },
      { url: 'https://imp-sess.example/other', title: 'other', path: ['My stuff'] },
    ];
    const r = await t.call('POST', '/import', { token: A.token, body: { items } });
    expect(r.json).toMatchObject({ created: 4 });
    await A.pull();
    const inbox = A.folder('미분류').id;
    for (const u of ['ko', 'en', 'cur']) expect(A.byUrl(`https://imp-sess.example/${u}`).parentId, u).toBe(inbox);
    expect(A.nodes.get(A.byUrl('https://imp-sess.example/other').parentId)).toMatchObject({ title: 'My stuff', parentId: null }); // 다른 경로는 그대로 재현
    const rootFolders = A.live().filter((n) => n.kind === 'folder' && n.parentId === null).map((n) => n.title.toLowerCase());
    for (const name of ['세션', 'sessions', current.toLowerCase()]) expect(rootFolders.filter((x) => x === name).length, name).toBeLessThanOrEqual(1);
    expect(A.live().filter((n) => n.kind === 'folder' && n.parentId === null && ['세션', 'Sessions', current].includes(n.title)).map((n) => n.id)).toEqual([sessionsId]);
  });

  it('moving a bookmark into a session folder writes no moves row (moving elsewhere still does)', async () => {
    await A.pull();
    const sessionIds = sessionSubtree();
    const win = A.live().find((n) => n.kind === 'folder' && sessionIds.has(n.id) && n.parentId !== sessionsId)!;
    await t.call('POST', '/import', { token: A.token, body: { items: [{ url: 'https://nomove.example/1', title: 'n1' }, { url: 'https://nomove.example/2', title: 'n2' }] } });
    await A.pull();
    const n1 = A.byUrl('https://nomove.example/1');
    const n2 = A.byUrl('https://nomove.example/2');
    const r = await A.push([
      { op: 'move', id: n1.id, baseRev: n1.rev, parent: { serverId: win.id } },
      { op: 'move', id: n2.id, baseRev: n2.rev, parent: { serverId: A.folder('개발').id } },
    ]);
    expect(r.json.results.map((x: any) => x.status)).toEqual(['applied', 'applied']);
    const count = async (url: string) => (await t.DB.prepare(`SELECT COUNT(*) AS n FROM moves WHERE url=?`).bind(url).first<{ n: number }>())!.n;
    expect(await count('https://nomove.example/1')).toBe(0);
    expect(await count('https://nomove.example/2')).toBe(1);
  });
});

/** A 가 아는 세션 폴더와 그 아래 폴더 id */
function sessionSubtree(): Set<string> {
  const out = new Set<string>([sessionsId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of A.live()) if (n.kind === 'folder' && n.parentId && out.has(n.parentId) && !out.has(n.id)) {
      out.add(n.id);
      grew = true;
    }
  }
  return out;
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLlmOverride } from '../src/categorize.js';
import { app } from '../src/index.js';
import { API_VERSION, MIN_CLIENT_API } from '@everyfold/core';
import { pull } from '../src/sync.js';
import { Store } from '../src/store.js';
import { IMPORT_MAX_BYTES } from '../src/importer.js';
import { setup, SimDevice } from './helpers.js';

let t: Awaited<ReturnType<typeof setup>>;
let A: SimDevice;
let B: SimDevice;

beforeAll(async () => {
  t = await setup();
  const a = await t.register('mac-chrome');
  const b = await t.register('win-firefox');
  A = new SimDevice('A', a.token, t.call);
  B = new SimDevice('B', b.token, t.call);
  await A.pull();
  await B.pull();
});
afterAll(async () => {
  setLlmOverride(undefined);
  await t.close();
});

const res = (r: { json: any }, i = 0) => r.json.results[i];

describe('version', () => {
  it('GET /version needs no token and reports server version + API range', async () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));
    const r = await t.call('GET', '/version');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ service: 'everyfold', version: pkg.version, api: API_VERSION, minClientApi: MIN_CLIENT_API });
  });
});

describe('auth', () => {
  it('rejects missing/invalid tokens', async () => {
    expect((await t.call('GET', '/sync/pull')).status).toBe(401);
    expect((await t.call('GET', '/sync/pull', { token: 'efd_nope' })).status).toBe(401);
    expect((await t.call('POST', '/devices', { token: 'wrong', body: { name: 'x' } })).status).toBe(401);
    expect((await t.call('GET', '/me', { token: A.token })).json.device.name).toBe('mac-chrome');
  });
  it('revoked device loses access', async () => {
    const d = await t.register('temp');
    await t.call('DELETE', `/devices/${d.deviceId}`, { token: 'admin-secret' });
    expect((await t.call('GET', '/me', { token: d.token })).status).toBe(401);
  });
  it('seeds default categories once', () => {
    expect(A.live().filter((n) => n.kind === 'folder').map((n) => n.title)).toContain('미분류');
    expect(A.view()).toEqual(B.view());
  });
});

describe('two devices: add / move / delete converge', () => {
  it('A adds folder + bookmarks → B pull matches', async () => {
    const r = await A.push([
      { op: 'create', clientRef: 'a1', kind: 'folder', parent: null, title: 'Projects' },
      { op: 'create', clientRef: 'a2', kind: 'bookmark', parent: { clientRef: 'a1' }, title: 'Everyfold repo', url: 'https://example.com/everyfold' },
      { op: 'create', clientRef: 'a3', kind: 'bookmark', parent: { clientRef: 'a1' }, title: 'Docs', url: 'https://example.com/docs' },
    ]);
    expect(r.status).toBe(200);
    expect(r.json.results.map((x: any) => x.status)).toEqual(['applied', 'applied', 'applied']);
    expect(r.json.mappings.map((m: any) => m.clientRef)).toEqual(['a1', 'a2', 'a3']);
    await A.pull();
    await B.pull();
    expect(B.view()).toEqual(A.view());
    expect(B.byUrl('https://example.com/docs').parentId).toBe(B.folder('Projects').id);
  });

  it('A moves and renames → B pull matches', async () => {
    const docs = A.byUrl('https://example.com/docs');
    const dev = A.folder('개발');
    const r = await A.push([
      { op: 'move', id: docs.id, baseRev: docs.rev, parent: { serverId: dev.id } },
      { op: 'update', id: A.folder('Projects').id, baseRev: A.folder('Projects').rev, title: 'Side projects' },
    ]);
    expect(r.json.results.map((x: any) => x.status)).toEqual(['applied', 'applied']);
    await A.pull();
    await B.pull();
    expect(B.view()).toEqual(A.view());
    expect(B.byUrl('https://example.com/docs').parentId).toBe(dev.id);
    expect(B.folder('Side projects')).toBeTruthy();
  });

  it('A deletes → B sees tombstone', async () => {
    const n = A.byUrl('https://example.com/everyfold');
    const r = await A.push([{ op: 'delete', id: n.id, baseRev: n.rev }]);
    expect(res(r).status).toBe('applied');
    await B.pull();
    expect(B.nodes.get(n.id).deleted).toBe(true);
    await A.pull();
    expect(B.view()).toEqual(A.view());
  });

  it('duplicate URL from another device merges instead of duplicating', async () => {
    const r = await B.push([{ op: 'create', clientRef: 'b-dup', kind: 'bookmark', parent: { serverId: B.folder('개발').id }, title: 'docs again', url: 'https://EXAMPLE.com/docs/?utm_source=x#top' }]);
    expect(res(r).status).toBe('merged');
    expect(res(r).serverId).toBe(A.byUrl('https://example.com/docs').id);
    await B.pull();
    expect(B.live().filter((n) => n.url?.includes('example.com/docs'))).toHaveLength(1);
  });

  it('same-name folder from second browser merges', async () => {
    const r = await B.push([{ op: 'create', clientRef: 'b-f', kind: 'folder', parent: null, title: '개발' }]);
    expect(res(r)).toMatchObject({ status: 'merged', serverId: B.folder('개발').id });
  });
});

describe('concurrent edits', () => {
  it('same field: first writer wins, loser recorded', async () => {
    await A.pull();
    await B.pull();
    const n = A.byUrl('https://example.com/docs');
    const ra = await A.push([{ op: 'update', id: n.id, baseRev: n.rev, title: 'Title from A' }]);
    expect(res(ra).status).toBe('applied');
    const rb = await B.push([{ op: 'update', id: n.id, baseRev: n.rev, title: 'Title from B' }]);
    expect(res(rb)).toMatchObject({ status: 'conflict', serverWon: ['title'] });
    await B.pull();
    expect(B.nodes.get(n.id).title).toBe('Title from A');
    const c = await t.call('GET', '/conflicts', { token: A.token });
    expect(c.json.conflicts[0]).toMatchObject({ node_id: n.id, reason: 'concurrent-edit', server_won: 'title' });
  });

  it('different fields: both survive (field merge)', async () => {
    await A.pull();
    await B.pull();
    const n = A.byUrl('https://example.com/docs');
    await A.push([{ op: 'update', id: n.id, baseRev: n.rev, title: 'Renamed by A' }]);
    const rb = await B.push([{ op: 'move', id: n.id, baseRev: n.rev, parent: { serverId: B.folder('학습·참고').id } }]);
    expect(res(rb).status).toBe('applied');
    await A.pull();
    const now = A.nodes.get(n.id);
    expect(now.title).toBe('Renamed by A');
    expect(now.parentId).toBe(A.folder('학습·참고').id);
  });

  it('delete vs newer edit elsewhere: kept', async () => {
    await A.pull();
    await B.pull();
    const n = A.byUrl('https://example.com/docs');
    await A.push([{ op: 'update', id: n.id, baseRev: n.rev, title: 'Edited again' }]);
    const rb = await B.push([{ op: 'delete', id: n.id, baseRev: n.rev }]);
    expect(res(rb).status).toBe('conflict');
    await B.pull();
    expect(B.nodes.get(n.id).deleted).toBe(false);
  });

  it('edit on a deleted node is a conflict; double delete is noop', async () => {
    await A.pull();
    const r1 = await A.push([{ op: 'create', clientRef: 'tmp', kind: 'bookmark', parent: null, title: 'tmp', url: 'https://tmp.example/' }]);
    const id = res(r1).serverId;
    const rev = res(r1).rev;
    await A.push([{ op: 'delete', id, baseRev: rev }]);
    expect(res(await B.push([{ op: 'update', id, baseRev: rev, title: 'x' }])).status).toBe('conflict');
    expect(res(await B.push([{ op: 'delete', id, baseRev: rev }])).status).toBe('noop');
  });

  it('cannot move a folder into its own child', async () => {
    await A.pull();
    const r = await A.push([
      { op: 'create', clientRef: 'p', kind: 'folder', parent: null, title: 'Parent' },
      { op: 'create', clientRef: 'c', kind: 'folder', parent: { clientRef: 'p' }, title: 'Child' },
    ]);
    const [p, c] = r.json.results;
    expect(res(await A.push([{ op: 'move', id: p.serverId, baseRev: p.rev, parent: { serverId: c.serverId } }])).status).toBe('rejected');
  });
});

describe('mass delete guard', () => {
  it('blocks ≥20% deletes without confirmation, applies nothing; confirm applies', async () => {
    await A.pull();
    const ops = Array.from({ length: 30 }, (_, i) => ({ op: 'create', clientRef: `m${i}`, kind: 'bookmark', parent: null, title: `m${i}`, url: `https://mass.example/${i}` }));
    const created = (await A.push(ops)).json.results;
    const live = (await t.call('GET', '/categories', { token: A.token })).json;
    expect(live.categories.length).toBeGreaterThan(0);
    const del = created.slice(0, 12).map((r: any) => ({ op: 'delete', id: r.serverId, baseRev: r.rev }));
    const blocked = await A.push(del);
    expect(blocked.status).toBe(409);
    expect(blocked.json).toMatchObject({ error: 'mass_delete', deletes: 12, threshold: 0.2 });
    await B.pull();
    expect(B.nodes.get(created[0].serverId).deleted).toBe(false);
    const ok = await A.push(del, { confirmMassDelete: true });
    expect(ok.status).toBe(200);
    expect(ok.json.results.every((r: any) => r.status === 'applied')).toBe(true);
    // 되돌리기
    const undo = await t.call('POST', '/changes/undo', { token: A.token, body: { batchId: ok.json.batchId } });
    expect(undo.json.changed).toBe(12);
    await B.pull();
    expect(B.nodes.get(created[0].serverId).deleted).toBe(false);
  });

  it('folder delete counts the bookmarks inside', async () => {
    await A.pull();
    const f = A.live().filter((n) => n.url?.startsWith('https://mass.example/'));
    // 모아서 폴더로 옮긴 뒤 폴더 하나 삭제 = 북마크 30개 삭제
    const r = await A.push([{ op: 'create', clientRef: 'mf', kind: 'folder', parent: null, title: 'Mass' }]);
    const folder = res(r);
    await A.push(f.map((n) => ({ op: 'move', id: n.id, baseRev: n.rev, parent: { serverId: folder.serverId } })));
    const blocked = await A.push([{ op: 'delete', id: folder.serverId, baseRev: folder.rev }]);
    expect(blocked.status).toBe(409);
    expect(blocked.json.deletes).toBe(30);
  });
});

describe('snapshots & undo', () => {
  it('restore brings back the snapshot state; restore itself is undoable', async () => {
    await A.pull();
    const snap = (await t.call('POST', '/snapshots', { token: A.token })).json;
    expect(snap.kind).toBe('manual');
    const before = (await A.pull(), A.view());

    const target = A.byUrl('https://example.com/docs');
    const ren = A.folder('Side projects');
    const del = await A.push([{ op: 'delete', id: target.id, baseRev: target.rev }, { op: 'update', id: ren.id, baseRev: ren.rev, title: 'oops' }]);
    expect(del.json.results.map((r: any) => r.status)).toEqual(['applied', 'applied']);
    await A.push([{ op: 'create', clientRef: 'after', kind: 'bookmark', parent: null, title: 'new', url: 'https://after.example/' }]);
    await A.pull();
    expect(A.view()).not.toEqual(before);

    const r = await t.call('POST', `/snapshots/${snap.id}/restore`, { token: A.token });
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(3);
    await A.pull();
    await B.pull();
    expect(A.view()).toEqual(before);
    expect(B.view()).toEqual(before);

    const list = (await t.call('GET', '/snapshots', { token: A.token })).json.snapshots.map((s: any) => s.kind);
    expect(list).toContain('pre-restore');
    expect(list).toContain('daily'); // push 가 하루 1개 자동 스냅샷을 만든다

    const undo = await t.call('POST', '/changes/undo', { token: A.token, body: { batchId: r.json.batchId } });
    expect(undo.json.changed).toBe(3);
    await A.pull();
    expect(A.byUrl('https://after.example/')).toBeTruthy();
    expect(A.folder('oops')).toBeTruthy();
  });

  it('lists change batches', async () => {
    const r = await t.call('GET', '/changes', { token: A.token });
    expect(r.json.batches.length).toBeGreaterThan(5);
  });
});

describe('import + categorize + suggestions', () => {
  const html = readFileSync(fileURLToPath(new URL('./chrome.html', import.meta.url)), 'utf8');

  it('imports a Chrome export: dedups and categorizes by rules', async () => {
    const r = await t.call('POST', '/import', { token: A.token, raw: html });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ received: 6, mergedInFile: 1, created: 5, llmUsed: false });
    expect(r.json.byCategory).toMatchObject({ 개발: 3, '영상·음악': 1, 미분류: 1 });
    const again = await t.call('POST', '/import', { token: B.token, raw: html });
    expect(again.json).toMatchObject({ created: 0, mergedExisting: 5 });
  });

  it('imports other tools\' exports (XBEL / Karakeep / Linkwarden / Raindrop CSV) and rejects unknown', async () => {
    const fx = (n: string) => readFileSync(fileURLToPath(new URL(`../../../packages/core/test/fixtures/import/${n}`, import.meta.url)), 'utf8');
    const xbel = await t.call('POST', '/import', { token: A.token, raw: fx('floccus.xbel') });
    expect(xbel.status).toBe(200);
    expect(xbel.json).toMatchObject({ received: 6, mergedInFile: 1 });
    const kk = await t.call('POST', '/import', { token: A.token, body: { file: fx('karakeep.json') } });
    expect(kk.status).toBe(200);
    expect(kk.json.received).toBe(3);
    const lw = await t.call('POST', '/import', { token: A.token, body: { file: fx('linkwarden.json'), format: 'linkwarden' } });
    expect(lw.json).toMatchObject({ received: 2, created: 0 }); // 둘 다 위에서 이미 들어옴
    const rd = await t.call('POST', '/import', { token: A.token, raw: fx('raindrop.csv') });
    expect(rd.json).toMatchObject({ received: 3, created: 0 });
    const bad = await t.call('POST', '/import', { token: A.token, raw: 'hello world' });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe('unknown_format');
  });

  it('autoCategorize puts captured bookmarks in a category', async () => {
    await A.pull();
    const r = await A.push([{ op: 'create', clientRef: 'cap', kind: 'bookmark', parent: null, autoCategorize: true, title: 'Coupang', url: 'https://www.coupang.com/np/search?q=x' }]);
    await A.pull();
    expect(A.nodes.get(res(r).serverId).parentId).toBe(A.folder('쇼핑').id);
  });

  it('LLM new category → suggestion only; approve creates folder and moves', async () => {
    setLlmOverride({
      name: 'fake',
      categorize: async (items) => items.map((i) => (i.url.includes('plants') ? { itemId: i.id, newCategory: '원예' } : { itemId: i.id, skip: true as const })),
    });
    const r = await t.call('POST', '/import', { token: A.token, body: { items: [{ url: 'https://plants.example/monstera', title: '몬스테라' }, { url: 'https://plants.example/fern', title: '고사리' }] } });
    setLlmOverride(undefined);
    expect(r.json.suggestions).toHaveLength(1);
    await A.pull();
    expect(A.folder('원예')).toBeUndefined(); // 자동 생성 금지
    const list = (await t.call('GET', '/suggestions', { token: A.token })).json.suggestions;
    const s = list.find((x: any) => x.kind === 'new_category');
    expect(s.actions.filter((a: any) => a.type === 'move')).toHaveLength(2);
    const ok = await t.call('POST', `/suggestions/${s.id}/approve`, { token: A.token });
    expect(ok.json).toMatchObject({ status: 'approved', applied: 3 });
    await A.pull();
    const f = A.folder('원예');
    expect(A.byUrl('https://plants.example/fern').parentId).toBe(f.id);
    expect((await t.call('POST', `/suggestions/${s.id}/approve`, { token: A.token })).status).toBe(409);
  });

  it('learns from user moves and suggests cleaning the inbox', async () => {
    const imp = await t.call('POST', '/import', { token: A.token, body: { items: [1, 2, 3].map((i) => ({ url: `https://recipes.example/${i}`, title: `recipe ${i}` })) } });
    expect(imp.json.byCategory).toEqual({ 미분류: 3 });
    await A.pull();
    const cook = res(await A.push([{ op: 'create', clientRef: 'cook', kind: 'folder', parent: null, title: '요리' }]));
    const r1 = A.byUrl('https://recipes.example/1');
    const r2 = A.byUrl('https://recipes.example/2');
    await A.push([
      { op: 'move', id: r1.id, baseRev: r1.rev, parent: { serverId: cook.serverId } },
      { op: 'move', id: r2.id, baseRev: r2.rev, parent: { serverId: cook.serverId } },
    ]);
    // 새로 들어오는 같은 도메인은 학습 규칙으로 바로 요리에
    const next = await t.call('POST', '/import', { token: A.token, body: { items: [{ url: 'https://recipes.example/4', title: 'recipe 4' }] } });
    expect(next.json.byCategory).toEqual({ 요리: 1 });
    // 미분류에 남은 3 번은 제안으로
    const gen = (await t.call('POST', '/suggestions/generate', { token: A.token })).json.suggestions;
    const apply = gen.find((s: any) => s.kind === 'apply_rules');
    expect(apply.actions).toEqual([{ type: 'move', nodeId: A.byUrl('https://recipes.example/3').id, to: cook.serverId }]);
    const empty = gen.find((s: any) => s.kind === 'remove_empty');
    expect(empty.actions.length).toBeGreaterThan(0);
    await t.call('POST', `/suggestions/${apply.id}/approve`, { token: A.token });
    const rej = await t.call('POST', `/suggestions/${empty.id}/reject`, { token: A.token });
    expect(rej.json.status).toBe('rejected');
    await A.pull();
    expect(A.byUrl('https://recipes.example/3').parentId).toBe(cook.serverId);
  });

  it('device mapping copy is kept on server', async () => {
    const r = await t.call('GET', '/sync/mappings', { token: A.token });
    expect(r.json.mappings.find((m: any) => m.browserId === 'a1')).toBeTruthy();
  });
});

describe('hardening', () => {
  it('import drops javascript:/data:/vbscript: links from any source and reports them', async () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><A HREF="javascript:alert(document.cookie)">evil</A>
      <DT><A HREF="data:text/html;base64,PHNjcmlwdD4=">evil2</A>
      <DT><A HREF="https://safe.example/ok">ok</A></DL>`;
    const r = await t.call('POST', '/import', { token: A.token, raw: html });
    expect(r.status).toBe(200);
    expect(r.json, JSON.stringify(r.json)).toMatchObject({ skippedUnsafe: 2, created: 1 });
    const items = await t.call('POST', '/import', { token: A.token, body: { items: [{ url: 'vbscript:x', title: 'v' }, { url: 'JAVASCRIPT:1', title: 'j' }] } });
    expect(items.json).toMatchObject({ received: 2, skippedUnsafe: 2, created: 0 });
    await A.pull();
    expect(A.live().some((n) => /^(javascript|data|vbscript):/i.test(n.url ?? ''))).toBe(false);
  });

  it('push rejects strings browsers cannot store as URLs, keeps user bookmarklets', async () => {
    const r = await A.push([
      { op: 'create', clientRef: 'h1', kind: 'bookmark', parent: null, title: 'bad', url: 'not a url' },
      { op: 'create', clientRef: 'h2', kind: 'bookmark', parent: null, title: 'long', url: 'https://x.example/' + 'a'.repeat(3000) },
      { op: 'create', clientRef: 'h3', kind: 'bookmark', parent: null, title: 'bm', url: 'javascript:void(document.title)' },
      { op: 'create', clientRef: 'h4', kind: 'bookmark', parent: null, title: 'T'.repeat(5000), url: 'https://h4.example/' },
    ]);
    expect(r.json.results.map((x: any) => x.status)).toEqual(['rejected', 'rejected', 'applied', 'applied']);
    expect(r.json.results[0].reason).toBe('invalid url');
    expect(r.json.results[1].reason).toBe('url too long');
    await A.pull();
    expect(A.byUrl('https://h4.example/').title).toHaveLength(2048);
  });

  it('import rejects bodies over the size cap with 413', async () => {
    const big = 'x'.repeat(IMPORT_MAX_BYTES + 1);
    const r = await t.call('POST', '/import', { token: A.token, raw: big });
    expect(r.status).toBe(413);
    expect(r.json).toMatchObject({ error: 'too_large', maxBytes: IMPORT_MAX_BYTES });
  });

  it('daily snapshot is taken before the push is applied (Should 7)', async () => {
    await t.DB.prepare(`DELETE FROM snapshots WHERE kind='daily'`).run();
    const before = (await t.DB.prepare(`SELECT value FROM meta WHERE key='rev'`).first<{ value: number }>())!.value;
    const r = await A.push([{ op: 'create', clientRef: 's7', kind: 'bookmark', parent: null, title: 's7', url: 'https://s7.example/' }]);
    expect(r.json.rev).toBeGreaterThan(before);
    const daily = (await t.call('GET', '/snapshots', { token: A.token })).json.snapshots.find((x: any) => x.kind === 'daily');
    expect(daily.rev).toBe(before);
  });

  it('bad input never becomes a 500 with DB text (Should 5)', async () => {
    const u = await t.call('POST', '/changes/undo', { token: A.token, body: { batchId: {} } });
    expect(u.status).toBe(400);
    const ch = await t.call('GET', '/changes?limit=999999', { token: A.token });
    expect(ch.status).toBe(200);
    expect(ch.json.batches.length).toBeLessThanOrEqual(500);
  });

  it('500 responses do not leak internal error text', async () => {
    const secret = 'SQLITE_ERROR: no such column: token_hash_secret_detail';
    const brokenDb = { prepare() { throw new Error(secret); } } as unknown as D1Database;
    const orig = console.error;
    console.error = () => {};
    try {
      const res = await app.fetch(new Request('http://local/me', { headers: { authorization: `Bearer ${A.token}` } }), { DB: brokenDb, ADMIN_TOKEN: 'x' }, {
        waitUntil() {}, passThroughOnException() {}, props: {},
      } as unknown as ExecutionContext);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(text).not.toContain('SQLITE');
      expect(JSON.parse(text)).toMatchObject({ error: 'internal', ref: expect.any(String) });
    } finally {
      console.error = orig;
    }
  });
});

describe('import keeps the user folder structure for what rules cannot place (M2)', () => {
  const folders = async () => (await t.call('GET', '/categories', { token: A.token })).json.categories as Array<{ id: string; name: string; parentId: string | null }>;

  it('Netscape export: personal folders are recreated, browser containers are not, same-name category is reused', async () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">Bookmarks bar</H3><DL><p>
        <DT><H3>Recipes</H3><DL><p>
          <DT><H3>Korean</H3><DL><p><DT><A HREF="https://m2-food.example/kimchi">kimchi</A></DL><p>
          <DT><A HREF="https://m2-food.example/bread">bread</A>
        </DL><p>
        <DT><H3>금융</H3><DL><p><DT><A HREF="https://m2-money.example/budget">budget</A></DL><p>
        <DT><A HREF="https://m2-loose.example/">loose</A>
      </DL><p></DL><p>`;
    const r = await t.call('POST', '/import', { token: A.token, raw: html });
    expect(r.status).toBe(200);
    const fs = await folders();
    const recipes = fs.find((f) => f.name === 'Recipes' && f.parentId === null)!;
    expect(recipes).toBeTruthy();
    const korean = fs.find((f) => f.name === 'Korean' && f.parentId === recipes.id)!;
    expect(korean).toBeTruthy();
    expect(fs.some((f) => f.name === 'Bookmarks bar')).toBe(false);
    expect(fs.filter((f) => f.name === '금융')).toHaveLength(1); // 기존 카테고리로 합침
    await A.pull();
    expect(A.byUrl('https://m2-food.example/kimchi').parentId).toBe(korean.id);
    expect(A.byUrl('https://m2-food.example/bread').parentId).toBe(recipes.id);
    expect(A.byUrl('https://m2-money.example/budget').parentId).toBe(A.folder('금융').id);
    expect(A.byUrl('https://m2-loose.example/').parentId).toBe(A.folder('미분류').id);
    // 원본 폴더 재현도 같은 batch 라 한 번에 되돌릴 수 있다
    const undo = await t.call('POST', '/changes/undo', { token: A.token, body: { batchId: r.json.batchId } });
    expect(undo.status).toBe(200);
    expect((await folders()).some((f) => f.name === 'Recipes')).toBe(false);
  });

  it('Linkwarden nested collections become nested folders', async () => {
    const lw = JSON.stringify({
      collections: [
        { id: 1, name: 'Research', parentId: null, links: [{ id: 1, name: 'paper', type: 'url', url: 'https://m2-research.example/p1' }] },
        { id: 2, name: 'Cooking', parentId: 1, links: [{ id: 2, name: 'stew', type: 'url', url: 'https://m2-research.example/stew' }] },
      ],
    });
    const r = await t.call('POST', '/import', { token: A.token, body: { file: lw, format: 'linkwarden' } });
    expect(r.status).toBe(200);
    const fs = await folders();
    const research = fs.find((f) => f.name === 'Research' && f.parentId === null)!;
    expect(research).toBeTruthy();
    expect(fs.find((f) => f.name === 'Cooking' && f.parentId === research.id)).toBeTruthy();
  });
});

describe('category keys + locale (M3)', () => {
  it('renamed default category keeps getting its rule matches; renamed inbox still is the inbox', async () => {
    await A.pull();
    const dev = A.folder('개발');
    const inbox = A.folder('미분류');
    await A.push([
      { op: 'update', id: dev.id, baseRev: dev.rev, title: 'Code' },
      { op: 'update', id: inbox.id, baseRev: inbox.rev, title: 'Later' },
    ]);
    const r = await t.call('POST', '/import', { token: A.token, body: { items: [{ url: 'https://gitlab.com/m3/x', title: 'gl' }, { url: 'https://m3-unknown.example/', title: 'u' }] } });
    expect(r.json.byCategory).toEqual({ Code: 1, Later: 1 });
    await A.pull();
    const d = A.folder('Code');
    const l = A.folder('Later');
    await A.push([
      { op: 'update', id: d.id, baseRev: d.rev, title: '개발' },
      { op: 'update', id: l.id, baseRev: l.rev, title: '미분류' },
    ]);
  });

  it('fresh server seeds English categories by default and Korean from Accept-Language', async () => {
    const en = await setup({ locale: null });
    try {
      const d = await en.register('en-device');
      const names = (await en.call('GET', '/categories', { token: d.token })).json.categories.map((c: any) => c.name);
      expect(names).toEqual(expect.arrayContaining(['Development', 'News', 'Unsorted']));
      expect(names).not.toContain('미분류');
      const imp = await en.call('POST', '/import', { token: d.token, body: { items: [{ url: 'https://github.com/x/y', title: 'g' }, { url: 'https://m3.example/', title: 'm' }] } });
      expect(imp.json.byCategory).toEqual({ Development: 1, Unsorted: 1 });
    } finally {
      await en.close();
    }
    const ko = await setup({ locale: null });
    try {
      const r = await ko.call('POST', '/devices', { token: 'admin-secret', body: { name: 'ko' }, headers: { 'accept-language': 'ko-KR,ko;q=0.9' } });
      const names = (await ko.call('GET', '/categories', { token: r.json.token })).json.categories.map((c: any) => c.name);
      expect(names).toEqual(expect.arrayContaining(['개발', '미분류']));
    } finally {
      await ko.close();
    }
  });
});

describe('D1 call budget (Should 6)', () => {
  /** D1 호출(first/all/run/raw/batch)을 센다 — Workers Free 는 요청당 50 */
  const counted = (db: D1Database) => {
    let calls = 0;
    const wrapStmt = (s: D1PreparedStatement): D1PreparedStatement =>
      new Proxy(s, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv);
          if (prop === 'bind') return (...a: unknown[]) => wrapStmt((v as Function).apply(target, a));
          if (prop === 'first' || prop === 'all' || prop === 'run' || prop === 'raw') return (...a: unknown[]) => (calls++, (v as Function).apply(target, a));
          return typeof v === 'function' ? v.bind(target) : v;
        },
      });
    const proxy = new Proxy(db, {
      get(target, prop, recv) {
        const v = Reflect.get(target, prop, recv);
        if (prop === 'prepare') return (q: string) => wrapStmt(target.prepare(q));
        if (prop === 'batch') return (st: D1PreparedStatement[]) => (calls++, target.batch(st.map((x) => ((x as any).__target ?? x))));
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    return { db: proxy, get calls() { return calls; } };
  };

  it('a 300-op push (creates, captures, moves, renames, folder delete) stays well under 50 D1 calls', async () => {
    const c = counted(t.env.DB);
    const env = { ...t.env, DB: c.db };
    const callWith = async (path: string, body: unknown) => {
      const res = await app.fetch(new Request(`http://local${path}`, { method: 'POST', headers: { authorization: `Bearer ${A.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, {
        waitUntil() {}, passThroughOnException() {}, props: {},
      } as unknown as ExecutionContext);
      return { status: res.status, json: (await res.json()) as any };
    };
    const ops: any[] = [{ op: 'create', clientRef: 'budget-f', kind: 'folder', parent: null, title: 'budget' }];
    for (let i = 0; i < 150; i++) ops.push({ op: 'create', clientRef: `budget-${i}`, kind: 'bookmark', parent: { clientRef: 'budget-f' }, title: `b${i}`, url: `https://budget.example/${i}` });
    for (let i = 0; i < 50; i++) ops.push({ op: 'create', clientRef: `capture:budget-${i}`, kind: 'bookmark', parent: null, autoCategorize: true, title: `c${i}`, url: `https://github.com/budget/${i}` });
    const r = await callWith('/sync/push', { ops });
    expect(r.status).toBe(200);
    expect(r.json.results.filter((x: any) => x.status === 'applied')).toHaveLength(201);
    const first = c.calls;
    console.log(`[budget] push#1 D1 calls=${first}`);
    expect(first).toBeLessThan(25);
    await A.pull();
    const folder = A.folder('budget');
    const bms = [...A.nodes.values()].filter((n: any) => n.parentId === folder.id && !n.deleted).slice(0, 50);
    const ops2: any[] = [
      ...bms.slice(0, 25).map((n: any) => ({ op: 'update', id: n.id, baseRev: n.rev, title: n.title + '!' })),
      ...bms.slice(25).map((n: any) => ({ op: 'move', id: n.id, baseRev: n.rev, parent: { serverId: A.folder('개발').id } })),
      { op: 'delete', id: folder.id, baseRev: folder.rev },
    ];
    const r2 = await callWith('/sync/push', { ops: ops2, confirmMassDelete: true });
    expect(r2.status).toBe(200);
    expect(r2.json.results.every((x: any) => x.status === 'applied')).toBe(true);
    console.log(`[budget] push#2 D1 calls=${c.calls - first}`);
    expect(c.calls - first).toBeLessThan(25);
    await A.pull();
    expect([...A.nodes.values()].filter((n: any) => n.parentId === folder.id && !n.deleted)).toHaveLength(0);
  });
});

describe('pull rev race (Should 4)', () => {
  it('a write that lands while pull runs is not skipped by the next pull', async () => {
    const store = new Store(t.DB);
    const since = await store.currentRev();
    const orig = store.currentRev.bind(store);
    let injected = false;
    store.currentRev = async () => {
      const r = await orig();
      if (!injected) {
        injected = true; // pull 이 rev 를 읽은 직후 다른 기기가 쓴다
        await store.write({ id: crypto.randomUUID(), kind: 'bookmark', parentId: null, title: 'race', url: 'https://race.example/', position: 0, deleted: false }, { op: 'create', deviceId: 'other', batchId: null, before: null });
      }
      return r;
    };
    const first = await pull(store, since);
    expect(first.nodes.some((n) => n.url === 'https://race.example/')).toBe(false);
    const second = await pull(new Store(t.DB), first.rev);
    expect(second.nodes.some((n) => n.url === 'https://race.example/')).toBe(true);
  });
});

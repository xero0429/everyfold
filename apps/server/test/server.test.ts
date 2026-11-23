import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setLlmOverride } from '../src/categorize.js';
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

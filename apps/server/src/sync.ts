import {
  clampTitle, decideDelete, SESSIONS_KEY, sessionsFolderName, decideFieldMerge, isMassDelete, isParsableUrl, MASS_DELETE_RATIO, MAX_URL_LENGTH, normalizeUrl,
  type MassDeleteError, type NodeRef, type OpResult, type PullResponse, type PushRequest, type PushResponse, type ServerNode, type SyncOp,
} from '@everyfold/core';
import { rowToNode, rowToState, Store, type NodeRow, type NodeState } from './store.js';
import { addNewCategorySuggestion, classifyWithContext } from './categorize.js';
import type { Env } from './env.js';
import { serverLocale, t } from './locale.js';

export async function pull(store: Store, since: number, limit = 1000): Promise<PullResponse & { more: boolean }> {
  // rev 를 먼저 읽고 그 rev 까지만 돌려준다. SELECT 뒤에 rev 를 읽으면 그 사이 다른 기기가 쓴 노드가
  // "이미 받은 rev" 안에 들어가 다음 pull 에서 영원히 빠진다.
  const upTo = await store.currentRev();
  const rows = (
    await store.db.prepare(`SELECT * FROM nodes WHERE rev > ? AND rev <= ? ORDER BY rev LIMIT ?`).bind(since, upTo, limit + 1).all<NodeRow>()
  ).results;
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const rev = more ? page[page.length - 1]!.rev : Math.max(since, upTo);
  return { rev, nodes: page.map(rowToNode), more };
}

export class MassDeleteBlocked extends Error {
  constructor(readonly info: MassDeleteError) {
    super('mass_delete');
  }
}

/** 서버가 받지 않는 URL 이면 이유. 사용자 북마클릿(javascript:)은 기기에서 올라온 것이므로 허용한다(가져오기와 다름). */
function badUrl(url: string): string | null {
  if (url.length > MAX_URL_LENGTH) return 'url too long';
  if (!isParsableUrl(url)) return 'invalid url';
  return null;
}

type Field = 'title' | 'url' | 'parentId' | 'position';

/**
 * push — D1 호출 수를 op 개수와 무관하게 묶는다(Workers Free: 요청당 D1 호출 50).
 *  1) 읽기: 필요한 행·폴더·매핑·중복 URL·위치·변경 기록·삭제 자손·분류 문맥을 json_each 로 몇 번에 미리 읽는다.
 *  2) 판정: op 를 순서대로 메모리의 작업 사본에 적용하며 쓸 문장을 모은다(같은 push 안 앞 op 결과가 뒤 op 에 보인다).
 *  3) 쓰기: 모은 문장을 D1 batch 하나로 보낸다 — 트랜잭션 하나라 push 가 중간에 끊겨 반만 적용되는 일이 없다.
 * 호출 수는 test 'push uses a bounded number of D1 calls' 가 센다.
 */
export async function push(store: Store, env: Env, deviceId: string, req: PushRequest): Promise<PushResponse> {
  const ops = Array.isArray(req.ops) ? req.ops : [];
  const db = store.db;
  const json = (v: unknown) => JSON.stringify(v);

  /* ── 1) 미리 읽기 ── */
  const opIds = ops.flatMap((o) => (o.op === 'create' ? [] : [o.id]));
  const refIds = ops.flatMap((o) => ('parent' in o && o.parent && 'serverId' in o.parent ? [o.parent.serverId] : []));
  const refClient = ops.flatMap((o) => ('parent' in o && o.parent && 'clientRef' in o.parent ? [o.parent.clientRef] : []));
  const createNorms = ops.flatMap((o) => (o.op === 'create' && o.kind === 'bookmark' && o.url ? [normalizeUrl(o.url.trim())] : []));
  const urlNorms = ops.flatMap((o) => (o.op === 'update' && o.url ? [normalizeUrl(o.url.trim())] : []));
  const delIds = ops.flatMap((o) => (o.op === 'delete' ? [o.id] : []));
  const minBase = Math.min(...ops.flatMap((o) => ('baseRev' in o ? [o.baseRev] : [])), Number.MAX_SAFE_INTEGER);

  const rows = new Map<string, NodeRow>();
  for (const r of await store.getMany([...opIds, ...refIds])) rows.set(r.id, r);
  for (const r of await store.liveFolders()) rows.set(r.id, r);
  /** 폴더 id 가 세션 폴더(cat_key='sessions') 이거나 그 아래인가 — rows(작업 사본)를 따라 올라가므로 같은 push 안에서 만든 폴더도 본다 */
  const inSessions = (folderId: string | null | undefined) => {
    for (let p = folderId ?? null, i = 0; p && i < 1000; i++) {
      const r = rows.get(p);
      if (!r || r.deleted) return false;
      if (r.cat_key === SESSIONS_KEY) return true;
      p = r.parent_id;
    }
    return false;
  };
  const descendantsOfDeleted = delIds.length
    ? (await db
        .prepare(
          `WITH RECURSIVE sub(id) AS (SELECT id FROM nodes WHERE parent_id IN (SELECT value FROM json_each(?)) AND deleted=0
             UNION SELECT n.id FROM nodes n JOIN sub ON n.parent_id=sub.id WHERE n.deleted=0)
           SELECT nodes.* FROM nodes JOIN sub ON nodes.id=sub.id`,
        )
        .bind(json(delIds))
        .all<NodeRow>()).results
    : [];
  for (const r of descendantsOfDeleted) if (!rows.has(r.id)) rows.set(r.id, r);
  const byNorm = new Map<string, NodeRow>();
  if (createNorms.length || urlNorms.length) {
    const r = await db
      .prepare(`SELECT * FROM nodes WHERE norm_url IN (SELECT value FROM json_each(?)) AND deleted=0 AND kind='bookmark' ORDER BY created_at`)
      .bind(json([...new Set([...createNorms, ...urlNorms])]))
      .all<NodeRow>();
    for (const row of r.results) {
      if (!rows.has(row.id)) rows.set(row.id, row);
      // 세션 폴더 안 북마크(저장한 탭)는 합치기 대상이 아니다 — 라이브러리 북마크를 세션으로 끌고 가거나 그 반대가 되지 않게
      if (!byNorm.has(row.norm_url!) && !inSessions(row.parent_id)) byNorm.set(row.norm_url!, rows.get(row.id) ?? row);
    }
  }
  const mapped = new Map<string, string>();
  if (refClient.length) {
    const r = await db
      .prepare(`SELECT browser_id, server_id FROM mappings WHERE device_id=? AND browser_id IN (SELECT value FROM json_each(?))`)
      .bind(deviceId, json([...new Set(refClient)]))
      .all<{ browser_id: string; server_id: string }>();
    for (const m of r.results) mapped.set(m.browser_id, m.server_id);
    const missing = [...mapped.values()].filter((id) => !rows.has(id));
    for (const row of await store.getMany(missing)) rows.set(row.id, row);
  }
  const maxPos = new Map<string | null, number>();
  if (ops.some((o) => o.op === 'create' || o.op === 'move' || o.op === 'update')) {
    const r = await db.prepare(`SELECT parent_id AS p, MAX(position) AS m FROM nodes WHERE deleted=0 GROUP BY parent_id`).all<{ p: string | null; m: number }>();
    for (const x of r.results) maxPos.set(x.p, x.m);
  }
  const changesByNode = new Map<string, Array<{ rev: number; before: NodeState | null; after: NodeState | null }>>();
  const editIds = ops.flatMap((o) => (o.op === 'create' ? [] : [o.id]));
  if (editIds.length) {
    const r = await db
      .prepare(`SELECT node_id, rev, before_json, after_json FROM changes WHERE node_id IN (SELECT value FROM json_each(?)) AND rev > ? AND (device_id IS NULL OR device_id<>?)`)
      .bind(json([...new Set(editIds)]), minBase, deviceId)
      .all<{ node_id: string; rev: number; before_json: string | null; after_json: string | null }>();
    for (const c of r.results) {
      const list = changesByNode.get(c.node_id) ?? [];
      list.push({ rev: c.rev, before: c.before_json ? JSON.parse(c.before_json) : null, after: c.after_json ? JSON.parse(c.after_json) : null });
      changesByNode.set(c.node_id, list);
    }
  }

  // 안전: 대량 삭제는 확인 없이는 하나도 적용하지 않는다
  const live = await store.liveBookmarkCount();
  if (delIds.length) {
    const doomed = new Set<string>();
    for (const id of delIds) {
      const row = rows.get(id);
      if (row && !row.deleted && row.kind === 'bookmark') doomed.add(id);
    }
    const delFolders = new Set(delIds.filter((id) => rows.get(id)?.kind === 'folder'));
    const under = (r: NodeRow) => {
      for (let p = r.parent_id, i = 0; p && i < 1000; i++) {
        if (delFolders.has(p)) return true;
        p = rows.get(p)?.parent_id ?? null;
      }
      return false;
    };
    for (const d of descendantsOfDeleted) if (d.kind === 'bookmark' && under(d)) doomed.add(d.id);
    if (!req.confirmMassDelete && isMassDelete(doomed.size, live)) {
      throw new MassDeleteBlocked({ error: 'mass_delete', deletes: doomed.size, liveBookmarks: live, ratio: doomed.size / live, threshold: MASS_DELETE_RATIO });
    }
  }

  // 자동 분류(capture)는 한 번에
  const autoIdx = ops.flatMap((o, i) => (o.op === 'create' && o.kind === 'bookmark' && o.parent === null && o.autoCategorize && o.url ? [i] : []));
  const autoCat = new Map<number, string | null>();
  if (autoIdx.length) {
    const { results, inboxId } = await classifyWithContext(store, env, autoIdx.map((i) => {
      const o = ops[i] as Extract<SyncOp, { op: 'create' }>;
      return { id: String(i), url: o.url!.trim(), title: o.title ?? '' };
    }));
    const suggest = new Map<string, number>();
    for (const r of results) {
      autoCat.set(Number(r.itemId), r.categoryId ?? inboxId);
      if (r.suggestedCategory) suggest.set(r.suggestedCategory, 1);
    }
    for (const name of suggest.keys()) await addNewCategorySuggestion(store, env, name, []);
  }
  const sessionsTitle = ops.some((o) => o.op === 'create' && o.key === SESSIONS_KEY) ? sessionsFolderName(await serverLocale(store, env)) : '';
  const untitled = ops.some((o) => o.op === 'create' && o.kind === 'folder' && !(o.title ?? '').trim()) ? t(await serverLocale(store, env), 'untitledFolder') : '';

  /* ── 2) 메모리에서 판정 ── */
  const batchId = ops.length ? crypto.randomUUID() : null;
  const stmts: D1PreparedStatement[] = [];
  const revSlot = new Map<string, number>(); // node id → 마지막으로 쓴 문장 묶음의 rev SELECT 위치
  const results: Array<OpResult & { _node?: string }> = [];
  const created = new Map<string, string>(); // clientRef → serverId
  const mappingsOut: Array<{ clientRef: string; serverId: string }> = [];
  const now = Date.now();

  const posFor = (parent: string | null) => {
    const p = (maxPos.get(parent) ?? -1) + 1;
    maxPos.set(parent, p);
    return p;
  };
  const write = (after: NodeState, op: string, before: NodeState | null, catKey?: string) => {
    stmts.push(...store.writeStmts(after, { op, deviceId, batchId, before, ...(catKey ? { catKey } : {}) }));
    revSlot.set(after.id, stmts.length - 1);
    const prev = rows.get(after.id);
    const row: NodeRow = {
      ...(prev ?? { created_at: now, rev: 0 }), id: after.id, kind: after.kind, parent_id: after.parentId, title: after.title, url: after.url,
      norm_url: after.kind === 'bookmark' && after.url ? normalizeUrl(after.url) : null, position: after.position, deleted: after.deleted ? 1 : 0, updated_at: now,
      ...(catKey ? { cat_key: catKey } : {}),
    } as NodeRow;
    rows.set(after.id, row);
    if (prev?.norm_url && byNorm.get(prev.norm_url)?.id === after.id) byNorm.delete(prev.norm_url);
    if (row.norm_url && !row.deleted && !byNorm.has(row.norm_url) && !inSessions(row.parent_id)) byNorm.set(row.norm_url, row);
  };
  const remember = (clientRef: string, serverId: string) => {
    created.set(clientRef, serverId);
    mappingsOut.push({ clientRef, serverId });
    // /categories 등 서버 API 가 만든 임시 ref 는 기기 매핑이 아니다
    if (clientRef.startsWith('api:')) return;
    stmts.push(
      db.prepare(`INSERT INTO mappings (device_id, browser_id, server_id) VALUES (?, ?, ?) ON CONFLICT(device_id, browser_id) DO UPDATE SET server_id=excluded.server_id`).bind(deviceId, clientRef, serverId),
    );
  };
  const conflict = (c: { nodeId: string; reason: string; op: unknown; server: NodeState | null; serverWon?: string[] }) =>
    stmts.push(
      db
        .prepare(`INSERT INTO conflicts (node_id, device_id, reason, op_json, server_json, server_won, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(c.nodeId, deviceId, c.reason, json(c.op), c.server ? json(c.server) : null, c.serverWon ? c.serverWon.join(',') : null, now),
    );
  const live_ = (id: string | null | undefined) => {
    const r = id ? rows.get(id) : undefined;
    return r && !r.deleted ? r : undefined;
  };
  const resolveRef = (ref: NodeRef | null): { ok: true; id: string | null } | { ok: false } => {
    if (ref === null) return { ok: true, id: null };
    const id = 'serverId' in ref ? ref.serverId : created.get(ref.clientRef) ?? mapped.get(ref.clientRef);
    const row = live_(id);
    if (!id || !row || row.kind !== 'folder') return { ok: false };
    return { ok: true, id };
  };
  const findLiveFolder = (parentId: string | null, title: string) => {
    for (const r of rows.values()) if (r.kind === 'folder' && !r.deleted && r.parent_id === parentId && r.title === title) return r;
    return undefined;
  };
  const isSelfOrDescendant = (nodeId: string, candidate: string) => {
    for (let cur: string | null = candidate, i = 0; cur && i < 1000; i++) {
      if (cur === nodeId) return true;
      cur = rows.get(cur)?.parent_id ?? null;
    }
    return false;
  };
  const changedSince = (nodeId: string, baseRev: number) => {
    const out = new Set<Field>();
    let any = false;
    for (const c of changesByNode.get(nodeId) ?? []) {
      if (c.rev <= baseRev) continue;
      any = true;
      const b = c.before;
      const a = c.after;
      for (const f of ['title', 'url', 'parentId', 'position'] as const) if (!b || !a || b[f] !== a[f]) out.add(f);
      if (b && a && b.deleted !== a.deleted) out.add('parentId');
    }
    return { fields: out, any };
  };
  const liveDescendants = (folderId: string) => {
    const kids = new Map<string, NodeRow[]>();
    for (const r of rows.values()) if (!r.deleted && r.parent_id) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r]);
    const out: NodeRow[] = [];
    const walk = (id: string) => {
      for (const c of kids.get(id) ?? []) {
        out.push(c);
        walk(c.id);
      }
    };
    walk(folderId);
    return out;
  };

  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]!;
    try {
      if (op.op === 'create') {
        const parent = resolveRef(op.parent);
        let parentId = parent.ok ? parent.id : null;
        if (op.kind === 'folder' && op.key !== undefined) {
          // 예약 폴더(지금은 세션 폴더 하나): 키로 찾고, 없으면 서버 로캘 이름으로 루트에 만든다. 이름이 아니라 키가 정체성이다.
          if (op.key !== SESSIONS_KEY || op.parent !== null) {
            results.push({ index, status: 'rejected', reason: 'unknown reserved folder' });
            continue;
          }
          let existing: NodeRow | undefined;
          for (const r of rows.values()) if (r.kind === 'folder' && !r.deleted && r.cat_key === SESSIONS_KEY) existing = existing && existing.created_at <= r.created_at ? existing : r;
          if (existing) {
            // 사용자가 세션 폴더를 다른 폴더 아래로 옮겨 두었으면 루트로 되돌린다 — 이동 기록(rev)이 남아 모든 기기가 다음 pull 에서 루트로 옮겨 받는다
            if (existing.parent_id !== null) {
              const prev = rowToState(existing);
              write({ ...prev, parentId: null, position: posFor(null) }, 'move', prev);
            }
            remember(op.clientRef, existing.id);
            results.push({ index, status: 'merged', serverId: existing.id, rev: existing.rev, reason: 'reserved folder exists', _node: existing.id });
            continue;
          }
          const id = crypto.randomUUID();
          const title = sessionsTitle;
          write({ id, kind: 'folder', parentId: null, title, url: null, position: op.position ?? posFor(null), deleted: false }, 'create', null, SESSIONS_KEY);
          remember(op.clientRef, id);
          results.push({ index, status: 'applied', serverId: id, _node: id });
          continue;
        }
        if (op.kind === 'folder') {
          const title = clampTitle((op.title ?? '').trim()) || untitled;
          const existing = findLiveFolder(parentId, title);
          if (existing) {
            remember(op.clientRef, existing.id);
            results.push({ index, status: 'merged', serverId: existing.id, rev: existing.rev, reason: 'same folder name', _node: existing.id });
            continue;
          }
          const id = crypto.randomUUID();
          write({ id, kind: 'folder', parentId, title, url: null, position: op.position ?? posFor(parentId), deleted: false }, 'create', null);
          remember(op.clientRef, id);
          results.push({ index, status: 'applied', serverId: id, _node: id });
          continue;
        }
        const url = (op.url ?? '').trim();
        if (!url) {
          results.push({ index, status: 'rejected', reason: 'bookmark needs url' });
          continue;
        }
        const bad = badUrl(url);
        if (bad) {
          results.push({ index, status: 'rejected', reason: bad });
          continue;
        }
        if (autoCat.has(index)) parentId = autoCat.get(index) ?? null;
        const title = clampTitle(op.title);
        // 세션 안에 만드는 탭 북마크는 늘 새로 만든다(라이브러리·다른 세션에 같은 주소가 있어도 합치지 않는다)
        const dup = inSessions(parentId) ? undefined : byNorm.get(normalizeUrl(url));
        if (dup) {
          // 같은 북마크가 이미 있다 → 새로 만들지 않고 합친다. 기기가 다른 폴더에 명시적으로 넣었다면 그 위치로 옮긴다.
          if (!op.autoCategorize && dup.parent_id !== parentId) {
            const before = rowToState(dup);
            write({ ...before, parentId, position: op.position ?? posFor(parentId) }, 'move', before);
          }
          remember(op.clientRef, dup.id);
          results.push({ index, status: 'merged', serverId: dup.id, rev: dup.rev, reason: 'duplicate url', _node: dup.id });
          continue;
        }
        const id = crypto.randomUUID();
        write({ id, kind: 'bookmark', parentId, title, url, position: op.position ?? posFor(parentId), deleted: false }, 'create', null);
        remember(op.clientRef, id);
        results.push({ index, status: 'applied', serverId: id, _node: id });
        continue;
      }

      const row = rows.get(op.id);
      if (!row) {
        results.push({ index, status: 'rejected', reason: 'unknown node' });
        continue;
      }
      const before = rowToState(row);

      if (op.op === 'delete') {
        const changedByOthers = changedSince(row.id, op.baseRev).any;
        const decision = decideDelete({ deleted: !!row.deleted, rev: changedByOthers ? op.baseRev + 1 : op.baseRev }, op.baseRev);
        if (decision === 'noop') {
          results.push({ index, status: 'noop', serverId: row.id, rev: row.rev, _node: row.id });
          continue;
        }
        if (decision === 'keep-conflict') {
          conflict({ nodeId: row.id, reason: 'delete-vs-newer-edit', op, server: before });
          results.push({ index, status: 'conflict', serverId: row.id, rev: row.rev, reason: 'edited elsewhere after you saw it; kept', _node: row.id });
          continue;
        }
        if (row.kind === 'folder') {
          // 자손도 각자 tombstone + 변경 기록(되돌리기 단위) — 같은 batch 안이라 D1 호출은 늘지 않는다
          for (const d of liveDescendants(row.id)) {
            const ds = rowToState(d);
            write({ ...ds, deleted: true }, 'delete', ds);
          }
        }
        write({ ...before, deleted: true }, 'delete', before);
        results.push({ index, status: 'applied', serverId: row.id, _node: row.id });
        continue;
      }

      if (row.deleted) {
        conflict({ nodeId: row.id, reason: `${op.op}-on-deleted`, op, server: before });
        results.push({ index, status: 'conflict', serverId: row.id, rev: row.rev, reason: 'node was deleted', _node: row.id });
        continue;
      }

      const wanted: Partial<Record<Field, unknown>> = {};
      if (op.op === 'update') {
        if (op.title !== undefined && clampTitle(op.title) !== row.title) wanted.title = clampTitle(op.title);
        if (op.url !== undefined && op.url.trim() !== row.url && row.kind === 'bookmark') {
          const bad = badUrl(op.url.trim());
          if (bad) {
            results.push({ index, status: 'rejected', serverId: row.id, reason: bad });
            continue;
          }
          wanted.url = op.url.trim();
        }
      } else {
        const parent = resolveRef(op.parent);
        if (!parent.ok) {
          conflict({ nodeId: row.id, reason: 'move-parent-missing', op, server: before });
          results.push({ index, status: 'conflict', serverId: row.id, rev: row.rev, reason: 'target folder missing', _node: row.id });
          continue;
        }
        if (parent.id && row.kind === 'folder' && isSelfOrDescendant(row.id, parent.id)) {
          results.push({ index, status: 'rejected', serverId: row.id, reason: 'cannot move folder into itself' });
          continue;
        }
        if (parent.id !== row.parent_id) wanted.parentId = parent.id;
        if (op.position !== undefined && op.position !== row.position) wanted.position = op.position;
      }
      if (Object.keys(wanted).length === 0) {
        results.push({ index, status: 'noop', serverId: row.id, rev: row.rev, _node: row.id });
        continue;
      }
      const d = decideFieldMerge(wanted, changedSince(row.id, op.baseRev).fields);
      if (d.conflict) conflict({ nodeId: row.id, reason: 'concurrent-edit', op, server: before, serverWon: d.serverWon });
      if (Object.keys(d.apply).length === 0) {
        results.push({ index, status: 'conflict', serverId: row.id, rev: row.rev, serverWon: d.serverWon, _node: row.id });
        continue;
      }
      const after: NodeState = { ...before };
      if ('title' in d.apply) after.title = String(d.apply.title);
      if ('url' in d.apply) after.url = String(d.apply.url);
      if ('parentId' in d.apply) after.parentId = (d.apply.parentId as string | null) ?? null;
      if ('position' in d.apply) after.position = Number(d.apply.position);
      if ('parentId' in d.apply && 'position' in wanted === false) after.position = posFor(after.parentId);
      write(after, op.op, before);
      // 학습: 사용자가 북마크를 다른 카테고리(폴더)로 옮겼다 — 세션 폴더 안은 카테고리가 아니라 적지 않는다
      if (row.kind === 'bookmark' && 'parentId' in d.apply && after.parentId && row.url && !inSessions(after.parentId)) {
        stmts.push(db.prepare(`INSERT INTO moves (url, to_category_id, at) VALUES (?, ?, ?)`).bind(row.url, after.parentId, now));
      }
      results.push(d.conflict ? { index, status: 'conflict', serverId: row.id, serverWon: d.serverWon, _node: row.id } : { index, status: 'applied', serverId: row.id, _node: row.id });
    } catch (err) {
      // 내부 오류 문구는 로그에만
      console.error('push op failed', index, err);
      results.push({ index, status: 'rejected', reason: 'internal error' });
    }
  }

  for (const m of req.mappings ?? []) {
    if (typeof m?.browserId !== 'string' || typeof m?.serverId !== 'string') continue;
    stmts.push(
      db.prepare(`INSERT INTO mappings (device_id, browser_id, server_id) VALUES (?, ?, ?) ON CONFLICT(device_id, browser_id) DO UPDATE SET server_id=excluded.server_id`).bind(deviceId, m.browserId, m.serverId),
    );
  }

  /* ── 3) 한 번에 쓰기 ── */
  stmts.push(db.prepare(`SELECT value FROM meta WHERE key='rev'`));
  const out = await db.batch(stmts);
  const revAt = (i: number) => ((out[i]?.results?.[0] as { value: number } | undefined)?.value ?? 0);
  const finalRev = revAt(out.length - 1);
  const nodeOut = (id: string): ServerNode | undefined => {
    const r = rows.get(id);
    if (!r) return undefined;
    const slot = revSlot.get(id);
    return rowToNode({ ...r, rev: slot !== undefined ? revAt(slot) : r.rev });
  };
  const final: OpResult[] = results.map(({ _node, ...r }) => {
    if (!_node) return r;
    const n = nodeOut(_node);
    if (n && (r.status === 'applied' || (r.status === 'conflict' && revSlot.has(_node)) || r.status === 'merged')) r.rev = n.rev;
    if (n && r.status === 'merged') r.node = n;
    return r;
  });
  return { rev: finalRev, batchId, results: final, mappings: mappingsOut };
}

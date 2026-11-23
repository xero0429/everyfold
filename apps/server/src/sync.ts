import {
  decideDelete, decideFieldMerge, isMassDelete, MASS_DELETE_RATIO, normalizeUrl,
  type MassDeleteError, type NodeRef, type OpResult, type PullResponse, type PushRequest, type PushResponse, type SyncOp,
} from '@everyfold/core';
import { rowToNode, rowToState, Store, type NodeRow, type NodeState } from './store.js';
import { categorizeOne } from './categorize.js';
import type { Env } from './env.js';

export async function pull(store: Store, since: number, limit = 1000): Promise<PullResponse & { more: boolean }> {
  const rows = (
    await store.db.prepare(`SELECT * FROM nodes WHERE rev > ? ORDER BY rev LIMIT ?`).bind(since, limit + 1).all<NodeRow>()
  ).results;
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const rev = more ? page[page.length - 1]!.rev : await store.currentRev();
  return { rev, nodes: page.map(rowToNode), more };
}

export class MassDeleteBlocked extends Error {
  constructor(readonly info: MassDeleteError) {
    super('mass_delete');
  }
}

/** 이 push 가 지우게 될 살아 있는 북마크 수(폴더 삭제면 그 아래 북마크까지) */
async function countBookmarkDeletes(store: Store, ops: SyncOp[]): Promise<number> {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.op !== 'delete') continue;
    const row = await store.get(op.id);
    if (!row || row.deleted) continue;
    if (row.kind === 'bookmark') ids.add(row.id);
    else for (const d of await store.descendants(row.id)) if (d.kind === 'bookmark') ids.add(d.id);
  }
  return ids.size;
}

export async function push(store: Store, env: Env, deviceId: string, req: PushRequest): Promise<PushResponse> {
  const ops = Array.isArray(req.ops) ? req.ops : [];

  // 안전: 대량 삭제는 확인 없이는 하나도 적용하지 않는다
  const deletes = await countBookmarkDeletes(store, ops);
  const live = await store.liveBookmarkCount();
  if (!req.confirmMassDelete && isMassDelete(deletes, live)) {
    throw new MassDeleteBlocked({ error: 'mass_delete', deletes, liveBookmarks: live, ratio: deletes / live, threshold: MASS_DELETE_RATIO });
  }

  const batchId = ops.length ? crypto.randomUUID() : null;
  const results: OpResult[] = [];
  const created = new Map<string, string>(); // clientRef → serverId
  const mappingsOut: Array<{ clientRef: string; serverId: string }> = [];

  const resolveRef = async (ref: NodeRef | null): Promise<{ ok: true; id: string | null } | { ok: false }> => {
    if (ref === null) return { ok: true, id: null };
    let id: string | undefined;
    if ('serverId' in ref) id = ref.serverId;
    else {
      id = created.get(ref.clientRef);
      if (!id) {
        const m = await store.db
          .prepare(`SELECT server_id FROM mappings WHERE device_id=? AND browser_id=?`)
          .bind(deviceId, ref.clientRef)
          .first<{ server_id: string }>();
        id = m?.server_id;
      }
    }
    if (!id) return { ok: false };
    const row = await store.get(id);
    if (!row || row.deleted || row.kind !== 'folder') return { ok: false };
    return { ok: true, id };
  };

  const remember = async (clientRef: string, serverId: string) => {
    created.set(clientRef, serverId);
    mappingsOut.push({ clientRef, serverId });
    await store.db
      .prepare(`INSERT INTO mappings (device_id, browser_id, server_id) VALUES (?, ?, ?) ON CONFLICT(device_id, browser_id) DO UPDATE SET server_id=excluded.server_id`)
      .bind(deviceId, clientRef, serverId)
      .run();
  };

  const write = (after: NodeState, op: string, before: NodeState | null) => store.write(after, { op, deviceId, batchId, before });

  for (let index = 0; index < ops.length; index++) {
    const op = ops[index]!;
    try {
      if (op.op === 'create') {
        const parent = await resolveRef(op.parent);
        let parentId = parent.ok ? parent.id : null;
        if (op.kind === 'folder') {
          const title = (op.title ?? '').trim() || '(이름 없음)';
          const existing = await store.findLiveFolder(parentId, title);
          if (existing) {
            await remember(op.clientRef, existing.id);
            results.push({ index, status: 'merged', serverId: existing.id, rev: existing.rev, reason: 'same folder name' });
            continue;
          }
          const id = crypto.randomUUID();
          const position = op.position ?? (await store.nextPosition(parentId));
          const rev = await write({ id, kind: 'folder', parentId, title, url: null, position, deleted: false }, 'create', null);
          await remember(op.clientRef, id);
          results.push({ index, status: 'applied', serverId: id, rev });
          continue;
        }
        const url = (op.url ?? '').trim();
        if (!url) {
          results.push({ index, status: 'rejected', reason: 'bookmark needs url' });
          continue;
        }
        if (op.parent === null && op.autoCategorize) parentId = await categorizeOne(store, env, { url, title: op.title ?? '' });
        const dup = await store.findLiveBookmarkByNorm(normalizeUrl(url));
        if (dup) {
          // 같은 북마크가 이미 있다 → 새로 만들지 않고 합친다. 기기가 다른 폴더에 명시적으로 넣었다면 그 위치로 옮긴다.
          let rev = dup.rev;
          if (!op.autoCategorize && dup.parent_id !== parentId) {
            const before = rowToState(dup);
            const position = op.position ?? (await store.nextPosition(parentId));
            rev = await write({ ...before, parentId, position }, 'move', before);
          }
          await remember(op.clientRef, dup.id);
          results.push({ index, status: 'merged', serverId: dup.id, rev, reason: 'duplicate url' });
          continue;
        }
        const id = crypto.randomUUID();
        const position = op.position ?? (await store.nextPosition(parentId));
        const rev = await write({ id, kind: 'bookmark', parentId, title: op.title ?? '', url, position, deleted: false }, 'create', null);
        await remember(op.clientRef, id);
        results.push({ index, status: 'applied', serverId: id, rev });
        continue;
      }

      const row = await store.get(op.id);
      if (!row) {
        results.push({ index, status: 'rejected', reason: 'unknown node' });
        continue;
      }
      const before = rowToState(row);

      if (op.op === 'delete') {
        const changedByOthers = await store.anyChangeSince(row.id, op.baseRev, deviceId);
        const decision = decideDelete({ deleted: !!row.deleted, rev: changedByOthers ? op.baseRev + 1 : op.baseRev }, op.baseRev);
        if (decision === 'noop') {
          results.push({ index, status: 'noop', serverId: row.id, rev: row.rev });
          continue;
        }
        if (decision === 'keep-conflict') {
          await store.recordConflict({ nodeId: row.id, deviceId, reason: 'delete-vs-newer-edit', op, server: before });
          results.push({ index, status: 'conflict', serverId: row.id, rev: row.rev, reason: 'edited elsewhere after you saw it; kept' });
          continue;
        }
        if (row.kind === 'folder') {
          for (const d of await store.descendants(row.id)) {
            const ds = rowToState(d);
            await write({ ...ds, deleted: true }, 'delete', ds);
          }
        }
        const rev = await write({ ...before, deleted: true }, 'delete', before);
        results.push({ index, status: 'applied', serverId: row.id, rev });
        continue;
      }

      if (row.deleted) {
        await store.recordConflict({ nodeId: row.id, deviceId, reason: `${op.op}-on-deleted`, op, server: before });
        results.push({ index, status: 'conflict', serverId: row.id, rev: row.rev, reason: 'node was deleted' });
        continue;
      }

      const wanted: Partial<Record<'title' | 'url' | 'parentId' | 'position', unknown>> = {};
      if (op.op === 'update') {
        if (op.title !== undefined && op.title !== row.title) wanted.title = op.title;
        if (op.url !== undefined && op.url !== row.url && row.kind === 'bookmark') wanted.url = op.url;
      } else {
        const parent = await resolveRef(op.parent);
        if (!parent.ok) {
          await store.recordConflict({ nodeId: row.id, deviceId, reason: 'move-parent-missing', op, server: before });
          results.push({ index, status: 'conflict', serverId: row.id, rev: row.rev, reason: 'target folder missing' });
          continue;
        }
        if (parent.id && row.kind === 'folder' && (await store.isSelfOrDescendant(row.id, parent.id))) {
          results.push({ index, status: 'rejected', serverId: row.id, reason: 'cannot move folder into itself' });
          continue;
        }
        if (parent.id !== row.parent_id) wanted.parentId = parent.id;
        if (op.position !== undefined && op.position !== row.position) wanted.position = op.position;
      }
      if (Object.keys(wanted).length === 0) {
        results.push({ index, status: 'noop', serverId: row.id, rev: row.rev });
        continue;
      }
      const changed = await store.fieldsChangedSince(row.id, op.baseRev, deviceId);
      const d = decideFieldMerge(wanted, changed);
      if (d.conflict) await store.recordConflict({ nodeId: row.id, deviceId, reason: 'concurrent-edit', op, server: before, serverWon: d.serverWon });
      if (Object.keys(d.apply).length === 0) {
        results.push({ index, status: 'conflict', serverId: row.id, rev: row.rev, serverWon: d.serverWon });
        continue;
      }
      const after: NodeState = { ...before };
      if ('title' in d.apply) after.title = String(d.apply.title);
      if ('url' in d.apply) after.url = String(d.apply.url);
      if ('parentId' in d.apply) after.parentId = (d.apply.parentId as string | null) ?? null;
      if ('position' in d.apply) after.position = Number(d.apply.position);
      if ('parentId' in d.apply && 'position' in wanted === false) after.position = await store.nextPosition(after.parentId);
      const rev = await write(after, op.op, before);
      // 학습: 사용자가 북마크를 다른 카테고리(폴더)로 옮겼다
      if (row.kind === 'bookmark' && 'parentId' in d.apply && after.parentId && row.url) {
        await store.db.prepare(`INSERT INTO moves (url, to_category_id, at) VALUES (?, ?, ?)`).bind(row.url, after.parentId, Date.now()).run();
      }
      results.push(d.conflict ? { index, status: 'conflict', serverId: row.id, rev, serverWon: d.serverWon } : { index, status: 'applied', serverId: row.id, rev });
    } catch (err) {
      results.push({ index, status: 'rejected', reason: err instanceof Error ? err.message : String(err) });
    }
  }

  for (const m of req.mappings ?? []) {
    if (typeof m?.browserId !== 'string' || typeof m?.serverId !== 'string') continue;
    await store.db
      .prepare(`INSERT INTO mappings (device_id, browser_id, server_id) VALUES (?, ?, ?) ON CONFLICT(device_id, browser_id) DO UPDATE SET server_id=excluded.server_id`)
      .bind(deviceId, m.browserId, m.serverId)
      .run();
  }

  return { rev: await store.currentRev(), batchId, results, mappings: mappingsOut };
}

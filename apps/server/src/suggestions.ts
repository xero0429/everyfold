import { classifyByRules } from '@everyfold/core';
import type { Env } from './env.js';
import { serverLocale, t } from './locale.js';
import { rowToState, Store, type NodeState } from './store.js';
import { categoryContext } from './categorize.js';
import { sessionFolderIds } from './sessions.js';

/**
 * 제안 = 승인해야 적용되는 동작 목록. 승인 시 한 batch 로 적용되므로 /changes/undo 로 되돌릴 수 있다.
 * - new_category: LLM 이 "기존 카테고리가 안 맞는다" 고 본 북마크들 → 폴더 만들고 옮기기
 * - apply_rules: 미분류 안의 북마크 중 (학습·도메인) 규칙으로 갈 곳이 생긴 것 → 옮기기
 * - remove_empty: 비어 있는 카테고리 → 지우기
 */
export type Action =
  | { type: 'create_folder'; ref: string; name: string; parentId: string | null }
  | { type: 'move'; nodeId: string; to: string } // to = 폴더 id 또는 create_folder 의 ref
  | { type: 'delete_folder'; id: string }
  | { type: 'rename'; id: string; title: string };

export interface Suggestion {
  id: string;
  kind: string;
  title: string;
  actions: Action[];
  status: string;
  createdAt: number;
}

interface Row { id: string; kind: string; title: string; payload_json: string; status: string; created_at: number }

function actionsOf(kind: string, payload: any): Action[] {
  if (kind === 'new_category') {
    return [
      { type: 'create_folder', ref: 'new', name: String(payload.name), parentId: null },
      ...(payload.nodeIds as string[]).map((nodeId): Action => ({ type: 'move', nodeId, to: 'new' })),
    ];
  }
  return (payload.actions ?? []) as Action[];
}

export async function listSuggestions(store: Store, status = 'pending'): Promise<Suggestion[]> {
  const r = await store.db.prepare(`SELECT * FROM suggestions WHERE status=? ORDER BY created_at DESC`).bind(status).all<Row>();
  return r.results.map((s) => ({ id: s.id, kind: s.kind, title: s.title, actions: actionsOf(s.kind, JSON.parse(s.payload_json)), status: s.status, createdAt: s.created_at }));
}

/** 구조 개편 제안을 새로 계산한다(같은 종류의 이전 pending 제안은 바꿔 끼운다). */
export async function generateSuggestions(store: Store, env: Env): Promise<Suggestion[]> {
  const ctx = await categoryContext(store);
  const folders = ctx.folders;
  const locale = await serverLocale(store, env);
  const created: string[] = [];
  const put = async (kind: string, title: string, actions: Action[]) => {
    await store.db.prepare(`DELETE FROM suggestions WHERE kind=? AND status='pending'`).bind(kind).run();
    if (!actions.length) return;
    const id = crypto.randomUUID();
    await store.db.prepare(`INSERT INTO suggestions (id, kind, title, payload_json, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)`).bind(id, kind, title, JSON.stringify({ actions }), Date.now()).run();
    created.push(id);
  };

  if (ctx.inboxId) {
    const inboxItems = (await store.liveChildren(ctx.inboxId)).filter((n) => n.kind === 'bookmark' && n.url);
    const moves: Action[] = [];
    for (const n of inboxItems) {
      const c = classifyByRules({ id: n.id, url: n.url!, title: n.title }, { categories: ctx.categories, learned: ctx.learned });
      if (c.categoryId && c.categoryId !== ctx.inboxId) moves.push({ type: 'move', nodeId: n.id, to: c.categoryId });
    }
    await put('apply_rules', t(locale, 'applyRules')(moves.length), moves);
  }

  // 폴더마다 묻지 않고 한 번에 센다(D1 호출 수)
  const counts = new Map(
    (await store.db.prepare(`SELECT parent_id AS p, COUNT(*) AS n FROM nodes WHERE deleted=0 AND parent_id IS NOT NULL GROUP BY parent_id`).all<{ p: string; n: number }>()).results.map((r) => [r.p, r.n]),
  );
  const empty: Action[] = [];
  for (const f of folders) {
    if (f.id === ctx.inboxId) continue;
    if (!counts.get(f.id)) empty.push({ type: 'delete_folder', id: f.id });
  }
  await put('remove_empty', t(locale, 'removeEmpty')(empty.length), empty);

  const all = await listSuggestions(store);
  return all.filter((s) => created.includes(s.id) || s.kind === 'new_category');
}

export async function decideSuggestion(store: Store, id: string, approve: boolean, deviceId: string) {
  const s = await store.db.prepare(`SELECT * FROM suggestions WHERE id=?`).bind(id).first<Row>();
  if (!s) return { error: 'not_found' as const };
  if (s.status !== 'pending') return { error: 'already_decided' as const, status: s.status };
  if (!approve) {
    await store.db.prepare(`UPDATE suggestions SET status='rejected', decided_at=? WHERE id=?`).bind(Date.now(), id).run();
    return { status: 'rejected' as const };
  }
  const batchId = crypto.randomUUID();
  const refs = new Map<string, string>();
  let applied = 0;
  let skipped = 0;
  // 세션 폴더와 그 아래는 승인된 제안이라도 옮기거나 지우지 않는다(제안을 만든 뒤 사용자가 그 안으로 옮긴 경우까지)
  const sessionIds = sessionFolderIds(await store.liveFolders());
  for (const a of actionsOf(s.kind, JSON.parse(s.payload_json))) {
    if (a.type === 'create_folder') {
      const existing = await store.findLiveFolder(a.parentId, a.name);
      if (existing) {
        refs.set(a.ref, existing.id);
        continue;
      }
      const fid = crypto.randomUUID();
      await store.write({ id: fid, kind: 'folder', parentId: a.parentId, title: a.name, url: null, position: await store.nextPosition(a.parentId), deleted: false }, { op: 'create', deviceId, batchId, before: null });
      refs.set(a.ref, fid);
      applied++;
      continue;
    }
    const targetId = a.type === 'move' ? a.nodeId : a.id;
    const row = await store.get(targetId);
    if (!row || row.deleted || sessionIds.has(row.id) || (row.parent_id && sessionIds.has(row.parent_id))) {
      skipped++;
      continue;
    }
    const before = rowToState(row);
    let after: NodeState | null = null;
    if (a.type === 'move') {
      const to = refs.get(a.to) ?? a.to;
      const dest = await store.get(to);
      if (!dest || dest.deleted || dest.kind !== 'folder' || sessionIds.has(dest.id)) {
        skipped++;
        continue;
      }
      after = { ...before, parentId: to, position: await store.nextPosition(to) };
    } else if (a.type === 'rename') after = { ...before, title: a.title };
    else if (a.type === 'delete_folder') {
      if ((await store.liveChildren(row.id)).length) {
        skipped++;
        continue; // 그 사이에 뭔가 들어왔으면 지우지 않는다
      }
      after = { ...before, deleted: true };
    }
    if (after) {
      await store.write(after, { op: `suggestion:${a.type}`, deviceId, batchId, before });
      applied++;
    }
  }
  await store.db.prepare(`UPDATE suggestions SET status='approved', decided_at=?, batch_id=? WHERE id=?`).bind(Date.now(), batchId, id).run();
  return { status: 'approved' as const, batchId, applied, skipped, rev: await store.currentRev() };
}

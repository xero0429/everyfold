import { rowToState, Store, SYSTEM_DEVICE, type NodeState } from './store.js';

/* ───────── 스냅샷: 하루 1개 자동 + 수동. 되돌리기 = 스냅샷 상태로 "새 변경" 을 쓰는 것(그래서 되돌리기도 되돌릴 수 있다) ───────── */

const PART = 500;
const DAY = 24 * 60 * 60 * 1000;
export const KEEP_DAILY = 30;

export interface SnapshotInfo {
  id: string;
  kind: string;
  rev: number;
  nodeCount: number;
  createdAt: number;
}

export async function createSnapshot(store: Store, kind: 'daily' | 'manual' | 'pre-restore' | 'pre-undo'): Promise<SnapshotInfo> {
  const live = (await store.allNodes()).filter((n) => !n.deleted).map(rowToState);
  const id = crypto.randomUUID();
  const rev = await store.currentRev();
  const now = Date.now();
  const stmts = [store.db.prepare(`INSERT INTO snapshots (id, kind, rev, node_count, created_at) VALUES (?, ?, ?, ?, ?)`).bind(id, kind, rev, live.length, now)];
  for (let i = 0, part = 0; i < Math.max(live.length, 1); i += PART, part++) {
    stmts.push(store.db.prepare(`INSERT INTO snapshot_parts (snapshot_id, part, data_json) VALUES (?, ?, ?)`).bind(id, part, JSON.stringify(live.slice(i, i + PART))));
  }
  await store.db.batch(stmts);
  return { id, kind, rev, nodeCount: live.length, createdAt: now };
}

export async function listSnapshots(store: Store): Promise<SnapshotInfo[]> {
  const r = await store.db.prepare(`SELECT id, kind, rev, node_count, created_at FROM snapshots ORDER BY created_at DESC LIMIT 200`).all<{ id: string; kind: string; rev: number; node_count: number; created_at: number }>();
  return r.results.map((s) => ({ id: s.id, kind: s.kind, rev: s.rev, nodeCount: s.node_count, createdAt: s.created_at }));
}

/** 마지막 daily 가 20시간보다 오래됐으면 하나 만든다(cron 과 push 양쪽에서 부른다). 오래된 daily 는 30개만 남긴다. */
export async function ensureDailySnapshot(store: Store, now = Date.now()): Promise<SnapshotInfo | null> {
  const last = await store.db.prepare(`SELECT created_at FROM snapshots WHERE kind='daily' ORDER BY created_at DESC LIMIT 1`).first<{ created_at: number }>();
  if (last && now - last.created_at < DAY - 4 * 60 * 60 * 1000) return null;
  const snap = await createSnapshot(store, 'daily');
  const old = (await store.db.prepare(`SELECT id FROM snapshots WHERE kind='daily' ORDER BY created_at DESC LIMIT -1 OFFSET ?`).bind(KEEP_DAILY).all<{ id: string }>()).results;
  for (const o of old) {
    await store.db.batch([
      store.db.prepare(`DELETE FROM snapshot_parts WHERE snapshot_id=?`).bind(o.id),
      store.db.prepare(`DELETE FROM snapshots WHERE id=?`).bind(o.id),
    ]);
  }
  return snap;
}

async function loadSnapshot(store: Store, id: string): Promise<NodeState[] | null> {
  const head = await store.db.prepare(`SELECT id FROM snapshots WHERE id=?`).bind(id).first();
  if (!head) return null;
  const parts = (await store.db.prepare(`SELECT data_json FROM snapshot_parts WHERE snapshot_id=? ORDER BY part`).bind(id).all<{ data_json: string }>()).results;
  return parts.flatMap((p) => JSON.parse(p.data_json) as NodeState[]);
}

const same = (a: NodeState, b: NodeState) =>
  a.kind === b.kind && a.parentId === b.parentId && a.title === b.title && a.url === b.url && a.position === b.position && a.deleted === b.deleted;

export async function restoreSnapshot(store: Store, id: string, deviceId: string) {
  const target = await loadSnapshot(store, id);
  if (!target) return null;
  const safety = await createSnapshot(store, 'pre-restore');
  const batchId = crypto.randomUUID();
  const current = new Map((await store.allNodes()).map((r) => [r.id, rowToState(r)]));
  const want = new Map(target.map((n) => [n.id, { ...n, deleted: false }]));
  const writes: Array<{ after: NodeState; before: NodeState | null; op: string }> = [];
  for (const [nid, w] of want) {
    const cur = current.get(nid) ?? null;
    if (!cur || !same(cur, w)) writes.push({ after: w, before: cur, op: 'restore' });
  }
  for (const [nid, cur] of current) {
    if (!cur.deleted && !want.has(nid)) writes.push({ after: { ...cur, deleted: true }, before: cur, op: 'restore' });
  }
  // 폴더 먼저(부모가 먼저 살아나도록)
  writes.sort((a, b) => (a.after.kind === b.after.kind ? 0 : a.after.kind === 'folder' ? -1 : 1));
  await store.writeMany(writes, deviceId, batchId);
  return { batchId, changed: writes.length, safetySnapshotId: safety.id, rev: await store.currentRev() };
}

/* ───────── 변경 기록 되돌리기 (push·import·제안 승인·복원 batch 단위) ───────── */

export async function listChanges(store: Store, limit = 100) {
  const r = await store.db
    .prepare(`SELECT batch_id, device_id, MIN(rev) AS from_rev, MAX(rev) AS to_rev, COUNT(*) AS n, MIN(created_at) AS at, GROUP_CONCAT(DISTINCT op) AS ops
              FROM changes WHERE batch_id IS NOT NULL GROUP BY batch_id ORDER BY to_rev DESC LIMIT ?`)
    .bind(limit)
    .all();
  return r.results;
}

export async function undoBatch(store: Store, batchId: string, deviceId: string) {
  const rows = (await store.db.prepare(`SELECT rev, node_id, before_json, after_json FROM changes WHERE batch_id=? ORDER BY rev DESC`).bind(batchId).all<{ rev: number; node_id: string; before_json: string | null; after_json: string | null }>()).results;
  if (!rows.length) return null;
  const undoId = crypto.randomUUID();
  const seen = new Set<string>();
  const writes: Array<{ after: NodeState; before: NodeState | null; op: string }> = [];
  // 같은 노드가 batch 안에서 여러 번 바뀌었으면 가장 이른 before 로 돌린다
  const earliest = new Map<string, { before: NodeState | null; after: NodeState }>();
  for (const r of rows) earliest.set(r.node_id, { before: r.before_json ? JSON.parse(r.before_json) : null, after: JSON.parse(r.after_json!) });
  for (const [nid, { before, after }] of earliest) {
    if (seen.has(nid)) continue;
    seen.add(nid);
    const cur = await store.get(nid);
    const curState = cur ? rowToState(cur) : null;
    const target: NodeState = before ?? { ...after, deleted: true };
    if (curState && same(curState, target)) continue;
    writes.push({ after: target, before: curState, op: 'undo' });
  }
  writes.sort((a, b) => (a.after.kind === b.after.kind ? 0 : a.after.kind === 'folder' ? -1 : 1));
  await store.writeMany(writes, deviceId, undoId);
  return { batchId: undoId, undone: batchId, changed: writes.length, rev: await store.currentRev() };
}

export { SYSTEM_DEVICE };

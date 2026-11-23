import { normalizeUrl, type NodeKind, type ServerNode } from '@everyfold/core';

/** DB 한 행 */
export interface NodeRow {
  id: string;
  kind: NodeKind;
  parent_id: string | null;
  title: string;
  url: string | null;
  norm_url: string | null;
  position: number;
  deleted: number;
  rev: number;
  created_at: number;
  updated_at: number;
  /** 기본 카테고리 안정 키(0002). 사용자 폴더·북마크는 null */
  cat_key?: string | null;
}

/** 변경 기록에 남기는 노드 상태(rev 제외) */
export interface NodeState {
  id: string;
  kind: NodeKind;
  parentId: string | null;
  title: string;
  url: string | null;
  position: number;
  deleted: boolean;
}

export function rowToState(r: NodeRow): NodeState {
  return { id: r.id, kind: r.kind, parentId: r.parent_id, title: r.title, url: r.url, position: r.position, deleted: !!r.deleted };
}

export function rowToNode(r: NodeRow): ServerNode {
  return { ...rowToState(r), rev: r.rev, updatedAt: r.updated_at };
}

export const SYSTEM_DEVICE = 'system';

/** writeMany 한 batch 에 담는 노드 수 */
const WRITE_CHUNK = 1000;

/**
 * 서버 쓰기는 모두 이 클래스를 거친다. 변경 하나 = rev 하나 + changes 기록 하나 (D1 batch 로 원자적).
 * 그래서 어떤 변경이든 changes 의 before/after 로 되돌릴 수 있다.
 */
export class Store {
  constructor(readonly db: D1Database) {}

  async currentRev(): Promise<number> {
    const r = await this.db.prepare(`SELECT value FROM meta WHERE key='rev'`).first<{ value: number }>();
    return r?.value ?? 0;
  }

  async get(id: string): Promise<NodeRow | null> {
    return this.db.prepare(`SELECT * FROM nodes WHERE id=?`).bind(id).first<NodeRow>();
  }

  async findLiveBookmarkByNorm(norm: string): Promise<NodeRow | null> {
    return this.db.prepare(`SELECT * FROM nodes WHERE norm_url=? AND deleted=0 AND kind='bookmark' ORDER BY created_at LIMIT 1`).bind(norm).first<NodeRow>();
  }

  async findLiveFolder(parentId: string | null, title: string): Promise<NodeRow | null> {
    const q = parentId === null
      ? this.db.prepare(`SELECT * FROM nodes WHERE kind='folder' AND deleted=0 AND parent_id IS NULL AND title=? LIMIT 1`).bind(title)
      : this.db.prepare(`SELECT * FROM nodes WHERE kind='folder' AND deleted=0 AND parent_id=? AND title=? LIMIT 1`).bind(parentId, title);
    return q.first<NodeRow>();
  }

  async liveFolders(): Promise<NodeRow[]> {
    const r = await this.db.prepare(`SELECT * FROM nodes WHERE kind='folder' AND deleted=0 ORDER BY parent_id, position, title`).all<NodeRow>();
    return r.results;
  }

  async liveBookmarkCount(): Promise<number> {
    const r = await this.db.prepare(`SELECT COUNT(*) AS n FROM nodes WHERE kind='bookmark' AND deleted=0`).first<{ n: number }>();
    return r?.n ?? 0;
  }

  async liveChildren(parentId: string): Promise<NodeRow[]> {
    const r = await this.db.prepare(`SELECT * FROM nodes WHERE parent_id=? AND deleted=0`).bind(parentId).all<NodeRow>();
    return r.results;
  }

  async allNodes(): Promise<NodeRow[]> {
    return (await this.db.prepare(`SELECT * FROM nodes`).all<NodeRow>()).results;
  }

  async nextPosition(parentId: string | null): Promise<number> {
    const q = parentId === null
      ? this.db.prepare(`SELECT MAX(position) AS p FROM nodes WHERE parent_id IS NULL AND deleted=0`)
      : this.db.prepare(`SELECT MAX(position) AS p FROM nodes WHERE parent_id=? AND deleted=0`).bind(parentId);
    const r = await q.first<{ p: number | null }>();
    return (r?.p ?? -1) + 1;
  }

  /**
   * 노드 하나를 쓰는 문장 묶음: rev+1 → nodes upsert → changes 기록 → (선택) cat_key → 새 rev SELECT(마지막 문장).
   * 여러 개를 한 D1 batch 에 담으면 트랜잭션 하나·Worker 호출 1회로 끝난다.
   */
  writeStmts(after: NodeState, opts: { op: string; deviceId: string; batchId: string | null; before: NodeState | null; catKey?: string }): D1PreparedStatement[] {
    const now = Date.now();
    const norm = after.kind === 'bookmark' && after.url ? normalizeUrl(after.url) : null;
    const REV = `(SELECT value FROM meta WHERE key='rev')`;
    const stmts = [
      this.db.prepare(`UPDATE meta SET value = value + 1 WHERE key='rev'`),
      this.db
        .prepare(
          `INSERT INTO nodes (id, kind, parent_id, title, url, norm_url, position, deleted, rev, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${REV}, ?, ?)
           ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, parent_id=excluded.parent_id, title=excluded.title,
             url=excluded.url, norm_url=excluded.norm_url, position=excluded.position, deleted=excluded.deleted,
             rev=excluded.rev, updated_at=excluded.updated_at`,
        )
        .bind(after.id, after.kind, after.parentId, after.title, after.url, norm, after.position, after.deleted ? 1 : 0, now, now),
      this.db
        .prepare(`INSERT INTO changes (rev, node_id, op, before_json, after_json, device_id, batch_id, created_at) VALUES (${REV}, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(after.id, opts.op, opts.before ? JSON.stringify(opts.before) : null, JSON.stringify(after), opts.deviceId, opts.batchId, now),
    ];
    if (opts.catKey) stmts.push(this.db.prepare(`UPDATE nodes SET cat_key=? WHERE id=?`).bind(opts.catKey, after.id));
    stmts.push(this.db.prepare(`SELECT value FROM meta WHERE key='rev'`));
    return stmts;
  }

  /** 노드 하나를 after 상태로 쓰고 변경 기록을 남긴다. 새 rev 를 돌려준다. */
  async write(after: NodeState, opts: { op: string; deviceId: string; batchId: string | null; before?: NodeState | null }): Promise<number> {
    const before = opts.before === undefined ? await this.get(after.id).then((r) => (r ? rowToState(r) : null)) : opts.before;
    const res = await this.db.batch(this.writeStmts(after, { ...opts, before }));
    const last = res[res.length - 1]?.results?.[0] as { value: number } | undefined;
    return last?.value ?? 0;
  }

  /**
   * 여러 노드를 한 번에 쓴다 — 가져오기용. 각 노드가 자기 rev·변경 기록을 받는다.
   * D1 batch 하나는 Worker 호출 한도(Free 50/요청)에서 1회로 센다 → 큰 묶음(WRITE_CHUNK)으로 보내 호출 수를 줄인다.
   */
  async writeMany(items: Array<{ after: NodeState; before: NodeState | null; op: string; catKey?: string }>, deviceId: string, batchId: string): Promise<void> {
    for (let i = 0; i < items.length; i += WRITE_CHUNK) {
      const stmts = items.slice(i, i + WRITE_CHUNK).flatMap(({ after, before, op, catKey }) =>
        this.writeStmts(after, { op, deviceId, batchId, before, ...(catKey ? { catKey } : {}) }).slice(0, -1),
      );
      await this.db.batch(stmts);
    }
  }

  /** id 목록으로 한 번에 읽는다(json_each — 바인딩 1개라 100개 한도에 안 걸린다) */
  async getMany(ids: readonly string[]): Promise<NodeRow[]> {
    if (!ids.length) return [];
    return (await this.db.prepare(`SELECT * FROM nodes WHERE id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify([...new Set(ids)])).all<NodeRow>()).results;
  }

  /** baseRev 이후 다른 기기가 바꾼 필드 목록 */
  async fieldsChangedSince(nodeId: string, baseRev: number, exceptDevice: string): Promise<Set<'title' | 'url' | 'parentId' | 'position'>> {
    const r = await this.db
      .prepare(`SELECT before_json, after_json FROM changes WHERE node_id=? AND rev>? AND (device_id IS NULL OR device_id<>?) ORDER BY rev`)
      .bind(nodeId, baseRev, exceptDevice)
      .all<{ before_json: string | null; after_json: string | null }>();
    const out = new Set<'title' | 'url' | 'parentId' | 'position'>();
    for (const c of r.results) {
      const b = c.before_json ? (JSON.parse(c.before_json) as NodeState) : null;
      const a = c.after_json ? (JSON.parse(c.after_json) as NodeState) : null;
      for (const f of ['title', 'url', 'parentId', 'position'] as const) {
        if (!b || !a || b[f] !== a[f]) out.add(f);
      }
      if (b && a && b.deleted !== a.deleted) out.add('parentId');
    }
    return out;
  }

  async anyChangeSince(nodeId: string, baseRev: number, exceptDevice: string): Promise<boolean> {
    const r = await this.db
      .prepare(`SELECT 1 AS x FROM changes WHERE node_id=? AND rev>? AND (device_id IS NULL OR device_id<>?) LIMIT 1`)
      .bind(nodeId, baseRev, exceptDevice)
      .first();
    return !!r;
  }

  async recordConflict(c: { nodeId: string; deviceId: string; reason: string; op: unknown; server: NodeState | null; serverWon?: string[] }) {
    await this.db
      .prepare(`INSERT INTO conflicts (node_id, device_id, reason, op_json, server_json, server_won, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(c.nodeId, c.deviceId, c.reason, JSON.stringify(c.op), c.server ? JSON.stringify(c.server) : null, c.serverWon ? c.serverWon.join(',') : null, Date.now())
      .run();
  }

  async descendants(folderId: string): Promise<NodeRow[]> {
    const r = await this.db
      .prepare(
        `WITH RECURSIVE sub(id) AS (SELECT id FROM nodes WHERE parent_id=? AND deleted=0
           UNION SELECT n.id FROM nodes n JOIN sub ON n.parent_id=sub.id WHERE n.deleted=0)
         SELECT nodes.* FROM nodes JOIN sub ON nodes.id=sub.id`,
      )
      .bind(folderId)
      .all<NodeRow>();
    return r.results;
  }

  /** folder 가 node 의 자손(또는 자기 자신)인지 — 순환 이동 방지 */
  async isSelfOrDescendant(nodeId: string, candidateParent: string): Promise<boolean> {
    let cur: string | null = candidateParent;
    for (let i = 0; cur && i < 1000; i++) {
      if (cur === nodeId) return true;
      const row: NodeRow | null = await this.get(cur);
      cur = row?.parent_id ?? null;
    }
    return false;
  }
}

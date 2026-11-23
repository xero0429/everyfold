import {
  BRAND, checkCompat, DEFAULT_COMPAT_POLICY, isMassDelete, normalizeUrl, type Compat, type CompatPolicy, type MassDeleteError, type NodeRef, type PullResponse,
  type PushResponse, type ServerNode, type ServerVersionInfo, type SyncOp,
} from '@everyfold/core';

/**
 * 동기화 엔진 — 브라우저 API 에 직접 기대지 않는다(BookmarksApi·KV 를 주입). 그래서 가짜 북마크로 실서버에 붙여 테스트할 수 있다.
 *
 * 흐름(sync 한 번)
 *  1) 전용 루트 폴더(BRAND.rootFolderTitle) 확보 — 기존 폴더는 건드리지 않는다.
 *  2) 첫 연결이면 루트 밖 브라우저 북마크 전체를 /import 로 올린다(서버가 중복 합치고 분류).
 *  3) 루트 폴더 안을 shadow(마지막으로 맞춘 서버 상태)와 비교해 ops 를 만든다 → push.
 *     · 한 번에 북마크 20%↑ 삭제면 push 하지 않고 멈춘 뒤 사용자 확인을 기다린다.
 *  4) pull 해서 서버 변경을 루트 폴더에 반영(카테고리 = 폴더).
 *  5) 루트 밖에서 새로 만든 북마크(capture)는 서버가 분류해 카테고리에 넣는다(원본은 그대로 둔다).
 */

export interface BNode {
  id: string;
  parentId?: string;
  title: string;
  url?: string;
  index?: number;
  children?: BNode[];
}

export interface BookmarksApi {
  getTree(): Promise<BNode[]>;
  getSubTree(id: string): Promise<BNode[]>;
  get(id: string): Promise<BNode[]>;
  create(d: { parentId: string; title: string; url?: string; index?: number }): Promise<BNode>;
  update(id: string, d: { title?: string; url?: string }): Promise<BNode>;
  move(id: string, d: { parentId: string; index?: number }): Promise<BNode>;
  removeTree(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface KV {
  get(): Promise<Partial<EngineState> | undefined>;
  set(s: EngineState): Promise<void>;
}

export interface ShadowEntry {
  b: string; // browser id
  kind: 'folder' | 'bookmark';
  parent: string | null; // server id of parent folder (null = root)
  title: string;
  url: string | null;
  rev: number;
  /** Move 모드 capture: 원본이 아직 루트 밖에 있다(다음 pull 이 카테고리 폴더로 옮긴다) — diff 가 삭제로 보지 않게 */
  pendingMove?: boolean;
}

export interface EngineState {
  serverUrl: string | null;
  token: string | null;
  deviceName: string | null;
  rev: number;
  rootId: string | null;
  shadow: Record<string, ShadowEntry>; // serverId → entry
  map: Record<string, string>; // browserId → serverId
  initialUploadDone: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  lastImport: { created: number; mergedExisting: number; mergedInFile: number } | null;
  pendingMassDelete: { ops: SyncOp[]; deletes: number; live: number; at: number } | null;
  pendingMappings: Array<{ browserId: string; serverId: string }>;
  captures: Array<{ browserId: string; url: string; title: string; parentId?: string; index?: number }>;
  /** 설정(기기별): 루트 밖에서 새로 만든 북마크를 Everyfold 로 "옮긴다"(꺼져 있으면 복사) */
  moveCaptures: boolean;
  /** 첫 연결 뒤 "옮기기를 켤 수 있어요" 안내를 닫았는지 */
  moveHintDismissed: boolean;
  /** 옮긴 capture 의 원래 자리(serverId → 부모·순서). 서버에서 되돌리기(undo)로 지워지면 지우지 않고 원래 자리로 돌려놓는다 */
  movedOrigins: Record<string, { parentId: string; index?: number }>;
  /** 이 브라우저에 쓰지 못한 서버 노드(serverId → 마지막 서버 상태·이유). 다음 sync 에 다시 시도한다(상한 MAX_APPLY_ATTEMPTS). */
  failed: Record<string, FailedApply>;
  /** 마지막으로 본 서버 판(GET /version)과 호환 판정. null = 아직 못 봤다 */
  server: ServerCheck | null;
}

export interface ServerCheck {
  /** 서버 릴리스 판. /version 이 없는 옛 서버면 null */
  version: string | null;
  api: number;
  compat: Compat;
  checkedAt: number;
}

/** 호환이 맞으면 이 간격으로만 /version 을 다시 본다(아니면 sync 마다 — 업데이트하면 경고가 바로 사라지게) */
export const VERSION_CHECK_MS = 60 * 60_000;

export interface FailedApply {
  node: ServerNode;
  error: string;
  attempts: number;
  at: number;
}

/** 같은 노드를 이 횟수만큼 못 쓰면 더 시도하지 않는다(서버에서 그 노드가 다시 바뀌면 처음부터 다시 센다) */
export const MAX_APPLY_ATTEMPTS = 5;

export const emptyState = (): EngineState => ({
  serverUrl: null, token: null, deviceName: null, rev: 0, rootId: null, shadow: {}, map: {}, initialUploadDone: false,
  lastSyncAt: null, lastError: null, lastImport: null, pendingMassDelete: null, pendingMappings: [], captures: [], failed: {},
  moveCaptures: false, moveHintDismissed: false, movedOrigins: {}, server: null,
});

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(readonly status: number, readonly body: any) {
    super(`HTTP ${status}${body?.error ? ` ${body.error}` : ''}`);
  }
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  applied: number;
  /** 이번에 브라우저에 쓰지 못한 노드 수(state.failed 에 이유가 남는다) */
  failed: number;
  blocked?: MassDeleteError | { error: 'mass_delete_local'; deletes: number; liveBookmarks: number };
  imported?: { created: number; mergedExisting: number; mergedInFile: number };
}

export class SyncEngine {
  state: EngineState = emptyState();
  /** 원격 변경을 브라우저에 쓰는 중이면 true — 이벤트 핸들러가 이 동안의 이벤트를 무시한다 */
  applying = false;
  /** push 에서 merged 로 돌아온 서버 노드 — 같은 sync 의 pull 단계에서 브라우저를 서버 제목·위치로 맞춘다 */
  private mergedNodes: ServerNode[] = [];
  /** pull 한 번 동안의 브라우저 폴더 자식 캐시(채택 검색용) */
  private childCache = new Map<string, BNode[]>();
  private running: Promise<unknown> = Promise.resolve();
  /** 서버 호환 기준(시험에서 바꿔 끼운다) */
  compatPolicy: CompatPolicy = DEFAULT_COMPAT_POLICY;

  constructor(readonly bm: BookmarksApi, readonly kv: KV, readonly fetchImpl: Fetch, readonly now: () => number = Date.now) {}

  async load() {
    this.state = { ...emptyState(), ...((await this.kv.get()) ?? {}) };
  }
  private save() {
    return this.kv.set(this.state);
  }

  get connected() {
    return !!(this.state.serverUrl && this.state.token);
  }

  /* ───────── 서버 호출 ───────── */
  async api<T>(method: string, path: string, body?: unknown, token = this.state.token): Promise<T> {
    const base = (this.state.serverUrl ?? '').replace(/\/+$/, '');
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.fetchImpl(base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    if (!res.ok) throw new HttpError(res.status, json);
    return json as T;
  }

  /** 관리자 토큰으로 이 기기를 등록한다. 관리자 토큰은 저장하지 않는다. */
  async connect(serverUrl: string, opts: { adminToken?: string; deviceToken?: string; deviceName: string }) {
    this.state = {
      ...emptyState(), serverUrl: serverUrl.trim().replace(/\/+$/, ''), deviceName: opts.deviceName, rootId: this.state.rootId,
      moveCaptures: this.state.moveCaptures, moveHintDismissed: this.state.moveHintDismissed,
    };
    if (opts.deviceToken) {
      this.state.token = opts.deviceToken.trim();
      await this.api('GET', '/me');
    } else {
      const r = await this.api<{ token: string }>('POST', '/devices', { name: opts.deviceName }, opts.adminToken ?? null);
      this.state.token = r.token;
    }
    await this.save();
    await this.checkServer(true);
  }

  /**
   * GET /version 으로 서버 판을 보고 호환을 판정한다. 경고만 남기고 동작은 막지 않는다(server_blocked 일 때만 sync 가 멈춘다).
   * 네트워크 오류 등으로 못 보면 이전 판정을 그대로 둔다. 404 = /version 이 없는 옛 서버.
   */
  async checkServer(force = false): Promise<ServerCheck | null> {
    const prev = this.state.server;
    if (!force && prev && prev.compat === 'ok' && this.now() - prev.checkedAt < VERSION_CHECK_MS) return prev;
    let info: ServerVersionInfo | null = null;
    try {
      info = await this.api<ServerVersionInfo>('GET', '/version', undefined, null);
    } catch (e) {
      if (!(e instanceof HttpError && e.status === 404)) return prev;
    }
    if (info && typeof info.api !== 'number') info = null;
    this.state.server = { version: info?.version ?? null, api: info?.api ?? 0, compat: checkCompat(info, this.compatPolicy), checkedAt: this.now() };
    await this.save();
    return this.state.server;
  }

  async disconnect() {
    const rootId = this.state.rootId;
    this.state = { ...emptyState(), rootId };
    await this.save();
  }

  /** 동시에 두 번 돌지 않게 줄 세운다 */
  sync(opts: { confirmMassDelete?: boolean } = {}): Promise<SyncReport> {
    const run = this.running.then(() => this.syncOnce(opts));
    this.running = run.catch(() => undefined);
    return run;
  }

  /* ───────── 루트 폴더 ───────── */
  async ensureRoot(): Promise<string> {
    if (this.state.rootId) {
      try {
        const [n] = await this.bm.get(this.state.rootId);
        if (n && !n.url) return n.id;
      } catch {
        /* 지워졌다 */
      }
      // 사용자가 루트 폴더를 지웠다 → shadow 를 비우고 처음부터 다시 받는다(서버 데이터는 지우지 않는다)
      this.state.shadow = {};
      this.state.map = {};
      this.state.rev = 0;
    }
    const [top] = await this.bm.getTree();
    const containers = top?.children ?? [];
    const other = containers.find((c) => c.id === '2' || c.id === 'unfiled_____') ?? containers[1] ?? containers[0];
    if (!other) throw new Error('no bookmark container');
    const existing = (other.children ?? []).find((c) => !c.url && c.title === BRAND.rootFolderTitle);
    const root = existing ?? (await this.bm.create({ parentId: other.id, title: BRAND.rootFolderTitle }));
    this.state.rootId = root.id;
    await this.save();
    return root.id;
  }

  private async isInsideRoot(id: string): Promise<boolean> {
    let cur: string | undefined = id;
    for (let i = 0; cur && i < 100; i++) {
      if (cur === this.state.rootId) return true;
      const [n]: BNode[] = await this.bm.get(cur).catch(() => [] as BNode[]);
      cur = n?.parentId;
    }
    return false;
  }

  /** 브라우저 이벤트(onCreated) — 루트 밖에서 만든 북마크는 수집 대상으로 기억해 둔다 */
  async noteCreated(node: BNode) {
    if (this.applying || !node.url || !this.state.initialUploadDone) return;
    if (await this.isInsideRoot(node.id)) return;
    this.state.captures.push({ browserId: node.id, url: node.url, title: node.title, ...(node.parentId ? { parentId: node.parentId } : {}), ...(node.index !== undefined ? { index: node.index } : {}) });
    await this.save();
  }

  /* ───────── 첫 업로드 ───────── */
  private async initialUpload(rootId: string) {
    const [top] = await this.bm.getTree();
    const items: Array<{ url: string; title: string; path: string[] }> = [];
    const walk = (n: BNode, path: string[]) => {
      if (n.id === rootId) return;
      if (n.url) items.push({ url: n.url, title: n.title, path });
      for (const c of n.children ?? []) walk(c, n.title ? [...path, n.title] : path);
    };
    if (top) walk(top, []);
    const r = await this.api<{ created: number; mergedExisting: number; mergedInFile: number }>('POST', '/import', { items });
    this.state.initialUploadDone = true;
    this.state.lastImport = { created: r.created, mergedExisting: r.mergedExisting, mergedInFile: r.mergedInFile };
    await this.save();
    return this.state.lastImport;
  }

  /* ───────── 로컬 → ops ───────── */
  async diff(rootId: string): Promise<SyncOp[]> {
    const [root] = await this.bm.getSubTree(rootId);
    const creates: SyncOp[] = [];
    const edits: SyncOp[] = [];
    const seen = new Set<string>();
    const walk = (n: BNode, parentServer: NodeRef | null) => {
      for (const c of n.children ?? []) {
        const sid = this.state.map[c.id];
        const e = sid ? this.state.shadow[sid] : undefined;
        if (sid && e) {
          seen.add(sid);
          const title = c.title ?? '';
          const url = c.url ?? null;
          const upd: { title?: string; url?: string } = {};
          if (title !== e.title) upd.title = title;
          if (url !== e.url && url !== null) upd.url = url;
          if (Object.keys(upd).length) edits.push({ op: 'update', id: sid, baseRev: e.rev, ...upd });
          const curParent = parentServer === null ? null : 'serverId' in parentServer ? parentServer.serverId : undefined;
          if (curParent !== e.parent) edits.push({ op: 'move', id: sid, baseRev: e.rev, parent: parentServer });
          if (c.children) walk(c, { serverId: sid });
        } else {
          creates.push({ op: 'create', clientRef: c.id, kind: c.url ? 'bookmark' : 'folder', parent: parentServer, title: c.title ?? '', ...(c.url ? { url: c.url } : {}) });
          if (c.children) walk(c, { clientRef: c.id });
        }
      }
    };
    if (root) walk(root, null);
    const gone = Object.entries(this.state.shadow).filter(([sid, e]) => !seen.has(sid) && e.rev !== -1 && !e.pendingMove);
    const goneIds = new Set(gone.map(([sid]) => sid));
    // 부모 폴더째 지워졌으면 부모만 보낸다(서버가 하위까지 지운다)
    const deletes: SyncOp[] = gone
      .filter(([, e]) => !(e.parent && goneIds.has(e.parent)))
      .map(([sid, e]) => ({ op: 'delete', id: sid, baseRev: e.rev }));
    return [...creates, ...edits, ...deletes];
  }

  private localBookmarkDeletes(ops: SyncOp[]) {
    const del = new Set(ops.filter((o) => o.op === 'delete').map((o) => (o as { id: string }).id));
    const live = Object.values(this.state.shadow).filter((e) => e.kind === 'bookmark').length;
    let n = 0;
    for (const [sid, e] of Object.entries(this.state.shadow)) {
      if (e.kind !== 'bookmark') continue;
      let p: string | null = sid;
      while (p) {
        if (del.has(p)) {
          n++;
          break;
        }
        p = this.state.shadow[p]?.parent ?? null;
      }
    }
    return { deletes: n, live };
  }

  /* ───────── 한 번 동기화 ───────── */
  private async syncOnce(opts: { confirmMassDelete?: boolean }): Promise<SyncReport> {
    if (!this.connected) throw new Error('not connected');
    const report: SyncReport = { pushed: 0, pulled: 0, applied: 0, failed: 0 };
    // 서버가 필수 변경보다 낡았으면 아무것도 쓰지 않는다(경고만인 경우는 그대로 진행)
    if ((await this.checkServer())?.compat === 'server_blocked') throw new Error('server_outdated');
    try {
      const rootId = await this.ensureRoot();
      if (!this.state.initialUploadDone) {
        if (Object.keys(this.state.map).length === 0) await this.restoreMappings(rootId);
        report.imported = await this.initialUpload(rootId);
      }

      // 수집(capture): 루트 밖에서 새로 만든 북마크
      const captures = this.state.captures.splice(0);
      // Move 모드면 clientRef 를 move: 로 — 결과가 오면 원본을 매핑해 pull 이 카테고리 폴더로 옮기게 한다
      const prefix = this.state.moveCaptures ? 'move' : 'capture';
      const captureInfo = new Map(captures.map((c) => [`${prefix}:${c.browserId}`, c]));
      const ops: SyncOp[] = captures.map((c) => ({ op: 'create', clientRef: `${prefix}:${c.browserId}`, kind: 'bookmark', parent: null, autoCategorize: true, title: c.title, url: c.url }));

      const local = this.state.rev > 0 || Object.keys(this.state.shadow).length ? await this.diff(rootId) : [];
      const { deletes, live } = this.localBookmarkDeletes(local);
      const confirm = opts.confirmMassDelete || false;
      if (!confirm && isMassDelete(deletes, live)) {
        // 멈춘다: 지우기 op 는 보내지 않고 사용자 확인을 기다린다. 나머지(생성·수정)는 보낸다.
        this.state.pendingMassDelete = { ops: local.filter((o) => o.op === 'delete'), deletes, live, at: this.now() };
        report.blocked = { error: 'mass_delete_local', deletes, liveBookmarks: live };
        ops.push(...local.filter((o) => o.op !== 'delete'));
      } else {
        if (confirm) this.state.pendingMassDelete = null;
        ops.push(...local);
      }

      if (ops.length || this.state.pendingMappings.length) {
        const pushRes = await this.pushOps(ops, confirm, captureInfo);
        if ('error' in pushRes) {
          report.blocked = pushRes;
          this.state.pendingMassDelete = { ops: ops.filter((o) => o.op === 'delete'), deletes: pushRes.deletes, live: pushRes.liveBookmarks, at: this.now() };
          // 생성·수정만 다시 보낸다
          const rest = ops.filter((o) => o.op !== 'delete');
          if (rest.length) await this.pushOps(rest, false, captureInfo);
        }
        report.pushed = ops.length;
      }

      const pulled = await this.pullAndApply(rootId);
      report.pulled = pulled.pulled;
      report.applied = pulled.applied;
      report.failed = pulled.failed;
      this.state.lastSyncAt = this.now();
      this.state.lastError = null;
      if (!report.blocked) this.state.pendingMassDelete = null;
      await this.save();
      return report;
    } catch (e) {
      this.state.lastError = e instanceof Error ? e.message : String(e);
      await this.save();
      throw e;
    }
  }

  private async pushOps(
    ops: SyncOp[], confirmMassDelete: boolean, captureInfo: Map<string, EngineState['captures'][number]> = new Map(),
  ): Promise<PushResponse | MassDeleteError> {
    const mappings = this.state.pendingMappings.splice(0);
    let res: PushResponse;
    try {
      res = await this.api<PushResponse>('POST', '/sync/push', { ops, mappings, ...(confirmMassDelete ? { confirmMassDelete: true } : {}) });
    } catch (e) {
      this.state.pendingMappings.unshift(...mappings);
      if (e instanceof HttpError && e.status === 409 && e.body?.error === 'mass_delete') return e.body as MassDeleteError;
      throw e;
    }
    // 결과 반영: 만든 것은 매핑, 바꾼 것은 shadow 갱신(서버가 이긴 충돌은 곧 이어지는 pull 이 브라우저를 고친다)
    for (const r of res.results) {
      const op = ops[r.index]!;
      if (op.op === 'create') {
        if (!r.serverId || op.clientRef.startsWith('capture:')) continue;
        if (op.clientRef.startsWith('move:')) {
          // 새로 만든 북마크만 옮긴다. 이미 라이브러리에 있던 것(merged)은 원본을 건드리지 않는다.
          const c = captureInfo.get(op.clientRef);
          if (r.status !== 'applied' || !c) continue;
          this.state.map[c.browserId] = r.serverId;
          this.state.shadow[r.serverId] = { b: c.browserId, kind: 'bookmark', parent: null, title: op.title, url: op.url ?? null, rev: 0, pendingMove: true };
          if (c.parentId) this.state.movedOrigins[r.serverId] = { parentId: c.parentId, ...(c.index !== undefined ? { index: c.index } : {}) };
          continue;
        }
        const browserId = op.clientRef;
        const prevB = this.state.shadow[r.serverId]?.b;
        if (prevB && prevB !== browserId) {
          // 같은 북마크가 이 브라우저에 이미 있었다(중복) → 서버는 새 위치로 옮겼다. 예전 사본을 치운다.
          this.applying = true;
          try {
            await this.bm.removeTree(prevB).catch(() => undefined);
          } finally {
            this.applying = false;
          }
          delete this.state.map[prevB];
        }
        this.state.map[browserId] = r.serverId;
        const parent = op.parent === null ? null : 'serverId' in op.parent ? op.parent.serverId : this.state.map[op.parent.clientRef] ?? null;
        this.state.shadow[r.serverId] = { b: browserId, kind: op.kind, parent, title: op.title, url: op.url ?? null, rev: r.status === 'merged' ? 0 : r.rev ?? 0 };
        // merged 면 서버 쪽 제목·위치가 다를 수 있다 → 서버 노드를 이번 pull 에서 그대로 적용한다(제목 불일치가 남지 않게)
        if (r.status === 'merged' && r.node) this.mergedNodes.push(r.node);
      } else if (op.op === 'delete') {
        if (r.status === 'applied' || r.status === 'noop') {
          delete this.state.movedOrigins[op.id];
          const e = this.state.shadow[op.id];
          if (e) delete this.state.map[e.b];
          this.dropShadowTree(op.id);
        }
        // conflict(다른 곳에서 수정됨) → shadow 를 남겨 둔다. 다음 pull 이 rev 를 올려 주면 브라우저에 되살린다.
        if (r.status === 'conflict') this.markForRestore(op.id);
      } else {
        const e = this.state.shadow[op.id];
        if (!e) continue;
        if (r.status === 'applied') {
          if (op.op === 'update') {
            if (op.title !== undefined) e.title = op.title;
            if (op.url !== undefined) e.url = op.url;
          } else {
            e.parent = op.parent === null ? null : 'serverId' in op.parent ? op.parent.serverId : this.state.map[op.parent.clientRef] ?? null;
          }
          e.rev = r.rev ?? e.rev;
        }
      }
    }
    await this.save();
    return res;
  }

  private dropShadowTree(sid: string) {
    for (const [id, e] of Object.entries(this.state.shadow)) if (e.parent === sid) this.dropShadowTree(id);
    delete this.state.shadow[sid];
  }

  /** 삭제가 거절된 노드는 브라우저에 다시 만들도록 매핑을 끊는다(서버 상태를 다시 받는다) */
  private markForRestore(sid: string) {
    const e = this.state.shadow[sid];
    if (!e) return;
    delete this.state.map[e.b];
    e.b = '';
    e.rev = -1;
  }

  private async restoreMappings(rootId: string) {
    try {
      const r = await this.api<{ mappings: Array<{ browserId: string; serverId: string }> }>('GET', '/sync/mappings');
      const [root] = await this.bm.getSubTree(rootId);
      const ids = new Set<string>();
      const walk = (n: BNode) => {
        ids.add(n.id);
        (n.children ?? []).forEach(walk);
      };
      if (root) walk(root);
      for (const m of r.mappings) if (ids.has(m.browserId)) this.state.map[m.browserId] = m.serverId;
    } catch {
      /* 처음 쓰는 기기 */
    }
  }

  /* ───────── 서버 → 브라우저 ───────── */
  async pullAndApply(rootId: string): Promise<{ pulled: number; applied: number; failed: number }> {
    let pulled = 0;
    let applied = 0;
    let failedNow = 0;
    const changed: ServerNode[] = [];
    let more = true;
    let rev = this.state.rev;
    while (more) {
      const r = await this.api<PullResponse & { more: boolean }>('GET', `/sync/pull?since=${rev}`);
      changed.push(...r.nodes);
      rev = r.rev;
      more = r.more;
    }
    // 삭제가 거절돼 되살려야 할 노드(rev -1)는 서버 현재 상태가 필요하다 — 전체를 다시 받는다
    const needRestore = Object.entries(this.state.shadow).filter(([, e]) => e.rev === -1).map(([sid]) => sid);
    if (needRestore.length) {
      const all = await this.api<PullResponse & { more: boolean }>('GET', `/sync/pull?since=0&limit=5000`);
      for (const n of all.nodes) if (needRestore.includes(n.id) || (n.parentId && needRestore.includes(n.parentId))) changed.push(n);
    }
    pulled = changed.length;
    const latest = new Map<string, ServerNode>();
    // 지난번에 못 쓴 노드를 다시 시도한다 — 새로 받은 상태가 있으면 그쪽이 이긴다(아래 set 이 덮는다)
    for (const [sid, f] of Object.entries(this.state.failed)) if (f.attempts < MAX_APPLY_ATTEMPTS) latest.set(sid, f.node);
    for (const n of changed) {
      if (this.state.failed[n.id] && this.state.failed[n.id]!.node.rev !== n.rev) this.state.failed[n.id]!.attempts = 0; // 서버에서 바뀌었다 → 다시 센다
      latest.set(n.id, n);
    }
    for (const n of this.mergedNodes.splice(0)) if (!latest.has(n.id) || latest.get(n.id)!.rev < n.rev) latest.set(n.id, n);
    this.childCache.clear();
    // 노드 하나가 실패해도(브라우저가 URL 을 거부·적용 중 사용자가 지움 등) 나머지는 계속 쓰고 rev 는 전진한다
    const attempt = async (n: ServerNode, asRoot = false): Promise<'changed' | 'same' | 'defer' | 'failed'> => {
      if (asRoot && n.parentId && this.state.failed[n.parentId]) return this.fail(n, 'parent folder could not be written');
      try {
        const r = await this.applyNode(asRoot ? { ...n, parentId: null } : n, rootId);
        if (r !== 'defer') delete this.state.failed[n.id];
        return r;
      } catch (e) {
        return this.fail(n, e instanceof Error ? e.message : String(e));
      }
    };

    this.applying = true;
    try {
      // 부모가 먼저 오도록 여러 번 돈다
      let queue = [...latest.values()];
      for (let pass = 0; pass < 50 && queue.length; pass++) {
        const later: ServerNode[] = [];
        for (const n of queue) {
          const r = await attempt(n);
          if (r === 'defer') later.push(n);
          else if (r === 'changed') applied++;
          else if (r === 'failed') failedNow++;
        }
        if (later.length === queue.length) {
          // 부모를 못 찾는 노드는 루트에 둔다(부모 자체가 실패했으면 같이 실패로 남긴다)
          for (const n of later) {
            const r = await attempt(n, true);
            if (r === 'changed') applied++;
            else if (r === 'failed') failedNow++;
          }
          break;
        }
        queue = later;
      }
    } finally {
      this.applying = false;
    }
    this.state.rev = rev;
    await this.save();
    return { pulled, applied, failed: failedNow };
  }

  private fail(n: ServerNode, error: string): 'failed' {
    const prev = this.state.failed[n.id];
    this.state.failed[n.id] = { node: n, error, attempts: (prev && prev.node.rev === n.rev ? prev.attempts : 0) + 1, at: this.now() };
    return 'failed';
  }

  private async exists(id: string): Promise<BNode | null> {
    if (!id) return null;
    try {
      const [n] = await this.bm.get(id);
      return n ?? null;
    } catch {
      return null;
    }
  }

  private async applyNode(n: ServerNode, rootId: string): Promise<'changed' | 'same' | 'defer'> {
    const e = this.state.shadow[n.id];
    let b = e ? await this.exists(e.b) : null;
    if (!b && !e) {
      // 재설치 복구: 서버 사본에서 되찾은 매핑
      const bid = Object.keys(this.state.map).find((k) => this.state.map[k] === n.id);
      if (bid) b = await this.exists(bid);
    }
    if (n.deleted) {
      const origin = this.state.movedOrigins[n.id];
      if (b && origin && b.url) {
        // Move 모드로 옮겨 온 원본 — 서버에서 지워졌으면(되돌리기 포함) 지우지 않고 원래 자리로 돌려놓는다
        const back = await this.bm.move(b.id, { parentId: origin.parentId, ...(origin.index !== undefined ? { index: origin.index } : {}) }).catch(() => null);
        if (!back) await this.bm.removeTree(b.id);
      } else if (b) await this.bm.removeTree(b.id);
      delete this.state.movedOrigins[n.id];
      if (e) delete this.state.map[e.b];
      if (b) delete this.state.map[b.id];
      this.dropShadowTree(n.id);
      return b ? 'changed' : 'same';
    }
    let parentB: string;
    if (n.parentId === null) parentB = rootId;
    else {
      const pe = this.state.shadow[n.parentId];
      const pb = pe ? await this.exists(pe.b) : null;
      if (!pb) return 'defer';
      parentB = pb.id;
    }
    let changed = false;
    let bid: string;
    if (b) {
      bid = b.id;
      const upd: { title?: string; url?: string } = {};
      if ((b.title ?? '') !== n.title) upd.title = n.title;
      if (n.kind === 'bookmark' && n.url && b.url !== n.url) upd.url = n.url;
      if (Object.keys(upd).length) {
        await this.bm.update(bid, upd);
        changed = true;
      }
      if (b.parentId !== parentB) {
        await this.bm.move(bid, { parentId: parentB });
        changed = true;
      }
    } else {
      // 채택(adopt): 같은 부모에 같은 폴더(제목)·북마크(정규화 URL)가 이미 있고 아직 매핑이 없으면 새로 만들지 않고 그것을 쓴다.
      // Chrome 계정 동기화가 Everyfold 폴더를 다른 프로필에 복제했거나, 확장을 다시 설치한 경우 중복이 생기지 않는다.
      const adopted = await this.findAdoptable(parentB, n);
      if (adopted) {
        bid = adopted.id;
        this.state.pendingMappings.push({ browserId: bid, serverId: n.id });
        if ((adopted.title ?? '') !== n.title) await this.bm.update(bid, { title: n.title });
        this.state.map[bid] = n.id;
        this.state.shadow[n.id] = { b: bid, kind: n.kind, parent: n.parentId, title: n.title, url: n.url, rev: n.rev };
        return 'changed';
      }
      const created = await this.bm.create({ parentId: parentB, title: n.title, ...(n.kind === 'bookmark' && n.url ? { url: n.url } : {}) });
      this.childCache.get(parentB)?.push(created);
      bid = created.id;
      this.state.pendingMappings.push({ browserId: bid, serverId: n.id });
      changed = true;
    }
    if (e && e.b && e.b !== bid) delete this.state.map[e.b];
    this.state.map[bid] = n.id;
    this.state.shadow[n.id] = { b: bid, kind: n.kind, parent: n.parentId, title: n.title, url: n.url, rev: n.rev };
    return changed ? 'changed' : 'same';
  }

  private async findAdoptable(parentB: string, n: ServerNode): Promise<BNode | null> {
    let kids = this.childCache.get(parentB);
    if (!kids) {
      const [p] = await this.bm.getSubTree(parentB).catch(() => [] as BNode[]);
      kids = (p?.children ?? []).map((c) => ({ id: c.id, title: c.title, ...(c.url ? { url: c.url } : {}) }));
      this.childCache.set(parentB, kids);
    }
    const norm = n.kind === 'bookmark' && n.url ? safeNorm(n.url) : null;
    const hit = kids.find((c) =>
      !(c.id in this.state.map) && (n.kind === 'folder' ? !c.url && c.title === n.title : !!c.url && norm !== null && safeNorm(c.url) === norm));
    if (hit) kids.splice(kids.indexOf(hit), 1);
    return hit ?? null;
  }

  /** 설정: 새 북마크를 옮길지(복사 대신) */
  async setMoveCaptures(on: boolean) {
    this.state.moveCaptures = on;
    if (on) this.state.moveHintDismissed = true;
    await this.save();
  }

  async dismissMoveHint() {
    this.state.moveHintDismissed = true;
    await this.save();
  }

  /** 대량 삭제 보류를 "되돌리기" 로 처리: 지운 것을 서버 상태대로 브라우저에 다시 만든다 */
  async restorePendingDeletes() {
    const p = this.state.pendingMassDelete;
    if (!p) return;
    for (const op of p.ops) if (op.op === 'delete') this.markForRestoreTree(op.id);
    this.state.pendingMassDelete = null;
    await this.save();
    return this.sync();
  }

  private markForRestoreTree(sid: string) {
    for (const [id, e] of Object.entries(this.state.shadow)) if (e.parent === sid) this.markForRestoreTree(id);
    this.markForRestore(sid);
  }
}

function safeNorm(url: string): string | null {
  try {
    return normalizeUrl(url);
  } catch {
    return null;
  }
}

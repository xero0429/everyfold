import browser from 'webextension-polyfill';
import { SyncEngine, HttpError, type BNode, type BookmarksApi, type EngineState, type KV, type SyncReport } from './engine.js';

/**
 * 백그라운드 — 브라우저 이벤트를 엔진에 잇는다.
 *  · 북마크가 바뀌면 2초 디바운스 후 sync
 *  · 5분마다(alarms) + 창에 포커스가 돌아올 때 sync(pull)
 *  · 배지: 대량삭제 보류 = "!", 오류 = "×", 정상 = 비움
 *  · popup 과는 runtime 메시지로 이야기한다(Msg 참조).
 */
const STATE_KEY = 'everyfold.state';

const kv: KV = {
  async get() {
    const r = await browser.storage.local.get(STATE_KEY);
    return r[STATE_KEY] as Partial<EngineState> | undefined;
  },
  async set(s) {
    await browser.storage.local.set({ [STATE_KEY]: s });
  },
};

const bm: BookmarksApi = {
  getTree: () => browser.bookmarks.getTree() as Promise<BNode[]>,
  getSubTree: (id) => browser.bookmarks.getSubTree(id) as Promise<BNode[]>,
  get: (id) => browser.bookmarks.get(id) as Promise<BNode[]>,
  create: (d) => browser.bookmarks.create(d) as Promise<BNode>,
  update: (id, d) => browser.bookmarks.update(id, d) as Promise<BNode>,
  move: (id, d) => browser.bookmarks.move(id, d) as Promise<BNode>,
  removeTree: (id) => browser.bookmarks.removeTree(id),
  remove: (id) => browser.bookmarks.remove(id),
};

const engine = new SyncEngine(bm, kv, (input, init) => fetch(input, init));
const ready = engine.load();

async function badge(report?: SyncReport) {
  const s = engine.state;
  const text = s.pendingMassDelete || report?.blocked ? '!' : s.lastError ? '×' : '';
  await browser.action?.setBadgeText({ text }).catch(() => undefined);
  if (text) await browser.action?.setBadgeBackgroundColor({ color: text === '!' ? '#d97706' : '#dc2626' }).catch(() => undefined);
}

async function runSync(opts: { confirmMassDelete?: boolean } = {}): Promise<SyncReport | { error: string }> {
  await ready;
  if (!engine.connected) return { error: 'not_connected' };
  try {
    const r = await engine.sync(opts);
    engine.state.lastError = null;
    await kv.set(engine.state);
    await badge(r);
    return r;
  } catch (e) {
    engine.state.lastError = e instanceof HttpError ? e.message : String((e as Error)?.message ?? e);
    await kv.set(engine.state);
    await badge();
    return { error: engine.state.lastError };
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
function schedule() {
  if (engine.applying) return; // 엔진이 원격 변경을 쓰는 중에 생긴 이벤트는 무시
  clearTimeout(timer);
  timer = setTimeout(() => void runSync(), 2000);
}

browser.bookmarks.onCreated.addListener((id, node) => {
  void ready.then(async () => {
    if (engine.applying) return;
    await engine.noteCreated({ ...(node as BNode), id });
    schedule();
  });
});
browser.bookmarks.onChanged.addListener(() => schedule());
browser.bookmarks.onMoved.addListener(() => schedule());
browser.bookmarks.onRemoved.addListener(() => schedule());

browser.alarms.create('everyfold-pull', { periodInMinutes: 5 });
browser.alarms.onAlarm.addListener((a) => {
  if (a.name === 'everyfold-pull') void runSync();
});
browser.windows.onFocusChanged.addListener((w) => {
  if (w !== browser.windows.WINDOW_ID_NONE) schedule();
});
browser.runtime.onStartup.addListener(() => void runSync());

export type Msg =
  | { type: 'status' }
  | { type: 'connect'; serverUrl: string; adminToken?: string; deviceToken?: string; deviceName: string }
  | { type: 'disconnect' }
  | { type: 'sync' }
  | { type: 'confirmMassDelete' }
  | { type: 'restoreMassDelete' }
  | { type: 'suggestions' }
  | { type: 'importFile'; text: string }
  | { type: 'decide'; id: string; approve: boolean };

function status() {
  const s = engine.state;
  return {
    connected: engine.connected, serverUrl: s.serverUrl, deviceName: s.deviceName, lastSyncAt: s.lastSyncAt, lastError: s.lastError,
    lastImport: s.lastImport, pendingMassDelete: s.pendingMassDelete ? { deletes: s.pendingMassDelete.deletes, live: s.pendingMassDelete.live } : null,
  };
}

async function handle(m: Msg): Promise<unknown> {
  await ready;
  try {
    switch (m.type) {
      case 'status':
        return status();
      case 'connect':
        await engine.connect(m.serverUrl, { deviceName: m.deviceName, ...(m.adminToken ? { adminToken: m.adminToken } : {}), ...(m.deviceToken ? { deviceToken: m.deviceToken } : {}) });
        return { ...(await runSync()), status: status() };
      case 'disconnect':
        await engine.disconnect();
        await badge();
        return status();
      case 'sync':
        return { ...(await runSync()), status: status() };
      case 'confirmMassDelete':
        return { ...(await runSync({ confirmMassDelete: true })), status: status() };
      case 'restoreMassDelete': {
        const r = await engine.restorePendingDeletes();
        await badge(r);
        return { ...r, status: status() };
      }
      case 'importFile': {
        const r = await engine.api('POST', '/import', { file: m.text });
        await runSync();
        return r;
      }
      case 'suggestions':
        return await engine.api('GET', '/suggestions');
      case 'decide': {
        const r = await engine.api('POST', `/suggestions/${encodeURIComponent(m.id)}/${m.approve ? 'approve' : 'reject'}`);
        await runSync();
        return r;
      }
    }
  } catch (e) {
    return { error: e instanceof HttpError ? e.message : String((e as Error)?.message ?? e) };
  }
}

browser.runtime.onMessage.addListener((m: unknown) => handle(m as Msg));
void ready.then(() => badge());

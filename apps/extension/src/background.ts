import browser from 'webextension-polyfill';
import { SyncEngine, HttpError, MAX_APPLY_ATTEMPTS, type BNode, type BookmarksApi, type EngineState, type KV, type SyncReport } from './engine.js';
import { POPUP_STATUS_KEY, POPUP_SUGGESTIONS_KEY, toCachedStatus, toCachedSuggestions, type PopupStatus, type PopupSuggestion } from './popup-cache.js';

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
    // 팝업 첫 그림용 작은 키를 같은 쓰기에 함께 넣는다(팝업은 큰 상태·SW 를 기다리지 않고 이것부터 그린다)
    await browser.storage.local.set({ [STATE_KEY]: s, [POPUP_STATUS_KEY]: toCachedStatus(status()) });
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
  const text = s.pendingMassDelete || report?.blocked ? '!' : s.lastError || Object.keys(s.failed).length ? '×' : '';
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
  | { type: 'generateSuggestions' }
  | { type: 'setMoveCaptures'; on: boolean }
  | { type: 'dismissMoveHint' }
  | { type: 'importFile'; text: string }
  | { type: 'decide'; id: string; approve: boolean };

function status(): PopupStatus {
  const s = engine.state;
  return {
    connected: engine.connected, serverUrl: s.serverUrl, deviceName: s.deviceName, lastSyncAt: s.lastSyncAt, lastError: s.lastError,
    failed: Object.values(s.failed).slice(0, 20).map((f) => ({ title: f.node.title, url: f.node.url, error: f.error, attempts: f.attempts, gaveUp: f.attempts >= MAX_APPLY_ATTEMPTS })),
    failedCount: Object.keys(s.failed).length,
    moveCaptures: s.moveCaptures,
    // 서버 판 호환(경고) — 'ok' | 'server_outdated' | 'server_blocked' | 'client_outdated'
    compat: s.server?.compat ?? 'ok', serverVersion: s.server?.version ?? null,
    // 첫 연결(첫 업로드) 뒤 한 번만: "옮기기를 켤 수 있어요" — 자동으로 옮기지는 않는다
    showMoveHint: engine.connected && s.initialUploadDone && !s.moveCaptures && !s.moveHintDismissed,
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
        await browser.storage.local.remove(POPUP_SUGGESTIONS_KEY).catch(() => undefined);
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
      case 'suggestions': {
        const r = await engine.api<{ suggestions?: PopupSuggestion[] }>('GET', '/suggestions');
        // 다음에 팝업을 열 때 먼저 보여 줄 마지막 결과(작게)
        if (Array.isArray(r?.suggestions)) {
          await browser.storage.local.set({ [POPUP_SUGGESTIONS_KEY]: toCachedSuggestions(engine.state.serverUrl, r.suggestions) }).catch(() => undefined);
        }
        return r;
      }
      case 'generateSuggestions':
        return await engine.api('POST', '/suggestions/generate');
      case 'setMoveCaptures':
        await engine.setMoveCaptures(m.on);
        return status();
      case 'dismissMoveHint':
        await engine.dismissMoveHint();
        return status();
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
// 업데이트 직후처럼 작은 키가 아직 없거나 옛 판이면 SW 가 깰 때 한 번 채운다
void ready.then(async () => {
  await browser.storage.local.set({ [POPUP_STATUS_KEY]: toCachedStatus(status()) }).catch(() => undefined);
  await badge();
});

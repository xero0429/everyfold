import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from '@everyfold/server/testing';
import { app } from '@everyfold/server';
import popupHtml from '../static/popup.html?raw';
import { API_TIMEOUT_MS, IMPORT_PENDING, IMPORT_TIMEOUT_MS, PUSH_TIMEOUT_MS, REQUEST_TIMEOUT, SyncEngine } from '../src/engine.js';
import { friendlyError } from '../src/popup-text.js';
import {
  CACHE_FAILED_MAX, POPUP_CACHE_VERSION, POPUP_STATUS_FIELDS, readCachedStatus, readCachedSuggestions, toCachedStatus, toCachedSuggestions, type PopupStatus,
} from '../src/popup-cache.js';
import { FakeBookmarks, MemKV } from './fake-bookmarks.js';

/** #3213 팝업 첫 화면 깜빡임(연결 폼 먼저) · 작은 캐시 키로 먼저 그리기 · engine.api 타임아웃 */

const sectionTag = (id: string) => popupHtml.match(new RegExp(`<section id="${id}"[^>]*>`))?.[0] ?? '';

describe('popup first paint', () => {
  it('neither #connect nor #main is visible before show() picks one', () => {
    expect(sectionTag('connect')).toMatch(/\shidden[\s>]/);
    expect(sectionTag('main')).toMatch(/\shidden[\s>]/);
    expect(sectionTag('settings')).toMatch(/\shidden[\s>]/);
  });
});

const status = (over: Partial<PopupStatus> = {}): PopupStatus => ({
  connected: true, serverUrl: 'https://ef.example.workers.dev', deviceName: 'mac', lastSyncAt: 1_800_000_000_000, lastError: null,
  lastImport: null, pendingMassDelete: null, failed: [], failedCount: 0, moveCaptures: false, showMoveHint: false, compat: 'ok', serverVersion: '0.1.0',
  ...over,
});

describe('popup status cache key', () => {
  it('round-trips a status and stays small', () => {
    const failed = Array.from({ length: 20 }, (_, i) => ({ title: `Title ${i} `.repeat(4), url: `https://x.example/${i}`, error: 'boom', attempts: 1, gaveUp: false }));
    const s = status({ failed, failedCount: 20 });
    const c = toCachedStatus(s);
    expect(c.v).toBe(POPUP_CACHE_VERSION);
    const back = readCachedStatus(structuredClone(c))!;
    expect(back.connected).toBe(true);
    expect(back.failed).toHaveLength(CACHE_FAILED_MAX);
    expect(back.failedCount).toBe(20);
    expect(JSON.stringify(c).length).toBeLessThan(2048);
    expect(JSON.stringify(toCachedStatus(status())).length).toBeLessThan(600);
  });

  it('ignores a missing key (first install), another version, or a broken shape', () => {
    expect(readCachedStatus(undefined)).toBeNull();
    expect(readCachedStatus(null)).toBeNull();
    expect(readCachedStatus({ v: POPUP_CACHE_VERSION + 1, status: status() })).toBeNull();
    expect(readCachedStatus({ v: POPUP_CACHE_VERSION, status: { connected: 'yes' } })).toBeNull();
    expect(readCachedStatus(status())).toBeNull(); // 봉투 없이 Status 만 있는 옛 모양
  });

  it('a disconnected cache paints the connect form (connected=false survives)', () => {
    expect(readCachedStatus(toCachedStatus(status({ connected: false, serverUrl: null })))?.connected).toBe(false);
  });

  it('cached suggestions are used only while connected to the same server', () => {
    const c = toCachedSuggestions('https://ef.example.workers.dev', [{ id: 's1', title: 'Make "Recipes"', kind: 'new_category', actions: [{ big: 'x'.repeat(500) }, {}] }]);
    expect(JSON.stringify(c).length).toBeLessThan(300);
    expect(readCachedSuggestions(c, status())).toEqual([{ id: 's1', title: 'Make "Recipes"', kind: 'new_category', actions: [0, 0] }]);
    expect(readCachedSuggestions(c, status({ connected: false }))).toBeNull();
    expect(readCachedSuggestions(c, status({ serverUrl: 'https://other.example' }))).toBeNull();
    expect(readCachedSuggestions(c, null)).toBeNull();
    expect(readCachedSuggestions({ ...c, v: 0 }, status())).toBeNull();
  });
});

describe('popup cache version rule (structure lock)', () => {
  /**
   * 판마다 PopupStatus 필드 목록을 못 박는다. 필드를 바꿨는데 이 시험이 깨지면:
   * POPUP_CACHE_VERSION 을 올리고 새 판 줄을 더한다(옛 판 줄은 고치지 않는다).
   */
  const FIELDS_BY_VERSION: Record<number, string[]> = {
    1: ['compat', 'connected', 'deviceName', 'failed', 'failedCount', 'lastError', 'lastImport', 'lastSyncAt', 'moveCaptures', 'pendingMassDelete', 'serverUrl', 'serverVersion', 'showMoveHint'],
  };
  it('the field list is pinned for the current cache version', () => {
    expect(FIELDS_BY_VERSION[POPUP_CACHE_VERSION]).toEqual([...POPUP_STATUS_FIELDS].sort());
  });
  it('the cached status carries exactly those fields', () => {
    expect(Object.keys(toCachedStatus(status()).status).sort()).toEqual([...POPUP_STATUS_FIELDS].sort());
  });
});

describe('engine.api timeout', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  let hang = false;
  let seenSignal = false;
  const real = (input: string, init?: RequestInit) =>
    Promise.resolve(app.fetch(new Request(input, init), t.env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext));
  /** hang 이면 응답 없는 서버(블랙홀) — signal 이 끊을 때만 끝난다 */
  const fetchImpl = (input: string, init?: RequestInit): Promise<Response> => {
    if (init?.signal) seenSignal = true;
    if (!hang) return real(input, init);
    return new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
    });
  };
  beforeAll(async () => {
    t = await setup();
  });
  afterAll(() => t.close());

  it('default is 15 s', () => {
    expect(API_TIMEOUT_MS).toBe(15_000);
    expect(new SyncEngine(new FakeBookmarks('chrome'), new MemKV(), fetchImpl).apiTimeoutMs).toBe(15_000);
  });

  it('a silent server ends the sync with a timeout error, and the next sync is not blocked', async () => {
    const e = new SyncEngine(new FakeBookmarks('chrome'), new MemKV(), fetchImpl);
    await e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'timeout' });
    await e.sync();
    expect(seenSignal).toBe(true);
    e.apiTimeoutMs = e.importTimeoutMs = e.pushTimeoutMs = 50;

    hang = true;
    const t0 = Date.now();
    const err = await e.sync().then(() => null, (x: Error) => x);
    expect(err?.message).toMatch(new RegExp(`^${REQUEST_TIMEOUT} after 0s: (GET|POST) /`));
    expect(Date.now() - t0).toBeLessThan(5_000);
    expect(friendlyError(err!.message)).toBe('The server didn’t answer in time. Try again in a moment.');
    // 같은 줄에 선 두 번째 sync 도 끝난다(앞 sync 가 줄을 막지 않음)
    await expect(e.sync()).rejects.toThrow(REQUEST_TIMEOUT);

    hang = false;
    await expect(e.sync()).resolves.toMatchObject({ pushed: expect.any(Number) });
    // 제안 같은 단건 호출도 끊긴다
    hang = true;
    await expect(e.api('GET', '/suggestions')).rejects.toThrow(/request_timeout after 0s: GET \/suggestions/);
    hang = false;
  });
});

describe('slow server calls that run LLM classification (/import · /sync/push)', () => {
  let t: Awaited<ReturnType<typeof setup>>;
  /** 이 경로는 응답 없는 서버(블랙홀)처럼 — signal 이 끊을 때만 끝난다 */
  let hangPath: string | null = null;
  /** 이 경로는 이만큼 늦게 답한다 */
  let slow: { path: string; ms: number } | null = null;
  const calls: string[] = [];
  const real = (input: string, init?: RequestInit) =>
    Promise.resolve(app.fetch(new Request(input, init), t.env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext));
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(input).pathname;
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (path === hangPath) {
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    }
    if (slow && path === slow.path) {
      const ms = slow.ms;
      await new Promise<void>((resolve, reject) => {
        const id = setTimeout(resolve, ms);
        init?.signal?.addEventListener('abort', () => { clearTimeout(id); reject(init.signal!.reason); });
      });
    }
    return real(input, init);
  };
  const imports = () => calls.filter((c) => c === 'POST /import').length;
  beforeAll(async () => {
    t = await setup();
  });
  afterAll(() => t.close());

  it('/import and /sync/push get long timeouts (server classifies with an LLM, 50 at a time)', () => {
    expect(IMPORT_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 60_000);
    expect(PUSH_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    const e = new SyncEngine(new FakeBookmarks('chrome'), new MemKV(), fetchImpl);
    expect(e.timeoutFor('/import')).toBe(IMPORT_TIMEOUT_MS);
    expect(e.timeoutFor('/sync/push')).toBe(PUSH_TIMEOUT_MS);
    expect(e.timeoutFor('/pull')).toBe(API_TIMEOUT_MS);
    expect(e.timeoutFor('/suggestions')).toBe(API_TIMEOUT_MS);
  });

  it('a first upload slower than the normal timeout finishes once (no repeat, no overlapping import)', async () => {
    calls.length = 0;
    const bm = new FakeBookmarks('chrome');
    for (let i = 0; i < 5; i++) await bm.create({ parentId: '1', title: `slow ${i}`, url: `https://slow-import.example/${i}` });
    const e = new SyncEngine(bm, new MemKV(), fetchImpl);
    await e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'slow-import' });
    e.apiTimeoutMs = 50; // 일반 호출은 50ms 에 끊김 — /import 는 importTimeoutMs(기본 10분)
    slow = { path: '/import', ms: 300 };
    const before = imports();
    // 업로드 중에 sync 가 더 들어와도(북마크 변경·alarm·포커스) 같은 줄에 서서 /import 를 다시 보내지 않는다
    const [a, b] = await Promise.all([e.sync(), e.sync()]);
    slow = null;
    expect(a.imported).toMatchObject({ created: 5 });
    expect(b.imported).toBeUndefined();
    expect(imports() - before).toBe(1);
    expect(e.state.initialUploadDone).toBe(true);
  });

  it('after an /import timeout it does not re-send /import until the server had time to finish', async () => {
    calls.length = 0;
    let now = 1_800_000_000_000;
    const bm = new FakeBookmarks('chrome');
    for (let i = 0; i < 3; i++) await bm.create({ parentId: '1', title: `retry ${i}`, url: `https://import-retry.example/${i}` });
    const e = new SyncEngine(bm, new MemKV(), fetchImpl, () => now);
    await e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'import-retry' });
    e.importTimeoutMs = 50;
    hangPath = '/import';
    await expect(e.sync()).rejects.toThrow(REQUEST_TIMEOUT);
    hangPath = null;
    expect(imports()).toBe(1);
    expect(e.state.importRetryAt).toBe(now + 50);
    // 쉬는 동안: /import 를 다시 보내지 않고 import_pending 으로 멈춘다(동시 import·LLM 비용 2배 막기)
    await expect(e.sync()).rejects.toThrow(IMPORT_PENDING);
    await expect(e.sync()).rejects.toThrow(IMPORT_PENDING);
    expect(imports()).toBe(1);
    expect(friendlyError(IMPORT_PENDING)).toMatch(/still being sorted/);
    // 쉬는 시간이 지나면 한 번 더 보내고 끝난다
    now += 51;
    const r = await e.sync();
    expect(r.imported).toMatchObject({ created: 3 });
    expect(imports()).toBe(2);
    expect(e.state.importRetryAt).toBeNull();
    expect(e.state.initialUploadDone).toBe(true);
  });

  it('captures survive a /sync/push that times out and are sent on the next sync', async () => {
    const bm = new FakeBookmarks('chrome');
    const e = new SyncEngine(bm, new MemKV(), fetchImpl);
    await e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'push-timeout' });
    await e.sync();
    const n = await bm.create({ parentId: '1', title: 'Captured', url: 'https://capture-timeout.example/a' });
    await e.noteCreated(n);
    expect(e.state.captures).toHaveLength(1);
    e.pushTimeoutMs = 50;
    hangPath = '/sync/push';
    await expect(e.sync()).rejects.toThrow(/request_timeout after 0s: POST \/sync\/push/);
    hangPath = null;
    // 꺼냈던 capture 가 되돌아와 있다(예전: splice 로 비운 채 사라짐)
    expect(e.state.captures.map((c) => c.url)).toEqual(['https://capture-timeout.example/a']);
    await e.sync();
    expect(e.state.captures).toHaveLength(0);
    expect(bm.findUrl('https://capture-timeout.example/a')).toHaveLength(2); // 원본 + Everyfold 사본
  });
});

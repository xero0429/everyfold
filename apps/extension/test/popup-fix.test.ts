import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from '@everyfold/server/testing';
import { app } from '@everyfold/server';
import popupHtml from '../static/popup.html?raw';
import { API_TIMEOUT_MS, REQUEST_TIMEOUT, SyncEngine } from '../src/engine.js';
import { friendlyError } from '../src/popup-text.js';
import {
  CACHE_FAILED_MAX, POPUP_CACHE_VERSION, readCachedStatus, readCachedSuggestions, toCachedStatus, toCachedSuggestions, type PopupStatus,
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
    e.apiTimeoutMs = e.importTimeoutMs = 50;

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

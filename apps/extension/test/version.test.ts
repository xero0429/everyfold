import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup } from '@everyfold/server/testing';
import { app } from '@everyfold/server';
import { API_VERSION } from '@everyfold/core';
import { SyncEngine, VERSION_CHECK_MS } from '../src/engine.js';
import { compatNotice } from '../src/popup-text.js';
import { FakeBookmarks, MemKV } from './fake-bookmarks.js';

/** 서버·확장 판 맞춤: 실제 Worker 앱 앞에 /version 을 바꿔 치는 끼움쇠를 두고 엔진 판정을 본다. */
let t: Awaited<ReturnType<typeof setup>>;
let versionMode: 'real' | 'missing' | 'old' | 'down' = 'real';
let versionCalls = 0;
const fetchVia = async (input: string, init?: RequestInit) => {
  if (new URL(input).pathname === '/version') {
    versionCalls++;
    if (versionMode === 'missing') return new Response('not found', { status: 404 });
    if (versionMode === 'down') throw new TypeError('Failed to fetch');
    if (versionMode === 'old') return Response.json({ service: 'everyfold', version: '0.0.1', api: 0, minClientApi: 0 });
  }
  return app.fetch(new Request(input, init), t.env, { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext);
};

beforeAll(async () => {
  t = await setup({ locale: null });
});
afterAll(() => t.close());

const mk = () => {
  let now = 1_800_000_000_000;
  const e = new SyncEngine(new FakeBookmarks('chrome'), new MemKV(), fetchVia, () => now);
  return { e, tick: (ms: number) => (now += ms) };
};

describe('server version check', () => {
  it('connect records the server version; a current server is ok and is re-checked at most hourly', async () => {
    versionMode = 'real';
    const { e, tick } = mk();
    await e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'v1' });
    expect(e.state.server).toMatchObject({ api: API_VERSION, compat: 'ok', version: expect.stringMatching(/^\d+\.\d+\.\d+/) });
    const calls = versionCalls;
    await e.sync();
    expect(versionCalls).toBe(calls); // 1시간 안 = 다시 안 본다
    tick(VERSION_CHECK_MS + 1);
    await e.sync();
    expect(versionCalls).toBe(calls + 1);
  });

  it('server without /version (older than this check) → warns but still syncs; warning clears after the server is updated', async () => {
    versionMode = 'missing';
    const { e } = mk();
    await e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'v2' });
    expect(e.state.server).toMatchObject({ api: 0, version: null, compat: 'server_outdated' });
    const r = await e.sync();
    expect(r.blocked).toBeUndefined();
    expect(e.state.lastSyncAt).not.toBeNull();
    expect(compatNotice(e.state.server!.compat)?.title).toBe('Server is out of date');
    // 낡은 동안은 sync 마다 다시 보므로 업데이트하면 바로 사라진다
    versionMode = 'real';
    await e.sync();
    expect(e.state.server?.compat).toBe('ok');
    expect(compatNotice(e.state.server!.compat)).toBeNull();
  });

  it('a required server change (block policy) stops sync before anything is written', async () => {
    versionMode = 'old';
    const { e } = mk();
    e.compatPolicy = { clientApi: API_VERSION, warnServerBelow: API_VERSION, blockServerBelow: 1 };
    await e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'v3' });
    expect(e.state.server).toMatchObject({ version: '0.0.1', compat: 'server_blocked' });
    await expect(e.sync()).rejects.toThrow('server_outdated');
    expect(e.state.rootId).toBeNull(); // 루트 폴더도 만들지 않았다
    versionMode = 'real';
    await e.sync();
    expect(e.state.server?.compat).toBe('ok');
    expect(e.state.rootId).not.toBeNull();
  });

  it('network failure on /version keeps the previous verdict and does not fail sync', async () => {
    versionMode = 'real';
    const { e, tick } = mk();
    await e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'v4' });
    versionMode = 'down';
    tick(VERSION_CHECK_MS + 1);
    await e.sync();
    expect(e.state.server?.compat).toBe('ok');
  });

  it('server that needs a newer extension → client_outdated notice', async () => {
    versionMode = 'real';
    const { e } = mk();
    e.compatPolicy = { clientApi: 0, warnServerBelow: 1, blockServerBelow: 0 };
    await e.connect('http://local', { adminToken: 'admin-secret', deviceName: 'v5' });
    expect(e.state.server?.compat).toBe('client_outdated');
    expect(compatNotice('client_outdated', '9.9.9')?.text).toContain('v9.9.9');
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy } from 'wrangler';
import { app } from '../src/index.js';
import type { Env } from '../src/env.js';

/** miniflare 로컬 D1(workerd SQLite) 위에 마이그레이션을 적용하고, Worker 앱을 그 DB 로 직접 호출한다. */
export async function setup() {
  // wrangler 의 getPlatformProxy = miniflare(workerd) 로컬 D1. persist:false → 테스트마다 빈 메모리 DB.
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ configPath: fileURLToPath(new URL('../../../wrangler.toml', import.meta.url)), persist: false });
  const DB = proxy.env.DB;
  const dir = fileURLToPath(new URL('../migrations/', import.meta.url));
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(dir + f, 'utf8').replace(/--.*$/gm, '');
    const stmts = sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
    await DB.batch(stmts.map((s) => DB.prepare(s)));
  }
  const env: Env = { DB, ADMIN_TOKEN: 'admin-secret' };
  const call = async (method: string, path: string, opts: { token?: string; body?: unknown; raw?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    let body: string | undefined;
    if (opts.raw !== undefined) {
      body = opts.raw;
      headers['content-type'] = 'text/html';
    } else if (opts.body !== undefined) {
      body = JSON.stringify(opts.body);
      headers['content-type'] = 'application/json';
    }
    const res = await app.fetch(new Request(`http://local${path}`, { method, headers, ...(body !== undefined ? { body } : {}) }), env, {
      waitUntil() {}, passThroughOnException() {}, props: {},
    } as unknown as ExecutionContext);
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };
  const register = async (name: string) => {
    const r = await call('POST', '/devices', { token: 'admin-secret', body: { name } });
    if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.json)}`);
    return r.json as { deviceId: string; token: string };
  };
  return { DB, env, call, register, close: () => proxy.dispose() };
}

/** 아주 단순한 "기기" — 서버 상태를 pull 로 따라가며 로컬 사본을 유지한다. */
export class SimDevice {
  rev = 0;
  nodes = new Map<string, any>();
  constructor(readonly name: string, readonly token: string, readonly call: Awaited<ReturnType<typeof setup>>['call']) {}
  async pull() {
    let more = true;
    while (more) {
      const r = await this.call('GET', `/sync/pull?since=${this.rev}`, { token: this.token });
      if (r.status !== 200) throw new Error(`pull ${r.status}`);
      for (const n of r.json.nodes) this.nodes.set(n.id, n);
      this.rev = r.json.rev;
      more = r.json.more;
    }
  }
  async push(ops: any[], extra: Record<string, unknown> = {}) {
    return this.call('POST', '/sync/push', { token: this.token, body: { ops, ...extra } });
  }
  live() {
    return [...this.nodes.values()].filter((n) => !n.deleted);
  }
  /** 비교용 정규화된 트리 표현 */
  view() {
    return this.live()
      .map((n) => ({ id: n.id, kind: n.kind, parentId: n.parentId, title: n.title, url: n.url }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }
  folder(name: string) {
    return this.live().find((n) => n.kind === 'folder' && n.title === name);
  }
  byUrl(url: string) {
    return this.live().find((n) => n.url === url);
  }
}

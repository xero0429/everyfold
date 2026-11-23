import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { BRAND, type PushRequest } from '@everyfold/core';
import type { AppEnv, Env } from './env.js';
import { newDeviceToken, requireAdmin, requireDevice, sha256Hex } from './auth.js';
import { Store } from './store.js';
import { MassDeleteBlocked, pull, push } from './sync.js';
import { ensureSeeded } from './categorize.js';
import { IMPORT_MAX_BYTES, importItems, UnknownFormatError } from './importer.js';
import { createSnapshot, ensureDailySnapshot, listChanges, listSnapshots, restoreSnapshot, undoBatch } from './history.js';
import { decideSuggestion, generateSuggestions, listSuggestions } from './suggestions.js';

export const app = new Hono<AppEnv>();

// 토큰은 Authorization 헤더로만 오고 쿠키를 쓰지 않으므로 모든 출처 허용이 안전하다(확장 origin 이 기기마다 다름).
app.use('*', cors({ origin: '*', allowHeaders: ['Authorization', 'Content-Type'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] }));

app.get('/', (c) => c.json({ service: BRAND.slug, name: BRAND.name, ok: true }));

/* ── 기기 등록 (관리자 토큰) ── */
app.post('/devices', requireAdmin, async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => ({} as { name?: string }));
  const name = (body.name ?? '').trim().slice(0, 80) || 'device';
  const id = crypto.randomUUID();
  const token = newDeviceToken();
  await c.env.DB.prepare(`INSERT INTO devices (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)`).bind(id, name, await sha256Hex(token), Date.now()).run();
  await ensureSeeded(new Store(c.env.DB));
  return c.json({ deviceId: id, name, token }, 201);
});
app.get('/devices', requireAdmin, async (c) => {
  const r = await c.env.DB.prepare(`SELECT id, name, created_at, last_seen, revoked FROM devices ORDER BY created_at`).all();
  return c.json({ devices: r.results });
});
app.delete('/devices/:id', requireAdmin, async (c) => {
  await c.env.DB.prepare(`UPDATE devices SET revoked=1 WHERE id=?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/* ── 이하 기기 토큰 필요 ── */
const api = new Hono<AppEnv>();
api.use('*', requireDevice);
api.use('*', async (c, next) => {
  await ensureSeeded(new Store(c.env.DB));
  await next();
});

api.get('/me', (c) => c.json({ device: c.get('device') }));

api.get('/sync/pull', async (c) => {
  const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0);
  const limit = Math.min(5000, Math.max(1, Number(c.req.query('limit') ?? 1000) || 1000));
  return c.json(await pull(new Store(c.env.DB), since, limit));
});

api.post('/sync/push', async (c) => {
  const body = await c.req.json<PushRequest>().catch(() => null);
  if (!body || !Array.isArray(body.ops)) return c.json({ error: 'bad_request' }, 400);
  if (body.ops.length > 5000) return c.json({ error: 'too_many_ops', max: 5000 }, 413);
  const store = new Store(c.env.DB);
  try {
    const res = await push(store, c.env, c.get('device').id, body);
    if (body.ops.length) await ensureDailySnapshot(store);
    return c.json(res);
  } catch (e) {
    if (e instanceof MassDeleteBlocked) return c.json(e.info, 409);
    throw e;
  }
});

api.get('/sync/mappings', async (c) => {
  const r = await c.env.DB.prepare(`SELECT browser_id AS browserId, server_id AS serverId FROM mappings WHERE device_id=?`).bind(c.get('device').id).all();
  return c.json({ mappings: r.results });
});

api.post('/import', async (c) => {
  const ct = c.req.header('content-type') ?? '';
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > IMPORT_MAX_BYTES) return c.json({ error: 'too_large', maxBytes: IMPORT_MAX_BYTES }, 413);
  // JSON 본문 { items } | { html } | { file, format? } — 아니면 본문 전체를 내보내기 파일로 보고 형식을 알아낸다
  const raw = await c.req.text();
  // Content-Length 가 없거나(청크 전송) 거짓이어도 실제 길이로 한 번 더 막는다
  if (new TextEncoder().encode(raw).byteLength > IMPORT_MAX_BYTES) return c.json({ error: 'too_large', maxBytes: IMPORT_MAX_BYTES }, 413);
  let body: Parameters<typeof importItems>[3] | null = null;
  if (ct.includes('application/json')) {
    try {
      const j = JSON.parse(raw);
      body = j && (typeof j.html === 'string' || typeof j.file === 'string' || Array.isArray(j.items)) ? j : { file: raw };
    } catch {
      body = null;
    }
  } else body = { file: raw };
  if (!body) return c.json({ error: 'bad_request' }, 400);
  try {
    return c.json(await importItems(new Store(c.env.DB), c.env, c.get('device').id, body));
  } catch (e) {
    if (e instanceof UnknownFormatError) return c.json({ error: 'unknown_format' }, 400);
    throw e;
  }
});

api.get('/categories', async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT f.id, f.title AS name, f.parent_id AS parentId, f.position,
            (SELECT COUNT(*) FROM nodes b WHERE b.parent_id=f.id AND b.deleted=0 AND b.kind='bookmark') AS bookmarks
       FROM nodes f WHERE f.kind='folder' AND f.deleted=0 ORDER BY f.parent_id, f.position`,
  ).all();
  return c.json({ categories: r.results });
});
api.post('/categories', async (c) => {
  const body = await c.req.json<{ name?: string; parentId?: string | null }>().catch(() => ({} as { name?: string; parentId?: string | null }));
  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'name_required' }, 400);
  const res = await push(new Store(c.env.DB), c.env, c.get('device').id, {
    ops: [{ op: 'create', clientRef: `api:${crypto.randomUUID()}`, kind: 'folder', parent: body.parentId ? { serverId: body.parentId } : null, title: name }],
  });
  return c.json(res, 201);
});

api.get('/suggestions', async (c) => c.json({ suggestions: await listSuggestions(new Store(c.env.DB), c.req.query('status') ?? 'pending') }));
api.post('/suggestions/generate', async (c) => c.json({ suggestions: await generateSuggestions(new Store(c.env.DB)) }));
api.post('/suggestions/:id/approve', async (c) => {
  const r = await decideSuggestion(new Store(c.env.DB), c.req.param('id'), true, c.get('device').id);
  return 'error' in r ? c.json(r, r.error === 'not_found' ? 404 : 409) : c.json(r);
});
api.post('/suggestions/:id/reject', async (c) => {
  const r = await decideSuggestion(new Store(c.env.DB), c.req.param('id'), false, c.get('device').id);
  return 'error' in r ? c.json(r, r.error === 'not_found' ? 404 : 409) : c.json(r);
});

api.get('/snapshots', async (c) => c.json({ snapshots: await listSnapshots(new Store(c.env.DB)) }));
api.post('/snapshots', async (c) => c.json(await createSnapshot(new Store(c.env.DB), 'manual'), 201));
api.post('/snapshots/:id/restore', async (c) => {
  const r = await restoreSnapshot(new Store(c.env.DB), c.req.param('id'), c.get('device').id);
  return r ? c.json(r) : c.json({ error: 'not_found' }, 404);
});

api.get('/changes', async (c) => c.json({ batches: await listChanges(new Store(c.env.DB), Number(c.req.query('limit') ?? 100) || 100) }));
api.post('/changes/undo', async (c) => {
  const body = await c.req.json<{ batchId?: string }>().catch(() => ({} as { batchId?: string }));
  if (!body.batchId) return c.json({ error: 'batchId_required' }, 400);
  const r = await undoBatch(new Store(c.env.DB), body.batchId, c.get('device').id);
  return r ? c.json(r) : c.json({ error: 'not_found' }, 404);
});
api.get('/conflicts', async (c) => {
  const r = await c.env.DB.prepare(`SELECT * FROM conflicts ORDER BY id DESC LIMIT 200`).all();
  return c.json({ conflicts: r.results });
});

app.route('/', api);

app.onError((err, c) => {
  // 내부 오류 문구(D1 SQL·스키마 등)는 로그에만 — 클라이언트엔 일반 문구와 로그를 찾을 id 만
  const ref = crypto.randomUUID();
  console.error(`[${ref}]`, err);
  return c.json({ error: 'internal', ref }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_ctrl: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(ensureDailySnapshot(new Store(env.DB)).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;

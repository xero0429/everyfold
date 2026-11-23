import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './env.js';

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newDeviceToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return 'efd_' + btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bearer(h: string | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(h ?? '');
  return m ? m[1]!.trim() : null;
}

/** 길이가 달라도 시간 차가 안 나게 비교 */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

/** 관리자 토큰이 틀렸을 때 응답을 늦추는 시간 */
export let ADMIN_FAIL_DELAY_MS = 1000;
export function setAdminFailDelay(ms: number) {
  ADMIN_FAIL_DELAY_MS = ms;
}

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const admin = c.env.ADMIN_TOKEN;
  if (!admin) return c.json({ error: 'admin_token_not_configured', hint: 'wrangler secret put ADMIN_TOKEN' }, 503);
  const t = bearer(c.req.header('authorization'));
  if (!t || !(await safeEqual(t, admin))) {
    // 관리자 토큰 무차별 대입을 느리게 한다(요청마다 1초) — 토큰은 32바이트 이상 난수를 권장(README)
    await new Promise((r) => setTimeout(r, ADMIN_FAIL_DELAY_MS));
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
};

/** 단일 사용자 + 기기별 토큰. 토큰 원문은 저장하지 않고 SHA-256 만 둔다. */
export const requireDevice: MiddlewareHandler<AppEnv> = async (c, next) => {
  const t = bearer(c.req.header('authorization'));
  if (!t) return c.json({ error: 'unauthorized' }, 401);
  const row = await c.env.DB.prepare(`SELECT id, name, last_seen FROM devices WHERE token_hash=? AND revoked=0`).bind(await sha256Hex(t)).first<{ id: string; name: string; last_seen: number | null }>();
  if (!row) return c.json({ error: 'unauthorized' }, 401);
  const now = Date.now();
  if (!row.last_seen || now - row.last_seen > 60_000) await c.env.DB.prepare(`UPDATE devices SET last_seen=? WHERE id=?`).bind(now, row.id).run();
  c.set('device', { id: row.id, name: row.name });
  await next();
};

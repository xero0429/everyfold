import { hostOf } from '../normalize.js';

/**
 * 사용자가 북마크를 옮긴 기록에서 "이 도메인은 이 카테고리" 규칙을 배운다.
 * - 같은 호스트(www 제외)를 같은 카테고리로 minCount 번 이상 옮겼고,
 * - 그 호스트 이동 중 그 카테고리 비율이 minShare 이상이면 규칙이 된다.
 * - 동률이면 더 최근에 옮긴 카테고리가 이긴다.
 * 학습 규칙은 기본 도메인 규칙보다 우선한다(사용자 의도가 명시적이므로).
 */
export interface MoveEvent {
  url: string;
  toCategoryId: string;
  at: number;
}

export interface LearnedRule {
  host: string;
  categoryId: string;
  count: number;
  share: number;
}

export interface LearnOptions {
  minCount?: number;
  minShare?: number;
}

export function learnRules(moves: readonly MoveEvent[], opts: LearnOptions = {}): LearnedRule[] {
  const minCount = opts.minCount ?? 2;
  const minShare = opts.minShare ?? 0.6;
  const byHost = new Map<string, Map<string, { count: number; last: number }>>();
  for (const mv of moves) {
    const host = hostOf(mv.url);
    if (!host) continue;
    let cats = byHost.get(host);
    if (!cats) byHost.set(host, (cats = new Map()));
    const c = cats.get(mv.toCategoryId) ?? { count: 0, last: 0 };
    c.count++;
    c.last = Math.max(c.last, mv.at);
    cats.set(mv.toCategoryId, c);
  }
  const out: LearnedRule[] = [];
  for (const [host, cats] of byHost) {
    let total = 0;
    let best: { id: string; count: number; last: number } | null = null;
    for (const [id, c] of cats) {
      total += c.count;
      if (!best || c.count > best.count || (c.count === best.count && c.last > best.last)) best = { id, ...c };
    }
    if (!best) continue;
    const share = best.count / total;
    if (best.count >= minCount && share >= minShare) out.push({ host, categoryId: best.id, count: best.count, share });
  }
  return out.sort((a, b) => a.host.localeCompare(b.host));
}

export function matchLearned(url: string, rules: readonly LearnedRule[]): LearnedRule | null {
  const host = hostOf(url);
  if (!host) return null;
  let best: LearnedRule | null = null;
  for (const r of rules) {
    if (host === r.host || host.endsWith('.' + r.host)) {
      if (!best || r.host.length > best.host.length) best = r;
    }
  }
  return best;
}

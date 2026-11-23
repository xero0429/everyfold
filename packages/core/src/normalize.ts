/**
 * URL 정규화 — 중복 판정 키를 만든다. 원본 URL 은 따로 보관하고, 이 값은 비교용이다.
 *
 * 규칙
 * 1. 앞뒤 공백 제거. URL 로 해석이 안 되면 원문 그대로(공백만 정리) 돌려준다.
 * 2. http/https 가 아니면(javascript:, file:, chrome:, place: …) 스킴만 소문자로 하고 나머지는 건드리지 않는다.
 * 3. 스킴·호스트 소문자, 기본 포트(:80/:443) 제거, IDN → punycode (WHATWG URL 이 처리).
 * 4. 경로 끝 슬래시 제거(루트 "/" 는 빈 경로로 본다). `/a/` == `/a`.
 * 5. 추적 파라미터 제거: utm_* · fbclid · gclid · dclid · gbraid · wbraid · msclkid · yclid ·
 *    mc_cid · mc_eid · igshid · _hsenc · _hsmi · mkt_tok · spm · ref_src(트위터).
 *    남은 쿼리는 키 순으로 정렬(같은 키는 원래 순서 유지)해 순서 차이를 없앤다.
 * 6. fragment: `#/…`, `#!…` 처럼 SPA 라우트로 쓰이는 것만 남기고, 나머지(`#section`, `#:~:text=`)는 버린다.
 */
const TRACKING_EXACT = new Set([
  'fbclid', 'gclid', 'dclid', 'gbraid', 'wbraid', 'msclkid', 'yclid',
  'mc_cid', 'mc_eid', 'igshid', '_hsenc', '_hsmi', 'mkt_tok', 'spm', 'ref_src',
]);

export function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  return k.startsWith('utm_') || TRACKING_EXACT.has(k);
}

export function normalizeUrl(raw: string): string {
  const input = raw.trim();
  if (!input) return '';
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return input;
  }
  const scheme = u.protocol.toLowerCase();
  if (scheme !== 'http:' && scheme !== 'https:') {
    const idx = input.indexOf(':');
    return input.slice(0, idx).toLowerCase() + input.slice(idx);
  }

  let path = u.pathname;
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path === '/') path = '';

  const kept: Array<[string, string]> = [];
  for (const [k, v] of u.searchParams) if (!isTrackingParam(k)) kept.push([k, v]);
  // 안정 정렬: 키 기준, 같은 키는 원래 순서 유지
  const sorted = kept.map((p, i) => ({ p, i })).sort((a, b) =>
    a.p[0] < b.p[0] ? -1 : a.p[0] > b.p[0] ? 1 : a.i - b.i,
  );
  const query = sorted.length
    ? '?' + sorted.map(({ p }) => `${encodeURIComponent(p[0])}=${encodeURIComponent(p[1])}`).join('&')
    : '';

  const frag = u.hash.startsWith('#/') || u.hash.startsWith('#!') ? u.hash : '';
  const auth = u.username ? `${u.username}${u.password ? ':' + u.password : ''}@` : '';
  return `${scheme}//${auth}${u.host.toLowerCase()}${path}${query}${frag}`;
}

/** 분류·학습에 쓰는 호스트(소문자, 앞의 www. 제거). URL 이 아니면 null. */
/**
 * 가져오기(남의 내보내기 파일·첫 연결 업로드)로 받아도 되는 URL 인가.
 * 스킴이 있어야 하고, 열면 코드가 도는 javascript:/vbscript:/data: 와 Firefox 내부 place: 는 받지 않는다.
 * (기기가 직접 동기화하는 sync/push 는 사용자 자신의 북마크라 북마클릿도 그대로 둔다 — 여기서 막지 않는다.)
 */
export function isImportableUrl(raw: string): boolean {
  const u = raw.trim();
  return isParsableUrl(u) && !/^(javascript|vbscript|data|place):/i.test(u);
}

/** 브라우저가 받아 주는 URL 꼴인가 — 스킴이 있고 WHATWG URL 로 파싱된다. 못 받는 문자열을 서버에 두면 모든 기기 pull 에서 실패한다. */
export function isParsableUrl(raw: string): boolean {
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  try {
    new URL(raw);
    return true;
  } catch {
    return false;
  }
}

/** 제목·URL 길이 상한(문자). 제목은 잘라 담고, 이보다 긴 URL 은 받지 않는다. */
export const MAX_TITLE_LENGTH = 2048;
export const MAX_URL_LENGTH = 2048;
export const clampTitle = (t: string | undefined | null) => (t ?? '').slice(0, MAX_TITLE_LENGTH);

export function hostOf(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isSameBookmark(a: string, b: string): boolean {
  return normalizeUrl(a) === normalizeUrl(b);
}

export interface DedupInput {
  url: string;
  title?: string;
  addDate?: number;
}

export interface DuplicateGroup<T extends DedupInput> {
  key: string;
  keep: T;
  duplicates: T[];
}

/**
 * 같은 정규화 URL 끼리 묶는다. 남길 항목: 제목이 있는 것 > 먼저 추가된 것(addDate 작은 것) > 먼저 나온 것.
 * 입력 순서를 보존한 그룹 배열을 돌려준다(중복 없는 항목도 duplicates=[] 로 포함).
 */
export function groupDuplicates<T extends DedupInput>(items: readonly T[]): DuplicateGroup<T>[] {
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = normalizeUrl(it.url);
    if (!key) continue;
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
      order.push(key);
    }
    arr.push(it);
  }
  return order.map((key) => {
    const arr = map.get(key)!;
    const ranked = arr
      .map((it, i) => ({ it, i }))
      .sort((a, b) => {
        const ta = a.it.title?.trim() ? 0 : 1;
        const tb = b.it.title?.trim() ? 0 : 1;
        if (ta !== tb) return ta - tb;
        const da = a.it.addDate ?? Number.MAX_SAFE_INTEGER;
        const db = b.it.addDate ?? Number.MAX_SAFE_INTEGER;
        if (da !== db) return da - db;
        return a.i - b.i;
      });
    const keep = ranked[0]!.it;
    return { key, keep, duplicates: arr.filter((x) => x !== keep) };
  });
}

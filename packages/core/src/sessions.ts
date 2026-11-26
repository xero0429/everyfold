import type { Locale } from './classify/rules.js';

/**
 * 열린 창 저장(세션) — 지금 브라우저의 창·탭 주소를 Everyfold 북마크 폴더로 남긴다. 북마크라서 기존 동기화로 다른 브라우저에 퍼진다.
 *
 *   Everyfold/<세션 폴더>/<YYYY-MM-DD HH:mm · 기기 이름>/<창 1>/<탭 북마크…>
 *
 * 세션 폴더는 이름이 아니라 예약 키(SESSIONS_KEY, 서버 nodes.cat_key)로 식별한다 — 카테고리 키 표와 같은 방식이라
 * 사용자가 이름을 바꿔도, 서버 로캘이 달라도 그대로다. 서버는 이 폴더와 그 아래를 분류(규칙·학습·LLM)·정리 제안·
 * 캡처·중복 합치기 어디에도 쓰지 않는다(카테고리가 아니다).
 */
export const SESSIONS_KEY = 'sessions';

/** 세션 기능이 필요로 하는 서버 API 판(SyncOp create 의 key·ServerNode.key·세션 예외) */
export const SESSIONS_MIN_SERVER_API = 2;

export const SESSION_NAMES: Record<Locale, { folder: string; window: (n: number) => string }> = {
  en: { folder: 'Sessions', window: (n) => `Window ${n}` },
  ko: { folder: '세션', window: (n) => `창 ${n}` },
};

export const sessionsFolderName = (locale: Locale) => SESSION_NAMES[locale].folder;
export const sessionWindowName = (locale: Locale, n: number) => SESSION_NAMES[locale].window(n);

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-11-26 14:05 · Work laptop` — 기기 시간대 기준 */
export function sessionTitle(at: Date, deviceName: string | null | undefined): string {
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  const name = (deviceName ?? '').trim();
  return name ? `${stamp} · ${name}` : stamp;
}

/**
 * 세션에 담을 수 있는 주소인가 — http(s) 만. 브라우저마다 북마크로 못 담거나(Firefox: about:·chrome:·file:·javascript:·data:
 * 거부) 복구 때 windows.create 가 못 여는(chrome://·edge://·about:·file:·확장 페이지·view-source:) 주소는 브라우저 간에 옮길 수
 * 없으므로 허용 목록으로 거른다.
 */
export function isSessionUrl(raw: string | null | undefined): raw is string {
  if (!raw) return false;
  const u = raw.trim();
  if (!/^https?:\/\//i.test(u) || u.length > 2048) return false;
  try {
    const p = new URL(u);
    return (p.protocol === 'http:' || p.protocol === 'https:') && !!p.hostname;
  } catch {
    return false;
  }
}

export interface SessionTabInput {
  url?: string;
  /** Chrome: 아직 로드 전인 탭의 주소 */
  pendingUrl?: string;
  title?: string;
}
export interface SessionWindowInput {
  incognito?: boolean;
  type?: string;
  tabs?: SessionTabInput[];
}
export interface SessionTab {
  url: string;
  title: string;
}
export interface SessionPlan {
  windows: SessionTab[][];
  /** 북마크로 못 담아 건너뛴 탭 수(일반 창 안에서) */
  skipped: number;
  tabs: number;
}

/**
 * windows.getAll({populate:true}) 결과 → 저장할 창·탭. 시크릿/사생활 창과 일반 창이 아닌 것(팝업·devtools)은 통째로 뺀다.
 * 담을 탭이 하나도 없는 창은 저장하지 않는다(그 창의 못 담는 탭은 skipped 로 센다).
 */
export function planSession(windows: readonly SessionWindowInput[]): SessionPlan {
  const out: SessionTab[][] = [];
  let skipped = 0;
  for (const w of windows) {
    if (w.incognito) continue;
    if (w.type && w.type !== 'normal') continue;
    const tabs: SessionTab[] = [];
    for (const t of w.tabs ?? []) {
      const url = isSessionUrl(t.url) ? t.url : isSessionUrl(t.pendingUrl) ? t.pendingUrl : null;
      if (!url) {
        skipped++;
        continue;
      }
      tabs.push({ url: url.trim(), title: (t.title ?? '').trim() || url.trim() });
    }
    if (tabs.length) out.push(tabs);
  }
  return { windows: out, skipped, tabs: out.reduce((n, w) => n + w.length, 0) };
}

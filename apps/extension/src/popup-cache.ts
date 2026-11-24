/**
 * 팝업 첫 그림용 작은 캐시 — background 가 status()·마지막 제안 목록을 storage.local 의 작은 키에 따로 써 둔다.
 * 팝업은 이 키를 먼저 읽어 바로 그리고(서비스워커 깨우기·큰 상태 읽기를 기다리지 않음), background 응답이 오면 고친다.
 * DOM·브라우저 API 없음(테스트에서 바로 부른다). 토큰은 넣지 않는다.
 */
export const POPUP_STATUS_KEY = 'everyfold.popupStatus';
export const POPUP_SUGGESTIONS_KEY = 'everyfold.popupSuggestions';
/** 모양이 바뀌면 올린다 — 다른 판의 키는 읽지 않는다(첫 설치처럼 취급) */
export const POPUP_CACHE_VERSION = 1;
/** 캐시에 넣는 실패 목록·제안 수 상한(키를 수백 바이트~수 KB 로 묶어 둔다) */
export const CACHE_FAILED_MAX = 5;
export const CACHE_SUGGESTIONS_MAX = 10;

export interface PopupStatus {
  connected: boolean; serverUrl: string | null; deviceName: string | null; lastSyncAt: number | null; lastError: string | null;
  lastImport: { created: number; mergedExisting: number; mergedInFile: number } | null;
  pendingMassDelete: { deletes: number; live: number } | null;
  failed: Array<{ title: string; url: string | null; error: string; attempts: number; gaveUp: boolean }>;
  failedCount: number;
  moveCaptures: boolean;
  showMoveHint: boolean;
  compat?: import('@everyfold/core').Compat;
  serverVersion?: string | null;
}
export interface PopupSuggestion { id: string; title: string; kind?: string; actions?: unknown[] }

interface CachedStatus { v: number; status: PopupStatus }
interface CachedSuggestions { v: number; serverUrl: string | null; suggestions: PopupSuggestion[] }

/** background 쪽: status() → 저장할 값(실패 목록은 앞 몇 개만) */
export function toCachedStatus(s: PopupStatus): CachedStatus {
  return { v: POPUP_CACHE_VERSION, status: { ...s, failed: s.failed.slice(0, CACHE_FAILED_MAX) } };
}

/** 팝업 쪽: 저장된 값 → 그릴 수 있는 Status, 아니면 null(키 없음·다른 판·모양이 깨짐) */
export function readCachedStatus(raw: unknown): PopupStatus | null {
  const c = raw as Partial<CachedStatus> | null | undefined;
  if (!c || typeof c !== 'object' || c.v !== POPUP_CACHE_VERSION) return null;
  const s = c.status as Partial<PopupStatus> | undefined;
  if (!s || typeof s !== 'object' || typeof s.connected !== 'boolean' || !Array.isArray(s.failed) || typeof s.failedCount !== 'number') return null;
  return s as PopupStatus;
}

/** background 쪽: 제안 응답(제목·종류·바꿀 수만 — actions 는 개수만 남긴다) */
export function toCachedSuggestions(serverUrl: string | null, list: PopupSuggestion[]): CachedSuggestions {
  return {
    v: POPUP_CACHE_VERSION, serverUrl,
    suggestions: list.slice(0, CACHE_SUGGESTIONS_MAX).map((s) => ({
      id: s.id, title: s.title, ...(s.kind ? { kind: s.kind } : {}), ...(s.actions ? { actions: new Array(s.actions.length).fill(0) } : {}),
    })),
  };
}

/** 팝업 쪽: 같은 서버에 연결돼 있을 때만 캐시 제안을 쓴다(연결 끊김·다른 서버 = null) */
export function readCachedSuggestions(raw: unknown, status: PopupStatus | null): PopupSuggestion[] | null {
  const c = raw as Partial<CachedSuggestions> | null | undefined;
  if (!status?.connected || !c || typeof c !== 'object' || c.v !== POPUP_CACHE_VERSION || !Array.isArray(c.suggestions)) return null;
  if (c.serverUrl !== status.serverUrl) return null;
  return c.suggestions.filter((s) => s && typeof s.id === 'string' && typeof s.title === 'string');
}

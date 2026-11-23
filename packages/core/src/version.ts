/**
 * 서버·확장 호환 범위 — 서버와 확장은 따로 업데이트된다(서버 = 사용자 저장소 → Workers Builds, 확장 = 스토어).
 * 서버 API 가 바뀌면 API_VERSION 을 올리고, 그 변경 없이는 확장이 제대로 못 도는지에 따라 아래 범위를 고친다.
 *
 *  · API_VERSION       이 코드의 서버 API 판(서버가 GET /version 으로 알린다)
 *  · MIN_CLIENT_API    서버가 기대하는 확장 API 판의 하한(확장이 이보다 낡았으면 확장이 경고)
 *  · WARN_SERVER_BELOW 확장이 경고하는 서버 API 판(이보다 낮으면 "Server is out of date")
 *  · BLOCK_SERVER_BELOW 확장이 동기화를 멈추는 서버 API 판 — 데이터가 망가질 수 있는 필수 변경일 때만 올린다(지금은 0 = 막지 않음)
 */
export const API_VERSION = 1;
export const MIN_CLIENT_API = 1;
export const WARN_SERVER_BELOW = 1;
export const BLOCK_SERVER_BELOW = 0;

/** GET /version 응답 */
export interface ServerVersionInfo {
  service: string;
  /** 서버 릴리스 판(apps/server/package.json) */
  version: string;
  /** 서버 API 판 */
  api: number;
  /** 서버가 받아 주는 확장 API 판의 하한 */
  minClientApi: number;
}

export type Compat = 'ok' | 'server_outdated' | 'server_blocked' | 'client_outdated';

export interface CompatPolicy {
  clientApi: number;
  warnServerBelow: number;
  blockServerBelow: number;
}
export const DEFAULT_COMPAT_POLICY: CompatPolicy = { clientApi: API_VERSION, warnServerBelow: WARN_SERVER_BELOW, blockServerBelow: BLOCK_SERVER_BELOW };

/**
 * 서버 api 판으로 호환을 판정한다. `/version` 이 없는 옛 서버는 api 0 으로 본다(→ server_outdated).
 * 서버가 낡은 쪽이 먼저(사용자가 자기 저장소를 업데이트해야 한다), 그다음 확장이 낡은 쪽.
 */
export function checkCompat(server: { api: number; minClientApi?: number } | null, policy: CompatPolicy = DEFAULT_COMPAT_POLICY): Compat {
  const api = server && Number.isFinite(server.api) ? server.api : 0;
  if (api < policy.blockServerBelow) return 'server_blocked';
  if (api < policy.warnServerBelow) return 'server_outdated';
  if (server?.minClientApi !== undefined && policy.clientApi < server.minClientApi) return 'client_outdated';
  return 'ok';
}

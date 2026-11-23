export interface Env {
  DB: D1Database;
  /** 기기 등록용 관리자 토큰 (Worker secret) */
  ADMIN_TOKEN?: string;
  /** 선택: LLM 분류 (Worker secret). 없으면 규칙 분류만 */
  ANTHROPIC_API_KEY?: string;
  /** 선택: LLM 모델 덮어쓰기 (기본 claude-haiku-5-5) */
  LLM_MODEL?: string;
}

export interface Device {
  id: string;
  name: string;
}

export type AppEnv = { Bindings: Env; Variables: { device: Device } };

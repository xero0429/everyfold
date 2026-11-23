export interface Env {
  DB: D1Database;
  /** 기기 등록용 관리자 토큰 (Worker secret) */
  ADMIN_TOKEN?: string;
  /** 선택: LLM 분류 (Worker secret). 없으면 규칙 분류만 */
  ANTHROPIC_API_KEY?: string;
  /** 선택: LLM 모델 덮어쓰기 (기본 claude-haiku-5-5) */
  LLM_MODEL?: string;
  /** 선택: 기본 카테고리·서버 문구·LLM 제안 이름의 언어 ('en' | 'ko'). 없으면 첫 기기의 브라우저 언어, 그것도 없으면 en */
  LOCALE?: string;
}

export interface Device {
  id: string;
  name: string;
}

export type AppEnv = { Bindings: Env; Variables: { device: Device } };

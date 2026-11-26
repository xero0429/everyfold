import { pickLocale, planSession, type SessionWindowInput } from '@everyfold/core';
import type { SaveSessionResult, SyncEngine } from './engine.js';

/**
 * 열린 창 저장·복구 — 브라우저 창 API 와 엔진을 잇는다(브라우저 API 는 주입 — 시험에서 가짜를 꽂는다).
 *
 * 권한: "tabs" 는 선택 권한(manifest optional_permissions)이다. 팝업이 저장 버튼 클릭 핸들러에서 permissions.request 로 묻고,
 * 여기서는 갖고 있는지만 본다 — 없으면 아무것도 읽거나 만들지 않고 TABS_PERMISSION 을 돌려준다(나머지 기능은 그대로).
 * 복구(windows.create)는 tabs 권한 없이 된다(e2e 실측).
 */
export const TABS_PERMISSION = 'tabs_permission';

/**
 * 저장 버튼이 묻는 권한. Firefox 는 탭 주소를 서버로 보내는 것이 데이터 수집 선택 항목(browsingActivity)이라 함께 묻는다.
 * Chrome 은 data_collection 키를 모른다(넣으면 요청이 거절된다).
 */
export const sessionPermissions = (firefox: boolean): { permissions: ['tabs'] } =>
  (firefox ? { permissions: ['tabs'], data_collection: ['browsingActivity'] } : { permissions: ['tabs'] }) as { permissions: ['tabs'] };

export interface WindowsApi {
  getAll(q: { populate: true; windowTypes: ['normal'] }): Promise<SessionWindowInput[]>;
  create(d: { url: string[] }): Promise<unknown>;
}
export interface SessionDeps {
  hasTabsPermission(): Promise<boolean>;
  windows: WindowsApi;
  /** browser.i18n.getUILanguage() — 창 폴더 이름(Window 1 / 창 1) 언어 */
  uiLanguage(): string;
}

export async function saveOpenWindows(engine: SyncEngine, deps: SessionDeps): Promise<SaveSessionResult | { error: string }> {
  if (!(await deps.hasTabsPermission())) return { error: TABS_PERMISSION };
  const wins = await deps.windows.getAll({ populate: true, windowTypes: ['normal'] });
  return engine.saveSession(planSession(wins), { locale: pickLocale(deps.uiLanguage()) });
}

/** 세션 하나를 창마다 windows.create 한 번으로 연다 */
export async function restoreSession(engine: SyncEngine, deps: Pick<SessionDeps, 'windows'>, id: string): Promise<{ windows: number; tabs: number }> {
  const windows = await engine.sessionWindows(id);
  for (const url of windows) await deps.windows.create({ url });
  return { windows: windows.length, tabs: windows.reduce((n, w) => n + w.length, 0) };
}

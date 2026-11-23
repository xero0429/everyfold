import { LOCALES, pickLocale, type Locale } from '@everyfold/core';
import type { Store } from './store.js';
import type { Env } from './env.js';

/** 서버가 만드는 사용자 노출 문구(제안 제목 등). 카테고리 이름은 core CATEGORY_NAMES. */
const MESSAGES = {
  untitledFolder: { en: '(untitled)', ko: '(이름 없음)' },
  newCategory: { en: (name: string) => `New category "${name}"`, ko: (name: string) => `새 카테고리 "${name}"` },
  applyRules: { en: (n: number) => `Sort ${n} unsorted bookmark(s) by rules`, ko: (n: number) => `미분류 ${n}개를 규칙대로 정리` },
  removeEmpty: { en: (n: number) => `Remove ${n} empty categor${n === 1 ? 'y' : 'ies'}`, ko: (n: number) => `빈 카테고리 ${n}개 지우기` },
} as const;

export function t<K extends keyof typeof MESSAGES>(locale: Locale, key: K): (typeof MESSAGES)[K]['en'] {
  return MESSAGES[key][locale] as (typeof MESSAGES)[K]['en'];
}

const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);

/** 서버 로캘: LOCALE var(배포 설정) → 처음 seed 때 정한 값 → en */
export async function serverLocale(store: Store, env: Env): Promise<Locale> {
  if (isLocale(env.LOCALE)) return env.LOCALE;
  const r = await store.db.prepare(`SELECT value FROM settings WHERE key='locale'`).first<{ value: string }>();
  return isLocale(r?.value) ? r.value : 'en';
}

/** 처음 seed 할 때 로캘을 정해 저장한다: LOCALE var → 요청 Accept-Language → en */
export function seedLocale(env: Env, acceptLanguage?: string | null): Locale {
  return isLocale(env.LOCALE) ? env.LOCALE : pickLocale(acceptLanguage);
}

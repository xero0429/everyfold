import { BRAND, pickLocale, type Compat, type Locale } from '@everyfold/core';

/** 팝업 문구 도우미(DOM 없음 — 테스트에서 바로 부른다). 영어 기본. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** 엔진·서버 오류 원문 → 사람이 읽는 한 줄. 원문은 팝업이 작은 글씨로 따로 보여 준다. */
export function friendlyError(raw: string): string {
  if (/^HTTP 401/.test(raw)) return 'The server didn’t accept that token. Check it and try again.';
  if (/^HTTP 403/.test(raw)) return 'This token isn’t allowed to do that.';
  if (/too_large/.test(raw)) return 'That file is too large to import (10 MB max).';
  if (/unknown_format/.test(raw)) return 'That file format isn’t supported.';
  if (/^HTTP 404/.test(raw)) return 'That server doesn’t look like Everyfold. Check the URL.';
  if (/^HTTP 5\d\d/.test(raw)) return 'The server ran into a problem. Try again in a moment.';
  if (/Failed to fetch|NetworkError|Load failed|net::ERR_/i.test(raw)) return 'Can’t reach the server. Check the URL and your connection.';
  if (/^import_pending$/.test(raw)) return 'Your first upload is still being sorted on the server. Everyfold will check again in a few minutes.';
  if (/^request_timeout/.test(raw)) return 'The server didn’t answer in time. Try again in a moment.';
  if (/invalid url|server url/i.test(raw)) return 'Enter a full server URL, like https://everyfold.you.workers.dev';
  if (/not.connected/.test(raw)) return 'This browser isn’t connected.';
  if (/^server_outdated$/.test(raw)) return 'Your server needs an update before this browser can sync.';
  return raw;
}

/** "just now" / "4 minutes ago" / "yesterday" … 일주일이 넘으면 날짜. */
export function relTime(t: number, now = Date.now()): string {
  const s = Math.round((t - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(s) < 45) return 'just now';
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (Math.abs(s) < 7 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(t).toLocaleDateString('en');
}

export function hostOf(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** 팝업의 "서버 업데이트" 안내 링크(README 의 Updating your server) */
export const UPDATE_HELP_URL = `${BRAND.repoUrl}#updating-your-server`;

/** 서버·확장 판이 안 맞을 때 팝업에 띄울 안내. 맞으면 null. 막지 않는 경고가 기본이고 server_blocked 만 동기화를 멈춘다. */
export function compatNotice(compat: Compat | undefined, serverVersion: string | null = null): { tone: 'warn' | 'danger'; title: string; text: string; link: { href: string; label: string } } | null {
  const v = serverVersion ? ` (v${serverVersion})` : '';
  const serverLink = { href: UPDATE_HELP_URL, label: 'How to update your server' };
  switch (compat) {
    case 'server_outdated':
      return {
        tone: 'warn', title: 'Server is out of date',
        text: `Your Everyfold server${v} is older than this extension. Sync still works, but update your server copy on GitHub to get fixes and new features.`,
        link: serverLink,
      };
    case 'server_blocked':
      return {
        tone: 'danger', title: 'Server update required',
        text: `Your Everyfold server${v} is too old for this extension, so syncing is paused to keep your bookmarks safe. Update your server, then press Sync now.`,
        link: serverLink,
      };
    case 'client_outdated':
      return {
        tone: 'warn', title: 'Extension is out of date',
        text: `Your server${v} expects a newer Everyfold extension. Download the latest release zip and unzip it over your Everyfold folder, then reload the extension.`,
        link: { href: `${BRAND.repoUrl}#2-install-the-extension`, label: 'How to update the extension' },
      };
    default:
      return null;
  }
}

/* ───────── 열린 창 저장(세션) — en/ko. 브라우저 UI 언어(i18n.getUILanguage)로 고른다 ───────── */
type SessionErrorCode = 'tabs_permission' | 'sessions_server_outdated' | 'session_empty' | 'session_not_found';

export interface SessionText {
  title: string;
  save: string;
  saveHelp: string;
  saving: string;
  note: string;
  none: string;
  meta: (windows: number, tabs: number) => string;
  saved: (r: { windows: number; tabs: number; skipped: number; synced: boolean }) => string;
  restore: string;
  restoreLabel: (title: string) => string;
  restored: (windows: number) => string;
  del: string;
  delLabel: (title: string) => string;
  delConfirm: string;
  deleted: string;
  errors: Record<SessionErrorCode, string>;
}

export const SESSION_TEXT: Record<Locale, SessionText> = {
  en: {
    title: 'Open windows',
    save: 'Save open windows',
    saveHelp: 'Saves every window’s tabs as a bookmark folder. Reopen them in any connected browser.',
    saving: 'Saving…',
    note: 'Restores page addresses only — not tab history.',
    none: 'No saved windows yet.',
    meta: (w, t) => `${plural(w, 'window')} · ${plural(t, 'tab')}`,
    saved: ({ windows, tabs, skipped, synced }) =>
      `Saved ${plural(windows, 'window')}, ${plural(tabs, 'tab')}` +
      (skipped ? ` · ${skipped} skipped (can’t be bookmarked)` : '') +
      (synced ? '' : ' · saved in this browser, will sync when the server is reachable'),
    restore: 'Restore',
    restoreLabel: (t) => `Restore: ${t}`,
    restored: (w) => `Opened ${plural(w, 'window')}.`,
    del: 'Delete',
    delLabel: (t) => `Delete: ${t}`,
    delConfirm: 'Delete?',
    deleted: 'Deleted.',
    errors: {
      tabs_permission: 'Saving windows needs permission to read your tabs’ addresses. Nothing else changed.',
      sessions_server_outdated: 'Update your server to save windows.',
      session_empty: 'No tabs to save — only web pages (http/https) can be saved.',
      session_not_found: 'That saved window set is gone. It may have been deleted in another browser.',
    },
  },
  ko: {
    title: '열린 창',
    save: '열린 창 저장',
    saveHelp: '창마다 탭 주소를 북마크 폴더로 남깁니다. 연결한 어느 브라우저에서든 다시 엽니다.',
    saving: '저장 중…',
    note: '페이지 주소만 되살립니다(탭 기록은 아님).',
    none: '저장한 창이 아직 없습니다.',
    meta: (w, t) => `창 ${w}개 · 탭 ${t}개`,
    saved: ({ windows, tabs, skipped, synced }) =>
      `창 ${windows}개 · 탭 ${tabs}개 저장` +
      (skipped ? ` · ${skipped}개 건너뜀(북마크로 못 담는 주소)` : '') +
      (synced ? '' : ' · 이 브라우저에 저장됨, 서버에 닿으면 동기화'),
    restore: '복구',
    restoreLabel: (t) => `복구: ${t}`,
    restored: (w) => `창 ${w}개를 열었습니다.`,
    del: '지우기',
    delLabel: (t) => `지우기: ${t}`,
    delConfirm: '지울까요?',
    deleted: '지웠습니다.',
    errors: {
      tabs_permission: '창을 저장하려면 탭 주소를 읽는 권한이 필요합니다. 다른 기능은 그대로입니다.',
      sessions_server_outdated: '창을 저장하려면 서버를 업데이트하세요.',
      session_empty: '저장할 탭이 없습니다 — 웹 페이지(http/https)만 저장됩니다.',
      session_not_found: '그 저장한 창 묶음이 없습니다. 다른 브라우저에서 지웠을 수 있습니다.',
    },
  },
};

export const sessionText = (uiLanguage: string | null | undefined): SessionText => SESSION_TEXT[pickLocale(uiLanguage)];

/** 세션 오류 코드 → 문구(모르는 것은 friendlyError) */
export function sessionError(raw: string, text: SessionText): string {
  return raw in text.errors ? text.errors[raw as SessionErrorCode] : friendlyError(raw);
}

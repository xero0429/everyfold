import { BRAND, type Compat } from '@everyfold/core';

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

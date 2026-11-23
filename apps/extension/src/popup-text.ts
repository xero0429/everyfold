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

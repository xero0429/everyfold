import { describe, expect, it } from 'vitest';
import { isSessionUrl, planSession, SESSION_NAMES, sessionsFolderName, sessionTitle, sessionWindowName } from '../src/sessions.js';

describe('session helpers (#3241)', () => {
  it('only http(s) addresses can be saved — the rest differ per browser (bookmarks.create / windows.create)', () => {
    for (const u of ['https://example.com/', 'http://127.0.0.1:8787/x?y=1#z', 'HTTPS://EXAMPLE.COM']) expect(isSessionUrl(u), u).toBe(true);
    for (const u of [
      'chrome://settings/', 'edge://flags/', 'brave://rewards', 'about:blank', 'about:config', 'file:///etc/hosts', 'chrome-extension://abc/popup.html',
      'moz-extension://abc/x.html', 'javascript:alert(1)', 'data:text/html,x', 'view-source:https://x.example/', 'ftp://ftp.example/', 'https://', '', undefined, null,
      `https://x.example/${'a'.repeat(2050)}`,
    ]) expect(isSessionUrl(u as string), String(u).slice(0, 40)).toBe(false);
  });

  it('plan: skips private and non-normal windows entirely, counts unsavable tabs, drops windows with nothing to save', () => {
    const p = planSession([
      { type: 'normal', tabs: [{ url: 'https://a.example/', title: 'A' }, { url: 'chrome://newtab/' }, { pendingUrl: 'https://b.example/' }] },
      { type: 'normal', incognito: true, tabs: [{ url: 'https://private.example/' }] },
      { type: 'devtools', tabs: [{ url: 'https://dev.example/' }] },
      { type: 'normal', tabs: [{ url: 'about:blank' }, {}] },
      { tabs: [] },
    ]);
    expect(p).toEqual({ windows: [[{ url: 'https://a.example/', title: 'A' }, { url: 'https://b.example/', title: 'https://b.example/' }]], skipped: 3, tabs: 2 });
  });

  it('names: en/ko like the category name table; title = local date/time · device', () => {
    expect(sessionsFolderName('en')).toBe('Sessions');
    expect(sessionsFolderName('ko')).toBe('세션');
    expect(sessionWindowName('en', 2)).toBe('Window 2');
    expect(sessionWindowName('ko', 2)).toBe('창 2');
    expect(Object.keys(SESSION_NAMES).sort()).toEqual(['en', 'ko']);
    expect(sessionTitle(new Date(2026, 0, 5, 7, 3), 'Work laptop')).toBe('2026-01-05 07:03 · Work laptop');
    expect(sessionTitle(new Date(2026, 10, 26, 14, 59), '  ')).toBe('2026-11-26 14:59');
  });
});

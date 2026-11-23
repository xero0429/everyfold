import { describe, expect, it } from 'vitest';
import { compatNotice, friendlyError, hostOf, plural, relTime, UPDATE_HELP_URL } from '../src/popup-text.js';

describe('popup text', () => {
  it('pluralizes', () => {
    expect(plural(1, 'duplicate')).toBe('1 duplicate');
    expect(plural(0, 'duplicate')).toBe('0 duplicates');
    expect(plural(3, 'change')).toBe('3 changes');
  });
  it('maps raw errors to readable lines and keeps unknown ones', () => {
    expect(friendlyError('HTTP 401 unauthorized')).toMatch(/token/);
    expect(friendlyError('HTTP 413 too_large')).toMatch(/10 MB/);
    expect(friendlyError('HTTP 400 unknown_format')).toMatch(/format/);
    expect(friendlyError('HTTP 500 internal')).toMatch(/problem/);
    expect(friendlyError('Failed to fetch')).toMatch(/reach the server/);
    expect(friendlyError('not_connected')).toMatch(/isn’t connected/);
    expect(friendlyError('something odd')).toBe('something odd');
  });
  it('formats relative time', () => {
    const now = 1_700_000_000_000;
    expect(relTime(now - 10_000, now)).toBe('just now');
    expect(relTime(now - 4 * 60_000, now)).toBe('4 minutes ago');
    expect(relTime(now - 3 * 3600_000, now)).toBe('3 hours ago');
    expect(relTime(now - 86400_000, now)).toBe('yesterday');
  });
  it('shows the host of a server URL', () => {
    expect(hostOf('https://everyfold.example.workers.dev/')).toBe('everyfold.example.workers.dev');
    expect(hostOf('http://127.0.0.1:8799')).toBe('127.0.0.1:8799');
    expect(hostOf('not a url')).toBe('not a url');
    expect(hostOf(null)).toBe('');
  });
  it('compat notices: nothing when ok, warn when the server is old, danger only when sync is blocked', () => {
    expect(compatNotice('ok')).toBeNull();
    expect(compatNotice(undefined)).toBeNull();
    expect(compatNotice('server_outdated', '0.1.0')).toMatchObject({ tone: 'warn', title: 'Server is out of date', link: { href: UPDATE_HELP_URL } });
    expect(compatNotice('server_outdated')?.text).toMatch(/Sync still works/);
    expect(compatNotice('server_blocked')).toMatchObject({ tone: 'danger', title: 'Server update required' });
    expect(compatNotice('client_outdated')?.title).toBe('Extension is out of date');
    expect(UPDATE_HELP_URL).toMatch(/#updating-your-server$/);
    expect(friendlyError('server_outdated')).toMatch(/needs an update/);
  });
});

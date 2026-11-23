import { describe, expect, it } from 'vitest';
import { groupDuplicates, hostOf, isImportableUrl, isSameBookmark, normalizeUrl } from '../src/index.js';

describe('normalizeUrl', () => {
  it('lowercases scheme and host, keeps path case', () => {
    expect(normalizeUrl('HTTPS://GitHub.COM/Foo/Bar')).toBe('https://github.com/Foo/Bar');
  });
  it('strips trailing slash and treats root as empty path', () => {
    expect(normalizeUrl('https://a.com/')).toBe('https://a.com');
    expect(normalizeUrl('https://a.com')).toBe('https://a.com');
    expect(normalizeUrl('https://a.com/x/')).toBe('https://a.com/x');
    expect(normalizeUrl('https://a.com/x//')).toBe('https://a.com/x');
  });
  it('removes default ports', () => {
    expect(normalizeUrl('http://a.com:80/p')).toBe('http://a.com/p');
    expect(normalizeUrl('https://a.com:443/p')).toBe('https://a.com/p');
    expect(normalizeUrl('https://a.com:8443/p')).toBe('https://a.com:8443/p');
  });
  it('removes tracking params and sorts the rest', () => {
    expect(normalizeUrl('https://a.com/p?utm_source=x&b=2&UTM_Medium=y&a=1&fbclid=z&gclid=q')).toBe('https://a.com/p?a=1&b=2');
    expect(normalizeUrl('https://a.com/p?utm_campaign=x')).toBe('https://a.com/p');
    expect(normalizeUrl('https://a.com/p?k=2&k=1')).toBe('https://a.com/p?k=2&k=1');
  });
  it('drops plain fragments, keeps SPA routes', () => {
    expect(normalizeUrl('https://a.com/doc#section-2')).toBe('https://a.com/doc');
    expect(normalizeUrl('https://a.com/doc#:~:text=hello')).toBe('https://a.com/doc');
    expect(normalizeUrl('https://app.com/#/inbox/1')).toBe('https://app.com#/inbox/1');
    expect(normalizeUrl('https://app.com/#!/x')).toBe('https://app.com#!/x');
  });
  it('handles IDN and non-http schemes', () => {
    expect(normalizeUrl('https://한글.kr/')).toBe('https://xn--bj0bj06e.kr');
    expect(normalizeUrl('JavaScript:alert(1)')).toBe('javascript:alert(1)');
    expect(normalizeUrl('  not a url  ')).toBe('not a url');
    expect(normalizeUrl('')).toBe('');
  });
  it('hostOf strips www', () => {
    expect(hostOf('https://www.YouTube.com/watch')).toBe('youtube.com');
    expect(hostOf('place:foo')).toBeNull();
  });
});

describe('duplicates', () => {
  it('isSameBookmark across tracking/trailing slash/case', () => {
    expect(isSameBookmark('https://GITHUB.com', 'https://github.com/?utm_source=x')).toBe(true);
    expect(isSameBookmark('https://a.com/x', 'https://a.com/y')).toBe(false);
  });
  it('groups and keeps titled, earliest item', () => {
    const items = [
      { url: 'https://a.com/', title: '', addDate: 1 },
      { url: 'https://A.com?utm_source=1', title: 'A', addDate: 5 },
      { url: 'https://b.com', title: 'B' },
      { url: 'https://a.com#x', title: 'A2', addDate: 3 },
    ];
    const groups = groupDuplicates(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.key).toBe('https://a.com');
    expect(groups[0]!.keep.title).toBe('A2');
    expect(groups[0]!.duplicates.map((d) => d.title).sort()).toEqual(['', 'A']);
    expect(groups[1]!.duplicates).toEqual([]);
  });
});

describe('isImportableUrl', () => {
  it('accepts web and other plain schemes', () => {
    for (const u of ['https://a.com', 'http://a.com/x', 'ftp://f.example/a', 'file:///Users/me/a.pdf', 'chrome://settings']) expect(isImportableUrl(u)).toBe(true);
  });
  it('rejects code-running / internal / schemeless links', () => {
    for (const u of ['javascript:alert(1)', ' JavaScript:void(0)', 'vbscript:msgbox', 'data:text/html,<script>x</script>', 'place:sort=8', 'example.com', ''])
      expect(isImportableUrl(u)).toBe(false);
  });
});

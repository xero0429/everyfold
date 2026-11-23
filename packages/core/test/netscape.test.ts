import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeEntities, flattenBookmarks, groupDuplicates, parseNetscapeHtml } from '../src/index.js';

const fx = (n: string) => readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)), 'utf8');

describe('Netscape bookmark HTML', () => {
  it('parses a Chrome export', () => {
    const f = parseNetscapeHtml(fx('chrome.html'));
    expect(f.title).toBe('Bookmarks');
    expect(f.root.children.map((c) => c.title)).toEqual(['Bookmarks bar', 'Other bookmarks']);
    const bar = f.root.children[0]!;
    expect(bar.type === 'folder' && bar.special).toBe('toolbar');
    const flat = flattenBookmarks(f.root);
    expect(flat).toHaveLength(6);
    expect(flat[1]).toMatchObject({ title: 'Video & Music', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=share', addDate: 1700000002000 });
    expect(flat[2]!.path).toEqual(['Bookmarks bar', 'Dev']);
    expect(flat[5]!.title).toBe('한글 제목');
    // 중복: github.com 이 두 번
    const dups = groupDuplicates(flat).filter((g) => g.duplicates.length);
    expect(dups).toHaveLength(1);
    expect(dups[0]!.key).toBe('https://github.com');
  });

  it('parses a Firefox export (place: skipped, tags, DD, unfiled)', () => {
    const f = parseNetscapeHtml(fx('firefox.html'));
    expect(f.root.title).toBe('Bookmarks Menu');
    expect(f.skipped).toBe(1);
    const flat = flattenBookmarks(f.root);
    expect(flat.map((b) => b.title)).toEqual(['Get Help', 'About Us', 'Rust Programming Language', 'Hacker News', '쿠팡 상품']);
    const rust = flat[2]!;
    expect(rust.tags).toEqual(['dev', 'rust']);
    expect(rust.description).toBe('A language empowering everyone');
    expect(rust.path).toEqual(['Bookmarks Toolbar']);
    const other = f.root.children.find((c) => c.title === 'Other Bookmarks');
    expect(other?.type === 'folder' && other.special).toBe('unfiled');
  });

  it('parses an Edge export (nested + empty folder)', () => {
    const f = parseNetscapeHtml(fx('edge.html'));
    const flat = flattenBookmarks(f.root);
    expect(flat.map((b) => b.path.join('/'))).toEqual(['Favorites bar', 'Favorites bar/Travel', 'Other favorites']);
    const travel = f.root.children[0]!.type === 'folder' ? f.root.children[0]!.children[1] : undefined;
    expect(travel?.type === 'folder' && travel.children.map((c) => c.title)).toEqual(['Booking', 'Empty']);
  });

  it('decodes entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#39; &#x1F600; &unknown;')).toBe("a & b <c> 'd' 😀 &unknown;");
  });

  it('tolerates junk', () => {
    expect(flattenBookmarks(parseNetscapeHtml('').root)).toEqual([]);
    expect(flattenBookmarks(parseNetscapeHtml('<DT><A HREF="https://x.com">x</A>').root)).toHaveLength(1);
  });
});

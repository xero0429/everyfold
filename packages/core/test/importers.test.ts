import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCsv, parseImportFile } from '../src/index.js';

const fx = (n: string) => readFileSync(fileURLToPath(new URL(`./fixtures/import/${n}`, import.meta.url)), 'utf8');
const brief = (items: Array<{ url: string; title: string; path: string[] }>) => items.map((i) => `${i.path.join('/')}|${i.title}|${i.url}`);

describe('import formats', () => {
  it('Floccus XBEL', () => {
    const r = parseImportFile(fx('floccus.xbel'))!;
    expect(r.format).toBe('xbel');
    expect(brief(r.items)).toEqual([
      'Development|JavaScript | MDN|https://developer.mozilla.org/en-US/docs/Web/JavaScript',
      'Development/Tools & Libraries|TypeScript Documentation|https://www.typescriptlang.org/docs/',
      'Development/Tools & Libraries|Search: "xbel"|https://example.com/search?q=xbel&lang=en',
      'Reading|MDN JavaScript (duplicate)|https://developer.mozilla.org/en-US/docs/Web/JavaScript',
      'Reading|https://example.org/articles/bookmark-sync|https://example.org/articles/bookmark-sync',
      '|Top-level bookmark|https://example.net/',
    ]);
  });

  it('Floccus HTML (Netscape + TAGS)', () => {
    const r = parseImportFile(fx('floccus.html'))!;
    expect(r.format).toBe('netscape');
    expect(r.items).toHaveLength(6);
    expect(r.items[0]).toMatchObject({ tags: ['js', 'docs'], path: ['Development'] });
  });

  it('Karakeep JSON: lists → nested path, text notes skipped', () => {
    const r = parseImportFile(fx('karakeep.json'))!;
    expect(r.format).toBe('karakeep');
    expect(r.skipped).toBe(1);
    expect(brief(r.items)).toEqual([
      'Development|JavaScript | MDN|https://developer.mozilla.org/en-US/docs/Web/JavaScript',
      'Development/Tools & Libraries|https://www.typescriptlang.org/docs/|https://www.typescriptlang.org/docs/',
      '|Top-level bookmark|https://example.net/',
    ]);
    expect(r.items[0]).toMatchObject({ tags: ['js', 'docs'], addDate: 1700000000000 });
  });

  it('Linkwarden JSON: parentId → nested path, tags objects, url-less skipped', () => {
    const r = parseImportFile(fx('linkwarden.json'))!;
    expect(r.format).toBe('linkwarden');
    expect(r.skipped).toBe(1);
    expect(brief(r.items)).toEqual([
      'Development|JavaScript | MDN|https://developer.mozilla.org/en-US/docs/Web/JavaScript',
      'Development/Tools & Libraries|https://www.typescriptlang.org/docs/|https://www.typescriptlang.org/docs/',
    ]);
    expect(r.items[0]).toMatchObject({ tags: ['js'], addDate: Date.parse('2023-11-14T22:13:20.000Z') });
  });

  it('Raindrop CSV: quoted fields, multiline, a/b folders, unix + ISO dates', () => {
    const r = parseImportFile(fx('raindrop.csv'))!;
    expect(r.format).toBe('raindrop-csv');
    expect(r.skipped).toBe(1);
    expect(brief(r.items)).toEqual([
      'Development|JavaScript | MDN|https://developer.mozilla.org/en-US/docs/Web/JavaScript',
      'Development/Tools & Libraries|Search: "xbel"|https://example.com/search?q=xbel&lang=en',
      'Unsorted|https://example.net/|https://example.net/',
    ]);
    expect(r.items[0]!.tags).toEqual(['js', 'docs']);
    expect(r.items[1]).toMatchObject({ addDate: 1700000100000, description: 'multi\nline note' });
  });

  it('Raindrop HTML', () => {
    const r = parseImportFile(fx('raindrop.html'))!;
    expect(r.format).toBe('netscape');
    expect(brief(r.items)).toEqual(['Development|JavaScript | MDN|https://developer.mozilla.org/en-US/docs/Web/JavaScript', '|Top-level bookmark|https://example.net/']);
  });

  it('unknown → null; csv edge cases', () => {
    expect(parseImportFile('{"foo":1}')).toBeNull();
    expect(parseImportFile('hello')).toBeNull();
    expect(parseCsv('a,"b,c"\r\n"d""e",f')).toEqual([['a', 'b,c'], ['d"e', 'f']]);
  });
});

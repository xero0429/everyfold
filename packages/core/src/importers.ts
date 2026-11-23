import { isImportableUrl } from './normalize.js';
import { decodeEntities, flattenBookmarks, parseNetscapeHtml, type FlatBookmark } from './netscape.js';

/**
 * 다른 북마크 도구의 내보내기 파일 → FlatBookmark[] (url·title·path·tags·addDate).
 * 형식 근거(2026-11 확인):
 *  · Floccus: XBEL 1.0(파일 동기화 형식) 또는 Netscape HTML(TAGS 속성) — HTML 은 parseNetscapeHtml 이 그대로 읽는다.
 *  · Karakeep: packages/shared/import-export/exporters.ts zExportSchema — { bookmarks[{createdAt(s), title, tags[], lists[id], content{type,url}}], lists[{id,name,parentId}] }
 *  · Linkwarden: apps/web/lib/api/controllers/migration/exportData.ts — { collections[{id,name,parentId,links[{name,url,createdAt,tags[{name}]}]}] }
 *  · Raindrop.io: CSV(헤더 이름으로 읽음 — 내보내기 열 순서는 공식 문서에 없음; url·title·folder(a/b)·tags("a, b")·created(유닉스초|ISO)) 또는 Netscape HTML.
 */
export type ImportFormat = 'netscape' | 'xbel' | 'karakeep' | 'linkwarden' | 'raindrop-csv';

export interface ImportParse {
  format: ImportFormat;
  items: FlatBookmark[];
  skipped: number;
}

const bm = (url: string, title: string, path: string[], extra: { tags?: string[]; addDate?: number; description?: string } = {}): FlatBookmark => ({
  type: 'bookmark', url, title, path,
  ...(extra.tags && extra.tags.length ? { tags: extra.tags } : {}),
  ...(extra.addDate !== undefined && Number.isFinite(extra.addDate) ? { addDate: extra.addDate } : {}),
  ...(extra.description ? { description: extra.description } : {}),
});

const toMs = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v === 'string' && v.trim()) {
    if (/^\d+$/.test(v.trim())) return toMs(Number(v.trim()));
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : t;
  }
  return undefined;
};

/* ───────── XBEL (Floccus) ───────── */
export function parseXbel(xml: string): ImportParse {
  const items: FlatBookmark[] = [];
  const stack: string[] = [];
  let skipped = 0;
  let inFolderTitle = false; // 다음 <title> 이 폴더 이름
  type Cur = { url: string; title: string; addDate?: number };
  let cur = null as Cur | null;
  const re = /<(\/?)(folder|bookmark|title|separator|desc)\b([^>]*?)(\/?)>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/gi;
  let m: RegExpExecArray | null;
  const attr = (a: string, name: string) => {
    const r = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(a);
    return r ? decodeEntities(r[2] ?? r[3] ?? '') : undefined;
  };
  while ((m = re.exec(xml))) {
    const [, close, tag0, attrs = '', selfClose] = m;
    if (!tag0) continue;
    const tag = tag0.toLowerCase();
    if (tag === 'folder' && !close) {
      stack.push('');
      inFolderTitle = true;
      if (selfClose) stack.pop();
    } else if (tag === 'folder' && close) {
      stack.pop();
    } else if (tag === 'bookmark' && !close) {
      const href = attr(attrs, 'href');
      const added = attr(attrs, 'added');
      if (!href || !isImportableUrl(href)) {
        skipped++;
        cur = null;
      } else {
        const addDate = added ? toMs(added) : undefined;
        cur = { url: href, title: '', ...(addDate !== undefined ? { addDate } : {}) };
      }
      inFolderTitle = false;
      if (selfClose && cur) {
        items.push(bm(cur.url, cur.title || cur.url, stack.filter(Boolean), { ...(cur.addDate ? { addDate: cur.addDate } : {}) }));
        cur = null;
      }
    } else if (tag === 'bookmark' && close) {
      if (cur) items.push(bm(cur.url, cur.title || cur.url, stack.filter(Boolean), { ...(cur.addDate ? { addDate: cur.addDate } : {}) }));
      cur = null;
    } else if (tag === 'title' && !close && !selfClose) {
      const end = xml.indexOf('</title>', re.lastIndex);
      const text = decodeEntities(xml.slice(re.lastIndex, end < 0 ? undefined : end).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
      if (cur) cur.title = text;
      else if (inFolderTitle && stack.length) stack[stack.length - 1] = text;
      inFolderTitle = false;
      if (end >= 0) re.lastIndex = end + '</title>'.length;
    } else if (tag === 'desc' && !close && !selfClose) {
      const end = xml.indexOf('</desc>', re.lastIndex);
      if (end >= 0) re.lastIndex = end + '</desc>'.length;
    }
  }
  return { format: 'xbel', items, skipped };
}

/* ───────── Karakeep JSON ───────── */
export function parseKarakeep(data: any): ImportParse {
  const lists = new Map<string, { name: string; parentId: string | null }>();
  for (const l of Array.isArray(data?.lists) ? data.lists : []) if (l?.id) lists.set(String(l.id), { name: String(l.name ?? ''), parentId: l.parentId ? String(l.parentId) : null });
  const pathOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur && lists.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      const l: { name: string; parentId: string | null } = lists.get(cur)!;
      out.unshift(l.name);
      cur = l.parentId;
    }
    return out;
  };
  const items: FlatBookmark[] = [];
  let skipped = 0;
  for (const b of Array.isArray(data?.bookmarks) ? data.bookmarks : []) {
    const url = b?.content?.url;
    if (typeof url !== 'string' || !url) {
      skipped++; // 텍스트 메모 등
      continue;
    }
    const listId = Array.isArray(b.lists) && b.lists.length ? String(b.lists[0]) : null;
    items.push(bm(url, String(b.title ?? '') || url, listId ? pathOf(listId) : [], {
      tags: Array.isArray(b.tags) ? b.tags.map(String) : [], ...(b.createdAt != null ? { addDate: toMs(b.createdAt) } : {}),
      ...(b.note ? { description: String(b.note) } : {}),
    }));
  }
  return { format: 'karakeep', items, skipped };
}

/* ───────── Linkwarden JSON ───────── */
export function parseLinkwarden(data: any): ImportParse {
  const cols = Array.isArray(data?.collections) ? data.collections : [];
  const byId = new Map<string, any>(cols.map((c: any) => [String(c.id), c]));
  const pathOf = (c: any): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    while (c && !seen.has(String(c.id))) {
      seen.add(String(c.id));
      out.unshift(String(c.name ?? ''));
      c = c.parentId != null ? byId.get(String(c.parentId)) : undefined;
    }
    return out;
  };
  const items: FlatBookmark[] = [];
  let skipped = 0;
  for (const c of cols) {
    const path = pathOf(c);
    for (const l of Array.isArray(c.links) ? c.links : []) {
      if (typeof l?.url !== 'string' || !l.url) {
        skipped++;
        continue;
      }
      items.push(bm(l.url, String(l.name ?? '') || l.url, path, {
        tags: Array.isArray(l.tags) ? l.tags.map((t: any) => String(t?.name ?? t)).filter(Boolean) : [],
        ...(l.createdAt ? { addDate: toMs(l.createdAt) } : {}), ...(l.description ? { description: String(l.description) } : {}),
      }));
    }
  }
  return { format: 'linkwarden', items, skipped };
}

/* ───────── CSV (RFC 4180) ───────── */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim()));
}

export function parseRaindropCsv(text: string): ImportParse {
  const [header, ...rows] = parseCsv(text);
  const idx = (n: string) => (header ?? []).findIndex((h) => h.trim().toLowerCase() === n);
  const iu = idx('url'), it = idx('title'), iF = idx('folder'), iT = idx('tags'), iC = idx('created'), iN = idx('note');
  if (iu < 0) return { format: 'raindrop-csv', items: [], skipped: rows.length };
  const items: FlatBookmark[] = [];
  let skipped = 0;
  for (const r of rows) {
    const url = (r[iu] ?? '').trim();
    if (!isImportableUrl(url)) {
      skipped++;
      continue;
    }
    const folder = iF >= 0 ? (r[iF] ?? '') : '';
    const path = folder.split('/').map((p) => p.trim()).filter(Boolean);
    const tags = iT >= 0 ? (r[iT] ?? '').split(',').map((t) => t.trim()).filter(Boolean) : [];
    items.push(bm(url, (it >= 0 ? (r[it] ?? '').trim() : '') || url, path, {
      tags, ...(iC >= 0 ? { addDate: toMs(r[iC]) } : {}), ...(iN >= 0 && r[iN] ? { description: r[iN] } : {}),
    }));
  }
  return { format: 'raindrop-csv', items, skipped };
}

/** 내용으로 형식을 알아내 파싱한다. 모르면 null. */
export function parseImportFile(text: string, hint?: ImportFormat): ImportParse | null {
  const t = text.replace(/^﻿/, '').trimStart();
  const fmt: ImportFormat | null = hint ?? (
    /^<\?xml[\s\S]{0,400}<xbel\b|^<!DOCTYPE xbel|^<xbel\b/i.test(t) ? 'xbel'
      : /^<!DOCTYPE NETSCAPE-Bookmark-file|<DL>/i.test(t) ? 'netscape'
        : t.startsWith('{') ? null
          : /^[^\n]*\burl\b/i.test(t) ? 'raindrop-csv' : null);
  if (fmt === 'netscape') {
    const f = parseNetscapeHtml(text);
    return { format: 'netscape', items: flattenBookmarks(f.root), skipped: f.skipped };
  }
  if (fmt === 'xbel') return parseXbel(text);
  if (fmt === 'raindrop-csv') return parseRaindropCsv(text);
  let data: any;
  try {
    data = JSON.parse(t);
  } catch {
    return null;
  }
  if (fmt === 'karakeep' || (!fmt && Array.isArray(data?.bookmarks))) return parseKarakeep(data);
  if (fmt === 'linkwarden' || (!fmt && Array.isArray(data?.collections))) return parseLinkwarden(data);
  return null;
}

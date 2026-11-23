/**
 * Netscape Bookmark File(브라우저 "북마크 내보내기" HTML) 파서.
 * Chrome·Edge·Firefox·Safari 가 같은 형식(DL/DT/H3/A)을 쓴다. DOM 없이 동작한다(Workers·Node·확장 공용).
 *
 * - 폴더: <DT><H3 ...>이름</H3> 다음에 오는 <DL> … </DL>
 * - 북마크: <DT><A HREF="…" ADD_DATE="…" …>제목</A>
 * - 설명: 바로 뒤의 <DD>텍스트
 * - Firefox 의 place: (스마트 북마크) 와 빈 HREF 는 건너뛴다.
 */
export interface ParsedBookmark {
  type: 'bookmark';
  title: string;
  url: string;
  addDate?: number; // epoch ms
  tags?: string[];
  description?: string;
}

export interface ParsedFolder {
  type: 'folder';
  title: string;
  addDate?: number;
  /** 브라우저의 특수 폴더 표시(북마크바 / 기타 북마크) */
  special?: 'toolbar' | 'unfiled';
  children: Array<ParsedFolder | ParsedBookmark>;
}

export interface ParsedFile {
  title: string;
  root: ParsedFolder;
  skipped: number;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body.toLowerCase()] ?? m;
  });
}

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out[m[1]!.toUpperCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function epochMs(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  // 내보내기 파일은 초 단위가 일반적. Firefox 일부 버전은 마이크로초.
  if (n > 1e14) return Math.floor(n / 1000);
  if (n > 1e11) return Math.floor(n);
  return Math.floor(n * 1000);
}

const TAG_RE = /<(\/?)(dl|dt|dd|h1|h3|a|p|title)\b([^>]*)>/gi;

export function parseNetscapeHtml(html: string): ParsedFile {
  const root: ParsedFolder = { type: 'folder', title: '', children: [] };
  const stack: ParsedFolder[] = [];
  let pendingFolder: ParsedFolder | null = null;
  let last: ParsedFolder | ParsedBookmark | null = null;
  let docTitle = '';
  let skipped = 0;
  let sawRootDl = false;

  const textUntil = (from: number, closeTag: string): { text: string; end: number } => {
    const re = new RegExp(`</${closeTag}\\s*>`, 'i');
    const rest = html.slice(from);
    const m = re.exec(rest);
    if (!m) return { text: decodeEntities(rest.replace(/<[^>]*>/g, '')).trim(), end: html.length };
    return { text: decodeEntities(rest.slice(0, m.index).replace(/<[^>]*>/g, '')).trim(), end: from + m.index + m[0].length };
  };

  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(html))) {
    const closing = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    const attrs = m[3] ?? '';
    const after = m.index + m[0].length;
    if (closing) {
      if (tag === 'dl') stack.pop();
      continue;
    }
    switch (tag) {
      case 'title': {
        const t = textUntil(after, 'title');
        docTitle = t.text;
        TAG_RE.lastIndex = t.end;
        break;
      }
      case 'h1': {
        const t = textUntil(after, 'h1');
        if (!root.title) root.title = t.text;
        TAG_RE.lastIndex = t.end;
        break;
      }
      case 'h3': {
        const a = parseAttrs(attrs);
        const t = textUntil(after, 'h3');
        const folder: ParsedFolder = { type: 'folder', title: t.text, children: [] };
        const add = epochMs(a.ADD_DATE);
        if (add) folder.addDate = add;
        if (a.PERSONAL_TOOLBAR_FOLDER === 'true') folder.special = 'toolbar';
        else if (a.UNFILED_BOOKMARKS_FOLDER === 'true') folder.special = 'unfiled';
        const parent = stack[stack.length - 1] ?? root;
        parent.children.push(folder);
        pendingFolder = folder;
        last = folder;
        TAG_RE.lastIndex = t.end;
        break;
      }
      case 'dl': {
        if (pendingFolder) {
          stack.push(pendingFolder);
          pendingFolder = null;
        } else if (!sawRootDl) {
          stack.push(root);
          sawRootDl = true;
        } else {
          // 제목 없는 중첩 DL — 현재 폴더에 그대로 붙인다
          stack.push(stack[stack.length - 1] ?? root);
        }
        break;
      }
      case 'a': {
        const a = parseAttrs(attrs);
        const t = textUntil(after, 'a');
        TAG_RE.lastIndex = t.end;
        const href = (a.HREF ?? '').trim();
        if (!href || /^place:/i.test(href)) {
          skipped++;
          last = null;
          break;
        }
        const bm: ParsedBookmark = { type: 'bookmark', title: t.text, url: href };
        const add = epochMs(a.ADD_DATE);
        if (add) bm.addDate = add;
        if (a.TAGS) bm.tags = a.TAGS.split(',').map((s) => s.trim()).filter(Boolean);
        (stack[stack.length - 1] ?? root).children.push(bm);
        last = bm;
        break;
      }
      case 'dd': {
        const end = html.indexOf('<', after);
        const text = decodeEntities(html.slice(after, end < 0 ? undefined : end)).trim();
        if (last && last.type === 'bookmark' && text) last.description = text;
        break;
      }
      default:
        break;
    }
  }
  return { title: docTitle || root.title, root, skipped };
}

export interface FlatBookmark extends ParsedBookmark {
  /** 루트부터의 폴더 경로(파일 루트 제외) */
  path: string[];
}

export function flattenBookmarks(folder: ParsedFolder, path: string[] = []): FlatBookmark[] {
  const out: FlatBookmark[] = [];
  for (const c of folder.children) {
    if (c.type === 'bookmark') out.push({ ...c, path });
    else out.push(...flattenBookmarks(c, [...path, c.title]));
  }
  return out;
}

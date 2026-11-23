import { clampTitle, flattenBookmarks, groupDuplicates, isImportableUrl, MAX_URL_LENGTH, parseImportFile, parseNetscapeHtml, type ImportFormat } from '@everyfold/core';
import { Store, type NodeState } from './store.js';
import { addNewCategorySuggestion, classifyWithContext } from './categorize.js';
import type { Env } from './env.js';

export interface ImportItem {
  url: string;
  title?: string;
  path?: string[];
  addDate?: number;
}

export interface ImportResult {
  batchId: string;
  received: number;
  created: number;
  mergedExisting: number;
  mergedInFile: number;
  /** 스킴이 없거나 위험한(javascript:/data: 등) URL 이라 건너뛴 수 */
  skippedUnsafe: number;
  byCategory: Record<string, number>;
  suggestions: string[];
  llmUsed: boolean;
  llmError?: string;
}

/**
 * 가져오기: 브라우저 북마크 전체(첫 연결) 또는 내보내기 파일.
 * 1) 파일 안 중복 합치기 2) 서버에 이미 있는 것 합치기 3) 나머지 분류 → 카테고리 폴더에 생성.
 * 모든 생성은 한 batchId 로 묶여 /changes/undo 로 통째 되돌릴 수 있다.
 */
/** /import 본문 상한 — Workers 메모리(128MB) 안에서 파싱·분류까지 버티는 크기. 큰 라이브러리도 수십만 개 북마크가 이 안에 든다. */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

export class UnknownFormatError extends Error {}

export async function importItems(
  store: Store, env: Env, deviceId: string, input: { html?: string; file?: string; format?: ImportFormat; items?: ImportItem[] },
): Promise<ImportResult> {
  let items: ImportItem[] = [];
  if (typeof input.html === 'string') items = flattenBookmarks(parseNetscapeHtml(input.html).root);
  if (typeof input.file === 'string') {
    // 다른 도구 내보내기: Netscape HTML · Floccus XBEL · Karakeep JSON · Linkwarden JSON · Raindrop CSV
    const parsed = parseImportFile(input.file, input.format);
    if (!parsed) throw new UnknownFormatError('unknown_format');
    items = items.concat(parsed.items);
  }
  if (Array.isArray(input.items)) items = items.concat(input.items.filter((i) => i && typeof i.url === 'string'));
  const received = items.length;
  const safe = items.filter((i) => typeof i.url === 'string' && i.url.length <= MAX_URL_LENGTH && isImportableUrl(i.url));
  const skippedUnsafe = received - safe.length;
  items = safe;

  const groups = groupDuplicates(items.map((i) => ({ ...i, title: i.title ?? '' })));
  const mergedInFile = groups.reduce((n, g) => n + g.duplicates.length, 0);

  const existing = new Set(
    (await store.db.prepare(`SELECT norm_url FROM nodes WHERE kind='bookmark' AND deleted=0`).all<{ norm_url: string }>()).results.map((r) => r.norm_url),
  );
  const fresh = groups.filter((g) => !existing.has(g.key));
  const mergedExisting = groups.length - fresh.length;

  const { results, inboxId, folders, llmUsed, llmError } = await classifyWithContext(
    store, env, fresh.map((g, i) => ({ id: String(i), url: g.keep.url, title: g.keep.title ?? '' })),
  );

  const batchId = crypto.randomUUID();
  const writes: Array<{ after: NodeState; before: null; op: string }> = [];
  // 위치는 부모별 최댓값을 한 번에 읽어 메모리에서 늘린다(D1 호출 수)
  const maxPos = new Map<string | null, number>(
    (await store.db.prepare(`SELECT parent_id AS p, MAX(position) AS m FROM nodes WHERE deleted=0 GROUP BY parent_id`).all<{ p: string | null; m: number }>()).results.map((r) => [r.p, r.m]),
  );
  const posFor = (parent: string | null) => {
    const p = (maxPos.get(parent) ?? -1) + 1;
    maxPos.set(parent, p);
    return p;
  };

  // 원본 폴더 구조 재현용: (부모, 이름) → 폴더 id. 기존 폴더와 같은 이름이면 합친다.
  const folderKey = (parent: string | null, title: string) => `${parent ?? ''}\u0000${title.trim().toLowerCase()}`;
  const folderIndex = new Map(folders.map((f) => [folderKey(f.parent_id, f.title), f.id]));
  const names = new Map(folders.map((f) => [f.id, f.title]));
  const categoryByName = new Map(folders.filter((f) => f.parent_id === null).map((f) => [f.title.trim().toLowerCase(), f.id]));
  const ensurePath = (path: readonly string[]): string | null => {
    let parent: string | null = null;
    for (const raw of path) {
      const title = clampTitle(raw.trim());
      if (!title) continue;
      const k = folderKey(parent, title);
      let id = folderIndex.get(k);
      if (!id) {
        id = crypto.randomUUID();
        writes.push({ after: { id, kind: 'folder', parentId: parent, title, url: null, position: posFor(parent), deleted: false }, before: null, op: 'import' });
        folderIndex.set(k, id);
        names.set(id, title);
      }
      parent = id;
    }
    return parent;
  };
  /** 규칙·학습·LLM 이 못 정한 항목의 자리: 말단 폴더 이름이 기존 카테고리와 같으면 거기, 아니면 원본 경로 그대로, 경로가 없으면 미분류 */
  const placeUnsorted = (path: readonly string[] | undefined): string | null => {
    const p = stripContainers(path ?? []);
    if (!p.length) return inboxId;
    const leaf = categoryByName.get(p[p.length - 1]!.trim().toLowerCase());
    if (leaf) return leaf;
    return ensurePath(p);
  };

  const byCategory: Record<string, number> = {};
  const pendingSuggest = new Map<string, string[]>();
  let created = 0;
  for (let i = 0; i < fresh.length; i++) {
    const g = fresh[i]!;
    const c = results[i]!;
    const parentId = c.categoryId ?? placeUnsorted(g.keep.path);
    const id = crypto.randomUUID();
    writes.push({ after: { id, kind: 'bookmark', parentId, title: clampTitle(g.keep.title), url: g.keep.url, position: posFor(parentId), deleted: false }, before: null, op: 'import' });
    created++;
    const label = parentId ? names.get(parentId) ?? parentId : '(root)';
    byCategory[label] = (byCategory[label] ?? 0) + 1;
    if (c.suggestedCategory) pendingSuggest.set(c.suggestedCategory, [...(pendingSuggest.get(c.suggestedCategory) ?? []), id]);
  }
  await store.writeMany(writes, deviceId, batchId);
  const suggestions: string[] = [];
  for (const [name, ids] of pendingSuggest) suggestions.push(await addNewCategorySuggestion(store, env, name, ids));
  return { batchId, received, created, mergedExisting, mergedInFile, skippedUnsafe, byCategory, suggestions, llmUsed, ...(llmError ? { llmError } : {}) };
}

/** 브라우저 최상위 컨테이너(북마크바·기타 북마크 등)는 폴더로 재현하지 않는다 — 그 안의 사용자 폴더부터 */
const CONTAINER = /^(bookmarks bar|bookmarks toolbar|bookmarks menu|other bookmarks|mobile bookmarks|favorites bar|favourites bar|favorites|toolbar|menu|unfiled|unsorted bookmarks|북마크바|북마크 바|북마크 메뉴|북마크 도구 모음|기타 북마크|모바일 북마크|즐겨찾기 표시줄|즐겨찾기 모음)$/i;
export function stripContainers(path: readonly string[]): string[] {
  const p = path.map((x) => x.trim()).filter(Boolean);
  return p.length && CONTAINER.test(p[0]!) ? p.slice(1) : p;
}

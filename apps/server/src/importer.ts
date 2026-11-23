import { flattenBookmarks, groupDuplicates, parseNetscapeHtml } from '@everyfold/core';
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
export async function importItems(store: Store, env: Env, deviceId: string, input: { html?: string; items?: ImportItem[] }): Promise<ImportResult> {
  let items: ImportItem[] = [];
  if (typeof input.html === 'string') items = flattenBookmarks(parseNetscapeHtml(input.html).root);
  if (Array.isArray(input.items)) items = items.concat(input.items.filter((i) => i && typeof i.url === 'string'));
  const received = items.length;

  const groups = groupDuplicates(items.map((i) => ({ ...i, title: i.title ?? '' })));
  const mergedInFile = groups.reduce((n, g) => n + g.duplicates.length, 0);

  const existing = new Set(
    (await store.db.prepare(`SELECT norm_url FROM nodes WHERE kind='bookmark' AND deleted=0`).all<{ norm_url: string }>()).results.map((r) => r.norm_url),
  );
  const fresh = groups.filter((g) => !existing.has(g.key) && /^[a-z][a-z0-9+.-]*:/i.test(g.keep.url));
  const mergedExisting = groups.length - fresh.length;

  const { results, inboxId, llmUsed, llmError } = await classifyWithContext(
    store, env, fresh.map((g, i) => ({ id: String(i), url: g.keep.url, title: g.keep.title ?? '' })),
  );

  const batchId = crypto.randomUUID();
  const nextPos = new Map<string | null, number>();
  const posFor = async (parent: string | null) => {
    if (!nextPos.has(parent)) nextPos.set(parent, await store.nextPosition(parent));
    const p = nextPos.get(parent)!;
    nextPos.set(parent, p + 1);
    return p;
  };
  const writes: Array<{ after: NodeState; before: null; op: string }> = [];
  const byCategory: Record<string, number> = {};
  const pendingSuggest = new Map<string, string[]>();
  const names = new Map((await store.liveFolders()).map((f) => [f.id, f.title]));
  for (let i = 0; i < fresh.length; i++) {
    const g = fresh[i]!;
    const c = results[i]!;
    const parentId = c.categoryId ?? inboxId;
    const id = crypto.randomUUID();
    writes.push({ after: { id, kind: 'bookmark', parentId, title: g.keep.title ?? '', url: g.keep.url, position: await posFor(parentId), deleted: false }, before: null, op: 'import' });
    const label = parentId ? names.get(parentId) ?? parentId : '(root)';
    byCategory[label] = (byCategory[label] ?? 0) + 1;
    if (c.suggestedCategory) pendingSuggest.set(c.suggestedCategory, [...(pendingSuggest.get(c.suggestedCategory) ?? []), id]);
  }
  await store.writeMany(writes, deviceId, batchId);
  const suggestions: string[] = [];
  for (const [name, ids] of pendingSuggest) suggestions.push(await addNewCategorySuggestion(store, name, ids));
  return { batchId, received, created: writes.length, mergedExisting, mergedInFile, byCategory, suggestions, llmUsed, ...(llmError ? { llmError } : {}) };
}

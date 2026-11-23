import { CATEGORY_KEYS, categoryName, classifyItems, INBOX_KEY, learnRules, type Classification, type ClassifyItem, type LlmCategorizer, type Locale } from '@everyfold/core';
import { AnthropicCategorizer } from '@everyfold/core/anthropic';
import { Store, SYSTEM_DEVICE, type NodeRow } from './store.js';
import type { Env } from './env.js';
import { seedLocale, serverLocale, t } from './locale.js';

/** 키가 있을 때만 LLM 공급자를 만든다. 테스트는 setLlmOverride 로 가짜를 꽂는다. */
let llmOverride: LlmCategorizer | null | undefined;
export function setLlmOverride(llm: LlmCategorizer | null | undefined) {
  llmOverride = llm;
}

export function llmFor(env: Env, locale: Locale = 'en'): LlmCategorizer | null {
  if (llmOverride !== undefined) return llmOverride;
  if (!env.ANTHROPIC_API_KEY) return null;
  return new AnthropicCategorizer({ apiKey: env.ANTHROPIC_API_KEY, locale, ...(env.LLM_MODEL ? { model: env.LLM_MODEL } : {}) });
}

/** 처음 쓸 때 기본 카테고리 폴더를 만든다(한 번만). 이름은 로캘로, 분류는 cat_key 로. */
export async function ensureSeeded(store: Store, env: Env, acceptLanguage?: string | null): Promise<void> {
  const seeded = await store.db.prepare(`SELECT value FROM meta WHERE key='seeded'`).first<{ value: number }>();
  if (seeded) return;
  const ins = await store.db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('seeded', 1)`).run();
  if (!ins.meta.changes) return; // 다른 요청이 먼저 했다
  const locale = seedLocale(env, acceptLanguage);
  await store.db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('locale', ?)`).bind(locale).run();
  const batchId = crypto.randomUUID();
  await store.writeMany(
    CATEGORY_KEYS.map((key, position) => ({
      after: { id: crypto.randomUUID(), kind: 'folder' as const, parentId: null, title: categoryName(key, locale), url: null, position, deleted: false },
      before: null, op: 'create', catKey: key,
    })),
    SYSTEM_DEVICE, batchId,
  );
}

export async function categoryContext(store: Store) {
  const folders = await store.liveFolders();
  const categories = folders.map((f) => ({ id: f.id, name: f.title, key: f.cat_key ?? null }));
  const moves = (await store.db.prepare(`SELECT url, to_category_id, at FROM moves ORDER BY id DESC LIMIT 5000`).all<{ url: string; to_category_id: string; at: number }>()).results;
  const live = new Set(categories.map((c) => c.id));
  const learned = learnRules(moves.filter((m) => live.has(m.to_category_id)).map((m) => ({ url: m.url, toCategoryId: m.to_category_id, at: m.at })));
  // 인박스도 키로 찾는다 — 사용자가 이름을 바꿔도 그대로
  const inbox = folders.find((f) => f.cat_key === INBOX_KEY) ?? null;
  return { folders, categories, learned, inboxId: inbox?.id ?? null };
}

export async function classifyWithContext(store: Store, env: Env, items: ClassifyItem[]): Promise<{ results: Classification[]; inboxId: string | null; folders: NodeRow[]; llmUsed: boolean; llmError?: string }> {
  const ctx = await categoryContext(store);
  const llm = llmFor(env, await serverLocale(store, env));
  let llmError: string | undefined;
  const results = await classifyItems(items, {
    categories: ctx.categories,
    learned: ctx.learned,
    llm,
    onLlmError: (e) => {
      llmError = e instanceof Error ? e.message : String(e);
    },
  });
  return { results, inboxId: ctx.inboxId, folders: ctx.folders, llmUsed: !!llm, ...(llmError ? { llmError } : {}) };
}

/** 북마크 하나를 분류해 넣을 폴더 id 를 돌려준다(못 정하면 미분류, 미분류도 없으면 루트). */
export async function categorizeOne(store: Store, env: Env, item: { url: string; title: string }): Promise<string | null> {
  const { results, inboxId } = await classifyWithContext(store, env, [{ id: 'x', url: item.url, title: item.title }]);
  const r = results[0];
  if (r?.suggestedCategory) await addNewCategorySuggestion(store, env, r.suggestedCategory, []);
  return r?.categoryId ?? inboxId;
}

/** LLM 이 제안한 새 카테고리를 suggestion 으로 쌓는다(같은 이름의 pending 제안이 있으면 대상만 추가). */
export async function addNewCategorySuggestion(store: Store, env: Env, name: string, nodeIds: string[]): Promise<string> {
  const rows = (await store.db.prepare(`SELECT id, payload_json FROM suggestions WHERE kind='new_category' AND status='pending'`).all<{ id: string; payload_json: string }>()).results;
  for (const r of rows) {
    const p = JSON.parse(r.payload_json) as { name: string; nodeIds: string[] };
    if (p.name === name) {
      p.nodeIds = [...new Set([...p.nodeIds, ...nodeIds])];
      await store.db.prepare(`UPDATE suggestions SET payload_json=? WHERE id=?`).bind(JSON.stringify(p), r.id).run();
      return r.id;
    }
  }
  const id = crypto.randomUUID();
  await store.db
    .prepare(`INSERT INTO suggestions (id, kind, title, payload_json, status, created_at) VALUES (?, 'new_category', ?, ?, 'pending', ?)`)
    .bind(id, t(await serverLocale(store, env), 'newCategory')(name), JSON.stringify({ name, nodeIds }), Date.now())
    .run();
  return id;
}

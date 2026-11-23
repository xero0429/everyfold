import { classifyItems, DEFAULT_CATEGORIES, INBOX_CATEGORY, learnRules, type Classification, type ClassifyItem, type LlmCategorizer } from '@everyfold/core';
import { AnthropicCategorizer } from '@everyfold/core/anthropic';
import { Store, SYSTEM_DEVICE } from './store.js';
import type { Env } from './env.js';

/** 키가 있을 때만 LLM 공급자를 만든다. 테스트는 setLlmOverride 로 가짜를 꽂는다. */
let llmOverride: LlmCategorizer | null | undefined;
export function setLlmOverride(llm: LlmCategorizer | null | undefined) {
  llmOverride = llm;
}

export function llmFor(env: Env): LlmCategorizer | null {
  if (llmOverride !== undefined) return llmOverride;
  if (!env.ANTHROPIC_API_KEY) return null;
  return new AnthropicCategorizer({ apiKey: env.ANTHROPIC_API_KEY, ...(env.LLM_MODEL ? { model: env.LLM_MODEL } : {}) });
}

/** 처음 쓸 때 기본 카테고리 폴더를 만든다(한 번만). */
export async function ensureSeeded(store: Store): Promise<void> {
  const seeded = await store.db.prepare(`SELECT value FROM meta WHERE key='seeded'`).first<{ value: number }>();
  if (seeded) return;
  const ins = await store.db.prepare(`INSERT OR IGNORE INTO meta (key, value) VALUES ('seeded', 1)`).run();
  if (!ins.meta.changes) return; // 다른 요청이 먼저 했다
  const batchId = crypto.randomUUID();
  let pos = 0;
  for (const name of DEFAULT_CATEGORIES) {
    if (await store.findLiveFolder(null, name)) continue;
    await store.write(
      { id: crypto.randomUUID(), kind: 'folder', parentId: null, title: name, url: null, position: pos++, deleted: false },
      { op: 'create', deviceId: SYSTEM_DEVICE, batchId, before: null },
    );
  }
}

export async function categoryContext(store: Store) {
  const folders = await store.liveFolders();
  const categories = folders.map((f) => ({ id: f.id, name: f.title }));
  const moves = (await store.db.prepare(`SELECT url, to_category_id, at FROM moves ORDER BY id DESC LIMIT 5000`).all<{ url: string; to_category_id: string; at: number }>()).results;
  const live = new Set(categories.map((c) => c.id));
  const learned = learnRules(moves.filter((m) => live.has(m.to_category_id)).map((m) => ({ url: m.url, toCategoryId: m.to_category_id, at: m.at })));
  const inbox = folders.find((f) => f.parent_id === null && f.title === INBOX_CATEGORY) ?? null;
  return { categories, learned, inboxId: inbox?.id ?? null };
}

export async function classifyWithContext(store: Store, env: Env, items: ClassifyItem[]): Promise<{ results: Classification[]; inboxId: string | null; llmUsed: boolean; llmError?: string }> {
  const ctx = await categoryContext(store);
  const llm = llmFor(env);
  let llmError: string | undefined;
  const results = await classifyItems(items, {
    categories: ctx.categories,
    learned: ctx.learned,
    llm,
    onLlmError: (e) => {
      llmError = e instanceof Error ? e.message : String(e);
    },
  });
  return { results, inboxId: ctx.inboxId, llmUsed: !!llm, ...(llmError ? { llmError } : {}) };
}

/** 북마크 하나를 분류해 넣을 폴더 id 를 돌려준다(못 정하면 미분류, 미분류도 없으면 루트). */
export async function categorizeOne(store: Store, env: Env, item: { url: string; title: string }): Promise<string | null> {
  const { results, inboxId } = await classifyWithContext(store, env, [{ id: 'x', url: item.url, title: item.title }]);
  const r = results[0];
  if (r?.suggestedCategory) await addNewCategorySuggestion(store, r.suggestedCategory, []);
  return r?.categoryId ?? inboxId;
}

/** LLM 이 제안한 새 카테고리를 suggestion 으로 쌓는다(같은 이름의 pending 제안이 있으면 대상만 추가). */
export async function addNewCategorySuggestion(store: Store, name: string, nodeIds: string[]): Promise<string> {
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
    .bind(id, `새 카테고리 "${name}"`, JSON.stringify({ name, nodeIds }), Date.now())
    .run();
  return id;
}

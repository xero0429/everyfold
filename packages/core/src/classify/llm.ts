/**
 * LLM 분류 인터페이스 — 공급자는 교체 가능하다(기본 구현: ./anthropic.ts).
 * 규칙: LLM 은 기존 카테고리 중에서만 고른다. 맞는 게 없으면 newCategory 로 "제안" 만 한다.
 * 새 카테고리는 절대 자동으로 만들지 않는다 — 서버가 suggestion 으로 쌓고 사용자가 승인해야 생긴다.
 */
export interface LlmItem {
  id: string;
  url: string;
  title: string;
}

export interface LlmCategory {
  id: string;
  name: string;
}

export type LlmDecision =
  | { itemId: string; categoryId: string }
  | { itemId: string; newCategory: string }
  | { itemId: string; skip: true };

export interface LlmCategorizer {
  readonly name: string;
  categorize(items: readonly LlmItem[], categories: readonly LlmCategory[]): Promise<LlmDecision[]>;
}

/** 공급자 응답을 믿지 않고 걸러낸다: 모르는 itemId/categoryId 는 버리고, 빈 새 이름은 skip. */
export function sanitizeDecisions(
  raw: ReadonlyArray<{ itemId?: unknown; categoryId?: unknown; newCategory?: unknown }>,
  items: readonly LlmItem[],
  categories: readonly LlmCategory[],
): LlmDecision[] {
  const itemIds = new Set(items.map((i) => i.id));
  const catIds = new Set(categories.map((c) => c.id));
  const catByName = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
  const seen = new Set<string>();
  const out: LlmDecision[] = [];
  for (const r of raw) {
    const itemId = typeof r.itemId === 'string' ? r.itemId : '';
    if (!itemIds.has(itemId) || seen.has(itemId)) continue;
    seen.add(itemId);
    const cid = typeof r.categoryId === 'string' ? r.categoryId.trim() : '';
    const nc = typeof r.newCategory === 'string' ? r.newCategory.trim().slice(0, 40) : '';
    if (cid && catIds.has(cid)) out.push({ itemId, categoryId: cid });
    else if (nc && catByName.has(nc.toLowerCase())) out.push({ itemId, categoryId: catByName.get(nc.toLowerCase())! });
    else if (nc) out.push({ itemId, newCategory: nc });
    else out.push({ itemId, skip: true });
  }
  return out;
}

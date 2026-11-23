import { matchDomainRule, BUILTIN_RULES, type DomainRule } from './rules.js';
import { matchLearned, type LearnedRule } from './learn.js';
import type { LlmCategorizer, LlmCategory } from './llm.js';

/**
 * 분류 파이프라인 — 순서: ① 학습 규칙(사용자가 옮긴 기록) → ② 도메인 규칙 → ③ LLM(있으면) → 미분류.
 * ① 이 ② 보다 앞선 것은 사용자가 직접 보여준 의도가 기본 규칙보다 정확하기 때문.
 * LLM 이 없거나(키 없음) 실패해도 ①② 만으로 끝까지 동작한다.
 */
export interface ClassifyItem {
  id: string;
  url: string;
  title: string;
}

export type ClassifySource = 'learned' | 'rule' | 'llm' | 'none';

export interface Classification {
  itemId: string;
  categoryId: string | null;
  source: ClassifySource;
  /** LLM 이 기존 카테고리가 안 맞는다고 본 경우의 새 카테고리 이름(제안일 뿐, 생성 안 함) */
  suggestedCategory?: string;
}

export interface ClassifyContext {
  categories: readonly LlmCategory[];
  learned?: readonly LearnedRule[];
  rules?: readonly DomainRule[];
  llm?: LlmCategorizer | null;
  llmBatchSize?: number;
  onLlmError?: (err: unknown) => void;
}

export function classifyByRules(item: ClassifyItem, ctx: ClassifyContext): Classification {
  const catIds = new Set(ctx.categories.map((c) => c.id));
  const learned = matchLearned(item.url, ctx.learned ?? []);
  if (learned && catIds.has(learned.categoryId)) return { itemId: item.id, categoryId: learned.categoryId, source: 'learned' };
  const hit = matchDomainRule(item.url, ctx.rules ?? BUILTIN_RULES);
  if (hit) {
    const cat = ctx.categories.find((c) => c.name === hit.rule.category);
    if (cat) return { itemId: item.id, categoryId: cat.id, source: 'rule' };
  }
  return { itemId: item.id, categoryId: null, source: 'none' };
}

export async function classifyItems(items: readonly ClassifyItem[], ctx: ClassifyContext): Promise<Classification[]> {
  const out = items.map((it) => classifyByRules(it, ctx));
  if (!ctx.llm) return out;
  const pending = items.filter((_, i) => out[i]!.source === 'none');
  const size = ctx.llmBatchSize ?? 50;
  const index = new Map(items.map((it, i) => [it.id, i]));
  for (let i = 0; i < pending.length; i += size) {
    const batch = pending.slice(i, i + size);
    try {
      const decisions = await ctx.llm.categorize(batch, ctx.categories);
      for (const d of decisions) {
        const at = index.get(d.itemId);
        if (at === undefined) continue;
        if ('categoryId' in d) out[at] = { itemId: d.itemId, categoryId: d.categoryId, source: 'llm' };
        else if ('newCategory' in d) out[at] = { itemId: d.itemId, categoryId: null, source: 'none', suggestedCategory: d.newCategory };
      }
    } catch (err) {
      ctx.onLlmError?.(err);
    }
  }
  return out;
}

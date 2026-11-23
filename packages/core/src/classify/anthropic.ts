import Anthropic from '@anthropic-ai/sdk';
import type { Locale } from './rules.js';
import { sanitizeDecisions, type LlmCategorizer, type LlmCategory, type LlmDecision, type LlmItem } from './llm.js';

/**
 * 기본 LLM 공급자 — Anthropic Messages API, claude-haiku-5-5.
 * API 키는 호출하는 쪽(Worker secret ANTHROPIC_API_KEY)이 넘긴다. 코드·저장소에 키를 두지 않는다.
 * 구조화 출력(output_config.format json_schema)으로 JSON 을 받고, sanitizeDecisions 로 한 번 더 거른다.
 */
export const DEFAULT_MODEL = 'claude-haiku-5-5';

const SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          categoryId: { type: 'string', description: 'Existing category id, or empty string if none fits' },
          newCategory: { type: 'string', description: 'New category name to suggest only when no existing category fits, otherwise empty string' },
        },
        required: ['itemId', 'categoryId', 'newCategory'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
  additionalProperties: false,
} as const;

const LANGUAGE: Record<Locale, string> = { en: 'English', ko: 'Korean' };

/** 새 카테고리 이름을 사용자 로캘 언어로 받도록 프롬프트를 만든다 */
export function systemPrompt(locale: Locale = 'en'): string {
  return [
    'You are a bookmark classifier. Assign each bookmark to one of the given categories.',
    '- Prefer an existing category (categoryId) whenever one reasonably fits.',
    `- Only if none fits, put a short ${LANGUAGE[locale]} name (1-3 words) in newCategory and leave categoryId empty.`,
    '- If you cannot decide, leave both empty.',
    '- Return exactly one decision for every itemId.',
  ].join('\n');
}

export interface AnthropicCategorizerOptions {
  apiKey: string;
  model?: string;
  /** 테스트용 fetch 주입 */
  fetch?: typeof fetch;
  baseURL?: string;
  /** 새 카테고리 제안 이름의 언어 */
  locale?: Locale;
}

export class AnthropicCategorizer implements LlmCategorizer {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;
  private locale: Locale;

  constructor(opts: AnthropicCategorizerOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      maxRetries: 1,
    });
    this.model = opts.model ?? DEFAULT_MODEL;
    this.locale = opts.locale ?? 'en';
  }

  async categorize(items: readonly LlmItem[], categories: readonly LlmCategory[]): Promise<LlmDecision[]> {
    if (items.length === 0) return [];
    const payload = {
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
      bookmarks: items.map((i) => ({ itemId: i.id, title: i.title.slice(0, 200), url: i.url.slice(0, 300) })),
    };
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      system: systemPrompt(this.locale),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    });
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') return [];
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return [];
    }
    const decisions = (parsed as { decisions?: unknown }).decisions;
    if (!Array.isArray(decisions)) return [];
    return sanitizeDecisions(decisions, items, categories);
  }
}

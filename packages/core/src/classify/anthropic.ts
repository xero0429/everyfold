import Anthropic from '@anthropic-ai/sdk';
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
          categoryId: { type: 'string', description: '기존 카테고리 id. 맞는 것이 없으면 빈 문자열' },
          newCategory: { type: 'string', description: '기존 카테고리가 모두 안 맞을 때만 제안할 새 이름. 아니면 빈 문자열' },
        },
        required: ['itemId', 'categoryId', 'newCategory'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
  additionalProperties: false,
} as const;

const SYSTEM = [
  '너는 북마크 분류기다. 각 북마크를 주어진 카테고리 중 하나에 배정한다.',
  '- 가능한 한 기존 카테고리(categoryId)를 고른다.',
  '- 어느 것도 맞지 않을 때만 newCategory 에 짧은 한국어 이름(2~12자)을 제안하고 categoryId 는 빈 문자열로 둔다.',
  '- 판단할 수 없으면 둘 다 빈 문자열로 둔다.',
  '- 모든 itemId 에 대해 정확히 하나의 결정을 낸다.',
].join('\n');

export interface AnthropicCategorizerOptions {
  apiKey: string;
  model?: string;
  /** 테스트용 fetch 주입 */
  fetch?: typeof fetch;
  baseURL?: string;
}

export class AnthropicCategorizer implements LlmCategorizer {
  readonly name = 'anthropic';
  private client: Anthropic;
  private model: string;

  constructor(opts: AnthropicCategorizerOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
      maxRetries: 1,
    });
    this.model = opts.model ?? DEFAULT_MODEL;
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
      system: SYSTEM,
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

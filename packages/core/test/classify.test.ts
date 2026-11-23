import { describe, expect, it, vi } from 'vitest';
import {
  BUILTIN_RULES, categoryName, classifyByRules, pickLocale, classifyItems, learnRules, matchDomainRule, matchLearned, sanitizeDecisions,
  type LlmCategorizer,
  type LlmItem,
} from '../src/index.js';
import { AnthropicCategorizer, systemPrompt } from '../src/classify/anthropic.js';

const cats = [
  { id: 'c-dev', name: '개발', key: 'dev' },
  { id: 'c-news', name: '뉴스', key: 'news' },
  { id: 'c-video', name: '영상·음악', key: 'media' },
  { id: 'c-work', name: '업무·도구', key: 'work' },
  { id: 'c-cook', name: '요리' },
];

describe('domain rules', () => {
  it('matches host and subdomains, longest wins', () => {
    expect(matchDomainRule('https://gist.github.com/x', BUILTIN_RULES)?.rule.category).toBe('dev');
    expect(matchDomainRule('https://www.youtube.com/watch?v=1', BUILTIN_RULES)?.rule.category).toBe('media');
    expect(matchDomainRule('https://notgithub.com', BUILTIN_RULES)).toBeNull();
    // news.naver.com(뉴스) 가 naver 쪽 다른 규칙보다 우선
    expect(matchDomainRule('https://n.news.naver.com/article/1', BUILTIN_RULES)?.rule.category).toBe('news');
  });
  it('path rules beat host rules', () => {
    const rules = [{ match: 'google.com', category: '업무·도구' }, { match: 'google.com/maps', category: '여행·지도' }];
    expect(matchDomainRule('https://www.google.com/maps/place/x', rules)?.rule.category).toBe('여행·지도');
    expect(matchDomainRule('https://www.google.com/search', rules)?.rule.category).toBe('업무·도구');
  });
  it('rule category missing in user set → none (no auto-create)', () => {
    expect(classifyByRules({ id: '1', url: 'https://coupang.com/x', title: '' }, { categories: cats })).toMatchObject({ categoryId: null, source: 'none' });
  });
});

describe('learning from moves', () => {
  const moves = [
    { url: 'https://www.youtube.com/watch?v=1', toCategoryId: 'c-cook', at: 1 },
    { url: 'https://youtube.com/watch?v=2', toCategoryId: 'c-cook', at: 2 },
    { url: 'https://youtube.com/watch?v=3', toCategoryId: 'c-video', at: 3 },
    { url: 'https://blog.example.com/a', toCategoryId: 'c-dev', at: 4 },
  ];
  it('needs minCount and minShare', () => {
    const rules = learnRules(moves);
    expect(rules).toEqual([{ host: 'youtube.com', categoryId: 'c-cook', count: 2, share: 2 / 3 }]);
    expect(learnRules(moves, { minShare: 0.7 })).toEqual([]);
    expect(learnRules(moves, { minCount: 1 }).map((r) => r.host)).toEqual(['blog.example.com', 'youtube.com']);
  });
  it('tie goes to the most recent category', () => {
    const r = learnRules([
      { url: 'https://a.com/1', toCategoryId: 'x', at: 1 },
      { url: 'https://a.com/2', toCategoryId: 'y', at: 9 },
    ], { minCount: 1, minShare: 0.5 });
    expect(r[0]!.categoryId).toBe('y');
  });
  it('learned rules override builtin domain rules', () => {
    const learned = learnRules(moves);
    expect(matchLearned('https://m.youtube.com/x', learned)?.categoryId).toBe('c-cook');
    expect(classifyByRules({ id: '1', url: 'https://youtube.com/watch?v=9', title: 'x' }, { categories: cats, learned })).toMatchObject({ categoryId: 'c-cook', source: 'learned' });
    expect(classifyByRules({ id: '1', url: 'https://youtube.com/watch?v=9', title: 'x' }, { categories: cats })).toMatchObject({ categoryId: 'c-video', source: 'rule' });
  });
});

describe('LLM step', () => {
  const items = [
    { id: 'i1', url: 'https://github.com/x', title: 'repo' },
    { id: 'i2', url: 'https://recipes.example/kimchi', title: '김치찌개' },
    { id: 'i3', url: 'https://plants.example/', title: '식물 키우기' },
    { id: 'i4', url: 'https://unknown.example/', title: '???' },
  ];
  it('only unresolved items go to LLM; new categories are suggestions only', async () => {
    const llm: LlmCategorizer = {
      name: 'fake',
      categorize: vi.fn(async (batch: readonly LlmItem[]) => {
        expect(batch.map((b) => b.id)).toEqual(['i2', 'i3', 'i4']);
        return [{ itemId: 'i2', categoryId: 'c-cook' }, { itemId: 'i3', newCategory: '원예' }, { itemId: 'i4', skip: true as const }];
      }),
    };
    const out = await classifyItems(items, { categories: cats, llm });
    expect(out).toEqual([
      { itemId: 'i1', categoryId: 'c-dev', source: 'rule' },
      { itemId: 'i2', categoryId: 'c-cook', source: 'llm' },
      { itemId: 'i3', categoryId: null, source: 'none', suggestedCategory: '원예' },
      { itemId: 'i4', categoryId: null, source: 'none' },
    ]);
  });
  it('LLM failure falls back to rules only', async () => {
    const onLlmError = vi.fn();
    const llm: LlmCategorizer = { name: 'boom', categorize: async () => { throw new Error('down'); } };
    const out = await classifyItems(items, { categories: cats, llm, onLlmError });
    expect(onLlmError).toHaveBeenCalledOnce();
    expect(out.map((o) => o.source)).toEqual(['rule', 'none', 'none', 'none']);
  });
  it('sanitizes provider output', () => {
    const d = sanitizeDecisions(
      [
        { itemId: 'i1', categoryId: 'nope', newCategory: '' },
        { itemId: 'i2', categoryId: '', newCategory: '요리' }, // 이름이 기존과 같으면 기존으로
        { itemId: 'zz', categoryId: 'c-dev' },
        { itemId: 'i2', categoryId: 'c-dev' }, // 중복 itemId 무시
        { itemId: 'i3', categoryId: 'c-dev', newCategory: 'x' },
      ],
      items, cats,
    );
    expect(d).toEqual([{ itemId: 'i1', skip: true }, { itemId: 'i2', categoryId: 'c-cook' }, { itemId: 'i3', categoryId: 'c-dev' }]);
  });
  it('AnthropicCategorizer sends haiku request with json_schema and parses the answer', async () => {
    const calls: Array<{ url: string; body: any; headers: Headers }> = [];
    const fakeFetch = (async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body), headers: new Headers(init.headers) });
      const answer = { decisions: [{ itemId: 'i2', categoryId: 'c-cook', newCategory: '' }, { itemId: 'i3', categoryId: '', newCategory: '원예' }] };
      return new Response(JSON.stringify({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const c = new AnthropicCategorizer({ apiKey: 'test-key', fetch: fakeFetch });
    const out = await c.categorize(items.slice(1, 3), cats);
    expect(out).toEqual([{ itemId: 'i2', categoryId: 'c-cook' }, { itemId: 'i3', newCategory: '원예' }]);
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]!.body.model).toBe('claude-haiku-5-5');
    expect(calls[0]!.body.output_config.format.type).toBe('json_schema');
    const h = calls[0]!.headers;
    expect(h.get('x-api-key') ?? h.get('authorization')).toMatch(/test-key/);
  });
});

describe('category keys and locale', () => {
  it('rules follow the key, so a renamed category still gets its bookmarks', () => {
    const renamed = [{ id: 'c-dev', name: 'My code stuff', key: 'dev' }];
    expect(classifyByRules({ id: '1', url: 'https://github.com/a/b', title: '' }, { categories: renamed })).toMatchObject({ categoryId: 'c-dev', source: 'rule' });
    // 키 없는 같은 이름 폴더는 규칙 대상이 아니다
    expect(classifyByRules({ id: '1', url: 'https://github.com/a/b', title: '' }, { categories: [{ id: 'x', name: 'dev' }] }).source).toBe('none');
  });
  it('picks locale from Accept-Language-like values, default en', () => {
    expect(pickLocale('ko-KR,ko;q=0.9,en;q=0.8')).toBe('ko');
    expect(pickLocale(undefined, 'en-US,en')).toBe('en');
    expect(pickLocale('fr-FR')).toBe('en');
    expect(pickLocale()).toBe('en');
    expect(categoryName('inbox', 'en')).toBe('Unsorted');
    expect(categoryName('inbox', 'ko')).toBe('미분류');
  });
  it('LLM prompt asks for names in the user language', () => {
    expect(systemPrompt('ko')).toContain('Korean');
    expect(systemPrompt()).toContain('English');
  });
});

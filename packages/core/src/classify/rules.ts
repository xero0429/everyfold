import { hostOf } from '../normalize.js';

/**
 * 기본 카테고리 — 이름이 아니라 안정 키(key)로 다룬다. 사용자가 폴더 이름을 바꿔도 키는 그대로라 규칙 분류가 계속 맞는다.
 * 이름은 처음 만들 때 로캘(en/ko)로 고를 뿐이다. 사용자가 이름을 바꾸거나 지워도 된다.
 */
export const CATEGORY_KEYS = ['dev', 'work', 'news', 'shopping', 'media', 'social', 'learning', 'finance', 'travel', 'inbox'] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];
export const INBOX_KEY: CategoryKey = 'inbox';

export const LOCALES = ['en', 'ko'] as const;
export type Locale = (typeof LOCALES)[number];

export const CATEGORY_NAMES: Record<CategoryKey, Record<Locale, string>> = {
  dev: { en: 'Development', ko: '개발' },
  work: { en: 'Work & Tools', ko: '업무·도구' },
  news: { en: 'News', ko: '뉴스' },
  shopping: { en: 'Shopping', ko: '쇼핑' },
  media: { en: 'Video & Music', ko: '영상·음악' },
  social: { en: 'Social', ko: '소셜' },
  learning: { en: 'Learning & Reference', ko: '학습·참고' },
  finance: { en: 'Finance', ko: '금융' },
  travel: { en: 'Travel & Maps', ko: '여행·지도' },
  inbox: { en: 'Unsorted', ko: '미분류' },
};

export const categoryName = (key: CategoryKey, locale: Locale) => CATEGORY_NAMES[key][locale];

/** 'ko-KR,ko;q=0.9,en;q=0.8' 같은 값들에서 로캘을 고른다. 앞에 있는 값이 우선, 모르면 en. */
export function pickLocale(...candidates: Array<string | null | undefined>): Locale {
  for (const c of candidates) {
    if (!c) continue;
    const first = c.split(',')[0]!.trim().toLowerCase();
    if (!first) continue;
    return first.startsWith('ko') ? 'ko' : 'en';
  }
  return 'en';
}

export interface DomainRule {
  /** 호스트 또는 상위 도메인(github.com 은 gist.github.com 도 맞음). 경로 접두가 필요하면 "host/path" */
  match: string;
  /** 카테고리 키(기본 카테고리) — 사용자 규칙이면 카테고리 id 를 써도 된다(classify 가 둘 다 본다) */
  category: string;
}

/** 기본 도메인 규칙(카테고리 키 기준). 즉시·결정적으로 동작한다. */
export const BUILTIN_RULES: DomainRule[] = [
  ...[
    'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'stackexchange.com', 'npmjs.com',
    'developer.mozilla.org', 'dev.to', 'pypi.org', 'crates.io', 'docs.rs', 'go.dev', 'rust-lang.org',
    'typescriptlang.org', 'nodejs.org', 'react.dev', 'vercel.com', 'cloudflare.com', 'docker.com',
    'kubernetes.io', 'huggingface.co', 'codepen.io', 'codesandbox.io', 'jsfiddle.net', 'velog.io',
    'developer.apple.com', 'developer.android.com', 'platform.claude.com', 'expo.dev',
  ].map((match) => ({ match, category: 'dev' })),
  ...[
    'notion.so', 'figma.com', 'slack.com', 'atlassian.net', 'atlassian.com', 'trello.com', 'asana.com',
    'docs.google.com', 'drive.google.com', 'mail.google.com', 'calendar.google.com', 'office.com',
    'outlook.live.com', 'dropbox.com', 'miro.com', 'linear.app', 'zoom.us', 'claude.ai', 'chatgpt.com',
  ].map((match) => ({ match, category: 'work' })),
  ...[
    'news.naver.com', 'news.daum.net', 'news.ycombinator.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com',
    'theguardian.com', 'reuters.com', 'cnn.com', 'chosun.com', 'joongang.co.kr', 'donga.com',
    'hani.co.kr', 'yna.co.kr', 'theverge.com', 'techcrunch.com', 'zdnet.co.kr', 'geeknews.kr', 'news.hada.io',
  ].map((match) => ({ match, category: 'news' })),
  ...[
    'coupang.com', 'gmarket.co.kr', '11st.co.kr', 'auction.co.kr', 'amazon.com', 'amazon.co.jp',
    'aliexpress.com', 'ebay.com', 'musinsa.com', 'shopping.naver.com', 'smartstore.naver.com',
    'ssg.com', 'kurly.com', 'danawa.com', 'temu.com',
  ].map((match) => ({ match, category: 'shopping' })),
  ...[
    'youtube.com', 'youtu.be', 'netflix.com', 'twitch.tv', 'vimeo.com', 'chzzk.naver.com',
    'tving.com', 'wavve.com', 'disneyplus.com', 'spotify.com', 'music.apple.com', 'melon.com', 'soundcloud.com',
  ].map((match) => ({ match, category: 'media' })),
  ...[
    'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'reddit.com', 'threads.net', 'linkedin.com',
    'discord.com', 'mastodon.social', 'bsky.app', 'tiktok.com', 'cafe.naver.com', 'blog.naver.com',
  ].map((match) => ({ match, category: 'social' })),
  ...[
    'wikipedia.org', 'namu.wiki', 'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org',
    'inflearn.com', 'arxiv.org', 'scholar.google.com', 'medium.com', 'dictionary.cambridge.org', 'papago.naver.com',
  ].map((match) => ({ match, category: 'learning' })),
  ...[
    'kbstar.com', 'shinhan.com', 'wooribank.com', 'ibk.co.kr', 'kakaobank.com', 'toss.im', 'upbit.com',
    'finance.yahoo.com', 'investing.com', 'tradingview.com', 'paypal.com', 'hometax.go.kr',
  ].map((match) => ({ match, category: 'finance' })),
  ...[
    'booking.com', 'airbnb.com', 'agoda.com', 'expedia.com', 'tripadvisor.com', 'skyscanner.net',
    'maps.google.com', 'map.naver.com', 'map.kakao.com', 'yanolja.com', 'goodchoice.kr', 'koreanair.com',
  ].map((match) => ({ match, category: 'travel' })),
];

export interface RuleHit {
  rule: DomainRule;
  specificity: number;
}

/** 가장 구체적인(긴) 규칙 하나를 고른다. 경로 규칙(host/path) 이 호스트 규칙보다 우선한다. */
export function matchDomainRule(url: string, rules: readonly DomainRule[]): RuleHit | null {
  const host = hostOf(url);
  if (!host) return null;
  let path = '';
  try {
    path = new URL(url.trim()).pathname;
  } catch {
    /* hostOf 가 통과했으면 여기 안 온다 */
  }
  let best: RuleHit | null = null;
  for (const rule of rules) {
    const m = rule.match.toLowerCase().replace(/^www\./, '');
    const slash = m.indexOf('/');
    const rHost = slash < 0 ? m : m.slice(0, slash);
    const rPath = slash < 0 ? '' : m.slice(slash);
    if (host !== rHost && !host.endsWith('.' + rHost)) continue;
    if (rPath && !path.startsWith(rPath)) continue;
    const specificity = rHost.length + (rPath ? 1000 + rPath.length : 0) + (host === rHost ? 0.5 : 0);
    if (!best || specificity > best.specificity) best = { rule, specificity };
  }
  return best;
}

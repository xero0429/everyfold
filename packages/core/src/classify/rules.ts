import { hostOf } from '../normalize.js';

/** 처음 연결할 때 서버가 만드는 기본 카테고리. 사용자가 이름을 바꾸거나 지워도 된다. */
export const DEFAULT_CATEGORIES = [
  '개발', '업무·도구', '뉴스', '쇼핑', '영상·음악', '소셜', '학습·참고', '금융', '여행·지도', '미분류',
] as const;

export const INBOX_CATEGORY = '미분류';

export interface DomainRule {
  /** 호스트 또는 상위 도메인(github.com 은 gist.github.com 도 맞음). 경로 접두가 필요하면 "host/path" */
  match: string;
  category: string;
}

/** 기본 도메인 규칙(카테고리 이름 기준). 즉시·결정적으로 동작한다. */
export const BUILTIN_RULES: DomainRule[] = [
  ...[
    'github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'stackexchange.com', 'npmjs.com',
    'developer.mozilla.org', 'dev.to', 'pypi.org', 'crates.io', 'docs.rs', 'go.dev', 'rust-lang.org',
    'typescriptlang.org', 'nodejs.org', 'react.dev', 'vercel.com', 'cloudflare.com', 'docker.com',
    'kubernetes.io', 'huggingface.co', 'codepen.io', 'codesandbox.io', 'jsfiddle.net', 'velog.io',
    'developer.apple.com', 'developer.android.com', 'platform.claude.com', 'expo.dev',
  ].map((match) => ({ match, category: '개발' })),
  ...[
    'notion.so', 'figma.com', 'slack.com', 'atlassian.net', 'atlassian.com', 'trello.com', 'asana.com',
    'docs.google.com', 'drive.google.com', 'mail.google.com', 'calendar.google.com', 'office.com',
    'outlook.live.com', 'dropbox.com', 'miro.com', 'linear.app', 'zoom.us', 'claude.ai', 'chatgpt.com',
  ].map((match) => ({ match, category: '업무·도구' })),
  ...[
    'news.naver.com', 'news.daum.net', 'news.ycombinator.com', 'bbc.com', 'bbc.co.uk', 'nytimes.com',
    'theguardian.com', 'reuters.com', 'cnn.com', 'chosun.com', 'joongang.co.kr', 'donga.com',
    'hani.co.kr', 'yna.co.kr', 'theverge.com', 'techcrunch.com', 'zdnet.co.kr', 'geeknews.kr', 'news.hada.io',
  ].map((match) => ({ match, category: '뉴스' })),
  ...[
    'coupang.com', 'gmarket.co.kr', '11st.co.kr', 'auction.co.kr', 'amazon.com', 'amazon.co.jp',
    'aliexpress.com', 'ebay.com', 'musinsa.com', 'shopping.naver.com', 'smartstore.naver.com',
    'ssg.com', 'kurly.com', 'danawa.com', 'temu.com',
  ].map((match) => ({ match, category: '쇼핑' })),
  ...[
    'youtube.com', 'youtu.be', 'netflix.com', 'twitch.tv', 'vimeo.com', 'chzzk.naver.com',
    'tving.com', 'wavve.com', 'disneyplus.com', 'spotify.com', 'music.apple.com', 'melon.com', 'soundcloud.com',
  ].map((match) => ({ match, category: '영상·음악' })),
  ...[
    'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'reddit.com', 'threads.net', 'linkedin.com',
    'discord.com', 'mastodon.social', 'bsky.app', 'tiktok.com', 'cafe.naver.com', 'blog.naver.com',
  ].map((match) => ({ match, category: '소셜' })),
  ...[
    'wikipedia.org', 'namu.wiki', 'coursera.org', 'udemy.com', 'edx.org', 'khanacademy.org',
    'inflearn.com', 'arxiv.org', 'scholar.google.com', 'medium.com', 'dictionary.cambridge.org', 'papago.naver.com',
  ].map((match) => ({ match, category: '학습·참고' })),
  ...[
    'kbstar.com', 'shinhan.com', 'wooribank.com', 'ibk.co.kr', 'kakaobank.com', 'toss.im', 'upbit.com',
    'finance.yahoo.com', 'investing.com', 'tradingview.com', 'paypal.com', 'hometax.go.kr',
  ].map((match) => ({ match, category: '금융' })),
  ...[
    'booking.com', 'airbnb.com', 'agoda.com', 'expedia.com', 'tripadvisor.com', 'skyscanner.net',
    'maps.google.com', 'map.naver.com', 'map.kakao.com', 'yanolja.com', 'goodchoice.kr', 'koreanair.com',
  ].map((match) => ({ match, category: '여행·지도' })),
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

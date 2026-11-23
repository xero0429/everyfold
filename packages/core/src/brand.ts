/**
 * 제품 이름 — 제품 이름은 "Everyfold"(대장 11-23 확정). 바꿀 일이 생기면 이 파일과 패키지 scope(@everyfold/*) 만 바꾸면 된다.
 * 확장의 브라우저 루트 폴더 이름, 서버 응답의 service 필드, 확장 manifest 이름이 모두 여기서 나온다.
 */
export const BRAND = {
  name: 'Everyfold',
  rootFolderTitle: 'Everyfold',
  slug: 'everyfold',
  /** 원본 저장소 — 팝업의 "서버 업데이트" 안내 링크가 여기 README 를 가리킨다 */
  repoUrl: 'https://github.com/xero0429/everyfold',
} as const;

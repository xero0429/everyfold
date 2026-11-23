Everyfold — 모든 브라우저를 위한 하나의 북마크 저장소, 자동 정리까지.

[English](README.md) · [한국어](README.ko.md)

<!-- TODO: 데모 GIF -->
![Everyfold 데모](docs/demo.gif)

Everyfold 는 **내 Cloudflare 계정에 북마크 저장소 하나**를 두고, 연결한 모든 브라우저(현재 Chrome·Firefox)의 `Everyfold` 폴더에 똑같이 비춰 줍니다. 새 북마크는 카테고리 폴더로 자동 분류됩니다 — 기본 도메인 규칙, 내가 옮긴 기록에서 배운 규칙, 그리고 (선택) LLM.

- **진짜 브라우저 북마크.** 따로 열 앱이 없습니다. `Everyfold` 폴더가 각 브라우저 북마크 안에 있습니다(Chrome: 기타 북마크, Firefox: 기타 북마크).
- **기존 폴더는 건드리지 않습니다.** 처음 연결할 때 기존 북마크를 저장소로 *복사*하고(중복은 합침) 원본은 그대로 둡니다.
- **자동 분류.** 규칙 → 학습 → (선택) Claude Haiku. LLM 은 새 카테고리를 *제안*만 하고, 승인해야 생깁니다.
- **안전 장치.** 한 번에 북마크 20% 이상이 지워지면 멈추고 묻습니다. 모든 변경은 기록되어 되돌릴 수 있고, 하루 1번 스냅샷을 복원할 수 있습니다.
- **셀프 호스팅, 무료 티어로 충분.** Cloudflare Worker 하나 + D1. Docker·VPS 불필요.
- **다른 도구에서 가져오기.** Netscape HTML(모든 브라우저), Floccus(XBEL/HTML), Karakeep(JSON), Linkwarden(JSON), Raindrop.io(CSV/HTML).

## 5분 설치

**1. 서버 배포**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/xero0429/everyfold)

버튼이 저장소를 내 계정으로 복사하고, D1 데이터베이스를 만들고, 마이그레이션을 적용한 뒤(`deploy` 스크립트) 비밀값을 묻습니다.

| 비밀값 | |
|---|---|
| `ADMIN_TOKEN` | 필수. 브라우저마다 한 번 확장에 붙여 넣습니다. 긴 무작위 문자열(`openssl rand -hex 32`). |
| `ANTHROPIC_API_KEY` | 선택. LLM 분류를 켭니다. 없으면 규칙 + 학습만 씁니다. |

명령줄로 배포하려면:

```sh
git clone https://github.com/xero0429/everyfold && cd everyfold
corepack enable && pnpm install
npx wrangler d1 create everyfold        # 나온 database_id 를 wrangler.toml 에 넣기
npx wrangler secret put ADMIN_TOKEN
pnpm run deploy
```

**2. 확장 설치**

```sh
pnpm install && pnpm build:extension     # → apps/extension/dist/chrome, dist/firefox
```

- Chrome/Edge/Brave: `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → `apps/extension/dist/chrome`
- Firefox: `about:debugging#/runtime/this-firefox` → 임시 부가 기능 로드 → `apps/extension/dist/firefox/manifest.json`

**3. 브라우저마다 연결**

툴바의 Everyfold 아이콘 → 서버 URL, 관리자 토큰, 기기 이름 → 연결. 관리자 토큰은 등록에 한 번만 쓰고 저장하지 않습니다.

이후 북마크를 바꿀 때, 5분마다, 창으로 돌아올 때 동기화됩니다.

## 로컬 실행

```sh
corepack enable && pnpm install
cp .dev.vars.example .dev.vars        # ADMIN_TOKEN 설정
pnpm dev                              # http://localhost:8787 (로컬 D1)
pnpm build:extension
pnpm typecheck && pnpm test
pnpm --filter @everyfold/extension e2e   # 실제 Chromium + wrangler dev
```

## 비교

| | Everyfold | Floccus | Karakeep | Linkwarden | TidyMark |
|---|---|---|---|---|---|
| 성격 | 브라우저 간 북마크 동기화 + 자동 정리 | 북마크 동기화 확장(+모바일 앱) | 북마크/나중에 읽기 앱 | 협업 북마크 관리·보관 | 북마크 정리 확장 |
| 브라우저 기본 북마크를 브라우저끼리 동기화 | 예(`Everyfold` 폴더) | 예 | Floccus 로 | Floccus 로 | 아니오 |
| 자동 분류 | 규칙+학습+선택 LLM(새 카테고리는 승인) | — | LLM 자동 태그(OpenAI/Ollama) | 선택 AI 태그 | 규칙+선택 AI |
| 백엔드 | 내 Cloudflare Worker + D1 | 선택: Nextcloud·WebDAV·Git·Google Drive 등 | Docker 서버(또는 유료 클라우드) | Docker 서버(또는 유료 클라우드) | 없음 |
| 라이선스 | MIT | MPL-2.0 | AGPL-3.0 | AGPL-3.0 | MIT |

## 알려진 한계

- 폴더 안 형제 순서는 아직 동기화하지 않습니다(새 항목은 끝에 붙음).
- Safari 미지원. 스토어(Chrome 웹 스토어·AMO) 등록 전.
- 첫 연결 뒤 각 브라우저에는 원래 북마크와 `Everyfold` 사본이 함께 있습니다(의도된 동작).

기여: [CONTRIBUTING.md](CONTRIBUTING.md) · 라이선스: [MIT](LICENSE)

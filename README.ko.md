Everyfold — 모든 브라우저를 위한 하나의 북마크 저장소, 자동 정리까지.

[English](README.md) · [한국어](README.ko.md)

<!-- TODO: 데모 GIF -->
![Everyfold 데모](docs/demo.gif)

Everyfold 는 **내 Cloudflare 계정에 북마크 저장소 하나**를 두고, 연결한 모든 브라우저(현재 Chrome·Firefox)의 `Everyfold` 폴더에 똑같이 비춰 줍니다. 새 북마크는 카테고리 폴더로 자동 분류됩니다 — 기본 도메인 규칙, 내가 옮긴 기록에서 배운 규칙, 그리고 (선택) LLM.

- **진짜 브라우저 북마크.** 따로 열 앱이 없습니다. `Everyfold` 폴더가 각 브라우저 북마크 안에 있습니다(Chrome: 기타 북마크, Firefox: 기타 북마크).
- **기존 폴더는 건드리지 않습니다.** 처음 연결할 때 기존 북마크를 저장소로 *복사*하고(중복은 합침) 원본은 그대로 둡니다.
- **자동 분류.** 규칙 → 학습 → (선택) Claude Haiku. LLM 은 새 카테고리를 *제안*만 하고, 승인해야 생깁니다.
- **안전 장치.** 한 번에 북마크 20% 이상이 지워지면 멈추고 (팝업에서) 묻습니다. 모든 변경은 기록되어 되돌릴 수 있고 하루 1번 스냅샷을 복원할 수 있습니다 — 둘 다 지금은 서버 API 로만 합니다([되돌리기·스냅샷](#되돌리기스냅샷)). 화면은 아직 없습니다.
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

스토어 등록 전입니다. Firefox 빌드는 만들어지고 타입 검사·Firefox 모양 북마크 트리로 엔진 시험을 하지만, **실제 Firefox 에서는 아직 돌려 보지 않았습니다**(끝-끝 시험은 Chromium 만).

> **Chrome 계정 동기화:** 같은 Google 계정으로 북마크 동기화를 켠 Chrome 프로필이 여럿이면 Chrome 이 `Everyfold` 폴더를 스스로 복제합니다. 그 프로필에서 Everyfold 를 연결하면(하나만 연결해도 됩니다) 첫 동기화 때 이미 복제된 폴더·북마크(같은 자리의 같은 폴더 이름·같은 URL)를 그대로 채택해 두 벌이 생기지 않습니다. 두 동기화가 서로 다투지 않게 그 프로필들에서는 Chrome 자체 북마크 동기화를 끄는 편이 낫습니다.

**3. 브라우저마다 연결**

툴바의 Everyfold 아이콘 → 서버 URL, 관리자 토큰, 기기 이름 → 연결. 관리자 토큰은 등록에 한 번만 쓰고 저장하지 않습니다.

이후 북마크를 바꿀 때, 5분마다, 창으로 돌아올 때 동기화됩니다.

**설정(브라우저마다, 팝업)**

- *새 북마크를 Everyfold 로 옮기기(Move)* — 기본 꺼짐. 꺼져 있으면 `Everyfold` 폴더 밖에서 만든 북마크를 카테고리 폴더에 **복사**하고 원본은 둡니다(두 개로 보임). 켜면 그 북마크 자체를 카테고리 폴더로 **옮겨** 하나만 남깁니다. 나중에 서버에서 그 변경을 되돌리면 지우지 않고 처음 만든 자리로 돌려놓습니다. 첫 연결 뒤 팝업이 이 설정을 한 번 안내하며, 켜기 전에는 아무것도 옮기지 않습니다.
- *Suggest cleanup(정리 제안)* — 서버에 정리 제안을 요청합니다(미분류를 규칙대로 정리·빈 카테고리 지우기·LLM 이 제안한 새 카테고리). 각 제안은 *Apply* 를 눌러야 적용됩니다.

**언어.** 기본 카테고리 이름·서버 문구·LLM 제안 이름은 영어/한국어가 있습니다. Worker 에 `LOCALE` 변수(`en` 또는 `ko`)를 두면 그 언어, 없으면 처음 연결한 브라우저의 언어(둘 다 아니면 영어)를 씁니다.

## 되돌리기·스냅샷

지금은 API 로 합니다(기기 토큰 사용 — 확장에 저장된 것, 또는 관리자 토큰으로 `POST /devices` 해서 새로 발급):

```sh
S=https://everyfold.<you>.workers.dev; T=<기기 토큰>
curl -H "authorization: Bearer $T" "$S/changes?limit=20"                       # 최근 변경 묶음(최신순)
curl -H "authorization: Bearer $T" -X POST "$S/changes/undo" -H 'content-type: application/json' -d '{"batchId":"<batch_id>"}'
curl -H "authorization: Bearer $T" "$S/snapshots"                               # 매일(KST 03:00) + 수동 스냅샷
curl -H "authorization: Bearer $T" -X POST "$S/snapshots"                       # 지금 하나 만들기
curl -H "authorization: Bearer $T" -X POST "$S/snapshots/<id>/restore"          # 복원 전 스냅샷을 먼저 남김
```

되돌리기는 그 묶음이 건드린 노드를 묶음 직전 상태로 "새 변경" 으로 다시 씁니다(그래서 되돌리기도 다시 되돌릴 수 있음). 브라우저는 다음 동기화 때 반영합니다.

## Cloudflare 무료 플랜

무료 플랜 Worker 요청 하나는 D1 호출을 50번까지 할 수 있습니다. push 는 D1 batch 한 번으로 쓰고 폴더 삭제는 문 하나라서, 크기가 커져도 D1 호출 수가 늘지 않습니다(시험: 섞인 op 300개 push = 15번 이하, 25번 넘으면 실패). 무료 D1 에는 하루 읽기·쓰기 행 수 한도도 있어, 수만 개 규모는 들어가지만 아주 큰 라이브러리의 첫 가져오기는 하루 쓰기 한도를 넘을 수 있습니다.

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
- 기본 카테고리 이름은 영어·한국어만 있습니다(위 *언어*). 이름은 마음대로 바꿔도 되고, 바꾼 이름도 동기화되며 분류는 바뀐 폴더로 계속 들어갑니다.
- Safari 미지원. 스토어(Chrome 웹 스토어·AMO) 등록 전.
- 첫 연결 뒤 각 브라우저에는 원래 북마크와 `Everyfold` 사본이 함께 있습니다(의도된 동작). 새 북마크는 *Move* 설정으로 복사 대신 옮길 수 있습니다.
- 되돌리기·스냅샷·충돌 기록은 아직 화면이 없습니다(API 만).

기여: [CONTRIBUTING.md](CONTRIBUTING.md) · 라이선스: [MIT](LICENSE)

---

Made by Chanyoung Jeong ([@xero0429](https://github.com/xero0429))

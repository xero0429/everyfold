# Chrome Web Store listing — DRAFT, not submitted

> Draft for the later store step (owner decision 2026-11-23: Deploy-button test → public repo + release zips → stores a few days later). Nothing here has been submitted. Submitting is done by the owner in the developer dashboard.

Package: `pnpm package:chrome` → `apps/extension/dist/store/everyfold-chrome-<version>.zip` (manifest at the zip root, `_locales/en` + `_locales/ko` inside).
Screenshots: `pnpm --filter @everyfold/extension store-shots` → `apps/extension/dist/store/screenshots/` (1280×800; light set committed in `docs/store/screenshots/`).
Small promo tile (440×280 PNG): `docs/store/promo-tile-440x280.png` — rebuild with `node apps/extension/scripts/promo-tile.mjs`. Marquee (1400×560) is not made (optional; only needed to be featured).
Store icon (128×128 PNG): `apps/extension/static/icons/icon-128.png`.
Privacy policy URL: `https://github.com/xero0429/everyfold/blob/main/PRIVACY.md`
Publisher display name: **Logan** · account type: **non-trader**.

Checked against the manifest of 0.1.2 (`apps/extension/scripts/build.mjs`): `permissions` = `bookmarks`, `storage`, `alarms`; no `host_permissions`, no `optional_permissions`, no content scripts. The code also uses `runtime` messaging and `windows.onFocusChanged` (sync when a window gets focus), which need no permission.

## Store listing

**Name:** Everyfold

**Summary** — not typed in the dashboard: the store shows the manifest `description`, which comes from `apps/extension/static/_locales/<locale>/messages.json` → `extDescription` (limit 132 characters, checked by `test/locales.test.ts`):

> en (123): Sync one bookmark library across Chrome, Edge, Brave and Firefox, auto-sorted into folders — on your own Cloudflare Worker.
>
> ko (80): Chrome·Edge·Brave·Firefox 북마크를 하나로 동기화하고 폴더별로 자동 정리합니다 — 내 Cloudflare Worker 에서.

**Category:** Productivity (Workflow & planning) · **Language:** English (default locale `en`; Korean listing below)

**Homepage URL:** `https://github.com/xero0429/everyfold` · **Support URL:** `https://github.com/xero0429/everyfold/issues` · **Mature content:** off

**Detailed description** (English; no character limit is published — the text is 1,665 characters; ko 968):

```
Everyfold keeps one bookmark library on a server you own and mirrors it into an "Everyfold" folder in every browser you connect. New bookmarks are sorted into category folders automatically.

You need your own Everyfold server first. It is free and open source: a single Cloudflare Worker + D1 database you deploy to your own Cloudflare account with one click from GitHub (github.com/xero0429/everyfold). For personal use the free Cloudflare plan is usually enough (check Cloudflare's current limits). There is no Everyfold account and no Everyfold company server — your bookmarks go only to the server you deploy.

• Real browser bookmarks — the Everyfold folder lives in your normal bookmarks, no new app to open.
• Your existing folders are never touched — on first connect your bookmarks are copied into the library and duplicates are merged.
• Auto-organized — built-in domain rules, plus what it learns from where you move things. Optional LLM categorizing (Claude) if you add your own Anthropic API key to your server. New categories are only ever suggested; nothing appears until you approve it.
• Safe by default — deleting 20% or more of your bookmarks in one sync pauses and asks first. Every change is recorded on your server and can be undone; a snapshot is taken daily.
• Import from other tools — browser HTML exports, Floccus, Karakeep, Linkwarden, Raindrop.io.
• Copy or move — keep new bookmarks where you saved them (a categorized copy is added), or move them straight into their category.

Setup: deploy the server (5 minutes), then click the toolbar icon and enter your server URL and admin token.

Open source (MIT). Source, setup guide and issues: https://github.com/xero0429/everyfold
```

## Korean listing (ko)

In the dashboard, switch the language dropdown at the top of *Store listing* to **Korean** and paste the description below. The summary comes from `_locales/ko` automatically. Screenshots and promo tiles can stay the English ones (promo tiles are not localized; localized screenshots are optional).

**Detailed description (ko):**

```
Everyfold 는 북마크 라이브러리 하나를 내가 가진 서버에 두고, 연결한 모든 브라우저의 "Everyfold" 폴더에 똑같이 비춰 줍니다. 새 북마크는 카테고리 폴더로 자동 정리됩니다.

먼저 내 Everyfold 서버가 있어야 합니다. 무료 오픈 소스이며, GitHub(github.com/xero0429/everyfold)에서 버튼 한 번으로 내 Cloudflare 계정에 배포하는 Cloudflare Worker + D1 데이터베이스 하나입니다. 개인 사용은 보통 Cloudflare 무료 요금제로 충분합니다(한도는 Cloudflare 의 현재 안내를 확인하세요). Everyfold 계정도, Everyfold 회사 서버도 없습니다 — 북마크는 내가 배포한 서버로만 갑니다.

• 진짜 브라우저 북마크 — Everyfold 폴더가 평소 북마크 안에 있어서 따로 앱을 열 필요가 없습니다.
• 기존 폴더는 건드리지 않습니다 — 처음 연결할 때 북마크를 라이브러리로 복사하고 중복은 합칩니다.
• 자동 정리 — 내장 도메인 규칙에, 내가 옮긴 위치에서 배운 것을 더합니다. 내 서버에 Anthropic API 키를 넣으면 LLM 분류(Claude)도 쓸 수 있습니다(선택). 새 카테고리는 제안만 하고, 내가 승인하기 전에는 아무것도 생기지 않습니다.
• 기본이 안전 — 한 번의 동기화로 북마크의 20% 이상을 지우면 멈추고 먼저 묻습니다. 모든 변경은 서버에 기록되어 되돌릴 수 있고, 매일 스냅샷을 남깁니다.
• 다른 도구에서 가져오기 — 브라우저 HTML 내보내기, Floccus, Karakeep, Linkwarden, Raindrop.io.
• 복사 또는 이동 — 새 북마크를 저장한 자리에 두고 분류된 사본을 더하거나, 바로 카테고리 폴더로 옮깁니다.

설정: 서버를 배포한 뒤(5분), 툴바 아이콘을 눌러 서버 URL 과 관리자 토큰을 넣으면 끝입니다.

오픈 소스(MIT). 소스·설정 안내·문의: https://github.com/xero0429/everyfold
```

## Privacy practices tab

All text on this tab is English only (not localized).

**Single purpose description:**

> Everyfold syncs the user's browser bookmarks with a bookmark server the user deploys themselves, and organizes them into category folders inside a dedicated "Everyfold" bookmarks folder.

**Permission justifications:**

| Permission (one field each; all under 400 characters) | Justification |
|---|---|
| `bookmarks` | Core feature: reads the user's bookmarks to upload them to the user's own server, and creates/updates/moves/removes bookmarks inside the extension's own "Everyfold" folder to mirror the synced library. Bookmarks outside that folder are only read (and, only if the user turns on the "Move new bookmarks" setting, a newly created bookmark is moved into its category). |
| `storage` | Stores the user's server URL, device name, device token and sync state locally so syncing can resume after a restart. |
| `alarms` | Runs a background sync every 5 minutes so changes made in other browsers appear without opening the popup. |
| Host permissions | No field to fill: the manifest has **no** `host_permissions`. The server is a URL the user types in; the user's server answers with CORS headers (`Access-Control-Allow-Origin: *`, token in the `Authorization` header, no cookies), so the extension can reach it with plain `fetch` without any host permission. |

**Remote code:** No, I am not using remote code. (All JavaScript is bundled in the package; the extension only exchanges JSON with the user's server.)

**Data usage — what user data do you plan to collect?** "Collect" here includes sending data off the device, even to the user's own server, so disclose conservatively (same as the AMO manifest, which declares `bookmarksInfo` + `authenticationInfo`). Tick:
- [x] **Authentication information** — the device token for the user's self-hosted server (stored locally; the admin token is sent once to that server to register and is not stored).
- [x] **Web history** — bookmark titles and URLs (the closest listed category; there is no "bookmarks" category). They are sent only to the server the user configured. The extension does not read browsing history.
- Leave unticked: Personally identifiable information, Health information, Financial and payment information, Personal communications, Location, User activity, Website content.

Certify:
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## Test instructions tab

Reviewers need a server to connect to. Before submitting, the owner deploys a throwaway server (own Cloudflare account: *Deploy to Cloudflare* button from the README, Worker name `everyfold-review`, a fresh `ADMIN_TOKEN` from `openssl rand -hex 32`), registers nothing, and puts this in the *Test instructions* tab (if it has separate username/password fields, leave them empty — the URL and token are in the text):

```
1. Click the toolbar icon. Server URL: https://everyfold-review.<subdomain>.workers.dev
2. Token type: Admin token. Token: <review admin token>. Device name: review.
3. Click Connect. An "Everyfold" folder appears under Other bookmarks with categories.
4. Add any bookmark (Ctrl+D) outside that folder; within a few seconds a copy appears in its category folder.
The review server will be deleted after review.
```
Delete that Worker (or rotate `ADMIN_TOKEN`) once the review is done. Keep it for later updates too: every new version is reviewed again.

## Distribution tab

Visibility **Public** · Regions **All regions** · **Free** (no in-app payments).

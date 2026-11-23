# Chrome Web Store listing — DRAFT, not submitted

> Draft for the later store step (owner decision 2026-11-23: Deploy-button test → public repo + release zips → stores a few days later). Nothing here has been submitted.

Package: `pnpm package:chrome` → `apps/extension/dist/store/everyfold-chrome-<version>.zip` (manifest at the zip root).
Screenshots: `pnpm --filter @everyfold/extension store-shots` → `apps/extension/dist/store/screenshots/` (1280×800; light set committed in `docs/store/screenshots/`).
Privacy policy URL: `https://github.com/xero0429/everyfold/blob/main/PRIVACY.md`

## Store listing

**Name:** Everyfold

**Short description** (≤ 132 chars):

> Sync one bookmark library across Chrome, Edge, Brave and Firefox, auto-sorted into folders — on your own Cloudflare Worker.

**Category:** Productivity (Workflow & planning) · **Language:** English

**Detailed description:**

```
Everyfold keeps one bookmark library on a server you own and mirrors it into an "Everyfold" folder in every browser you connect. New bookmarks are sorted into category folders automatically.

You need your own Everyfold server first. It is free and open source: a single Cloudflare Worker + D1 database you deploy to your own Cloudflare account with one click from GitHub (github.com/xero0429/everyfold). The free Cloudflare plan is enough for personal use. There is no Everyfold account and no Everyfold company server — your bookmarks go only to the server you deploy.

• Real browser bookmarks — the Everyfold folder lives in your normal bookmarks, no new app to open.
• Your existing folders are never touched — on first connect your bookmarks are copied into the library and duplicates are merged.
• Auto-organized — built-in domain rules, plus what it learns from where you move things. Optional LLM categorizing (Claude) if you add your own Anthropic API key to your server. New categories are only ever suggested; nothing appears until you approve it.
• Safe by default — deleting 20% or more of your bookmarks in one sync pauses and asks first. Every change is recorded on your server and can be undone; a snapshot is taken daily.
• Import from other tools — browser HTML exports, Floccus, Karakeep, Linkwarden, Raindrop.io.
• Copy or move — keep new bookmarks where you saved them (a categorized copy is added), or move them straight into their category.

Setup: deploy the server (5 minutes), then click the toolbar icon and enter your server URL and admin token.

Open source (MIT). Source, setup guide and issues: https://github.com/xero0429/everyfold
```

## Privacy practices tab

**Single purpose:**

> Everyfold syncs the user's browser bookmarks with a bookmark server the user deploys themselves, and organizes them into category folders inside a dedicated "Everyfold" bookmarks folder.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `bookmarks` | Core feature: reads the user's bookmarks to upload them to the user's own server, and creates/updates/moves/removes bookmarks inside the extension's own "Everyfold" folder to mirror the synced library. Bookmarks outside that folder are only read (and, only if the user turns on the "Move new bookmarks" setting, a newly created bookmark is moved into its category). |
| `storage` | Stores the user's server URL, device name, device token and sync state locally so syncing can resume after a restart. |
| `alarms` | Runs a background sync every 5 minutes so changes made in other browsers appear without opening the popup. |
| Host permissions | **None requested.** The server is a URL the user types in; the user's server answers with CORS headers (`Access-Control-Allow-Origin: *`, token in the `Authorization` header, no cookies), so the extension can reach it with plain `fetch` without any host permission. |

**Remote code:** No, I am not using remote code. (All JavaScript is bundled in the package; the extension only exchanges JSON with the user's server.)

**Data usage — what user data do you collect?** Tick only:
- *Web history*: **No** · *Personally identifiable information*: **No** · *Authentication information*: the device token for the user's own server is stored locally — tick **Authentication information** to be safe, with the note "token for the user's self-hosted server, stored locally only".
- Bookmarks are not a listed category; describe them in the single-purpose and privacy policy. (Chrome treats bookmark URLs as *Web history*-like data in some reviews — if the dashboard asks, tick **Web history** and state it is sent only to the user's own configured server.)

Certify:
- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## Test instructions for the reviewer

Reviewers need a server to connect to. Before submitting, deploy a throwaway server, register nothing, and put in the *Test instructions* field:

```
1. Click the toolbar icon. Server URL: https://everyfold-review.<subdomain>.workers.dev
2. Token type: Admin token. Token: <review admin token>. Device name: review.
3. Click Connect. An "Everyfold" folder appears under Other bookmarks with categories.
4. Add any bookmark (Ctrl+D) outside that folder; within a few seconds a copy appears in its category folder.
The review server will be deleted after review.
```
Delete that Worker (or rotate `ADMIN_TOKEN`) once the review is done.

# Firefox Add-ons (AMO) listing — DRAFT, not submitted

> Draft for the later store step (owner decision 2026-11-23: Deploy-button test → public repo + release zips → stores a few days later). Nothing here has been submitted.

- Add-on file: `pnpm package:firefox` → `apps/extension/dist/store/everyfold-firefox-<version>.zip`
- Source code (AMO asks for it because the add-on is bundled with esbuild): `pnpm package:source` → `apps/extension/dist/store/everyfold-source-<version>.zip` (= `git archive HEAD`; commit first)
- Add-on ID (gecko id, fixed forever once published): `everyfold@xero0429.github.io` — set in `apps/extension/scripts/build.mjs`, `strict_min_version` 140.0 (MV3 `background.scripts`; 140 = first Firefox with the built-in data-collection consent, ESR 140 included).
- Privacy policy: paste the text of `PRIVACY.md` (AMO stores the policy text itself).
- Screenshots: same 1280×800 set as Chrome (`docs/store/screenshots/`).
- License: MIT. Categories: *Bookmarks*. Support site: https://github.com/xero0429/everyfold/issues

**Summary** (≤ 250 chars):

> Sync one bookmark library across Firefox and Chromium browsers, auto-sorted into folders — on a free Cloudflare Worker you deploy yourself. No account, no third-party server: your bookmarks go only to your own server.

**Description:** reuse the Chrome detailed description (`docs/store/chrome-web-store.md`).

**Data collection** — required for new AMO add-ons since 2025-11-03. The manifest declares
`browser_specific_settings.gecko.data_collection_permissions = { required: ["bookmarksInfo", "authenticationInfo"] }`:
bookmarks and the device/admin token leave the add-on, although only to the server the user configured (Mozilla's docs do not carve out self-hosted servers, so we declare it). Firefox shows these in its built-in consent prompt at install time.

## Notes to reviewer (paste into "Notes for reviewers")

```
Build from source (Node 22, pnpm 9 via corepack):
  corepack enable
  pnpm install --frozen-lockfile
  pnpm build:extension
The add-on is apps/extension/dist/firefox/ (zip of that folder = the uploaded file).
`pnpm package:firefox` builds and zips it reproducibly (fixed timestamps, sorted entries).
Bundler: esbuild (apps/extension/scripts/build.mjs). No minification, no remote code.

Testing needs a server (self-hosted Cloudflare Worker):
  Server URL: https://everyfold-review.<subdomain>.workers.dev
  Token type: Admin token, token: <review admin token>
```

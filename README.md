Everyfold — one bookmark library for every browser, auto-organized.

[![CI](https://github.com/xero0429/everyfold/actions/workflows/ci.yml/badge.svg)](https://github.com/xero0429/everyfold/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[English](README.md) · [한국어](README.ko.md)

<!-- TODO: demo GIF (connect two browsers → bookmark in one → appears categorized in the other) -->
![Everyfold demo](docs/demo.gif)

Everyfold keeps **one bookmark library on your own Cloudflare account** and mirrors it into an `Everyfold` folder in every browser you connect (Chrome and Firefox today). New bookmarks are sorted into category folders automatically — by built-in domain rules, by what you've taught it, and optionally by an LLM.

- **Real browser bookmarks.** No new app to open: the `Everyfold` folder lives in each browser's own bookmarks (Chrome: *Other bookmarks*, Firefox: *Other Bookmarks*).
- **Your existing folders are never touched.** On first connect your bookmarks are *copied* into the library (duplicates merged); the originals stay where they are.
- **Auto-categorized.** Rules → learned from your moves → optional Claude Haiku. An LLM can only *suggest* a new category; nothing new appears until you approve it.
- **Safe by default.** Deleting ≥ 20% of bookmarks in one sync pauses and asks first. Every change is in a history you can undo, plus a daily snapshot you can restore.
- **Self-hosted, free tier friendly.** A single Cloudflare Worker + D1 database. No Docker, no VPS.
- **Import from other tools.** Netscape HTML (every browser), Floccus (XBEL / HTML), Karakeep (JSON), Linkwarden (JSON), Raindrop.io (CSV / HTML).

## 5-minute setup

**1. Deploy the server**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/xero0429/everyfold)

The button forks the repo to your account, creates the D1 database, runs the migrations (the `deploy` script = `wrangler d1 migrations apply DB --remote && wrangler deploy`) and asks for:

| Secret | |
|---|---|
| `ADMIN_TOKEN` | Required. You paste it into the extension once per browser. Use a long random string (`openssl rand -hex 32`). |
| `ANTHROPIC_API_KEY` | Optional. Enables LLM categorizing. Without it, rules + learned categories are used. |

You get a URL like `https://everyfold.<your-subdomain>.workers.dev`.

<details><summary>Or deploy from the command line</summary>

```sh
git clone https://github.com/xero0429/everyfold && cd everyfold
corepack enable && pnpm install
npx wrangler d1 create everyfold        # paste the database_id into wrangler.toml
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put ANTHROPIC_API_KEY   # optional
pnpm run deploy
```
</details>

**2. Install the extension**

```sh
pnpm install && pnpm build:extension     # → apps/extension/dist/chrome, apps/extension/dist/firefox
```

- Chrome / Edge / Brave: `chrome://extensions` → *Developer mode* → *Load unpacked* → `apps/extension/dist/chrome`
- Firefox: `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → `apps/extension/dist/firefox/manifest.json`

(Store listings are not published yet.)

**3. Connect each browser**

Click the Everyfold toolbar icon → enter the server URL, the admin token and a device name → *Connect*. The admin token is used once to register the browser and is not stored; the browser keeps its own device token.

That's it. Bookmarks sync when you change them, every 5 minutes, and when a browser window regains focus.

## How it works

```
 Chrome ──┐                      ┌── Cloudflare Worker (Hono)
 Firefox ─┼── Everyfold folder ⇄ │     /sync/pull  /sync/push   (revision log, conflict rules)
 …        ┘   (extension)        │     /import  /categories  /suggestions  /snapshots  /changes/undo
                                 └── D1 (SQLite)
```

- The extension diffs its `Everyfold` folder against the last synced state, pushes the changes and pulls everyone else's. Concurrent changes merge per field: if two browsers change different fields both survive; for the same field the change already on the server wins; an edit beats a concurrent delete. Every discarded value is kept at `/conflicts`.
- A bookmark you create *outside* the `Everyfold` folder is captured: the server categorizes it and a copy appears in the right category folder.
- Categorizing runs in order: built-in domain rules → domains/keywords learned from where you moved things → LLM (only for what's left, only if a key is set). New categories proposed by the LLM become **suggestions** you approve or dismiss in the popup.

## Run locally

```sh
corepack enable && pnpm install
cp .dev.vars.example .dev.vars        # set ADMIN_TOKEN
pnpm dev                              # wrangler dev + local D1 on http://localhost:8787
pnpm build:extension                  # then load dist/chrome and connect to http://localhost:8787
pnpm typecheck && pnpm test           # unit + server (local D1) + extension engine tests
pnpm --filter @everyfold/extension e2e   # real Chromium + wrangler dev (needs: npx playwright-core install chromium)
```

## Compared to

| | Everyfold | [Floccus](https://github.com/floccusaddon/floccus) | [Karakeep](https://github.com/karakeep-app/karakeep) | [Linkwarden](https://github.com/linkwarden/linkwarden) | [TidyMark](https://github.com/PanHywel/TidyMark) |
|---|---|---|---|---|---|
| What it is | Cross-browser bookmark sync + auto-organizer | Bookmark sync extension (+ mobile apps) | Bookmark-everything / read-it-later app | Collaborative bookmark manager & archiver | Bookmark organizer extension |
| Syncs native browser bookmarks across browsers | Yes (its `Everyfold` folder) | Yes | Via Floccus | Via Floccus | No |
| Auto-categorizing | Rules + learned + optional LLM (new categories need approval) | — | LLM auto-tagging (OpenAI or Ollama) | Optional AI tagging | Rules + optional AI |
| Backend | Your Cloudflare Worker + D1 | Your choice: Nextcloud, WebDAV, Git, Google Drive, Linkwarden, Karakeep, … | Docker server (or paid cloud) | Docker server (or paid cloud) | None (extension only) |
| License | MIT | MPL-2.0 | AGPL-3.0 | AGPL-3.0 | MIT |

Everyfold is not a read-it-later or archiving tool; if you want full-page archives, Karakeep and Linkwarden are great, and you can import from both.

## Known limitations

- Sibling order inside folders is not synced yet (new items are appended).
- The default category names are currently Korean (`개발`, `뉴스`, `쇼핑`, …); rename them as you like — renames sync.
- Safari is not supported. Store listings (Chrome Web Store, AMO) are not published yet.
- After the first connect, each browser has both its original bookmarks and the `Everyfold` copy, by design.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under the [MIT License](LICENSE).

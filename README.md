<p align="center">
  <img src="apps/extension/static/icons/icon-128.png" width="88" height="88" alt="Everyfold logo">
</p>

<h1 align="center">Everyfold</h1>

<p align="center">
  <b>Self-hosted bookmark sync for Chrome, Edge, Brave and Firefox — one library in every browser, auto-organized into folders, on your own free Cloudflare Worker.</b>
</p>

<p align="center">
  <a href="https://github.com/xero0429/everyfold/releases/latest"><img src="https://img.shields.io/github/v/release/xero0429/everyfold?label=release&color=3150d0" alt="Latest release"></a>
  <a href="https://github.com/xero0429/everyfold/actions/workflows/ci.yml"><img src="https://github.com/xero0429/everyfold/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://chromewebstore.google.com/detail/everyfold/jkdaehjboglabiaebmpnkgecmkkihgbd"><img src="https://img.shields.io/chrome-web-store/v/jkdaehjboglabiaebmpnkgecmkkihgbd?label=Chrome%20Web%20Store&logo=googlechrome&logoColor=white&color=4285F4" alt="Chrome Web Store"></a>
  <a href="#2-install-the-extension"><img src="https://img.shields.io/badge/Chrome%20%C2%B7%20Edge%20%C2%B7%20Brave-MV3-4285F4?logo=googlechrome&logoColor=white" alt="Chrome, Edge, Brave (Manifest V3)"></a>
  <a href="#2-install-the-extension"><img src="https://img.shields.io/badge/Firefox-140%2B%20(preview)-FF7139?logo=firefoxbrowser&logoColor=white" alt="Firefox 140+ (preview)"></a>
  <a href="#1-deploy-the-server"><img src="https://img.shields.io/badge/Cloudflare%20Workers-free%20plan-F38020?logo=cloudflare&logoColor=white" alt="Runs on the Cloudflare Workers free plan"></a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a> · <a href="#quick-start">Quick start</a> · <a href="#faq">FAQ</a> · <a href="#compared-to-other-bookmark-managers">Compared to</a>
</p>

<p align="center">
  <img src="docs/assets/everyfold-demo.gif" width="900" alt="Demo: connect the Everyfold extension to your server, your bookmarks are copied into an Everyfold folder in Chrome and Firefox, a new bookmark saved in Chrome is sorted into the Recipes category in both browsers, and cleanup suggestions wait for approval.">
</p>

Everyfold is an open-source **cross-browser bookmark sync** and **auto bookmark organizer**. It keeps **one bookmark library on your own free Cloudflare Worker** (one-click deploy from GitHub) and mirrors it into an `Everyfold` folder in every browser you connect — Chrome, Edge, Brave and Firefox today. New bookmarks are sorted into category folders automatically — by built-in domain rules, by what you've taught it, and optionally by an AI (LLM).

There is no Everyfold account and no Everyfold-run server: **you deploy the server once** (about 5 minutes, Cloudflare's free plan is enough) **and update it when a new version comes out** (one click in GitHub Actions — see [Updating your server](#updating-your-server)). Your bookmarks only ever go to that server.

## Features

- 🔖 **Real browser bookmarks.** No new app to open: the `Everyfold` folder lives in each browser's own bookmarks (Chrome: *Other bookmarks*, Firefox: *Other Bookmarks*).
- 🔄 **Syncs across browsers.** Chrome, Edge, Brave and Firefox (preview) share one library; changes sync when you make them, every 5 minutes, and when a window regains focus.
- 🗂️ **Auto-categorized.** Rules → learned from your moves → optional Claude Haiku. An LLM can only *suggest* a new category; nothing new appears until you approve it.
- 🛡️ **Your existing folders are never touched, and big deletes wait for you.** On first connect your bookmarks are *copied* into the library (duplicates merged); the originals stay where they are. Deleting ≥ 20% of bookmarks in one sync pauses and asks first (in the popup). Every change is recorded in a history you can undo, and a daily snapshot can be restored — both through the server API for now (see [Undo and snapshots](#undo-and-snapshots)); there is no UI for them yet.
- ☁️ **Self-hosted, free tier friendly.** One Cloudflare Worker + D1 database in your Cloudflare account. No Docker, no VPS — but it is a server you own, so you also deploy its updates.
- 📥 **Import from other tools.** Netscape HTML (every browser), Floccus (XBEL / HTML), Karakeep (JSON), Linkwarden (JSON), Raindrop.io (CSV / HTML).

## Screenshots

<table>
  <tr>
    <td width="25%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/connect-dark.png"><img src="docs/assets/screens/connect-light.png" alt="Connect form: server URL, admin token and device name"></picture></td>
    <td width="25%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/connected-dark.png"><img src="docs/assets/screens/connected-light.png" alt="Popup after syncing: status, device, server and two cleanup suggestions to apply or dismiss"></picture></td>
    <td width="25%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/mass-dark.png"><img src="docs/assets/screens/mass-light.png" alt="Sync paused before a large delete, asking to undo or confirm"></picture></td>
    <td width="25%" valign="top"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/assets/screens/settings-dark.png"><img src="docs/assets/screens/settings-light.png" alt="Settings: copy or move new bookmarks into Everyfold"></picture></td>
  </tr>
  <tr>
    <td align="center"><b>Connect</b> a browser</td>
    <td align="center"><b>Synced</b>, with cleanup ideas</td>
    <td align="center"><b>Big deletes</b> wait for you</td>
    <td align="center"><b>Copy or move</b> new bookmarks</td>
  </tr>
</table>

## Quick start

1. **Deploy your server** — click [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/xero0429/everyfold) and set an `ADMIN_TOKEN` (`openssl rand -hex 32`). You get `https://everyfold.<your-subdomain>.workers.dev`. → [details](#1-deploy-the-server)
2. **Install the extension** — Chrome, Edge, Brave: from the [Chrome Web Store](https://chromewebstore.google.com/detail/everyfold/jkdaehjboglabiaebmpnkgecmkkihgbd). Firefox: load the zip from the [latest release](https://github.com/xero0429/everyfold/releases/latest) as a temporary add-on (the Firefox Add-ons listing is not published yet). → [details](#2-install-the-extension)
3. **Connect each browser** — click the Everyfold icon, paste the server URL and admin token, name the device, *Connect*. → [details](#3-connect-each-browser)

Then, once: [add the update workflow to your copy](#updating-your-server) so future server updates are one click.

## 5-minute setup (in detail)

### 1. Deploy the server

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/xero0429/everyfold)

The button copies this repository into **a new repository in your GitHub account** (a copy, not a GitHub fork), creates the D1 database, connects the new repository to [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) (every push to it redeploys) and runs the `deploy` script, which applies the D1 migrations before deploying (`wrangler d1 migrations apply DB --remote && wrangler deploy`). It asks for `ADMIN_TOKEN`:

| Secret | |
|---|---|
| `ADMIN_TOKEN` | Required. You paste it into the extension once per browser. Use a long random string (`openssl rand -hex 32`). |
| `ANTHROPIC_API_KEY` | Optional, not asked by the button. Enables LLM categorizing; without it, rules + learned categories are used. Add it after deploying: Worker → **Settings → Variables and Secrets** → Add (type Secret), or `npx wrangler secret put ANTHROPIC_API_KEY`. |

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

### 2. Install the extension

**Chrome, Edge, Brave (any Chromium browser)**

Install Everyfold from the [Chrome Web Store](https://chromewebstore.google.com/detail/everyfold/jkdaehjboglabiaebmpnkgecmkkihgbd) and pin it from the puzzle-piece menu so the icon stays in the toolbar. The browser keeps it up to date. In Edge, allow extensions from other stores when it asks.

Already using a developer-mode copy from a release zip? The store version is a separate extension: remove the unpacked one in `chrome://extensions`, then connect the store version (step 3).

<details><summary>Or install a release zip in developer mode</summary>

1. Download `everyfold-chrome-<version>.zip` from the latest release and unzip it into a folder you will keep, e.g. `~/Everyfold/chrome` (don't delete it — the browser loads the extension from there).
2. Open `chrome://extensions` (Edge: `edge://extensions`, Brave: `brave://extensions`) and turn on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder (the one with `manifest.json` in it).
4. Pin Everyfold from the puzzle-piece menu so the icon stays in the toolbar.

Chrome may show a "developer mode extensions" notice at startup; that is expected for extensions not installed from the store.

**Updating:** download the new zip and unzip it **over the same folder** (replace the files), then click the reload ↻ button on the Everyfold card in `chrome://extensions`. Keep the folder path the same: Chrome derives an unpacked extension's identity from its path, and a different folder counts as a new extension (you would have to connect it again).

</details>

**Firefox (140 or later)**

Firefox Add-ons doesn't list Everyfold yet, so Firefox uses the zip from the [Releases page](https://github.com/xero0429/everyfold/releases/latest).

1. Download `everyfold-firefox-<version>.zip`.
2. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick the zip (or `manifest.json` inside the unzipped folder).

Firefox removes temporary add-ons when it restarts, and release Firefox installs only add-ons signed by Mozilla, so for now Firefox is for trying it out. A signed build comes with the Firefox Add-ons listing. (Firefox Developer Edition / Nightly can install the zip permanently with `xpinstall.signatures.required = false` in `about:config`.)

<details><summary>Build it yourself instead</summary>

```sh
pnpm install && pnpm build:extension     # → apps/extension/dist/chrome, apps/extension/dist/firefox
pnpm package:extension                    # → zips in apps/extension/dist/store/
```

Load `apps/extension/dist/chrome` with *Load unpacked*, or `apps/extension/dist/firefox/manifest.json` as a temporary add-on.
</details>

The Firefox build is produced and type-checked, and the sync engine is tested against Firefox-shaped bookmark trees, but it has **not yet been tried in a real Firefox** — only Chromium runs in the end-to-end test.

> **Chrome account sync:** if several Chrome profiles share one Google account with bookmark sync on, Chrome copies the `Everyfold` folder between them by itself. Connect Everyfold in those profiles anyway (or in only one of them): on its first sync the extension adopts the folders and bookmarks Chrome already copied (same folder name / same URL in the same place) instead of creating a second set. Turning Chrome's own bookmark sync off for those profiles avoids the two sync systems racing each other.

### 3. Connect each browser

Click the Everyfold toolbar icon → enter the server URL, the admin token and a device name → *Connect*. The admin token is used once to register the browser and is not stored; the browser keeps its own device token.

That's it. Bookmarks sync when you change them, every 5 minutes, and when a browser window regains focus.

**Settings (per browser, in the popup)**

- *Move new bookmarks into Everyfold* — off by default. When off, a bookmark you create outside the `Everyfold` folder is **copied** into its category folder and the original stays (so you see it twice). When on, the bookmark itself is **moved** into its category folder, leaving one copy. If you later undo that change on the server, the bookmark goes back to where you created it instead of being deleted. After the first connect the popup shows a one-time hint about this setting; nothing is moved until you turn it on.
- *Suggest cleanup* — asks the server for cleanup suggestions (sort unsorted bookmarks by rules, remove empty categories, new categories proposed by the LLM). Each suggestion is applied only when you click *Apply*.

**Language.** Default category names, server messages and LLM-proposed names come in English or Korean. Set the `LOCALE` variable (`en` or `ko`) on the Worker to choose; without it, the language of the first browser that connects is used (English if it is neither).

## Updating your server

The extension checks your server's version (`GET /version`) when it connects and about once an hour. If the server is older than the extension expects, the popup shows **Server is out of date** with a link here. Syncing keeps working; only a change that would otherwise damage data stops syncing ("Server update required") until you update.

Because the Deploy button made a *copy* of this repository (not a fork), GitHub's *Sync fork* button is not available. Use the update workflow instead.

**Once, after deploying: add the update workflow to your copy.** The Deploy button copies the code but not the `.github/workflows/` folder, so your copy has no workflow yet. Add it one time (replace `<you>/<repo>` with your copy — the repository name you chose in the Deploy form):

1. Open `https://github.com/<you>/<repo>/new/main?filename=.github/workflows/update-from-upstream.yml` (GitHub's *Add file → Create new file*, with the name already filled in).
2. Paste the whole content of [update-from-upstream.yml](https://raw.githubusercontent.com/xero0429/everyfold/main/.github/workflows/update-from-upstream.yml) unchanged — it already points at this repository, whatever your copy is called — and select **Commit changes** (to `main`).

   Or, with the [GitHub CLI](https://cli.github.com/) (it needs the `workflow` scope: `gh auth refresh -s workflow`):

   ```sh
   curl -fsSL https://raw.githubusercontent.com/xero0429/everyfold/main/.github/workflows/update-from-upstream.yml -o update-from-upstream.yml &&
   gh api -X PUT repos/<you>/<repo>/contents/.github/workflows/update-from-upstream.yml \
     -f message="Add update workflow" -f content="$(base64 < update-from-upstream.yml | tr -d '\n')"
   ```

This commit also triggers a normal redeploy; that is harmless. If **Actions** is off for your copy, turn it on under *Settings → Actions → General → Actions permissions*. The workflow asks for `contents: write` itself; if its push is refused (`403`), set *Settings → Actions → General → Workflow permissions* to **Read and write permissions**.

**Each update:**

1. Open your copy on GitHub → **Actions** → **Update from upstream** → **Run workflow** (branch `main`, upstream ref `main` or a release tag). The first time, GitHub may ask you to enable Actions for the repository.
2. The workflow commits the latest Everyfold code to your repository. It keeps your Worker name and your D1 `database_name` / `database_id` from `wrangler.toml` and the project `name` in `package.json`, and leaves `.github/workflows/` alone — GitHub does not let a workflow push changes to workflow files — and lists any that differ from upstream; to update one, repeat the one-time step above with that file (edit it on GitHub and paste the new content). It also logs the files it removed and any lines of your `wrangler.toml` it did not keep (put variables in the Cloudflare dashboard, not in `wrangler.toml`). If it cannot keep your settings safely — no `wrangler.toml`, a `wrangler.json`/`wrangler.jsonc` instead, or your `database_id` would be lost — it stops without changing anything; then update by hand with the merge below.
3. Workers Builds sees the push and redeploys. The `deploy` script applies new D1 migrations first, so the database schema is updated along with the code. Check the build under *Workers & Pages → everyfold → Deployments* in the Cloudflare dashboard.

Want automatic updates? Uncomment the `schedule:` lines in `.github/workflows/update-from-upstream.yml`.

<details><summary>From the command line, or if you changed the code yourself</summary>

The workflow runs `node scripts/update-from-upstream.mjs`, which **replaces** the code with upstream's (except the values above). If you keep your own changes, merge instead:

```sh
git remote add upstream https://github.com/xero0429/everyfold.git
git fetch upstream
git merge upstream/main --allow-unrelated-histories   # first time only needs --allow-unrelated-histories
# keep your database_id / name in wrangler.toml if it conflicts
git push                                               # Workers Builds redeploys
```

Deployed from the command line without Workers Builds? `git pull` (or the merge above), then `pnpm run deploy`.
</details>

Variables you set in the Cloudflare dashboard (such as `LOCALE`) survive redeploys (`keep_vars = true` in `wrangler.toml`); secrets always do.

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

## Undo and snapshots

These work through the API for now (use a device token — it is stored in the extension, or register one with `POST /devices` and the admin token):

```sh
S=https://everyfold.<you>.workers.dev; T=<device token>
curl -H "authorization: Bearer $T" "$S/changes?limit=20"                       # recent change batches (newest first)
curl -H "authorization: Bearer $T" -X POST "$S/changes/undo" -H 'content-type: application/json' -d '{"batchId":"<batch_id>"}'
curl -H "authorization: Bearer $T" "$S/snapshots"                               # daily (03:00 KST cron) + manual snapshots
curl -H "authorization: Bearer $T" -X POST "$S/snapshots"                       # take one now
curl -H "authorization: Bearer $T" -X POST "$S/snapshots/<id>/restore"          # a pre-restore snapshot is taken first
```

Undo writes each node the batch touched back to its state just before the batch, as a new change (so an undo can itself be undone). Browsers pick it up on their next sync.

## Cloudflare Free plan

A Worker request on the Free plan may make at most 50 D1 calls. A push is written in one D1 batch and a folder delete is a single statement, so a push does not grow its D1 call count with its size (a test pushes 300 mixed operations in 15 or fewer calls; it fails above 25). Free D1 also caps rows read/written per day; a library of tens of thousands of bookmarks fits, but the very first import of a huge library may take more than one day's write quota.

## Run locally (development)

```sh
corepack enable && pnpm install
cp .dev.vars.example .dev.vars        # set ADMIN_TOKEN (optionally uncomment ANTHROPIC_API_KEY)
pnpm dev                              # wrangler dev + local D1 on http://localhost:8787
pnpm build:extension                  # then load dist/chrome and connect to http://localhost:8787
pnpm typecheck && pnpm test           # unit + server (local D1) + extension engine tests
pnpm --filter @everyfold/extension e2e   # real Chromium + wrangler dev (needs: npx playwright-core install chromium)
pnpm package:extension                # store zips → apps/extension/dist/store/ (see docs/store/)
```

## Compared to other bookmark managers

| | Everyfold | [Floccus](https://github.com/floccusaddon/floccus) | [Karakeep](https://github.com/karakeep-app/karakeep) | [Linkwarden](https://github.com/linkwarden/linkwarden) | [TidyMark](https://github.com/PanHywel/TidyMark) |
|---|---|---|---|---|---|
| What it is | Cross-browser bookmark sync + auto-organizer | Bookmark sync extension (+ mobile apps) | Bookmark-everything / read-it-later app | Collaborative bookmark manager & archiver | Bookmark organizer extension |
| Syncs native browser bookmarks across browsers | Yes (its `Everyfold` folder) | Yes | Via Floccus | Via Floccus | No |
| Auto-categorizing | Rules + learned + optional LLM (new categories need approval) | — | LLM auto-tagging (OpenAI or Ollama) | Optional AI tagging | Rules + optional AI |
| Server you run | A Cloudflare Worker + D1 on your account (free plan; one-click deploy, one-click updates) | A backend of your choice: Nextcloud, WebDAV, Git, Google Drive, Linkwarden, Karakeep, … | A Docker server (or their paid cloud) | A Docker server (or their paid cloud) | None (extension only) |
| License | MIT | MPL-2.0 | AGPL-3.0 | AGPL-3.0 | MIT |

Everyfold is not a read-it-later or archiving tool; if you want full-page archives, Karakeep and Linkwarden are great, and you can import from both.

## FAQ

### Is Everyfold free?

Yes. Everyfold is MIT-licensed, and the server runs on Cloudflare's free Workers + D1 plan (see [Cloudflare Free plan](#cloudflare-free-plan) for the limits). The only optional cost is the AI categorizing: if you add an `ANTHROPIC_API_KEY`, Anthropic bills you for the Claude Haiku calls. Without a key, rules and learned categories do the sorting.

### Where are my bookmarks stored? Who can see them?

In the D1 database of the Worker you deployed, in your own Cloudflare account. There is no Everyfold account, no Everyfold-run server, no analytics and no telemetry. If you turn on the AI categorizing, your server sends the title and URL of bookmarks its rules could not place, with your category names, to Anthropic's API using your key. See [PRIVACY.md](PRIVACY.md).

### Will it rearrange my existing bookmarks?

No. On first connect your bookmarks are *copied* into the `Everyfold` folder (duplicates merged) and your own folders stay as they are. New bookmarks you save outside the folder are copied into a category by default; turn on *Move new bookmarks into Everyfold* if you'd rather have one copy.

### Which browsers work?

Chrome, Edge, Brave and other Chromium browsers (Manifest V3), and Firefox 140 or later. The Firefox build is new and has not been tried in a real Firefox yet, so treat it as a preview. Safari and mobile browsers are not supported.

### Do I need to know Cloudflare or run a server?

No terminal needed: the Deploy button creates the Worker and the database for you, and updates are one click in GitHub Actions. You do need a free Cloudflare account and a GitHub account.

### How is it different from Floccus, Raindrop.io or Karakeep?

Floccus syncs bookmarks through a backend you choose but doesn't organize them. Raindrop.io is a hosted bookmark service with its own app; Karakeep and Linkwarden are bookmark managers with their own app that you self-host with Docker (or use their paid cloud). Everyfold keeps your bookmarks in the browser's own bookmark bar and menus, brings its own free one-click server, and sorts new bookmarks into folders for you. See the [comparison table](#compared-to-other-bookmark-managers).

### Can I use it together with Chrome's own bookmark sync?

Yes; see the *Chrome account sync* note under [Install the extension](#2-install-the-extension).

## Known limitations

- Sibling order inside folders is not synced yet (new items are appended).
- Default category names exist in English and Korean only (see *Language*). Rename them as you like — renames sync, and categorizing keeps using the renamed folder.
- Safari is not supported. Firefox is not on Firefox Add-ons (AMO) yet: it is installed from the release zip as a temporary add-on, and updating it is manual (see *Install the extension*).
- After the first connect, each browser has both its original bookmarks and the `Everyfold` copy, by design. New bookmarks can be moved instead of copied with the *Move* setting.
- Undo, snapshots and the conflict log have no UI yet (API only).
- Server updates are not automatic unless you enable the schedule in the update workflow (see [Updating your server](#updating-your-server)).

## Privacy

No analytics, no telemetry, no Everyfold-run server. See [PRIVACY.md](PRIVACY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under the [MIT License](LICENSE).

---

Made by Chanyoung Jeong ([@xero0429](https://github.com/xero0429))

# Release checklist

Steps that need the owner's accounts (GitHub repo settings, Cloudflare login, store developer accounts) are marked **[owner]**. Everything else can be checked from a clone.

Order (owner decision 2026-11-23): **① Deploy button test → ② public repository + extension zips on GitHub Releases (developer-mode install) → ③ store listings a few days later.** Sections 1–2 and 0 are this release; 3–4 are the later store step.

## 0. Before making the repository public

- [ ] `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm build:extension` pass; `pnpm --filter @everyfold/extension e2e` passes.
- [ ] No secrets in history (`git log -p | grep -iE 'sk-ant|ADMIN_TOKEN=.+'` finds nothing but examples). `.dev.vars` is git-ignored.
- [ ] Optional: add `docs/demo.gif` and put `![Everyfold demo](docs/demo.gif)` back at the top of README.md / README.ko.md (the line was removed so the public page has no broken image).
- [ ] **[owner]** Make `github.com/xero0429/everyfold` public — the Deploy button only works on public repositories (so step ① needs the repository public, or a temporary public test copy).
- [ ] **[owner]** Release zips: on `main`, `git tag v0.1.0 && git push origin v0.1.0`. `.github/workflows/release.yml` runs typecheck + tests, checks the tag equals the server/extension versions, runs `pnpm package:extension` and creates the GitHub Release with `everyfold-chrome-*.zip`, `everyfold-firefox-*.zip`, `everyfold-source-*.zip` and `SHA256SUMS.txt`.
- [ ] Follow README *Install the extension* on a clean Chrome profile with the downloaded zip (Load unpacked → connect → sync), then the update steps (unzip the same zip over the folder → reload) and check the connection survived.

## 1. Deploy button dry run (pre-checked against the Cloudflare docs, needs a real run) **[owner]**

What the docs say and how this repo matches it (https://developers.cloudflare.com/workers/platform/deploy-buttons/):

| Docs | This repo |
|---|---|
| Reads the Wrangler config of the repo root (subdirectory deploys must be fully isolated) | `wrangler.toml` is at the root because `apps/server` imports `packages/core` (pnpm workspace) |
| Provisions resources and fills in IDs for new resources (e.g. D1 `database_id`) | `[[d1_databases]] binding = "DB"`, `database_name = "everyfold"`, no `database_id` |
| Migrations run only if the `deploy` script runs them, using the **binding** name | `"deploy": "wrangler d1 migrations apply DB --remote && wrangler deploy"` (binding `DB`) |
| Custom `build`/`deploy` scripts are detected and pre-filled | root `package.json` has `deploy`; no `build` (Wrangler bundles) |
| Secret prompts come from `.dev.vars.example` / `.env.example`; descriptions from `package.json` `cloudflare.bindings` | `.dev.vars.example` lists `ADMIN_TOKEN`, `ANTHROPIC_API_KEY`; both described in `cloudflare.bindings` |
| The button **clones** into a new repo (no fork link) and sets up Workers Builds | update path = `.github/workflows/update-from-upstream.yml` (no "Sync fork") |

Run it for real:

- [ ] Open the README button in a private window, logged in to a test Cloudflare account and GitHub.
- [ ] The form shows the D1 database, `ADMIN_TOKEN` (required) and `ANTHROPIC_API_KEY` (optional) with their descriptions. Note whether leaving `ANTHROPIC_API_KEY` empty is accepted; if the form insists on a value, document "enter `-`"/remove it from `.dev.vars.example` and describe it only in the README.
- [ ] Workers Builds detects pnpm (from `pnpm-lock.yaml` / `packageManager`) and the deploy command is `pnpm run deploy` (or `npm run deploy`). The build log shows `Migrations to be applied: 0001_init.sql, 0002_category_keys.sql` then a successful deploy. Wrangler skips the "Ok to proceed?" prompt when it is not attached to a terminal (CI); if the build hangs or fails at that step, record the log and fix the `deploy` script.
- [ ] The new repo contains `.github/workflows/update-from-upstream.yml` (the docs don't say whether the Cloudflare GitHub App copies workflow files — without it there is no update path; if missing, document adding it by hand in the README).
- [ ] The new repo's Wrangler config is still **one `wrangler.toml`** (no `wrangler.json`/`wrangler.jsonc` written by Cloudflare). The update script stops if not, so if Cloudflare switches format the README update path must change.
- [ ] In the new repo, `wrangler.toml` now has a `database_id` (committed by Cloudflare) — confirm `scripts/update-from-upstream.mjs` keeps it (it carries `name`, `database_name`, `database_id`).
- [ ] `curl https://<worker>/version` → `{"service":"everyfold","version":"0.1.0","api":1,"minClientApi":1}`.
- [ ] Connect a browser with the admin token; first sync works.
- [ ] The cron trigger (`0 18 * * *`) appears under the Worker's *Triggers*.

## 2. Update path dry run **[owner]**

- [ ] Push a harmless upstream change (or tag), then in the test copy: *Actions → Update from upstream → Run workflow*.
- [ ] The workflow commits as `github-actions[bot]` and pushes; **Workers Builds starts a build for that push** (pushes made with `GITHUB_TOKEN` do not start other GitHub Actions, but they do send the push to the Cloudflare GitHub App — confirm it).
- [ ] A test migration (e.g. `0003_noop.sql` with `SELECT 1;`) is applied by the redeploy.
- [ ] A `LOCALE` variable set in the dashboard survives the redeploy (`keep_vars = true`).
- [ ] With the server one API version behind (deploy an older commit), the popup shows **Server is out of date**; after updating, the warning disappears on the next sync.

## 3. Chrome Web Store **[owner]** — later (③)

- [ ] Developer account registered (one-time US$5 fee), 2-step verification on.
- [ ] `pnpm package:chrome` → upload `apps/extension/dist/store/everyfold-chrome-<version>.zip`.
- [ ] Listing text, single purpose, permission reasons, data-use answers: `docs/store/chrome-web-store.md`.
- [ ] Screenshots: `docs/store/screenshots/*.png` (1280×800). Icon 128×128: `apps/extension/static/icons/icon-128.png`. Optional small promo tile 440×280 (not made yet).
- [ ] Privacy policy URL: `https://github.com/xero0429/everyfold/blob/main/PRIVACY.md` (needs the public repo).
- [ ] Deploy a throwaway review server and put its URL + admin token in *Test instructions*; delete it after approval.
- [ ] After approval: put the store link in README (*Install the extension*) and the popup's "How to update the extension" link.

## 4. Firefox Add-ons (AMO) **[owner]** — later (③)

- [ ] Try the build in a real Firefox ≥ 140 first (`about:debugging` → Load Temporary Add-on → `apps/extension/dist/firefox/manifest.json`): connect, sync, add a bookmark, check the built-in data-collection consent prompt lists bookmarks + authentication info. Then drop "not yet tried in a real Firefox" from the README.
- [ ] AMO developer account (free). `pnpm package:firefox` + `pnpm package:source` (commit first — the source zip is `git archive HEAD`).
- [ ] Listing text and reviewer notes: `docs/store/firefox-amo.md`. Add-on ID `everyfold@xero0429.github.io` (cannot change after the first upload).

## 5. Each release

- [ ] Bump `apps/server/package.json`, `apps/extension/package.json` (and core) to the same version; update `packages/core/src/version.ts` if the API changed (see CONTRIBUTING → *Versions and compatibility*).
- [ ] Tag `vX.Y.Z` on main; users can run *Update from upstream* with that tag as the ref.
- [ ] Upload new store packages after the server change is on `main` (servers can lag; the extension must keep working with `WARN_SERVER_BELOW`-level servers).

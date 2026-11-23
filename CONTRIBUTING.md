# Contributing to Everyfold

Thanks for helping! Everyfold is a small pnpm monorepo:

| Path | What |
|---|---|
| `packages/core` | Shared TypeScript: URL normalizing and dedup, sync protocol types, Netscape/XBEL/Karakeep/Linkwarden/Raindrop parsers, categorizer (rules → learned → optional LLM) |
| `apps/server` | Cloudflare Worker (Hono) + D1. Sync API, import, suggestions, snapshots, undo |
| `apps/extension` | WebExtension (Chrome + Firefox, Manifest V3). `src/engine.ts` is browser-agnostic and tested against the real server |

## Setup

```sh
corepack enable          # pnpm 9
pnpm install
pnpm typecheck
pnpm test                # core + server (local D1 via miniflare) + extension engine
```

Real-browser end-to-end test (starts `wrangler dev` with a local D1 and loads the unpacked extension in Chromium):

```sh
npx playwright-core install chromium   # once
pnpm build:extension
pnpm --filter @everyfold/extension e2e
```

## Versions and compatibility

The server and the extension update separately (servers update when their owner runs *Update from upstream*; extensions update from the stores), so a browser can meet an older or newer server.

- `packages/core/src/version.ts` holds the API range. When you change the server API, bump `API_VERSION`. If the new extension needs it, raise `WARN_SERVER_BELOW` (popup warns "Server is out of date", sync continues). Raise `BLOCK_SERVER_BELOW` only when talking to an older server would damage data (sync stops until the server is updated). Raise `MIN_CLIENT_API` when the server drops support for older extensions.
- Keep release versions in `apps/server/package.json` (served by `GET /version`) and `apps/extension/package.json` (the manifest version) in step.
- New D1 migrations go in `apps/server/migrations/`; the `deploy` script applies them before every deploy, including updates via Workers Builds. Migrations must work on a live database that already has data.

## Store packages

`pnpm package:extension` builds `apps/extension/dist/store/` (Chrome zip, Firefox zip, source zip for AMO). Listing text, permission reasons and reviewer notes live in `docs/store/`; the release steps are in `docs/RELEASE-CHECKLIST.md`.

## Pull requests

- Keep PRs focused; add or update tests for behaviour changes (`pnpm test` must pass — CI runs typecheck, tests and the extension build).
- Never delete or rewrite a user's existing browser folders. Everyfold only manages its own `Everyfold` folder.
- Anything that can remove many bookmarks must go through the mass-delete guard and be undoable.
- New importer? Add a small fixture under `packages/core/test/fixtures/import/`, cite where the format is defined (source file or docs) in the parser comment, and add a test.
- Don't commit secrets. Local secrets go in `.dev.vars` at the repo root (git-ignored).

By contributing you agree your contribution is licensed under the MIT License.

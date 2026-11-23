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

## Pull requests

- Keep PRs focused; add or update tests for behaviour changes (`pnpm test` must pass — CI runs typecheck, tests and the extension build).
- Never delete or rewrite a user's existing browser folders. Everyfold only manages its own `Everyfold` folder.
- Anything that can remove many bookmarks must go through the mass-delete guard and be undoable.
- New importer? Add a small fixture under `packages/core/test/fixtures/import/`, cite where the format is defined (source file or docs) in the parser comment, and add a test.
- Don't commit secrets. Local secrets go in `.dev.vars` at the repo root (git-ignored).

By contributing you agree your contribution is licensed under the MIT License.

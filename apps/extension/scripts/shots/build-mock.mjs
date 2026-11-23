// popup 을 가짜 runtime(mock-browser.mjs)과 함께 임시 폴더에 번들한다 — screenshots.mjs · a11y-smoke.mjs 공용.
import { build } from 'esbuild';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function buildMockPopup() {
  const work = mkdtempSync(join(tmpdir(), 'everyfold-popup-'));
  cpSync(join(root, 'static'), work, { recursive: true });
  await build({
    entryPoints: { popup: join(root, 'src/popup.ts') }, outdir: work, bundle: true, format: 'iife', target: 'chrome116', logLevel: 'warning',
    alias: { 'webextension-polyfill': join(root, 'scripts/shots/mock-browser.mjs') },
  });
  return { work, url: pathToFileURL(join(work, 'popup.html')).href };
}

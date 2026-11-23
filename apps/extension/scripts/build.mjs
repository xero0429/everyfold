// esbuild → dist/chrome (MV3 service_worker) + dist/firefox (MV3 background.scripts + gecko id)
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse((await import('node:fs')).readFileSync(join(root, 'package.json'), 'utf8'));

const base = {
  manifest_version: 3,
  name: 'Everyfold',
  description: 'One bookmark library for every browser, auto-organized.',
  version: pkg.version,
  permissions: ['bookmarks', 'storage', 'alarms'],
  action: { default_popup: 'popup.html', default_title: 'Everyfold' },
};
const targets = {
  chrome: { ...base, background: { service_worker: 'background.js' }, minimum_chrome_version: '116' },
  firefox: {
    ...base,
    background: { scripts: ['background.js'] },
    browser_specific_settings: { gecko: { id: 'everyfold@everyfold.dev', strict_min_version: '115.0' } },
  },
};

for (const [name, manifest] of Object.entries(targets)) {
  const out = join(root, 'dist', name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: { background: join(root, 'src/background.ts'), popup: join(root, 'src/popup.ts') },
    outdir: out, bundle: true, format: 'iife', target: name === 'chrome' ? 'chrome116' : 'firefox115', logLevel: 'warning',
  });
  cpSync(join(root, 'static'), out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`built dist/${name}`);
}

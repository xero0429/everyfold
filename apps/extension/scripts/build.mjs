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
  // 설명은 static/_locales/<locale>/messages.json — 스토어 요약(≤132자)도 이것. ko 가 있어야 대시보드에서 한국어 등록 문안을 넣을 수 있다.
  default_locale: 'en',
  description: '__MSG_extDescription__',
  version: pkg.version,
  permissions: ['bookmarks', 'storage', 'alarms'],
  icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
  action: { default_popup: 'popup.html', default_title: 'Everyfold', default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
};
const targets = {
  chrome: { ...base, background: { service_worker: 'background.js' }, minimum_chrome_version: '116' },
  firefox: {
    ...base,
    background: { scripts: ['background.js'] },
    // AMO: 2025-11-03 부터 새 애드온은 data_collection_permissions 필수(Firefox 140+ 내장 동의 화면).
    // 북마크·토큰은 사용자가 정한 자기 서버로만 가지만, 확장 밖으로 나가므로 "전송" 으로 신고한다. 140 미만은 내장 동의 화면이 없어 막는다.
    browser_specific_settings: {
      gecko: {
        id: 'everyfold@xero0429.github.io', strict_min_version: '140.0',
        data_collection_permissions: { required: ['bookmarksInfo', 'authenticationInfo'] },
      },
    },
  },
};

for (const [name, manifest] of Object.entries(targets)) {
  const out = join(root, 'dist', name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  await build({
    entryPoints: { background: join(root, 'src/background.ts'), popup: join(root, 'src/popup.ts') },
    outdir: out, bundle: true, format: 'iife', target: name === 'chrome' ? 'chrome116' : 'firefox140', logLevel: 'warning',
  });
  cpSync(join(root, 'static'), out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`built dist/${name}`);
}

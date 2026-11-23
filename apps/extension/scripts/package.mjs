// 스토어 제출물 — dist/store/ 아래에 만든다(제출 자체는 사람이 한다: docs/store/).
//   node scripts/package.mjs chrome   → everyfold-chrome-<ver>.zip   (Chrome Web Store: manifest.json 이 zip 맨 위)
//   node scripts/package.mjs firefox  → everyfold-firefox-<ver>.zip  (AMO 애드온 파일)
//   node scripts/package.mjs source   → everyfold-source-<ver>.zip   (AMO "소스 코드" — git HEAD 의 추적 파일 전부)
//   인자 없음 = 셋 다. chrome/firefox 는 먼저 빌드한다.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipDir } from './zip.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..', '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const out = join(root, 'dist', 'store');
const which = process.argv.slice(2);
const targets = which.length ? which : ['chrome', 'firefox', 'source'];
for (const t of targets) if (!['chrome', 'firefox', 'source'].includes(t)) throw new Error(`unknown target ${t} (chrome | firefox | source)`);

mkdirSync(out, { recursive: true });
if (targets.some((t) => t !== 'source')) execFileSync(process.execPath, [join(root, 'scripts', 'build.mjs')], { stdio: 'inherit' });

for (const t of targets) {
  const file = join(out, `everyfold-${t}-${version}.zip`);
  if (t === 'source') {
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim();
    if (dirty) console.warn('warning: uncommitted changes are NOT in the source zip (it is made from git HEAD)');
    execFileSync('git', ['archive', '--format=zip', `--prefix=everyfold-${version}/`, '-o', file, 'HEAD'], { cwd: repo });
  } else {
    const dir = join(root, 'dist', t);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
    if (manifest.version !== version) throw new Error(`manifest version ${manifest.version} ≠ package.json ${version}`);
    writeFileSync(file, zipDir(dir));
  }
  console.log(`packaged ${file.slice(repo.length + 1)}`);
}

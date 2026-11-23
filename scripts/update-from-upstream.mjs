#!/usr/bin/env node
// Everyfold — 내 서버 저장소를 원본(upstream) 최신 판으로 맞춘다.
//
// "Deploy to Cloudflare" 버튼은 원본을 fork 가 아니라 새 저장소로 "복제"하므로 GitHub 의 "Sync fork" 가 없다.
// 이 스크립트(와 .github/workflows/update-from-upstream.yml)가 그 자리를 채운다:
//   1) upstream 의 <ref> 를 가져와 작업 트리를 그 내용으로 바꾼다(upstream 에서 지운 파일은 지운다).
//   2) wrangler.toml 에서 배포 때 정해진 값 — Worker 이름, D1 database_name / database_id — 은 내 것을 그대로 둔다.
//      wrangler.toml 이 없거나 wrangler.json(c) 가 있거나 database_id 를 지킬 수 없으면 아무것도 바꾸지 않고 멈춘다.
//      그 밖의 내 수정(예: [vars])은 옮기지 않고 경고로 알린다. upstream 에서 지운 파일 목록도 로그에 남긴다.
//   3) .github/workflows/ 는 건드리지 않는다(Actions 의 GITHUB_TOKEN 은 워크플로 파일을 push 할 수 없다). 달라진 게 있으면 알려 준다.
//   4) 바뀐 게 있으면 커밋 한 개를 만든다. push 는 부르는 쪽(워크플로)이 한다 → Workers Builds 가 다시 배포하면서
//      `deploy` 스크립트가 D1 마이그레이션을 먼저 적용한다.
//
// 사용: node scripts/update-from-upstream.mjs [--upstream <git url>] [--ref <branch|tag>] [--dry-run]
// 코드를 직접 고쳐 쓰는 경우엔 이 스크립트 대신 git merge 로 합친다(README "Updating your server" 참조).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEFAULT_UPSTREAM = 'https://github.com/xero0429/everyfold.git';
/** upstream 으로 덮지 않는 경로(접두어) */
export const PRESERVE = ['.github/workflows/'];

/* ───────── wrangler.toml: 배포 때 정해진 값만 옮긴다 ───────── */
const KEY_RE = (key) => new RegExp(`^(\\s*${key}\\s*=\\s*)(".*?"|'.*?')(.*)$`, 'm');

/** TOML 을 [표] 단위 덩어리로 나눈다(첫 덩어리 = 최상위 키). 문자열 안의 [ 는 신경 쓰지 않는다 — wrangler.toml 수준이면 충분하다. */
function sections(toml) {
  const out = [];
  let cur = { header: null, lines: [] };
  for (const line of toml.split('\n')) {
    if (/^\s*\[/.test(line)) {
      out.push(cur);
      cur = { header: line.trim(), lines: [line] };
    } else cur.lines.push(line);
  }
  out.push(cur);
  return out;
}
const join = (secs) => secs.map((s) => s.lines.join('\n')).join('\n');
const getKey = (text, key) => text.match(KEY_RE(key))?.[2];
function setKey(sec, key, value, after) {
  const text = sec.lines.join('\n');
  if (KEY_RE(key).test(text)) {
    sec.lines = text.replace(KEY_RE(key), (_m, pre, _v, rest) => `${pre}${value}${rest}`).split('\n');
    return;
  }
  // 없으면 after 키 다음 줄에(없으면 덩어리 끝의 빈 줄 앞에) 넣는다
  let at = sec.lines.findIndex((l) => after && KEY_RE(after).test(l));
  if (at < 0) {
    at = sec.lines.length - 1;
    while (at > 0 && !sec.lines[at].trim()) at--;
  }
  sec.lines.splice(at + 1, 0, `${key} = ${value}`);
}
const dbSection = (secs, binding = 'DB') =>
  secs.find((s) => s.header === '[[d1_databases]]' && getKey(s.lines.join('\n'), 'binding')?.slice(1, -1) === binding);

/**
 * upstream 의 wrangler.toml(theirs) 위에 내 배포 값(mine)을 얹는다:
 * 최상위 `name`, D1 바인딩 DB 의 `database_name`·`database_id`. 그 밖의 내 수정은 옮기지 않는다(droppedLines 로 알린다).
 */
export function carryWranglerToml(mine, theirs) {
  const m = sections(mine);
  const t = sections(theirs);
  const carried = [];
  const myName = getKey(m[0].lines.join('\n'), 'name');
  if (myName && getKey(t[0].lines.join('\n'), 'name') !== myName) {
    setKey(t[0], 'name', myName);
    carried.push('name');
  }
  const mdb = dbSection(m);
  const tdb = dbSection(t);
  if (mdb && tdb) {
    for (const [key, after] of [['database_name', 'binding'], ['database_id', 'database_name']]) {
      const v = getKey(mdb.lines.join('\n'), key);
      if (v && getKey(tdb.lines.join('\n'), key) !== v) {
        setKey(tdb, key, v, after);
        carried.push(key);
      }
    }
  }
  return { text: join(t), carried };
}

/** 내 wrangler.toml 에 있었는데 새 파일에 없는 줄(빈 줄·주석 제외) — 버려지는 내 수정을 알리려고 쓴다. */
export function droppedLines(mine, result) {
  const keep = new Set(result.split('\n').map((l) => l.trim()));
  return mine
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !keep.has(l));
}

const dbId = (toml) => {
  const s = dbSection(sections(toml));
  return s ? getKey(s.lines.join('\n'), 'database_id') : undefined;
};

const HAND_UPDATE = 'update by hand instead (README "Updating your server" → git merge)';

/* ───────── git ───────── */
const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20, ...opts });
const lines = (s) => s.split('\n').filter(Boolean);
const preserved = (p) => PRESERVE.some((pre) => p.startsWith(pre));

export function updateFromUpstream({ upstream = DEFAULT_UPSTREAM, ref = 'main', dryRun = false, cwd = process.cwd(), log = console.log } = {}) {
  const g = (args) => git(args, { cwd });
  if (g(['status', '--porcelain']).trim()) throw new Error('working tree has uncommitted changes — commit or stash them first');
  g(['fetch', '--no-tags', '--depth=1', upstream, ref]);
  const sha = g(['rev-parse', 'FETCH_HEAD']).trim();
  const theirsFiles = new Set(lines(g(['ls-tree', '-r', '--name-only', 'FETCH_HEAD'])));
  const mineFiles = lines(g(['ls-files']));

  // 0) 내 배포 값(Worker 이름·D1 id)을 확실히 지킬 수 있을 때만 진행한다 — 못 지키면 아무것도 바꾸지 않고 멈춘다.
  //    database_id 가 빠진 설정이 push 되면 Workers Builds 가 빈 D1 을 새로 만들어 붙인다(기존 데이터와 연결이 끊긴다).
  const other = ['wrangler.json', 'wrangler.jsonc'].filter((f) => existsSync(`${cwd}/${f}`));
  if (other.length) throw new Error(`found ${other.join(', ')} — this script only knows how to keep your settings in wrangler.toml; ${HAND_UPDATE}`);
  if (!existsSync(`${cwd}/wrangler.toml`)) throw new Error(`wrangler.toml not found in your repository; ${HAND_UPDATE}`);
  if (!theirsFiles.has('wrangler.toml')) throw new Error(`upstream ${ref} has no wrangler.toml; ${HAND_UPDATE}`);
  const myToml = readFileSync(`${cwd}/wrangler.toml`, 'utf8');
  const tomlResult = carryWranglerToml(myToml, g(['show', 'FETCH_HEAD:wrangler.toml']));
  const myId = dbId(myToml);
  if (myId && dbId(tomlResult.text) !== myId)
    throw new Error(`could not keep your D1 database_id ${myId} in the new wrangler.toml; ${HAND_UPDATE}`);

  // 1) upstream 에 없는 내 파일은 지운다(보존 경로 제외)
  const removed = mineFiles.filter((f) => !theirsFiles.has(f) && !preserved(f));
  for (const f of removed) g(['rm', '-q', '--', f]);
  // 2) upstream 내용으로 덮는다(보존 경로 제외)
  const take = [...theirsFiles].filter((f) => !preserved(f));
  for (let i = 0; i < take.length; i += 200) g(['checkout', 'FETCH_HEAD', '--', ...take.slice(i, i + 200)]);
  // 3) wrangler.toml 의 배포 값 옮기기
  writeFileSync(`${cwd}/wrangler.toml`, tomlResult.text);
  g(['add', 'wrangler.toml']);
  const carried = tomlResult.carried;
  const dropped = droppedLines(myToml, tomlResult.text);
  // 4) 보존 경로 중 upstream 과 다른 것 알리기
  const wfDiff = [...new Set([...theirsFiles].filter(preserved).concat(mineFiles.filter(preserved)))].filter((f) => {
    if (!theirsFiles.has(f) || !mineFiles.includes(f)) return true;
    return g(['rev-parse', `FETCH_HEAD:${f}`]).trim() !== g(['rev-parse', `HEAD:${f}`]).trim();
  });

  const changed = lines(g(['diff', '--cached', '--name-only']));
  log(`upstream ${upstream} ${ref} @ ${sha.slice(0, 12)}`);
  if (carried.length) log(`kept from your wrangler.toml: ${carried.join(', ')}`);
  if (dropped.length)
    log(`warning: these lines of your wrangler.toml are not in the new one (only name, database_name, database_id are kept — set variables in the Cloudflare dashboard instead): ${dropped.join(' | ')}`);
  if (removed.length) log(`removed (no longer in upstream): ${removed.join(', ')}`);
  if (wfDiff.length) log(`note: these workflow files differ from upstream and were left as they are — update them by hand if you want: ${wfDiff.join(', ')}`);
  if (!changed.length) {
    log('already up to date');
    return { sha, changed, carried, dropped, removed, workflowsDiffer: wfDiff, committed: false };
  }
  log(`${changed.length} file(s) changed`);
  if (dryRun) {
    g(['reset', '-q', '--hard', 'HEAD']);
    for (const f of changed) if (!mineFiles.includes(f) && existsSync(`${cwd}/${f}`)) rmSync(`${cwd}/${f}`, { force: true });
    log('dry run — nothing committed');
    return { sha, changed, carried, dropped, removed, workflowsDiffer: wfDiff, committed: false };
  }
  g(['commit', '-q', '-m', `Update Everyfold from upstream ${ref} (${sha.slice(0, 12)})`]);
  return { sha, changed, carried, dropped, removed, workflowsDiffer: wfDiff, committed: true };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  try {
    updateFromUpstream({ upstream: opt('--upstream') || DEFAULT_UPSTREAM, ref: opt('--ref') || 'main', dryRun: argv.includes('--dry-run') });
  } catch (e) {
    console.error(`update failed: ${e.stderr || e.message}`);
    process.exit(1);
  }
}

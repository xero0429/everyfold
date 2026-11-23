// 업데이트 경로(scripts/update-from-upstream.mjs) — 임시 git 저장소 둘(upstream / 내 복제본)로 끝까지 돌린다.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { carryWranglerToml, updateFromUpstream } from '../../../scripts/update-from-upstream.mjs';

const repoToml = readFileSync(fileURLToPath(new URL('../../../wrangler.toml', import.meta.url)), 'utf8');
const tmp = mkdtempSync(join(tmpdir(), 'everyfold-update-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const write = (root, files) => {
  for (const [p, c] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), c);
  }
};
const initRepo = (name, files) => {
  const d = join(tmp, name);
  mkdirSync(d);
  git(d, 'init', '-q', '-b', 'main');
  git(d, 'config', 'user.name', 'test');
  git(d, 'config', 'user.email', 'test@example.com');
  git(d, 'config', 'commit.gpgsign', 'false');
  write(d, files);
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'init');
  return d;
};
// Deploy 버튼이 복제본에 써 넣는 값(이름 변경 + database_id)
const deployed = (toml) =>
  toml.replace(/^name = "everyfold"/m, 'name = "my-bookmarks"').replace(/^database_name = "everyfold"$/m, 'database_name = "my-bookmarks-db"\ndatabase_id = "1111-2222"');

describe('carryWranglerToml', () => {
  it('keeps the deployed Worker name and D1 name/id on top of the upstream file', () => {
    const theirs = repoToml.replace('compatibility_date = "2026-11-01"', 'compatibility_date = "2027-01-01"');
    const r = carryWranglerToml(deployed(repoToml), theirs);
    expect(r.carried.sort()).toEqual(['database_id', 'database_name', 'name']);
    expect(r.text).toContain('name = "my-bookmarks"');
    expect(r.text).toContain('database_name = "my-bookmarks-db"\ndatabase_id = "1111-2222"');
    expect(r.text).toContain('compatibility_date = "2027-01-01"'); // upstream 변경은 들어온다
    expect(r.text).toContain('binding = "DB"');
    expect(r.text).toContain('migrations_dir = "apps/server/migrations"');
  });
  it('replaces an existing database_id in place and is a no-op on an unchanged copy', () => {
    const theirs = repoToml.replace('database_name = "everyfold"', 'database_name = "everyfold"\ndatabase_id = "upstream-id"');
    expect(carryWranglerToml(deployed(repoToml), theirs).text).toMatch(/database_id = "1111-2222"/);
    expect(carryWranglerToml(deployed(repoToml), theirs).text).not.toContain('upstream-id');
    expect(carryWranglerToml(repoToml, repoToml)).toEqual({ text: repoToml, carried: [] });
  });
});

describe('updateFromUpstream (git)', () => {
  const v1 = {
    'wrangler.toml': repoToml,
    'apps/server/src/index.ts': 'v1\n',
    'apps/server/migrations/0001_init.sql': 'create table a(x);\n',
    'old-file.txt': 'removed upstream later\n',
    '.github/workflows/ci.yml': 'ci v1\n',
  };
  const up = initRepo('upstream', v1);
  // 복제본 = 같은 내용의 "새" 저장소(역사 공유 없음) + Deploy 버튼이 쓴 wrangler 값
  const mine = initRepo('mine', { ...v1, 'wrangler.toml': deployed(repoToml) });

  it('brings in upstream changes, deletions and new migrations; keeps deploy values and workflows; commits once', () => {
    write(up, {
      'apps/server/src/index.ts': 'v2\n',
      'apps/server/migrations/0002_more.sql': 'create table b(y);\n',
      '.github/workflows/ci.yml': 'ci v2\n',
      'wrangler.toml': repoToml.replace('crons = ["0 18 * * *"]', 'crons = ["0 19 * * *"]'),
    });
    git(up, 'rm', '-q', 'old-file.txt');
    git(up, 'add', '-A');
    git(up, 'commit', '-q', '-m', 'v2');

    const logs = [];
    const r = updateFromUpstream({ upstream: up, ref: 'main', cwd: mine, log: (s) => logs.push(s) });
    expect(r.committed).toBe(true);
    expect(readFileSync(join(mine, 'apps/server/src/index.ts'), 'utf8')).toBe('v2\n');
    expect(existsSync(join(mine, 'apps/server/migrations/0002_more.sql'))).toBe(true);
    expect(existsSync(join(mine, 'old-file.txt'))).toBe(false);
    const toml = readFileSync(join(mine, 'wrangler.toml'), 'utf8');
    expect(toml).toContain('crons = ["0 19 * * *"]');
    expect(toml).toContain('database_id = "1111-2222"');
    expect(toml).toContain('name = "my-bookmarks"');
    // 워크플로는 그대로 두고 알려 준다
    expect(readFileSync(join(mine, '.github/workflows/ci.yml'), 'utf8')).toBe('ci v1\n');
    expect(r.workflowsDiffer).toEqual(['.github/workflows/ci.yml']);
    expect(git(mine, 'status', '--porcelain')).toBe('');
    expect(git(mine, 'log', '--oneline').trim().split('\n')).toHaveLength(2);

    // 한 번 더 = 바뀐 것 없음
    const again = updateFromUpstream({ upstream: up, ref: 'main', cwd: mine, log: () => undefined });
    expect(again.committed).toBe(false);
    expect(git(mine, 'log', '--oneline').trim().split('\n')).toHaveLength(2);
  });

  it('dry run leaves the repository untouched; a dirty tree is refused', () => {
    write(up, { 'apps/server/src/new.ts': 'new\n' });
    git(up, 'add', '-A');
    git(up, 'commit', '-q', '-m', 'v3');
    const head = git(mine, 'rev-parse', 'HEAD');
    const r = updateFromUpstream({ upstream: up, ref: 'main', cwd: mine, dryRun: true, log: () => undefined });
    expect(r.changed).toContain('apps/server/src/new.ts');
    expect(git(mine, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(mine, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(mine, 'apps/server/src/new.ts'))).toBe(false);

    writeFileSync(join(mine, 'apps/server/src/index.ts'), 'local edit\n');
    expect(() => updateFromUpstream({ upstream: up, ref: 'main', cwd: mine, log: () => undefined })).toThrow(/uncommitted/);
  });
});

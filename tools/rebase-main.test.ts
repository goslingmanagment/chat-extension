// Real local Git histories, with pnpm and the heavy runner replaced by recording executables.
// No dependency installation, build or network access in these tests.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = join(import.meta.dirname, 'rebase-main.ts');
const GENERATED = ['tools/gates/chatspace-bytes.json', 'docs/parity/coverage.json', 'docs/parity/coverage.md'];
const SOURCE = 'src/feature.ts';
const PLAN = 'docs/project-unite/plan.md';
const made: string[] = [];
afterEach(() => {
  for (const root of made.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cg-rebase-'));
  made.push(root);
  const cwd = join(root, 'branch');
  const origin = join(root, 'origin.git');
  const bin = join(root, 'bin');
  const log = join(root, 'commands.jsonl');
  const lock = join(bin, 'heavy runner');
  mkdirSync(cwd);
  mkdirSync(bin);
  const env = {
    ...process.env, PATH: `${bin}:${process.env['PATH'] ?? ''}`, CG_HEAVY_RUN: '',
    // Isolate hooks, signing, identities, templates and rebase preferences from the owner's config.
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TEMPLATE_DIR: '',
    GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  };
  const git = (...args: string[]): string => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  const commit = (message: string): void => {
    git('add', '-A');
    git('commit', '--quiet', '-m', message);
  };
  const read = (path: string): string => readFileSync(join(cwd, path), 'utf8');
  const run = (extra: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [SCRIPT], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
  const records = (): Array<{ tool: string; args: string[]; ci?: string; generated?: string[] }> => existsSync(log)
    ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { tool: string; args: string[]; ci?: string; generated?: string[] })
    : [];
  writeFileSync(join(bin, 'pnpm'), `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const files = ${JSON.stringify(GENERATED)};
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({tool: 'pnpm', args, ci: process.env.CI, generated: files.map(f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null)}) + '\\n');
if (args[0] === process.env.FAKE_FAIL) process.exit(17);
if (args[0] === 'build' && process.env.FAKE_STAGE_OTHER) {
  fs.writeFileSync(${JSON.stringify(SOURCE)}, 'unrelated staged output\\n');
  cp.execFileSync('git', ['add', ${JSON.stringify(SOURCE)}]);
}
{
  const outputs = args[0] === 'gates:bytes' ? files.slice(0, 1) : args[0] === 'parity:coverage' ? files.slice(1) : [];
  for (const f of outputs) {
    fs.mkdirSync(path.dirname(f), {recursive: true});
    fs.writeFileSync(f, 'regenerated ' + f + '\\n');
  }
}
`, { mode: 0o755 });
  writeFileSync(lock, `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({tool: 'lock', args}) + '\\n');
const result = cp.spawnSync(args[0], args.slice(1), {stdio: 'inherit'});
process.exit(result.status ?? 1);
`, { mode: 0o755 });
  git('init', '--quiet', '--initial-branch=main');
  git('init', '--quiet', '--bare', origin);
  for (const path of [...GENERATED, SOURCE, PLAN]) write(path, 'base\n');
  commit('base');
  git('remote', 'add', 'origin', origin);
  git('push', '--quiet', 'origin', 'main');
  git('checkout', '--quiet', '-b', 'feature');
  const advanceMain = (paths: string[]): string => {
    git('checkout', '--quiet', 'main');
    for (const path of paths) write(path, 'main\n');
    commit('main changes');
    const main = git('rev-parse', 'HEAD');
    git('push', '--quiet', 'origin', 'main');
    // Make origin/main stale so the test proves the command fetches, rather than only reading it.
    git('update-ref', 'refs/remotes/origin/main', 'HEAD^');
    git('checkout', '--quiet', 'feature');
    return main;
  };
  return { cwd, env, log, lock, git, write, read, commit, run, records, advanceMain };
}

describe('pnpm rebase:main', () => {
  it('resolves repeated generated-only conflicts from fetched main, preserves source, and makes one regeneration commit', () => {
    const r = fixture();
    for (const path of GENERATED) r.write(path, 'branch first\n');
    r.write(SOURCE, 'feature survives\n');
    r.commit('feature');
    for (const path of GENERATED) r.write(path, 'branch second\n');
    r.commit('old generation');
    const main = r.advanceMain(GENERATED);
    const result = r.run({ CG_HEAVY_RUN: r.lock });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(r.git('merge-base', 'HEAD', 'origin/main')).toBe(main);
    expect(r.read(SOURCE)).toBe('feature survives\n');
    expect(r.git('status', '--porcelain')).toBe('');
    expect(r.git('log', '-1', '--format=%s')).toBe(`chore(gates): regenerate pins and coverage after rebasing on ${main}`);
    expect(r.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort()).toEqual([...GENERATED].sort());
    expect(r.git('rev-list', '--count', `${main}..HEAD`)).toBe('2');
    expect(r.records().map(({ tool, args }) => [tool, args])).toEqual([
      ['lock', ['pnpm', 'install', '--frozen-lockfile']], ['pnpm', ['install', '--frozen-lockfile']],
      ['lock', ['pnpm', 'build']], ['pnpm', ['build']],
      ['pnpm', ['gates:bytes']], ['pnpm', ['parity:coverage']],
    ]);
    const install = r.records().find(({ tool }) => tool === 'pnpm');
    expect(install?.ci).toBe('true');
    expect(install?.generated).toEqual(GENERATED.map(() => 'main\n'));
    for (const path of GENERATED) expect(r.read(path)).toBe(`regenerated ${path}\n`);
  });

  it.each([[SOURCE], [SOURCE, ...GENERATED], [PLAN]])('stops on non-generated conflicts %j without resolving or regenerating', (...paths) => {
    const r = fixture();
    for (const path of paths) r.write(path, 'branch\n');
    r.commit('feature conflict');
    r.advanceMain(paths);
    const result = r.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('conflicts are not limited to generated files');
    for (const path of paths) expect(result.stderr).toContain(path);
    expect(r.git('diff', '--name-only', '--diff-filter=U').split('\n').sort()).toEqual([...paths].sort());
    expect(r.records()).toEqual([]);
  });

  it('resolves a generated file deleted on main, then recreates it during generation', () => {
    const r = fixture();
    const path = GENERATED[0]!;
    r.write(path, 'branch\n');
    r.commit('branch pins');
    r.git('checkout', '--quiet', 'main');
    r.git('rm', path);
    r.commit('remove pins');
    r.git('push', '--quiet', 'origin', 'main');
    r.git('checkout', '--quiet', 'feature');
    const result = r.run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(r.read(path)).toBe(`regenerated ${path}\n`);
    expect(r.git('status', '--porcelain')).toBe('');
  });

  it('runs directly without a lock and does not make an empty commit on a second run', () => {
    const r = fixture();
    const first = r.run();
    expect(first.status, first.stderr).toBe(0);
    const head = r.git('rev-parse', 'HEAD');
    const second = r.run();
    expect(second.status, second.stderr).toBe(0);
    expect(r.git('rev-parse', 'HEAD')).toBe(head);
    expect(second.stdout).toContain('no regeneration commit');
    expect(r.records().every(({ tool }) => tool === 'pnpm')).toBe(true);
  });

  it.each(['install', 'build', 'gates:bytes', 'parity:coverage'])('stops on failed %s without committing artifacts', (step) => {
    const r = fixture();
    const head = r.git('rev-parse', 'HEAD');
    const result = r.run({ FAKE_FAIL: step });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stopped without a regeneration commit');
    expect(r.git('rev-parse', 'HEAD')).toBe(head);
    expect(r.records().at(-1)?.args[0]).toBe(step);
  });

  it('commits only generated files even if a build stages an unrelated change', () => {
    const r = fixture();
    const result = r.run({ FAKE_STAGE_OTHER: '1' });
    expect(result.status, result.stderr).toBe(0);
    expect(r.git('show', `HEAD:${SOURCE}`)).toBe('base');
    expect(r.git('diff', '--cached', '--name-only')).toBe(SOURCE);
  });

  it('refuses a dirty worktree, main and an unfinished rebase before running pnpm', () => {
    const r = fixture();
    r.write('untracked.txt', 'keep me\n');
    expect(r.run().stderr).toContain('worktree is not clean');
    expect(r.read('untracked.txt')).toBe('keep me\n');
    rmSync(join(r.cwd, 'untracked.txt'));
    r.git('checkout', '--quiet', 'main');
    expect(r.run().stderr).toContain('feature branch, not main');
    r.git('checkout', '--quiet', 'feature');
    r.write(SOURCE, 'branch\n');
    r.commit('branch');
    r.advanceMain([SOURCE]);
    expect(r.run().status).toBe(1);
    expect(r.run().stderr).toContain('rebase is already in progress');
    expect(r.records()).toEqual([]);
  });
});

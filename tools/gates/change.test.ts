// What `pnpm gates` takes for «this change» (change.ts): the paths against the base, in a throwaway checkout.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { changeUnderCheck } from './change.ts';

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

interface Repo {
  readonly dir: string;
  git(...args: string[]): string;
  write(path: string, text: string): void;
  commit(message: string): void;
}

/** A checkout with one commit on `main`, which `origin/main` points at. */
function repo(): Repo {
  const dir = mkdtempSync(join(tmpdir(), 'cg-gates-change-'));
  made.push(dir);
  const git = (...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (message: string): void => {
    git('add', '-A');
    git('commit', '--quiet', '-m', message);
  };
  git('init', '--quiet', '--initial-branch=main');
  write('.gitignore', '.output/\n');
  write('packages/core/src/a.ts', 'export const a = 1;\n');
  commit('base');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { dir, git, write, commit };
}

const paths = (answer: ReturnType<typeof changeUnderCheck>): readonly string[] | string => ('paths' in answer ? answer.paths : 'error' in answer ? `error: ${answer.error}` : `skipped: ${answer.skipped}`);

describe('the change under check (tools/gates/change.ts)', () => {
  it('on a branch: everything since it left origin/main — committed, changed in the tree and new, never what is ignored', () => {
    const r = repo();
    r.git('checkout', '--quiet', '-b', 'feat');
    r.write('apps/extension/bg/fansly.ts', 'export default 1;\n');
    r.commit('fansly chunk');
    r.write('packages/core/src/a.ts', 'export const a = 2;\n');
    r.write('tools/gates/chatspace-bytes.json', '{}\n');
    r.write('.output/background.js', 'built');
    const answer = changeUnderCheck({}, r.dir);
    expect(paths(answer)).toEqual(['apps/extension/bg/fansly.ts', 'packages/core/src/a.ts', 'tools/gates/chatspace-bytes.json']);
    expect('base' in answer && answer.base).toBe(r.git('rev-parse', 'origin/main'));
    // origin/main moved on meanwhile: the base is still where the branch left it.
    r.git('update-ref', 'refs/remotes/origin/main', r.git('commit-tree', '-p', 'origin/main', '-m', 'main moved', `${r.git('rev-parse', 'origin/main')}^{tree}`));
    expect(paths(changeUnderCheck({}, r.dir))).toEqual(['apps/extension/bg/fansly.ts', 'packages/core/src/a.ts', 'tools/gates/chatspace-bytes.json']);
  });

  it('on the base itself there is nothing to judge, and a file moved counts by both of its paths', () => {
    const r = repo();
    expect(paths(changeUnderCheck({}, r.dir))).toEqual([]);
    mkdirSync(join(r.dir, 'packages/core/src/domain/hosts/fansly'), { recursive: true });
    r.git('mv', 'packages/core/src/a.ts', 'packages/core/src/domain/hosts/fansly/a.ts');
    expect(paths(changeUnderCheck({}, r.dir))).toEqual(['packages/core/src/a.ts', 'packages/core/src/domain/hosts/fansly/a.ts']);
  });

  it('a pull request in CI: the whole PR against the first parent of GitHub’s merge commit; no merge commit or no parent is an error, never a pass', () => {
    const r = repo();
    r.git('checkout', '--quiet', '-b', 'feat');
    r.write('packages/ui/src/dock/Strip.tsx', 'export const S = 1;\n');
    r.commit('dock');
    r.git('checkout', '--quiet', 'main');
    r.write('docs/x.md', 'main moved\n');
    r.commit('main moved');
    const env = { GITHUB_EVENT_NAME: 'pull_request' };
    expect(paths(changeUnderCheck(env, r.dir))).toMatch(/^error: HEAD is not the merge commit of the pull request/);
    r.git('merge', '--quiet', '--no-ff', '-m', 'merge PR', 'feat');
    const answer = changeUnderCheck(env, r.dir);
    // What `main` brought meanwhile (docs/x.md) is not the PR's.
    expect(paths(answer)).toEqual(['packages/ui/src/dock/Strip.tsx']);
    expect('base' in answer && answer.base).toBe(r.git('rev-parse', 'HEAD^1'));
  });

  it('CG_GATES_BASE names the base; a name that is no commit is an error', () => {
    const r = repo();
    const base = r.git('rev-parse', 'HEAD');
    r.write('packages/core/src/b.ts', 'export const b = 1;\n');
    r.commit('one');
    r.write('packages/core/src/c.ts', 'export const c = 1;\n');
    r.commit('two');
    expect(paths(changeUnderCheck({ CG_GATES_BASE: 'HEAD^' }, r.dir))).toEqual(['packages/core/src/c.ts']);
    expect(paths(changeUnderCheck({ CG_GATES_BASE: base, GITHUB_EVENT_NAME: 'pull_request' }, r.dir))).toEqual(['packages/core/src/b.ts', 'packages/core/src/c.ts']);
    expect(paths(changeUnderCheck({ CG_GATES_BASE: 'no-such-ref' }, r.dir))).toBe('error: CG_GATES_BASE names no-such-ref, which is no commit here');
  });

  it('without origin/main, or outside a checkout (the sources archive), the diff is not judged — and says so', () => {
    const r = repo();
    r.git('update-ref', '-d', 'refs/remotes/origin/main');
    expect(paths(changeUnderCheck({}, r.dir))).toBe('skipped: no origin/main to compare with');
    const plain = mkdtempSync(join(tmpdir(), 'cg-gates-plain-'));
    made.push(plain);
    expect(paths(changeUnderCheck({}, plain))).toBe('skipped: not a git checkout');
  });
});

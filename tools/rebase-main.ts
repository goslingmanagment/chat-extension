// `pnpm rebase:main`: replay a clean branch on the fetched main, then rebuild generated artifacts.
// CG_HEAVY_RUN is an optional executable path (no shell arguments), used for install and build.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const COVERAGE = ['docs/parity/coverage.json', 'docs/parity/coverage.md'];
const GENERATED = ['tools/gates/chatspace-bytes.json', ...COVERAGE];
const splitPaths = (text: string): string[] => text.split('\0').filter(Boolean);

function rebaseMain(): void {
  let cwd = process.cwd();
  const run = (command: string, args: string[], capture = false, env = process.env) => {
    const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit' });
    if (result.error) throw result.error;
    if (result.signal) throw new Error(`${command} interrupted by ${result.signal}`);
    return result;
  };
  const git = (...args: string[]): string => {
    const result = run('git', args, true);
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed:\n${result.stderr}`);
    return result.stdout;
  };
  cwd = git('rev-parse', '--show-toplevel').trim();
  for (const state of ['rebase-merge', 'rebase-apply']) {
    if (existsSync(resolve(cwd, git('rev-parse', '--git-path', state).trim()))) {
      throw new Error('A rebase is already in progress. Resolve it with git rebase --continue or git rebase --abort, then rerun pnpm rebase:main.');
    }
  }
  const branch = git('symbolic-ref', '--quiet', '--short', 'HEAD').trim();
  if (branch === 'main') throw new Error('Run pnpm rebase:main on a feature branch, not main.');
  if (git('status', '--porcelain=v1', '-z', '--untracked-files=all') !== '') {
    throw new Error('The worktree is not clean. Commit or stash your changes before pnpm rebase:main.');
  }
  const heavyRun = process.env['CG_HEAVY_RUN'];
  const checked = (command: string, args: string[], env = process.env): void => {
    console.log(`rebase:main: ${command} ${args.join(' ')}`);
    if (run(command, args, false, env).status !== 0) throw new Error(`${command} ${args.join(' ')} failed; stopped without a regeneration commit.`);
  };

  checked('git', ['fetch', 'origin']);
  // Pin the fetched target: another worktree can update the shared origin/main ref during our run.
  const main = git('rev-parse', 'origin/main').trim();
  console.log(`rebase:main: rebasing ${branch} on origin/main (${main})`);
  const rebase = (args: string[]): number | null => run('git', ['-c', 'rerere.enabled=false', 'rebase', ...args], false, { ...process.env, GIT_EDITOR: 'true' }).status;
  let status = rebase(['--no-autostash', '--no-update-refs', main]);
  while (status !== 0) {
    const conflicts = splitPaths(git('diff', '--name-only', '--diff-filter=U', '-z'));
    if (conflicts.length === 0) throw new Error('Rebase stopped without unmerged files. Inspect git status, finish or abort the rebase, then rerun pnpm rebase:main.');
    if (conflicts.some((path) => !GENERATED.includes(path))) {
      throw new Error(`Rebase stopped: conflicts are not limited to generated files:\n${conflicts.map((path) => `  ${path}`).join('\n')}\nResolve them with git rebase --continue (or git rebase --abort), then rerun pnpm rebase:main. No generated conflicts were resolved at this stop.`);
    }
    console.log(`rebase:main: taking fetched main for ${conflicts.join(', ')}`);
    // During a rebase --ours is the partially replayed branch, not necessarily main.
    for (const path of conflicts) {
      if (git('ls-tree', '--name-only', '-z', main, '--', path) === '') git('rm', '--force', '--', path);
      else git('restore', '--source', main, '--staged', '--worktree', '--', path);
    }
    status = rebase(['--continue']);
  }

  // The report belongs to main, even when a branch-only edit replayed without a conflict.
  for (const path of COVERAGE) {
    if (git('ls-tree', '--name-only', '-z', main, '--', path) === '') {
      if (git('ls-files', '-z', '--', path) !== '') git('rm', '--', path);
    } else git('restore', '--source', main, '--staged', '--worktree', '--', path);
  }

  for (const args of [['install', '--frozen-lockfile'], ['build'], ['gates:bytes']]) {
    const heavy = args[0] === 'install' || args[0] === 'build';
    const env = args[0] === 'install' ? { ...process.env, CI: 'true' } : process.env;
    if (heavy && heavyRun) checked(heavyRun, ['pnpm', ...args], env);
    else checked('pnpm', args, env);
  }
  const changed = [...new Set([
    ...splitPaths(git('diff', '--name-only', '-z', 'HEAD', '--', ...GENERATED)),
    ...splitPaths(git('ls-files', '--others', '--exclude-standard', '-z', '--', ...GENERATED)),
  ])];
  if (changed.length === 0) {
    console.log('rebase:main: generated files are current; no regeneration commit.');
    return;
  }
  const unstaged = changed.filter((path) => git('ls-files', '-z', '--', path) !== '' || existsSync(resolve(cwd, path)));
  if (unstaged.length > 0) git('add', '-A', '--', ...unstaged);
  checked('git', ['commit', '--only', '-m', `chore(gates): regenerate pins after rebasing on ${main}; the coverage report stays main's`, '--', ...changed]);
}

try {
  rebaseMain();
} catch (error) {
  console.error(`rebase:main: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}

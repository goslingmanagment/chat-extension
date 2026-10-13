// The change under check, for the gates that judge a diff (sites.ts
// `checkBytesPinDiff`): the paths this branch, or this pull request, changes
// against its base. Impure — it asks git; the rules themselves are pure.
//
// Which base:
//   CG_GATES_BASE=<commit>  the commit named;
//   a pull request in CI    actions/checkout gives GitHub's merge commit of the
//                           PR, so the base is HEAD^1 (fetch-depth: 2 in
//                           .github/workflows/ci.yml). No base there is an
//                           error, never a silent pass;
//   anywhere else           where this branch left origin/main, the working
//                           tree included (changed and new files not yet
//                           committed count).
// Without git, without origin/main, or on the base itself there is no change
// to judge: the answer says why, and the caller prints it.

import { execFileSync } from 'node:child_process';

import { REPO_ROOT } from '../lib/paths.ts';

export type ChangeUnderCheck = { readonly base: string; readonly paths: readonly string[] } | { readonly skipped: string } | { readonly error: string };

const lines = (text: string | null): string[] => (text === null ? [] : text.split('\n').filter((line) => line.length > 0));

/** `cwd` — the checkout to ask (the tests pass a throwaway one). */
export function changeUnderCheck(env: Readonly<Record<string, string | undefined>> = process.env, cwd: string = REPO_ROOT): ChangeUnderCheck {
  const git = (args: readonly string[]): string | null => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  // The top of the checkout is `cwd` itself: a folder that merely lies inside somebody else's repository is none.
  if (git(['rev-parse', '--show-prefix']) !== '') return { skipped: 'not a git checkout' };
  const named = env['CG_GATES_BASE'];
  let base: string | null;
  if (named !== undefined && named !== '') {
    base = git(['rev-parse', '--verify', '--quiet', `${named}^{commit}`]);
    if (base === null) return { error: `CG_GATES_BASE names ${named}, which is no commit here` };
  } else if (env['GITHUB_EVENT_NAME'] === 'pull_request') {
    // The merge commit of the pull request: its first parent is the base branch.
    if (git(['rev-parse', '--verify', '--quiet', 'HEAD^2']) === null) return { error: 'HEAD is not the merge commit of the pull request, or its parents were not fetched (the job needs fetch-depth: 2)' };
    base = git(['rev-parse', '--verify', '--quiet', 'HEAD^1']);
    if (base === null) return { error: 'the base commit of the pull request is not in this checkout (the job needs fetch-depth: 2)' };
  } else {
    if (git(['rev-parse', '--verify', '--quiet', 'origin/main']) === null) return { skipped: 'no origin/main to compare with' };
    base = git(['merge-base', 'HEAD', 'origin/main']);
    if (base === null) return { skipped: 'this branch shares no commit with origin/main' };
  }
  // --no-renames: a file moved counts by its old path and by its new one.
  const changed = git(['diff', '--name-only', '--no-renames', base]);
  if (changed === null) return { error: `git diff against ${base} failed` };
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  return { base, paths: [...new Set([...lines(changed), ...lines(untracked)])].sort() };
}

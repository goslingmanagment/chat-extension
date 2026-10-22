// The notes of changes and the version in a PR (changes/README.md, docs/release.md «Versions»):
//
//   - every note in changes/ parses (changes.ts) — a broken one would stop the next release;
//   - on a pull request (GitHub's merge commit, base = HEAD^1): a `feat`/`fix` PR — a change
//     a chatter notices — adds or edits a note, or its description says «No chatter note: <why>»;
//     the title names no version (the release gives it) and apps/extension/package.json keeps
//     its version (the tags hold it).
//
// The PR's title and description come from the event GitHub hands the job; the check runs
// on opened, reopened and new pushes — after an edit of the title or the description alone,
// re-run the job.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { NOTES_DIR, noteSlug } from '../release/changes.ts';
import { realExec } from '../release/exec.ts';
import { Checkout } from '../release/local.ts';
import { needsNote } from '../release/notes.ts';
import { REPO_ROOT } from '../lib/paths.ts';
import type { Violation } from './checks.ts';

const VERSION_FILE = 'apps/extension/package.json';
const OPT_OUT_RE = /^No chatter note:\s*\S/im;
const VERSION_IN_TITLE_RE = /\(\d+\.\d+\.\d+\)|\bv\d+\.\d+\.\d+\b/;

interface PullRequest {
  readonly title: string;
  readonly body: string;
  /** Status letter and path of every file the PR changes (git diff --name-status). */
  readonly changed: ReadonlyArray<{ readonly status: string; readonly path: string }>;
  readonly versionLineChanged: boolean;
}

/** What a PR breaks of the rules above; pure. */
export function pullRequestViolations(pr: PullRequest): Violation[] {
  const out: Violation[] = [];
  const say = (path: string, message: string): void => {
    out.push({ gate: 'notes', path, line: 1, message });
  };
  if (VERSION_IN_TITLE_RE.test(pr.title)) say('(PR title)', `«${pr.title}» names a version: the release gives the version (docs/release.md «Versions») — drop it from the title.`);
  if (pr.versionLineChanged) say(VERSION_FILE, 'the PR changes the version: it lives in the tags, `pnpm release` sets it — leave this line as it is.');
  const notes = pr.changed.filter((file) => file.status !== 'D' && file.path.startsWith(`${NOTES_DIR}/`) && noteSlug(file.path.slice(NOTES_DIR.length + 1)) !== null);
  if (needsNote(pr.title) && notes.length === 0 && !OPT_OUT_RE.test(pr.body)) {
    say(`${NOTES_DIR}/`, `a feat/fix PR changes what a chatter sees: add ${NOTES_DIR}/<slug>.md (${NOTES_DIR}/README.md) — or, when a chatter notices nothing, a line «No chatter note: <why>» in the description (then re-run the job), or another type than feat/fix.`);
  }
  return out;
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** The PR this job checks; null — not a pull request run, or its merge commit is not here. */
function currentPullRequest(): PullRequest | null {
  if (process.env['GITHUB_EVENT_NAME'] !== 'pull_request') return null;
  const eventPath = process.env['GITHUB_EVENT_PATH'];
  if (eventPath === undefined) return null;
  try {
    git('rev-parse', '-q', '--verify', 'HEAD^2');
  } catch {
    return null;
  }
  const event = JSON.parse(readFileSync(eventPath, 'utf8')) as { pull_request?: { title?: unknown; body?: unknown } };
  const changed = git('diff', '--name-status', '--no-renames', 'HEAD^1', 'HEAD')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [status = '', path = ''] = line.split('\t');
      return { status: status.charAt(0), path };
    });
  const versionDiff = git('diff', '-U0', 'HEAD^1', 'HEAD', '--', VERSION_FILE);
  return {
    title: typeof event.pull_request?.title === 'string' ? event.pull_request.title : '',
    body: typeof event.pull_request?.body === 'string' ? event.pull_request.body : '',
    changed,
    versionLineChanged: /^[-+] {2}"version":/m.test(versionDiff),
  };
}

export function notesViolations(): Violation[] {
  const problems = new Checkout(REPO_ROOT, realExec).noteProblems().map((message): Violation => ({ gate: 'notes', path: /^(\S+?\.md)/.exec(message)?.[1] ?? NOTES_DIR, line: 1, message }));
  const pr = currentPullRequest();
  return [...problems, ...(pr === null ? [] : pullRequestViolations(pr))];
}

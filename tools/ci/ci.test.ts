// The CI job «e2e» around its container (.github/workflows/ci.yml,
// tools/ci/e2e-docker.sh, tools/ci/e2e-needed.sh) — what can be checked without
// Docker and without GitHub:
//   - a cancelled job does not leave its container: the workflow's own `run:`
//     line is started the way the runner starts a step, signalled the way the
//     runner cancels one, against a stand-in `docker` that keeps "containers"
//     in a file;
//   - which changes skip the suite, on a throwaway git repository.
// The real thing — the same line, the real Docker, a real cancel sequence — was
// run by hand; docs/release.md, «Что проверено».

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const WORKFLOW = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');
const IMAGE = /^CG_E2E_IMAGE='([^']+)'$/m.exec(readFileSync(join(REPO_ROOT, 'tools/ci/e2e-image.sh'), 'utf8'))?.[1] ?? '';
const DIGEST = IMAGE.slice(IMAGE.indexOf('sha256:') + 'sha256:'.length);

/** The `run:` text of the step whose name starts with `name`, as the workflow has it. */
function runLine(name: string): string {
  const step = new RegExp(`^      - name: ${name.replace(/[()]/g, '\\$&')}[^\\n]*\\n((?:        [^\\n]*\\n)+)`, 'm').exec(WORKFLOW)?.[1] ?? '';
  const line = /^ {8}run: (.+)$/m.exec(step)?.[1];
  if (line === undefined) throw new Error(`no step «${name}» with a one-line run in the workflow`);
  return line;
}

let dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs = [];
});
function temp(prefix: string): string {
  // The real path: on a Mac the temp folder is behind a symlink, and the script compares resolved paths with given ones.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

// ── a runner without Docker ────────────────────────────────────────────────

/** A stand-in for the docker client: logs every call; containers and image tags are lines of files. */
const FAKE_DOCKER = `#!/bin/bash
S=$CG_FAKE_DOCKER
printf '%s\\n' "$*" >> "$S/calls"
case "$1" in
  info) echo '["name=seccomp","name=rootless"]' ;;
  image | pull | tag | rmi) exit 0 ;;
  images) cat "$S/images" 2> /dev/null; exit 0 ;;
  ps) cat "$S/containers" 2> /dev/null; exit 0 ;;
  rm)
    shift; [ "$1" = -f ] && shift
    for name in "$@"; do grep -v -x -- "$name" "$S/containers" > "$S/containers.new" 2> /dev/null; mv "$S/containers.new" "$S/containers"; done ;;
  run)
    name=''; prev=''
    for arg in "$@"; do [ "$prev" = --name ] && name=$arg; prev=$arg; done
    mode=$(cat "$S/run-mode" 2> /dev/null)
    case "$mode" in exit:*) exit "\${mode#exit:}" ;; esac
    echo "$name" >> "$S/containers"
    # An attached client: it lives as long as its container does.
    while grep -q -x -- "$name" "$S/containers" 2> /dev/null; do sleep 0.05; done
    exit 137 ;;
esac
`;

interface Runner {
  readonly state: string;
  readonly home: string;
  readonly env: Record<string, string>;
  calls(): string[];
  containers(): string[];
}

function runner(extra: Record<string, string> = {}): Runner {
  const dir = temp('cg-ci-runner-');
  const state = join(dir, 'docker');
  const home = join(dir, 'home');
  const executable = (path: string, text: string): void => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
    chmodSync(path, 0o755);
  };
  mkdirSync(state, { recursive: true });
  mkdirSync(home, { recursive: true });
  executable(join(dir, 'bin/docker'), FAKE_DOCKER);
  // The runner's Node is a script here: nothing to link.
  executable(join(dir, 'bin/ldd'), '#!/bin/sh\nexit 0\n');
  executable(join(dir, 'tool/node/bin/node'), '#!/bin/sh\nexit 0\n');
  executable(join(dir, 'temp/pnpm/bin/pnpm'), '#!/bin/sh\nexit 0\n');
  const lines = (file: string): string[] => (existsSync(join(state, file)) ? readFileSync(join(state, file), 'utf8').split('\n').filter((line) => line !== '') : []);
  return {
    state,
    home,
    env: {
      PATH: `${join(dir, 'temp/pnpm/bin')}:${join(dir, 'tool/node/bin')}:${join(dir, 'bin')}:/usr/bin:/bin`,
      HOME: home,
      CG_FAKE_DOCKER: state,
      RUNNER_TEMP: join(dir, 'temp'),
      RUNNER_NAME: 'winpc-chat-extension-1',
      GITHUB_RUN_ID: '4242',
      GITHUB_RUN_ATTEMPT: '2',
      ...extra,
    },
    calls: () => lines('calls'),
    containers: () => lines('containers'),
  };
}

const CONTAINER = 'cg-e2e-winpc-chat-extension-1-4242-2';
const LABEL = `label=cg-e2e.workspace=${REPO_ROOT}`;

/** Starts a workflow `run:` line as the runner does: `bash -e <file with the text>`, the checkout as the working directory. */
function startStep(r: Runner, text: string): { child: ChildProcess; output: () => string; ended: Promise<{ code: number | null; signal: string | null }> } {
  const file = join(r.env['RUNNER_TEMP'] ?? '', `step-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(file, `${text}\n`);
  const child = spawn('bash', ['-e', file], { cwd: REPO_ROOT, env: r.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const ended = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, output: () => output, ended };
}

async function until(what: string, condition: () => boolean, output: () => string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`${what} — not within ${ms} ms. The step said:\n${output()}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** The runner gives a cancelled step 7.5 s after SIGINT before it goes on to SIGTERM. */
const RUNNER_SIGINT_WAIT_MS = 7500;

describe('the e2e container of a CI job', () => {
  const E2E_STEP = runLine('e2e (headless Firefox');
  const CLEANUP_STEP = runLine('Remove the e2e container, if one is left');

  it('is started by a script that takes the runner’s signal itself: the step is `exec`, and a clean-up step always follows', () => {
    expect(E2E_STEP).toBe('exec tools/ci/e2e-docker.sh');
    expect(WORKFLOW).toMatch(/- name: Remove the e2e container, if one is left\n {8}if: always\(\) && steps\.scope\.outputs\.e2e != 'false'\n/);
    expect(CLEANUP_STEP).toContain('tools/ci/e2e-docker.sh --remove-container');
  });

  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    it(`a cancelled job (${signal} to the step’s process, as the runner sends it) removes its container and ends well inside the runner’s wait`, async () => {
      const r = runner();
      const step = startStep(r, E2E_STEP);
      await until('the container starts', () => r.containers().includes(CONTAINER), step.output);
      // Named for the run and labelled with the checkout it has mounted.
      expect(r.calls().find((call) => call.startsWith('run '))).toMatch(new RegExp(`^run --name ${CONTAINER} --label cg-e2e\\.workspace=${REPO_ROOT.replace(/[.+]/g, '\\$&')} --rm --init --network none `));

      const at = Date.now();
      step.child.kill(signal);
      expect(await step.ended).toEqual({ code, signal: null });
      expect(Date.now() - at).toBeLessThan(RUNNER_SIGINT_WAIT_MS);
      expect(r.containers()).toEqual([]);
      expect(r.calls()).toContain(`rm -f ${CONTAINER}`);
      expect(step.output()).toContain(`e2e-docker: ${signal} — the job is being cancelled\ne2e-docker: removed the container of this run: ${CONTAINER}`);
    });
  }

  it('what a killed run left is removed by the clean-up step, and again by the next run of the same checkout before it starts', async () => {
    const r = runner();
    // SIGKILL: the script gets no say; its container (and the orphaned client) stay.
    const killed = startStep(r, E2E_STEP);
    await until('the container starts', () => r.containers().includes(CONTAINER), killed.output);
    killed.child.kill('SIGKILL');
    await killed.ended;
    expect(r.containers()).toEqual([CONTAINER]);

    const cleanup = startStep(r, CLEANUP_STEP);
    expect(await cleanup.ended).toEqual({ code: 0, signal: null });
    expect(r.containers()).toEqual([]);
    expect(cleanup.output()).toContain(`e2e-docker: removed the container the run left behind: ${CONTAINER}`);
    expect(r.calls().filter((call) => call.startsWith('ps '))).toContain(`ps -a --filter ${LABEL} --format {{.Names}}`);
    // Nothing left: the step has nothing to do and says nothing.
    const again = startStep(r, CLEANUP_STEP);
    expect(await again.ended).toEqual({ code: 0, signal: null });
    expect(again.output()).toBe('');

    // No clean-up step ran at all (the runner itself died): the next job finds the container.
    writeFileSync(join(r.state, 'containers'), 'cg-e2e-winpc-chat-extension-1-4241-1\n');
    writeFileSync(join(r.state, 'run-mode'), 'exit:0');
    const next = startStep(r, E2E_STEP);
    expect(await next.ended).toEqual({ code: 0, signal: null });
    expect(next.output()).toContain('e2e-docker: removed a container an earlier run left in this checkout: cg-e2e-winpc-chat-extension-1-4241-1');
    const calls = r.calls();
    expect(calls.indexOf('rm -f cg-e2e-winpc-chat-extension-1-4241-1')).toBeGreaterThan(-1);
    expect(calls.indexOf('rm -f cg-e2e-winpc-chat-extension-1-4241-1')).toBeLessThan(calls.findLastIndex((call) => call.startsWith('run ')));
  });

  it('ends with what the suite ended with', async () => {
    for (const code of [0, 1, 7]) {
      const r = runner();
      writeFileSync(join(r.state, 'run-mode'), `exit:${code}`);
      const step = startStep(r, E2E_STEP);
      expect(await step.ended, step.output()).toEqual({ code, signal: null });
    }
  });

  it('on a runner of our own the images of earlier digests go once no run has used them for two weeks; elsewhere nothing is removed', async () => {
    const fresh = '1'.repeat(64);
    const stale = '2'.repeat(64);
    const unknown = '3'.repeat(64);
    const repository = IMAGE.slice(0, IMAGE.indexOf('@'));
    const images = `${DIGEST}\n${fresh}\n${stale}\n${unknown}\nlatest\n`;

    const own = runner({ RUNNER_ENVIRONMENT: 'self-hosted' });
    const seen = join(own.home, '.cache/cg-e2e-images');
    mkdirSync(seen, { recursive: true });
    writeFileSync(join(own.state, 'images'), images);
    writeFileSync(join(own.state, 'run-mode'), 'exit:0');
    // A branch that still pins `fresh` ran yesterday; `stale` last ran twenty days ago; `unknown` was never noted.
    writeFileSync(join(seen, fresh), '');
    writeFileSync(join(seen, stale), '');
    const day = 24 * 60 * 60;
    utimesSync(join(seen, fresh), Date.now() / 1000 - day, Date.now() / 1000 - day);
    utimesSync(join(seen, stale), Date.now() / 1000 - 20 * day, Date.now() / 1000 - 20 * day);

    const step = startStep(own, E2E_STEP);
    expect(await step.ended, step.output()).toEqual({ code: 0, signal: null });
    expect(own.calls()).toContain(`tag ${IMAGE} cg-e2e-firefox:${DIGEST}`);
    expect(own.calls().filter((call) => call.startsWith('rmi '))).toEqual([`rmi cg-e2e-firefox:${stale} ${repository}@sha256:${stale}`, `rmi cg-e2e-firefox:${unknown} ${repository}@sha256:${unknown}`]);
    expect(existsSync(join(seen, DIGEST))).toBe(true);
    expect(existsSync(join(seen, fresh))).toBe(true);
    expect(existsSync(join(seen, stale))).toBe(false);
    expect(step.output()).toContain(`e2e-docker: removed the image of an earlier digest, not used for two weeks: ${stale}`);

    const hosted = runner({ RUNNER_ENVIRONMENT: 'github-hosted' });
    writeFileSync(join(hosted.state, 'images'), images);
    writeFileSync(join(hosted.state, 'run-mode'), 'exit:0');
    expect(await startStep(hosted, E2E_STEP).ended).toEqual({ code: 0, signal: null });
    expect(hosted.calls().filter((call) => call.startsWith('rmi '))).toEqual([]);
    expect(existsSync(join(hosted.home, '.cache'))).toBe(false);
  });
});

// ── which changes need the suite ───────────────────────────────────────────

const NEEDED = join(REPO_ROOT, 'tools/ci/e2e-needed.sh');

function needed(options: { cwd?: string; env?: Record<string, string>; paths?: readonly string[] }): { line: string; why: string } {
  const result = spawnSync('bash', [NEEDED, ...(options.paths === undefined ? [] : ['--paths'])], {
    cwd: options.cwd ?? REPO_ROOT,
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...options.env },
    input: options.paths === undefined ? '' : `${options.paths.join('\n')}\n`,
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return { line: result.stdout.trim(), why: result.stderr.trim() };
}

/** A throwaway repository; `git(...)` runs in it and returns what git printed. */
function repository(): { dir: string; git: (...args: string[]) => string; write: (path: string, text: string) => void; commit: (message: string) => string } {
  const dir = temp('cg-ci-repo-');
  const git = (...args: string[]): string => {
    const result = spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.test', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: dir, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (path: string, text: string): void => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  git('init', '--quiet', '--initial-branch=main');
  write('packages/core/src/a.ts', 'export const a = 1;\n');
  write('docs/release.md', '# release\n');
  write('site/index.html', '<!doctype html>\n');
  write('README.md', '# readme\n');
  const commit = (message: string): string => {
    git('add', '-A');
    git('commit', '--quiet', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  commit('base');
  return { dir, git, write, commit };
}

describe('which changes run the e2e suite', () => {
  it('documents alone do not: docs/, site/ and the *.md of the root; anything else does', () => {
    const paths = (...list: string[]): string => needed({ paths: list }).line;
    expect(paths('docs/release.md', 'docs/releases/0.1.0.md', 'site/index.html', 'site/site.css', 'README.md', 'CHANGELOG.md', 'AGENTS.md', 'BUILD.md')).toBe('e2e=false');
    for (const code of [
      'packages/core/src/a.ts',
      'apps/extension/package.json',
      'packages/ui/README.md', // a *.md, but inside the code: not on the short list
      'tools/ci/e2e-docker.sh',
      '.github/workflows/ci.yml',
      'pnpm-lock.yaml',
      'package.json',
      '.nvmrc',
      'vendor/kernel-sdk/index.js',
      'docsx/a.md',
      '"docs/\\320\\277.md"', // a name git had to quote: not guessed at
    ]) {
      expect(paths('docs/release.md', code), code).toBe('e2e=true');
    }
    // No list at all is no reason to skip.
    expect(paths()).toBe('e2e=true');
    expect(needed({ paths: ['packages/core/src/a.ts'] }).why).toBe('e2e-needed: packages/core/src/a.ts is not a document — the run is needed');
  });

  it('a pull request is judged whole, against its base: the merge commit GitHub checks out against its first parent', () => {
    const r = repository();
    const pr = (name: string, change: () => void): { env: Record<string, string> } => {
      r.git('checkout', '--quiet', '-b', name, 'main');
      change();
      r.git('checkout', '--quiet', '--detach', 'main');
      r.git('merge', '--quiet', '--no-ff', '-m', `Merge ${name}`, name);
      return { env: { GITHUB_EVENT_NAME: 'pull_request' } };
    };

    pr('docs-only', () => {
      r.write('docs/release.md', '# release, edited\n');
      r.commit('docs');
      r.write('site/index.html', '<!doctype html>\n<p>edited</p>\n');
      r.write('CHANGELOG.md', '# changelog\n');
      r.commit('site and changelog');
    });
    expect(needed({ cwd: r.dir, env: { GITHUB_EVENT_NAME: 'pull_request' } })).toEqual({ line: 'e2e=false', why: 'e2e-needed: all 3 changed file(s) are under docs/, site/ or are *.md in the root — the e2e run reads none of them' });

    // Code in the first commit, a document in the last: the PR as a whole changes code.
    pr('code-then-docs', () => {
      r.write('packages/core/src/a.ts', 'export const a = 2;\n');
      r.commit('code');
      r.write('docs/release.md', '# release, edited again\n');
      r.commit('docs');
    });
    expect(needed({ cwd: r.dir, env: { GITHUB_EVENT_NAME: 'pull_request' } }).line).toBe('e2e=true');

    // A source file moved into docs/: its old path counts.
    pr('moved-out', () => {
      r.git('mv', 'packages/core/src/a.ts', 'docs/a.ts');
      r.commit('move');
    });
    expect(needed({ cwd: r.dir, env: { GITHUB_EVENT_NAME: 'pull_request' } }).line).toBe('e2e=true');

    // Not a merge commit (a checkout of another kind): nothing is skipped on a guess.
    r.git('checkout', '--quiet', '--detach', 'docs-only');
    expect(needed({ cwd: r.dir, env: { GITHUB_EVENT_NAME: 'pull_request' } })).toEqual({ line: 'e2e=true', why: 'e2e-needed: HEAD is not the merge commit of a pull request (or its parents were not fetched)' });
  });

  it('a push is judged by everything it brought, from the commit the branch was at before', () => {
    const r = repository();
    const before = r.git('rev-parse', 'HEAD');
    r.write('docs/release.md', '# release, edited\n');
    r.commit('docs');
    r.write('README.md', '# readme, edited\n');
    const docsTip = r.commit('readme');
    const push = (from: string): string => needed({ cwd: r.dir, env: { GITHUB_EVENT_NAME: 'push', CG_PUSH_BEFORE: from } }).line;
    expect(push(before)).toBe('e2e=false');

    r.write('packages/core/src/a.ts', 'export const a = 3;\n');
    r.commit('code');
    expect(push(before)).toBe('e2e=true');
    expect(push(docsTip)).toBe('e2e=true');

    // Any doubt runs the suite: a new branch, a commit that is not here and cannot be fetched, no commit named.
    expect(push('0'.repeat(40))).toBe('e2e=true');
    expect(push('9'.repeat(40))).toBe('e2e=true');
    expect(push('')).toBe('e2e=true');
    // And so does a run started by hand.
    expect(needed({ cwd: r.dir, env: { GITHUB_EVENT_NAME: 'workflow_dispatch' } }).line).toBe('e2e=true');
    expect(needed({ cwd: r.dir, env: {} }).line).toBe('e2e=true');
  });

  it('the workflow: `check` always runs in full; in `e2e` every step after the question is skipped only on a plain «false»', () => {
    const [check = '', e2e = ''] = WORKFLOW.slice(WORKFLOW.indexOf('\n  check:\n')).split('\n  e2e:\n');
    expect(check).toContain('name: pnpm check');
    expect(e2e).toContain('name: pnpm e2e');
    expect(check).not.toContain('steps.scope');
    expect(e2e).toMatch(/- name: Checkout\n {8}uses: actions\/checkout@v6\n {8}with:\n {10}fetch-depth: 2\n/);
    expect(runLine('Does this change need e2e\\?')).toBe('tools/ci/e2e-needed.sh >> "$GITHUB_OUTPUT"');
    const steps = e2e.slice(e2e.indexOf('- name: Does this change need e2e?')).split(/\n {6}- name: /).slice(1);
    expect(steps.map((step) => step.split('\n')[0])).toEqual(['Setup Node.js', 'Setup pnpm', 'Install dependencies', 'e2e (headless Firefox in the pinned image, no network)', 'Remove the e2e container, if one is left', 'Upload e2e logs']);
    for (const step of steps.slice(0, 5)) expect(step, step.split('\n')[0]).toMatch(/\n {8}if: (always\(\) && )?steps\.scope\.outputs\.e2e != 'false'\n/);
    // No workflow-level path filter: a required check of a workflow that never starts would wait for ever.
    expect(WORKFLOW).not.toMatch(/^\s+paths(-ignore)?:/m);
  });
});

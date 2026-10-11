// The CI job «e2e» around its container (.github/workflows/ci.yml,
// tools/ci/e2e-docker.sh, tools/ci/e2e-needed.sh) and its local variant
// (tools/ci/e2e-docker-local.sh) — what can be checked without Docker and
// without GitHub:
//   - a cancelled job does not leave its container: the workflow's own `run:`
//     line is started the way the runner starts a step, signalled the way the
//     runner cancels one, against a stand-in `docker` that keeps "containers"
//     in a file;
//   - which changes skip the suite, on a throwaway git repository;
//   - a local run: it does not start on a volume that a container of another
//     checkout has mounted, takes the place of an earlier run of its own
//     checkout, and removes its container when it is signalled — against the
//     same stand-in.
// The real thing — the same line, the real Docker, a real cancel sequence; real
// starts on one volume, real signals to a local run — was run by hand;
// docs/release.md, «Что проверено».

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

/**
 * A stand-in for the docker client: logs every call; containers and image tags are lines of files. `containers` holds the
 * names of the running ones; `on-<volume>` those running with a volume mounted, `created-<volume>` those that have it
 * mounted and were never started, `removing-<volume>` those on their way out — «name», or «name|pid|checkout» for one that
 * tools/ci/e2e-docker-local.sh started (its two labels). A `run` ends at once when `run-mode` — or `run-mode.<the last word of the container's name>` — says
 * `exit:<status>`; otherwise it is an attached client and writes its pid to `pid-<name>`. Two more modes are the real client
 * in its first moments (see the tests that use them): `deaf` — a SIGTERM does not end it; `late` — it is still creating the
 * container, which appears, never started, a moment after the client is gone.
 */
const FAKE_DOCKER = `#!/bin/bash
S=$CG_FAKE_DOCKER
printf '%s\\n' "$*" >> "$S/calls"
case "$1" in
  info) echo '["name=seccomp","name=rootless"]' ;;
  image | pull)
    # \`image-mode\`, \`pull-mode\`: «absent» — the image is not there; «slow» — the command takes its time.
    case "$(cat "$S/$1-mode" 2> /dev/null)" in absent) exit 1 ;; slow) sleep 3 ;; esac
    exit 0 ;;
  tag | rmi) exit 0 ;;
  images) cat "$S/images" 2> /dev/null; exit 0 ;;
  ps)
    # With a volume: «state|name|the label pid|the label checkout», the two labels empty on a container that has none.
    for arg in "$@"; do
      case "$arg" in
        volume=*)
          for state in running created removing; do
            list=$S/$state-\${arg#volume=}; [ "$state" = running ] && list=$S/on-\${arg#volume=}
            awk -v state="$state" '{ print state "|" (index($0, "|") ? $0 : $0 "||") }' "$list" 2> /dev/null
          done
          exit 0 ;;
      esac
    done
    cat "$S/containers" 2> /dev/null; exit 0 ;;
  rm)
    shift; [ "$1" = -f ] && shift
    for name in "$@"; do
      # As the real client: the name of a container it removed, nothing for one that is not there.
      there=''
      for list in "$S/containers" "$S"/on-* "$S"/created-* "$S"/removing-*; do
        [ -f "$list" ] || continue
        awk -F '|' -v name="$name" '$1 == name { there = 1; next } { print } END { exit !there }' "$list" > "$S/rewritten.$$" && there=1
        mv "$S/rewritten.$$" "$list"
      done
      [ -z "$there" ] || echo "$name"
    done ;;
  run)
    name=''; volume=''; checkout=''; pid=''; prev=''
    for arg in "$@"; do
      case "$prev $arg" in
        '--name '*) name=$arg ;;
        '--label cg-e2e.local.checkout='*) checkout=\${arg#*=} ;;
        '--label cg-e2e.local.pid='*) pid=\${arg#*=} ;;
        '--mount type=volume,source='*) volume=\${arg#type=volume,source=}; volume=\${volume%%,*} ;;
      esac
      prev=$arg
    done
    # -i: what is piped in is read to its end, as the process in the container reads it.
    for arg in "$@"; do [ "$arg" = -i ] && cat > /dev/null; done
    mode=$(cat "$S/run-mode.\${name##*-}" 2> /dev/null || cat "$S/run-mode" 2> /dev/null)
    case "$mode" in exit:*) exit "\${mode#exit:}" ;; deaf) trap '' TERM ;; esac
    echo $$ > "$S/pid-$name"
    if [ "$mode" = late ]; then
      (sleep 0.15; echo "$name|$pid|$checkout" >> "$S/created-$volume") > /dev/null 2>&1 &
      while [ -d "$S" ]; do sleep 0.05; done
      exit 1
    fi
    [ -z "$volume" ] || echo "$name|$pid|$checkout" >> "$S/on-$volume"
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

interface Started {
  readonly child: ChildProcess;
  readonly output: () => string;
  readonly ended: Promise<{ code: number | null; signal: string | null }>;
}

/** Starts bash with what it is to run; what it prints is kept, both streams together. */
function start(args: readonly string[], cwd: string, env: Record<string, string>): Started {
  const child = spawn('bash', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const ended = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, output: () => output, ended };
}

/** Starts a workflow `run:` line as the runner does: `bash -e <file with the text>`, the checkout as the working directory. */
function startStep(r: Runner, text: string): Started {
  const file = join(r.env['RUNNER_TEMP'] ?? '', `step-${Math.random().toString(36).slice(2)}.sh`);
  writeFileSync(file, `${text}\n`);
  return start(['-e', file], REPO_ROOT, r.env);
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

// ── the same job on a machine of one's own ─────────────────────────────────

interface Checkout {
  readonly path: string;
  readonly dir: string;
}

/** tools/ci/e2e-docker-local.sh in a throwaway checkout of its own, with what it reads: step 1 archives the tree the script stands in. */
function localScript(): Checkout {
  const checkout = repository();
  for (const file of ['tools/ci/e2e-docker-local.sh', 'tools/ci/e2e-image.sh', '.nvmrc', 'package.json']) checkout.write(file, readFileSync(join(REPO_ROOT, file), 'utf8'));
  return { path: join(checkout.dir, 'tools/ci/e2e-docker-local.sh'), dir: checkout.dir };
}

/**
 * One start of the local script, to its end. No volume: the script's default. A start that does not end — it went on where it
 * should have refused, and its stand-in client stays attached — is killed, and reads as no status.
 */
function local(r: Runner, script: Checkout, volume?: string, args: readonly string[] = []): { status: number | null; stdout: string; stderr: string; pid: number } {
  const { status, stdout, stderr, pid } = spawnSync('bash', [script.path, ...args], {
    cwd: script.dir,
    env: { ...r.env, ...(volume === undefined ? {} : { CG_E2E_VOLUME: volume }) },
    encoding: 'utf8',
    timeout: 20_000,
    killSignal: 'SIGKILL',
  });
  return { status, stdout, stderr, pid };
}

/** The same start, left running. The process is the script itself, so its pid is the one in the names of its containers. */
function startLocal(r: Runner, script: Checkout, volume: string): Started & { readonly pid: number } {
  const started = start([script.path], script.dir, { ...r.env, CG_E2E_VOLUME: volume });
  return { ...started, pid: started.child.pid ?? 0 };
}

/** The script's look at a volume: the containers that have it mounted, each with its state and with the script and the checkout it was started from. */
const look = (volume: string): string => `ps -a --filter volume=${volume} --format {{.State}}|{{.Names}}|{{.Label "cg-e2e.local.pid"}}|{{.Label "cg-e2e.local.checkout"}}`;

describe('a local run of the e2e job in a Docker volume', () => {
  const refusal = (volume: string, containers: string): string =>
    `e2e-docker-local: the volume ${volume} is in use (running with it mounted: ${containers}) — a start now would replace the working tree under that run. Wait for it to end, or give this run a volume of its own: CG_E2E_VOLUME=<own name>\n`;
  /** The other refusal. It names the way to end that run — as it has to be typed: with the volume, when the start named one. */
  const going = (volume: string | undefined, containers: string): string =>
    `e2e-docker-local: a run of this checkout is going on the volume ${volume ?? 'cg-e2e-local'} (${containers}) — a start now would replace the working tree under it. Wait for it to end, end it with ${volume === undefined ? '' : `CG_E2E_VOLUME=${volume} `}tools/ci/e2e-docker-local.sh --remove-container, or give this run a volume of its own: CG_E2E_VOLUME=<own name>\n`;
  const runs = (r: Runner): string[] => r.calls().filter((call) => call.startsWith('run '));
  const removals = (r: Runner): string[] => r.calls().filter((call) => call.startsWith('rm '));
  /** A container that is not this script's, running with the volume mounted. */
  const stranger = (r: Runner, volume: string, name: string): void => {
    for (const list of ['containers', `on-${volume}`]) writeFileSync(join(r.state, list), `${existsSync(join(r.state, list)) ? readFileSync(join(r.state, list), 'utf8') : ''}${name}\n`);
  };

  it('does not start while a running container that is not its checkout’s has its volume mounted — one line, and nothing is run; on a volume of its own it goes through both steps', () => {
    const r = runner();
    const script = localScript();
    writeFileSync(join(r.state, 'run-mode'), 'exit:0');
    // Another session named no volume either and its run is going: in its step 1 or in its step 2, its container has the default volume mounted.
    writeFileSync(join(r.state, 'on-cg-e2e-local'), 'quirky_hopper\n');

    expect(local(r, script)).toMatchObject({ status: 1, stdout: '', stderr: refusal('cg-e2e-local', 'quirky_hopper') });
    // Docker was asked about that volume and nothing else was done: the tree in it is as the other run has it.
    expect(r.calls()).toEqual([look('cg-e2e-local')]);

    // Two of them (runs that did collide, a shell somebody left in the volume): still one line.
    writeFileSync(join(r.state, 'on-cg-e2e-local'), 'quirky_hopper\nnifty_noether\n');
    expect(local(r, script)).toMatchObject({ status: 1, stdout: '', stderr: refusal('cg-e2e-local', 'quirky_hopper, nifty_noether') });

    // The same start on a volume of its own, while those containers run.
    const own = local(r, script, 'cg-e2e-own');
    expect(own.status, own.stderr).toBe(0);
    const calls = r.calls().filter((call) => /^(ps|run|image|rm) /.test(call));
    expect(calls.map((call) => call.slice(0, call.indexOf(' ')))).toEqual(['ps', 'ps', 'ps', 'run', 'image', 'run']);
    expect(calls[2]).toBe(look('cg-e2e-own'));
    // Both steps mount the volume the question was about, so a start during another start’s step 1 gets the same answer.
    for (const step of [calls[3], calls[5]]) expect(step).toContain(' --mount type=volume,source=cg-e2e-own,target=/sim ');
  });

  it('names its two containers for the volume and for its own process, and labels them with that process and the checkout it was started from', () => {
    const r = runner();
    const script = localScript();
    writeFileSync(join(r.state, 'run-mode'), 'exit:0');
    for (const [volume, prefix] of [
      [undefined, 'cg-e2e-local'],
      ['cg-e2e-popup-panel', 'cg-e2e-popup-panel'],
      ['mine', 'cg-e2e-mine'],
    ] as const) {
      const before = runs(r).length;
      const run = local(r, script, volume);
      expect(run.status, run.stderr).toBe(0);
      const [install = '', suite = ''] = runs(r).slice(before);
      const labels = `--label cg-e2e.local.checkout=${script.dir} --label cg-e2e.local.pid=${run.pid}`;
      const mount = `--mount type=volume,source=${volume ?? 'cg-e2e-local'},target=/sim `;
      const first = `run --name ${prefix}-${run.pid}-install ${labels} --rm --init -i ${mount}`;
      const second = `run --name ${prefix}-${run.pid}-run ${labels} --rm --init --network none `;
      expect(install.slice(0, first.length)).toBe(first);
      expect(suite.slice(0, second.length)).toBe(second);
      expect(suite).toContain(` ${mount}`);
    }
  });

  it('ends with what a step ended with: a failed install is the end of the run, a failed suite is its status', () => {
    const r = runner();
    const script = localScript();
    writeFileSync(join(r.state, 'run-mode.install'), 'exit:3');
    writeFileSync(join(r.state, 'run-mode.run'), 'exit:7');
    expect(local(r, script, 'cg-e2e-own').status).toBe(3);
    expect(runs(r)).toHaveLength(1);
    writeFileSync(join(r.state, 'run-mode.install'), 'exit:0');
    expect(local(r, script, 'cg-e2e-own').status).toBe(7);
    expect(runs(r)).toHaveLength(3);
    // The image of step 2 is not on the machine: it is pulled, and the run goes on …
    writeFileSync(join(r.state, 'image-mode'), 'absent');
    expect(local(r, script, 'cg-e2e-own').status).toBe(7);
    expect(r.calls().filter((call) => call.startsWith('pull '))).toEqual([`pull --quiet ${IMAGE}`]);
    expect(runs(r)).toHaveLength(5);
    // … and when it cannot be pulled, that is the end: no run.
    writeFileSync(join(r.state, 'pull-mode'), 'absent');
    expect(local(r, script, 'cg-e2e-own').status).toBe(1);
    expect(runs(r)).toHaveLength(6);
  });

  for (const [signal, code, sender] of [
    ['SIGINT', 130, 'Ctrl-C'],
    ['SIGTERM', 143, 'an agent shell stopping the command'],
    ['SIGHUP', 129, 'a closed terminal'],
  ] as const) {
    for (const step of ['install', 'run'] as const) {
      it(`${signal} to the script (${sender}) during step ${step === 'install' ? 1 : 2} removes the container of the run and ends the script with ${code}`, async () => {
        const r = runner();
        const script = localScript();
        if (step === 'run') writeFileSync(join(r.state, 'run-mode.install'), 'exit:0');
        const run = startLocal(r, script, 'cg-e2e-own');
        const container = `cg-e2e-own-${run.pid}-${step}`;
        await until(`step ${step} starts`, () => r.containers().includes(container), run.output);

        // To the script alone: nobody tells the docker client, and the script must not count on it.
        run.child.kill(signal);
        expect(await run.ended).toEqual({ code, signal: null });
        expect(r.containers()).toEqual([]);
        // Its own two names and nothing else.
        expect(removals(r)).toEqual([`rm -f cg-e2e-own-${run.pid}-install cg-e2e-own-${run.pid}-run`]);
        const said = `e2e-docker-local: ${signal} — the run is being stopped\ne2e-docker-local: removed the container of this run: ${container}\n`;
        await until('the script says what it did', () => run.output().endsWith(said), run.output);
        // Stopped during the install, it does not go on to the suite.
        expect(runs(r)).toHaveLength(step === 'install' ? 1 : 2);
      });
    }
  }

  for (const [what, call, modes] of [
    ['checks that the image is there', 'image inspect ', { image: 'slow' }],
    ['pulls the image', 'pull ', { image: 'absent', pull: 'slow' }],
  ] as const) {
    it(`Ctrl-C between the steps, while it ${what}, ends the script at once and no run starts: it does not wait for that command in the foreground, where bash may drop a SIGINT`, async () => {
      const r = runner();
      const script = localScript();
      writeFileSync(join(r.state, 'run-mode.install'), 'exit:0');
      for (const [command, mode] of Object.entries(modes)) writeFileSync(join(r.state, `${command}-mode`), mode);
      const run = startLocal(r, script, 'cg-e2e-own');
      await until(`it ${what}`, () => r.calls().some((made) => made.startsWith(call)), run.output);
      const at = Date.now();
      run.child.kill('SIGINT');
      expect(await run.ended).toEqual({ code: 130, signal: null });
      // Not when the command is through (3 s in the stand-in): now.
      expect(Date.now() - at).toBeLessThan(2500);
      expect(runs(r)).toHaveLength(1);
      expect(r.containers()).toEqual([]);
    });
  }

  it('removes its container on a signal even when nobody reads its output any more: Ctrl-C on `… | tee log` ends the tee as well', async () => {
    const r = runner();
    const script = localScript();
    writeFileSync(join(r.state, 'run-mode.install'), 'exit:0');
    const run = startLocal(r, script, 'cg-e2e-own');
    await until('the run starts', () => r.containers().includes(`cg-e2e-own-${run.pid}-run`), run.output);
    run.child.stdout?.destroy();
    run.child.stderr?.destroy();
    run.child.kill('SIGINT');
    expect(await run.ended).toEqual({ code: 130, signal: null });
    expect(r.containers()).toEqual([]);
  });

  it('ends a docker client that a SIGTERM does not end — the real one loses a signal that comes while it is still creating the container, and goes on to run the suite', async () => {
    const r = runner();
    const script = localScript();
    writeFileSync(join(r.state, 'run-mode.install'), 'exit:0');
    writeFileSync(join(r.state, 'run-mode.run'), 'deaf');
    const run = startLocal(r, script, 'cg-e2e-own');
    const container = `cg-e2e-own-${run.pid}-run`;
    await until('the run starts', () => r.containers().includes(container), run.output);
    run.child.kill('SIGTERM');
    // Not after the suite, whenever that would be: at once.
    expect(await run.ended).toEqual({ code: 143, signal: null });
    expect(r.containers()).toEqual([]);
    expect(() => process.kill(Number(readFileSync(join(r.state, `pid-${container}`), 'utf8')), 0)).toThrow();
  });

  it('a signal that comes while the docker client is still creating the container: the container appears a moment after the client is ended, and is removed then', async () => {
    const r = runner();
    const script = localScript();
    writeFileSync(join(r.state, 'run-mode.install'), 'exit:0');
    writeFileSync(join(r.state, 'run-mode.run'), 'late');
    const run = startLocal(r, script, 'cg-e2e-own');
    const container = `cg-e2e-own-${run.pid}-run`;
    await until('the client of step 2 starts', () => existsSync(join(r.state, `pid-${container}`)), run.output);
    run.child.kill('SIGTERM');
    expect(await run.ended).toEqual({ code: 143, signal: null });
    // Looked for twice: nothing the first time, the container that was never started the second.
    expect(removals(r)).toHaveLength(2);
    expect(readFileSync(join(r.state, 'created-cg-e2e-own'), 'utf8')).toBe('');
    await until('the script says what it did', () => run.output().endsWith(`e2e-docker-local: removed the container of this run: ${container}\n`), run.output);
  });

  it('when its docker client is killed under it, removes the container that client left and ends as the client did', async () => {
    const r = runner();
    const script = localScript();
    writeFileSync(join(r.state, 'run-mode.install'), 'exit:0');
    const run = startLocal(r, script, 'cg-e2e-own');
    const container = `cg-e2e-own-${run.pid}-run`;
    await until('the run starts', () => r.containers().includes(container), run.output);
    process.kill(Number(readFileSync(join(r.state, `pid-${container}`), 'utf8')), 'SIGKILL');
    expect(await run.ended).toEqual({ code: 137, signal: null });
    expect(r.containers()).toEqual([]);
    const said = `e2e-docker-local: step 2 — the run, no network\ne2e-docker-local: removed the container of this run: ${container}\n`;
    await until('the script says what it did', () => run.output().endsWith(said), run.output);
  });

  /** A run of `script` on cg-e2e-own, killed with SIGKILL in step 2: the script gets no say, its container (and the client, now nobody’s) stay. */
  const killedRun = async (r: Runner, script: Checkout): Promise<string> => {
    const run = startLocal(r, script, 'cg-e2e-own');
    const container = `cg-e2e-own-${run.pid}-run`;
    await until('the run starts', () => r.containers().includes(container), run.output);
    run.child.kill('SIGKILL');
    await run.ended;
    expect(r.containers()).toContain(container);
    return container;
  };

  it('what a killed run left is removed by the next start in the same checkout on the same volume; from another checkout the start is refused and nothing is removed', async () => {
    const r = runner();
    const mine = localScript();
    const other = localScript();
    writeFileSync(join(r.state, 'run-mode.install'), 'exit:0');

    // Another checkout on that volume: refused as any other container is, and the line says whose run it is.
    const left = await killedRun(r, mine);
    const mark = r.calls().length;
    expect(local(r, other, 'cg-e2e-own')).toMatchObject({ status: 1, stdout: '', stderr: refusal('cg-e2e-own', `${left} from ${mine.dir}`) });
    expect(local(r, other, 'cg-e2e-own', ['--remove-container'])).toMatchObject({ status: 0, stdout: '', stderr: '' });
    // The same checkout, another volume: that container is not in its way, and it is not in the way of that container.
    writeFileSync(join(r.state, 'run-mode.run'), 'exit:0');
    expect(local(r, mine, 'cg-e2e-second').status).toBe(0);
    expect(removals(r)).toEqual([]);
    expect(r.containers()).toEqual([left]);
    expect(r.calls().slice(mark, mark + 3)).toEqual([look('cg-e2e-own'), look('cg-e2e-own'), look('cg-e2e-second')]);

    // The same checkout, the same volume: nobody reads that run any more, so the start removes it and says so.
    const next = local(r, mine, 'cg-e2e-own');
    expect(next.status, next.stderr).toBe(0);
    expect(next.stdout.split('\n')[0]).toBe(`e2e-docker-local: an earlier run of this checkout left its container on the volume cg-e2e-own, and its script is gone — removed: ${left}`);
    expect(removals(r)).toEqual([`rm -f ${left}`]);
    expect(r.calls().indexOf(`rm -f ${left}`)).toBeLessThan(r.calls().findLastIndex((call) => call.startsWith(`run --name cg-e2e-own-${next.pid}-install `)));
    expect(r.containers()).toEqual([]);

    // Its own leftover AND a container that is not its own on the volume: refused, and the leftover stays too.
    rmSync(join(r.state, 'run-mode.run'));
    const again = await killedRun(r, mine);
    stranger(r, 'cg-e2e-own', 'quirky_hopper');
    const before = removals(r).length;
    expect(local(r, mine, 'cg-e2e-own')).toMatchObject({ status: 1, stdout: '', stderr: refusal('cg-e2e-own', 'quirky_hopper') });
    expect(removals(r)).toHaveLength(before);
    expect(r.containers()).toEqual([again, 'quirky_hopper']);
  });

  it('a container that was never started is no run: what an earlier run of its checkout left that way is removed, and nobody else’s holds a start up or is touched', () => {
    const r = runner();
    const script = localScript();
    const other = localScript();
    writeFileSync(join(r.state, 'run-mode'), 'exit:0');
    const dead = spawnSync('true').pid;
    // Its own, the script gone; another checkout’s; its own checkout’s, the script alive — a start that is this moment between «create» and «start».
    writeFileSync(join(r.state, 'created-cg-e2e-own'), `stale|${dead}|${script.dir}\nforeign|${dead}|${other.dir}\nstarting|${process.pid}|${script.dir}\nhandmade\n`);
    // And one of its own that Docker is removing this moment — a leftover whose suite has just ended: asking for it again would be an error.
    writeFileSync(join(r.state, 'removing-cg-e2e-own'), `ending|${dead}|${script.dir}\n`);
    const run = local(r, script, 'cg-e2e-own');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.split('\n')[0]).toBe('e2e-docker-local: an earlier run of this checkout left its container on the volume cg-e2e-own, and its script is gone — removed: stale');
    expect(removals(r)).toEqual(['rm -f stale']);
    expect(readFileSync(join(r.state, 'created-cg-e2e-own'), 'utf8')).toBe(`foreign|${dead}|${other.dir}\nstarting|${process.pid}|${script.dir}\nhandmade\n`);
    // --remove-container: the same one and no other.
    writeFileSync(join(r.state, 'created-cg-e2e-own'), `stale|${dead}|${script.dir}\nforeign|${dead}|${other.dir}\n`);
    expect(local(r, script, 'cg-e2e-own', ['--remove-container'])).toMatchObject({ status: 0, stdout: "e2e-docker-local: removed the container of this checkout's run on the volume cg-e2e-own: stale\n" });
    expect(readFileSync(join(r.state, 'created-cg-e2e-own'), 'utf8')).toBe(`foreign|${dead}|${other.dir}\n`);
  });

  it('a killed script whose remains nobody collected is gone all the same; without a `ps` to ask, every run of the checkout is taken for going', async () => {
    const r = runner();
    const script = localScript();
    writeFileSync(join(r.state, 'run-mode.install'), 'exit:0');
    // A wrapper that starts the script and never collects it: once killed, the script stays in the process table as a zombie.
    const pidFile = join(r.state, 'script-pid');
    const wrapper = start(['-c', 'bash "$0" & echo $! > "$1"; exec sleep 60', script.path, pidFile], script.dir, { ...r.env, CG_E2E_VOLUME: 'cg-e2e-own' });
    await until('the wrapper starts the script', () => existsSync(pidFile) && readFileSync(pidFile, 'utf8').trim() !== '', wrapper.output);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    const left = `cg-e2e-own-${pid}-run`;
    await until('the run starts', () => r.containers().includes(left), wrapper.output);
    process.kill(pid, 'SIGKILL');
    const state = (): string => spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
    await until('the script is a zombie', () => state().startsWith('Z'), state);

    // No `ps` that answers: nothing is removed on a guess.
    const ps = join(r.state, '../bin/ps');
    writeFileSync(ps, '#!/bin/sh\nexit 1\n');
    chmodSync(ps, 0o755);
    expect(local(r, script, 'cg-e2e-own')).toMatchObject({ status: 1, stdout: '', stderr: going('cg-e2e-own', left) });
    expect(r.containers()).toEqual([left]);
    rmSync(ps);

    writeFileSync(join(r.state, 'run-mode.run'), 'exit:0');
    const next = local(r, script, 'cg-e2e-own');
    expect(next.status, next.stderr).toBe(0);
    expect(next.stdout.split('\n')[0]).toBe(`e2e-docker-local: an earlier run of this checkout left its container on the volume cg-e2e-own, and its script is gone — removed: ${left}`);
    wrapper.child.kill('SIGKILL');
    await wrapper.ended;
  });

  it('takes a container of its checkout for going when it cannot tell what became of the script that started it: no pid on it, or not a number', () => {
    const r = runner();
    const script = localScript();
    writeFileSync(join(r.state, 'run-mode'), 'exit:0');
    for (const [volume, pid] of [
      ['cg-e2e-own', ''],
      ['cg-e2e-own', 'soon'],
      [undefined, ''],
    ] as const) {
      writeFileSync(join(r.state, `on-${volume ?? 'cg-e2e-local'}`), `handmade|${pid}|${script.dir}\n`);
      expect(local(r, script, volume)).toMatchObject({ status: 1, stdout: '', stderr: going(volume, 'handmade') });
    }
    expect(removals(r)).toEqual([]);
    expect(runs(r)).toEqual([]);
  });

  it('a run of the same checkout that is going is not replaced: the start is refused and names --remove-container, which ends that run and nothing else', async () => {
    const r = runner();
    const script = localScript();
    writeFileSync(join(r.state, 'run-mode.install'), 'exit:0');
    // Somebody may be reading it: the session itself, an agent it started in the same checkout, the owner in a terminal.
    const first = startLocal(r, script, 'cg-e2e-own');
    const container = `cg-e2e-own-${first.pid}-run`;
    await until('the first run starts', () => r.containers().includes(container), first.output);
    expect(local(r, script, 'cg-e2e-own')).toMatchObject({ status: 1, stdout: '', stderr: going('cg-e2e-own', container) });
    // With a container that is not this checkout’s on the volume as well, the line is the one about the volume, and names both.
    stranger(r, 'cg-e2e-own', 'quirky_hopper');
    expect(local(r, script, 'cg-e2e-own')).toMatchObject({ status: 1, stdout: '', stderr: refusal('cg-e2e-own', `${container} from ${script.dir}, quirky_hopper`) });
    expect(removals(r)).toEqual([]);
    expect(r.containers()).toEqual([container, 'quirky_hopper']);

    // --remove-container: the run of this checkout on this volume, alive or not; the stranger stays.
    expect(local(r, script, 'cg-e2e-own', ['--remove-container'])).toMatchObject({ status: 0, stdout: `e2e-docker-local: removed the container of this checkout's run on the volume cg-e2e-own: ${container}\n`, stderr: '' });
    expect(r.containers()).toEqual(['quirky_hopper']);
    // The run follows its container out — and removes its own two names, never «everything of this checkout»: by then a newer run may be there.
    expect(await first.ended).toEqual({ code: 137, signal: null });
    expect(removals(r)).toEqual([`rm -f ${container}`, `rm -f cg-e2e-own-${first.pid}-install ${container}`]);
    // Nothing of this checkout left: nothing to do, nothing to say.
    expect(local(r, script, 'cg-e2e-own', ['--remove-container'])).toMatchObject({ status: 0, stdout: '', stderr: '' });
    expect(runs(r)).toHaveLength(2);
    expect(r.containers()).toEqual(['quirky_hopper']);
  });
});

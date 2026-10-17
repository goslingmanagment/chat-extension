// The gate as a whole, on a throwaway checkout: the files are real (the
// committed site, changelog and version), git, pnpm, gh and the network are
// scripted. What each rule concludes is gate.test.ts; here — that the gate
// asks the right things, in the right order, and never touches the network
// unless told to.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeZip } from '../lib/zip-write.ts';
import { CHANGELOG_FILE, noteFile, releaseTarget, REPO_ROOT, SITE_DIR, VERSION_FILE } from './config.ts';
import type { CommandSpec, Exec } from './exec.ts';
import { feedEntryFor, renderFeed } from './feed.ts';
import { Checkout } from './local.ts';
import { BEFORE_SIGNING, renderNote } from './note.ts';
import { runPreflight, type PreflightResult } from './preflight.ts';
import type { Http } from './publish.ts';
import { gateProblems } from './records.ts';
import { readPackageVersion } from './version.ts';

const VERSION = readPackageVersion(readFileSync(join(REPO_ROOT, VERSION_FILE), 'utf8'));
const HEAD = 'd'.repeat(40);
const SDK_HASH = 'c'.repeat(64);
const SDK_COMMIT = 'e'.repeat(40);
const HOTKEYS = 'f'.repeat(64);
const target = releaseTarget();
const BUILD: ReadonlyArray<readonly [string, string]> = [
  ['manifest.json', JSON.stringify({ manifest_version: 3, version: VERSION })],
  ['background.js', 'console.log(1)'],
];

let root = '';
afterEach(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
});

interface World {
  /** What `git status --porcelain` prints. */
  porcelain: string;
  branch: string;
  originMain: string;
  tagExists: boolean;
  checkExit: number;
  /** What the rebuild from the sources archive produces. */
  rebuilt: ReadonlyArray<readonly [string, string]>;
  hubCompare: string | null;
  /** GitHub's check runs of HEAD (`commits/<sha>/check-runs`); null — the request fails. */
  mainCi: string | null;
  /** The last commit of main that changed more than documents, and its check runs. */
  code: { commit: string; checkRuns: string };
  feed: { status: number; body: string };
  health: { status: number; body: string };
  ticked: boolean;
  /** Whether the sources archive carries BUILD.md. */
  buildInstructions: boolean;
}

const checkRuns = (e2e: string | null): string =>
  JSON.stringify({ check_runs: [{ id: 1, name: 'pnpm check', status: 'completed', conclusion: 'success' }, { id: 2, name: 'pnpm e2e', status: e2e === null ? 'in_progress' : 'completed', conclusion: e2e }] });

const good = (): World => ({
  porcelain: '',
  branch: 'main',
  originMain: HEAD,
  tagExists: false,
  checkExit: 0,
  rebuilt: BUILD,
  hubCompare: 'ahead',
  mainCi: checkRuns('success'),
  code: { commit: HEAD, checkRuns: checkRuns('success') },
  feed: { status: 404, body: '' },
  health: { status: 200, body: JSON.stringify({ status: 'ok', contractHash: SDK_HASH, compatibleClientSdks: [SDK_HASH] }) },
  ticked: true,
  buildInstructions: true,
});

function checkoutFor(world: World): { checkout: Checkout; commands: string[]; requests: string[]; http: Http } {
  root = mkdtempSync(join(tmpdir(), 'cg-release-preflight-'));
  const put = (relative: string, text: string | Buffer): void => {
    mkdirSync(join(root, relative, '..'), { recursive: true });
    writeFileSync(join(root, relative), text);
  };
  for (const file of [VERSION_FILE, CHANGELOG_FILE]) put(file, readFileSync(join(REPO_ROOT, file)));
  cpSync(join(REPO_ROOT, SITE_DIR), join(root, SITE_DIR), { recursive: true });
  const note = renderNote(VERSION);
  put(noteFile(VERSION), world.ticked ? BEFORE_SIGNING.reduce((text, item) => text.replace(`- [ ] \`${item.id}\``, `- [x] \`${item.id}\``), note) : note);
  put('vendor/kernel-sdk/kernel-sdk.vendor.json', JSON.stringify({ contractHash: SDK_HASH, sourceCommit: SDK_COMMIT }));
  put('vendor/chatgoose-hotkeys/chatgoose-hotkeys.vendor.json', JSON.stringify({ sha256: HOTKEYS }));
  put('tests/vendor-pins.json', JSON.stringify({ kernelSdk: { contractHash: SDK_HASH, sourceCommit: SDK_COMMIT }, chatgooseHotkeys: { sha256: HOTKEYS } }));
  for (const [name, text] of BUILD) put(`apps/extension/.output/firefox-mv3/${name}`, text);
  put(`apps/extension/.output/chatgoose-chatspace-${VERSION}-firefox.zip`, writeZip(BUILD.map(([name, text]) => ({ name, data: Buffer.from(text) }))));
  put(
    `apps/extension/.output/chatgoose-chatspace-${VERSION}-sources.zip`,
    writeZip([{ name: 'package.json', data: Buffer.from('{}') }, ...(world.buildInstructions ? [{ name: 'BUILD.md', data: Buffer.from('how to build') }] : [])]),
  );

  const commands: string[] = [];
  const answer = (stdout = '', code = 0, stderr = ''): Promise<{ code: number; stdout: string; stderr: string }> => Promise.resolve({ code, stdout, stderr });
  const exec: Exec = (spec: CommandSpec) => {
    const line = [spec.program, ...spec.args].join(' ');
    commands.push(line);
    if (line === 'git rev-parse HEAD') return answer(`${HEAD}\n`);
    if (line === 'git rev-parse --abbrev-ref HEAD') return answer(`${world.branch}\n`);
    if (line === 'git status --porcelain') return answer(world.porcelain);
    if (line === 'git fetch origin main --tags --quiet') return answer();
    if (line === 'git rev-parse origin/main') return answer(`${world.originMain}\n`);
    if (line === `git rev-parse -q --verify refs/tags/v${VERSION}`) return answer('', world.tagExists ? 0 : 1);
    if (line === `git ls-remote --tags origin refs/tags/v${VERSION}`) return answer('');
    if (line === 'git log -1 --first-parent --format=%H HEAD -- . :(exclude)docs :(exclude)site :(exclude,glob)*.md') return answer(`${world.code.commit}\n`);
    if (line === `gh api repos/goslingmanagment/chat-extension/commits/${HEAD}/check-runs?per_page=100`) return world.mainCi === null ? answer('', 1, 'gh: Bad credentials (HTTP 401)') : answer(world.mainCi);
    if (line === `gh api repos/goslingmanagment/chat-extension/commits/${world.code.commit}/check-runs?per_page=100`) return answer(world.code.checkRuns);
    if (line.startsWith('gh api repos/goslingmanagment/hub/')) return world.hubCompare === null ? answer('', 1, 'gh: Not Found (HTTP 404)') : answer(`${world.hubCompare}\n`);
    if (line === 'pnpm check') return answer('', world.checkExit);
    if (line === 'pnpm install --frozen-lockfile --offline') return answer();
    if (line === 'pnpm build') {
      // The rebuild in the unpacked sources archive.
      for (const [name, text] of world.rebuilt) {
        mkdirSync(join(spec.cwd ?? '', 'apps/extension/.output/firefox-mv3'), { recursive: true });
        writeFileSync(join(spec.cwd ?? '', 'apps/extension/.output/firefox-mv3', name), text);
      }
      return answer();
    }
    throw new Error(`unexpected command: ${line}`);
  };
  const requests: string[] = [];
  const http: Http = (url) => {
    requests.push(url);
    const reply = url === target.feedUrl ? world.feed : world.health;
    return Promise.resolve({ status: reply.status, body: Buffer.from(reply.body) });
  };
  return { checkout: new Checkout(root, exec, target), commands, requests, http };
}

async function preflight(world: World, online: boolean): Promise<PreflightResult & { commands: string[]; requests: string[]; lines: string[] }> {
  const { checkout, commands, requests, http } = checkoutFor(world);
  const lines: string[] = [];
  const result = await runPreflight(checkout, { online, http, print: (line) => lines.push(line), now: () => new Date('2026-10-05T11:00:00.000Z'), env: {} });
  return { ...result, commands, requests, lines };
}

describe('pnpm release preflight', () => {
  it('[UP-003] offline it is a rehearsal: every local check, no network request, and a gate record that does not allow signing', async () => {
    const result = await preflight(good(), false);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual(['pushed', 'main-ci', 'hub-commit', 'feed', 'hub-compat']);
    expect(result.gate?.checks.map((check) => check.id)).toEqual(['version', 'branch', 'clean-tree', 'tag-free', 'changelog', 'site', 'note', 'vendor', 'check', 'versions', 'reproducible']);
    expect(result.requests).toEqual([]);
    expect(result.commands.filter((line) => /fetch|ls-remote|^gh /.test(line))).toEqual([]);
    expect(result.gate).toMatchObject({ version: VERSION, commit: HEAD, online: false, vendor: { sdkContractHash: SDK_HASH, sdkSourceCommit: SDK_COMMIT, hotkeysSha256: HOTKEYS } });
    const context = { version: VERSION, commit: HEAD, now: Date.parse('2026-10-05T11:05:00.000Z'), xpiSha256: result.gate?.build.xpi.sha256 ?? '', sourcesSha256: result.gate?.build.sources.sha256 ?? '' };
    expect(gateProblems(result.gate ?? ({} as never), context)).toEqual(['the gate ran without the network checks — run `pnpm release preflight --online`']);
  });

  it('[UP-003] [UP-004] online it is the gate: origin, the CI of main, the tag on origin, the hub commit, the feed and the hub — read-only, and the record allows signing', async () => {
    const result = await preflight(good(), true);
    expect(result.failed).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.gate?.checks.map((check) => check.id)).toEqual(['version', 'branch', 'clean-tree', 'pushed', 'main-ci', 'tag-free', 'changelog', 'site', 'note', 'vendor', 'hub-commit', 'check', 'versions', 'reproducible', 'feed', 'hub-compat']);
    expect(result.requests).toEqual([target.feedUrl, `${target.hubOrigin}/api/v1/health`]);
    expect(result.commands).toContain(`gh api repos/goslingmanagment/hub/compare/${SDK_COMMIT}...main --jq .status`);
    expect(result.commands).toContain(`gh api repos/goslingmanagment/chat-extension/commits/${HEAD}/check-runs?per_page=100`);
    // Nothing that writes anywhere: no push, no tag, no ssh, no web-ext.
    expect(result.commands.filter((line) => /push|git tag|ssh|scp|web-ext/.test(line))).toEqual([]);
    const context = { version: VERSION, commit: HEAD, now: Date.parse('2026-10-05T11:05:00.000Z'), xpiSha256: result.gate?.build.xpi.sha256 ?? '', sourcesSha256: result.gate?.build.sources.sha256 ?? '' };
    expect(gateProblems(result.gate ?? ({} as never), context)).toEqual([]);
  });

  it('a red cheap check stops before the slow ones: nothing is built on a tree that cannot be released', async () => {
    const result = await preflight({ ...good(), porcelain: ' M site/index.html\n', branch: 'r19-release', ticked: false }, true);
    expect(result.failed).toEqual(['branch', 'clean-tree', 'note']);
    expect(result.skipped).toEqual(['check', 'versions', 'reproducible']);
    expect(result.commands).not.toContain('pnpm check');
    expect(result.gate).toBeNull();
    expect(result.lines.join('\n')).toContain(`docs/releases/${VERSION}.md`);
  });

  it('[UP-003] an unpushed commit, a used tag and a feed that is not behind each fail by name', async () => {
    const feed = { status: 200, body: renderFeed(target.geckoId, feedEntryFor(target, VERSION, 'a'.repeat(64))) };
    const result = await preflight({ ...good(), originMain: 'a'.repeat(40), tagExists: true, feed }, true);
    expect(result.failed).toEqual(['pushed', 'tag-free', 'feed']);
  });

  it('[UP-004] a hub that does not list the SDK, or an SDK from a commit that is not on the hub’s main, fails the gate', async () => {
    const health = { status: 200, body: JSON.stringify({ status: 'ok', contractHash: SDK_HASH }) };
    expect((await preflight({ ...good(), health }, true)).failed).toEqual(['hub-compat']);
    rmSync(root, { recursive: true, force: true });
    const branchHead = await preflight({ ...good(), hubCompare: 'diverged' }, true);
    expect(branchHead.failed).toEqual(['hub-commit']);
    // The cheap checks include it: a release from an unmerged hub commit does not even get built.
    expect(branchHead.commands).not.toContain('pnpm check');
    rmSync(root, { recursive: true, force: true });
    expect((await preflight({ ...good(), hubCompare: null }, true)).failed).toEqual(['hub-commit']);
  });

  it('a release commit whose CI on main is red, still running or unknown — or after documents alone, the last code commit’s — fails the gate before anything is built', async () => {
    for (const mainCi of [checkRuns('failure'), checkRuns(null), null]) {
      const result = await preflight({ ...good(), mainCi }, true);
      expect(result.failed, String(mainCi)).toEqual(['main-ci']);
      expect(result.commands).not.toContain('pnpm check');
      expect(result.gate).toBeNull();
      rmSync(root, { recursive: true, force: true });
    }
    // HEAD changed documents alone, so its e2e parts did not run: the last commit that changed code must be green too.
    const CODE = 'a'.repeat(40);
    const red = await preflight({ ...good(), code: { commit: CODE, checkRuns: checkRuns('failure') } }, true);
    expect(red.failed).toEqual(['main-ci']);
    expect(red.gate).toBeNull();
    expect(red.lines.join('\n')).toContain(`the CI of ${CODE.slice(0, 12)} on main is not green: «pnpm e2e» ended failure`);
    rmSync(root, { recursive: true, force: true });
    const green = await preflight({ ...good(), code: { commit: CODE, checkRuns: checkRuns('success') } }, true);
    expect(green.failed).toEqual([]);
    expect(green.commands).toContain(`gh api repos/goslingmanagment/chat-extension/commits/${CODE}/check-runs?per_page=100`);
  });

  it('a red pnpm check, or a sources archive that does not rebuild the same extension, fails the gate', async () => {
    const red = await preflight({ ...good(), checkExit: 1 }, false);
    expect(red.failed).toEqual(['check']);
    expect(red.skipped).toEqual(['pushed', 'main-ci', 'hub-commit', 'versions', 'reproducible', 'feed', 'hub-compat']);
    rmSync(root, { recursive: true, force: true });
    const drift = await preflight({ ...good(), rebuilt: [BUILD[0] ?? ['', ''], ['background.js', 'console.log(2)'], ['extra.js', '1']] }, false);
    expect(drift.failed).toEqual(['reproducible']);
    expect(drift.gate?.checks.find((check) => check.id === 'reproducible')?.detail).toBe('the rebuild from the sources archive differs: background.js: differs; extra.js: only in the rebuild');
    rmSync(root, { recursive: true, force: true });
    const silent = await preflight({ ...good(), buildInstructions: false }, false);
    expect(silent.failed).toEqual(['reproducible']);
    expect(silent.gate?.checks.find((check) => check.id === 'reproducible')?.detail).toMatch(/no BUILD\.md/);
  });
});

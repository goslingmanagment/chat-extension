// `pnpm release` — a release of the extension in one command (docs/release.md).
//
//   pnpm release [patch|minor|major|X.Y.Z] [--dry-run]
//
// Run in a clean checkout of main after the work is merged and main's CI is
// green on that commit. The version is the last tag `vX.Y.Z` raised (patch by
// default); git's package.json is not raised — the release writes the version,
// CHANGELOG.md and the site into the tree only for its build and puts them
// back. In order: the lock on origin (one release at a time), the checks
// (main's CI, the tag, the vendored SDK, the hub, the feed), the build, AMO,
// the server (XPI, feed, pages), the tag, the GitHub release with notes from
// the commits since the previous tag. A run that stopped is run again: what is
// signed is not signed twice, what is published is not published twice.
// `--dry-run` makes the read-only checks and prints the notes and the plan.
//
// Other commands:
//   status                         what this checkout holds: tags, build, records
//   rollback --to <version>        the server: the feed back at an earlier version
//                                  (plan only without --confirm <version>)
//   announce [--check|--again]     Telegram: the version's notes to the chatters' channel — the
//                                  owner's call only (plan only without --confirm <version>)
//   unlock                         remove the release lock a dead run left on origin
//   sign --import <file.xpi>       a signed XPI AMO gave late, downloaded by hand; then run the
//                                  release of that version again
//   test-builds, sign --test-builds   the P3b test builds (docs/project-unite/spike.md)
//
// Secrets come from the environment (index.ts loads the owner's env files);
// nothing of them is written to a file, an argument or the output.
//
// Everything the commands touch outside the checkout comes in as `CliDeps`, so
// the whole tool runs in tests against a throwaway checkout with a scripted
// world (cli-world.ts); index.ts hands it the real one.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';

import { writeZip } from '../lib/zip-write.ts';
import { readZip } from '../lib/zip.ts';
import { AnnounceError, composePost, sendPost, type FetchLike } from './announce.ts';
import { parseChangelog, sectionOf } from './changelog.ts';
import { BEYOND_DOCUMENTS, CHANGELOG_FILE, DEFAULT_HUB_REPO, ENV, EXTENSION_REPO, HUB_HEALTH_PATH, MAIN_CI_JOBS, OPTIONAL_SITE_API, OPTIONAL_SITE_ORIGINS, signedXpiName, SITE_DIR, VERSION_FILE, type ReleaseTarget } from './config.ts';
import { mustRun, renderCommand, runSteps, type Exec, type Print, type Step } from './exec.ts';
import { evaluateFeedAhead, evaluateHubAncestry, evaluateHubCompatibility, evaluateMainCi, evaluateTagFree, evaluateVendor, evaluateVersions, type Verdict } from './gate.ts';
import { Checkout } from './local.ts';
import { acquireLock, describeHolder, lockHolder, releaseLock } from './lock.ts';
import { githubNotes } from './notes.ts';
import { publishSteps, rollbackSteps, servedFeed, type Http, type ServerDeps } from './publish.ts';
import { importProblems, type ArtifactRef, type GateCheck, type GateRecord, type ReleaseRecord, type VendorRef } from './records.ts';
import { checkRemoteDir, checkSiteFolder, sshTransport } from './remote.ts';
import { amoMetadata, importSigned, releaseRecord, reviewerNotes, signBuild, signCommand } from './sign.ts';
import { renderSite, siteProblems, SITE_FILES } from './site.ts';
import {
  deriveTestBuild,
  differencesBeyondManifest,
  setSigningProblems,
  signedTestXpiName,
  TEST_BUILD_ENV,
  TEST_BUILD_ROLES,
  TEST_BUILDS_GECKO_ID,
  testBuildIdentityProblems,
  testBuildNotes,
  testBuildVersions,
  testXpiName,
  type TestBuild,
  type TestBuildSet,
} from './test-builds.ts';
import { bumpVersion, compareVersions, isVersion, setPackageVersion, type BumpKind } from './version.ts';
import { sha256Hex } from './xpi.ts';

const USAGE = `pnpm release [patch|minor|major|X.Y.Z] [--dry-run]   the whole release, in one go

          status · unlock · rollback --to <version> · announce [--check|--again]
          rollback and announce print their plan and stop without --confirm <version>
          sign --import <file.xpi> takes a signed XPI downloaded by hand (no network)
          test-builds · sign --test-builds   the P3b test builds

The runbook: docs/release.md`;

const BUMPS: readonly string[] = ['patch', 'minor', 'major'];

export interface CliDeps {
  /** The checkout the commands work in. */
  readonly root: string;
  /** Other programs: git, pnpm, gh, web-ext, ssh, scp. */
  readonly exec: Exec;
  /** GET of a public address: the feed, the hub's health, what was just published. */
  readonly http: Http;
  /** The request to Telegram. */
  readonly fetchImpl: FetchLike;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly print: Print;
  readonly printError: Print;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  /** Unique per run: the suffix of temporary uploads. */
  readonly nonce: () => string;
  /** Who runs the release, for the lock: user@host. */
  readonly who: string;
  /** Tests only: another site and hub than the build's own. */
  readonly target?: ReleaseTarget;
}

class Refusal extends Error {}

function refuse(text: string): never {
  throw new Refusal(text);
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Runs one command; resolves with the exit code: 0, 2 — refused (nothing was done), 1 — failed. */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const { print } = deps;
  let parsed;
  try {
    parsed = parseArgs({
      args: argv[0] === '--' ? argv.slice(1) : argv,
      allowPositionals: true,
      options: {
        'dry-run': { type: 'boolean', default: false },
        confirm: { type: 'string' },
        check: { type: 'boolean', default: false },
        to: { type: 'string' },
        import: { type: 'string' },
        silent: { type: 'boolean', default: false },
        again: { type: 'boolean', default: false },
        'test-builds': { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    deps.printError(`release: ${message(error)}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = parsed;
  const [command = '', ...extra] = positionals;

  const checkout = new Checkout(deps.root, deps.exec, deps.target);
  const dryRun = values['dry-run'];

  /**
   * true — the outward command only shows its plan: `--dry-run`, no `--confirm`,
   * or a `--confirm` that names another version. Then nothing leaves the
   * machine at all.
   */
  const planOnly = (version: string): boolean => dryRun || values.confirm !== version;

  /** Prints the plan of an outward command; runs it only with `--confirm <version>`. */
  async function outward(what: string, version: string, steps: readonly Step[]): Promise<void> {
    if (!planOnly(version)) {
      await runSteps(steps, { dryRun: false, print });
      return;
    }
    await runSteps(steps, { dryRun: true, print });
    if (dryRun) {
      print(`dry run: nothing was run. ${what} needs --confirm ${version}`);
      return;
    }
    refuse(
      values.confirm === undefined
        ? `not run: ${what} leaves this machine. The plan is above; to run it, repeat the command with --confirm ${version}`
        : `not run: --confirm ${values.confirm} does not name the version this is about (${version}).`,
    );
  }

  function requireEnv(name: string): string {
    const value = deps.env[name];
    if (value === undefined || value === '') refuse(`${name} is not set: put it into ~/.config/agency/secrets.env (docs/release.md, «Ключи»).`);
    return value;
  }

  /** The server as the environment names it; in a plan a missing variable is shown by its name. */
  function serverDeps(plan: boolean): ServerDeps {
    const placeholder = (name: string): string => {
      print(`note: ${name} is not set — the plan shows its name instead of the value.`);
      return name;
    };
    const ssh = deps.env[ENV.ssh] ?? (plan ? placeholder(ENV.ssh) : requireEnv(ENV.ssh));
    const named = deps.env[ENV.remoteDir];
    const remoteDir = named === undefined || named === '' ? (plan ? `/${placeholder(ENV.remoteDir)}` : requireEnv(ENV.remoteDir)) : checkSiteFolder(named, checkout.target.siteBase);
    return {
      exec: deps.exec,
      http: deps.http,
      transport: sshTransport(ssh),
      remoteDir: checkRemoteDir(remoteDir),
      target: checkout.target,
      nonce: deps.nonce(),
      sleep: deps.sleep,
      env: deps.env,
      say: print,
    };
  }

  /** The latest released version (the highest tag here; `ship` fetches origin's first). */
  async function latestTag(): Promise<string | null> {
    return (await checkout.versionTags()).at(-1) ?? null;
  }

  // ── the release ────────────────────────────────────────────────────────────

  async function ship(asked: string): Promise<void> {
    if (!BUMPS.includes(asked) && !isVersion(asked)) refuse(`«${asked}» is no release: patch, minor, major or X.Y.Z.`);
    if ((await checkout.git('status', '--porcelain', '--untracked-files=no')) !== '') refuse('the working tree has uncommitted changes: release from a clean checkout of main.');
    const head = await checkout.git('rev-parse', 'HEAD');
    const short = head.slice(0, 12);
    await checkout.git('fetch', '--quiet', '--force', 'origin', 'main', '--tags');
    if (!(await checkout.isAncestor(head, 'origin/main'))) refuse(`HEAD ${short} is not on origin/main: only merged work is released (git switch main && git pull).`);

    const latest = await latestTag();
    const floor = latest === null || compareVersions(checkout.version(), latest) > 0 ? checkout.version() : latest;
    const version = isVersion(asked) ? asked : bumpVersion(floor, asked as BumpKind);
    if (latest !== null && compareVersions(version, latest) <= 0) refuse(`${version} is not above the last release v${latest}.`);
    if (latest !== null && !(await checkout.isAncestor(`v${latest}`, head))) refuse(`HEAD ${short} does not hold the last release v${latest}: git pull.`);
    const unfinished = checkout.unfinished(latest).filter((other) => other !== version);
    if (unfinished.length > 0) refuse(`${unfinished.join(', ')} was signed or sent to AMO from this checkout and never tagged: finish it first — pnpm release ${unfinished[0] ?? ''}`);
    const subjects = await checkout.subjects(latest === null ? null : `v${latest}`, head);
    if (subjects.length === 0) refuse(`nothing to release: no commit since v${latest ?? '?'}.`);
    const paths = checkout.paths(version);
    const signed = checkout.record(version);
    print(`release ${version} from ${short}${latest === null ? '' : `, ${subjects.length} commit(s) since v${latest}`}${signed === null ? '' : ` — signed earlier (${signed.signedAt}), going on from there`}`);

    if (dryRun) {
      const holder = await lockHolder(checkout);
      print(holder === null ? 'lock: free' : `lock: TAKEN — ${describeHolder(holder)}`);
    } else {
      const lock = await acquireLock(checkout, { version, by: deps.who, at: deps.now().toISOString() });
      if (!lock.ok) refuse(lock.reason);
      print(`lock: taken (${deps.who})`);
    }

    let restore: (() => void) | null = null;
    try {
      // ── the checks: read-only, quick ──
      const checks: GateCheck[] = [];
      const check = async (id: string, observe: () => Promise<Verdict> | Verdict): Promise<void> => {
        let verdict: Verdict;
        try {
          verdict = await observe();
        } catch (error) {
          verdict = { ok: false, detail: message(error) };
        }
        checks.push({ id, ok: verdict.ok, detail: verdict.detail });
        print(`${verdict.ok ? 'ok  ' : 'FAIL'}  ${id.padEnd(11)} ${verdict.detail}`);
      };
      // main's CI on this commit — and on the last commit that changed more than documents: a push of documents alone runs no e2e.
      await check('main-ci', async () => {
        const code = await checkout.git('log', '-1', '--first-parent', '--format=%H', 'HEAD', '--', ...BEYOND_DOCUMENTS);
        const verdicts: Verdict[] = [];
        for (const commit of code === '' || code === head ? [head] : [head, code]) {
          const result = await checkout.exec({ program: 'gh', args: ['api', `repos/${EXTENSION_REPO}/commits/${commit}/check-runs?per_page=100`] });
          verdicts.push(evaluateMainCi(result.code === 0 ? result.stdout : null, commit, MAIN_CI_JOBS, result.stderr.trim().split('\n').at(-1) ?? ''));
        }
        return verdicts.find((verdict) => !verdict.ok) ?? { ok: true, detail: verdicts.map((verdict) => verdict.detail).join('; ') };
      });
      await check('tag-free', async () => evaluateTagFree(version, false, (await checkout.git('ls-remote', '--tags', 'origin', `refs/tags/v${version}`)) !== ''));
      let vendor: VendorRef | null = null;
      await check('vendor', () => {
        const verdict = evaluateVendor(checkout.vendor());
        vendor = verdict.vendor;
        return verdict;
      });
      const vendored = vendor as VendorRef | null;
      if (vendored !== null) {
        const hubRepo = deps.env[ENV.hubRepo] ?? DEFAULT_HUB_REPO;
        await check('hub-commit', async () => {
          const result = await checkout.exec({ program: 'gh', args: ['api', `repos/${hubRepo}/compare/${vendored.sdkSourceCommit}...main`, '--jq', '.status'] });
          return evaluateHubAncestry(result.code === 0 ? result.stdout.trim() : null, vendored.sdkSourceCommit, hubRepo, result.stderr.trim().split('\n').at(-1) ?? '');
        });
        await check('hub-compat', async () => {
          const answer = await deps.http(`${checkout.target.hubOrigin}${HUB_HEALTH_PATH}`);
          return evaluateHubCompatibility({ status: answer.status, body: answer.body.toString('utf8') }, vendored.sdkContractHash);
        });
      }
      await check('feed', async () => {
        const answer = await deps.http(checkout.target.feedUrl);
        const verdict = evaluateFeedAhead(version, { status: answer.status, body: answer.body.toString('utf8') }, checkout.target.geckoId);
        // A run that stopped after the feed moved: the feed serves exactly this version, from the signed file.
        if (!verdict.ok && signed !== null && (await servedFeed({ http: deps.http, target: checkout.target }).catch(() => null))?.sha256 === signed.xpi.sha256) {
          return { ok: true, detail: `the feed already serves ${version} from the signed file: an earlier run published it` };
        }
        return verdict;
      });
      const failed = checks.filter((item) => !item.ok).map((item) => item.id);
      const stop = `not released: ${failed.join(', ')} failed.`;
      // A dry run shows the rest all the same; a real run stops here.
      if ((failed.length > 0 && !dryRun) || vendored === null) refuse(stop);

      // ── what is new: CHANGELOG.md, the site, the GitHub release ──
      const changelog = await checkout.changelogText({ version, head });
      const section = sectionOf(parseChangelog(changelog), version);
      const notes = githubNotes({ version, previous: latest, subjects, repo: EXTENSION_REPO });
      print(`notes of ${version} (CHANGELOG.md, the site, the announcement):`);
      for (const block of section.blocks) if (block.kind === 'list') for (const item of block.items) print(`  - ${item.map((part) => part.text).join('')}`);

      if (dryRun) {
        const record = { ...recordFor(version, true).record, vendor: vendored };
        print(`plan: write ${version} into ${VERSION_FILE}, its notes into ${CHANGELOG_FILE} and the site, only for the build (put back after); pnpm build`);
        if (signed === null) print(`plan: sign ${version} at addons.mozilla.org (unlisted, web-ext sign with ${ENV.amoKey}/${ENV.amoSecret} ${deps.env[ENV.amoKey] === undefined || deps.env[ENV.amoSecret] === undefined ? 'NOT SET' : 'set'})`);
        await runSteps(publishSteps(serverDeps(true), { record, signedXpiPath: paths.signedXpi, recordPath: paths.record, recordSha256: '0'.repeat(64), localFeedPath: join(paths.dir, 'updates.json'), pages: checkout.publishablePages() }), { dryRun: true, print });
        await runSteps(tagSteps(version, record, true), { dryRun: true, print });
        print(`plan: gh release create v${version} (notes: ${subjects.length} commit(s) since ${latest === null ? 'the start' : `v${latest}`})`);
        print('dry run: nothing was written, built, signed or published; the lock was not taken.');
        if (failed.length > 0) refuse(stop);
        return;
      }

      // ── the tree of the build: the version, the notes, the site — put back at the end ──
      restore = checkout.snapshot([VERSION_FILE, CHANGELOG_FILE, ...SITE_FILES.map((name) => join(SITE_DIR, name))]);
      if (checkout.version() !== version) checkout.write(VERSION_FILE, setPackageVersion(checkout.read(VERSION_FILE), version));
      checkout.write(CHANGELOG_FILE, changelog);
      const site = checkout.siteFiles();
      for (const [name, text] of renderSite(site, checkout.siteContext(version))) if (text !== site.get(name)) checkout.write(join(SITE_DIR, name), text);
      const problems = siteProblems(checkout.siteFiles(), checkout.siteContext(version), checkout.linkedPages());
      if (problems.length > 0) refuse(`the site is not ready:\n  ${problems.join('\n  ')}`);

      // ── build and sign, unless an earlier run did ──
      let record = signed;
      if (record === null) {
        const build = await deps.exec({ program: 'pnpm', args: ['build'], cwd: checkout.root, inherit: true });
        if (build.code !== 0) refuse('pnpm build failed.');
        const built = checkout.build();
        const versions = evaluateVersions(version, built.version);
        if (!versions.ok) refuse(versions.detail);
        const pick = ({ file, sha256, bytes }: ArtifactRef): ArtifactRef => ({ file, sha256, bytes });
        const gate: GateRecord = { schema: 1, version, commit: head, createdAt: deps.now().toISOString(), online: true, checks, build: { xpi: pick(built.xpi), sources: pick(built.sources) }, vendor: vendored };
        checkout.saveGate(version, gate);
        const before = checkout.submitted(version);
        if (before !== null) print(`note: ${version} was sent to AMO once already (from ${before.commit.slice(0, 12)}). If AMO took it, it refuses it now: download the signed file from the developer hub — pnpm release sign --import <file.xpi> — or release a higher version.`);
        await runSteps(signSteps(version, built, gate), { dryRun: false, print });
        record = checkout.record(version);
        if (record === null) throw new Error(`${version} was signed, and its record is missing.`);
      }

      // ── the server, the tag, the GitHub release ──
      if (!(await checkout.isAncestor(record.commit, 'origin/main'))) refuse(`${version} was signed from ${record.commit.slice(0, 12)}, which is not on origin/main.`);
      const recordSha256 = sha256Hex(readFileSync(paths.record));
      await runSteps(publishSteps(serverDeps(false), { record, signedXpiPath: paths.signedXpi, recordPath: paths.record, recordSha256, localFeedPath: join(paths.dir, 'updates.json'), pages: checkout.publishablePages() }), { dryRun: false, print });
      await runSteps(tagSteps(version, record, false), { dryRun: false, print });
      const url = await githubRelease(version, join(paths.dir, 'github-notes.md'), notes);
      print(`released ${version}: ${checkout.target.feedUrl} serves it, tag v${version}, ${url}`);
      print(`announcing it to the chatters is the owner's call: pnpm release announce --confirm ${version}`);
    } finally {
      restore?.();
      if (!dryRun) {
        try {
          await releaseLock(checkout);
          print('lock: released');
        } catch (error) {
          deps.printError(`release: ${message(error)}`);
        }
      }
    }
  }

  function signSteps(version: string, built: ReturnType<Checkout['build']>, gate: GateRecord): Step[] {
    const paths = checkout.paths(version);
    const artifactsDir = join(paths.dir, 'web-ext-artifacts');
    const input = { repoRoot: checkout.root, buildDir: built.dir, sourcesZip: built.sources.path, artifactsDir, metadataPath: paths.amoMetadata };
    const spec = signCommand(input);
    return [
      {
        title: `Sign ${version} at addons.mozilla.org (unlisted) with the sources archive, check the signed XPI against the build, store it with the record`,
        show: [...renderCommand(spec), `store ${paths.signedXpi}`, `write ${paths.record}`],
        run: async () => {
          requireEnv(ENV.amoKey);
          requireEnv(ENV.amoSecret);
          const pnpmVersion = (await mustRun(deps.exec, { program: 'pnpm', args: ['--version'], cwd: checkout.root })).stdout.trim();
          mkdirSync(paths.dir, { recursive: true });
          writeFileSync(paths.amoMetadata, amoMetadata(reviewerNotes({ version, commit: gate.commit, nodeVersion: process.versions.node.split('.')[0] ?? process.versions.node, pnpmVersion })));
          checkout.saveSubmitted(gate);
          store(version, gate, await signBuild(deps.exec, input, { version, geckoId: checkout.target.geckoId }, () => checkout.buildFiles(built.dir), spec));
          rmSync(artifactsDir, { recursive: true, force: true });
        },
      },
    ];
  }

  /** The signed XPI and the record of the release, stored once. */
  function store(version: string, gate: GateRecord, data: Buffer): void {
    const paths = checkout.paths(version);
    const xpi: ArtifactRef = { file: signedXpiName(version), sha256: sha256Hex(data), bytes: data.length };
    const record: ReleaseRecord = releaseRecord({ target: checkout.target, gate, signedXpi: xpi, signedAt: deps.now().toISOString() });
    mkdirSync(paths.dir, { recursive: true });
    writeFileSync(paths.signedXpi, data);
    writeFileSync(paths.record, `${JSON.stringify(record, null, 2)}\n`);
    print(`    signed: ${xpi.file}, ${xpi.bytes} B, sha256 ${xpi.sha256}, built from ${gate.commit.slice(0, 12)}`);
  }

  /** The annotated tag on the signed commit, pushed; a tag an earlier run made and could not push is pushed as it is. */
  function tagSteps(version: string, record: ReleaseRecord, plan: boolean): Step[] {
    const name = `v${version}`;
    const text = `ChatGoose ${version} — signed and served from ${checkout.target.feedBase} (xpi sha256:${record.xpi.sha256}; SDK contract ${record.vendor.sdkContractHash}); built from ${record.commit} with the version ${version}`;
    return [
      {
        title: `Tag ${record.commit.slice(0, 12)} as ${name} and push it`,
        show: [`$ git tag -a ${name} -m '…' ${record.commit}`, `$ git push origin ${name}`],
        run: async () => {
          if (plan) return;
          const existing = await checkout.tag(name);
          if (existing !== null && (existing.commit !== record.commit || !existing.annotated)) {
            refuse(`the tag ${name} already exists here and is not the tag of this release (${existing.commit.slice(0, 12)}): look at it (git show ${name}), remove it (git tag -d ${name}) and run again.`);
          }
          if (existing === null) await mustRun(deps.exec, { program: 'git', args: ['tag', '-a', name, '-m', text, record.commit], cwd: checkout.root });
          const push = await deps.exec({ program: 'git', args: ['push', 'origin', name], cwd: checkout.root });
          if (push.code !== 0) {
            // A tag only here would make the next run take this version for released: it goes until it is on origin.
            await checkout.gitCode('tag', '-d', name);
            throw new Error(`git push origin ${name} failed (${push.stderr.trim().split('\n').at(-1) ?? `exit ${push.code}`}): run the release again — it goes on from here.`);
          }
        },
      },
    ];
  }

  /** The GitHub release of the tag, with the notes; one that is there already is left alone. Resolves with its address. */
  async function githubRelease(version: string, notesPath: string, notes: string): Promise<string> {
    const name = `v${version}`;
    const view = await deps.exec({ program: 'gh', args: ['release', 'view', name, '--repo', EXTENSION_REPO, '--json', 'url', '--jq', '.url'], cwd: checkout.root });
    if (view.code === 0) return view.stdout.trim();
    mkdirSync(dirname(notesPath), { recursive: true });
    writeFileSync(notesPath, notes);
    const created = await mustRun(deps.exec, { program: 'gh', args: ['release', 'create', name, '--repo', EXTENSION_REPO, '--verify-tag', '--title', `ChatGoose ${version}`, '--notes-file', notesPath], cwd: checkout.root });
    return created.stdout.trim().split('\n').at(-1) ?? name;
  }

  // ── local ──────────────────────────────────────────────────────────────────

  async function status(): Promise<void> {
    const tags = await checkout.versionTags();
    const latest = tags.at(-1) ?? null;
    print(`released     ${latest === null ? 'nothing yet' : `v${latest}`} (the local tags; git fetch --tags for origin's)`);
    print(`git          ${await checkout.git('rev-parse', '--abbrev-ref', 'HEAD')} @ ${(await checkout.git('rev-parse', 'HEAD')).slice(0, 12)}${(await checkout.git('status', '--porcelain', '--untracked-files=no')) === '' ? '' : ', not clean'}`);
    try {
      const built = checkout.build();
      print(`build        ${built.version}: ${built.xpi.file} sha256 ${built.xpi.sha256.slice(0, 12)}…`);
    } catch (error) {
      print(`build        none (${message(error)})`);
    }
    for (const version of checkout.unfinished(latest)) {
      const record = checkout.record(version);
      print(`unfinished   ${version}: ${record === null ? 'sent to AMO, no signed file here — pnpm release sign --import <file.xpi>' : `signed ${record.signedAt}`} — pnpm release ${version} finishes it`);
    }
    const tests = checkout.latestTestBuildSet();
    if (tests !== null) {
      const signedRoles = TEST_BUILD_ROLES.filter((role) => existsSync(join(tests.dir, 'signed', signedTestXpiName(role))));
      const from = tests.set.commit === null ? 'outside a git checkout' : `${tests.set.commit.slice(0, 12)}${tests.set.clean ? '' : ' with changes'}`;
      print(`test builds  ${tests.set.set} (P3b) from ${from}, signed: ${signedRoles.length === 0 ? 'none' : signedRoles.join(', ')}`);
    }
    const announced = latest === null ? null : checkout.announced(latest);
    if (announced !== null && latest !== null) print(`announced    ${latest}: ${announced.state === 'posted' ? `posted ${announced.at}` : `${announced.at}, may have reached the channel — look there`}`);
  }

  async function unlock(): Promise<void> {
    const holder = await lockHolder(checkout);
    if (holder === null) {
      print('lock: nobody holds it.');
      return;
    }
    await releaseLock(checkout);
    print(`lock: removed (${describeHolder(holder)}).`);
  }

  /** HEAD and whether the tree is clean; commit null — this is no git checkout (a copy of the tree, as in the e2e image). */
  async function headState(): Promise<{ readonly commit: string | null; readonly clean: boolean }> {
    try {
      const commit = await checkout.git('rev-parse', 'HEAD');
      return { commit, clean: (await checkout.git('status', '--porcelain')) === '' };
    } catch {
      return { commit: null, clean: false };
    }
  }

  /** The harness's lines for a set's XPIs (relative to the checkout), signed or not. */
  function harnessEnv(dir: string, file: (build: TestBuild) => string, set: TestBuildSet): string {
    return set.builds.map((build) => `${TEST_BUILD_ENV[build.role]}=${relative(checkout.root, join(dir, file(build)))}`).join(' ');
  }

  async function testBuilds(): Promise<void> {
    const before = await headState();
    const result = await deps.exec({ program: 'pnpm', args: ['build'], cwd: checkout.root, inherit: true });
    if (result.code !== 0) refuse('pnpm build failed.');
    // The build is of a commit only if nothing moved while it ran: the same HEAD, still no change in the tree.
    const after = await headState();
    const head = { commit: before.commit, clean: before.clean && after.clean && after.commit === before.commit };
    if (before.clean && !head.clean) print(`note: the tree changed while it built (HEAD ${after.commit?.slice(0, 12) ?? '?'}${after.clean ? '' : ', uncommitted changes'}): the set is of no commit.`);
    const built = checkout.build();
    if (built.version !== checkout.version()) refuse(`the release build is of ${built.version}, the tree holds ${checkout.version()}.`);
    const versions = testBuildVersions(built.version, deps.now());
    const dir = checkout.testBuildsDir(versions.n);
    if (existsSync(dir)) refuse(`the set ${versions.n} already exists (${dir}): a set a minute — run the command again in a minute.`);
    const release = checkout.buildFiles(built.dir);
    const builds: TestBuild[] = [];
    for (const role of TEST_BUILD_ROLES) {
      const files = deriveTestBuild(release, role, versions[role], { origins: OPTIONAL_SITE_ORIGINS, api: OPTIONAL_SITE_API });
      const wrong = differencesBeyondManifest(release, files);
      if (wrong.length > 0) throw new Error(`the test build «${role}» is not the release build beyond its manifest:\n  ${wrong.join('\n  ')}`);
      for (const file of files) {
        const path = join(dir, role, file.name);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.data);
      }
      const data = writeZip(files);
      const name = testXpiName(role, versions[role]);
      writeFileSync(join(dir, name), data);
      builds.push({ role, version: versions[role], dir: role, xpi: { file: name, sha256: sha256Hex(data), bytes: data.length } });
    }
    copyFileSync(built.sources.path, join(dir, 'sources.zip'));
    const set: TestBuildSet = {
      schema: 1,
      set: versions.n,
      geckoId: TEST_BUILDS_GECKO_ID,
      commit: head.commit,
      clean: head.clean,
      createdAt: deps.now().toISOString(),
      base: { version: built.version, xpiSha256: built.xpi.sha256, sourcesSha256: built.sources.sha256 },
      builds,
    };
    writeFileSync(join(dir, 'set.json'), `${JSON.stringify(set, null, 2)}\n`);
    print(`test builds ${set.set} of the release build ${built.version} (${built.xpi.sha256.slice(0, 12)}…) in ${relative(checkout.root, dir)}, add-on ${TEST_BUILDS_GECKO_ID}:`);
    for (const build of builds) print(`  ${build.role.padEnd(8)} ${build.version}  ${build.xpi.file}  sha256 ${build.xpi.sha256}`);
    const problems = setSigningProblems(set);
    for (const problem of problems) print(`note: ${problem}.`);
    print(`unsigned, for a stand-in run of the harness (docs/project-unite/spike.md «P3b: как прогнать»): CG_P3B_UNSIGNED=1 ${harnessEnv(dir, (build) => build.xpi.file, set)}`);
    if (problems.length === 0) print(`next: the owner signs — pnpm release sign --test-builds --confirm ${set.set} (docs/release.md «Подписанные тестовые сборки (P3b)»)`);
  }

  // ── outward ────────────────────────────────────────────────────────────────

  async function signTestBuilds(): Promise<void> {
    if (values.import !== undefined) refuse('sign --test-builds takes no --import: a set whose signing failed is made again (pnpm release test-builds), its versions are new.');
    const latest = checkout.latestTestBuildSet();
    if (latest === null) refuse('no set of test builds here — pnpm release test-builds');
    const { dir, set } = latest;
    const plan = planOnly(set.set);
    const signedDir = join(dir, 'signed');
    /** The sources archive is the one the set was made with. */
    const sourcesProblems = (): string[] => {
      const path = join(dir, 'sources.zip');
      return existsSync(path) && sha256Hex(readFileSync(path)) === set.base.sourcesSha256 ? [] : ['sources.zip is not the sources archive set.json describes'];
    };
    /**
     * A build is what set.json says (its XPI's sha256), its folder — what web-ext uploads — holds that XPI's files, and
     * its own manifest names the test add-on at its test version: read before the first request, and again right
     * before its own upload.
     */
    const buildProblems = (build: TestBuild): string[] => {
      const path = join(dir, build.xpi.file);
      if (!existsSync(path) || sha256Hex(readFileSync(path)) !== build.xpi.sha256) return [`${build.xpi.file} is not the file set.json describes`];
      const folder = new Map(checkout.buildFiles(join(dir, build.dir)).map((file) => [file.name, file.data]));
      const packed = readZip(readFileSync(path));
      const out: string[] = [];
      if (packed.length !== folder.size || packed.some((entry) => !(folder.get(entry.name)?.equals(entry.data) ?? false))) out.push(`the folder ${build.dir}/ is not what ${build.xpi.file} holds`);
      let manifest: unknown;
      try {
        manifest = JSON.parse(folder.get('manifest.json')?.toString('utf8') ?? 'null') as unknown;
      } catch {
        manifest = null;
      }
      return [...out, ...testBuildIdentityProblems(manifest, build)];
    };
    const problems = [...setSigningProblems(set), ...sourcesProblems(), ...set.builds.flatMap(buildProblems)];
    if (problems.length > 0 && !plan) refuse(`cannot sign the test builds ${set.set}:\n  ${problems.join('\n  ')}`);
    for (const problem of problems) print(`note: ${problem}`);
    const pending = set.builds.filter((build) => !existsSync(join(signedDir, signedTestXpiName(build.role))));
    const signedEnv = (): string => harnessEnv(signedDir, (build) => signedTestXpiName(build.role), set);
    if (pending.length === 0) {
      print(`the test builds ${set.set} are signed. The harness (docs/project-unite/spike.md «P3b: как прогнать»): ${signedEnv()}`);
      return;
    }
    if (pending.length < set.builds.length) print(`note: already signed: ${set.builds.filter((build) => !pending.includes(build)).map((build) => build.role).join(', ')} — only the rest goes to AMO.`);
    const pnpmVersion = (await mustRun(deps.exec, { program: 'pnpm', args: ['--version'], cwd: checkout.root })).stdout.trim();
    const nodeVersion = process.versions.node.split('.')[0] ?? process.versions.node;
    const steps: Step[] = pending.map((build) => {
      const notes = testBuildNotes({ set, role: build.role, nodeVersion, pnpmVersion });
      const input = {
        repoRoot: checkout.root,
        buildDir: join(dir, build.dir),
        sourcesZip: join(dir, 'sources.zip'),
        artifactsDir: join(dir, `web-ext-artifacts-${build.role}`),
        metadataPath: join(dir, `amo-metadata-${build.role}.json`),
      };
      const spec = signCommand(input);
      const target = join(signedDir, signedTestXpiName(build.role));
      return {
        title: `Sign the test build «${build.role}» ${build.version} at addons.mozilla.org (unlisted, the test add-on ${TEST_BUILDS_GECKO_ID}), check it, store it`,
        show: [
          `write ${input.metadataPath} (approval notes):`,
          ...notes.split('\n').map((line) => `  | ${line}`),
          ...renderCommand(spec),
          `the one .xpi in ${input.artifactsDir} must be signed, be ${TEST_BUILDS_GECKO_ID} ${build.version} and hold the files of ${build.dir}/ unchanged`,
          `store ${target}`,
        ],
        run: async () => {
          // An earlier upload took minutes: what goes now is checked again, as it is now.
          const now = [...sourcesProblems(), ...buildProblems(build)];
          if (now.length > 0) refuse(`the test build «${build.role}» is not what was checked, nothing of it was sent:\n  ${now.join('\n  ')}`);
          requireEnv(ENV.amoKey);
          requireEnv(ENV.amoSecret);
          writeFileSync(input.metadataPath, amoMetadata(notes));
          const data = await signBuild(deps.exec, input, { version: build.version, geckoId: TEST_BUILDS_GECKO_ID }, () => checkout.buildFiles(input.buildDir), spec);
          mkdirSync(signedDir, { recursive: true });
          writeFileSync(target, data);
          rmSync(input.artifactsDir, { recursive: true, force: true });
          print(`    signed: ${build.role} ${build.version}, ${data.length} B, sha256 ${sha256Hex(data)}`);
        },
      };
    });
    await outward(`signing the P3b test builds ${set.set} at AMO`, set.set, steps);
    if (!plan) print(`the test builds ${set.set} are signed. The harness (docs/project-unite/spike.md «P3b: как прогнать»): ${signedEnv()}`);
  }

  async function sign(): Promise<void> {
    if (values['test-builds']) {
      await signTestBuilds();
      return;
    }
    if (values.import === undefined) refuse('signing is part of the release: pnpm release. Here only sign --import <file.xpi> and sign --test-builds.');
    // AMO signed the version and web-ext did not bring the file: it was downloaded from the developer hub by hand.
    const built = checkout.build();
    const version = built.version;
    const paths = checkout.paths(version);
    if (existsSync(paths.signedXpi) || existsSync(paths.record)) refuse(`${version} is already signed (${paths.signedXpi}). Next: pnpm release ${version}`);
    const gate = checkout.submitted(version) ?? checkout.gate(version);
    const problems = gate === null ? ['this checkout never sent it to AMO'] : importProblems(gate, { version, xpiSha256: built.xpi.sha256, sourcesSha256: built.sources.sha256 });
    if (gate === null || problems.length > 0) refuse(`cannot take a signed XPI for ${version}:\n  ${problems.join('\n  ')}`);
    const data = importSigned(values.import, { version, geckoId: checkout.target.geckoId }, checkout.buildFiles(built.dir));
    if (dryRun) {
      print(`dry run: ${values.import} is the build of ${gate.commit.slice(0, 12)}, signed (sha256 ${sha256Hex(data)}). Nothing was stored.`);
      return;
    }
    store(version, gate, data);
    print(`Next: pnpm release ${version}`);
  }

  /** The record of the signed release; in a plan made before signing — a stand-in, said aloud. */
  function recordFor(version: string, plan: boolean): { readonly record: ReleaseRecord; readonly recordSha256: string } {
    const paths = checkout.paths(version);
    const record = checkout.record(version);
    if (record !== null && existsSync(paths.signedXpi)) {
      if (sha256Hex(readFileSync(paths.signedXpi)) !== record.xpi.sha256) refuse(`${paths.signedXpi} is not the file its record describes.`);
      return { record, recordSha256: sha256Hex(readFileSync(paths.record)) };
    }
    if (!plan) refuse(`${version} is not signed yet (no ${paths.signedXpi}) — pnpm release sign`);
    print(`note: ${version} is not signed yet — the plan shows zeros in place of the signed XPI's sha256.`);
    const zeros = '0'.repeat(64);
    return {
      record: {
        schema: 1,
        version,
        geckoId: checkout.target.geckoId,
        strictMinVersion: checkout.target.strictMinVersion,
        commit: '0'.repeat(40),
        signedAt: new Date(0).toISOString(),
        xpi: { file: signedXpiName(version), sha256: zeros, bytes: 1 },
        unsignedXpiSha256: zeros,
        sourcesSha256: zeros,
        vendor: { sdkContractHash: zeros, sdkSourceCommit: '0'.repeat(40), hotkeysSha256: zeros },
      },
      recordSha256: zeros,
    };
  }

  async function announce(): Promise<void> {
    // The version announced is the last one released: the highest tag.
    const version = await latestTag();
    if (version === null) refuse('nothing is released yet: no tag vX.Y.Z here (git fetch --tags).');
    const post = composePost(sectionOf(parseChangelog(await checkout.changelogText()), version));
    if (values.check) {
      print(`announce: the post of ${version} is valid, ${[...post].length} characters.`);
      return;
    }
    const plan = planOnly(version);
    // One post per version: what an earlier run did, or may have done, is remembered here.
    const earlier = checkout.announced(version);
    if (earlier !== null && !values.again) {
      const text =
        earlier.state === 'posted'
          ? `${version} was already announced (${earlier.at}${earlier.messageId === null ? '' : `, message ${earlier.messageId}`})`
          : `an earlier send of the announcement of ${version} (${earlier.at}) may have reached the channel`;
      if (!plan) refuse(`${text}. Look at the channel first; to post it once more all the same: --again`);
      print(`note: ${text} — a real run needs --again.`);
    }
    if (!plan) {
      const served = await servedFeed({ http: deps.http, target: checkout.target });
      if (served?.version !== version) refuse(`the feed serves ${served?.version ?? 'nothing'}, not ${version}: announce what chatters can already get.`);
    }
    await outward('posting to the Telegram channel', version, [
      {
        title: `Post the changelog section of ${version} to the channel ${ENV.telegramChannel}`,
        show: [`POST https://api.telegram.org/bot<${ENV.telegramToken}>/sendRichMessage${values.silent ? ' (without a notification)' : ''}:`, ...post.split('\n').map((line) => `  | ${line}`)],
        run: async () => {
          const telegram = { botToken: requireEnv(ENV.telegramToken), chatId: requireEnv(ENV.telegramChannel) };
          const at = deps.now().toISOString();
          // Written before the request leaves: if this process dies now, the next run knows a send was under way.
          checkout.saveAnnounced(version, { state: 'sending', at, messageId: null });
          let id: number | null;
          try {
            id = await sendPost(telegram, post, { silent: values.silent, fetchImpl: deps.fetchImpl, sleep: deps.sleep });
          } catch (error) {
            // Telegram said no: nothing was posted by this run, and what is known of an earlier one stands.
            // Anything else: it may have been posted.
            const refused = error instanceof AnnounceError && !error.indeterminate;
            const stands = earlier === null ? null : { state: earlier.state, at: earlier.at, messageId: earlier.messageId };
            checkout.saveAnnounced(version, refused ? stands : { state: 'indeterminate', at, messageId: null });
            throw error;
          }
          checkout.saveAnnounced(version, { state: 'posted', at, messageId: id });
          print(`    posted${id === null ? '' : ` (message ${id})`}`);
        },
      },
    ]);
  }

  async function rollback(): Promise<void> {
    const to = values.to;
    if (to === undefined || !isVersion(to)) refuse('rollback: --to <version> names the earlier version the feed must serve again.');
    const plan = planOnly(to);
    const steps = rollbackSteps(serverDeps(plan), { to, localFeedPath: join(checkout.root, '.release', `rollback-to-${to}`, 'updates.json') });
    // The confirmation names the version the feed goes back to.
    await outward(`pointing the feed back at ${to}`, to, steps);
    if (!plan) {
      print(`the feed serves ${to} again. Browsers that already took the newer version keep it: the fix for them is a higher version.`);
      print('the pages still describe the newer version until the next release.');
    }
  }

  const commands: Readonly<Record<string, () => Promise<void> | void>> = { status, unlock, 'test-builds': testBuilds, sign, announce, rollback };

  const help = command === 'help' || command === '--help';
  const run = command === '' || BUMPS.includes(command) || isVersion(command) ? () => ship(command === '' ? 'patch' : command) : commands[command];
  if (run === undefined || help || extra.length > 0) {
    deps.printError(help ? USAGE : `release: ${extra.length > 0 ? `unexpected «${extra.join(' ')}»` : `unknown command «${command}»`}.\n\n${USAGE}`);
    return help ? 0 : 2;
  }
  try {
    await run();
    return 0;
  } catch (error) {
    if (error instanceof Refusal) {
      deps.printError(`release: ${error.message}`);
      return 2;
    }
    deps.printError(`release: ${message(error)}`);
    return 1;
  }
}

// `pnpm release <command>` — cutting a release of the extension
// (architecture.md §13, the runbook: docs/release.md).
//
// Local commands change nothing outside this checkout and make no network
// request:
//   status                         what the tree holds: version, build, gate, signed XPI
//   version [--set X.Y.Z | --bump patch|minor|major]
//   note                           create docs/releases/<version>.md, the manual checklist
//   site [--check]                 rewrite the generated parts of site/ (or only compare)
//   build                          `pnpm build` and the sha256 of both archives
//   preflight [--online]           the pre-release gate; --online adds the read-only
//                                  network checks and is what `sign` asks for
//   announce --check               validate the Telegram post of the version
//
// Outward commands leave the machine. Each one prints its plan — the exact
// command lines, scripts and addresses — and stops unless it is given
// `--confirm <version>`; `--dry-run` prints the plan and nothing else:
//   sign                           AMO: web-ext sign --channel unlisted
//   sign --import <file.xpi>       no network: take a signed XPI downloaded from the
//                                  developer hub by hand (AMO signed, web-ext timed out)
//   publish                        the server: XPI and record, the feed, the pages
//   pages [--versionless]          the server: the pages alone
//   tag                            git: the annotated tag vX.Y.Z, pushed to origin
//   announce                       Telegram: the changelog section to the channel
//   rollback --to <version>        the server: the feed back at an earlier version
//
// Secrets come from the environment at run time (config.ts `ENV`); nothing of
// them is written to a file, an argument or the output.
//
// Everything the commands touch outside the checkout comes in as `CliDeps` —
// other programs, HTTP, Telegram, the environment, the clock — so the whole
// tool runs in tests against a throwaway checkout with a scripted world;
// index.ts is the entry point that hands it the real one.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { composePost, sendPost, type FetchLike } from './announce.ts';
import { sectionOf } from './changelog.ts';
import { ENV, noteFile, signedXpiName, VERSION_FILE, type ReleaseTarget } from './config.ts';
import { commandStep, mustRun, renderCommand, runSteps, type Exec, type Print, type Step } from './exec.ts';
import { Checkout } from './local.ts';
import { renderNote } from './note.ts';
import { runPreflight } from './preflight.ts';
import { pagesOnlySteps, publishSteps, rollbackSteps, servedFeed, type Http, type ServerDeps } from './publish.ts';
import { gateProblems, importProblems, type ArtifactRef, type GateRecord, type ReleaseRecord } from './records.ts';
import { checkRemoteDir, checkSiteFolder, sshTransport } from './remote.ts';
import { amoMetadata, importSigned, releaseRecord, reviewerNotes, signBuild, signCommand } from './sign.ts';
import { renderSite, siteProblems, SITE_FILES, VERSIONLESS_FILES } from './site.ts';
import { bumpVersion, compareVersions, isVersion, setPackageVersion, type BumpKind } from './version.ts';
import { sha256Hex } from './xpi.ts';

const USAGE = `pnpm release <command>

local:    status · version [--set X.Y.Z | --bump patch|minor|major] · note · site [--check] · build
          preflight [--online] · announce --check
outward:  sign · publish · pages [--versionless] · tag · announce · rollback --to <version>
          each prints its plan and stops without --confirm <version>; --dry-run only prints
          sign --import <file.xpi> takes a signed XPI downloaded by hand (no network)

The runbook: docs/release.md`;

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
  /** Tests only: another site and hub than the build's own. */
  readonly target?: ReleaseTarget;
}

class Refusal extends Error {}

function refuse(text: string): never {
  throw new Refusal(text);
}

/** Runs one command; resolves with the exit code: 0, 2 — refused (nothing was done), 1 — failed. */
export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const { print } = deps;
  const [command = '', ...rest] = argv;
  let parsed;
  try {
    parsed = parseArgs({
      args: rest[0] === '--' ? rest.slice(1) : rest,
      options: {
        'dry-run': { type: 'boolean', default: false },
        confirm: { type: 'string' },
        online: { type: 'boolean', default: false },
        check: { type: 'boolean', default: false },
        set: { type: 'string' },
        bump: { type: 'string' },
        to: { type: 'string' },
        versionless: { type: 'boolean', default: false },
        import: { type: 'string' },
        silent: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    deps.printError(`release: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 2;
  }
  const { values } = parsed;

  const checkout = new Checkout(deps.root, deps.exec, deps.target);
  const dryRun = values['dry-run'];

  /**
   * true — the outward command only shows its plan: `--dry-run`, no `--confirm`,
   * or a `--confirm` that names another version. Then nothing leaves the
   * machine at all — not the steps, and not the read-only looks at origin, the
   * feed or the server that a real run makes first.
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
    if (value === undefined || value === '') refuse(`${name} is not set in the environment (docs/release.md, «Секреты и переменные»).`);
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
    };
  }

  /** HEAD is the commit of a release: origin/main, or exactly the tag of `version`. */
  async function requireReleaseTree(version: string, allowTag: boolean): Promise<void> {
    if ((await checkout.git('status', '--porcelain')) !== '') refuse('the working tree is not clean: what goes out must be what is committed.');
    const head = await checkout.git('rev-parse', 'HEAD');
    await checkout.git('fetch', 'origin', 'main', '--tags', '--quiet');
    if (head === (await checkout.git('rev-parse', 'origin/main'))) return;
    if (allowTag && (await checkout.gitCode('rev-parse', '-q', '--verify', `refs/tags/v${version}^{commit}`)) === 0 && head === (await checkout.git('rev-parse', `refs/tags/v${version}^{commit}`))) return;
    refuse(`HEAD ${head.slice(0, 12)} is neither origin/main${allowTag ? ` nor the tag v${version}` : ''}.`);
  }

  /**
   * What `publish` asks of the checkout. The XPI that goes out is the signed
   * file, whatever HEAD is; so the signed commit only has to be merged — on
   * origin/main, not necessarily its tip: main may have moved on since the
   * signing, and a signed version cannot be signed again. HEAD, which the pages
   * come from, is that commit or a later one on the way to the tip.
   */
  async function requirePublishable(record: ReleaseRecord): Promise<void> {
    if ((await checkout.git('status', '--porcelain')) !== '') refuse('the working tree is not clean: what goes out must be what is committed.');
    const head = await checkout.git('rev-parse', 'HEAD');
    await checkout.git('fetch', 'origin', 'main', '--tags', '--quiet');
    const signed = record.commit;
    if (!(await checkout.isAncestor(signed, 'origin/main'))) {
      refuse(`${record.version} was signed from ${signed.slice(0, 12)}, which is not on origin/main: only what is merged is published.`);
    }
    if (!(await checkout.isAncestor(signed, head)) || !(await checkout.isAncestor(head, 'origin/main'))) {
      refuse(`HEAD ${head.slice(0, 12)} is neither the signed commit ${signed.slice(0, 12)} nor a later commit of origin/main: publish from the signed commit (git switch --detach ${signed.slice(0, 12)}) or from main.`);
    }
    if (head !== signed) print(`note: HEAD ${head.slice(0, 12)} is ahead of the signed commit ${signed.slice(0, 12)}: the XPI is the signed file (sha256 ${record.xpi.sha256}), the pages are those of HEAD.`);
  }

  function requireSitePages(version: string): void {
    const problems = siteProblems(checkout.siteFiles(), checkout.siteContext(version), checkout.linkedPages());
    if (problems.length > 0) refuse(`the site is not ready:\n  ${problems.join('\n  ')}`);
  }

  // ── local commands ─────────────────────────────────────────────────────────

  async function status(): Promise<void> {
    const version = checkout.version();
    const paths = checkout.paths(version);
    print(`version      ${version} (${VERSION_FILE})`);
    print(`git          ${await checkout.git('rev-parse', '--abbrev-ref', 'HEAD')} @ ${(await checkout.git('rev-parse', 'HEAD')).slice(0, 12)}${(await checkout.git('status', '--porcelain')) === '' ? '' : ', not clean'}`);
    try {
      const built = checkout.build();
      print(`build        ${built.xpi.file} sha256 ${built.xpi.sha256.slice(0, 12)}…, ${built.sources.file}${built.version === version ? '' : ` — for ${built.version}, not ${version}`}`);
    } catch (error) {
      print(`build        none (${error instanceof Error ? error.message : String(error)})`);
    }
    print(`note         ${checkout.note(version) === null ? `none — pnpm release note` : noteFile(version)}`);
    const gate = checkout.gate(version);
    if (gate === null) print('gate         none — pnpm release preflight --online');
    else {
      const failed = gate.checks.filter((check) => !check.ok).map((check) => check.id);
      print(`gate         ${gate.createdAt}, commit ${gate.commit.slice(0, 12)}, ${gate.online ? 'online' : 'offline (a rehearsal)'}, ${failed.length === 0 ? 'passed' : `failed: ${failed.join(', ')}`}`);
    }
    const record = checkout.record(version);
    const submitted = checkout.submitted(version);
    if (record === null && submitted !== null) {
      print(`submitted    to AMO from ${submitted.commit.slice(0, 12)}, no signed file here yet — look at the developer hub; a file downloaded there: pnpm release sign --import <file.xpi>`);
    }
    print(record === null ? 'signed       no' : `signed       ${record.xpi.file} sha256 ${record.xpi.sha256}, ${record.signedAt}, from ${record.commit.slice(0, 12)}${existsSync(paths.signedXpi) ? '' : ' — THE FILE IS MISSING'}`);
    const announced = checkout.announced(version);
    if (announced !== null) print(`announced    ${announced.state === 'posted' ? `posted ${announced.at}${announced.messageId === null ? '' : `, message ${announced.messageId}`}` : `${announced.at}: the send may have reached the channel — look there`}`);
    print(`tag          v${version} ${(await checkout.gitCode('rev-parse', '-q', '--verify', `refs/tags/v${version}`)) === 0 ? 'exists' : 'is free'}`);
  }

  function version(): void {
    const current = checkout.version();
    if (values.set === undefined && values.bump === undefined) {
      print(current);
      return;
    }
    if (values.set !== undefined && values.bump !== undefined) refuse('give --set or --bump, not both.');
    const kinds: readonly string[] = ['patch', 'minor', 'major'];
    if (values.bump !== undefined && !kinds.includes(values.bump)) refuse('--bump takes patch, minor or major.');
    const next = values.set ?? bumpVersion(current, values.bump as BumpKind);
    checkout.write(VERSION_FILE, setPackageVersion(checkout.read(VERSION_FILE), next));
    print(`${current} → ${next} (${VERSION_FILE})`);
    print(`next: write the «## ${next}» section at the top of CHANGELOG.md, then pnpm release site, pnpm release note, pnpm check, commit.`);
  }

  function note(): void {
    const version = checkout.version();
    if (checkout.note(version) !== null) refuse(`${noteFile(version)} already exists.`);
    checkout.write(noteFile(version), renderNote(version));
    print(`created ${noteFile(version)} — tick what is checked, commit it with the release.`);
  }

  function site(): void {
    const version = checkout.version();
    const files = checkout.siteFiles();
    if (!values.check) {
      let changed = 0;
      for (const [name, text] of renderSite(files, checkout.siteContext(version))) {
        if (text === files.get(name)) continue;
        checkout.write(join('site', name), text);
        changed += 1;
      }
      print(`site: ${changed === 0 ? 'already up to date' : `${changed} file(s) rewritten`} for ${version}.`);
    }
    requireSitePages(version);
    print(`site: ${SITE_FILES.length} files are whole and match ${version} and CHANGELOG.md.`);
  }

  async function build(): Promise<void> {
    const result = await deps.exec({ program: 'pnpm', args: ['build'], cwd: checkout.root, inherit: true });
    if (result.code !== 0) refuse('pnpm build failed.');
    const built = checkout.build();
    for (const artifact of [built.xpi, built.sources]) print(`${artifact.file}  ${artifact.bytes} B  sha256 ${artifact.sha256}`);
  }

  async function preflight(): Promise<void> {
    const result = await runPreflight(checkout, { online: values.online, http: deps.http, print, now: deps.now, env: deps.env });
    // What is kept is this run, whatever it ended with: a pass of an earlier run does not outlive a failure.
    if (result.version !== '' && checkout.saveGate(result.version, result.gate)) {
      print(`preflight: the gate record of an earlier run is removed (${checkout.paths(result.version).gate}): this run did not get as far as a build.`);
    }
    if (result.failed.length > 0) refuse(`preflight: ${result.failed.length} check(s) failed: ${result.failed.join(', ')}.`);
    if (!values.online) {
      print(`preflight: the local checks passed. This is a rehearsal, not the gate: ${result.skipped.join(', ')} need the network — run pnpm release preflight --online before signing.`);
      return;
    }
    print(`preflight: the gate passed for ${result.gate?.version ?? '?'} at ${result.gate?.commit.slice(0, 12) ?? '?'}. Next: pnpm release sign`);
  }

  // ── outward commands ───────────────────────────────────────────────────────

  async function sign(): Promise<void> {
    const version = checkout.version();
    const paths = checkout.paths(version);
    if (existsSync(paths.signedXpi) || existsSync(paths.record)) refuse(`${version} is already signed (${paths.signedXpi}): a version is signed once. Next: pnpm release publish`);
    const built = checkout.build();
    const building = { version, xpiSha256: built.xpi.sha256, sourcesSha256: built.sources.sha256 };
    /** The signed XPI and the record of the release, stored once. */
    const store = (gate: GateRecord, data: Buffer): void => {
      const xpi: ArtifactRef = { file: signedXpiName(version), sha256: sha256Hex(data), bytes: data.length };
      const record: ReleaseRecord = releaseRecord({ target: checkout.target, gate, signedXpi: xpi, signedAt: deps.now().toISOString() });
      mkdirSync(paths.dir, { recursive: true });
      writeFileSync(paths.signedXpi, data);
      writeFileSync(paths.record, `${JSON.stringify(record, null, 2)}\n`);
      print(`    signed: ${xpi.file}, ${xpi.bytes} B, sha256 ${xpi.sha256}, built from ${gate.commit.slice(0, 12)}`);
    };

    if (values.import !== undefined) {
      // AMO signed the version and web-ext did not bring the file: it was downloaded from the developer hub by hand.
      // The gate that counts is the one the submission was made under; without a submission of ours — the last gate.
      const gate = checkout.submitted(version) ?? checkout.gate(version);
      const problems = gate === null ? ['no gate record and no record of a submission — this checkout never sent the version to AMO'] : importProblems(gate, building);
      if (gate === null || problems.length > 0) refuse(`cannot take a signed XPI for ${version}:\n  ${problems.join('\n  ')}`);
      const data = importSigned(values.import, { version, geckoId: checkout.target.geckoId }, checkout.buildFiles(built.dir));
      if (dryRun) {
        print(`dry run: ${values.import} is the build of ${gate.commit.slice(0, 12)}, signed (sha256 ${sha256Hex(data)}). Nothing was stored.`);
        return;
      }
      store(gate, data);
      print('Next: pnpm release publish');
      return;
    }

    const gate = checkout.gate(version);
    const head = await checkout.git('rev-parse', 'HEAD');
    const problems = gate === null ? ['no gate record — run pnpm release preflight --online'] : gateProblems(gate, { ...building, commit: head, now: deps.now().getTime() });
    if ((await checkout.git('status', '--porcelain')) !== '') problems.push('the working tree is not clean');
    const plan = planOnly(version);
    if (problems.length > 0 && !plan) refuse(`cannot sign ${version}:\n  ${problems.join('\n  ')}`);
    for (const problem of problems) print(`note: ${problem}`);
    const before = checkout.submitted(version);
    if (before !== null && before.build.xpi.sha256 !== built.xpi.sha256) {
      print(`note: ${version} was already sent to AMO once, from ${before.commit.slice(0, 12)} and with another build. AMO takes a version once: if it took that one, it refuses this one, and ${version} is spent — look at the developer hub first.`);
    }

    const artifactsDir = join(paths.dir, 'web-ext-artifacts');
    const pnpmVersion = (await mustRun(deps.exec, { program: 'pnpm', args: ['--version'], cwd: checkout.root })).stdout.trim();
    const notes = reviewerNotes({ version, commit: head, nodeVersion: process.versions.node.split('.')[0] ?? process.versions.node, pnpmVersion });
    const input = { repoRoot: checkout.root, buildDir: built.dir, sourcesZip: built.sources.path, artifactsDir, metadataPath: paths.amoMetadata };
    const spec = signCommand(input);

    const steps: Step[] = [
      {
        // The gate saw origin/main some time ago; a PR may have been merged since. A version is spent
        // the moment AMO takes it, so the last look is here, while nothing is spent yet.
        title: 'Check that the commit is still the tip of origin/main',
        show: ['$ git fetch origin main --quiet', `HEAD ${head.slice(0, 12)} must be origin/main: a commit that is no longer the tip is not sent for signing`],
        run: async () => {
          await checkout.git('fetch', 'origin', 'main', '--quiet');
          const tip = await checkout.git('rev-parse', 'origin/main');
          if (tip !== head) {
            refuse(`HEAD ${head.slice(0, 12)} is no longer the tip of origin/main (${tip.slice(0, 12)}): nothing was sent to AMO. git pull, then pnpm release preflight --online again — the gate is for one commit.`);
          }
        },
      },
      {
        title: 'Write the notes for Mozilla’s reviewers',
        show: [`write ${paths.amoMetadata} (approval notes):`, ...notes.split('\n').map((line) => `  | ${line}`)],
        run: () => {
          mkdirSync(paths.dir, { recursive: true });
          writeFileSync(paths.amoMetadata, amoMetadata(notes));
          return Promise.resolve();
        },
      },
      {
        title: `Sign ${version} at addons.mozilla.org (unlisted) with the sources archive, check the signed XPI against the build, store it with the record`,
        show: [
          `write ${paths.submitted} — the gate this submission is made under (what «sign --import» goes by if AMO signs later than web-ext waits)`,
          ...renderCommand(spec),
          `the one .xpi in ${artifactsDir} must be signed, be ${checkout.target.geckoId} ${version} and hold the build's files unchanged`,
          `store ${paths.signedXpi}`,
          `write ${paths.record}`,
        ],
        run: async () => {
          if (gate === null) throw new Error('no gate record.');
          requireEnv(ENV.amoKey);
          requireEnv(ENV.amoSecret);
          checkout.saveSubmitted(gate);
          store(gate, await signBuild(deps.exec, input, { version, geckoId: checkout.target.geckoId }, () => checkout.buildFiles(built.dir), spec));
          rmSync(artifactsDir, { recursive: true, force: true });
        },
      },
    ];
    await outward('signing at AMO', version, steps);
    if (!plan) print('Next: pnpm release publish');
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

  async function publish(): Promise<void> {
    const version = checkout.version();
    const paths = checkout.paths(version);
    const plan = planOnly(version);
    const { record, recordSha256 } = recordFor(version, plan);
    if (!plan) await requirePublishable(record);
    requireSitePages(version);
    const steps = publishSteps(serverDeps(plan), {
      record,
      signedXpiPath: paths.signedXpi,
      recordPath: paths.record,
      recordSha256,
      localFeedPath: join(paths.dir, 'updates.json'),
      pages: checkout.publishablePages(),
    });
    await outward('publishing to the server', version, steps);
    if (!plan) print(`published: ${checkout.target.feedUrl} serves ${version}. Next: pnpm release tag, then the lines «После выкладки» of ${noteFile(version)}`);
  }

  async function pages(): Promise<void> {
    const version = checkout.version();
    const plan = planOnly(version);
    const deps = serverDeps(plan);
    requireSitePages(version);
    let only: readonly string[] = SITE_FILES;
    if (values.versionless) {
      // Ahead of a release: only the pages that say nothing about a version.
      only = VERSIONLESS_FILES;
      if (!plan) await requireReleaseTree(version, false);
    } else if (!plan) {
      await requireReleaseTree(version, true);
      const served = await servedFeed(deps);
      if (served?.version !== version) {
        refuse(`the feed serves ${served?.version ?? 'nothing'}, the tree holds ${version}: the pages of a version go out with it (pnpm release publish). Pages that name no version can go ahead: --versionless`);
      }
    }
    await outward(`publishing ${only.length} page file(s)`, version, pagesOnlySteps(deps, checkout.publishablePages(only)));
  }

  async function tag(): Promise<void> {
    const version = checkout.version();
    const plan = planOnly(version);
    const { record } = recordFor(version, plan);
    const name = `v${version}`;
    if (!plan) {
      if ((await checkout.gitCode('rev-parse', '-q', '--verify', `refs/tags/${name}`)) === 0) refuse(`the tag ${name} already exists.`);
      const served = await servedFeed({ http: deps.http, target: checkout.target });
      if (served?.version !== version || served.sha256 !== record.xpi.sha256) refuse(`the feed does not serve ${version} with sha256 ${record.xpi.sha256} (it serves ${served?.version ?? 'nothing'}): tag what is served — pnpm release publish first.`);
    }
    const text = `ChatGoose для ChatSpace ${version} — signed and served from ${checkout.target.feedBase} (xpi sha256:${record.xpi.sha256}; SDK contract ${record.vendor.sdkContractHash}); built from ${record.commit}`;
    await outward('pushing the release tag', version, [
      commandStep(`Tag ${record.commit.slice(0, 12)} as ${name}`, deps.exec, { program: 'git', args: ['tag', '-a', name, '-m', text, record.commit], cwd: checkout.root }),
      commandStep(`Push ${name} to origin`, deps.exec, { program: 'git', args: ['push', 'origin', name], cwd: checkout.root }),
    ]);
  }

  async function announce(): Promise<void> {
    const version = checkout.version();
    const post = composePost(sectionOf(checkout.changelog(), version));
    if (values.check) {
      print(`announce: the post of ${version} is valid, ${[...post].length} characters.`);
      return;
    }
    if (!planOnly(version)) {
      const served = await servedFeed({ http: deps.http, target: checkout.target });
      if (served?.version !== version) refuse(`the feed serves ${served?.version ?? 'nothing'}, not ${version}: announce what chatters can already get.`);
    }
    await outward('posting to the Telegram channel', version, [
      {
        title: `Post the changelog section of ${version} to the channel ${ENV.telegramChannel}`,
        show: [`POST https://api.telegram.org/bot<${ENV.telegramToken}>/sendRichMessage${values.silent ? ' (without a notification)' : ''}:`, ...post.split('\n').map((line) => `  | ${line}`)],
        run: async () => {
          const id = await sendPost({ botToken: requireEnv(ENV.telegramToken), chatId: requireEnv(ENV.telegramChannel) }, post, {
            silent: values.silent,
            fetchImpl: deps.fetchImpl,
            sleep: deps.sleep,
          });
          print(`    posted${id === null ? '' : ` (message ${id})`}`);
        },
      },
    ]);
  }

  async function rollback(): Promise<void> {
    const to = values.to;
    if (to === undefined || !isVersion(to)) refuse('rollback: --to <version> names the earlier version the feed must serve again.');
    const earlier = to;
    if (compareVersions(earlier, checkout.version()) > 0) refuse(`rollback: ${earlier} is higher than the version in the tree — that is a release, not a rollback.`);
    const plan = planOnly(earlier);
    const steps = rollbackSteps(serverDeps(plan), { to: earlier, localFeedPath: join(checkout.root, '.release', `rollback-to-${earlier}`, 'updates.json') });
    // The confirmation names the version the feed goes back to.
    await outward(`pointing the feed back at ${earlier}`, earlier, steps);
    if (!plan) {
      print(`the feed serves ${earlier} again. Browsers that already took the newer version keep it: the fix for them is a higher version.`);
      print(`the pages still describe the newer version — publish the pages of ${earlier} from its tag (docs/release.md, «Откат»).`);
    }
  }

  const commands: Readonly<Record<string, () => Promise<void> | void>> = { status, version, note, site, build, preflight, sign, publish, pages, tag, announce, rollback };

  const run = commands[command];
  if (run === undefined) {
    const help = command === '' || command === 'help' || command === '--help';
    deps.printError(help ? USAGE : `release: unknown command «${command}».\n\n${USAGE}`);
    return command === 'help' || command === '--help' ? 0 : 2;
  }
  try {
    await run();
    return 0;
  } catch (error) {
    if (error instanceof Refusal) {
      deps.printError(`release: ${error.message}`);
      return 2;
    }
    deps.printError(`release: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

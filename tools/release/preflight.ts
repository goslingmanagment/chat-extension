// `pnpm release preflight [--online]`: the pre-release gate (architecture.md
// §13 «Выпуск» п. 1–2). Observes, hands each observation to its rule in
// gate.ts, prints one line per check and writes .release/<version>/gate.json.
//
// Without --online it makes no network request at all: a rehearsal that checks
// everything this machine can answer alone. With --online it also fetches
// origin, reads the served feed and the production hub's health and asks
// GitHub about the hub commit — read-only, all four — and only such a gate
// lets `sign` run.
//
// The cheap checks run first; the slow ones (`pnpm check`, the rebuild from
// the sources archive) are not started while a cheap one is red.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { composePost } from './announce.ts';
import { sectionOf } from './changelog.ts';
import { DEFAULT_HUB_REPO, ENV, HUB_HEALTH_PATH, noteFile } from './config.ts';
import type { Print } from './exec.ts';
import {
  evaluateBranch,
  evaluateCleanTree,
  evaluateCommand,
  evaluateFeedAhead,
  evaluateHead,
  evaluateHubAncestry,
  evaluateHubCompatibility,
  evaluateNote,
  evaluateTagFree,
  evaluateVendor,
  evaluateVersions,
  SKIPPED_OFFLINE,
  type Verdict,
} from './gate.ts';
import { buildDifferences, rebuildFromSources, type Checkout } from './local.ts';
import type { Http } from './publish.ts';
import type { ArtifactRef, GateCheck, GateRecord, VendorRef } from './records.ts';
import { siteProblems } from './site.ts';

export interface PreflightOptions {
  readonly online: boolean;
  readonly http: Http;
  readonly print: Print;
  readonly now: () => Date;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface PreflightResult {
  /** null — there is no build to record (a cheap check failed before it). */
  readonly gate: GateRecord | null;
  readonly failed: readonly string[];
  readonly skipped: readonly string[];
}

type Build = ReturnType<Checkout['build']>;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export async function runPreflight(checkout: Checkout, options: PreflightOptions): Promise<PreflightResult> {
  const { print } = options;
  const checks: GateCheck[] = [];
  const skipped: string[] = [];
  const add = (id: string, verdict: Verdict): boolean => {
    checks.push({ id, ok: verdict.ok, detail: verdict.detail });
    print(`${verdict.ok ? 'ok  ' : 'FAIL'}  ${id.padEnd(15)} ${verdict.detail}`);
    return verdict.ok;
  };
  const skip = (id: string, why: string = SKIPPED_OFFLINE): void => {
    skipped.push(id);
    print(`skip  ${id.padEnd(15)} ${why}`);
  };
  const guarded = async (id: string, check: () => Promise<Verdict> | Verdict): Promise<boolean> => {
    try {
      return add(id, await check());
    } catch (error) {
      return add(id, { ok: false, detail: message(error) });
    }
  };

  let version = '';
  await guarded('version', () => {
    version = checkout.version();
    return { ok: true, detail: `${version} (apps/extension/package.json)` };
  });
  if (version === '') return { gate: null, failed: checks.filter((check) => !check.ok).map((check) => check.id), skipped };

  const head = await checkout.git('rev-parse', 'HEAD');
  await guarded('branch', async () => evaluateBranch(await checkout.git('rev-parse', '--abbrev-ref', 'HEAD')));
  await guarded('clean-tree', async () => evaluateCleanTree(await checkout.git('status', '--porcelain')));

  if (options.online) {
    await guarded('pushed', async () => {
      await checkout.git('fetch', 'origin', 'main', '--tags', '--quiet');
      return evaluateHead(head, await checkout.git('rev-parse', 'origin/main'));
    });
  } else skip('pushed');

  await guarded('tag-free', async () => {
    const local = (await checkout.gitCode('rev-parse', '-q', '--verify', `refs/tags/v${version}`)) === 0;
    const remote = options.online ? (await checkout.git('ls-remote', '--tags', 'origin', `refs/tags/v${version}`)) !== '' : null;
    return evaluateTagFree(version, local, remote);
  });

  // `announce --check` (§13 п. 2): the section exists and makes a post Telegram will take.
  await guarded('changelog', () => {
    const post = composePost(sectionOf(checkout.changelog(), version));
    return { ok: true, detail: `CHANGELOG.md has the section of ${version}; the announcement is ${[...post].length} characters` };
  });
  await guarded('site', () => {
    const problems = siteProblems(checkout.siteFiles(), checkout.siteContext(version), checkout.linkedPages());
    return problems.length === 0 ? { ok: true, detail: 'the pages are whole and match the version and the changelog' } : { ok: false, detail: problems.join('; ') };
  });
  await guarded('note', () => evaluateNote(checkout.note(version), version));
  if (!checks.some((check) => check.id === 'note' && check.ok)) print(`      ${noteFile(version)}`);

  // Filled by the checks below (a holder: the checks run inside callbacks).
  const found: { vendor: VendorRef | null; build: Build | null } = { vendor: null, build: null };
  await guarded('vendor', () => {
    const verdict = evaluateVendor(checkout.vendor());
    found.vendor = verdict.vendor;
    return verdict;
  });
  const vendored = found.vendor;

  if (options.online && vendored !== null) {
    const hubRepo = options.env[ENV.hubRepo] ?? DEFAULT_HUB_REPO;
    await guarded('hub-commit', async () => {
      const result = await checkout.exec({ program: 'gh', args: ['api', `repos/${hubRepo}/compare/${vendored.sdkSourceCommit}...main`, '--jq', '.status'] });
      const status = result.code === 0 ? result.stdout.trim() : null;
      return evaluateHubAncestry(status, vendored.sdkSourceCommit, hubRepo, result.stderr.trim().split('\n').at(-1) ?? '');
    });
  } else skip('hub-commit', vendored === null ? 'not checked: the vendored SDK is not in order' : SKIPPED_OFFLINE);

  const cheapFailures = checks.filter((check) => !check.ok).map((check) => check.id);
  if (cheapFailures.length > 0) {
    for (const id of ['check', 'versions', 'reproducible']) skip(id, `not run: fix ${cheapFailures.join(', ')} first`);
  } else {
    print('      running pnpm check (typecheck, lint, test, build, webext-lint, size, gates, parity, archive-check)…');
    const checked = await guarded('check', async () => {
      const result = await checkout.exec({ program: 'pnpm', args: ['check'], cwd: checkout.root, inherit: true, env: { CI: 'true' } });
      return evaluateCommand('pnpm check', result.code);
    });
    if (checked) {
      await guarded('versions', () => {
        const manifest = join(checkout.root, 'apps/extension/.output/firefox-mv3/manifest.json');
        const built = existsSync(manifest) ? (JSON.parse(readFileSync(manifest, 'utf8')) as { version?: string }).version ?? null : null;
        const verdict = evaluateVersions(version, built);
        if (verdict.ok) found.build = checkout.build();
        return verdict;
      });
      const current = found.build;
      if (current !== null) {
        print('      rebuilding from the sources archive, as a reviewer would…');
        await guarded('reproducible', async () => {
          const differences = buildDifferences(checkout.buildFiles(current.dir), await rebuildFromSources(checkout.exec, current.sources.path));
          return differences.length === 0
            ? { ok: true, detail: `the sources archive rebuilds the same extension, byte for byte (${checkout.buildFiles(current.dir).length} files)` }
            : { ok: false, detail: `the rebuild from the sources archive differs: ${differences.slice(0, 5).join('; ')}` };
        });
      } else skip('reproducible', 'not run: no build');
    } else for (const id of ['versions', 'reproducible']) skip(id, 'not run: pnpm check is red');
  }

  if (options.online) {
    await guarded('feed', async () => {
      const answer = await options.http(checkout.target.feedUrl);
      return evaluateFeedAhead(version, { status: answer.status, body: answer.body.toString('utf8') }, checkout.target.geckoId);
    });
    if (vendored !== null) {
      await guarded('hub-compat', async () => {
        const answer = await options.http(`${checkout.target.hubOrigin}${HUB_HEALTH_PATH}`);
        return evaluateHubCompatibility({ status: answer.status, body: answer.body.toString('utf8') }, vendored.sdkContractHash);
      });
    } else skip('hub-compat', 'not checked: the vendored SDK is not in order');
  } else {
    skip('feed');
    skip('hub-compat');
  }

  const failed = checks.filter((check) => !check.ok).map((check) => check.id);
  const finalBuild = found.build;
  if (finalBuild === null || vendored === null) return { gate: null, failed, skipped };
  const pick = ({ file, sha256, bytes }: ArtifactRef): ArtifactRef => ({ file, sha256, bytes });
  return {
    gate: {
      schema: 1,
      version,
      commit: head,
      createdAt: options.now().toISOString(),
      online: options.online,
      checks,
      build: { xpi: pick(finalBuild.xpi), sources: pick(finalBuild.sources) },
      vendor: vendored,
    },
    failed,
    skipped,
  };
}

// The pre-release gate (architecture.md §13 «Выпуск» п. 1–2, UP-003, UP-004):
// what each check concludes from what was observed. preflight.ts observes
// (git, files, the feed, the hub) and calls these; nothing here does I/O, so
// every rule is tested as a table.

import { parseFeed, type FeedEntry } from './feed.ts';
import { noteProblems } from './note.ts';
import type { VendorRef } from './records.ts';
import { compareVersions, isVersion } from './version.ts';

export interface Verdict {
  readonly ok: boolean;
  readonly detail: string;
}

const pass = (detail: string): Verdict => ({ ok: true, detail });
const fail = (detail: string): Verdict => ({ ok: false, detail });

export function evaluateBranch(branch: string): Verdict {
  return branch === 'main' ? pass('on main') : fail(`releases are cut from main; the current branch is «${branch}»`);
}

/** `porcelain` — the output of `git status --porcelain`. */
export function evaluateCleanTree(porcelain: string): Verdict {
  const lines = porcelain.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) return pass('the working tree is clean');
  return fail(`the working tree is not clean (${lines.length} path(s), first: ${lines[0]?.trim()}) — what is signed must be what is committed`);
}

/** `originMain` — the commit of origin/main right after a fetch. */
export function evaluateHead(head: string, originMain: string): Verdict {
  return head === originMain ? pass(`HEAD ${head.slice(0, 12)} is origin/main`) : fail(`HEAD ${head.slice(0, 12)} is not origin/main ${originMain.slice(0, 12)} — push the release commit first`);
}

export function evaluateTagFree(version: string, existsLocally: boolean, existsOnOrigin: boolean | null): Verdict {
  if (existsLocally) return fail(`the tag v${version} already exists — a tag is the evidence of a release and is never reused; bump the version`);
  if (existsOnOrigin === true) return fail(`the tag v${version} already exists on origin — bump the version`);
  return pass(existsOnOrigin === null ? `v${version} is free locally` : `v${version} is free locally and on origin`);
}

export interface FeedObservation {
  /** HTTP status of the feed address; 0 — no answer at all. */
  readonly status: number;
  readonly body: string;
}

/** The version must be higher than the one the feed serves; a feed that is not there yet (404) is the first release. */
export function evaluateFeedAhead(version: string, feed: FeedObservation, geckoId: string): Verdict {
  if (feed.status === 404) return pass('no feed is published yet: this is the first release');
  if (feed.status !== 200) return fail(`the feed answered ${feed.status === 0 ? 'nothing' : `HTTP ${feed.status}`} — the served version is unknown, so a downgrade cannot be ruled out`);
  let served: FeedEntry;
  try {
    served = parseFeed(feed.body, geckoId);
  } catch (error) {
    return fail(`the served feed cannot be read (${error instanceof Error ? error.message : String(error)})`);
  }
  return compareVersions(version, served.version) > 0
    ? pass(`the feed serves ${served.version}, ${version} is higher`)
    : fail(`the feed already serves ${served.version}; ${version} is not higher — no downgrade and no second release of one version`);
}

export interface HealthObservation {
  readonly status: number;
  readonly body: string;
}

/**
 * H-1: the vendored SDK's contract hash must be in the `compatibleClientSdks`
 * of the production hub. A hub that does not publish the list yet does not
 * allow a release at all (§13: «до H-1 выпуска нет»).
 */
export function evaluateHubCompatibility(health: HealthObservation, vendoredHash: string): Verdict {
  if (health.status !== 200) return fail(`the hub health answered ${health.status === 0 ? 'nothing' : `HTTP ${health.status}`} — a release does not go out to a hub that is not healthy`);
  let parsed: { status?: unknown; contractHash?: unknown; compatibleClientSdks?: unknown };
  try {
    parsed = JSON.parse(health.body) as typeof parsed;
  } catch {
    return fail('the hub health answer is not JSON');
  }
  if (parsed.status !== 'ok') return fail(`the hub reports status ${JSON.stringify(parsed.status)}`);
  const list = parsed.compatibleClientSdks;
  if (list === undefined) return fail('the hub does not publish compatibleClientSdks yet (hub change H-1) — no release before it');
  if (!Array.isArray(list) || list.some((item) => typeof item !== 'string')) return fail('the hub health carries a malformed compatibleClientSdks');
  if (!list.includes(vendoredHash)) {
    return fail(`the vendored SDK ${vendoredHash.slice(0, 12)}… is not in the hub's compatibleClientSdks (${list.length} listed) — register it in the hub and deploy the hub first`);
  }
  const same = parsed.contractHash === vendoredHash;
  return pass(`the hub lists the vendored SDK ${vendoredHash.slice(0, 12)}… as compatible${same ? ' and runs the same contract' : '; the hub itself runs a newer contract'}`);
}

/** GitHub's `compare/<commit>...main` status of the hub repository: how main stands to the vendored commit. */
export function evaluateHubAncestry(compareStatus: string | null, commit: string, hubRepo: string, error = ''): Verdict {
  if (compareStatus === 'ahead' || compareStatus === 'identical') return pass(`the SDK's source commit ${commit.slice(0, 12)} is on ${hubRepo} main`);
  if (compareStatus === null) return fail(`could not ask GitHub whether ${commit.slice(0, 12)} is on ${hubRepo} main${error === '' ? '' : ` (${error})`}`);
  return fail(`the SDK is vendored from ${commit.slice(0, 12)}, which is not on ${hubRepo} main (${compareStatus}) — a release is vendored only from a merged and deployed hub commit: merge, deploy the hub, re-vendor`);
}

export interface VendorObservation {
  readonly sdk: { readonly contractHash?: unknown; readonly sourceCommit?: unknown };
  readonly hotkeys: { readonly sha256?: unknown; readonly sourceCommit?: unknown };
  readonly pins: { readonly kernelSdk?: { readonly contractHash?: unknown; readonly sourceCommit?: unknown }; readonly chatgooseHotkeys?: { readonly sha256?: unknown } };
}

/** The vendored packages come from exact hub commits and are the pinned ones (HB-005, HK-033). */
export function evaluateVendor(observed: VendorObservation): Verdict & { readonly vendor: VendorRef | null } {
  const { contractHash, sourceCommit } = observed.sdk;
  const hotkeys = observed.hotkeys.sha256;
  const problems: string[] = [];
  if (typeof contractHash !== 'string' || !/^[0-9a-f]{64}$/.test(contractHash)) problems.push('the SDK manifest has no contract hash');
  // A `-dirty` suffix means the SDK was generated from an uncommitted hub tree: it cannot be tied to a commit.
  if (typeof sourceCommit !== 'string' || !/^[0-9a-f]{40}$/.test(sourceCommit)) problems.push(`the SDK's sourceCommit ${JSON.stringify(sourceCommit)} is not an exact clean hub commit`);
  if (typeof hotkeys !== 'string' || !/^[0-9a-f]{64}$/.test(hotkeys)) problems.push('the hotkeys manifest has no sha256');
  if (contractHash !== observed.pins.kernelSdk?.contractHash || sourceCommit !== observed.pins.kernelSdk?.sourceCommit) problems.push('the SDK differs from tests/vendor-pins.json');
  if (hotkeys !== observed.pins.chatgooseHotkeys?.sha256) problems.push('the hotkeys differ from tests/vendor-pins.json');
  if (problems.length > 0 || typeof contractHash !== 'string' || typeof sourceCommit !== 'string' || typeof hotkeys !== 'string') {
    return { ...fail(problems.join('; ')), vendor: null };
  }
  return {
    ...pass(`SDK ${contractHash.slice(0, 12)}… from hub ${sourceCommit.slice(0, 12)}, hotkeys ${hotkeys.slice(0, 12)}…, both as pinned`),
    vendor: { sdkContractHash: contractHash, sdkSourceCommit: sourceCommit, hotkeysSha256: hotkeys },
  };
}

export function evaluateVersions(packageVersion: string, builtManifestVersion: string | null): Verdict {
  if (!isVersion(packageVersion)) return fail(`the version ${JSON.stringify(packageVersion)} is not X.Y.Z`);
  if (builtManifestVersion === null) return fail('no release build in .output/ — the gate builds it with `pnpm check`');
  return packageVersion === builtManifestVersion
    ? pass(`package.json and the built manifest both say ${packageVersion}`)
    : fail(`package.json says ${packageVersion}, the built manifest says ${builtManifestVersion} — rebuild`);
}

export function evaluateNote(text: string | null, version: string): Verdict {
  const problems = noteProblems(text, version);
  return problems.length === 0 ? pass('every line of «Перед подписью» is ticked') : fail(problems.join('; '));
}

/** A check that ran a command: its exit code and, on failure, the tail of what it printed. */
export function evaluateCommand(name: string, code: number, tail = ''): Verdict {
  return code === 0 ? pass(`${name} is green`) : fail(`${name} failed (exit ${code})${tail === '' ? '' : `: ${tail}`}`);
}

/** A check the gate could not make without the network: it does not pass, it is not run. */
export const SKIPPED_OFFLINE = 'not checked: needs the network (`preflight --online`)';

// The outward steps that touch the server (architecture.md §13 п. 5–6 and
// «Откат»): publish a signed release, republish the pages alone, point the
// feed back at an earlier version. Each returns a list of Steps; index.ts
// prints them for `--dry-run` or runs them after `--confirm`.
//
// The order of a publication is the guarantee:
//   1. the signed XPI and its record go up under their versioned names and are
//      read back over HTTP — same bytes, signed, this add-on, this version;
//   2. only then the feed is replaced, by one rename, and read back;
//   3. only then the pages, so the install page never offers a version the
//      feed does not serve.
// A failure at any point leaves the server serving what it served before, or —
// after step 2 — the new version completely.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { readZip } from '../lib/zip.ts';
import { FEED_FILE, FEED_PREVIOUS_FILE, recordName, signedXpiName, type ReleaseTarget } from './config.ts';
import { commandStep, mustRun, renderCommand, type Exec, type Step } from './exec.ts';
import { feedDifferences, feedEntryFor, parseFeed, renderFeed, type FeedEntry } from './feed.ts';
import { parseReleaseRecord, type ReleaseRecord } from './records.ts';
import { cleanupScript, mkdirScript, placeImmutableScript, replaceScript, uploadName, type Transport } from './remote.ts';
import { compareVersions } from './version.ts';
import { isSigned, sha256Hex, xpiIdentity } from './xpi.ts';

export interface HttpAnswer {
  /** 0 — no answer at all. */
  readonly status: number;
  readonly body: Buffer;
}
export type Http = (url: string) => Promise<HttpAnswer>;

/** GET without caches; a network failure is status 0, never a throw. */
export const realHttp: Http = async (url) => {
  try {
    const response = await fetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(60_000) });
    return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
  } catch {
    return { status: 0, body: Buffer.alloc(0) };
  }
};

export interface ServerDeps {
  readonly exec: Exec;
  readonly http: Http;
  readonly transport: Transport;
  /** Absolute folder on the server served as `target.siteBase`. */
  readonly remoteDir: string;
  readonly target: ReleaseTarget;
  /** Unique per run: the suffix of temporary uploads. */
  readonly nonce: string;
  /** Waits between read-backs of a public address (tests pass a no-op). */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface LocalFile {
  /** Name on the server, relative to the site folder. */
  readonly name: string;
  readonly path: string;
  readonly sha256: string;
}

const READ_BACK_ATTEMPTS = 6;
const READ_BACK_PAUSE_MS = 5000;

async function readBack(deps: ServerDeps, url: string, accept: (answer: HttpAnswer) => string | null): Promise<void> {
  let problem = '';
  for (let attempt = 1; attempt <= READ_BACK_ATTEMPTS; attempt += 1) {
    const answer = await deps.http(url);
    const refused = answer.status === 200 ? accept(answer) : `HTTP ${answer.status === 0 ? 'no answer' : answer.status}`;
    if (refused === null) return;
    problem = refused;
    if (attempt < READ_BACK_ATTEMPTS) await (deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(READ_BACK_PAUSE_MS);
  }
  throw new Error(`${url}: ${problem}`);
}

const sameBytes =
  (sha256: string) =>
  (answer: HttpAnswer): string | null => {
    const served = sha256Hex(answer.body);
    return served === sha256 ? null : `serves sha256 ${served}, expected ${sha256}`;
  };

function signedXpiProblem(answer: HttpAnswer, expected: { readonly version: string; readonly geckoId: string; readonly sha256: string }): string | null {
  const bytes = sameBytes(expected.sha256)(answer);
  if (bytes !== null) return bytes;
  try {
    const entries = readZip(answer.body);
    if (!isSigned(entries)) return "carries no Mozilla signature (META-INF/mozilla.rsa and its manifests)";
    const identity = xpiIdentity(entries);
    if (identity.geckoId !== expected.geckoId || identity.version !== expected.version) return `is ${identity.geckoId} ${identity.version}, expected ${expected.geckoId} ${expected.version}`;
    return null;
  } catch (error) {
    return `is not a readable XPI (${error instanceof Error ? error.message : String(error)})`;
  }
}

function servedFeedStep(deps: ServerDeps, expected: () => FeedEntry, describe: string): Step {
  return {
    title: 'Read the feed back',
    show: [`GET ${deps.target.feedUrl} — must serve ${describe}`],
    run: () =>
      readBack(deps, deps.target.feedUrl, (answer) => {
        try {
          const differences = feedDifferences(parseFeed(answer.body.toString('utf8'), deps.target.geckoId), expected());
          return differences.length === 0 ? null : differences.join('; ');
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }
      }),
  };
}

/** Upload a feed file and put it in place by one rename, keeping the one it replaces. */
function swapFeedSteps(deps: ServerDeps, localFeedPath: string, feedText: () => string, describe: string): Step[] {
  const feedDir = `${deps.remoteDir}/${deps.target.feedDir}`;
  const tmp = `${feedDir}/${uploadName(FEED_FILE, deps.nonce)}`;
  const upload = deps.transport.upload(localFeedPath, tmp);
  const replace = (sha256: string): string => replaceScript([{ tmp, final: `${feedDir}/${FEED_FILE}`, sha256, keepPrevious: `${feedDir}/${FEED_PREVIOUS_FILE}` }]);
  // The text is known now for a publication; for a rollback only once the record of the earlier version is read.
  let preview: string | null;
  try {
    preview = feedText();
  } catch {
    preview = null;
  }
  const written = preview === null ? [`write ${localFeedPath}: the feed for ${describe}`] : [`write ${localFeedPath}:`, ...preview.trimEnd().split('\n').map((line) => `  | ${line}`)];
  return [
    {
      title: `Replace the feed: ${describe}`,
      show: [...written, ...renderCommand(upload), ...renderCommand(deps.transport.shell(replace(preview === null ? '<sha256 of that file>' : sha256Hex(preview))))],
      run: async () => {
        const text = feedText();
        mkdirSync(dirname(localFeedPath), { recursive: true });
        writeFileSync(localFeedPath, text);
        await mustRun(deps.exec, upload);
        await mustRun(deps.exec, deps.transport.shell(replace(sha256Hex(text))));
      },
    },
  ];
}

function pagesSteps(deps: ServerDeps, pages: readonly LocalFile[]): Step[] {
  const staged = pages.map((page) => ({ page, tmp: `${deps.remoteDir}/${uploadName(page.name, deps.nonce)}`, final: `${deps.remoteDir}/${page.name}` }));
  const uploads = staged.map(({ page, tmp }) => deps.transport.upload(page.path, tmp));
  const replace = deps.transport.shell(replaceScript(staged.map(({ page, tmp, final }) => ({ tmp, final, sha256: page.sha256 }))));
  return [
    {
      title: `Publish the pages (${pages.length} files)`,
      show: [...uploads.flatMap(renderCommand), ...renderCommand(replace)],
      run: async () => {
        for (const upload of uploads) await mustRun(deps.exec, upload);
        await mustRun(deps.exec, replace);
      },
    },
    {
      title: 'Read the pages back',
      show: pages.map((page) => `GET ${deps.target.siteBase}${page.name} — sha256 ${page.sha256}`),
      run: async () => {
        for (const page of pages) await readBack(deps, `${deps.target.siteBase}${page.name}`, sameBytes(page.sha256));
      },
    },
  ];
}

const mkdirStep = (deps: ServerDeps): Step =>
  commandStep(`Make the folders on ${deps.transport.label}`, deps.exec, deps.transport.shell(mkdirScript([deps.remoteDir, `${deps.remoteDir}/${deps.target.feedDir}`])));

/** What the feed serves now: an entry, or null when no feed is published yet (404). Anything else throws. */
export async function servedFeed(deps: Pick<ServerDeps, 'http' | 'target'>): Promise<FeedEntry | null> {
  const answer = await deps.http(deps.target.feedUrl);
  if (answer.status === 404) return null;
  if (answer.status !== 200) throw new Error(`${deps.target.feedUrl} answered ${answer.status === 0 ? 'nothing' : `HTTP ${answer.status}`}: what is served now is unknown.`);
  return parseFeed(answer.body.toString('utf8'), deps.target.geckoId);
}

export interface PublishInput {
  readonly record: ReleaseRecord;
  /** The signed XPI and the record as they lie in .release/<version>/. */
  readonly signedXpiPath: string;
  readonly recordPath: string;
  readonly recordSha256: string;
  /** Where the published feed is written locally before it goes up. */
  readonly localFeedPath: string;
  readonly pages: readonly LocalFile[];
}

export function publishSteps(deps: ServerDeps, input: PublishInput): Step[] {
  const { record } = input;
  const { target } = deps;
  const feedDir = `${deps.remoteDir}/${target.feedDir}`;
  const entry = feedEntryFor(target, record.version, record.xpi.sha256);
  const xpiName = signedXpiName(record.version);
  const files = [
    { local: input.signedXpiPath, name: xpiName, sha256: record.xpi.sha256 },
    { local: input.recordPath, name: recordName(record.version), sha256: input.recordSha256 },
  ].map((file) => ({ ...file, tmp: `${feedDir}/${uploadName(file.name, deps.nonce)}`, final: `${feedDir}/${file.name}` }));
  const uploads = files.map((file) => deps.transport.upload(file.local, file.tmp));
  const places = files.map((file) => deps.transport.shell(placeImmutableScript(file)));

  return [
    {
      title: 'Check what the feed serves now',
      show: [`GET ${target.feedUrl} — must serve a version lower than ${record.version} (or nothing yet, or exactly this release after an interrupted run)`],
      run: async () => {
        const served = await servedFeed(deps);
        if (served === null) return;
        const order = compareVersions(record.version, served.version);
        if (order < 0) throw new Error(`the feed already serves ${served.version}; ${record.version} would be a downgrade.`);
        if (order === 0 && feedDifferences(served, entry).length > 0) throw new Error(`the feed already serves ${served.version} with another file: a version is never published twice.`);
      },
    },
    mkdirStep(deps),
    {
      title: `Upload ${xpiName} and its record`,
      show: [...uploads.flatMap(renderCommand), ...places.flatMap(renderCommand)],
      run: async () => {
        try {
          for (const upload of uploads) await mustRun(deps.exec, upload);
          for (const place of places) await mustRun(deps.exec, place);
        } catch (error) {
          await deps.exec(deps.transport.shell(cleanupScript(files.map((file) => file.tmp))));
          throw error;
        }
      },
    },
    {
      title: 'Read the XPI back',
      show: [`GET ${entry.updateLink} — sha256 ${record.xpi.sha256}, signed, ${target.geckoId} ${record.version}`],
      run: () => readBack(deps, entry.updateLink, (answer) => signedXpiProblem(answer, { version: record.version, geckoId: target.geckoId, sha256: record.xpi.sha256 })),
    },
    ...swapFeedSteps(deps, input.localFeedPath, () => renderFeed(target.geckoId, entry), `${record.version}, sha256 ${record.xpi.sha256}`),
    servedFeedStep(deps, () => entry, `${record.version} → ${entry.updateLink}`),
    ...pagesSteps(deps, input.pages),
  ];
}

/** The pages alone: no XPI, no feed. */
export function pagesOnlySteps(deps: ServerDeps, pages: readonly LocalFile[]): Step[] {
  return [mkdirStep(deps), ...pagesSteps(deps, pages)];
}

export interface RollbackInput {
  /** The earlier version the feed must point at again. */
  readonly to: string;
  readonly localFeedPath: string;
}

/**
 * Points the feed back at an earlier signed version that is still on the
 * server. It stops the spread of a bad release: browsers that have not updated
 * yet stay on `to`. Browsers that already took the newer version keep it —
 * Firefox does not downgrade; they are fixed by a higher version.
 */
export function rollbackSteps(deps: ServerDeps, input: RollbackInput): Step[] {
  const { target } = deps;
  const recordUrl = `${target.feedBase}${recordName(input.to)}`;
  const xpiUrl = `${target.feedBase}${signedXpiName(input.to)}`;
  let entry: FeedEntry | null = null;
  const expected = (): FeedEntry => {
    if (entry === null) throw new Error('rollback: the record of the earlier version was not read.');
    return entry;
  };
  return [
    {
      title: 'Check what the feed serves now',
      show: [`GET ${target.feedUrl} — must serve a version higher than ${input.to}`],
      run: async () => {
        const served = await servedFeed(deps);
        if (served === null) throw new Error('no feed is published: nothing to roll back.');
        if (compareVersions(served.version, input.to) <= 0) throw new Error(`the feed serves ${served.version}: ${input.to} is not an earlier version.`);
      },
    },
    {
      title: `Read the record and the XPI of ${input.to} from the server`,
      show: [`GET ${recordUrl} — the release record of ${input.to}`, `GET ${xpiUrl} — sha256 as in that record, signed, ${target.geckoId} ${input.to}`],
      run: async () => {
        const answer = await deps.http(recordUrl);
        if (answer.status !== 200) throw new Error(`${recordUrl} answered ${answer.status === 0 ? 'nothing' : `HTTP ${answer.status}`}: without the record of ${input.to} the feed cannot be pointed at it.`);
        const record = parseReleaseRecord(answer.body.toString('utf8'));
        if (record.version !== input.to || record.geckoId !== target.geckoId) throw new Error(`${recordUrl} is the record of ${record.geckoId} ${record.version}, not of ${target.geckoId} ${input.to}.`);
        await readBack(deps, xpiUrl, (xpi) => signedXpiProblem(xpi, { version: input.to, geckoId: target.geckoId, sha256: record.xpi.sha256 }));
        entry = { ...feedEntryFor(target, input.to, record.xpi.sha256), strictMinVersion: record.strictMinVersion };
      },
    },
    ...swapFeedSteps(deps, input.localFeedPath, () => renderFeed(target.geckoId, expected()), `${input.to}, sha256 from its record`),
    servedFeedStep(deps, expected, `${input.to} → ${xpiUrl}`),
  ];
}

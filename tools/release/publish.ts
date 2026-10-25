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
import { NOTES_DIR } from './changes.ts';
import { DEFAULT_HTTP_TIMEOUT_S, ENV, FEED_FILE, FEED_PREVIOUS_FILE, HUB_HEALTH_PATH, LEGACY_ARTIFACT_PREFIX, recordNameOf, signedXpiNames, type ReleaseTarget } from './config.ts';
import { commandStep, mustRun, renderCommand, type Exec, type Print, type Step } from './exec.ts';
import { feedDifferences, feedEntryFor, parseFeed, renderFeed, type FeedEntry } from './feed.ts';
import { evaluateHubCompatibility } from './gate.ts';
import { parseReleaseRecord, type ReleaseRecord } from './records.ts';
import { cleanupScript, KEPT, mkdirScript, placeIfAbsentScript, placeImmutableScript, replaceScript, uploadName, type Transport } from './remote.ts';
import { compareVersions } from './version.ts';
import { isSigned, sha256Hex, xpiIdentity } from './xpi.ts';

export interface HttpAnswer {
  /** 0 — no answer at all. */
  readonly status: number;
  readonly body: Buffer;
}
export type Http = (url: string) => Promise<HttpAnswer>;

/**
 * How long one read may take, from the environment: `CG_RELEASE_HTTP_TIMEOUT_S`
 * seconds, 120 unless set. The signed XPI is read back whole before the feed
 * moves, and over a slow route (a VPN, a foreign route to the server) that
 * takes longer than a minute.
 */
export function httpTimeoutSeconds(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env[ENV.httpTimeout];
  if (raw === undefined || raw === '') return DEFAULT_HTTP_TIMEOUT_S;
  const seconds = Number(raw);
  if (!/^[0-9]+$/.test(raw) || seconds < 5 || seconds > 3600) throw new Error(`${ENV.httpTimeout}=${raw}: whole seconds from 5 to 3600 are expected.`);
  return seconds;
}

/** GET without caches; a network failure or a timeout is status 0, never a throw. */
export function httpWithTimeout(seconds: number): Http {
  return async (url) => {
    try {
      const response = await fetch(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(seconds * 1000) });
      return { status: response.status, body: Buffer.from(await response.arrayBuffer()) };
    } catch {
      return { status: 0, body: Buffer.alloc(0) };
    }
  };
}

export const realHttp: Http = httpWithTimeout(DEFAULT_HTTP_TIMEOUT_S);

export interface ServerDeps {
  readonly exec: Exec;
  readonly http: Http;
  /** For `CG_RELEASE_HTTP_TIMEOUT_S` in messages; the timeout itself is in `http`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly transport: Transport;
  /** Absolute folder on the server served as `target.siteBase`. */
  readonly remoteDir: string;
  readonly target: ReleaseTarget;
  /** Unique per run: the suffix of temporary uploads. */
  readonly nonce: string;
  /** Waits between read-backs of a public address (tests pass a no-op). */
  readonly sleep?: (ms: number) => Promise<void>;
  /** A line of a real run worth the owner's eye (what the server said about a file it kept). */
  readonly say?: Print;
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

/**
 * Runs uploads and the script that puts them in place. Whatever fails on the
 * way, the temporary names of this run do not stay in the served folder.
 */
async function placing(deps: ServerDeps, tmps: readonly string[], run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    await deps.exec(deps.transport.shell(cleanupScript(tmps))).catch(() => undefined);
    throw error;
  }
}

/** The lines of a plan that show that clean-up. */
const onFailure = (deps: ServerDeps, tmps: readonly string[]): string[] => ['if any of the above fails — remove what this run uploaded:', ...renderCommand(deps.transport.shell(cleanupScript(tmps)))];

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
      show: [...written, ...renderCommand(upload), ...renderCommand(deps.transport.shell(replace(preview === null ? '<sha256 of that file>' : sha256Hex(preview)))), ...onFailure(deps, [tmp])],
      run: async () => {
        const text = feedText();
        mkdirSync(dirname(localFeedPath), { recursive: true });
        writeFileSync(localFeedPath, text);
        await placing(deps, [tmp], async () => {
          await mustRun(deps.exec, upload);
          await mustRun(deps.exec, deps.transport.shell(replace(sha256Hex(text))));
        });
      },
    },
  ];
}

function pagesSteps(deps: ServerDeps, pages: readonly LocalFile[]): Step[] {
  const staged = pages.map((page) => ({ page, tmp: `${deps.remoteDir}/${uploadName(page.name, deps.nonce)}`, final: `${deps.remoteDir}/${page.name}` }));
  const uploads = staged.map(({ page, tmp }) => deps.transport.upload(page.path, tmp));
  const replace = deps.transport.shell(replaceScript(staged.map(({ page, tmp, final }) => ({ tmp, final, sha256: page.sha256 }))));
  const tmps = staged.map(({ tmp }) => tmp);
  return [
    {
      title: `Publish the pages (${pages.length} files)`,
      show: [...uploads.flatMap(renderCommand), ...renderCommand(replace), ...onFailure(deps, tmps)],
      run: () =>
        placing(deps, tmps, async () => {
          for (const upload of uploads) await mustRun(deps.exec, upload);
          await mustRun(deps.exec, replace);
        }),
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
  commandStep(`Make the folders on ${deps.transport.label}`, deps.exec, deps.transport.shell(mkdirScript([deps.remoteDir, `${deps.remoteDir}/${deps.target.feedDir}`, `${deps.remoteDir}/${NOTES_DIR}`])));

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
  // The names are the record's: a version signed before the rename goes up under its old ones.
  const entry = feedEntryFor(target, record.version, record.xpi.sha256, record.xpi.file);
  const xpiName = record.xpi.file;
  const files = [
    { local: input.signedXpiPath, name: xpiName, sha256: record.xpi.sha256 },
    { local: input.recordPath, name: recordNameOf(xpiName), sha256: input.recordSha256 },
  ].map((file) => ({ ...file, tmp: `${feedDir}/${uploadName(file.name, deps.nonce)}`, final: `${feedDir}/${file.name}` }));
  const uploads = files.map((file) => deps.transport.upload(file.local, file.tmp));
  const places = files.map((file) => deps.transport.shell(placeImmutableScript(file)));
  const tmps = files.map((file) => file.tmp);
  const healthUrl = `${target.hubOrigin}${HUB_HEALTH_PATH}`;
  const timeout = httpTimeoutSeconds(deps.env ?? {});

  return [
    {
      // The gate asked this before the signing; a version can be published days later, and the hub changes meanwhile.
      title: 'Check that the production hub still takes the SDK of this release',
      show: [`GET ${healthUrl} — healthy, and compatibleClientSdks lists ${record.vendor.sdkContractHash}`],
      run: async () => {
        const answer = await deps.http(healthUrl);
        const verdict = evaluateHubCompatibility({ status: answer.status, body: answer.body.toString('utf8') }, record.vendor.sdkContractHash);
        if (!verdict.ok) throw new Error(`${verdict.detail}. Nothing was uploaded: ${record.version} was signed ${record.signedAt}, and the hub must take its SDK on the day it goes out.`);
      },
    },
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
      show: [...uploads.flatMap(renderCommand), ...places.flatMap(renderCommand), ...onFailure(deps, tmps)],
      run: () =>
        placing(deps, tmps, async () => {
          for (const upload of uploads) await mustRun(deps.exec, upload);
          for (const place of places) await mustRun(deps.exec, place);
        }),
    },
    {
      title: 'Read the XPI back',
      show: [`GET ${entry.updateLink} — sha256 ${record.xpi.sha256}, signed, ${target.geckoId} ${record.version} (up to ${timeout} s a try; ${ENV.httpTimeout} changes that)`],
      run: async () => {
        try {
          await readBack(deps, entry.updateLink, (answer) => signedXpiProblem(answer, { version: record.version, geckoId: target.geckoId, sha256: record.xpi.sha256 }));
        } catch (error) {
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\nThe feed was not touched: it serves what it served before. Running the command again is safe — it finds the uploaded file and goes on from here. ` +
              `If the route to the server is slow (a VPN, a foreign route), give a read more time: ${ENV.httpTimeout}=<seconds> (now ${timeout}).`,
            { cause: error },
          );
        }
      },
    },
    ...swapFeedSteps(deps, input.localFeedPath, () => renderFeed(target.geckoId, entry), `${record.version}, sha256 ${record.xpi.sha256}`),
    servedFeedStep(deps, () => entry, `${record.version} → ${entry.updateLink}`),
    ...pagesSteps(deps, input.pages),
  ];
}

/**
 * The pages alone: no XPI, no feed. `stylesheetIfAbsent` — for pages that go
 * out ahead of a release: the stylesheet is put in place only when the site
 * has none yet (the very first publication). One that is there styles the
 * pages of the released version and is left alone.
 */
export function pagesOnlySteps(deps: ServerDeps, pages: readonly LocalFile[], options: { readonly stylesheetIfAbsent?: LocalFile } = {}): Step[] {
  const sheet = options.stylesheetIfAbsent;
  if (sheet === undefined) return [mkdirStep(deps), ...pagesSteps(deps, pages)];
  const tmp = `${deps.remoteDir}/${uploadName(sheet.name, deps.nonce)}`;
  const final = `${deps.remoteDir}/${sheet.name}`;
  const upload = deps.transport.upload(sheet.path, tmp);
  const place = deps.transport.shell(placeIfAbsentScript({ tmp, final, sha256: sheet.sha256 }));
  return [
    mkdirStep(deps),
    {
      title: `Put ${sheet.name} in place only if the site has none yet`,
      show: [
        `${sheet.name} on the server draws the pages of the released version: one that is there is NOT replaced, even if the tree's differs — it goes out with a release (publish) or with «pages»`,
        ...renderCommand(upload),
        ...renderCommand(place),
        ...onFailure(deps, [tmp]),
      ],
      run: () =>
        placing(deps, [tmp], async () => {
          await mustRun(deps.exec, upload);
          const said = (await mustRun(deps.exec, place)).stdout.trim();
          if (said.startsWith(KEPT)) {
            deps.say?.(`    NOT replaced: ${sheet.name} on the server differs from the one in the tree. The pages below are drawn with the server's until the next release or «pnpm release pages» — look at them.`);
          }
        }),
    },
    ...pagesSteps(deps, pages),
  ];
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
  // A version's files keep the names they were published under: today's, or the old ones of a version signed before
  // the rename. Its record is looked up under both; the XPI is the one the record names.
  const recordUrls = signedXpiNames(input.to).map((file) => `${target.feedBase}${recordNameOf(file)}`);
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
      show: [
        `GET ${recordUrls.join(', on a 404 GET ')} — the release record of ${input.to} (a version signed before the rename keeps ${LEGACY_ARTIFACT_PREFIX}…)`,
        `GET ${target.feedBase}<the XPI that record names> — sha256 as in that record, signed, ${target.geckoId} ${input.to}`,
      ],
      run: async () => {
        let found: { readonly url: string; readonly text: string } | null = null;
        for (const url of recordUrls) {
          const answer = await deps.http(url);
          if (answer.status === 404) continue;
          if (answer.status !== 200) throw new Error(`${url} answered ${answer.status === 0 ? 'nothing' : `HTTP ${answer.status}`}: without the record of ${input.to} the feed cannot be pointed at it.`);
          found = { url, text: answer.body.toString('utf8') };
          break;
        }
        if (found === null) throw new Error(`no record of ${input.to} on the server (${recordUrls.join(' and ')} answered 404): without it the feed cannot be pointed at it.`);
        const record = parseReleaseRecord(found.text);
        if (record.version !== input.to || record.geckoId !== target.geckoId) throw new Error(`${found.url} is the record of ${record.geckoId} ${record.version}, not of ${target.geckoId} ${input.to}.`);
        if (`${target.feedBase}${recordNameOf(record.xpi.file)}` !== found.url) throw new Error(`${found.url} names the XPI ${record.xpi.file}, which is not the file next to it.`);
        const xpiUrl = `${target.feedBase}${record.xpi.file}`;
        await readBack(deps, xpiUrl, (xpi) => signedXpiProblem(xpi, { version: input.to, geckoId: target.geckoId, sha256: record.xpi.sha256 }));
        entry = { ...feedEntryFor(target, input.to, record.xpi.sha256, record.xpi.file), strictMinVersion: record.strictMinVersion };
      },
    },
    ...swapFeedSteps(deps, input.localFeedPath, () => renderFeed(target.geckoId, expected()), `${input.to}, sha256 from its record`),
    servedFeedStep(deps, expected, `${input.to} → the XPI its record names`),
  ];
}

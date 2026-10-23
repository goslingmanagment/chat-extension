// WebdriverIO 9 + geckodriver (architecture.md §12 п. 4): the current Firefox
// without a window, the TEST build (CG_TEST_HOSTS=1) installed as a temporary
// add-on, our synthetic stand and the fake hub (src/fake-hub; its origin in
// CG_FAKE_HUB_ORIGIN, e2e/support/fake-hub.ts) on 127.0.0.1. No network
// beyond loopback: the profile sends every non-loopback request to the egress
// sink, which records it and drops it, and keeps Firefox's own services quiet
// (src/stand/egress-sink.ts); specs add the trap (support/network-trap.ts),
// which fails on any such attempt seen in the BiDi log (pages, content
// scripts) or in the sink (the background too).
//
// FIREFOX_BIN overrides the browser binary (default: the macOS app path, or
// whatever geckodriver finds on PATH elsewhere).
//
// CG_SEE_LIVE=1 (`pnpm see … --live`, e2e/see/live.ts) is the one run that leaves loopback: no stand and no egress
// sink, the real fansly.com in a durable profile (CG_SEE_LIVE_PROFILE, default ~/.cache/chatgoose/fansly-live/<this
// worktree's folder>: the test model's sign-in stays there, and agents in two worktrees do not lock each other out of
// one profile), the fake hub as ever.
//
// CG_E2E_SHARD=<k>/<n> runs part k of n of the spec files (src/e2e-shards.ts:
// the CI job runs the parts side by side); unset, every spec file runs. The
// launcher prints a `cg-e2e-time:` line for each spec file a worker finished —
// what the parts are weighed by.

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routeSchemas } from '@kernel/sdk';

import { parseShard, shardSpecs, SPECS_DIR, TIME_LINE } from '../src/e2e-shards';
import { startFakeHub, type FakeHubServer } from '../src/fake-hub/server';
import { startStandServer, type StandServer } from '../src/stand-server';
import { egressProxyPrefs, startEgressSink, type EgressSink } from '../src/stand/egress-sink';
import { FANSLY_FIXTURE_BUILD_DIR, FIXTURE_BUILD_DIR } from '../src/stand/paths';
import { E2E_ADDON_UUID, E2E_RELEASE_ADDON_UUID, RELEASE_GECKO_ID, TEST_GECKO_ID } from './support/constants';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const logsDir = `${repoRoot}.cache/wdio`;
mkdirSync(logsDir, { recursive: true });
/** Where a file the extension saves goes: a `pnpm see` run's folder, or the e2e logs. */
const downloadsDir = `${process.env['CG_SEE_OUT'] ?? logsDir}/downloads`;
mkdirSync(downloadsDir, { recursive: true });

const macFirefox = '/Applications/Firefox.app/Contents/MacOS/firefox';
const firefoxBinary = process.env['FIREFOX_BIN'] ?? (existsSync(macFirefox) ? macFirefox : undefined);

// A release Firefox honours `services.settings.server` (egress prefs) only
// with this in its environment, else remote settings keep calling Mozilla.
// Firefox inherits it through the worker and geckodriver.
process.env['MOZ_REMOTE_SETTINGS_DEVTOOLS'] = '1';

const live = process.env['CG_SEE_LIVE'] === '1';
const liveProfile = process.env['CG_SEE_LIVE_PROFILE'] || join(homedir(), '.cache/chatgoose/fansly-live', basename(repoRoot));
if (live) mkdirSync(liveProfile, { recursive: true });

let stand: StandServer | null = null;
let egress: EgressSink | null = null;
let hub: FakeHubServer | null = null;

/** The part of the suite this run is (CG_E2E_SHARD), or null for the whole suite; a value that names no part throws. */
const shardText = process.env['CG_E2E_SHARD'] ?? '';
const shard = shardText === '' ? null : parseShard(shardText);
const shardFiles = shard === null ? null : shardSpecs(shard);

/** When each worker started, by its id: the launcher prints how long its spec file took. */
const workerStarts = new Map<string, number>();
/** Spec files that failed an attempt, by name: one that passes on its retry is reported as flaky at the end. */
const failedOnce = new Set<string>();
const passedOnRetry: string[] = [];
const failedForGood: string[] = [];

/**
 * Fixed ports for the run, from CG_E2E_PORTS (JSON: `fansly`, `fanslyApi`, `fanslySocket`, `hub`; any may be left
 * out): only for a subject that has the stand's addresses compiled in — the old Fansly extension's test build of the
 * perf baseline (e2e/perf/fansly/ports.ts). Without it every port is a free one.
 */
function fixedPorts(): { fansly?: number; fanslyApi?: number; fanslySocket?: number; hub?: number } {
  const text = process.env['CG_E2E_PORTS'];
  if (text === undefined || text === '') return {};
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const ports: Record<string, number> = {};
  for (const key of ['fansly', 'fanslyApi', 'fanslySocket', 'hub']) {
    const value = parsed[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > 65_535) throw new Error(`CG_E2E_PORTS: ${key} is not a port (${JSON.stringify(value)})`);
    ports[key] = value as number;
  }
  return ports;
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  // Not the perf probes (e2e/perf, P16a among them): `pnpm perf` names them
  // with --spec, and CI runs that every night and on demand
  // (.github/workflows/perf.yml), not on a PR or a push.
  specs: shardFiles === null ? ['./specs/**/*.e2e.ts'] : shardFiles.map((name) => `./specs/${name}`),
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'firefox',
      // geckodriver --allow-system-access (passed through as a flag; not in the
      // package's option types; geckodriver then starts Firefox with
      // -remote-allow-system-access): without it the remote agent refuses to
      // open moz-extension:// pages, which release-xpi.e2e.ts needs.
      // Throwaway headless profile only.
      //
      // geckodriver --host=127.0.0.1: the driver's own default, but the
      // `geckodriver` package starts it with 0.0.0.0 unless a host is given,
      // and the WebDriver endpoint of every spec then listens on every
      // interface of the machine for the length of a native run. The driver's
      // Host and Origin checks keep web pages out (DNS rebinding); they are
      // not authentication: any machine on the network can create a session
      // there, and the request names the binary to start
      // (moz:firefoxOptions.binary). WebdriverIO reaches the driver all the
      // same: it waits for the port and sends its requests to `localhost`,
      // IPv4 first even where the system resolves that name to ::1 first, and
      // the driver has never listened on IPv6. The second browser of a spec
      // (support/second.ts) starts its driver from these same capabilities.
      'wdio:geckodriverOptions': { allowSystemAccess: true, host: '127.0.0.1' } as WebdriverIO.GeckodriverOptions,
      'moz:firefoxOptions': {
        ...(firefoxBinary ? { binary: firefoxBinary } : {}),
        args: live ? ['-headless', '-profile', liveProfile] : ['-headless'],
        prefs: {
          // Fixed moz-extension:// UUIDs so the e2e can open our own pages.
          'extensions.webextensions.uuids': JSON.stringify({ [TEST_GECKO_ID]: E2E_ADDON_UUID, [RELEASE_GECKO_ID]: E2E_RELEASE_ADDON_UUID }),
          // Full-precision performance.now() (the default rounds to 1 ms) for
          // the spike timings (§11); content scripts get the same clock.
          'privacy.reduceTimerPrecision': false,
          // No first-run prompt; the rest of the quiet profile comes with the egress prefs.
          'browser.shell.checkDefaultBrowser': false,
          // The extension's notification tones are really played by the event page's AudioContext: the
          // machine that runs the e2e stays silent, the decisions are read from the diagnostics.
          'media.volume_scale': '0.0',
          // No slow-script killing: on a loaded runner a script of the page, of the stand or of our content scripts can
          // run past Firefox's limits (10 s, extensions 5 s) — the PC's geckodriver logs show such kills — and a killed
          // script of ours leaves the spec waiting for a state that never comes. Marionette zeroes the first already.
          'dom.max_script_run_time': 0,
          'dom.max_ext_content_script_run_time': 0,
          // «Скачать лог» (2026-10-21): a file the extension saves lands in the run's own folder, never in the
          // machine's Downloads, and without a dialog.
          'browser.download.folderList': 2,
          'browser.download.dir': downloadsDir,
          'browser.download.useDownloadDir': true,
          'browser.download.always_ask_before_handling_new_types': false,
          'browser.download.alwaysOpenPanel': false,
          'browser.helperApps.neverAsk.saveToDisk': 'text/plain,application/json',
          // --live: no service workers. Fansly's own (Angular's) fetches whatever a page asks without `ngsw-bypass`
          // itself, and BiDi does not see a worker's requests: the journal of writes (e2e/see/live.ts) would miss
          // them. Measured 2026-10-24 with a probe POST.
          ...(live ? { 'dom.serviceWorkers.enabled': false } : {}),
        },
      },
    },
  ],
  logLevel: 'warn',
  outputDir: logsDir,
  bail: 0,
  waitforTimeout: 15_000,
  // A WebDriver command that gets no answer fails in 60 s with its own name — not as the test's 120 s timeout.
  connectionRetryTimeout: 60_000,
  connectionRetryCount: 1,
  // The safety net, not the fix: a spec file that fails runs once more, after the rest of the part (deferred). Every
  // retry is printed (`cg-e2e-retry:`) and one that passes on it is a GitHub warning at the end of the run, so a flaky
  // spec stays visible; the cause is fixed in the spec.
  // Not for `pnpm see` (CG_SEE_OUT): a run there asserts nothing to be flaky about, and a retry would start the
  // scenario — or a held session, with its sign-in — once more.
  specFileRetries: process.env['CG_SEE_OUT'] === undefined ? 1 : 0,
  specFileRetriesDeferred: true,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 120_000 },
  onPrepare: async (_config, capabilities) => {
    if (live) {
      hub = await startFakeHub({ streamBodySchema: routeSchemas.aiFeatureStream.body, routeSchemas });
      process.env['CG_FAKE_HUB_ORIGIN'] = hub.origin;
      return;
    }
    if (shard !== null && shardFiles !== null) {
      console.log(`e2e: part ${shard.part}/${shard.of} of the suite, ${shardFiles.length} spec file(s): ${shardFiles.join(' ')}`);
    }
    if (!existsSync(join(FIXTURE_BUILD_DIR, 'index.html'))) {
      throw new Error('the ChatSpace fixture is not built: run `pnpm --filter @cg/testing build:stand` (pnpm e2e does it)');
    }
    if (!existsSync(join(FANSLY_FIXTURE_BUILD_DIR, 'index.html'))) {
      throw new Error('the Fansly stand is not built: run `pnpm --filter @cg/testing build:stand` (pnpm e2e does it)');
    }
    const ports = fixedPorts();
    egress = await startEgressSink();
    stand = await startStandServer({
      egress,
      ...(ports.fansly === undefined ? {} : { fanslyPort: ports.fansly }),
      ...(ports.fanslyApi === undefined ? {} : { fanslyApiPort: ports.fanslyApi }),
      ...(ports.fanslySocket === undefined ? {} : { fanslySocketPort: ports.fanslySocket }),
    });
    process.env['CG_STAND_ORIGIN'] = stand.origin;
    process.env['CG_STAND_API_ORIGIN'] = stand.apiOrigin;
    // The Fansly stand: its own loopback name (http://localhost:<port>), never ChatSpace's 127.0.0.1.
    process.env['CG_FANSLY_STAND_ORIGIN'] = stand.fansly.origin;
    // The fake Fansly the page asks (R20 P6b): its API and its socket, the same loopback name on ports of their own.
    process.env['CG_FANSLY_API_ORIGIN'] = stand.fansly.fake.apiOrigin;
    process.env['CG_FANSLY_SOCKET_URL'] = stand.fansly.fake.socketUrl;
    // Its proxy (R20 P9c): what a container's proxy is to the model's tab — the relay suite routes the tab through it.
    process.env['CG_FANSLY_PROXY'] = stand.fansly.fake.proxy.host;
    // The fake hub: system clock, the pilot preset (switched on page by page, the owner's `"*"` row empty); specs
    // reset and script it through its control API. Every AI body is checked by the hub's own body schema, every
    // client/* request and model answer by the hub's own route schemas (the vendored SDK's): a request the real
    // hub would answer 400 to fails here, not on the first live check.
    hub = await startFakeHub({ streamBodySchema: routeSchemas.aiFeatureStream.body, routeSchemas, ...(ports.hub === undefined ? {} : { port: ports.hub }) });
    process.env['CG_FAKE_HUB_ORIGIN'] = hub.origin;
    // The sink's port is known only now; workers start with these capabilities.
    for (const capability of capabilities as WebdriverIO.Capabilities[]) {
      const firefox = capability['moz:firefoxOptions'];
      if (firefox !== undefined) firefox.prefs = { ...firefox.prefs, ...egressProxyPrefs(egress.port) };
    }
  },
  onWorkerStart: (cid) => {
    workerStarts.set(cid, performance.now());
  },
  onWorkerEnd: (cid, exitCode, specs, retries) => {
    const started = workerStarts.get(cid);
    const seconds = started === undefined ? '?' : ((performance.now() - started) / 1000).toFixed(1);
    for (const spec of specs) {
      const path = spec.startsWith('file://') ? fileURLToPath(spec) : spec;
      const relativeName = relative(SPECS_DIR, path).split('\\').join('/');
      const name = relativeName.startsWith('..') ? basename(path) : relativeName;
      console.log(`${TIME_LINE} ${name} ${seconds} ${exitCode === 0 ? 'passed' : 'failed'}`);
      if (exitCode !== 0 && retries > 0) {
        failedOnce.add(name);
        console.log(`cg-e2e-retry: ${name} failed, running it once more`);
      } else if (exitCode === 0 && failedOnce.has(name)) {
        passedOnRetry.push(name);
      } else if (exitCode !== 0) {
        failedForGood.push(name);
      }
    }
  },
  onComplete: async () => {
    for (const name of passedOnRetry) console.log(`::warning title=e2e flaky::${name} failed once and passed on its retry — fix its cause`);
    for (const name of failedForGood) console.log(`::error title=e2e failed::${name} failed${failedOnce.has(name) ? ' twice' : ''}`);
    await hub?.close();
    await stand?.close();
    await egress?.close();
  },
};

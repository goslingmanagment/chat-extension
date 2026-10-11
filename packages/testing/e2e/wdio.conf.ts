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

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routeSchemas } from '@kernel/sdk';

import { startFakeHub, type FakeHubServer } from '../src/fake-hub/server';
import { startStandServer, type StandServer } from '../src/stand-server';
import { egressProxyPrefs, startEgressSink, type EgressSink } from '../src/stand/egress-sink';
import { FIXTURE_BUILD_DIR } from '../src/stand/paths';
import { E2E_ADDON_UUID, E2E_RELEASE_ADDON_UUID, RELEASE_GECKO_ID, TEST_GECKO_ID } from './support/constants';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const logsDir = `${repoRoot}.cache/wdio`;
mkdirSync(logsDir, { recursive: true });

const macFirefox = '/Applications/Firefox.app/Contents/MacOS/firefox';
const firefoxBinary = process.env['FIREFOX_BIN'] ?? (existsSync(macFirefox) ? macFirefox : undefined);

// A release Firefox honours `services.settings.server` (egress prefs) only
// with this in its environment, else remote settings keep calling Mozilla.
// Firefox inherits it through the worker and geckodriver.
process.env['MOZ_REMOTE_SETTINGS_DEVTOOLS'] = '1';

let stand: StandServer | null = null;
let egress: EgressSink | null = null;
let hub: FakeHubServer | null = null;

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.ts'],
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
        args: ['-headless'],
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
        },
      },
    },
  ],
  logLevel: 'warn',
  outputDir: logsDir,
  bail: 0,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: { ui: 'bdd', timeout: 120_000 },
  onPrepare: async (_config, capabilities) => {
    if (!existsSync(join(FIXTURE_BUILD_DIR, 'index.html'))) {
      throw new Error('the ChatSpace fixture is not built: run `pnpm --filter @cg/testing build:stand` (pnpm e2e does it)');
    }
    egress = await startEgressSink();
    stand = await startStandServer({ egress });
    process.env['CG_STAND_ORIGIN'] = stand.origin;
    process.env['CG_STAND_API_ORIGIN'] = stand.apiOrigin;
    // The fake hub: system clock, the pilot preset (switched on page by page, the owner's `"*"` row empty); specs
    // reset and script it through its control API. Every AI body is checked by the hub's own body schema, every
    // client/* request and model answer by the hub's own route schemas (the vendored SDK's): a request the real
    // hub would answer 400 to fails here, not on the first live check.
    hub = await startFakeHub({ streamBodySchema: routeSchemas.aiFeatureStream.body, routeSchemas });
    process.env['CG_FAKE_HUB_ORIGIN'] = hub.origin;
    // The sink's port is known only now; workers start with these capabilities.
    for (const capability of capabilities as WebdriverIO.Capabilities[]) {
      const firefox = capability['moz:firefoxOptions'];
      if (firefox !== undefined) firefox.prefs = { ...firefox.prefs, ...egressProxyPrefs(egress.port) };
    }
  },
  onComplete: async () => {
    await hub?.close();
    await stand?.close();
    await egress?.close();
  },
};

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
// A run that could not be prepared does not start: whatever onPrepare fails
// on ends it there with one message — first of all a Firefox this process
// cannot start at all (src/stand/firefox-access.ts: the stock Firefox of a Mac
// from the Claude desktop agent shell; the run for that shell is
// tools/ci/e2e-docker-local.sh). And a worker whose session could not be
// created does not leave its geckodriver behind
// (src/stand/leftover-drivers.ts).

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { routeSchemas } from '@kernel/sdk';
import { SevereServiceError } from 'webdriverio';

import { startFakeHub, type FakeHubServer } from '../src/fake-hub/server';
import { startStandServer, type StandServer } from '../src/stand-server';
import { egressProxyPrefs, startEgressSink, type EgressSink } from '../src/stand/egress-sink';
import { firefoxStartRefusal, MAC_FIREFOX_BINARY } from '../src/stand/firefox-access';
import { endLeftoverDrivers } from '../src/stand/leftover-drivers';
import { FIXTURE_BUILD_DIR } from '../src/stand/paths';
import { E2E_ADDON_UUID, E2E_RELEASE_ADDON_UUID, RELEASE_GECKO_ID, TEST_GECKO_ID } from './support/constants';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const logsDir = `${repoRoot}.cache/wdio`;
mkdirSync(logsDir, { recursive: true });

const firefoxBinary = process.env['FIREFOX_BIN'] ?? (existsSync(MAC_FIREFOX_BINARY) ? MAC_FIREFOX_BINARY : undefined);

// A release Firefox honours `services.settings.server` (egress prefs) only
// with this in its environment, else remote settings keep calling Mozilla.
// Firefox inherits it through the worker and geckodriver.
process.env['MOZ_REMOTE_SETTINGS_DEVTOOLS'] = '1';

let stand: StandServer | null = null;
let egress: EgressSink | null = null;
let hub: FakeHubServer | null = null;

/**
 * What a run needs before its first worker starts: a Firefox that can start at all, the built fixture, and the
 * stand, the fake hub and the egress sink listening — the sink in the prefs of every session.
 */
async function prepare(capabilities: WebdriverIO.Capabilities[]): Promise<void> {
  const refusal = firefoxStartRefusal(firefoxBinary);
  if (refusal !== null) throw new SevereServiceError(refusal);
  if (!existsSync(join(FIXTURE_BUILD_DIR, 'index.html'))) {
    throw new SevereServiceError('the ChatSpace fixture is not built: run `pnpm --filter @cg/testing build:stand` (pnpm e2e does it)');
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
  for (const capability of capabilities) {
    const firefox = capability['moz:firefoxOptions'];
    if (firefox !== undefined) firefox.prefs = { ...firefox.prefs, ...egressProxyPrefs(egress.port) };
  }
}

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
      'wdio:geckodriverOptions': { allowSystemAccess: true } as WebdriverIO.GeckodriverOptions,
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
  // WebdriverIO only logs what this hook throws and starts the workers all the same: every spec would then fail for
  // itself — without the stand, the fake hub and the egress proxy. Only a SevereServiceError ends the run here.
  onPrepare: async (_config, capabilities) => {
    try {
      await prepare(capabilities as WebdriverIO.Capabilities[]);
    } catch (error) {
      throw error instanceof SevereServiceError ? error : new SevereServiceError(error instanceof Error ? (error.stack ?? error.message) : String(error));
    }
  },
  onComplete: async () => {
    await hub?.close();
    await stand?.close();
    await egress?.close();
  },
  // In the worker of a spec, before its session: a geckodriver the worker still has when it exits ends with it.
  beforeSession: () => {
    process.once('exit', () => {
      endLeftoverDrivers();
    });
  },
};

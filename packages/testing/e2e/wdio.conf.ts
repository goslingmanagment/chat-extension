// WebdriverIO 9 + geckodriver (architecture.md §12 п. 4): the current Firefox
// without a window, the TEST build (CG_TEST_HOSTS=1) installed as a temporary
// add-on, our synthetic stand on 127.0.0.1. No network beyond loopback.
//
// FIREFOX_BIN overrides the browser binary (default: the macOS app path, or
// whatever geckodriver finds on PATH elsewhere).

import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { startStandServer, type StandServer } from '../src/stand-server';
import { E2E_ADDON_UUID, TEST_GECKO_ID } from './support/constants';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const logsDir = `${repoRoot}.cache/wdio`;
mkdirSync(logsDir, { recursive: true });

const macFirefox = '/Applications/Firefox.app/Contents/MacOS/firefox';
const firefoxBinary = process.env['FIREFOX_BIN'] ?? (existsSync(macFirefox) ? macFirefox : undefined);

let stand: StandServer | null = null;

export const config: WebdriverIO.Config = {
  runner: 'local',
  specs: ['./specs/**/*.e2e.ts'],
  maxInstances: 1,
  capabilities: [
    {
      browserName: 'firefox',
      'moz:firefoxOptions': {
        ...(firefoxBinary ? { binary: firefoxBinary } : {}),
        args: ['-headless'],
        prefs: {
          // A fixed moz-extension:// UUID so the e2e can open our own pages.
          'extensions.webextensions.uuids': JSON.stringify({ [TEST_GECKO_ID]: E2E_ADDON_UUID }),
          // Keep the profile quiet: no updates, telemetry or first-run pages.
          'app.update.enabled': false,
          'browser.shell.checkDefaultBrowser': false,
          'datareporting.policy.dataSubmissionEnabled': false,
          'toolkit.telemetry.enabled': false,
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
  onPrepare: async () => {
    stand = await startStandServer();
    process.env['CG_STAND_ORIGIN'] = stand.origin;
  },
  onComplete: async () => {
    await stand?.close();
  },
};

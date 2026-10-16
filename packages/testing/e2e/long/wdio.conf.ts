import { fileURLToPath } from 'node:url';

import { longRunMinutes } from '../../src/long-run/report';
import { config as normal } from '../wdio.conf';

if (process.env['CG_E2E_SHARD']) throw new Error('long-run is manual, never an e2e shard');
if (process.platform === 'darwin') throw new Error('long-run belongs on the owner’s PC: dispatch long-run.yml, never run Firefox for eight hours on the Mac');
const minutes = longRunMinutes(process.env['CG_LONG_RUN_MINUTES']);

export const config: WebdriverIO.Config = {
  ...normal,
  specs: [fileURLToPath(new URL('./long-run.e2e.ts', import.meta.url))],
  // One browser worker; it explicitly owns the separate baseline Firefox too.
  maxInstances: 1,
  specFileRetries: 0,
  mochaOpts: { ui: 'bdd', timeout: (minutes + 30) * 60_000 },
};

// `pnpm release <command>` — the entry point: cli.ts with the real world in
// its hands (this checkout, real programs, the network, the environment).
// What the commands are and do: cli.ts; the runbook: docs/release.md.

import { randomBytes } from 'node:crypto';

import { runCli } from './cli.ts';
import { REPO_ROOT } from './config.ts';
import { realExec } from './exec.ts';
import { httpTimeoutSeconds, httpWithTimeout, type Http } from './publish.ts';

let http: Http;
try {
  http = httpWithTimeout(httpTimeoutSeconds(process.env));
} catch (error) {
  console.error(`release: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

process.exit(
  await runCli(process.argv.slice(2), {
    root: REPO_ROOT,
    exec: realExec,
    http,
    fetchImpl: fetch,
    env: process.env,
    print: (line) => console.log(line),
    printError: (line) => console.error(line),
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    nonce: () => `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
  }),
);

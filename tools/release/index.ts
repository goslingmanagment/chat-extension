// `pnpm release …` — the entry point: cli.ts with the real world in its hands
// (this checkout, real programs, the network, the environment and the owner's
// env files). What the commands are and do: cli.ts; the runbook: docs/release.md.

import { randomBytes } from 'node:crypto';
import { homedir, hostname, userInfo } from 'node:os';

import { runCli } from './cli.ts';
import { REPO_ROOT } from './config.ts';
import { envFiles, loadReleaseEnv } from './env.ts';
import { realExec } from './exec.ts';
import { httpTimeoutSeconds, httpWithTimeout, type Http } from './publish.ts';

// The keys a child needs (web-ext) are passed from this process's environment, so what the files give goes there.
const { env, loaded } = loadReleaseEnv(process.env, envFiles(homedir()));
Object.assign(process.env, env);
for (const file of new Set(loaded.map((entry) => entry.file))) {
  console.log(`env: ${loaded.filter((entry) => entry.file === file).map((entry) => entry.name).join(', ')} from ${file}`);
}

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
    who: `${userInfo().username}@${hostname().replace(/\.local$/, '')}/pid${process.pid}`,
  }),
);

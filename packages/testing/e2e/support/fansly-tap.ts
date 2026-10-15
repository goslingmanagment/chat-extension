// Fansly's MAIN world on its stand, with an isolated consumer the spec drives
// (R20 P7a; docs/project-unite/architecture.md §5, §6). The MAIN script is
// the TEST build's own `fansly-main.js` — the entry point with the stand's
// socket and API, as the extension registers it — put into the page's realm by
// a WebDriver BiDi preload script, which runs before any script of the page,
// as a document_start content script does; or, for the late-install case,
// evaluated in the page once it is up. The consumer
// (e2e/harness/fansly-tap-harness.ts) runs in a BiDi sandbox realm, connected
// to that MAIN: `raw` — the shared client over Fansly's schemas, a consumer
// of MAIN's stream the spec drives (a blocked one when it says so; P7a);
// `port` — Fansly's own isolated start with its HostPort, as the extension
// starts it (P7c). No extension is installed.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { browser } from '@wdio/globals';
import { build } from 'esbuild';

const harnessDir = fileURLToPath(new URL('../harness/', import.meta.url));
const testBuild = fileURLToPath(new URL('../../../../apps/extension/.output/firefox-mv3-test/', import.meta.url));
/** The sandbox realm of the consumer. */
export const FANSLY_TAP_SANDBOX = 'cg-fansly-tap';

/** The test build's MAIN script, as the background registers it (P9a) and suite-fansly-site runs it. */
export function fanslyMainScript(): string {
  const file = `${testBuild}fansly-main.js`;
  if (!existsSync(file)) throw new Error('the test build has no fansly-main.js: run `pnpm build:test` first');
  return readFileSync(file, 'utf8');
}

async function consumerBundle(): Promise<string> {
  const result = await build({
    entryPoints: [`${harnessDir}fansly-tap-harness.ts`],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'firefox142',
    write: false,
    logLevel: 'error',
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error('the Fansly tap harness produced no output');
  return output.text;
}

export interface FanslyTapHarness {
  remove(): Promise<void>;
}

/**
 * Every document loaded from now on gets the consumer — and, unless `main: 'late'`, Fansly's MAIN at its first
 * moment. With `late` the spec injects MAIN itself (`injectFanslyMain`) when the page is up.
 */
export async function installFanslyTapHarness(options: { readonly main: 'start' | 'late'; readonly consumer?: 'raw' | 'port'; readonly legacy?: 'before' | 'after' | 'ready' } = { main: 'start' }): Promise<FanslyTapHarness> {
  const wrap = (code: string): string => `() => {\n${code}\n}`;
  const scripts: Array<{ readonly script: string }> = [];
  const old = "Object.defineProperty(window, Symbol.for('chatgoose.socketTap'), { value: true });";
  if (options.main === 'start') scripts.push(await browser.scriptAddPreloadScript({ functionDeclaration: wrap((options.legacy === 'before' ? old : '') + fanslyMainScript() + (options.legacy === 'after' ? old : options.legacy === 'ready' ? `document.addEventListener('DOMContentLoaded', () => { ${old} }, { once: true });` : '')) }));
  const choice = `globalThis.__cgFanslyTapConsumer = ${JSON.stringify(options.consumer ?? 'raw')};\n`;
  scripts.push(await browser.scriptAddPreloadScript({ functionDeclaration: wrap(choice + (await consumerBundle())), sandbox: FANSLY_TAP_SANDBOX }));
  return {
    remove: async () => {
      for (const script of scripts) await browser.scriptRemovePreloadScript({ script: script.script });
    },
  };
}

/** Evaluates Fansly's MAIN in the page's own realm of the current document, after the page began: a late install. */
export async function injectFanslyMain(): Promise<void> {
  const context = await browser.getWindowHandle();
  const result = await browser.scriptCallFunction({ functionDeclaration: `() => {\n${fanslyMainScript()}\n}`, target: { context }, awaitPromise: false });
  if (result.type !== 'success') throw new Error(`late MAIN: ${JSON.stringify(result.exceptionDetails)}`);
}

/**
 * Starts the consumer in the sandbox of the current document after the page began — the isolated script of an install
 * or an update under an open tab (R20 P7d). With `injectFanslyMain` before it: a late start of both worlds.
 */
export async function injectFanslyConsumer(consumer: 'raw' | 'port' = 'port'): Promise<void> {
  const context = await browser.getWindowHandle();
  const code = `globalThis.__cgFanslyTapConsumer = ${JSON.stringify(consumer)};\n${await consumerBundle()}`;
  const result = await browser.scriptCallFunction({ functionDeclaration: `() => {\n${code}\n}`, target: { context, sandbox: FANSLY_TAP_SANDBOX }, awaitPromise: false });
  if (result.type !== 'success') throw new Error(`late consumer: ${JSON.stringify(result.exceptionDetails)}`);
}

/** Calls the consumer's `method` in the sandbox of the current document; JSON in and out. */
export async function tap<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  const context = await browser.getWindowHandle();
  const result = await browser.scriptCallFunction({
    functionDeclaration: '(method, args) => globalThis.__cgFanslyTap.call(method, args)',
    target: { context, sandbox: FANSLY_TAP_SANDBOX },
    awaitPromise: true,
    arguments: [
      { type: 'string', value: method },
      { type: 'string', value: JSON.stringify(args) },
    ],
  });
  if (result.type !== 'success') throw new Error(`fansly tap ${method}: ${JSON.stringify(result.exceptionDetails)}`);
  const value = result.result;
  if (value.type !== 'string') throw new Error(`fansly tap ${method}: unexpected result ${JSON.stringify(value)}`);
  return JSON.parse(value.value) as T;
}

/** Waits until the consumer is connected to MAIN and has asked its first `fx.state`. */
export async function waitForFanslyTap(timeout = 15_000): Promise<void> {
  let last: unknown = null;
  try {
    await browser.waitUntil(
      async () => {
        last = await tap<{ connected: boolean; started: boolean; failure: string | null }>('ready');
        const ready = last as { connected: boolean; started: boolean };
        return ready.connected && ready.started;
      },
      { timeout, interval: 50 },
    );
  } catch {
    throw new Error(`the Fansly tap harness did not connect in ${timeout} ms: ${JSON.stringify(last)}`);
  }
}

export async function waitForTap<T>(read: () => Promise<T>, predicate: (value: T) => boolean, message: string, timeout = 10_000): Promise<T> {
  let last: T | undefined;
  try {
    await browser.waitUntil(
      async () => {
        last = await read();
        return predicate(last);
      },
      { timeout, interval: 50 },
    );
  } catch {
    throw new Error(`${message}: not reached in ${timeout} ms; last: ${JSON.stringify(last)}`);
  }
  return last as T;
}

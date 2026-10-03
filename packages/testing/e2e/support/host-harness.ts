// The R09 adapter on the stand without the extension (architecture.md §12 п. 4,
// docs/protocols/README.md): the MAIN bundle (boot + runtime) goes into the
// page's own realm and the isolated bundle into a WebDriver BiDi sandbox realm
// — both through preload scripts, which run before any page script, the way
// document_start content scripts do. Firefox gives a BiDi sandbox Xray access
// to the DOM, like an isolated-world content script: the handshake, the
// MessagePort, closed shadow roots and our DOM work the same.
//
// The bundles are built here with esbuild from the package sources, so the
// e2e always runs the code under test. `harness(method, ...args)` calls the
// isolated side's test API (e2e/harness/iso-harness.ts) inside the sandbox.

import { fileURLToPath } from 'node:url';

import { browser } from '@wdio/globals';
import { build } from 'esbuild';

const harnessDir = fileURLToPath(new URL('../harness/', import.meta.url));
/** The sandbox realm of our isolated half. */
export const ISO_SANDBOX = 'cg-r09-isolated';

async function bundle(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [`${harnessDir}${entry}`],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'firefox142',
    write: false,
    logLevel: 'error',
    define: { __CG_TEST_HOSTS__: 'true' },
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error(`host harness: ${entry} produced no output`);
  return output.text;
}

export interface InstalledHarness {
  readonly mainBytes: number;
  readonly isolatedBytes: number;
  readonly tapBytes: number;
  remove(): Promise<void>;
}

export interface HarnessOptions {
  /**
   * The tap script too (architecture.md §6.8), as the background registers it
   * while the `wsTap` flag is on: `first` — before the bridge's script,
   * `last` — after it (both at document_start; their order is not ours to choose).
   */
  readonly tap?: 'first' | 'last';
}

/** Adds the preload scripts; every document loaded afterwards gets the adapter. */
export async function installHostHarness(options: HarnessOptions = {}): Promise<InstalledHarness> {
  const [main, isolated, tap] = await Promise.all([bundle('main-harness.ts'), bundle('iso-harness.ts'), options.tap ? bundle('tap-harness.ts') : Promise.resolve('')]);
  const wrap = (code: string): string => `() => {\n${code}\n}`;
  // The MAIN bundle's evaluation at document_start (boot + runtime), beyond the boot's own installMs: read by the spec.
  const timed = (code: string): string => `() => {\nconst cgStarted = performance.now();\n${code}\nObject.defineProperty(window, '__cgMainEvalMs', { value: performance.now() - cgStarted, configurable: true });\n}`;
  // Preload scripts run in the order they were added.
  const tapFirst = options.tap === 'first' ? await browser.scriptAddPreloadScript({ functionDeclaration: wrap(tap) }) : null;
  const mainScript = await browser.scriptAddPreloadScript({ functionDeclaration: timed(main) });
  const tapLast = options.tap === 'last' ? await browser.scriptAddPreloadScript({ functionDeclaration: wrap(tap) }) : null;
  const isoScript = await browser.scriptAddPreloadScript({ functionDeclaration: wrap(isolated), sandbox: ISO_SANDBOX });
  return {
    mainBytes: main.length,
    isolatedBytes: isolated.length,
    tapBytes: tap.length,
    remove: async () => {
      for (const script of [tapFirst, mainScript, tapLast, isoScript]) if (script) await browser.scriptRemovePreloadScript({ script: script.script });
    },
  };
}

/** Calls `__cgHarness[method](...args)` in the sandbox of the current top-level context; JSON in and out. */
export async function harness<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  const context = await browser.getWindowHandle();
  const result = await browser.scriptCallFunction({
    functionDeclaration: '(method, args) => globalThis.__cgHarness.call(method, args)',
    target: { context, sandbox: ISO_SANDBOX },
    awaitPromise: true,
    arguments: [
      { type: 'string', value: method },
      { type: 'string', value: JSON.stringify(args) },
    ],
  });
  if (result.type !== 'success') throw new Error(`harness ${method}: ${JSON.stringify(result.exceptionDetails)}`);
  const value = result.result;
  if (value.type !== 'string') throw new Error(`harness ${method}: unexpected result ${JSON.stringify(value)}`);
  return JSON.parse(value.value) as T;
}

/** Waits until the adapter connected to MAIN and took its first snapshot. */
export async function waitForHarness(timeout = 10_000): Promise<void> {
  const ready = await harness<{ ready: boolean; connected: boolean }>('ready', timeout);
  if (!ready.ready || !ready.connected) throw new Error(`host harness not ready: ${JSON.stringify(ready)}`);
}

export async function waitForHarnessState<T>(read: () => Promise<T>, predicate: (value: T) => boolean, message: string, timeout = 5000): Promise<T> {
  let last: T | undefined;
  try {
    await browser.waitUntil(
      async () => {
        last = await read();
        return predicate(last);
      },
      { timeout, interval: 30 },
    );
  } catch {
    throw new Error(`${message}: not reached in ${timeout} ms; last: ${JSON.stringify(last)}`);
  }
  return last as T;
}

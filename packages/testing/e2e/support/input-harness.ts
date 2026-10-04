// The R17 input harness on the stand without the extension (architecture.md
// §9.1, §12 п. 4): R09's MAIN bundle goes into the page's own realm and the
// isolated bundle with the early key dispatcher into a WebDriver BiDi sandbox
// realm — both through preload scripts, which run before any page script, the
// way document_start content scripts do, so our capture listener on `window`
// is registered before ChatSpace's. Built here with esbuild from the package
// sources: the e2e always runs the code under test.

import { fileURLToPath } from 'node:url';

import { browser } from '@wdio/globals';
import { build } from 'esbuild';

const harnessDir = fileURLToPath(new URL('../harness/', import.meta.url));
export const INPUT_SANDBOX = 'cg-r17-input';

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
  if (output === undefined) throw new Error(`input harness: ${entry} produced no output`);
  return output.text;
}

export interface InstalledInputHarness {
  readonly isolatedBytes: number;
  remove(): Promise<void>;
}

/** Adds both preload scripts; every document loaded afterwards gets the dispatcher at its very start. */
export async function installInputHarness(): Promise<InstalledInputHarness> {
  const [main, isolated] = await Promise.all([bundle('main-harness.ts'), bundle('input-harness.ts')]);
  const wrap = (code: string): string => `() => {\n${code}\n}`;
  const mainScript = await browser.scriptAddPreloadScript({ functionDeclaration: wrap(main) });
  const isoScript = await browser.scriptAddPreloadScript({ functionDeclaration: wrap(isolated), sandbox: INPUT_SANDBOX });
  return {
    isolatedBytes: isolated.length,
    remove: async () => {
      await browser.scriptRemovePreloadScript({ script: mainScript.script });
      await browser.scriptRemovePreloadScript({ script: isoScript.script });
    },
  };
}

/** Calls `__cgInput[method](...args)` in the sandbox of the current top-level context; JSON in and out. */
export async function input<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
  const context = await browser.getWindowHandle();
  const result = await browser.scriptCallFunction({
    functionDeclaration: '(method, args) => globalThis.__cgInput.call(method, args)',
    target: { context, sandbox: INPUT_SANDBOX },
    awaitPromise: true,
    arguments: [
      { type: 'string', value: method },
      { type: 'string', value: JSON.stringify(args) },
    ],
  });
  if (result.type !== 'success') throw new Error(`input harness ${method}: ${JSON.stringify(result.exceptionDetails)}`);
  const value = result.result;
  if (value.type !== 'string') throw new Error(`input harness ${method}: unexpected result ${JSON.stringify(value)}`);
  return JSON.parse(value.value) as T;
}

export interface InputLog {
  readonly ran: string[];
  readonly refused: string[];
  readonly quick: boolean[];
  readonly notices: { kind: string; command: string; why?: string; refusal?: string }[];
  readonly ui: string[];
  readonly overlays: string[];
  readonly stats: { keydowns: number; claimed: number; isolated: number; untrusted: number; queued: number; dropped: number; maxHandlerMs: number };
}

export interface ReachedKey {
  readonly code: string;
  readonly key: string;
  readonly meta: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly prevented: boolean;
}

export const inputLog = (): Promise<InputLog> => input<InputLog>('log');

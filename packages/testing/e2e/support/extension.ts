// Helpers for driving the test build from WebdriverIO.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { TAB_PROTOCOL_VERSION } from '@cg/contracts';
import { browser } from '@wdio/globals';

import { BUNDLE_MARKS_KEY } from './constants';

const outputDir = fileURLToPath(new URL('../../../../apps/extension/.output/', import.meta.url));

type Flavor = 'release' | 'test';

/**
 * The XPI of the LAST build of a flavor, named by the version in its freshly
 * built manifest (same names as apps/extension/build/artifacts.ts). An older
 * version's XPI lying next to it is an error, never a silent pick.
 */
export function xpiPath(flavor: Flavor): string {
  const dir = `${outputDir}${flavor === 'test' ? 'firefox-mv3-test' : 'firefox-mv3'}/`;
  const command = flavor === 'test' ? 'pnpm build:test' : 'pnpm build';
  if (!existsSync(`${dir}manifest.json`)) throw new Error(`${flavor} build missing: run \`${command}\` first`);
  const { version } = JSON.parse(readFileSync(`${dir}manifest.json`, 'utf8')) as { version: string };
  const suffix = flavor === 'test' ? '-firefox-test.zip' : '-firefox.zip';
  const expected = `chatgoose-chatspace-${version}${suffix}`;
  const found = readdirSync(outputDir).filter((file) => file.startsWith('chatgoose-chatspace-') && file.endsWith(suffix));
  if (!found.includes(expected)) throw new Error(`${expected} missing: run \`${command}\` first`);
  if (found.length > 1) throw new Error(`stale ${flavor} XPIs next to ${expected}: ${found.join(', ')} — run \`${command}\``);
  return `${outputDir}${expected}`;
}

export async function installBuild(flavor: Flavor): Promise<string> {
  return browser.installAddOn(readFileSync(xpiPath(flavor)).toString('base64'), true);
}

export async function installTestBuild(): Promise<string> {
  return installBuild('test');
}

export function standUrl(path = '/spike.html'): string {
  const origin = process.env['CG_STAND_ORIGIN'];
  if (!origin) throw new Error('CG_STAND_ORIGIN not set (wdio onPrepare starts the stand)');
  return `${origin}${path}`;
}

/**
 * What the dock shows, written by the extension itself (apps/extension/src/composition/tab/app.ts): its view
 * model as the controller serves it, and what its closed root really holds. WebDriver cannot look inside.
 */
export interface DockReport {
  readonly styleMode: string;
  readonly kind: string;
  readonly inFlowFirstChild: boolean;
  /** DockVM: whether a chat is open, the status and its banner's code, insert or copy-only. */
  readonly visible: boolean;
  readonly status: string;
  readonly view: string;
  readonly mode: string;
  /** Who is signed in (the tab's own knowledge; the dock does not print it). */
  readonly login: string;
  /** The persona's label and the hub page's name of the open account; '' — none. */
  readonly persona: string;
  /** The label of the hub page the open account is bound to, once a generation could start for it. */
  readonly page: string;
  readonly banner: string | null;
  /** Part A of the host contract in one word: `ok`, `degraded`, `broken`. */
  readonly contract: string;
  readonly target: string | null;
  /** The seven strip actions: enabled or not. */
  readonly actions: Readonly<Record<string, boolean>>;
  readonly result: { readonly opId: string; readonly feature: string; readonly state: string; readonly streaming: boolean; readonly parts: number; readonly inserted: number; readonly error: string | null } | null;
  /** The code of a start that was not admitted. */
  readonly refusal: string | null;
  /** «Идут сейчас» of that refusal: the operations that hold the tab's three slots. */
  readonly refusalRunning: readonly string[];
  /** Generations of this tab that run in other chats. */
  readonly runningElsewhere: readonly string[];
  /** Where to point at what is inside the closed root, in viewport pixels: `action:<id>`, `insert:<part>`. */
  readonly hits: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
  readonly analysis: string | null;
  readonly resultStyle: string;
  /** Our open overlays, bottom first, and the surfaces mounted for them. */
  readonly overlays: readonly string[];
  readonly surfaces: readonly string[];
  /** View names the router serves: which controllers are in. */
  readonly views: readonly string[];
  /** Rendered: the dock's tree is in its closed root, with this many buttons and this text. */
  readonly strip: boolean;
  readonly buttons: number;
  readonly text: string | null;
  readonly height: number;
  readonly scheme: string | null;
  readonly language: string;
}

/** The report a TEST build's tab writes to <html data-cg-spike> (apps/extension/src/composition/tab/probe.ts). */
export type SpikeReport = Record<string, unknown> & {
  main?: { readyStateAtStart: string; installMs: number; wsTap: boolean };
  mainError?: string;
  bootstrap?: { composeMs: number; bundleMs: number | null; evalMs: number | null };
  lifecycle?: { staleHosts: number; lateInjection: boolean };
  /** `registrations` — how many times the background answered `tab.register`: more than one, and it started again under this tab. */
  rpc?: { state: string; registered: boolean; registrations?: number };
  app?: { loadMs: number };
  appError?: string;
  dock?: DockReport;
  runtime?: string;
  runtimeError?: string;
  ignoredInvalidations?: number;
  startedAt?: number;
  readyStateAtStart?: string;
};

/** Reads the report the extension writes to <html data-cg-spike> (test builds only). */
export async function readReport(): Promise<SpikeReport | null> {
  const raw = await browser.execute(() => document.documentElement.getAttribute('data-cg-spike'));
  return typeof raw === 'string' ? (JSON.parse(raw) as SpikeReport) : null;
}

export async function waitForReport(predicate: (report: SpikeReport) => boolean, message: string, timeout = 15_000): Promise<SpikeReport> {
  let last: SpikeReport | null = null;
  try {
    await browser.waitUntil(
      async () => {
        last = await readReport();
        return last !== null && predicate(last);
      },
      { timeout, interval: 100 },
    );
  } catch {
    throw new Error(`${message}: not reached in ${timeout} ms; last report: ${JSON.stringify(last)}`);
  }
  return last as unknown as SpikeReport;
}

/** The marks around the MAIN bundle (boot + runtime, X11): the page's own window carries them in a test build. */
export async function mainBundleMs(): Promise<number | null> {
  return browser.execute((key) => {
    const marks = (window as unknown as Record<string, { t0?: number; t1?: number } | undefined>)[key];
    return marks?.t0 !== undefined && marks.t1 !== undefined ? marks.t1 - marks.t0 : null;
  }, BUNDLE_MARKS_KEY);
}

export type PageRpcAnswer<T> = { readonly ok: true; readonly payload: T } | { readonly ok: false; readonly error: { readonly code: string; readonly detail?: string } };

/**
 * One request of the page side of the protocol (architecture.md §5.4), sent
 * from the extension page the browser is on: `runtime.sendMessage` with the
 * request envelope; the answer is the response envelope.
 */
export async function pageRpc<T = unknown>(type: string, payload: unknown = {}): Promise<PageRpcAnswer<T>> {
  const answer = await browser.execute(
    async (version: number, type: string, payload: unknown) => {
      const api = (globalThis as unknown as { browser?: { runtime: { sendMessage(message: unknown): Promise<unknown> } } }).browser;
      if (api?.runtime === undefined) return { failure: 'no extension API on this page' };
      try {
        return { envelope: await api.runtime.sendMessage({ v: version, kind: 'req', id: Math.floor(Math.random() * 1e9) + 1, type, payload }) };
      } catch (error) {
        return { failure: String(error) };
      }
    },
    TAB_PROTOCOL_VERSION,
    type,
    payload,
  );
  if ('failure' in answer) throw new Error(`page RPC ${type}: ${String(answer.failure)}`);
  const envelope = answer.envelope as { ok?: boolean; payload?: T; error?: { code: string; detail?: string } } | null | undefined;
  if (envelope === null || envelope === undefined || typeof envelope.ok !== 'boolean') throw new Error(`page RPC ${type}: no answer (${JSON.stringify(envelope)})`);
  return envelope.ok ? { ok: true, payload: envelope.payload as T } : { ok: false, error: envelope.error ?? { code: '?' } };
}

/** Reads keys of the extension's storage.local from the extension page the browser is on. */
export async function readLocalStorage(keys: readonly string[]): Promise<Record<string, unknown>> {
  return browser.execute(async (list: string[]) => {
    const api = (globalThis as unknown as { browser?: { storage: { local: { get(keys: string[]): Promise<Record<string, unknown>> } } } }).browser;
    if (api === undefined) throw new Error('no extension API on this page');
    return api.storage.local.get(list);
  }, [...keys]);
}

export async function writeLocalStorage(items: Record<string, unknown>): Promise<void> {
  await browser.execute(async (values: Record<string, unknown>) => {
    const api = (globalThis as unknown as { browser?: { storage: { local: { set(items: Record<string, unknown>): Promise<void> } } } }).browser;
    if (api === undefined) throw new Error('no extension API on this page');
    await api.storage.local.set(values);
  }, items);
}

const JUNK_PREFIX = 'e2e.junk.';

/**
 * Fills the extension's storage.session to its quota, from the extension page the browser is on: junk keys
 * of halving sizes until not one more character fits. Every write of the background that grows what it holds
 * there then fails, as it does in a browser that ran out of room. Returns how many junk keys were written.
 */
export async function fillSessionStorage(): Promise<number> {
  return browser.execute(async (prefix: string) => {
    const api = (globalThis as unknown as { browser?: { storage: { session: { set(items: Record<string, unknown>): Promise<void> } } } }).browser;
    if (api === undefined) throw new Error('no extension API on this page');
    let size = 8 * 1024 * 1024;
    let written = 0;
    while (size >= 1) {
      try {
        await api.storage.session.set({ [`${prefix}${written}`]: 'x'.repeat(size) });
        written += 1;
      } catch {
        size = Math.floor(size / 2);
      }
    }
    return written;
  }, JUNK_PREFIX);
}

/** Removes what `fillSessionStorage` wrote. */
export async function freeSessionStorage(): Promise<void> {
  await browser.execute(async (prefix: string) => {
    const api = (globalThis as unknown as { browser?: { storage: { session: { get(keys: null): Promise<Record<string, unknown>>; remove(keys: string[]): Promise<void> } } } }).browser;
    if (api === undefined) throw new Error('no extension API on this page');
    const all = await api.storage.session.get(null);
    await api.storage.session.remove(Object.keys(all).filter((key) => key.startsWith(prefix)));
  }, JUNK_PREFIX);
}

export async function htmlAttribute(name: string): Promise<string | null> {
  return browser.execute((attribute) => document.documentElement.getAttribute(attribute), name);
}

export interface Summary {
  readonly n: number;
  readonly median: number;
  readonly max: number;
  readonly min: number;
}

/** Median/min/max of a series of timings, rounded to 0.01 ms. */
export function summarize(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 === 1 ? (sorted[mid] ?? NaN) : ((sorted[mid - 1] ?? NaN) + (sorted[mid] ?? NaN)) / 2;
  const round = (value: number): number => Math.round(value * 100) / 100;
  return { n: sorted.length, median: round(median), min: round(sorted[0] ?? NaN), max: round(sorted.at(-1) ?? NaN) };
}

/**
 * Assigns the page its persona, as «Персоны» of the settings will (ST-061): the first active persona of the
 * hub's catalog for the page with this label. Called from an extension page of a signed-in build.
 */
export async function assignPersona(pageLabel: string): Promise<{ readonly pageId: number; readonly key: string; readonly displayName: string }> {
  const bootstrap = await pageRpc<{ pages: ReadonlyArray<{ pageId: number; pageLabel: string }> }>('bootstrap.get');
  if (!bootstrap.ok) throw new Error(`bootstrap.get: ${bootstrap.error.code}`);
  const page = bootstrap.payload.pages.find((item) => item.pageLabel === pageLabel);
  if (page === undefined) throw new Error(`the bootstrap has no page «${pageLabel}»`);
  const catalog = await pageRpc<{ personas: ReadonlyArray<{ key: string; definitionId: string; displayName: string; status: string }> }>('catalog.get');
  if (!catalog.ok) throw new Error(`catalog.get: ${catalog.error.code}`);
  const persona = catalog.payload.personas.find((item) => item.status === 'active');
  if (persona === undefined) throw new Error('the catalog has no active persona');
  const saved = await pageRpc('persona.set', { pageId: page.pageId, key: persona.key, definitionId: persona.definitionId });
  if (!saved.ok) throw new Error(`persona.set: ${saved.error.code}`);
  return { pageId: page.pageId, key: persona.key, displayName: persona.displayName };
}

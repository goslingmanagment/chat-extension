// Helpers for driving the test build from WebdriverIO.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { browser } from '@wdio/globals';

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

export type SpikeReport = Record<string, unknown> & {
  main?: { readyStateAtStart: string; installMs: number; wsTap: boolean };
  mainError?: string;
  background?: { wsTapRegistered: boolean; testBuild: boolean };
  bootstrap?: { composeMs: number; bundleMs: number | null };
  dock?: {
    loadMs: number;
    renderMs: number;
    styleMode: string;
    inFlowFirstChild: boolean;
    style: { display: string; height: string; boxSizing: string } | null;
  };
  dockError?: string;
  list?: { rows: number; renderMs: number; updateMs: number; domRows: number; loadMs: number; firstFrameMs: number };
  listError?: string;
  focus?: { rootActive: string | null; docActiveIsHost: boolean; value: string | null };
  runtime?: string;
  ignoredInvalidations?: number;
  startedAt?: number;
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

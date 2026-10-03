// Helpers for driving the test build from WebdriverIO.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { browser } from '@wdio/globals';

const outputDir = fileURLToPath(new URL('../../../../apps/extension/.output/', import.meta.url));

/** The TEST build XPI (`pnpm build:test`). */
export function testXpiPath(): string {
  const name = readdirSync(outputDir).find((file) => file.endsWith('-firefox-test.zip'));
  if (!name) throw new Error('test XPI missing: run `pnpm build:test` first');
  return `${outputDir}${name}`;
}

export async function installTestBuild(): Promise<string> {
  return browser.installAddOn(readFileSync(testXpiPath()).toString('base64'), true);
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
  dock?: { loadMs: number; renderMs: number; styleMode: string; inFlowFirstChild: boolean };
  dockError?: string;
  list?: { rows: number; renderMs: number; updateMs: number; domRows: number; loadMs: number; firstFrameMs: number };
  listError?: string;
  focus?: { rootActive: string | null; docActiveIsHost: boolean; value: string | null };
  runtime?: string;
  startedAt?: number;
};

/** Reads the report the extension writes to <html data-cg-spike> (test builds only). */
export async function readReport(): Promise<SpikeReport | null> {
  const raw = await browser.execute(() => document.documentElement.getAttribute('data-cg-spike'));
  return typeof raw === 'string' ? (JSON.parse(raw) as SpikeReport) : null;
}

export async function waitForReport(predicate: (report: SpikeReport) => boolean, message: string, timeout = 15_000): Promise<SpikeReport> {
  let last: SpikeReport | null = null;
  await browser.waitUntil(
    async () => {
      last = await readReport();
      return last !== null && predicate(last);
    },
    { timeout, interval: 100, timeoutMsg: `${message}; last report: ${JSON.stringify(last)}` },
  );
  return last as unknown as SpikeReport;
}

export async function htmlAttribute(name: string): Promise<string | null> {
  return browser.execute((attribute) => document.documentElement.getAttribute(attribute), name);
}

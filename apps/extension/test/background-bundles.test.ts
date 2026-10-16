import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

import type * as KernelSdk from '@kernel/sdk';
import { build, type Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

import { backgroundCorePlugin } from '../build/background-bundles.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const SDK = resolve(ROOT, 'vendor/kernel-sdk/dist/index.js');
const CATALOG = resolve(ROOT, 'vendor/kernel-sdk/dist/shared/ofapi-read-catalog.js');

async function bundle(source: string, optimize = true): Promise<Rolldown.OutputChunk> {
  const entry = '\0background-sdk-test';
  const result = await build({
    configFile: false,
    root: ROOT,
    logLevel: 'silent',
    plugins: [
      { name: 'test-entry', resolveId: (id) => id === entry ? entry : undefined, load: (id) => id === entry ? source : undefined },
      ...(optimize ? [backgroundCorePlugin()] : []),
    ],
    build: {
      write: false,
      minify: false,
      target: 'firefox142',
      rolldownOptions: { input: entry, preserveEntrySignatures: 'strict', output: { format: 'iife', name: 'sdk' } },
    },
  });
  if (Array.isArray(result) || !('output' in result)) throw new Error('expected one build');
  const chunk = result.output.find((item) => item.type === 'chunk');
  if (chunk === undefined) throw new Error('expected a bundle');
  return chunk;
}

describe('the background SDK bundle', () => {
  it('drops the unused OFAPI catalog from the real SDK barrel while keeping its client, response validation and stop-reason predicate', async () => {
    const source = `export { createClient, routeSchemas, isOutputExhausted } from ${JSON.stringify(SDK)};`;
    const before = await bundle(source, false);
    expect(before.code).toContain('smart_link_cohort_arps');
    const chunk = await bundle(source);
    expect(Object.entries(chunk.modules).some(([id, module]) => id === CATALOG && module.renderedLength > 0)).toBe(false);
    expect(chunk.code).not.toContain('smart_link_cohort_arps');
    const scope: { sdk?: Pick<typeof KernelSdk, 'createClient' | 'routeSchemas' | 'isOutputExhausted'> } = {};
    runInNewContext(chunk.code, scope);
    const sdk = scope.sdk;
    if (sdk === undefined) throw new Error('expected SDK exports');
    expect(typeof sdk.createClient({ baseUrl: 'https://hub.invalid', fetch: () => Promise.reject(new Error('unexpected request')) }).raw).toBe('function');
    expect(sdk.routeSchemas.health.response[200].safeParse({ status: 'ok', timestamp: '2026-10-16T07:00:00.000Z', contractHash: 'a'.repeat(64), capabilities: [], checks: { api: { status: 'ok' }, database: { status: 'ok', latencyMs: 1, error: null } } }).success).toBe(true);
    expect(sdk.routeSchemas.health.response[200].safeParse({}).success).toBe(false);
    expect(sdk.isOutputExhausted('max_tokens')).toBe(true);
    expect(sdk.isOutputExhausted('stop')).toBe(false);
  });

  it('retains the catalog and its initialization when an entry actually imports it', async () => {
    const chunk = await bundle(`export { OFAPI_READ_CATALOG } from ${JSON.stringify(CATALOG)};`);
    const scope: { sdk?: { OFAPI_READ_CATALOG: readonly { id: string }[] } } = {};
    runInNewContext(chunk.code, scope);
    expect(scope.sdk?.OFAPI_READ_CATALOG.some((row) => row.id === 'smart_link_cohort_arps')).toBe(true);
  });
});

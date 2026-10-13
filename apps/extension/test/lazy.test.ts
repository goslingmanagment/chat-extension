// The loader of the tab's lazy chunks (architecture.md §11): one retry under
// another URL, never a third try.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { STORAGE_KEYS } from '@cg/contracts';
import { describe, expect, it } from 'vitest';

import { BEFORE_THE_DOCK, LAZY_ENTRIES, LAZY_LAYERS } from '../lazy/entries/names.ts';
import { LAZY_DIR } from '../lazy/vite.config.ts';
import { importWithRetry, lazyPath, LAZY_RETRY_DELAY_MS } from '../src/composition/tab/lazy.ts';
import { LAZY, NEWCOMER_DRAFTS_KEY } from '../src/composition/tab/runtime.ts';
import { CHATSPACE_ADAPTER } from '../src/entrypoints/chatspace.content.ts';

const URL_OF_CHUNK = 'moz-extension://00000000-0000-4000-8000-000000000001/lazy/dock.js';

describe('lazy chunks', () => {
  it('[EX-009] a chunk loads with one import() of its own URL', async () => {
    const asked: string[] = [];
    const waits: number[] = [];
    const module = await importWithRetry<{ ok: boolean }>(
      URL_OF_CHUNK,
      (url) => {
        asked.push(url);
        return Promise.resolve({ ok: true });
      },
      (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    );
    expect(module).toEqual({ ok: true });
    expect(asked).toEqual([URL_OF_CHUNK]);
    expect(waits).toEqual([]);
  });

  it('[EX-009] a failed load is asked for once more under `?retry=1` (a failed module stays failed under its own URL)', async () => {
    const asked: string[] = [];
    const waits: number[] = [];
    const module = await importWithRetry<{ ok: boolean }>(
      URL_OF_CHUNK,
      (url) => {
        asked.push(url);
        return asked.length === 1 ? Promise.reject(new TypeError('error loading dynamically imported module')) : Promise.resolve({ ok: true });
      },
      (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    );
    expect(module).toEqual({ ok: true });
    expect(asked).toEqual([URL_OF_CHUNK, `${URL_OF_CHUNK}?retry=1`]);
    expect(waits).toEqual([LAZY_RETRY_DELAY_MS]);
  });

  it('[EX-009] a second failure is the caller’s: nothing is tried a third time', async () => {
    const asked: string[] = [];
    const failure = new TypeError('error loading dynamically imported module');
    await expect(
      importWithRetry(
        URL_OF_CHUNK,
        (url) => {
          asked.push(url);
          return Promise.reject(failure);
        },
        () => Promise.resolve(),
      ),
    ).rejects.toBe(failure);
    expect(asked).toHaveLength(2);
  });
});

describe('the lazy entries of the tab', () => {
  it('every entry has its source file, and a chunk is asked for by its entry name', () => {
    for (const [name, source] of Object.entries(LAZY_ENTRIES)) {
      expect(source).toBe(`entries/${name}.ts`);
      expect(existsSync(fileURLToPath(new URL(`../lazy/${source}`, import.meta.url)))).toBe(true);
    }
    expect(lazyPath(CHATSPACE_ADAPTER.lazy.root, 'dock')).toBe('lazy/dock.js');
    // ChatSpace's adapter names its build: the folder the lazy build writes.
    expect(CHATSPACE_ADAPTER.lazy.root).toBe(LAZY_DIR);
    // The two chunks the early bundle loads itself are entries of the build.
    expect(Object.values(LAZY)).toEqual(['tab-protocol', 'tab-app']);
    for (const entry of Object.values(LAZY)) expect(Object.keys(LAZY_ENTRIES)).toContain(entry);
  });

  it('[EX-009] the layers are the entries every chat tab loads, in the order their budgets stack: the dock first, then what loads before any other chunk', () => {
    expect([...LAZY_LAYERS]).toEqual(['dock', 'bridge-validation', 'tab-protocol', 'tab-app', 'ai', 'navigation']);
    for (const layer of LAZY_LAYERS) expect(Object.keys(LAZY_ENTRIES)).toContain(layer);
    // What the dock shares with these goes to the kernel chunk: the dock never pulls the schemas in.
    expect(BEFORE_THE_DOCK).toEqual(['bridge-validation', 'tab-protocol', 'tab-app']);
  });

  it('the early bundle names the drafts key of storage.local by hand (the settings module is schemas it must not carry): it is the contracts’ key', () => {
    expect(NEWCOMER_DRAFTS_KEY).toBe(STORAGE_KEYS.newcomersDrafts);
  });
});

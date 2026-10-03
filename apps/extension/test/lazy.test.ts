// The loader of the tab's lazy chunks (architecture.md §11): one retry under
// another URL, never a third try.

import { describe, expect, it } from 'vitest';

import { importWithRetry, LAZY_RETRY_DELAY_MS } from '../src/composition/tab/lazy';

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

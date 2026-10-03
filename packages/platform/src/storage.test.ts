import { STORAGE_KEYS, STORAGE_LIMITS } from '@cg/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createKeyValueStore, isQuotaError, jsonBytes } from './storage';
import { createFakeBrowser, flush } from './test-support/fake-browser';

function setup() {
  const fake = createFakeBrowser();
  const background = fake.startBackground();
  return { fake, api: background.api };
}

describe('storage.local / storage.session wrappers (§9.4)', () => {
  it('[RB-011] runs calls in issue order: a read issued after a write sees the write', async () => {
    const { api } = setup();
    const store = createKeyValueStore('local', { api });
    const calls = [store.set({ a: 1 }), store.get(['a']), store.set({ a: 2 }), store.remove(['a']), store.get(['a'])];
    const [, firstRead, , , lastRead] = await Promise.all(calls);
    expect(firstRead).toEqual({ ok: true, value: { a: 1 } });
    expect(lastRead).toEqual({ ok: true, value: {} });
  });

  it('[RB-011] a change of several keys is ONE browser set', async () => {
    const { api } = setup();
    const set = vi.spyOn(api.storage.local, 'set');
    const store = createKeyValueStore('local', { api });
    expect(await store.set({ settings: { x: 1 }, 'settings.extra': 2 })).toEqual({ ok: true, value: undefined });
    expect(set).toHaveBeenCalledTimes(1);
    expect(await store.set({})).toEqual({ ok: true, value: undefined });
    expect(set).toHaveBeenCalledTimes(1);
  });

  it('a failed read returns no value (never "empty") with CG-STORAGE-READ; a failed write CG-STORAGE-WRITE', async () => {
    const { fake, api } = setup();
    const store = createKeyValueStore('local', { api });
    await store.set({ settings: { schemaVersion: 1 } });
    fake.failNext('local', 'get');
    expect(await store.get(['settings'])).toEqual({ ok: false, code: 'CG-STORAGE-READ', detail: 'local.get Error' });
    fake.failNext('local', 'set', Object.assign(new Error('disk said: secret path /Users/x'), { name: 'UnknownError' }));
    const failed = await store.set({ settings: { schemaVersion: 1, x: 2 } });
    expect(failed).toEqual({ ok: false, code: 'CG-STORAGE-WRITE', detail: 'local.set UnknownError' });
    fake.failNext('local', 'remove');
    expect(await store.remove(['settings'])).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
    // Nothing was erased by the failures.
    expect(fake.areas.local.get('settings')).toEqual({ schemaVersion: 1 });
    expect(await store.get([])).toEqual({ ok: true, value: {} });
    expect(await store.remove([])).toEqual({ ok: true, value: undefined });
  });

  it('[NF-012] a value over its key budget is refused with CG-STORAGE-FULL before the browser is asked', async () => {
    const { fake, api } = setup();
    const set = vi.spyOn(api.storage.local, 'set');
    const budgets: Record<string, number> = { [STORAGE_KEYS.newcomersDrafts]: STORAGE_LIMITS.previewDraftsTotalBytes };
    const store = createKeyValueStore('local', { api, budgetOf: (key) => budgets[key] });
    const draft = 'я'.repeat(5000);
    const fits = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`d${i}`, draft]));
    expect(await store.set({ [STORAGE_KEYS.newcomersDrafts]: fits })).toEqual({ ok: true, value: undefined });
    const tooMuch = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`d${i}`, draft]));
    const refused = await store.set({ [STORAGE_KEYS.newcomersDrafts]: tooMuch });
    expect(refused).toMatchObject({ ok: false, code: 'CG-STORAGE-FULL' });
    expect(refused.ok ? '' : refused.detail).toMatch(/^local\.set newcomers\.drafts: \d+ > 1048576 bytes$/);
    expect(set).toHaveBeenCalledTimes(1);
    expect(fake.areas.local.get(STORAGE_KEYS.newcomersDrafts)).toEqual(fits);
  });

  it('the write cap and the browser quota are CG-STORAGE-FULL; non-JSON is CG-STORAGE-WRITE', async () => {
    const { fake, api } = setup();
    const capped = createKeyValueStore('session', { api, maxWriteBytes: 100 });
    expect(await capped.set({ a: 'x'.repeat(200) })).toEqual({ ok: false, code: 'CG-STORAGE-FULL', detail: 'session.set: 202 > 100 bytes' });
    fake.quota.session = 50;
    const session = createKeyValueStore('session', { api });
    expect(await session.set({ a: 'x'.repeat(80) })).toEqual({ ok: false, code: 'CG-STORAGE-FULL', detail: 'session.set quota' });
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    expect(await session.set({ a: cyclic })).toEqual({ ok: false, code: 'CG-STORAGE-WRITE', detail: 'session.set a: not JSON' });
    expect(await session.set({ a: () => 1 })).toMatchObject({ ok: false, code: 'CG-STORAGE-WRITE' });
  });

  it('reports changes of its own area only', async () => {
    const { fake, api } = setup();
    const local = createKeyValueStore('local', { api });
    const session = createKeyValueStore('session', { api });
    const seen: string[] = [];
    const off = local.onChanged((changes) => seen.push(...Object.keys(changes).map((key) => `local:${key}`)));
    session.onChanged((changes) => seen.push(...Object.keys(changes).map((key) => `session:${key}`)));
    await local.set({ a: 1 });
    await session.set({ b: 1 });
    // Another context (an extension page) writes too.
    await fake.context({ id: fake.runtimeId, url: `${fake.base}options.html` }).api.storage.local.set({ c: 1 });
    await flush();
    expect(seen).toEqual(['local:a', 'session:b', 'local:c']);
    off();
    await local.set({ a: 2 });
    await flush();
    expect(seen).toHaveLength(3);
  });

  it('measures UTF-8 JSON bytes and recognizes quota errors', () => {
    expect(jsonBytes('a')).toBe(3);
    expect(jsonBytes('я')).toBe(4);
    expect(jsonBytes('😀')).toBe(6);
    expect(jsonBytes('\ud800x')).toBe(9); // a lone surrogate is escaped by JSON
    expect(jsonBytes(undefined)).toBeNull();
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    expect(isQuotaError(new Error('storage.session quota exceeded'))).toBe(true);
    expect(isQuotaError(new Error('nope'))).toBe(false);
    expect(isQuotaError('quota')).toBe(false);
  });
});

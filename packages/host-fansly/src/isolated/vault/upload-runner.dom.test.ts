import type { VaultCheckpoint } from '@cg/contracts/tab-messages-fansly';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGeneration } from '../generation';
import { createVaultCheckpointStore, CHECKPOINT_TTL_MS } from './checkpoint-store';
import type { VaultEvent, VaultSession } from './session';
import { VaultUploadRunner } from './upload-runner';
import { handoffFile, watchVault } from './vault-dom';

const account = '700000000000000001';
const album = '700000000000000002';
const upload = '00000000-0000-4000-8000-000000000001';
const file = (): File => new File(['a'], 'one.jpg', { type: 'image/jpeg', lastModified: 100 });
const point = (files = [file()]): VaultCheckpoint => ({ hostAccountId: account, albumId: album, uploadId: upload, files: files.map((f) => ({ name: f.name, size: f.size, lastModified: f.lastModified })), confirmed: 0, pending: null, updatedAt: Date.now() });
const tick = async (): Promise<void> => { for (let n = 0; n < 16; n++) await Promise.resolve(); };
function fixture(count = 1, pending = false) {
  document.body.innerHTML = '<app-media-vault><h1>Album</h1><app-media-upload-input><input type="file"></app-media-upload-input><div class="cards"></div></app-media-vault>';
  const files = [file(), new File(['b'], 'two.jpg', { lastModified: 200 })].slice(0, count);
  const generation = createGeneration();
  let accountId: string | null = account;
  let onRoute = true;
  const listeners = new Set<(event: VaultEvent) => void>();
  const changes = new Set<() => void>();
  const session: VaultSession = {
    current: () => ({ accountId, generation: generation.current(), onRoute }), under: generation.under,
    inspect: vi.fn(() => Promise.resolve({ seq: 10, albumId: album, creatorId: account })),
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    onChange(cb) { changes.add(cb); return () => { changes.delete(cb); }; },
  };
  const store = { save: vi.fn((_c: VaultCheckpoint): Promise<void> => Promise.resolve()), clear: vi.fn(() => Promise.resolve()), load: vi.fn(() => Promise.resolve(null)) };
  const handoff = vi.fn(() => 'passed' as const);
  const checkpoint = point(files);
  if (pending) checkpoint.pending = { index: 0, passedAt: Date.now() };
  const runner = new VaultUploadRunner({ doc: document, session, store, files, checkpoint, albumTitle: 'Album', timeoutMs: 100, handoff });
  const event = (e: VaultEvent): void => { for (const cb of listeners) cb(e); };
  const card = (name = 'one.jpg'): void => { document.querySelector('.cards')!.insertAdjacentHTML('afterbegin', `<div class="vault-row"><span class="image-filename">${name}</span></div>`); };
  const confirm = (name = 'one.jpg', seq = 11): void => { card(name); event({ t: 'fx.vaultAdded', p: { seq } }); event({ t: 'fx.vaultReloaded', p: { seq: seq + 1, albumId: album } }); };
  return { runner, store, handoff, session, generation, event, card, confirm, listeners, changes, change(kind: 'creator' | 'route') { if (kind === 'creator') accountId = '700000000000000099'; else onRoute = false; generation.advance(); for (const cb of changes) cb(); } };
}
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

describe('Fansly vault uploader', () => {
  it('[VA-005] writes pending before each handoff; one confirmed POST + later reload + card advances exactly one file', async () => {
    const f = fixture(2);
    const run = f.runner.start(); await tick();
    expect(f.store.save.mock.calls[0]?.[0].pending?.index).toBe(0);
    expect(f.handoff).toHaveBeenCalledTimes(1);
    f.event({ t: 'fx.vaultAdded', p: { seq: 11 } }); await tick();
    expect(f.runner.snapshot().confirmed).toBe(0);
    f.card(); f.event({ t: 'fx.vaultReloaded', p: { seq: 12, albumId: album } }); await tick();
    expect(f.handoff).toHaveBeenCalledTimes(2);
    f.confirm('two.jpg', 13); await run;
    expect(f.runner.snapshot()).toMatchObject({ state: 'complete', confirmed: 2, uncertain: false });
    expect(f.store.clear).toHaveBeenCalledWith(account, album, upload);
    expect(f.listeners.size + f.changes.size).toBe(0);
  });
  it('[VA-006] Fansly can normalize JPG to jpeg on the confirming card', async () => {
    const f = fixture(); const run = f.runner.start(); await tick(); f.confirm('ONE.jpeg'); await run;
    expect(f.runner.snapshot()).toMatchObject({ state: 'complete', confirmed: 1 });
  });
  it('[VA-004] old events or a card alone cannot confirm; timeout blocks retry until the person says missing', async () => {
    vi.useFakeTimers(); const f = fixture(); const run = f.runner.start(); await tick();
    f.card(); f.event({ t: 'fx.vaultAdded', p: { seq: 9 } }); f.event({ t: 'fx.vaultReloaded', p: { seq: 10, albumId: album } });
    await vi.advanceTimersByTimeAsync(101); await run;
    expect(f.runner.snapshot()).toMatchObject({ uncertain: true, confirmed: 0, reason: 'timeout' });
    await expect(f.runner.start()).rejects.toThrow();
    f.store.save.mockRejectedValueOnce(new Error('disk'));
    await expect(f.runner.resolveUncertain('missing')).rejects.toThrow('disk');
    expect(f.runner.snapshot().uncertain).toBe(true);
    await f.runner.resolveUncertain('present');
    await f.runner.start(); expect(f.handoff).toHaveBeenCalledTimes(1);
  });
  it('[VA-004] restored pending requires a human decision even with a matching card', async () => {
    const f = fixture(1, true); f.card();
    await expect(f.runner.start()).rejects.toThrow();
    await f.runner.resolveUncertain('missing');
    expect(f.runner.snapshot()).toMatchObject({ confirmed: 0, pending: null, uncertain: false });
  });
  it.each(['creator', 'route'] as const)('[AU-036] %s change while saving prevents handoff', async (kind) => {
    const f = fixture(); let release!: () => void;
    f.store.save.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    const run = f.runner.start(); await tick(); f.change(kind); release(); await run;
    expect(f.handoff).not.toHaveBeenCalled(); expect(f.runner.snapshot().state).toBe('stopped');
  });
  it('[AU-036] generation moves after inspect resolves but before it is consumed: no handoff', async () => {
    const f = fixture(); const inspect = f.session.inspect.bind(f.session);
    f.session.inspect = async () => { const r = await inspect(); queueMicrotask(() => f.change('creator')); return r; };
    await f.runner.start(); expect(f.handoff).not.toHaveBeenCalled();
  });
  it.each(['creator', 'route'] as const)('[AU-036] %s change after handoff preserves uncertainty', async (kind) => {
    const f = fixture(); const run = f.runner.start(); await tick(); f.change(kind); await run;
    expect(f.runner.snapshot().uncertain).toBe(true); expect(f.handoff).toHaveBeenCalledTimes(1);
  });
  it('[VA-006] pause finishes only the current file; stopping disconnects and leaves its pending checkpoint', async () => {
    const f = fixture(2); const run = f.runner.start(); await tick(); f.runner.pause(); f.confirm(); await run;
    expect(f.runner.snapshot()).toMatchObject({ state: 'paused', confirmed: 1 }); expect(f.listeners.size).toBe(0);
    const next = f.runner.start(); await tick(); f.runner.stop(); await next;
    expect(f.runner.snapshot()).toMatchObject({ state: 'stopped', pending: 1, uncertain: true });
  });
  it.each(['gap', 'album', 'double', 'error'] as const)('[VA-006] %s stops without automatic repeat', async (kind) => {
    const f = fixture(); const run = f.runner.start(); await tick();
    if (kind === 'gap') f.event(null);
    if (kind === 'album') f.event({ t: 'fx.vaultReloaded', p: { seq: 12, albumId: '999' } });
    if (kind === 'double') { f.event({ t: 'fx.vaultAdded', p: { seq: 11 } }); f.event({ t: 'fx.vaultAdded', p: { seq: 12 } }); }
    if (kind === 'error') document.querySelector('app-media-upload-input')!.append('Failed');
    await run; expect(f.runner.snapshot().uncertain).toBe(true); expect(f.handoff).toHaveBeenCalledTimes(1);
  });
  it('[VA-004] loss reported after a confirming batch is consumed before committing the proof', async () => {
    const f = fixture(); const run = f.runner.start(); await tick(); f.confirm(); f.event(null); await run;
    expect(f.runner.snapshot()).toMatchObject({ confirmed: 0, uncertain: true, reason: 'stream-lost' });
  });
  it('[VA-006] a confirmed file in the wrong order stops as known, never asks to reupload it', async () => {
    const f = fixture(2); const run = f.runner.start(); await tick(); f.card(); f.card('another.jpg');
    f.event({ t: 'fx.vaultAdded', p: { seq: 11 } }); f.event({ t: 'fx.vaultReloaded', p: { seq: 12, albumId: album } }); await run;
    expect(f.runner.snapshot()).toMatchObject({ confirmed: 1, uncertain: false, reason: 'order-mismatch' });
    expect(f.handoff).toHaveBeenCalledTimes(1);
  });
  it('[VA-006] only one runner can own the document while an upload is in flight', async () => {
    const f = fixture(); const g = fixture(); const run = f.runner.start(); await tick();
    await expect(g.runner.start()).rejects.toThrow(); f.runner.stop(); await run;
  });
  it('[AU-036] an uncertain checkpoint cannot be resolved while looking at another account', async () => {
    const f = fixture(1, true); f.change('creator');
    await expect(f.runner.resolveUncertain('present')).rejects.toThrow('identity changed');
    expect(f.store.save).not.toHaveBeenCalled(); expect(f.runner.snapshot().uncertain).toBe(true);
  });
  it('[AU-036] a matching title and card from another album cannot skip a file', async () => {
    const f = fixture(); f.card(); f.session.inspect = () => Promise.resolve({ seq: 10, creatorId: account, albumId: '999' });
    await f.runner.start(); expect(f.runner.snapshot()).toMatchObject({ confirmed: 0, reason: 'album-changed' });
  });
  it('[VA-005] failed save prevents handoff; failed final save leaves pending, never quietly repeats', async () => {
    const f = fixture(); f.store.save.mockRejectedValueOnce(new Error('disk')); await f.runner.start();
    expect(f.handoff).not.toHaveBeenCalled(); expect(f.runner.snapshot().reason).toBe('checkpoint-write-failed');
    const g = fixture(); const run = g.runner.start(); await tick(); g.store.save.mockRejectedValueOnce(new Error('disk')); g.confirm(); await run;
    expect(g.runner.snapshot()).toMatchObject({ uncertain: true, reason: 'checkpoint-write-failed' });
  });
  it('[FS-VLT-2] [VA-006] the list observer has no callbacks after disposal', async () => {
    fixture(); const changed = vi.fn(); const off = watchVault(document, changed);
    document.querySelector('.cards')!.append('a'); await tick(); expect(changed).toHaveBeenCalled();
    off(); changed.mockClear(); document.querySelector('.cards')!.append('b'); await tick(); expect(changed).not.toHaveBeenCalled();
  });
  it('[VA-006] native handoff gives the input exactly one File and one change event', () => {
    fixture(); const input = document.querySelector('input')!; const changed = vi.fn(); input.addEventListener('change', changed);
    expect(handoffFile(input, file())).toBe('passed'); expect(input.files).toHaveLength(1); expect(changed).toHaveBeenCalledTimes(1);
  });
  it('[VA-005] checkpoints are scoped by account + album, expire at 14 days and serialize save/load/clear', async () => {
    let now = Date.now(); const rows = new Map<string, unknown>();
    const store = createVaultCheckpointStore({ read: (k) => Promise.resolve(rows.get(k)), write: async (k, v) => { await Promise.resolve(); rows.set(k, v); }, remove: (k) => { rows.delete(k); return Promise.resolve(); } }, () => now);
    const c = point(); const save = store.save(c); const load = store.load(account, album); await save; expect(await load).toEqual(c);
    expect(await store.load('999', album)).toBeNull();
    await store.clear(account, album, 'different'); expect(await store.load(account, album)).toEqual(c);
    now += CHECKPOINT_TTL_MS; expect(await store.load(account, album)).toBeNull();
    now = c.updatedAt; await store.clear(account, album, upload); expect(await store.load(account, album)).toBeNull();
  });
});

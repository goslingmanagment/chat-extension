import { describe, expect, it, vi } from 'vitest';

import { createSiteAccess } from './site-access';
import { createMemoryKv } from './test-support/memory-kv';

function setup() {
  const storage = createMemoryKv();
  const key = 'site.waitingReload';
  storage.data.set(key, [21, 22]);
  const enabled = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
  const syncScripts = vi.fn<(on: boolean) => Promise<'unchanged'>>().mockResolvedValue('unchanged');
  const turnedOff = vi.fn();
  const access = createSiteAccess({
    host: 'fansly-web', key, storage: storage.open(),
    settings: { enabled, setEnabled: (on) => { enabled.mockResolvedValue(on); return Promise.resolve(); }, onChange: () => () => undefined },
    permissions: { has: () => Promise.resolve(true), onChange: () => () => undefined },
    syncScripts,
    tabs: { list: () => Promise.resolve([21, 22]), notice: () => Promise.resolve(), reload: () => Promise.resolve(), onRemoved: () => () => undefined },
    observe: { attach: () => undefined, detach: () => undefined },
    setCaptureEnabled: () => Promise.resolve(),
    startModule: () => Promise.resolve(),
    turnedOff,
    failed: () => undefined,
  });
  return { access, storage, key, enabled, syncScripts, turnedOff };
}

describe('optional-site access after a failed startup read', () => {
  it('keeps an unreadable switch unknown and retries it when the tab asks again', async () => {
    const w = setup();
    w.enabled.mockRejectedValue(new Error('CG-STORAGE-READ'));
    await expect(w.access.start()).rejects.toThrow('CG-STORAGE-READ');
    await expect(w.access.state()).rejects.toThrow('CG-STORAGE-READ');
    expect(w.syncScripts).not.toHaveBeenCalled();
    expect(w.turnedOff).not.toHaveBeenCalled();

    w.enabled.mockResolvedValue(true);
    await expect(w.access.state()).resolves.toMatchObject({ enabled: true, registered: true, waitingReload: 2 });
    expect(w.access.active()).toBe(true);
    expect(w.syncScripts).toHaveBeenCalledExactlyOnceWith(true);
  });

  it('re-reads a failed reload list without restarting or losing the waiting tabs', async () => {
    const w = setup();
    w.storage.failNext('get');
    await expect(w.access.start()).rejects.toThrow('CG-STORAGE-READ');
    expect(w.syncScripts).not.toHaveBeenCalled();

    await expect(w.access.state()).resolves.toMatchObject({ enabled: true, registered: true, waitingReload: 2 });
    await w.access.registered(21);
    await expect(w.access.state()).resolves.toMatchObject({ waitingReload: 1 });
    expect(w.storage.read(w.key)).toEqual([22]);
    expect(w.storage.calls.get).toBe(2);
    expect(w.turnedOff).not.toHaveBeenCalled();
  });

  it('preserves an active registration on read failure and tears down only after a successful off read', async () => {
    const w = setup();
    await w.access.start();
    w.syncScripts.mockClear();
    w.enabled.mockRejectedValue(new Error('CG-STORAGE-READ'));
    await expect(w.access.start()).rejects.toThrow('CG-STORAGE-READ');
    expect(w.access.active()).toBe(true);
    expect(w.syncScripts).not.toHaveBeenCalled();
    expect(w.turnedOff).not.toHaveBeenCalled();

    w.enabled.mockResolvedValue(false);
    await expect(w.access.start()).resolves.toMatchObject({ enabled: false, registered: false });
    expect(w.syncScripts).toHaveBeenCalledExactlyOnceWith(false);
    expect(w.turnedOff).toHaveBeenCalledOnce();
  });
});

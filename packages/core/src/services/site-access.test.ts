import { describe, expect, it } from 'vitest';
import { createSiteAccess } from './site-access';
import { createMemoryKv } from './test-support/memory-kv';

function setup() {
  const closedOnReload = new Set<number>();
  const vanishOnReload = new Set<number>();
  const store = createMemoryKv();
  let enabled = false;
  let granted = false;
  // Browser-owned registrations survive an event-page sleep.
  let scripts = false;
  let changed: (added: boolean) => void = () => undefined;
  let settingsChanged: () => void = () => undefined;
  let removed: (tab: number) => void = () => undefined;
  let live = [1, 2];
  const calls: string[] = [];
  const wake = () => createSiteAccess({ host: 'fansly-web', key: 'reload', storage: store.open(),
    settings: {
      enabled: () => Promise.resolve(enabled),
      setEnabled: (value) => { enabled = value; settingsChanged(); return Promise.resolve(); },
      onChange: (listener) => { settingsChanged = listener; return () => undefined; },
    },
    permissions: { has: () => Promise.resolve(granted), onChange: (listener) => { changed = listener; return () => undefined; } },
    syncScripts: (active) => {
      calls.push(`scripts ${active}`);
      const result = scripts === active ? 'unchanged' : active ? 'registered' : 'unregistered';
      scripts = active;
      return Promise.resolve(result);
    },
    tabs: {
      list: () => { calls.push('query'); return Promise.resolve([...live]); },
      notice: (tab) => { calls.push(`notice ${tab}`); return Promise.resolve(); },
      reload: (tab) => {
        calls.push(`reload ${tab}`);
        if (vanishOnReload.has(tab)) live = live.filter((id) => id !== tab);
        return closedOnReload.has(tab) || vanishOnReload.has(tab) ? Promise.reject(new Error('reload refused')) : Promise.resolve();
      },
      onRemoved: (listener) => { removed = listener; return () => undefined; },
    },
    observe: { attach: () => { calls.push('attach'); }, detach: () => { calls.push('detach'); } },
    setCaptureEnabled: (active) => { calls.push(`capture ${active}`); return Promise.resolve(); },
    startModule: () => { calls.push('module'); return Promise.resolve(); },
    failed: () => { calls.push('failed'); },
  });
  let service = wake();
  return { get service() { return service; }, store, calls, closedOnReload, vanishOnReload,
    sleep: () => { changed = () => undefined; settingsChanged = () => undefined; removed = () => undefined; },
    wake: () => { service = wake(); },
    settingsChanged: () => settingsChanged(), grant: (value: boolean) => { granted = value; changed(value); },
    retainedPermissions: () => { granted = true; }, close: (tab: number) => { live = live.filter((id) => id !== tab); removed(tab); } };
}

describe('[host:fansly] [EX-004] FS-PERM-2 optional activation and serialized registrations', () => {
  it('leftover rights do not switch a disabled site on; no tabs query before a grant', async () => {
    const world = setup(); await world.service.start();
    expect(world.calls).not.toContain('query');
    world.retainedPermissions(); await world.service.start();
    expect(await world.service.state()).toMatchObject({ enabled: false, granted: true, registered: false });
  });
  it('grant completes enabled in settings without the popup; revoke and regrant serialize with startup and the switch', async () => {
    const world = setup(); const start = world.service.start();
    world.grant(true); await start; await world.service.idle();
    expect(await world.service.state()).toMatchObject({ enabled: true, registered: true, waitingReload: 2 });
    expect(world.calls).toContain('module');
    world.grant(false); await world.service.idle();
    expect(await world.service.state()).toMatchObject({ enabled: true, granted: false, registered: false });
    world.grant(true); await world.service.idle();
    await world.service.setEnabled(false);
    expect(await world.service.state()).toMatchObject({ enabled: false, granted: true, registered: false });
  });
  it.each(['startup', 'onAdded', 'startup only'] as const)('a prompt left open across sleep: %s announces the grant exactly once', async (first) => {
    const world = setup();
    await world.service.start();
    world.grant(true); await world.service.idle();
    world.grant(false); await world.service.idle();
    // As in P3b: settings stay enabled after revocation. Firefox's prompt is
    // open, the popup closes, and the event page sleeps before Allow is clicked.
    world.sleep(); world.calls.length = 0;
    world.grant(true);
    world.wake();
    if (first === 'onAdded') world.grant(true);
    const started = world.service.start();
    if (first === 'startup') world.grant(true);
    await started; await world.service.idle();
    expect(await world.service.state()).toMatchObject({ enabled: true, granted: true, registered: true, waitingReload: 2 });
    expect(world.store.read('reload')).toEqual([1, 2]);
    expect(world.calls.filter((call) => call.startsWith('notice'))).toEqual(['notice 1', 'notice 2']);
    expect(world.calls.filter((call) => call.startsWith('reload'))).toEqual([]);
    if (first !== 'startup only') expect(world.calls).toContain('module');
  });
  it.each([false, true])('a restart with an announced grant adds no notice (tabs already reloaded: %s)', async (reloaded) => {
    const world = setup(); await world.service.start(); world.grant(true); await world.service.idle();
    if (reloaded) { await world.service.registered(1); await world.service.registered(2); }
    world.sleep(); world.calls.length = 0; world.wake();
    await world.service.start(); await world.service.idle();
    expect(await world.service.state()).toMatchObject({ enabled: true, granted: true, registered: true, waitingReload: reloaded ? 0 : 2 });
    expect(world.calls).not.toContain('query');
    expect(world.calls.filter((call) => call.startsWith('notice'))).toEqual([]);
  });
  it('switching off and back on with retained rights notices tabs once', async () => {
    const world = setup(); await world.service.start(); world.grant(true); await world.service.idle();
    await world.service.setEnabled(false); await world.service.idle();
    world.calls.length = 0;
    await world.service.setEnabled(true); await world.service.idle();
    expect((await world.service.state()).waitingReload).toBe(2);
    expect(world.calls.filter((call) => call.startsWith('notice'))).toEqual(['notice 1', 'notice 2']);
  });
  it('FS-IDN-4 installs the notice after grant and update, keeps a durable count, clears it on handshake/close, reloads only on click', async () => {
    const world = setup(); await world.service.start(); world.grant(true); await world.service.idle();
    expect(world.calls.filter((call) => call.startsWith('notice'))).toEqual(['notice 1', 'notice 2']);
    expect(world.calls.filter((call) => call.startsWith('reload'))).toEqual([]);
    expect(world.store.read('reload')).toEqual([1, 2]);
    await world.service.registered(1); world.close(2); await world.service.idle();
    expect((await world.service.state()).waitingReload).toBe(0);
    await world.service.installed();
    expect((await world.service.state()).waitingReload).toBe(1);
    await world.service.reload(); expect(world.calls).toContain('reload 1');
  });
});

  it('[host:fansly] state reads and unrelated settings changes do not re-register or write', async () => {
    const world = setup(); await world.service.start(); world.grant(true); await world.service.idle();
    const calls = [...world.calls]; const writes = world.store.calls.set;
    await world.service.state(); world.settingsChanged(); await world.service.idle();
    expect(world.service.active()).toBe(true);
    expect(world.calls).toEqual(calls);
    expect(world.store.calls.set).toBe(writes);
  });
  it('[host:fansly] a failed reload retains its waiting tab without losing the successful count', async () => {
    const world = setup(); await world.service.start(); world.grant(true); await world.service.idle();
    world.closedOnReload.add(2);
    await expect(world.service.reload()).resolves.toMatchObject({ waitingReload: 1, reloaded: 1 });
    expect(world.store.read('reload')).toEqual([2]);
    expect(world.calls).toContain('reload 1'); expect(world.calls).toContain('reload 2');
  });

  it('[host:fansly] a tab closed between list and reload is removed while the other reload succeeds', async () => {
    const world = setup(); await world.service.start(); world.grant(true); await world.service.idle();
    world.vanishOnReload.add(2);
    await expect(world.service.reload()).resolves.toMatchObject({ waitingReload: 0, reloaded: 1 });
    expect(world.store.read('reload')).toEqual([]);
  });

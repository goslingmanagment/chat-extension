import { describe, expect, it } from 'vitest';
import { createSiteAccess } from './site-access';
import { createMemoryKv } from './test-support/memory-kv';

function setup() {
  const store = createMemoryKv();
  let enabled = false;
  let granted = false;
  let changed: (added: boolean) => void = () => undefined;
  let settingsChanged: () => void = () => undefined;
  let removed: (tab: number) => void = () => undefined;
  let live = [1, 2];
  const calls: string[] = [];
  const service = createSiteAccess({ host: 'fansly-web', key: 'reload', storage: store.open(),
    settings: {
      enabled: () => Promise.resolve(enabled),
      setEnabled: (value) => { enabled = value; settingsChanged(); return Promise.resolve(); },
      onChange: (listener) => { settingsChanged = listener; return () => undefined; },
    },
    permissions: { has: () => Promise.resolve(granted), onChange: (listener) => { changed = listener; return () => undefined; } },
    syncScripts: (active) => { calls.push(`scripts ${active}`); return Promise.resolve(); },
    tabs: {
      list: () => { calls.push('query'); return Promise.resolve([...live]); },
      notice: (tab) => { calls.push(`notice ${tab}`); return Promise.resolve(); },
      reload: (tab) => { calls.push(`reload ${tab}`); return Promise.resolve(); },
      onRemoved: (listener) => { removed = listener; return () => undefined; },
    },
    observe: { attach: () => { calls.push('attach'); }, detach: () => { calls.push('detach'); } },
    setCaptureEnabled: (active) => { calls.push(`capture ${active}`); return Promise.resolve(); },
    startModule: () => { calls.push('module'); return Promise.resolve(); },
    failed: () => { calls.push('failed'); },
  });
  return { service, store, calls, grant: (value: boolean) => { granted = value; changed(value); },
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

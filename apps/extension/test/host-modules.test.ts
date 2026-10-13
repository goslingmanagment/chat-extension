// The loader of the sites' background chunks (docs/project-unite/architecture.md §3.3; spike.md п. 1): one load and
// one start per realm, a failure as the site's state with its stage, the next try only with the next trigger — after
// RETRY_AFTER_MS, at most MAX_ATTEMPTS times, each at a new address (Firefox keeps a module whose evaluation threw under
// its address) — events only to a module that runs or is starting, and the start with the background only for a site
// with unfinished work.

import type { LogEntry } from '@cg/core/services';
import { describe, expect, it } from 'vitest';

import type { BackgroundHostHandle, BackgroundKit, HostModuleEvent, VerifiedTabMessage } from '../src/composition/background/host-module.ts';
import { MAX_ATTEMPTS, RETRY_AFTER_MS, createHostModules, type HostModuleSpec } from '../src/composition/background/host-modules.ts';

const SPEC: HostModuleSpec = { chunk: 'bg/chatspace.js', pending: { local: ['send.journal'], session: [] } };
const KIT = { marker: 'the core kit' } as unknown as BackgroundKit;
const FUSE_STATE: VerifiedTabMessage = { type: 'send.fuseState', payload: {}, sender: { kind: 'page' } };

interface FakeHandle extends BackgroundHostHandle {
  readonly events: HostModuleEvent[];
}

function fakeHandle(over: Partial<BackgroundHostHandle> = {}): FakeHandle {
  const events: HostModuleEvent[] = [];
  return {
    events,
    onTabMessage: () => Promise.resolve({ ok: true, payload: { fuse: null, resetAt: null } }),
    onEvent: (event) => {
      events.push(event);
      return Promise.resolve();
    },
    facts: () => ({ sends: { open: 1, uncertain: 2, journal: [] } }),
    dispose: () => Promise.resolve(),
    ...over,
  };
}

/** A loader whose answers are scripted per load, in order; the addresses it was asked for are kept. */
function world(script: Array<'ok' | 'missing' | 'not-a-module' | 'other-host' | 'start-throws' | ((kit: BackgroundKit) => Promise<BackgroundHostHandle>)>) {
  let now = 1_000_000;
  const loads: string[] = [];
  const kits: BackgroundKit[] = [];
  const handles: FakeHandle[] = [];
  const logs: LogEntry[] = [];
  const modules = createHostModules({
    specs: { chatspace: SPEC },
    kit: KIT,
    url: (path) => `moz-extension://uuid/${path}`,
    load(url) {
      loads.push(url);
      const step = script.shift() ?? 'ok';
      if (step === 'missing') return Promise.reject(new TypeError('error loading dynamically imported module'));
      if (step === 'not-a-module') return Promise.resolve({ something: 1 });
      if (step === 'other-host') return Promise.resolve({ default: { host: 'fansly-web', start: () => Promise.resolve(fakeHandle()) } });
      const start =
        step === 'start-throws'
          ? () => Promise.reject(new RangeError('broken start'))
          : step === 'ok'
            ? (kit: BackgroundKit) => {
                kits.push(kit);
                const handle = fakeHandle();
                handles.push(handle);
                return Promise.resolve(handle);
              }
            : step;
      return Promise.resolve({ default: { host: 'chatspace', start } });
    },
    now: () => now,
    log: { write: (entry) => logs.push(entry) },
  });
  return {
    modules,
    loads,
    kits,
    handles,
    logs,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('the sites’ background modules (R20 F1)', () => {
  it('one load and one start per realm: callers at the same time share them; the module gets the core’s kit; its address is the chunk’s own', async () => {
    const w = world(['ok']);
    expect(w.modules.states()).toEqual([{ host: 'chatspace', state: 'idle' }]);
    const [a, b] = await Promise.all([w.modules.ensure('chatspace'), w.modules.ensure('chatspace')]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(await w.modules.ensure('chatspace')).toBe(a);
    expect(w.loads).toEqual(['moz-extension://uuid/bg/chatspace.js']);
    expect(w.kits).toEqual([KIT]);
    expect(w.modules.states()).toEqual([{ host: 'chatspace', state: 'started' }]);
    expect(w.logs.map((entry) => [entry.level, entry.msg, entry.fields?.['attempt']])).toEqual([['info', 'site module started', 1]]);
    // A site without a chunk has no module.
    expect(await w.modules.ensure('fansly-web')).toBeNull();
  });

  it('an import error: the site is `failed`, its requests answer CG-RUNTIME-UNREACHABLE; no new try before RETRY_AFTER_MS, then one at a new address', async () => {
    const w = world(['missing', 'ok']);
    expect(await w.modules.ensure('chatspace')).toBeNull();
    expect(w.modules.states()).toEqual([{ host: 'chatspace', state: 'failed' }]);
    expect(w.logs.at(-1)).toMatchObject({ level: 'error', msg: 'site module did not start', fields: { host: 'chatspace', attempt: 1, stage: 'import', error: 'TypeError' } });
    expect(await w.modules.request('chatspace', FUSE_STATE)).toEqual({ ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'chatspace services' } });
    w.advance(RETRY_AFTER_MS - 1);
    expect(await w.modules.ensure('chatspace')).toBeNull();
    expect(w.loads).toHaveLength(1);
    w.advance(1);
    expect(await w.modules.request('chatspace', FUSE_STATE)).toEqual({ ok: true, payload: { fuse: null, resetAt: null } });
    // Firefox keeps a module whose evaluation threw under its address: a try in the same realm is a new one.
    expect(w.loads).toEqual(['moz-extension://uuid/bg/chatspace.js', 'moz-extension://uuid/bg/chatspace.js?attempt=2']);
    expect(w.modules.states()).toEqual([{ host: 'chatspace', state: 'started' }]);
  });

  it('a file that is not the site’s module, and a start that throws, fail with their own stage; each try is a new address', async () => {
    const w = world(['not-a-module', 'other-host', 'start-throws', 'ok']);
    for (const stage of ['shape', 'shape', 'start']) {
      expect(await w.modules.ensure('chatspace')).toBeNull();
      expect(w.logs.at(-1)?.fields).toMatchObject({ stage });
      w.advance(RETRY_AFTER_MS);
    }
    expect(await w.modules.ensure('chatspace')).not.toBeNull();
    expect(w.loads.map((url) => url.replace('moz-extension://uuid/', ''))).toEqual(['bg/chatspace.js', 'bg/chatspace.js?attempt=2', 'bg/chatspace.js?attempt=3', 'bg/chatspace.js?attempt=4']);
  });

  it('at most MAX_ATTEMPTS tries in one realm: the next start of the event page tries afresh', async () => {
    const w = world(Array.from({ length: MAX_ATTEMPTS + 1 }, () => 'missing' as const));
    for (let i = 0; i < MAX_ATTEMPTS + 2; i += 1) {
      await w.modules.ensure('chatspace');
      w.advance(RETRY_AFTER_MS);
    }
    expect(w.loads).toHaveLength(MAX_ATTEMPTS);
    expect(w.modules.states()).toEqual([{ host: 'chatspace', state: 'failed' }]);
  });

  it('the background’s start: only a site with unfinished work stored starts its module', async () => {
    const idle = world(['ok']);
    await idle.modules.resume(() => Promise.resolve(false));
    expect(idle.loads).toEqual([]);
    expect(idle.modules.states()).toEqual([{ host: 'chatspace', state: 'idle' }]);
    const pending = world(['ok']);
    const asked: HostModuleSpec[] = [];
    await pending.modules.resume((spec) => {
      asked.push(spec);
      return Promise.resolve(true);
    });
    expect(asked).toEqual([SPEC]);
    expect(pending.modules.states()).toEqual([{ host: 'chatspace', state: 'started' }]);
  });

  it('events reach a module that runs, and one that is starting once it started; never one that is idle or failed; a module that did not take one rejects', async () => {
    const w = world(['ok']);
    await w.modules.notify({ kind: 'bootstrap' });
    expect(w.handles).toEqual([]);
    const starting = w.modules.ensure('chatspace');
    const told = w.modules.notify({ kind: 'clear-finished' });
    await starting;
    await told;
    await w.modules.notify({ kind: 'bootstrap' }, 'chatspace');
    await w.modules.notify({ kind: 'bootstrap' }, 'fansly-web');
    expect(w.handles[0]?.events).toEqual([{ kind: 'clear-finished' }, { kind: 'bootstrap' }]);

    const failing = world([() => Promise.resolve(fakeHandle({ onEvent: () => Promise.reject(new Error('journal unreadable')) }))]);
    await failing.modules.ensure('chatspace');
    await expect(failing.modules.notify({ kind: 'clear-finished' })).rejects.toThrow(/did not take clear-finished/);
  });

  it('the diagnostics: what the running modules know, and where each site stands; `settled` waits for a start in progress', async () => {
    let finish: (handle: BackgroundHostHandle) => void = () => undefined;
    const gate = new Promise<BackgroundHostHandle>((done) => (finish = done));
    const w = world([() => gate]);
    expect(w.modules.facts()).toEqual({});
    const starting = w.modules.ensure('chatspace');
    expect(w.modules.states()).toEqual([{ host: 'chatspace', state: 'starting' }]);
    const settled = w.modules.settled(5_000);
    finish(fakeHandle());
    await settled;
    await starting;
    expect(w.modules.states()).toEqual([{ host: 'chatspace', state: 'started' }]);
    expect(w.modules.facts()).toEqual({ sends: { open: 1, uncertain: 2, journal: [] } });
  });
});

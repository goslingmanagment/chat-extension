import { DEFAULT_SETTINGS } from '@cg/contracts/settings';
import { DEFAULT_SETTINGS_EXT } from '@cg/contracts/settings-ext';
import type { SettingsExtState } from '@cg/contracts/settings-ext';
import { SoundArbiter } from '@cg/core/services/sound';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMemoryKv } from '../../../packages/core/src/services/test-support/memory-kv.ts';
import { fanslyModule } from '../bg/fansly.ts';
import type { BackgroundKit } from '../src/composition/background/host-module.ts';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const clean of cleanups.splice(0)) await clean(); vi.useRealTimers(); });

async function world(readable = true) {
  const kv = createMemoryKv();
  const state = { readable, creator: '100', legacy: '110', canonical: '100' as string | null, ext: structuredClone(DEFAULT_SETTINGS_EXT), muted: [] as Array<`fansly-web:${string}`> };
  const listeners = new Set<(state: SettingsExtState) => void>();
  const settings = {
    state: vi.fn(() => Promise.resolve({ ok: state.readable, state: { ext: state.ext, revision: 0, readOnly: false } })),
    current: () => state.ext,
    onChange: (listener: (state: SettingsExtState) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
  };
  const module = await fanslyModule().start({
    settingsExt: settings,
    networkSession: { ready: Promise.resolve(), forTab: () => ({ legacyId: state.legacy, canonicalId: state.canonical }), aliases: (id: string) => id === state.canonical ? [id, state.legacy] : [] },
    storage: { local: kv.open() }, router: { tabs: () => ['tab'] },
    clock: { now: () => Date.now(), setTimer: (ms: number, fn: () => void) => setTimeout(fn, ms), clearTimer: (id: ReturnType<typeof setTimeout>) => clearTimeout(id) },
    log: { service: () => undefined },
  } as unknown as BackgroundKit);
  cleanups.push(() => module.dispose());
  const arbiter = new SoundArbiter({
    local: { get: (key) => Promise.resolve(kv.data.get(key)), set: (key, value) => { kv.data.set(key, value); return Promise.resolve(); } },
    clock: { now: () => Date.now(), setTimer: () => 0, clearTimer: () => undefined },
    settings: () => ({ ...DEFAULT_SETTINGS.sound, mutedAccounts: state.muted }), ownerSwitch: () => null, hostPermission: () => true,
    presence: { accounts: () => [{ host: 'fansly-web', hostAccountId: state.creator, platform: 'fansly', platformAccountId: state.creator, username: null, displayName: null }], listeningTabs: () => 1, isChatInFocus: () => false },
    stream: { policy: (_host, id) => module.sound?.(id, 21) ?? null, listening: () => true, focused: () => false },
    audio: { play: () => Promise.resolve({ played: true }) },
  });
  await arbiter.restore();
  const send = (id: string) => arbiter.handleBatch('tab', { host: 'fansly-web', hostAccountId: state.creator, events: [{ kind: 'message', id, conversationRef: '300', senderId: '200', fromFan: true, automatic: false, tip: false, sentAt: new Date().toISOString() }] });
  return { state, module, arbiter, settings, kv, send, changed: () => { for (const fn of listeners) fn({ ext: state.ext, revision: 1, readOnly: false }); } };
}

describe('[host:fansly] P14a review regressions', () => {
  it('[SN-006] an old tab session alias never becomes the new creator’s mute, including after the correct session arrives', async () => {
    const w = await world();
    await w.arbiter.rememberAccounts();
    w.state.creator = '101'; // Presence moved before the passive network session.
    await w.arbiter.rememberAccounts();
    w.state.legacy = '111'; w.state.canonical = '101';
    w.state.muted = ['fansly-web:110'];
    expect(await w.send('900')).toEqual(['played']);
    expect(w.kv.data.get('sound.accounts')).toContainEqual(['fansly:101', ['101', '111']]);
  });

  it('[SN-006] an unresolved legacy identity is not evidence of a canonical alias', async () => {
    const w = await world();
    w.state.canonical = null;
    expect(w.module.sound?.('100', 21)?.aliases).not.toContain('110');
  });

  it('[SN-001] a failed settings read retries without restarting the module', async () => {
    vi.useFakeTimers();
    const w = await world(false);
    expect(w.module.sound?.('100', 21)).toBeNull();
    w.state.readable = true;
    await vi.advanceTimersByTimeAsync(1100);
    expect(w.module.sound?.('100', 21)).toMatchObject({ tones: { message: 'chime' } });
    expect(w.settings.state.mock.calls.length).toBeGreaterThan(1);
  });

  it('[SN-013] a settings change after an initial read failure re-reads readiness and uses the new tones', async () => {
    const w = await world(false);
    w.state.readable = true;
    w.state.ext.hosts['fansly-web'].sound.messagesTone = 'bell';
    w.changed();
    await new Promise((resolve) => setImmediate(resolve));
    expect(w.module.sound?.('100', 21)).toMatchObject({ tones: { message: 'bell' } });
  });
});

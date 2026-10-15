import { DEFAULT_SETTINGS, type HostAccount, type SettingsV1 } from '@cg/contracts';
import type { SoundBatch, SoundStreamEvent } from '@cg/contracts/sound';
import { DEFAULT_FANSLY_SETTINGS } from '@cg/contracts/settings-ext';
import { TONES, type SoundTone, type SoundTones } from '@cg/core/domain/sound';
import { SoundArbiter } from '@cg/core/services/sound';
import { describe, expect, it } from 'vitest';

import { FakeClock, MemoryStore } from './support/clock';

const NOW = Date.parse('2026-10-15T10:00:00Z');
const account = (id: string): HostAccount => ({ host: 'fansly-web', hostAccountId: id, platform: 'fansly', platformAccountId: id, username: null, displayName: null });
const message = (id = '900', changes: Partial<Extract<SoundStreamEvent, { kind: 'message' }>> = {}): SoundStreamEvent => ({ kind: 'message', id, conversationRef: '500', senderId: '200', fromFan: true, automatic: false, tip: false, sentAt: new Date(NOW).toISOString(), ...changes });
const follow = (id = '900', changes: Partial<Extract<SoundStreamEvent, { kind: 'subscriber' }>> = {}): SoundStreamEvent => ({ kind: 'subscriber', id, accountId: '100', followerId: '200', ...changes });
const batch = (...events: SoundStreamEvent[]): SoundBatch => ({ host: 'fansly-web', hostAccountId: '100', events });

function world(local = new MemoryStore(), session = new MemoryStore()) {
  const clock = new FakeClock(NOW);
  const state = {
    sound: structuredClone(DEFAULT_SETTINGS.sound) as SettingsV1['sound'] | null,
    owner: null as boolean | null, permission: true, listening: true, focused: false,
    accounts: [account('100'), account('101')], aliases: ['110'],
    tones: { message: DEFAULT_FANSLY_SETTINGS.sound.messagesTone, subscriber: DEFAULT_FANSLY_SETTINGS.sound.subscribersTone } as SoundTones,
    prepare: () => Promise.resolve(true), plays: true,
  };
  const played: SoundTone[] = [];
  const arbiter = new SoundArbiter({
    clock, local, session, settings: () => state.sound, ownerSwitch: () => state.owner, hostPermission: () => state.permission,
    presence: { accounts: () => state.accounts, listeningTabs: () => state.listening ? 2 : 0, isChatInFocus: () => false },
    audio: { prepare: () => state.prepare(), play: (tone) => { if (state.plays) played.push(tone); return Promise.resolve(state.plays ? { played: true } : { played: false, code: 'CG-AUDIO-BLOCKED', reason: 'test' }); } },
    stream: {
      policy: (_host, id) => ({ tones: state.tones, aliases: id === '100' ? state.aliases : [] }),
      listening: () => state.listening,
      focused: () => state.focused,
    },
  });
  return { state, arbiter, played, clock, local, session, hear: (...events: SoundStreamEvent[]) => arbiter.handleBatch('tab-a', batch(...events)) };
}

describe('[host:fansly] [FS-SND-1] socket facts in the one sound arbiter', () => {
  it('[SN-002] remembers a quiet tab’s aliases before any sound event, across browser restart', async () => {
    const w = world();
    await w.arbiter.restore();
    await w.arbiter.rememberAccounts();
    expect(w.played).toHaveLength(0);
    const next = world(w.local);
    next.state.accounts = [account('101')];
    next.state.aliases = [];
    await next.arbiter.restore();
    expect(await next.arbiter.handleBatch('tab-b', { host: 'fansly-web', hostAccountId: '101', events: [message('1', { senderId: '110' })] })).toEqual(['not-fan']);
  });
  it('[SN-002] own creator, aliases and previously seen models stay silent across browser restart', async () => {
    const w = world();
    await w.arbiter.restore();
    expect(await w.hear(message('901', { senderId: '100' }), message('902', { senderId: '110' }), message('903', { senderId: '101' }))).toEqual(['not-fan', 'not-fan', 'not-fan']);
    const next = world(w.local);
    next.state.accounts = [account('100')];
    next.state.aliases = [];
    await next.arbiter.restore();
    expect(await next.hear(message('904', { senderId: '110' }), message('905', { senderId: '101' }))).toEqual(['not-fan', 'not-fan']);
    expect(next.played).toHaveLength(0);
  });
  it('[SN-003] [SN-004] [SN-005] drops automatic messages, tips, missing timestamps and history older than 180 seconds', async () => {
    const w = world();
    expect(await w.hear(message('1', { automatic: true }), message('2', { tip: true }), message('3', { sentAt: null }), message('4', { sentAt: new Date(NOW - 180001).toISOString() }), message('5', { sentAt: new Date(NOW - 180000).toISOString() }))).toEqual(['automatic', 'tip', 'no-time', 'stale', 'played']);
  });
  it('[SN-006] a model mute and the per-page owner switch silence both sounds; signed out still works', async () => {
    const w = world();
    w.state.sound = { ...DEFAULT_SETTINGS.sound, mutedAccounts: ['fansly-web:100'] };
    expect(await w.hear(message('1'), follow('1'))).toEqual(['muted', 'muted']);
    w.state.sound = DEFAULT_SETTINGS.sound;
    w.state.owner = false;
    expect(await w.hear(message('2'), follow('2'))).toEqual(['disabled', 'disabled']);
    w.state.owner = null;
    expect(await w.hear(follow('3'))).toEqual(['played']);
    expect(await w.hear(message('3'))).toEqual(['played']);
  });
  it('[SN-007] [SN-008] only a still-bound listening tab can ring, and a visible focused group stays silent', async () => {
    const w = world();
    w.state.listening = false;
    expect(await w.hear(message())).toEqual(['tab-closed']);
    w.state.listening = true;
    w.state.focused = true;
    expect(await w.hear(message())).toEqual(['open-chat']);
    w.state.focused = false;
    expect(await w.hear(message())).toEqual(['duplicate']);
  });
  it('[SN-009] [SN-010] ordered batches and competing tabs share deduplication and throttle; followers never steal a message', async () => {
    const w = world();
    expect(await w.hear(follow('1'), message('1'), message('2'), follow('2'))).toEqual(['played', 'played', 'throttled', 'throttled']);
    expect(await w.arbiter.handleBatch('tab-b', batch(message('1'), follow('1')))).toEqual(['duplicate', 'duplicate']);
    await w.clock.advance(2000);
    expect(await w.hear(message('3'))).toEqual(['played']);
    await w.clock.advance(10000);
    expect(await w.hear(follow('3'))).toEqual(['played']);
    await w.arbiter.flush();
    const next = world(w.local, w.session);
    await next.arbiter.restore();
    expect(await next.hear(message('1'), follow('1'))).toEqual(['duplicate', 'duplicate']);
  });
  it('[SN-010] the same event id on another account remains independent', async () => {
    const w = world();
    expect(await w.hear(message())).toEqual(['played']);
    await w.clock.advance(2000);
    expect(await w.arbiter.handleBatch('tab-b', { ...batch(message()), hostAccountId: '101' })).toEqual(['played']);
  });
  it('[SN-011] regates after audio wakes: mute, focus, permission, identity and the owner switch', async () => {
    for (const [change, wanted] of [
      [(w: ReturnType<typeof world>) => { w.state.listening = false; }, 'tab-closed'],
      [(w: ReturnType<typeof world>) => { w.state.focused = true; }, 'open-chat'],
      [(w: ReturnType<typeof world>) => { w.state.permission = false; }, 'no-permission'],
      [(w: ReturnType<typeof world>) => { w.state.sound = { ...DEFAULT_SETTINGS.sound, mutedAccounts: ['fansly-web:100'] }; }, 'muted'],
      [(w: ReturnType<typeof world>) => { w.state.owner = false; }, 'disabled'],
    ] as const) {
      const w = world();
      w.state.prepare = () => { change(w); return Promise.resolve(true); };
      expect(await w.hear(message())).toEqual([wanted]);
      expect(w.played).toHaveLength(0);
    }
  });
  it('a stored alias mute follows its canonical model and silences both kinds', async () => {
    const w = world();
    w.state.sound = { ...DEFAULT_SETTINGS.sound, mutedAccounts: ['fansly-web:110'] };
    expect(await w.hear(message(), follow())).toEqual(['muted', 'muted']);
  });
  it('unknown recipient does not consume a follow; aliases bind it, unrelated recipients do not', async () => {
    const w = world();
    expect(await w.hear(follow('1', { accountId: '999' }))).toEqual(['account-unknown']);
    expect(await w.hear(follow('1', { accountId: '110' }))).toEqual(['played']);
    expect(await w.hear(follow('2', { followerId: '101' }))).toEqual(['not-fan']);
  });
  it('[SN-014] [SN-015] failed audio reserves no pause; diagnostics count message and subscriber outcomes separately', async () => {
    const w = world();
    w.state.plays = false;
    expect(await w.hear(message('1'))).toEqual(['audio-error']);
    w.state.plays = true;
    expect(await w.hear(message('2'), follow('2'))).toEqual(['played', 'throttled']);
    expect(w.arbiter.diagnostics().outcomes).toEqual({ 'audio-error': 1, played: 1, 'subscriber.throttled': 1 });
  });
});

describe('[host:fansly] [FS-SND-2] site tones', () => {
  it('[SN-013] [ST-127] [ST-129] defaults are chime/double; site choices win even when v1 chose different tones', async () => {
    const w = world();
    w.state.sound = { ...DEFAULT_SETTINGS.sound, messages: { on: true, tone: 'bell' } };
    expect(await w.hear(follow('1'), message('1'))).toEqual(['played', 'played']);
    expect(w.played).toEqual([TONES.double, TONES.chime]);
    await w.clock.advance(10000);
    w.state.tones = { message: 'blip', subscriber: 'bell' };
    expect(await w.hear(follow('2'), message('2'))).toEqual(['played', 'played']);
    expect(w.played.slice(-2)).toEqual([TONES.bell, TONES.blip]);
  });
});

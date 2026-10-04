// What the page tells the tab and the tab passes on (tab/host-facts.ts).

import type { HostEvent } from '@cg/contracts/host';
import type { Bootstrap } from '@cg/contracts/hub';
import type { ChatSpaceHostPort, ChatSpaceLiveConfig } from '@cg/host-chatspace/isolated';
import { describe, expect, it } from 'vitest';

import type { ControllerRpc } from './client';
import { forwardHostFacts, knownBootstrap, liveConfigOf } from './host-facts';

const CHAT = { host: 'chatspace' as const, hostAccountId: '910101', platformFanId: '74001001' };
const PROFILE = { adapterVersion: '0.2.0', modules: { notificationEntry: 'a', composables: 'b', messages: 'c', accounts: 'd', inbox: 'e' } };

function bootstrap(over: { flags?: Record<string, boolean>; previewSend?: boolean; profiles?: unknown[]; navSec?: number } = {}): Bootstrap {
  return {
    flags: { wsTap: true, previewSend: true, previewSendMarkAiGenerated: true, ...over.flags },
    pages: [{ pageId: 11, features: { previewSend: { available: over.previewSend ?? true } } }],
    limits: { navInsertTimeoutSec: over.navSec ?? 20, previewSendReceiptProfiles: over.profiles ?? [PROFILE] },
  } as unknown as Bootstrap;
}

function world(state = 'ready') {
  const sent: [string, unknown][] = [];
  const configured: ChatSpaceLiveConfig[] = [];
  const timeouts: number[] = [];
  const failures: string[] = [];
  let listener: (event: HostEvent) => void = () => undefined;
  let subscribed = 0;
  const host = {
    subscribe(next: (event: HostEvent) => void) {
      listener = next;
      subscribed += 1;
      return () => {
        subscribed -= 1;
      };
    },
    configure(config: ChatSpaceLiveConfig) {
      configured.push(config);
      return config.wsTap ? Promise.resolve({}) : Promise.reject(new Error('bridge'));
    },
  } as unknown as ChatSpaceHostPort;
  const rpc = {
    state: () => state,
    request(type: string, payload: unknown) {
      sent.push([type, payload]);
      return Promise.resolve({ ok: true, payload: { recorded: true } });
    },
  } as unknown as ControllerRpc;
  const facts = forwardHostFacts({ host, rpc, setNavInsertTimeoutMs: (ms) => void timeouts.push(ms), onFailure: (what) => void failures.push(what) });
  return { facts, sent, configured, timeouts, failures, emit: (event: HostEvent) => listener(event), subscribed: () => subscribed };
}

const incoming: Extract<HostEvent, { type: 'incoming' }>['fact'] = { host: 'chatspace', hostAccountId: '910101', platformFanId: '74001001', platformMessageId: '5001', fromFan: true, automatic: false, tip: false, sentAt: null, socketEpoch: 1, fanSequence: 3, source: 'ws-tap' };
const humanSend = (over: { platformMessageId?: string | null; insertIntentId?: string | null; edited?: boolean | null } = {}): HostEvent => ({
  type: 'humanSend',
  fact: {
    chat: CHAT,
    pendingId: 'pending-1',
    platformMessageId: over.platformMessageId === undefined ? '9001' : over.platformMessageId,
    textDigest: 'd'.repeat(16),
    draft: { revision: 4, provenance: 'our-insert-edited', insertIntentId: over.insertIntentId === undefined ? 'intent-1' : over.insertIntentId, editedSinceInsert: over.edited === undefined ? true : over.edited },
  } as never,
});

describe('the bootstrap → part B of the host adapter', () => {
  it('nobody signed in: the tap, X8 and the AI mark are off, no receipt profile', () => {
    expect(liveConfigOf(null)).toEqual({ wsTap: false, previewSend: false, markAiGenerated: false, receiptProfiles: [] });
  });

  it('[X8-01] the owner’s flags and the receipt profiles of `limits` go to the adapter as they are; X8 needs the flag and a page it is available on', () => {
    expect(liveConfigOf(bootstrap())).toEqual({ wsTap: true, previewSend: true, markAiGenerated: true, receiptProfiles: [PROFILE] });
    expect(liveConfigOf(bootstrap({ previewSend: false })).previewSend).toBe(false);
    expect(liveConfigOf(bootstrap({ flags: { previewSend: false } })).previewSend).toBe(false);
    expect(liveConfigOf(bootstrap({ flags: { wsTap: false, previewSendMarkAiGenerated: false }, profiles: [] }))).toMatchObject({ wsTap: false, markAiGenerated: false, receiptProfiles: [] });
    // An unknown flag name is «off», never «on».
    expect(liveConfigOf({ ...bootstrap(), flags: {} })).toMatchObject({ wsTap: false, previewSend: false, markAiGenerated: false });
  });

  it('the adapter is configured once per change, and the deadline of «Открыть и вставить» is the bootstrap’s', async () => {
    const w = world();
    w.facts.configure(bootstrap());
    w.facts.configure(bootstrap());
    w.facts.configure(bootstrap({ navSec: 30, flags: { previewSend: false } }));
    w.facts.configure(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(w.configured.map((config) => [config.wsTap, config.previewSend])).toEqual([[true, true], [true, false], [false, false]]);
    expect(w.timeouts).toEqual([20_000, 20_000, 30_000]);
    // The adapter did not take a configuration: said once, with what it was.
    expect(w.failures).toEqual(['configure']);
  });
});

describe('facts of the page → the background', () => {
  it('[SN-016] every incoming-message fact goes to the background’s one sound arbiter as it is — the tab decides nothing', () => {
    const w = world();
    w.emit({ type: 'incoming', fact: incoming });
    w.emit({ type: 'incoming', fact: { ...incoming, fromFan: false, automatic: true } });
    expect(w.sent).toEqual([['sound.event', { fact: incoming }], ['sound.event', { fact: { ...incoming, fromFan: false, automatic: true } }]]);
  });

  it('a tab without a port keeps the fact to itself: nothing is queued for later', () => {
    const w = world('reconnecting');
    w.emit({ type: 'incoming', fact: incoming });
    expect(w.sent).toEqual([]);
  });

  it('[TL-004] a human send of a board’s insert is reported for that part’s operation — once, with the id of the send’s own response', () => {
    const w = world();
    w.facts.noteInsert('intent-1', 'op-1', { index: 1 });
    w.emit(humanSend());
    w.emit(humanSend());
    expect(w.sent).toEqual([['op.reportSent', { opId: 'op-1', part: { index: 1 }, pendingId: 'pending-1', platformMessageId: '9001', edited: true }]]);
  });

  it('[TL-004] an attribution that is not known is never guessed: no id, a draft that is not our insert, an insert of another surface', () => {
    const w = world();
    w.facts.noteInsert('intent-1', 'op-1', { index: 0 });
    w.emit(humanSend({ platformMessageId: null }));
    w.emit(humanSend({ insertIntentId: null, edited: null }));
    w.emit(humanSend({ insertIntentId: 'intent-of-the-dock' }));
    w.emit({ type: 'route', route: { epoch: 2, name: 'chat', account: null, chat: CHAT } });
    expect(w.sent).toEqual([]);
    // The insert is still remembered: its own send is reported.
    w.emit(humanSend({ edited: false }));
    expect(w.sent).toHaveLength(1);
  });

  it('only the last 64 inserts are remembered; dispose stops listening', () => {
    const w = world();
    for (let index = 0; index < 65; index += 1) w.facts.noteInsert(`intent-${index}`, `op-${index}`, { index: 0 });
    w.emit(humanSend({ insertIntentId: 'intent-0' }));
    expect(w.sent).toEqual([]);
    w.emit(humanSend({ insertIntentId: 'intent-64' }));
    expect(w.sent).toHaveLength(1);
    w.facts.dispose();
    expect(w.subscribed()).toBe(0);
  });
});

describe('what the adapter is told while the tab learns who is signed in', () => {
  const ready = { s: 'ready' as const, value: bootstrap() };

  it('[NEW-08] «not known yet» is never «off»: the tap is told to stand down only by a sign-out or by the owner’s flag, never by a bootstrap still on its way', () => {
    // The first moments of the application: neither the sign-in nor the bootstrap is read.
    expect(knownBootstrap(undefined, { s: 'idle' })).toBeUndefined();
    expect(knownBootstrap(undefined, ready)).toBeUndefined();
    // Signed in, the bootstrap is being read — or the hub did not answer.
    expect(knownBootstrap({ epoch: 3 }, { s: 'loading' })).toBeUndefined();
    expect(knownBootstrap({ epoch: 3 }, { s: 'error' })).toBeUndefined();
    expect(knownBootstrap({ epoch: 3 }, ready)).toBe(ready.value);
    // Nobody is signed in: the flags went with the sign-in.
    expect(knownBootstrap(null, ready)).toBeNull();
    expect(knownBootstrap(null, { s: 'idle' })).toBeNull();
  });

  it('a tab that starts signed in configures the adapter once, with the bootstrap’s flags — no «off» before it', () => {
    const w = world();
    for (const known of [knownBootstrap(undefined, { s: 'idle' }), knownBootstrap({ epoch: 3 }, { s: 'loading' }), knownBootstrap({ epoch: 3 }, ready)]) {
      if (known !== undefined) w.facts.configure(known);
    }
    expect(w.configured.map((config) => config.wsTap)).toEqual([true]);
  });
});

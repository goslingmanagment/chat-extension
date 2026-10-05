// What the page tells the tab and the tab passes on (tab/host-facts.ts).

import type { HostContractReport, HostEvent } from '@cg/contracts/host';
import type { Bootstrap } from '@cg/contracts/hub';
import type { ChatSpaceHostPort, ChatSpaceLiveConfig } from '@cg/host-chatspace/isolated';
import { describe, expect, it } from 'vitest';

import type { ControllerRpc } from './client';
import { SENT_REPORT_TRIES, contractFactsOf, forwardHostFacts, knownBootstrap, liveConfigOf } from './host-facts';

const CHAT = { host: 'chatspace' as const, hostAccountId: '910101', platformFanId: '74001001' };
const PROFILE = { adapterVersion: '0.2.0', modules: { notificationEntry: 'a', composables: 'b', messages: 'c', accounts: 'd', inbox: 'e' } };

/**
 * A bootstrap as the hub answers it for a pilot switched on page by page: the page's own features carry the
 * switches, the top-level `flags` (the owner's `"*"` row) are whatever the test says — and decide nothing.
 */
function bootstrap(over: { off?: readonly string[]; star?: Record<string, boolean>; capabilities?: readonly string[]; profiles?: unknown[]; navSec?: number; pages?: number } = {}): Bootstrap {
  const features = Object.fromEntries(
    ['wsTap', 'previewSend', 'previewSendMarkAiGenerated'].map((flag) => [flag, (over.off ?? []).includes(flag) ? { available: false, reason: 'flag_off' } : { available: true }]),
  );
  return {
    flags: { wsTap: false, previewSend: false, previewSendMarkAiGenerated: false, ...over.star },
    pages: Array.from({ length: over.pages ?? 1 }, (_unused, index) => ({ pageId: 11 + index, pageLabel: `page-${index}`, platform: 'onlyfans', features })),
    capabilities: over.capabilities ?? ['preview-send-custody-v1'],
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
  const port = { state };
  /** Answers of the next requests, in order; an empty queue acknowledges. */
  const answers: unknown[] = [];
  const stateListeners = new Set<(state: string) => void>();
  const rpc = {
    state: () => port.state,
    request(type: string, payload: unknown) {
      sent.push([type, payload]);
      return Promise.resolve(answers.shift() ?? { ok: true, payload: { recorded: true } });
    },
    onState(next: (state: string) => void) {
      stateListeners.add(next);
      return () => stateListeners.delete(next);
    },
  } as unknown as ControllerRpc;
  const facts = forwardHostFacts({ host, rpc, setNavInsertTimeoutMs: (ms) => void timeouts.push(ms), onFailure: (what) => void failures.push(what) });
  const setState = (next: string): void => {
    port.state = next;
    for (const heard of [...stateListeners]) heard(next);
  };
  return { facts, sent, configured, timeouts, failures, answers, setState, emit: (event: HostEvent) => listener(event), subscribed: () => subscribed, stateListeners: () => stateListeners.size };
}
const turns = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

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

  it('[X8-01] each part is on while its switch is usable on at least one granted page — the page\'s own feature, never the top-level flags; the receipt profiles of `limits` go as they are', () => {
    // The pilot switched on page by page: every top-level flag false, and the adapter is on.
    expect(liveConfigOf(bootstrap())).toEqual({ wsTap: true, previewSend: true, markAiGenerated: true, receiptProfiles: [PROFILE] });
    // A switch the page's own row has off is off, whatever the owner's `"*"` row says.
    expect(liveConfigOf(bootstrap({ off: ['previewSend'], star: { previewSend: true } })).previewSend).toBe(false);
    expect(liveConfigOf(bootstrap({ off: ['wsTap', 'previewSendMarkAiGenerated'], star: { wsTap: true, previewSendMarkAiGenerated: true }, profiles: [] }))).toMatchObject({ wsTap: false, markAiGenerated: false, receiptProfiles: [] });
    // X8 also needs what the hub serves for it (`preview-send-custody-v1`).
    expect(liveConfigOf(bootstrap({ capabilities: [] }))).toMatchObject({ wsTap: true, previewSend: false, markAiGenerated: true });
    // No granted page, or pages that list no such feature: «off», never «on» — whatever `"*"` says.
    expect(liveConfigOf(bootstrap({ pages: 0, star: { wsTap: true, previewSend: true, previewSendMarkAiGenerated: true } }))).toMatchObject({ wsTap: false, previewSend: false, markAiGenerated: false });
    expect(liveConfigOf({ ...bootstrap(), pages: [{ pageId: 11, pageLabel: 'page-0', platform: 'onlyfans', features: {} }] } as unknown as Bootstrap)).toMatchObject({ wsTap: false, previewSend: false, markAiGenerated: false });
  });

  it('the adapter is configured once per change, and the deadline of «Открыть и вставить» is the bootstrap’s', async () => {
    const w = world();
    w.facts.configure(bootstrap());
    w.facts.configure(bootstrap());
    w.facts.configure(bootstrap({ navSec: 30, off: ['previewSend'] }));
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

  it('[NF-019] a report the background never acknowledged (the port was lost under it) is said again when the port is back — the same report, a bounded number of times', async () => {
    const w = world();
    const lost = { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'port lost' } };
    w.facts.noteInsert('intent-1', 'op-1', { variant: 0, index: 0 });
    w.answers.push(lost);
    w.setState('reconnecting');
    w.emit(humanSend({ edited: false }));
    await turns();
    // Nobody heard it; nothing is said into a dead port.
    expect(w.sent).toHaveLength(1);
    w.setState('ready');
    await turns();
    const report = ['op.reportSent', { opId: 'op-1', part: { variant: 0, index: 0 }, pendingId: 'pending-1', platformMessageId: '9001', edited: false }];
    expect(w.sent).toEqual([report, report]);
    // Acknowledged: a later reconnect says nothing again.
    w.setState('reconnecting');
    w.setState('ready');
    await turns();
    expect(w.sent).toHaveLength(2);

    // A background that never answers is not asked for ever; its own refusal is an answer.
    const silent = world();
    silent.facts.noteInsert('intent-1', 'op-1', { index: 0 });
    for (let i = 0; i < SENT_REPORT_TRIES + 2; i += 1) silent.answers.push(lost);
    silent.emit(humanSend());
    await turns();
    await turns();
    expect(silent.sent).toHaveLength(SENT_REPORT_TRIES);
    const refused = world();
    refused.facts.noteInsert('intent-1', 'op-1', { index: 0 });
    refused.answers.push({ ok: false, error: { code: 'CG-AUTH-REQUIRED' } });
    refused.emit(humanSend());
    await turns();
    refused.setState('ready');
    await turns();
    expect(refused.sent).toHaveLength(1);
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
    expect(w.stateListeners()).toBe(0);
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

  it('a tab that starts signed in configures the adapter once, with the bootstrap’s switches — no «off» before it', () => {
    const w = world();
    for (const known of [knownBootstrap(undefined, { s: 'idle' }), knownBootstrap({ epoch: 3 }, { s: 'loading' }), knownBootstrap({ epoch: 3 }, ready)]) {
      if (known !== undefined) w.facts.configure(known);
    }
    expect(w.configured.map((config) => config.wsTap)).toEqual([true]);
  });
});

describe('the host contract in the tab’s log', () => {
  const report = (anchors: Record<string, string>, capabilities: Record<string, { state: string }> = {}): HostContractReport =>
    ({ build: 'index-abc', adapterVersion: '0.2.0', checkedAt: 1, anchors: { app: 'ok', router: 'ok', ...anchors }, capabilities: { insert: { state: 'on' }, ...capabilities } }) as unknown as HostContractReport;

  it('[DB-031] the tap and the preview send switched off are not a ChatSpace that changed: the record lists them and carries no error', () => {
    const off = contractFactsOf(report({ wsFrames: 'missing', receiptProfile: 'missing' }, { previewSend: { state: 'off' }, incoming: { state: 'off' } }));
    expect(off).toEqual({ build: 'index-abc', adapterVersion: '0.2.0', ok: true, missing: ['wsFrames', 'receiptProfile'], degraded: ['previewSend', 'incoming'] });
    expect(contractFactsOf(report({})).ok).toBe(true);
  });

  it('[ER-049] [DB-031] an anchor of ChatSpace itself that is gone is CG-HOST-CONTRACT, with or without the switched ones', () => {
    expect(contractFactsOf(report({ pendingMessages: 'missing' }))).toMatchObject({ ok: false, missing: ['pendingMessages'] });
    expect(contractFactsOf(report({ wsFrames: 'missing', composerBridge: 'changed' }))).toMatchObject({ ok: false, missing: ['wsFrames', 'composerBridge'] });
  });
});

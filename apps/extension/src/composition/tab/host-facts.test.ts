// What the page tells the tab and the tab passes on (tab/host-facts.ts).

import { ANCHOR_IDS, type HostContractReport, type HostContractShape, type HostEvent, type InsertIntent, type InsertReceipt, type NavigationIntent, type NavigationReceipt } from '@cg/contracts/host';
import type { Bootstrap } from '@cg/contracts/hub';
import type { SendFuseState } from '@cg/contracts/send';
import type { ChatSpaceHostPort, ChatSpaceLiveConfig } from '@cg/host-chatspace/isolated';
import { describe, expect, it } from 'vitest';

import type { ControllerRpc } from './client';
import { SENT_REPORT_TRIES, boardsHostOver, contractFactsOf, forwardHostFacts, knownBootstrap } from './host-facts';
import { CHATSPACE_APP, liveConfigOf } from './hosts/chatspace/app';

const CHAT = { host: 'chatspace' as const, hostAccountId: '910101', platformFanId: '74001001' };
const PROFILE = { adapterVersion: '0.3.0', modules: { notificationEntry: 'a', composables: 'b', onlyfans: 'c', accounts: 'd', inbox: 'e' } };

/**
 * A bootstrap as the hub answers it for a pilot switched on page by page: the page's own features carry the
 * switches, the top-level `flags` (the owner's `"*"` row) are whatever the test says — and decide nothing.
 */
function bootstrap(over: { off?: readonly string[]; notServed?: readonly string[]; star?: Record<string, boolean>; capabilities?: readonly string[]; profiles?: unknown[]; navSec?: number; pages?: number } = {}): Bootstrap {
  // `notServed` — the hub does not serve what the feature needs: the page's own feature says `hub_not_ready` (the hub's rule).
  const features = Object.fromEntries(
    ['wsTap', 'previewSend', 'previewSendMarkAiGenerated'].map((flag) => [
      flag,
      (over.off ?? []).includes(flag) ? { available: false, reason: 'flag_off' } : (over.notServed ?? []).includes(flag) ? { available: false, reason: 'hub_not_ready' } : { available: true },
    ]),
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
    probe: () => ({ build: 'index-p8xPkCj8' }),
  } as unknown as ChatSpaceHostPort;
  const port = { state };
  /** Answers of the next requests, in order; an empty queue acknowledges. */
  const answers: unknown[] = [];
  const stateListeners = new Set<(state: string) => void>();
  const eventListeners = new Map<string, (payload: unknown) => void>();
  /** The X8 fuse the background keeps (decision X25): read apart from the other requests. */
  const fuse = { state: { fuse: null, resetAt: null } as SendFuseState, reads: 0 };
  /** Who-sent facts (decision X48), apart from the other requests: every human send with an id has one. */
  const attributions = { sent: [] as unknown[], answers: [] as unknown[] };
  const rpc = {
    state: () => port.state,
    request(type: string, payload: unknown) {
      if (type === 'send.fuseState') {
        fuse.reads += 1;
        return Promise.resolve({ ok: true, payload: fuse.state });
      }
      if (type === 'attribution.report') {
        attributions.sent.push(payload);
        return Promise.resolve(attributions.answers.shift() ?? { ok: true, payload: { queued: true } });
      }
      sent.push([type, payload]);
      return Promise.resolve(answers.shift() ?? { ok: true, payload: { recorded: true } });
    },
    onState(next: (state: string) => void) {
      stateListeners.add(next);
      return () => stateListeners.delete(next);
    },
    onEvent(type: string, next: (payload: unknown) => void) {
      eventListeners.set(type, next);
      return () => eventListeners.delete(type);
    },
  } as unknown as ControllerRpc;
  const facts = forwardHostFacts({ host, site: CHATSPACE_APP, rpc, setNavInsertTimeoutMs: (ms) => void timeouts.push(ms), onFailure: (what) => void failures.push(what), now: () => Date.parse('2026-10-17T12:00:00.000Z') });
  const setState = (next: string): void => {
    port.state = next;
    for (const heard of [...stateListeners]) heard(next);
  };
  return {
    facts,
    sent,
    configured,
    timeouts,
    failures,
    answers,
    setState,
    fuse,
    attributions,
    event: (type: string, payload: unknown) => eventListeners.get(type)?.(payload),
    emit: (event: HostEvent) => listener(event),
    subscribed: () => subscribed,
    stateListeners: () => stateListeners.size,
  };
}
const turns = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

const incoming: Extract<HostEvent, { type: 'incoming' }>['fact'] = { host: 'chatspace', hostAccountId: '910101', platformFanId: '74001001', platformMessageId: '5001', fromFan: true, automatic: false, tip: false, sentAt: null, socketEpoch: 1, fanSequence: 3, source: 'ws-tap' };
const humanSend = (over: { platformMessageId?: string | null; insertIntentId?: string | null; edited?: boolean | null; cargo?: { priced: boolean; media: boolean } } = {}): HostEvent => ({
  type: 'humanSend',
  fact: {
    chat: CHAT,
    pendingId: 'pending-1',
    platformMessageId: over.platformMessageId === undefined ? '9001' : over.platformMessageId,
    textDigest: 'd'.repeat(16),
    draft: { revision: 4, provenance: 'our-insert-edited', insertIntentId: over.insertIntentId === undefined ? 'intent-1' : over.insertIntentId, editedSinceInsert: over.edited === undefined ? true : over.edited },
    ...(over.cargo === undefined ? {} : { cargo: over.cargo }),
  } as never,
});

describe('the bootstrap → part B of the ChatSpace host port (the application’s half of the ChatSpace adapter)', () => {
  it('nobody signed in: the tap, X8 and the AI mark are off, no receipt profile', () => {
    expect(liveConfigOf(null)).toEqual({ wsTap: false, previewSend: false, markAiGenerated: false, receiptProfiles: [], attribution: false });
  });

  it('[X8-01] each part is on while its switch is usable on at least one granted page — the page\'s own feature, never the top-level flags; the receipt profiles of `limits` go as they are', () => {
    // The pilot switched on page by page: every top-level flag false, and the adapter is on.
    expect(liveConfigOf(bootstrap())).toEqual({ wsTap: true, previewSend: true, markAiGenerated: true, receiptProfiles: [PROFILE], attribution: false });
    // A switch the page's own row has off is off, whatever the owner's `"*"` row says.
    expect(liveConfigOf(bootstrap({ off: ['previewSend'], star: { previewSend: true } })).previewSend).toBe(false);
    expect(liveConfigOf(bootstrap({ off: ['wsTap', 'previewSendMarkAiGenerated'], star: { wsTap: true, previewSendMarkAiGenerated: true }, profiles: [] }))).toMatchObject({ wsTap: false, markAiGenerated: false, receiptProfiles: [] });
    // X8 also needs what the hub serves for it (`preview-send-custody-v1`): a hub that does not serve it says so in
    // the page's own feature (`hub_not_ready`) — the hub's rule, which the client does not repeat.
    expect(liveConfigOf(bootstrap({ capabilities: [], notServed: ['previewSend'] }))).toMatchObject({ wsTap: true, previewSend: false, markAiGenerated: true });
    // No granted page, or pages that list no such feature: «off», never «on» — whatever `"*"` says.
    expect(liveConfigOf(bootstrap({ pages: 0, star: { wsTap: true, previewSend: true, previewSendMarkAiGenerated: true } }))).toMatchObject({ wsTap: false, previewSend: false, markAiGenerated: false });
    expect(liveConfigOf({ ...bootstrap(), pages: [{ pageId: 11, pageLabel: 'page-0', platform: 'onlyfans', features: {} }] } as unknown as Bootstrap)).toMatchObject({ wsTap: false, previewSend: false, markAiGenerated: false });
  });

  it('[X48] every human send is followed to its receipt while the hub records who sent each message and the tap is on somewhere', () => {
    expect(liveConfigOf(bootstrap({ capabilities: ['send-attribution-v1'] })).attribution).toBe(true);
    // The receipt pairs with the tap's echo: no tap, nothing to follow it with.
    expect(liveConfigOf(bootstrap({ capabilities: ['send-attribution-v1'], off: ['wsTap'] })).attribution).toBe(false);
    // A hub that does not record it is never told, and MAIN follows only drafts of ours, as before.
    expect(liveConfigOf(bootstrap({ capabilities: ['preview-send-custody-v1'] })).attribution).toBe(false);
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

  it('[TL-004] [NF-019] the page writes the text first and answers a frame later: a Send seen before the insert’s receipt is back is still that part’s `sent` — the board’s insert is known before it starts', async () => {
    const applied: InsertReceipt = { state: 'applied', draftRevision: 3, draftDigest: 'a'.repeat(16), ms: 4 };
    const insert = { intentId: 'intent-1', operationId: 'op-1', part: { index: 1 } } as unknown as InsertIntent;
    const navigation = { intentId: 'nav-1', thenInsert: insert } as unknown as NavigationIntent;
    const report = ['op.reportSent', { opId: 'op-1', part: { index: 1 }, pendingId: 'pending-1', platformMessageId: '9001', edited: false }];
    /** The page: each call is answered when the test says so (MAIN's receipt comes a microtask and a frame after its write). */
    const page = () => {
      const calls: string[] = [];
      let answerNavigate: (receipt: NavigationReceipt) => void = () => undefined;
      let failNavigate: (error: Error) => void = () => undefined;
      let answerInsert: (receipt: InsertReceipt) => void = () => undefined;
      const host = {
        navigate(intent: NavigationIntent) {
          calls.push(`navigate:${intent.intentId}`);
          return new Promise<NavigationReceipt>((resolve, reject) => {
            answerNavigate = resolve;
            failNavigate = reject;
          });
        },
        insert(intent: InsertIntent) {
          calls.push(`insert:${intent.intentId}`);
          return new Promise<InsertReceipt>((resolve) => (answerInsert = resolve));
        },
        current: () => 'snapshot',
      };
      return { host: host as unknown as Parameters<typeof boardsHostOver>[0], calls, answerNavigate: (receipt: NavigationReceipt) => answerNavigate(receipt), failNavigate: () => failNavigate(new Error('bridge gone')), answerInsert: (receipt: InsertReceipt) => answerInsert(receipt) };
    };

    // «Открыть и вставить»: the text is in the field, the person presses Send at once, the receipt is not back yet.
    const w = world();
    const p = page();
    const boards = boardsHostOver(p.host, w.facts);
    const going = boards.navigate(navigation);
    expect(p.calls).toEqual(['navigate:nav-1']);
    w.emit(humanSend({ edited: false }));
    expect(w.sent).toEqual([report]);
    p.answerNavigate({ state: 'navigated', routeEpoch: 2, insert: applied });
    expect(await going).toMatchObject({ state: 'navigated', insert: applied });
    // What the port has besides is the port's own.
    expect((boards as unknown as { current(): string }).current()).toBe('snapshot');

    // The same for an insert into the open chat (a board's «Вставить»).
    const direct = world();
    const dp = page();
    const inserting = boardsHostOver(dp.host, direct.facts).insert(insert);
    direct.emit(humanSend({ edited: false }));
    expect(direct.sent).toEqual([report]);
    dp.answerInsert(applied);
    await inserting;

    // The host says nothing was written — refused, or the insert was never reached: no draft of it exists, and a
    // send that names it later (it cannot) is not ours to report.
    for (const receipt of [
      { state: 'navigated', routeEpoch: 2, insert: { state: 'rejected', code: 'CG-DRAFT-CHANGED', needs: 'confirm-human-draft' } },
      { state: 'failed', code: 'CG-NAV-TIMEOUT', insert: null },
    ] as NavigationReceipt[]) {
      const refused = world();
      const rp = page();
      const asked = boardsHostOver(rp.host, refused.facts).navigate(navigation);
      rp.answerNavigate(receipt);
      await asked;
      refused.emit(humanSend());
      expect(refused.sent).toEqual([]);
    }
    const rejected = world();
    const jp = page();
    const refusedInsert = boardsHostOver(jp.host, rejected.facts).insert(insert);
    jp.answerInsert({ state: 'rejected', code: 'CG-INSERT-CHAT-CHANGED' });
    await refusedInsert;
    rejected.emit(humanSend());
    expect(rejected.sent).toEqual([]);

    // The outcome is not known (the bridge failed after the write may have run, or the call itself broke): the
    // insert stays remembered — only the page's own word that the sent draft descends from it makes a `sent`.
    const unknown = world();
    const up = page();
    const uncertain = boardsHostOver(up.host, unknown.facts).navigate(navigation);
    up.answerNavigate({ state: 'failed', code: 'CG-NAV-FAILED', insert: { state: 'uncertain', code: 'CG-INSERT-UNCERTAIN' } });
    await uncertain;
    unknown.emit(humanSend({ edited: false }));
    expect(unknown.sent).toEqual([report]);
    const broken = world();
    const bp = page();
    const thrown = boardsHostOver(bp.host, broken.facts).navigate(navigation);
    bp.failNavigate();
    await expect(thrown).rejects.toThrow('bridge gone');
    broken.emit(humanSend({ edited: false }));
    expect(broken.sent).toEqual([report]);

    // A navigation that inserts nothing remembers nothing.
    const plain = world();
    const pp = page();
    const opening = boardsHostOver(pp.host, plain.facts).navigate({ intentId: 'nav-2' } as unknown as NavigationIntent);
    pp.answerNavigate({ state: 'navigated', routeEpoch: 2, insert: null });
    await opening;
    plain.emit(humanSend());
    expect(plain.sent).toEqual([]);
  });

  it('[X48] who sent each message: every human send whose own response named it goes to the background — ours or the person’s own, a PPV as two marks', () => {
    const w = world();
    w.facts.noteInsert('intent-1', 'op-1', { index: 1 });
    w.emit(humanSend());
    w.emit(humanSend({ platformMessageId: '9002', insertIntentId: null, edited: null, cargo: { priced: true, media: true } }));
    // No id from the send's own response: nobody can say which message it was.
    w.emit(humanSend({ platformMessageId: null, insertIntentId: null, edited: null }));
    expect(w.attributions.sent).toEqual([
      { fact: { chat: CHAT, platformMessageId: '9001', observedAt: '2026-10-17T12:00:00.000Z', priced: false, media: false } },
      { fact: { chat: CHAT, platformMessageId: '9002', observedAt: '2026-10-17T12:00:00.000Z', priced: true, media: true } },
    ]);
    // The part's own report is the one it always was.
    expect(w.sent).toEqual([['op.reportSent', { opId: 'op-1', part: { index: 1 }, pendingId: 'pending-1', platformMessageId: '9001', edited: true }]]);
  });

  it('[X48] a fact the background never acknowledged is said again when the port is back, a bounded number of times; its own answer is not repeated', async () => {
    const w = world();
    const lost = { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'port lost' } };
    w.attributions.answers.push(lost, lost, lost, lost, lost);
    w.setState('reconnecting');
    w.emit(humanSend({ insertIntentId: null, edited: null }));
    await turns();
    expect(w.attributions.sent).toHaveLength(1);
    for (let i = 0; i < SENT_REPORT_TRIES + 1; i += 1) {
      w.setState('ready');
      await turns();
      w.setState('reconnecting');
    }
    expect(w.attributions.sent).toHaveLength(SENT_REPORT_TRIES);
    const answered = world();
    answered.attributions.answers.push({ ok: true, payload: { queued: false, reason: 'not_admitted' } });
    answered.emit(humanSend({ insertIntentId: null, edited: null }));
    await turns();
    answered.setState('ready');
    await turns();
    expect(answered.attributions.sent).toHaveLength(1);
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

describe('[X8-06] the X8 fuse (decision X25): the background keeps it, the adapter is told, a trip of this tab is reported', () => {
  const fact = { attemptId: '00000000-0000-4000-8000-000000000070', reason: 'text', where: 'echo', sentChars: 21, seenChars: 9 } as const;
  const tripped: SendFuseState = { fuse: { trippedAt: 1, reason: 'text', where: 'echo', build: 'index-p8xPkCj8', attemptId: fact.attemptId }, resetAt: null };

  it('read when the port is ready; a fuse that never tripped changes nothing; one that did goes to the adapter with part B; `send.fuse` events follow', async () => {
    const w = world();
    w.facts.configure(bootstrap());
    await turns();
    expect(w.fuse.reads).toBe(1);
    expect(w.configured).toHaveLength(1);
    expect(w.configured[0]).not.toHaveProperty('fuse');
    w.event('send.fuse', tripped);
    await turns();
    expect(w.configured.at(-1)).toMatchObject({ previewSend: true, fuse: tripped });
    // The reset: the adapter hears it (a trip of its own document is lifted by it).
    w.event('send.fuse', { fuse: null, resetAt: 5 });
    await turns();
    expect(w.configured.at(-1)?.fuse).toEqual({ fuse: null, resetAt: 5 });
    // A new port may be a new event page: read again.
    w.setState('reconnecting');
    w.setState('ready');
    await turns();
    expect(w.fuse.reads).toBe(2);
  });

  it('a trip MAIN saw in this tab goes to the background with the tab’s build, and the background’s answer to the adapter', async () => {
    const w = world();
    w.facts.configure(bootstrap());
    w.answers.push({ ok: true, payload: tripped });
    w.emit({ type: 'sendFuse', fuse: fact });
    await turns();
    expect(w.sent).toEqual([['send.fuse', { fact, build: 'index-p8xPkCj8' }]]);
    expect(w.configured.at(-1)?.fuse).toEqual(tripped);
  });

  it('a trip nobody acknowledged (the port was lost) is said again when the port is back, a bounded number of times; a refusal is not repeated', async () => {
    const w = world();
    const lost = { ok: false, error: { code: 'CG-RUNTIME-UNREACHABLE', detail: 'port lost' } };
    for (let n = 0; n < SENT_REPORT_TRIES + 2; n += 1) w.answers.push(lost);
    w.setState('reconnecting');
    w.emit({ type: 'sendFuse', fuse: fact });
    await turns();
    for (let n = 0; n < SENT_REPORT_TRIES + 2; n += 1) {
      w.setState('ready');
      await turns();
      w.setState('reconnecting');
    }
    expect(w.sent.filter(([type]) => type === 'send.fuse')).toHaveLength(SENT_REPORT_TRIES);
    const other = world();
    other.answers.push({ ok: false, error: { code: 'CG-UI-FAILED', detail: 'tab only' } });
    other.emit({ type: 'sendFuse', fuse: fact });
    await turns();
    other.setState('ready');
    await turns();
    expect(other.sent.filter(([type]) => type === 'send.fuse')).toHaveLength(1);
  });

  it('dispose stops listening to the fuse events', () => {
    const w = world();
    w.facts.dispose();
    w.facts.configure(bootstrap());
    expect(() => w.event('send.fuse', tripped)).not.toThrow();
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
    ({ build: 'index-abc', adapterVersion: '0.3.0', checkedAt: 1, anchors: { ...Object.fromEntries(ANCHOR_IDS.map((anchor) => [anchor, 'ok'])), ...anchors }, capabilities: { insert: { state: 'on' }, ...capabilities } }) as unknown as HostContractReport;
  const facts = (value: HostContractReport) => contractFactsOf(value, CHATSPACE_APP.contract);

  it('[DB-031] the tap and the preview send switched off are not a ChatSpace that changed: the record lists them and carries no error', () => {
    const off = facts(report({ wsFrames: 'missing', receiptProfile: 'missing' }, { previewSend: { state: 'off' }, incoming: { state: 'off' } }));
    expect(off).toEqual({ build: 'index-abc', adapterVersion: '0.3.0', ok: true, missing: ['wsFrames', 'receiptProfile'], degraded: ['previewSend', 'incoming'] });
    expect(facts(report({})).ok).toBe(true);
  });

  it('[ER-049] [DB-031] an anchor of ChatSpace itself that is gone is CG-HOST-CONTRACT, with or without the switched ones', () => {
    expect(facts(report({ pendingMessages: 'missing' }))).toMatchObject({ ok: false, missing: ['pendingMessages'] });
    expect(facts(report({ wsFrames: 'missing', composerBridge: 'changed' }))).toMatchObject({ ok: false, missing: ['composerBridge', 'wsFrames'] });
  });

  it('[DB-031] a store ChatSpace has not created yet (no chat opened since the reload) is listed apart and is no error; the same store absent after a composer is', () => {
    const waiting = facts(report({ composerTranslator: 'notYet' }, { previewSend: { state: 'off' } }));
    expect(waiting).toEqual({ build: 'index-abc', adapterVersion: '0.3.0', ok: true, missing: [], degraded: ['previewSend'], notYet: ['composerTranslator'] });
    expect(facts(report({ composerTranslator: 'missing' }))).toMatchObject({ ok: false, missing: ['composerTranslator'] });
  });

  it('[R20 F7] the site\'s expected anchors are read, not the keys a report carries: an expected anchor it does not name is missing', () => {
    const named = Object.fromEntries(ANCHOR_IDS.filter((anchor) => anchor !== 'mimic').map((anchor) => [anchor, 'ok']));
    const short = { build: 'index-abc', adapterVersion: '0.3.0', checkedAt: 1, anchors: { ...named, stranger: 'missing' }, capabilities: { insert: { state: 'on' } } } as unknown as HostContractReport;
    expect(facts(short)).toMatchObject({ ok: false, missing: ['mimic'] });
  });

  it('[host:fansly] [host:chatspace] [LG-016] [R20 F7] two test adapters, two sites: each report is read by its own site\'s set, the second one in its own block', () => {
    // A second site's adapter: its anchors are its own, its switched part its own.
    const second: HostContractShape = { anchors: ['conversationRoute', 'textarea', 'socket', 'vaultUpload'], switchedAnchors: ['vaultUpload'], switchedCapabilities: [] };
    const site = {
      host: 'fansly-web',
      build: 'main.2e6b96097a4bb73b',
      adapterVersion: '0.1.0',
      checkedAt: 1,
      capabilities: { insert: { state: 'on' }, previewSend: { state: 'off' } },
      extensions: { 'fansly-web': { anchors: { conversationRoute: 'ok', textarea: 'shape', vaultUpload: 'missing' }, capabilities: { freshness: { state: 'degraded' } } } },
    } as unknown as HostContractReport;
    expect(contractFactsOf(site, second)).toEqual({ build: 'main.2e6b96097a4bb73b', adapterVersion: '0.1.0', ok: false, missing: ['textarea', 'socket', 'vaultUpload'], degraded: ['previewSend', 'freshness'] });
    // ChatSpace's set reads ChatSpace's report, whatever another site's says.
    expect(facts(report({}))).toMatchObject({ ok: true, missing: [] });
    // Only switched anchors missing: no error.
    const quiet = { ...site, extensions: { 'fansly-web': { anchors: { conversationRoute: 'ok', textarea: 'ok', socket: 'ok' }, capabilities: {} } } } as unknown as HostContractReport;
    expect(contractFactsOf(quiet, second)).toMatchObject({ ok: true, missing: ['vaultUpload'] });
  });
});

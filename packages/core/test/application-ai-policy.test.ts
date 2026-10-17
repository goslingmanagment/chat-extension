// R20 F10: the site's AI policy (docs/project-unite/architecture.md §1.6, §9.1). The shared controller of the open
// chat asks the site's policy for the proof of a start, the site's pre-check, its fields of the start, the
// fingerprint it keeps with the operation and the verdict on the result — and names no site.
//
// ChatSpace's policy is what the controller did by itself before: its gate rules against a frozen copy of main's
// (below), its starts and hub bodies against recordings made on main (application-dock.test.ts, «R20 F10,
// ChatSpace»). A second site's policy — here a fixture with Fansly's rules (FS-AI-1, FS-AI-2) — decides through the
// very same controller, which is the whole point of the ports.

import { describe, expect, it, vi } from 'vitest';

import { FEATURE_IDS, HOST_PLATFORM, LIVE_PPV_LIMITS, LivePpvStateSchema, UNAVAILABLE_REASONS, type AiHostPolicy, type AiProofAsk, type AiStartFields, type ChatWindow, type FeatureId, type LiveTextTail, type OpenChatMessage, type OpenChatPage, type OpenChatRead, type OpView, type PingSegment, type Platform } from '@cg/contracts';
import { CHATSPACE_AI, livePpvOf, readLivePpv } from '@cg/core/application/hosts/chatspace/ai';
import { FEATURE_POLICIES, featureGate, type GateFacts } from '@cg/core/domain/features';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, memory, openChat, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, meta, pageFeaturesOff, resolveHubErrorReference } from '@cg/testing/hub';

import { readyHarness, type Harness, type HarnessOptions } from './support/ai-harness';
import { NOW_MS } from './support/world';

// ── ChatSpace: the same verdicts as before F10 ───────────────────────────────

/**
 * The client gate as it was on `main` 67323144, before F10 (`core/src/domain/features/gates.ts`), frozen here for the
 * comparison: Hi by the loaded window, Ping by the platform and the segment (never on OnlyFans), the rest shared.
 */
function gateOnMain(feature: FeatureId, facts: { readonly platform: Platform; readonly window: ChatWindow | null; readonly draftEmpty: boolean | null; readonly pingSegment?: PingSegment | null }): { readonly reason: string; readonly code: string } | null {
  const gate = (reason: 'chat-loading' | 'needs-draft' | 'no-history' | 'hi-gate' | 'ping-gate') => ({ reason, code: UNAVAILABLE_REASONS[reason].code });
  const window = facts.window;
  if (window === null || window.state === 'loading') return gate('chat-loading');
  if (FEATURE_POLICIES[feature].requiresDraft && facts.draftEmpty === true) return gate('needs-draft');
  switch (feature) {
    case 'hi':
      return window.loaded > 10 ? gate('hi-gate') : null;
    case 'ping':
      return facts.platform === 'fansly' && facts.pingSegment === 'active' ? gate('ping-gate') : null;
    case 'review':
    case 'recap':
      return window.hasOlder === false && window.loaded < 30 ? gate('no-history') : null;
    case 'reply':
    case 'fix':
    case 'recap-short':
    case 'coach':
      return null;
  }
}

const baseWindow = memory.chatWindows[0] as ChatWindow;
const windowOf = (loaded: number, hasOlder: boolean | null, state: ChatWindow['state'] = 'ready'): ChatWindow => ({
  ...baseWindow,
  state,
  loaded,
  fanMessages: Math.ceil(loaded / 2),
  modelMessages: Math.floor(loaded / 2),
  hasOlder,
});
const TAIL: LiveTextTail = {
  capturedAt: '2026-10-03T10:00:00.000Z',
  messages: [{ platformMessageId: '4004', direction: 'fan', sentAt: '2026-10-03T09:59:00.000Z', text: 'hey' }],
};

describe('R20 F10, ChatSpace: the gate rules give the verdicts they gave before F10', () => {
  it('every feature, window, draft, Ping segment and proof: the shared rules with ChatSpace’s pre-check answer as main’s gate did', () => {
    const windows: (ChatWindow | null)[] = [null, windowOf(3, false, 'loading')];
    for (const loaded of [0, 1, 3, 9, 10, 11, 12, 20, 29, 30, 31, 40, 200]) for (const hasOlder of [true, false, null]) windows.push(windowOf(loaded, hasOlder));
    const segments: (PingSegment | null | undefined)[] = ['active', 'segment-a', 'segment-b', 'unknown', null, undefined];
    let compared = 0;
    for (const feature of FEATURE_IDS) {
      for (const window of windows) {
        for (const draftEmpty of [true, false, null]) {
          for (const pingSegment of segments) {
            const before = gateOnMain(feature, { platform: HOST_PLATFORM.chatspace, window, draftEmpty, ...(pingSegment === undefined ? {} : { pingSegment }) });
            // A view and a start's first check ask without a proof; the check before the token asks with the start's tail.
            for (const proof of [undefined, null, TAIL]) {
              const facts: GateFacts = proof === undefined ? { window, draftEmpty } : { window, draftEmpty, proof };
              expect(featureGate(feature, facts, CHATSPACE_AI), `${feature} ${JSON.stringify({ window: window === null ? null : [window.state, window.loaded, window.hasOlder], draftEmpty, pingSegment, proof: proof === TAIL })}`).toEqual(before);
              compared += 1;
            }
          }
        }
      }
    }
    expect(compared).toBe(FEATURE_IDS.length * windows.length * 3 * segments.length * 3);
  });

  it('ChatSpace’s own ports: the tail only when the start may carry fresh text, the tail as `fresh`, no fingerprint, the background’s mark', async () => {
    const read: { identity: unknown; max: number }[] = [];
    const host = { readVisibleTail: (identity: unknown, max: number) => (read.push({ identity, max }), Promise.resolve(TAIL)) } as unknown as Parameters<typeof CHATSPACE_AI.proof>[0];
    const identity = startSnapshot.identity;
    if (identity === null) throw new Error('the host world has an identity');
    expect(CHATSPACE_AI.proof(host, { feature: 'review', surface: 'dock', identity, fresh: null })).toBeNull();
    expect(read).toEqual([]);
    // Without the hub's `live-ppv-v1` the start reads the tail alone; the port's API is never asked.
    expect(await CHATSPACE_AI.proof(host, { feature: 'reply', surface: 'dock', identity, fresh: { maxItems: 60, maxChars: 5000 } })).toEqual({ tail: TAIL, livePpv: null });
    expect(read).toEqual([{ identity, max: 60 }]);
    expect(CHATSPACE_AI.fields({ tail: TAIL, livePpv: null })).toEqual({ fresh: TAIL });
    expect(CHATSPACE_AI.fields(null)).toEqual({ fresh: null });
    expect(CHATSPACE_AI.fingerprint({ tail: TAIL, livePpv: null })).toBeNull();
    const view = { stale: { reason: 'fan-wrote', at: '2026-10-03T10:01:00.000Z' } } as OpView;
    expect(CHATSPACE_AI.verdict(view, null)).toEqual({ reason: 'fan-wrote', at: '2026-10-03T10:01:00.000Z' });
    expect(CHATSPACE_AI.verdict({} as OpView, null)).toBeNull();
  });
});

describe('[X54] ChatSpace’s PPV state of the open chat (OnlyMonster’s API)', () => {
  const page = (items: Array<Partial<OpenChatMessage>>): OpenChatPage => ({
    capturedAt: '2026-10-17T06:00:00.000Z',
    items: items.map((item, i) => ({ platformMessageId: String(9100 - i), direction: 'model', sentAt: '2026-10-17T05:59:00.000Z', text: '', price: null, isFree: null, isOpened: null, mediaCount: 0, tip: false, automatic: false, ...item })),
    hasMore: false,
    cursor: null,
  });

  it('the model’s paid messages whose purchase OnlyFans says; a free one, a fan’s, one without a state are left out', () => {
    expect(
      livePpvOf(
        page([
          { price: 25, isFree: false, isOpened: true },
          { price: 15, isFree: false, isOpened: false, automatic: true },
          { price: 10, isFree: false, isOpened: null },
          { price: 5, isFree: true, isOpened: true },
          { direction: 'fan', price: 7, isOpened: true },
          { price: null, isOpened: true },
        ]),
      ),
    ).toEqual({
      capturedAt: '2026-10-17T06:00:00.000Z',
      items: [
        { platformMessageId: '9100', priceUsd: 25, purchased: true },
        { platformMessageId: '9099', priceUsd: 15, purchased: false },
      ],
    });
    expect(livePpvOf(page([{ price: null }]))).toBeNull();
    // The API naming one message twice: it counts once, so the start's schema (every id once) holds.
    const twice = page([{ price: 25, isFree: false, isOpened: true }, { price: 25, isFree: false, isOpened: false }]);
    const doubled = { ...twice, items: twice.items.map((item) => ({ ...item, platformMessageId: '9100' })) };
    expect(livePpvOf(doubled)?.items).toEqual([{ platformMessageId: '9100', priceUsd: 25, purchased: true }]);
    expect(LivePpvStateSchema.safeParse(livePpvOf(doubled)).success).toBe(true);
  });

  it('read beside the tail only when the hub takes it; the click waits for it at most its budget, a failure is no state', async () => {
    vi.useFakeTimers();
    try {
      const asked: unknown[] = [];
      let answer: Promise<OpenChatRead> = Promise.resolve({ ok: true, page: page([{ price: 25, isFree: false, isOpened: true }]), cached: false });
      const host = {
        readVisibleTail: () => Promise.resolve(TAIL),
        openChatMessages: (chat: unknown, options: unknown) => (asked.push({ chat, options }), answer),
      } as unknown as Parameters<typeof CHATSPACE_AI.proof>[0];
      const identity = startSnapshot.identity;
      if (identity === null || identity.chat === null) throw new Error('the host world has an open chat');
      const ask = { feature: 'reply' as const, surface: 'dock' as const, identity, fresh: { maxItems: 60, maxChars: 5000 }, livePpv: true };
      const state = { capturedAt: '2026-10-17T06:00:00.000Z', items: [{ platformMessageId: '9100', priceUsd: 25, purchased: true }] };
      expect(await CHATSPACE_AI.proof(host, ask)).toEqual({ tail: TAIL, livePpv: state });
      expect(asked).toEqual([{ chat: identity.chat, options: { limit: LIVE_PPV_LIMITS.readMessages } }]);
      expect(CHATSPACE_AI.fields({ tail: TAIL, livePpv: state })).toEqual({ fresh: TAIL, livePpv: state });
      // Not the open chat any more, or the API failed: no state, the tail still goes.
      answer = Promise.resolve({ ok: false, reason: 'not-open', status: null });
      expect(await CHATSPACE_AI.proof(host, ask)).toEqual({ tail: TAIL, livePpv: null });
      answer = Promise.reject(new Error('bridge'));
      expect(await CHATSPACE_AI.proof(host, ask)).toEqual({ tail: TAIL, livePpv: null });
      // A slow API: the start goes on at the budget without the state.
      answer = new Promise(() => undefined);
      const slow = CHATSPACE_AI.proof(host, ask);
      await vi.advanceTimersByTimeAsync(LIVE_PPV_LIMITS.waitMs);
      expect(await slow).toEqual({ tail: TAIL, livePpv: null });
      // A host without the API (Fansly's port has none): no state, nothing asked.
      const bare = { readVisibleTail: () => Promise.resolve(TAIL) } as unknown as Parameters<typeof CHATSPACE_AI.proof>[0];
      expect(await readLivePpv(bare, identity.chat)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── the shared controller asks the site's policy ──────────────────────────────

function parts(): Parameters<typeof readyHarness>[0] {
  const fake = new FakeHostPort({ start: startSnapshot, memory, checkpoint: null, answers: {}, timeline: [] });
  return { baseHost: fake, memory, catalog: createFakeCatalog(ctxOf({ now: NOW_MS })), bootstrap: BOOTSTRAP_PILOT_PAGES, resolve: resolveHubErrorReference, meta: (feature) => meta(feature as Parameters<typeof meta>[0]) };
}
const start = (options: HarnessOptions = {}): Promise<Harness> => readyHarness(parts(), options);

/** Every call of a policy's ports, by port, with what it was given — the policy itself answers as it would. */
function spied<P, F>(policy: AiHostPolicy<P, F>): { readonly policy: AiHostPolicy<P, F>; readonly calls: { readonly port: string; readonly args: readonly unknown[] }[] } {
  const calls: { port: string; args: readonly unknown[] }[] = [];
  return {
    calls,
    policy: {
      preflight: (...args) => (calls.push({ port: 'preflight', args }), policy.preflight(...args)),
      proof: (...args) => (calls.push({ port: 'proof', args }), policy.proof(...args)),
      fields: (...args) => (calls.push({ port: 'fields', args }), policy.fields(...args)),
      fingerprint: (...args) => (calls.push({ port: 'fingerprint', args }), policy.fingerprint(...args)),
      verdict: (...args) => (calls.push({ port: 'verdict', args }), policy.verdict(...args)),
    },
  };
}
const callsTo = (calls: readonly { readonly port: string; readonly args: readonly unknown[] }[], port: string): (readonly unknown[])[] => calls.filter((call) => call.port === port).map((call) => call.args);

describe('R20 F10, ChatSpace: the controller reaches ChatSpace’s behaviour through the ports', () => {
  it('a Reply: the proof is asked once with D-14’s limits, its tail goes to the start as `fresh`, the fingerprint is null and the result’s mark is the verdict', async () => {
    const { policy, calls } = spied(CHATSPACE_AI);
    const h = await start({ policy });
    h.host.setTail(openChat, TAIL);
    h.script(h.streamOf('fast-reply', ['hey you']));
    const receipt = await h.generate('reply');
    if (!receipt.ok || receipt.opId === undefined) throw new Error('not started');
    await h.finish();
    expect(callsTo(calls, 'proof')).toEqual([[h.host, { feature: 'reply', surface: 'dock', identity: h.host.current().identity, fresh: { maxItems: 60, maxChars: 5000 }, livePpv: false, messageCount: 100 }]]);
    expect(h.host.reads.tail).toBeGreaterThanOrEqual(1);
    // The pilot's hub does not list `live-ppv-v1` (and the fake port has no API of the host): the tail goes alone.
    expect(callsTo(calls, 'fields')).toEqual([[{ tail: TAIL, livePpv: null }]]);
    expect(callsTo(calls, 'fingerprint')).toEqual([[{ tail: TAIL, livePpv: null }]]);
    expect((h.bg.callsOf('op.start')[0] as { fresh: LiveTextTail }).fresh).toEqual(TAIL);
    expect(h.ai.workspace.ops.get(receipt.opId)?.memo.fingerprint).toBeNull();
    // The result is drawn with the verdict on it: no mark (the fan wrote nothing since).
    expect(h.dock().result?.stale).toBeNull();
    expect(callsTo(calls, 'verdict').at(-1)).toEqual([expect.objectContaining({ opId: receipt.opId, state: 'done' }), null]);
  });

  it('a page that does not admit fresh text, and Review: nothing is read for the proof, nothing awaited, and the start carries no `fresh`', async () => {
    const h = await start({ bootstrap: pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['freshText']) });
    h.host.setTail(openChat, TAIL);
    const before = h.host.reads.tail;
    h.script(h.streamOf('fast-reply', ['hey you']));
    expect(await h.generate('reply')).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    h.script(h.streamOf('chat-review', ['Оценка: 7/10']));
    expect(await h.generate('review')).toMatchObject({ ok: true, outcome: 'started' });
    await h.finish();
    expect(h.host.reads.tail - before).toBe(0);
    for (const startOp of h.bg.callsOf('op.start')) expect((startOp as { fresh?: unknown }).fresh).toBeUndefined();
  });
});

/** A second site's proof, as a fixture: what the tab proved of the conversation (FS-AI-2) and the ids it checked. */
interface SiteProof {
  readonly personal: number;
  readonly windowIds: readonly string[];
}

/**
 * A second site's policy with Fansly's rules, as a fixture (the real one is P8b1–P8c's, in Fansly's own build): every
 * fan of this world is active, so Ping is blocked (FS-AI-1); Hi is refused only on a conversation PROVEN to have more
 * than ten personal messages (FS-AI-2); the proof is gathered for every start, fresh text or not; the start carries
 * nothing of its own here; the tab keeps the checked ids, and a result whose ids were kept is marked.
 */
function secondSite(proofOf: (ask: AiProofAsk) => Promise<SiteProof | null> | null, fields: (proof: SiteProof | null) => AiStartFields = () => ({})): AiHostPolicy<SiteProof, string> {
  return {
    preflight: (feature, _window, proof) => (feature === 'ping' ? 'ping-gate' : feature === 'hi' && proof !== null && proof.personal > 10 ? 'hi-gate' : null),
    proof: (_host, ask) => proofOf(ask),
    fields,
    fingerprint: (proof) => (proof === null ? null : proof.windowIds.join(',')),
    verdict: (_view, fingerprint) => (fingerprint === null ? null : { reason: 'archive-moved', at: null }),
  };
}

describe('R20 F10: a second site’s policy decides through the same controller (a fixture with Fansly’s rules)', () => {
  it('Ping: the site’s pre-check closes the chip with its reason, and a start is refused before anything is read or asked', async () => {
    const asked: AiProofAsk[] = [];
    const h = await start({ policy: secondSite((ask) => (asked.push(ask), Promise.resolve({ personal: 0, windowIds: [] }))) });
    expect(h.dock().actions.ping).toMatchObject({ enabled: false, hotkey: null, reason: { id: 'ping-gate', code: 'CG-GATE-PING' } });
    expect(await h.generate('ping')).toMatchObject({ ok: false, code: 'CG-GATE-PING' });
    expect(asked).toEqual([]);
    expect(h.bg.callsOf('token.issue')).toEqual([]);
    expect(h.bg.callsOf('op.start')).toEqual([]);
  });

  it('Hi: not off by the window (ChatSpace’s rule) but by the proof — refused before the token when it proves a dialogue, started when it does not', async () => {
    let personal = 12;
    const asked: AiProofAsk[] = [];
    const h = await start({ policy: secondSite((ask) => (asked.push(ask), Promise.resolve({ personal, windowIds: ['4001', '4002'] }))) });
    // The stand's chat shows forty messages: ChatSpace would not offer Hi; the second site has not proven anything yet.
    expect(h.dock().actions.hi).toMatchObject({ enabled: true, reason: null });
    expect(await h.generate('hi')).toMatchObject({ ok: false, code: 'CG-GATE-HI' });
    expect(asked).toEqual([{ feature: 'hi', surface: 'dock', identity: h.host.current().identity, fresh: { maxItems: 60, maxChars: 5000 }, livePpv: false, messageCount: 25 }]);
    expect(h.bg.callsOf('token.issue')).toEqual([]);
    expect(h.bg.callsOf('op.start')).toEqual([]);

    personal = 1;
    h.script(h.streamOf('hi-greeting', ['hey [VARIANT] hi stranger [VARIANT] morning']));
    const receipt = await h.generate('hi');
    if (!receipt.ok || receipt.opId === undefined) throw new Error(`not started: ${JSON.stringify(receipt)}`);
    await h.finish();
    // The site's fields went with the start: here none, so no page text either.
    expect(h.bg.callsOf('op.start')).toMatchObject([{ feature: 'hi', variantCount: 3 }]);
    expect((h.bg.callsOf('op.start')[0] as { fresh?: unknown }).fresh).toBeUndefined();
    // What the tab kept of the proof is the site's fingerprint, and the result shows the site's verdict on it.
    expect(h.ai.workspace.ops.get(receipt.opId)?.memo.fingerprint).toBe('4001,4002');
    expect(h.dock().result).toMatchObject({ opId: receipt.opId, state: 'done', stale: { reason: 'archive-moved', at: null } });
  });

  it('the proof is gathered for a start without fresh text too (Review), and asked with no limits', async () => {
    const asked: AiProofAsk[] = [];
    const h = await start({ policy: secondSite((ask) => (asked.push(ask), Promise.resolve({ personal: 0, windowIds: ['4001'] }))) });
    h.script(h.streamOf('chat-review', ['Оценка: 7/10']));
    expect(await h.generate('review')).toMatchObject({ ok: true, outcome: 'started' });
    expect(asked).toEqual([{ feature: 'review', surface: 'dock', identity: h.host.current().identity, fresh: null, livePpv: false, messageCount: 3000 }]);
  });

  it('a proof that fails is no proof: the start goes on, nothing is kept, and the verdict is asked with none', async () => {
    const h = await start({ policy: secondSite(() => Promise.reject(new Error('the bridge did not answer'))) });
    h.script(h.streamOf('fast-reply', ['hey you']));
    const receipt = await h.generate('reply');
    if (!receipt.ok || receipt.opId === undefined) throw new Error('not started');
    await h.finish();
    expect(h.ai.workspace.ops.get(receipt.opId)?.memo.fingerprint).toBeNull();
    expect(h.dock().result).toMatchObject({ state: 'done', stale: null });
  });

  it('a field of the site the start schema does not know refuses the start: it never reaches the background', async () => {
    const unknownField = (): AiStartFields => ({ coverageCheck: { ids: ['4001'] } }) as unknown as AiStartFields;
    const h = await start({ policy: secondSite(() => Promise.resolve({ personal: 0, windowIds: [] }), unknownField) });
    expect(await h.generate('reply')).toMatchObject({ ok: false, code: 'CG-UI-FAILED' });
    expect(h.bg.callsOf('op.start')).toEqual([]);
    // The same site with fields the schema knows starts as usual.
    const ok = await start({ policy: secondSite(() => Promise.resolve({ personal: 0, windowIds: [] }), () => ({ fresh: null })) });
    ok.script(ok.streamOf('fast-reply', ['hey you']));
    expect(await ok.generate('reply')).toMatchObject({ ok: true, outcome: 'started' });
  });
});

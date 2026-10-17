// core/domain/ops: admission, states, timeouts, the single retry, request
// identity and cache, the environment fence, the default request and the
// stream reader (architecture.md §7, §8.4). Tests are named after the parity
// rows they prove. Fansly's own cases are domain-ops-fansly.test.ts: a host
// mark puts a whole file on its site, and these rows are ChatSpace's too.

import { describe, expect, it } from 'vitest';

import { AdmissionSchema, HubStreamRequestSchema, OP_STATES, OP_TIMEOUTS, StartOpSchema, chatKeyOf, type HubFrame, type IncomingFact, type OpState, type OpView } from '@cg/contracts';
import {
  INITIAL_STREAM_STATE,
  MAX_STREAM_ATTEMPTS,
  ResultCache,
  basicParseResult,
  buildStreamRequest,
  canMoveOp,
  canceledByChange,
  canonicalJson,
  currentPersona,
  chatLoadingGate,
  checkpointEquivalent,
  decideAdmission,
  digestHex,
  expiredDeadline,
  flagStateOf,
  flagUsable,
  followedPersonas,
  isActiveOpState,
  isNewerOpState,
  isTerminalOpState,
  knownMessageIds,
  messageWindowFor,
  narrowContext,
  nextDeadline,
  phaseFits,
  readFrame,
  readFrames,
  requestDigestOf,
  requestIdentityOf,
  requestKeyOf,
  resultExpired,
  retryDecision,
  splitAllowed,
  splitParts,
  splitVariants,
  DeferredRender,
  applyOpDone,
  applyOpUpdate,
  mirrorFromView,
  newMirror,
  panelOpens,
  showsStream,
  type OpMirror,
  type OpUpdate,
  stableDigest,
  staleMarkFor,
  startPrecondition,
  type ActiveOpEntry,
  type OpsEnvironment,
} from '@cg/core/domain/ops';
import { BOOTSTRAP_PILOT_PAGES, NOW_MS as HUB_NOW_MS, SSE_SCENARIOS, WORLD as HUB_WORLD, contextFrame, hubServing, meta, readStreamScenario, uuid as hubUuid, pageFeaturesOff } from '@cg/testing/hub';

import { featuresOf, freshTextOn } from './support/features';
import { FANSLY, NOW_MS, WORLD, binding, checkpointFor, fanslyTarget, persona, session, startOf, target, targetOf, uuid, withX8 } from './support/world';
import { CHATSPACE_RECORDED } from './support/chatspace-recorded';
import { seeded } from './support/random';

const OP = uuid(0x100);
const BOOTSTRAP_X8_ON = withX8(BOOTSTRAP_PILOT_PAGES);

describe('[support] the R10 world mirrors the fake hub world', () => {
  it('ids, pages, persona, clock and uuid agree with @cg/testing/hub', () => {
    expect(HUB_WORLD).toMatchObject(WORLD);
    expect(NOW_MS).toBe(HUB_NOW_MS);
    expect(uuid(0x123)).toBe(hubUuid(0x123));
    expect(BOOTSTRAP_PILOT_PAGES.pages.find((page) => page.pageId === binding.pageId)).toMatchObject({ pageLabel: binding.pageLabel, bindingRevision: binding.bindingRevision });
  });
});

const entry = (n: number, fan: string, tab: string | null, requestKey = `key-${n}`): ActiveOpEntry => ({
  opId: uuid(n),
  chatKey: chatKeyOf(targetOf(fan).chat),
  ownerTab: tab,
  requestKey,
  summary: { opId: uuid(n), feature: 'reply', surface: 'dock', chat: targetOf(fan).chat, fanLabel: null, state: 'streaming', startedAt: NOW_MS + n },
});

describe('[RB-021] [NEW-11] [AI-123] admission: one per chat across the extension, three per tab, no queue', () => {
  const TAB = uuid(0xa1);
  const OTHER_TAB = uuid(0xa2);

  it('[AI-123] admits the first three operations of a tab and refuses the fourth with the list of three', () => {
    const active = [entry(1, '2101', TAB), entry(2, '2102', TAB), entry(3, '2103', TAB)];
    expect(decideAdmission(active.slice(0, 2), { tabSessionId: TAB, chatKey: chatKeyOf(targetOf('2104').chat), requestKey: 'k' })).toEqual({ kind: 'admit' });
    const refused = decideAdmission(active, { tabSessionId: TAB, chatKey: chatKeyOf(targetOf('2104').chat), requestKey: 'k' });
    expect(refused.kind).toBe('refuse');
    if (refused.kind !== 'refuse') return;
    expect(refused.refusal.code).toBe('CG-OP-TAB-LIMIT');
    expect(refused.refusal.active.map((a) => a.opId)).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect(refused.refusal.active.every((a) => a.inThisTab)).toBe(true);
    expect(AdmissionSchema.safeParse(refused.refusal).success).toBe(true);
  });

  it('[NEW-11] refuses the same chat from another tab with CG-OP-CHAT-BUSY «идёт в другой вкладке»', () => {
    const decision = decideAdmission([entry(1, WORLD.fan, OTHER_TAB)], { tabSessionId: TAB, chatKey: chatKeyOf(target.chat), requestKey: 'key-1' });
    expect(decision).toMatchObject({ kind: 'refuse', refusal: { code: 'CG-OP-CHAT-BUSY' } });
    if (decision.kind === 'refuse') expect(decision.refusal.active[0]?.inThisTab).toBe(false);
  });

  it('[RB-021] one operation per chat: any other feature on the same chat in the same tab is refused', () => {
    const decision = decideAdmission([entry(1, WORLD.fan, TAB, 'reply-key')], { tabSessionId: TAB, chatKey: chatKeyOf(target.chat), requestKey: 'review-key' });
    expect(decision).toMatchObject({ kind: 'refuse', refusal: { code: 'CG-OP-CHAT-BUSY' } });
  });

  it('[AI-127] a repeated click with the same request in the same tab reopens the running operation', () => {
    expect(decideAdmission([entry(1, WORLD.fan, TAB, 'same')], { tabSessionId: TAB, chatKey: chatKeyOf(target.chat), requestKey: 'same' })).toEqual({ kind: 'reopen', opId: uuid(1) });
  });

  it('[AI-127] [AI-124] after its tab went away (a reload mints a new session) the same request from any tab reopens it, not CG-OP-CHAT-BUSY', () => {
    expect(decideAdmission([entry(1, WORLD.fan, null, 'same')], { tabSessionId: OTHER_TAB, chatKey: chatKeyOf(target.chat), requestKey: 'same' })).toEqual({ kind: 'reopen', opId: uuid(1) });
    // While its tab is still there, another tab is told it runs elsewhere.
    expect(decideAdmission([entry(1, WORLD.fan, TAB, 'same')], { tabSessionId: OTHER_TAB, chatKey: chatKeyOf(target.chat), requestKey: 'same' })).toMatchObject({ kind: 'refuse', refusal: { code: 'CG-OP-CHAT-BUSY' } });
  });

  it('[BG-006] an operation whose tab closed still holds its chat, but not the tab slot of anyone', () => {
    const orphan = entry(1, WORLD.fan, null);
    expect(decideAdmission([orphan], { tabSessionId: TAB, chatKey: chatKeyOf(target.chat), requestKey: 'another-request' })).toMatchObject({ kind: 'refuse', refusal: { code: 'CG-OP-CHAT-BUSY' } });
    expect(decideAdmission([orphan, entry(2, '2102', TAB), entry(3, '2103', TAB)], { tabSessionId: TAB, chatKey: chatKeyOf(targetOf('2104').chat), requestKey: 'k' }).kind).toBe('admit');
  });

  it('[RB-021] property: whatever the order of starts, no chat ever has two admitted operations and no tab more than three', () => {
    const rnd = seeded(21);
    for (let run = 0; run < 200; run += 1) {
      const active: ActiveOpEntry[] = [];
      for (let step = 0; step < 30; step += 1) {
        const tab = rnd.pick([TAB, OTHER_TAB]);
        const fan = rnd.pick(['2101', '2102', '2103', '2104', '2105']);
        if (rnd.chance(0.2) && active.length > 0) {
          active.splice(rnd.int(active.length), 1);
          continue;
        }
        const decision = decideAdmission(active, { tabSessionId: tab, chatKey: chatKeyOf(targetOf(fan).chat), requestKey: `${fan}:${rnd.int(2)}` });
        if (decision.kind === 'admit') active.push(entry(100 + step, fan, tab, `${fan}:0`));
      }
      const chats = active.map((e) => e.chatKey);
      expect(new Set(chats).size).toBe(chats.length);
      for (const tab of [TAB, OTHER_TAB]) expect(active.filter((e) => e.ownerTab === tab).length).toBeLessThanOrEqual(3);
    }
  });
});

describe('[RB-020] operation states: only forward, a terminal state never moves', () => {
  it('[RB-020] follows OP_TRANSITIONS and refuses steps back', () => {
    expect(canMoveOp('admitted', 'requesting')).toBe(true);
    expect(canMoveOp('streaming', 'requesting')).toBe(false);
    expect(canMoveOp('done', 'failed')).toBe(false);
    for (const state of OP_STATES) expect(isActiveOpState(state)).toBe(!isTerminalOpState(state));
  });

  it('[RB-020] newer state wins: a late event for an older state is not newer', () => {
    const order: OpState[] = ['admitted', 'requesting', 'streaming', 'done'];
    for (let i = 0; i < order.length; i += 1) {
      for (let j = 0; j < order.length; j += 1) {
        const a = order[i] as OpState;
        const b = order[j] as OpState;
        expect(isNewerOpState(a, b)).toBe(j > i);
      }
    }
    expect(isNewerOpState('done', 'canceled')).toBe(false);
    expect(isNewerOpState('requesting', 'interrupted')).toBe(true);
  });

  it('[AI-139] phases belong to their state', () => {
    expect(phaseFits('requesting', 'retry-wait')).toBe(true);
    expect(phaseFits('streaming', 'retry-wait')).toBe(false);
    expect(phaseFits('done', 'settled')).toBe(true);
  });
});

describe('[RB-002] [RB-003] timeouts by feature', () => {
  const t0 = NOW_MS;

  it('[RB-002] quick features: 30 s until meta, 30 s first chunk, 30 s silence, 60 s max', () => {
    expect(nextDeadline('reply', { opRequestAt: t0, attemptAt: t0, metaAt: null, firstChunkAt: null, lastFrameAt: null })).toEqual({ at: t0 + 30_000, kind: 'until-meta' });
    expect(nextDeadline('reply', { opRequestAt: t0, attemptAt: t0, metaAt: t0 + 1000, firstChunkAt: null, lastFrameAt: t0 + 1000 })).toEqual({ at: t0 + 31_000, kind: 'first-chunk' });
    expect(nextDeadline('reply', { opRequestAt: t0, attemptAt: t0, metaAt: t0 + 1000, firstChunkAt: t0 + 2000, lastFrameAt: t0 + 20_000 })).toEqual({ at: t0 + 50_000, kind: 'silence' });
    expect(nextDeadline('reply', { opRequestAt: t0, attemptAt: t0, metaAt: t0 + 1000, firstChunkAt: t0 + 2000, lastFrameAt: t0 + 55_000 })).toEqual({ at: t0 + 60_000, kind: 'max' });
  });

  it('[RB-002] deep features wait 180 s for meta and run up to 300 s; coach and short recap have their own', () => {
    expect(nextDeadline('review', { opRequestAt: t0, attemptAt: t0, metaAt: null, firstChunkAt: null, lastFrameAt: null }).at).toBe(t0 + 180_000);
    expect(OP_TIMEOUTS.recap.maxMs).toBe(300_000);
    expect(nextDeadline('coach', { opRequestAt: t0, attemptAt: t0, metaAt: null, firstChunkAt: null, lastFrameAt: null }).at).toBe(t0 + 60_000);
    expect(nextDeadline('recap-short', { opRequestAt: t0, attemptAt: t0, metaAt: t0, firstChunkAt: t0, lastFrameAt: t0 + 100_000 }).at).toBe(t0 + 120_000);
  });

  it('[RB-003] a passed deadline is reported, an unpassed one is not', () => {
    const times = { opRequestAt: t0, attemptAt: t0, metaAt: null, firstChunkAt: null, lastFrameAt: null };
    expect(expiredDeadline('reply', times, t0 + 29_999)).toBeNull();
    expect(expiredDeadline('reply', times, t0 + 30_000)).toEqual({ at: t0 + 30_000, kind: 'until-meta' });
  });
});

describe('[AI-133] [RB-001] the single automatic retry', () => {
  const base = { disposition: 'retry-once' as const, attempt: 1, frameSeen: false, outputSeen: false, environmentLost: false };

  it('[AI-133] retries a structured 503 before any frame once, after 5 s', () => {
    expect(retryDecision(base)).toEqual({ retry: true, delayMs: 5000 });
    expect(MAX_STREAM_ATTEMPTS).toBe(2);
  });

  it('[RB-001] never a second retry, never after a frame or output, never another disposition, never after the environment left', () => {
    expect(retryDecision({ ...base, attempt: 2 })).toEqual({ retry: false });
    expect(retryDecision({ ...base, frameSeen: true })).toEqual({ retry: false });
    expect(retryDecision({ ...base, outputSeen: true })).toEqual({ retry: false });
    expect(retryDecision({ ...base, environmentLost: true })).toEqual({ retry: false });
    for (const disposition of ['show', 'refresh-catalog', 'refresh-bootstrap', 'ignore', 'clear-sign-in', 'not-ready'] as const) {
      expect(retryDecision({ ...base, disposition })).toEqual({ retry: false });
    }
  });
});

describe('[AI-128] request identity and the result cache', () => {
  const identity = (over: Parameters<typeof startOf>[0] = {}, archiveHead: string | null = null) =>
    requestIdentityOf({ session, start: startOf(over), persona, archiveHead });

  it('R20 F6a, Fansly: the conversation is part of the key when it is not the fan — the same fan in another group is another request', () => {
    const inGroup = identity({ target: fanslyTarget });
    expect(inGroup).toMatchObject({ host: 'fansly-web', fanRef: FANSLY.fan, conversationRef: FANSLY.group });
    expect(requestKeyOf(inGroup)).not.toBe(requestKeyOf(identity({ target: { ...fanslyTarget, conversationRef: FANSLY.otherGroup } })));
    // A ChatSpace identity names no conversation: on OnlyFans it is the fan.
    expect(identity()).not.toHaveProperty('conversationRef');
  });

  it('R20 F6a, ChatSpace: the key of a ChatSpace request is byte for byte the one recorded on main (the conversation is the fan)', () => {
    const key = requestKeyOf(identity({ checkpoint: checkpointFor(WORLD.fan) }, '4006'));
    expect(key).toBe(CHATSPACE_RECORDED.requestKey);
  });

  it('[AI-128] the same parameters give the same key; the cause (a new click) does not matter', () => {
    expect(requestKeyOf(identity({ token: 'tok_aaaaaaaaaaaaaaaa' }))).toBe(requestKeyOf(identity({ token: 'tok_bbbbbbbbbbbbbbbb' })));
    expect(requestDigestOf(identity())).toMatch(/^[0-9a-f]{16}$/);
  });

  it('[AI-128] every listed parameter makes a different key', () => {
    const base = requestKeyOf(identity());
    const variants = [
      requestKeyOf(identity({ tone: 'flirty' })),
      requestKeyOf(identity({ split: true })),
      requestKeyOf(identity({ window: 50 })),
      requestKeyOf(identity({ feature: 'review' })),
      requestKeyOf(identity({ feature: 'fix', draft: { text: 'x', revision: 1, digest: 'aaaaaaaa' } })),
      requestKeyOf(identity({}, '4006')),
      requestKeyOf(identity({ target: targetOf(WORLD.otherFan) })),
      requestKeyOf(identity({ target: { ...target, binding: { ...binding, bindingRevision: 9 } } })),
      requestKeyOf(requestIdentityOf({ session: { ...session, epoch: 4 }, start: startOf(), persona, archiveHead: null })),
      requestKeyOf(requestIdentityOf({ session: { ...session, userId: 8 }, start: startOf(), persona, archiveHead: null })),
      requestKeyOf(requestIdentityOf({ session: { ...session, hubOrigin: 'https://other.example.test' }, start: startOf(), persona, archiveHead: null })),
      requestKeyOf(requestIdentityOf({ session, start: startOf(), persona: { ...persona, definitionId: WORLD.persona.otherDefinitionId }, archiveHead: null })),
    ];
    for (const key of variants) expect(key).not.toBe(base);
    expect(new Set(variants).size).toBe(variants.length);
    const fixA = requestKeyOf(identity({ feature: 'fix', draft: { text: 'x', revision: 1, digest: 'aaaaaaaa' } }));
    const fixB = requestKeyOf(identity({ feature: 'fix', draft: { text: 'x', revision: 1, digest: 'bbbbbbbb' } }));
    expect(fixA).not.toBe(fixB);
    expect(identity({ feature: 'recap-short' }).recapMode).toBe('short');
  });

  it('[AI-128] a preview checkpoint taken later with the same counters is the same request; new counters are not', () => {
    const a = checkpointFor('2003');
    const b = { ...a, observedAt: a.observedAt + 5000 };
    expect(checkpointEquivalent(a, b)).toBe(true);
    expect(checkpointEquivalent(a, { ...a, fanSequence: 3 })).toBe(false);
    const keyA = requestKeyOf(identity({ surface: 'preview', checkpoint: a, target: targetOf('2003') }));
    const keyB = requestKeyOf(identity({ surface: 'preview', checkpoint: b, target: targetOf('2003') }));
    expect(keyA).toBe(keyB);
  });

  it('[AI-128] the cache reopens within 30 minutes and forgets after', () => {
    const cache = new ResultCache();
    cache.remember({ requestKey: 'k', opId: uuid(1), startedAt: 10, endedAt: 1000 });
    expect(cache.lookup('k', 1000 + 29 * 60_000)?.opId).toBe(uuid(1));
    expect(cache.lookup('k', 1000 + 30 * 60_000)).toBeNull();
    expect(cache.size).toBe(0);
    expect(resultExpired({ endedAt: 0 }, 30 * 60_000)).toBe(true);
    expect(resultExpired({}, 10 ** 12)).toBe(false);
  });

  it('[RB-018] the last run owns the slot: an older run finishing later does not replace it', () => {
    const cache = new ResultCache();
    expect(cache.remember({ requestKey: 'k', opId: uuid(2), startedAt: 200, endedAt: 300 })).toBe(true);
    expect(cache.remember({ requestKey: 'k', opId: uuid(1), startedAt: 100, endedAt: 400 })).toBe(false);
    expect(cache.lookup('k', 500)?.opId).toBe(uuid(2));
    expect(cache.remember({ requestKey: 'k', opId: uuid(3), startedAt: 300, endedAt: 600 })).toBe(true);
    cache.forgetOp(uuid(3));
    expect(cache.lookup('k', 700)).toBeNull();
    cache.remember({ requestKey: 'j', opId: uuid(4), startedAt: 1, endedAt: 2 });
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('[AI-128] a new fan message marks the result stale; a known, automatic or own message does not', () => {
    const chatKey = chatKeyOf(target.chat);
    const fact = (over: Partial<IncomingFact> = {}): IncomingFact => ({
      host: 'chatspace',
      hostAccountId: target.chat.hostAccountId,
      platformFanId: target.chat.platformFanId,
      platformMessageId: '4300',
      fromFan: true,
      automatic: false,
      tip: false,
      sentAt: '2026-10-03T10:00:05.000Z',
      socketEpoch: 1,
      fanSequence: 3,
      source: 'ws-tap',
      ...over,
    });
    const known = { chatKey, startedAt: NOW_MS, ids: knownMessageIds({ servedContext: narrowContext(contextFrame()) }, ['4400']) };
    expect(staleMarkFor(known, fact(), NOW_MS + 10)).toEqual({ reason: 'fan-wrote', at: '2026-10-03T10:00:05.000Z' });
    expect(staleMarkFor(known, fact({ fromFan: false }), NOW_MS + 10)).toBeNull();
    expect(staleMarkFor(known, fact({ automatic: true }), NOW_MS + 10)).toBeNull();
    expect(staleMarkFor(known, fact(), NOW_MS - 10)).toBeNull();
    expect(staleMarkFor(known, fact({ platformMessageId: WORLD.messages.fanLatest }), NOW_MS + 10)).toBeNull();
    expect(staleMarkFor(known, fact({ platformMessageId: '4400' }), NOW_MS + 10)).toBeNull();
    expect(staleMarkFor(known, fact({ platformFanId: WORLD.otherFan }), NOW_MS + 10)).toBeNull();
    expect(knownMessageIds({ servedContext: null }, [])).toEqual([]);
  });
});

describe('[AI-121] [AI-122] [AI-126] preconditions and the environment fence', () => {
  const env = (over: Partial<OpsEnvironment> = {}): OpsEnvironment => ({
    session,
    bootstrap: BOOTSTRAP_PILOT_PAGES,
    persona: () => persona,
    debug: false,
    settingsLoaded: true,
    features: featuresOf,
    ...over,
  });

  it('[AI-121] [AU-024] [AU-022] [AU-025] [AU-026] no sign-in, a stale binding, no bootstrap, an ungranted page, no persona, a switched-off feature each have their reason', () => {
    expect(startPrecondition(env(), startOf())).toBeNull();
    expect(startPrecondition(env({ session: null }), startOf())).toBe('CG-AUTH-REQUIRED');
    expect(startPrecondition(env({ session: { ...session, epoch: 9 } }), startOf())).toBe('CG-CONTEXT-CHANGED');
    expect(startPrecondition(env({ bootstrap: null }), startOf())).toBe('CG-HUB-UNAVAILABLE');
    expect(startPrecondition(env({ bootstrap: { ...BOOTSTRAP_PILOT_PAGES, pages: [] } }), startOf())).toBe('CG-BINDING-NOT-GRANTED');
    expect(
      startPrecondition(env({ bootstrap: { ...BOOTSTRAP_PILOT_PAGES, pages: BOOTSTRAP_PILOT_PAGES.pages.map((p) => ({ ...p, bindingRevision: p.bindingRevision + 1 })) } }), startOf()),
    ).toBe('CG-CONTEXT-CHANGED');
    expect(startPrecondition(env({ persona: () => null }), startOf())).toBe('CG-PERSONA-UNASSIGNED');
    expect(startPrecondition(env({ bootstrap: pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['review']) }), startOf({ feature: 'review' }))).toBe(
      'CG-FEATURE-DISABLED',
    );
  });

  it('[RB-013] settings that failed to load refuse a Coach turn with CG-STORAGE-READ before anything is spent', () => {
    const coach = startOf({ feature: 'coach', coach: { question: 'what now?', history: [] } });
    expect(startPrecondition(env({ settingsLoaded: false }), coach)).toBe('CG-STORAGE-READ');
    expect(startPrecondition(env(), coach)).toBeNull();
  });

  it('[AI-121] a flag is usable only when the page\'s own feature is available: the hub put the platform and what it serves into it', () => {
    expect(flagUsable(BOOTSTRAP_PILOT_PAGES, binding.pageId, 'coach')).toBe(true);
    expect(flagUsable(BOOTSTRAP_PILOT_PAGES, binding.pageId, 'previewSend')).toBe(false);
    expect(flagUsable(BOOTSTRAP_X8_ON, binding.pageId, 'previewSend')).toBe(true);
    // A hub that serves nothing of X8 answers `hub_not_ready` for the page's feature; the client reads that answer
    // and keeps no table of the hub's requirements of its own (R20 F4).
    expect(flagStateOf(hubServing(BOOTSTRAP_X8_ON, []), binding.pageId, 'previewSend')).toEqual({ usable: false, reason: 'hub_not_ready' });
    expect(flagStateOf(hubServing(BOOTSTRAP_X8_ON, []), binding.pageId, 'coach')).toEqual({ usable: true, reason: null });
    expect(flagUsable(BOOTSTRAP_X8_ON, 999, 'coach')).toBe(false);
    expect(flagUsable(null, binding.pageId, 'coach')).toBe(false);
  });

  it('[AI-122] «Чат ещё грузится» while the host cache has no history of the open chat', () => {
    expect(chatLoadingGate(null)).toBe('CG-GATE-CHAT-LOADING');
    expect(chatLoadingGate({ state: 'loading' })).toBe('CG-GATE-CHAT-LOADING');
    expect(chatLoadingGate({ state: 'ready' })).toBeNull();
  });

  it('[AI-126] persona, sign-in and hub changes cancel; other pages, the same persona and its edited definition do not', () => {
    const tag = { hubOrigin: session.hubOrigin, userId: session.userId, signInEpoch: session.epoch, pageId: binding.pageId, personaKey: persona.key, personaDefinitionId: persona.definitionId };
    // The owner edited the persona: the same persona, another definition — no other persona.
    expect(canceledByChange(tag, { kind: 'persona', pageId: binding.pageId, next: { ...persona, definitionId: WORLD.persona.otherDefinitionId } })).toBe(false);
    expect(canceledByChange(tag, { kind: 'persona', pageId: binding.pageId, next: { ...persona, key: 'other' } })).toBe(true);
    expect(canceledByChange(tag, { kind: 'persona', pageId: binding.pageId, next: null })).toBe(true);
    expect(canceledByChange(tag, { kind: 'persona', pageId: binding.pageId, next: persona })).toBe(false);
    expect(canceledByChange(tag, { kind: 'persona', pageId: 12, next: null })).toBe(false);
    expect(canceledByChange(tag, { kind: 'session', next: null })).toBe(true);
    expect(canceledByChange(tag, { kind: 'session', next: { ...session, epoch: 4 } })).toBe(true);
    expect(canceledByChange(tag, { kind: 'session', next: session })).toBe(false);
    expect(canceledByChange(tag, { kind: 'hub', origin: 'https://other.example.test' })).toBe(true);
    expect(canceledByChange(tag, { kind: 'hub', origin: session.hubOrigin })).toBe(false);
  });

  it('[AI-140] a choice follows the persona the owner edited: same key, the definition the catalog has now', () => {
    const edited = WORLD.persona.otherDefinitionId;
    const catalog = (definitionId: string, status: 'active' | 'archived' = 'active') => ({ personas: [{ key: persona.key, displayName: 'Lora', version: 2, definitionId, status }] });
    expect(currentPersona(persona, catalog(edited))).toEqual({ key: persona.key, definitionId: edited });
    // Current, archived, unknown or no catalog: the choice stays as it is (the same object).
    expect(currentPersona(persona, catalog(persona.definitionId))).toBe(persona);
    expect(currentPersona(persona, catalog(edited, 'archived'))).toBe(persona);
    expect(currentPersona({ ...persona, key: 'gone' }, catalog(edited))).toEqual({ ...persona, key: 'gone' });
    expect(currentPersona(persona, null)).toBe(persona);
    const other = { key: 'ari', definitionId: 'pdef_aaaaaaaaaaaaaaaa' };
    expect(followedPersonas({ '11': persona, '15': persona, '20': other }, catalog(edited))).toEqual({ '11': { key: persona.key, definitionId: edited }, '15': { key: persona.key, definitionId: edited } });
    expect(followedPersonas({ '11': persona, '20': other }, catalog(persona.definitionId))).toBeNull();
    expect(followedPersonas({}, catalog(edited))).toBeNull();
  });
});

describe('[AI-134] windows and the default request (§8.4)', () => {
  const windows = { quick: 100, ping: 80, improve: 25, deep: 3000 };
  // `freshText` — the admission of the manifest's `fresh-text` on the page, as the scheduler sets it.
  const ctx = { opId: OP, persona, bootstrap: BOOTSTRAP_PILOT_PAGES, debug: false, freshText: freshTextOn(BOOTSTRAP_PILOT_PAGES, binding.pageId) };

  it('[AI-134] each feature takes its settings window; deep never above the hub limit; short recap 300; Hi 25', () => {
    expect(messageWindowFor('reply', windows, 3000)).toBe(100);
    expect(messageWindowFor('coach', windows, 3000)).toBe(100);
    expect(messageWindowFor('fix', windows, 3000)).toBe(25);
    expect(messageWindowFor('ping', windows, 3000)).toBe(80);
    expect(messageWindowFor('hi', windows, 3000)).toBe(25);
    expect(messageWindowFor('review', windows, 1500)).toBe(1500);
    expect(messageWindowFor('recap', windows, 3000)).toBe(3000);
    expect(messageWindowFor('recap-short', windows, 3000)).toBe(300);
    expect(messageWindowFor('recap-short', { ...windows, deep: 200 }, 3000)).toBe(200);
  });

  it('[AI-134] [AU-026] the request carries clientRequestId = opId, page, fan, persona and messageCount clamped to deepMax', () => {
    const built = buildStreamRequest(startOf({ window: 3000, feature: 'review' }), { ...ctx, bootstrap: { ...BOOTSTRAP_PILOT_PAGES, limits: { ...BOOTSTRAP_PILOT_PAGES.limits, deepMax: 1500 } } });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.feature).toBe('chat-review');
    expect(built.request.body).toMatchObject({
      clientRequestId: OP,
      pageLabel: binding.pageLabel,
      platform: 'onlyfans',
      conversationRef: WORLD.fan,
      fanRef: WORLD.fan,
      personaKey: persona.key,
      expectedPersonaDefinitionId: persona.definitionId,
      messageCount: 1500,
      isRegeneration: false,
    });
    expect(built.request.body.replyMode).toBeUndefined();
  });

  it('[AI-129] Regenerate asks with isRegeneration; Reply sends its tone or none; Split asks preferSplit', () => {
    const regen = buildStreamRequest(startOf({ regenerateOf: uuid(0x99), tone: 'flirty', split: true }), ctx);
    expect(regen.ok && regen.request.body).toMatchObject({ isRegeneration: true, replyTone: 'flirty', replyMode: 'preferSplit' });
    const plain = buildStreamRequest(startOf(), ctx);
    expect(plain.ok && plain.request.body).toMatchObject({ replyTone: 'none', replyMode: 'default' });
  });

  it('[AI-134] Hi, Ping and Coach ask Split only under split-all-v1 and the splitAll switch', () => {
    expect(splitAllowed('hi', BOOTSTRAP_PILOT_PAGES, binding.pageId)).toBe(true);
    const noSplitAll = pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['splitAll']);
    expect(splitAllowed('hi', noSplitAll, binding.pageId)).toBe(false);
    expect(splitAllowed('review', BOOTSTRAP_PILOT_PAGES, binding.pageId)).toBe(false);
    const hi = buildStreamRequest(startOf({ feature: 'hi', variantCount: 3, split: true }), ctx);
    expect(hi.ok && hi.request).toMatchObject({ feature: 'hi-greeting', capabilities: ['context-v1', 'split-all-v1'], body: { variantCount: 3, replyMode: 'preferSplit' } });
    const hiOff = buildStreamRequest(startOf({ feature: 'hi', variantCount: 3, split: true }), { ...ctx, bootstrap: noSplitAll });
    expect(hiOff.ok && hiOff.request.body.replyMode).toBeUndefined();
  });

  it('[AI-134] Fix, Coach, short Recap and debug carry their own fields and header', () => {
    const fix = buildStreamRequest(startOf({ feature: 'fix', draft: { text: 'my draft', revision: 4, digest: 'aaaaaaaa' } }), ctx);
    expect(fix.ok && fix.request.body.draftText).toBe('my draft');
    const coach = buildStreamRequest(startOf({ feature: 'coach', coach: { question: 'How?', history: [{ question: 'q', answer: 'a' }], attachDraft: 'mine' } }), { ...ctx, debug: true });
    expect(coach.ok && coach.request).toMatchObject({
      feature: 'coach-chat',
      capabilities: ['debug-input-v1', 'context-v1', 'split-all-v1'],
      body: { chatterQuestion: 'How?', coachHistory: [{ question: 'q', answer: 'a' }], draftText: 'mine' },
    });
    expect(coach.ok && coach.request.body.preset).toBeUndefined();
    // A preset carries its question on the hub: the words that come with it (the chip's label, as the panel
    // dispatches it) stay in our dialog — the hub answers 400 to a body that names both.
    const preset = buildStreamRequest(startOf({ feature: 'coach', coach: { question: 'Что сейчас в чате?', preset: 'situation', history: [] } }), ctx);
    expect(preset.ok && preset.request.body.preset).toBe('situation');
    expect(preset.ok && 'chatterQuestion' in preset.request.body).toBe(false);
    expect(preset.ok && 'coachHistory' in preset.request.body).toBe(false);
    const recap = buildStreamRequest(startOf({ feature: 'recap-short' }), ctx);
    expect(recap.ok && recap.request.body.summaryMode).toBe('short');
  });

  it('[X54] the open chat’s PPV state goes as livePpvContext only where fresh text may go, to a hub that lists live-ppv-v1', () => {
    const livePpv = { capturedAt: '2026-10-17T06:00:00.000Z', items: [{ platformMessageId: '9002', priceUsd: 25, purchased: true }] };
    // The pilot's hub before its deploy does not list it; a hub that does:
    expect(BOOTSTRAP_PILOT_PAGES.capabilities).not.toContain('live-ppv-v1');
    const served = { ...ctx, bootstrap: { ...BOOTSTRAP_PILOT_PAGES, capabilities: [...BOOTSTRAP_PILOT_PAGES.capabilities, 'live-ppv-v1'] } };
    for (const feature of ['reply', 'fix', 'hi', 'ping'] as const) {
      const built = buildStreamRequest(startOf({ feature, livePpv, ...(feature === 'fix' ? { draft: { text: 'my draft', revision: 1, digest: 'abcdef12' } } : {}) }), served);
      expect(built.ok && built.request.body.livePpvContext, feature).toEqual(livePpv);
    }
    // A hub without the capability is never sent the field (its body is strict); nor a page without fresh text.
    const before = buildStreamRequest(startOf({ livePpv }), ctx);
    expect(before.ok && 'livePpvContext' in before.request.body).toBe(false);
    const flagOff = buildStreamRequest(startOf({ livePpv }), { ...served, freshText: false });
    expect(flagOff.ok && 'livePpvContext' in flagOff.request.body).toBe(false);
    // The start's own rule: a draft in the dock only.
    expect(StartOpSchema.safeParse({ ...startOf({ feature: 'review', livePpv }) }).success).toBe(false);
    expect(StartOpSchema.safeParse({ ...startOf({ surface: 'preview', target: targetOf('2003'), livePpv }) }).success).toBe(false);
    // The request's own check: the hub takes it on OnlyFans alone.
    const onFansly = HubStreamRequestSchema.safeParse({ feature: 'fast-reply', body: { clientRequestId: OP, pageLabel: 'p', platform: 'fansly', conversationRef: '1', livePpvContext: livePpv }, capabilities: [] });
    expect(onFansly.success).toBe(false);
    const onReview = HubStreamRequestSchema.safeParse({ feature: 'chat-review', body: { clientRequestId: OP, pageLabel: 'p', platform: 'onlyfans', conversationRef: '1', livePpvContext: livePpv }, capabilities: [] });
    expect(onReview.success).toBe(false);
  });

  it('[AI-121] fresh text goes only under freshText + context-v1; known fan ids only with context-v1', () => {
    const fresh = { capturedAt: '2026-10-03T10:00:00.000Z', messages: [{ platformMessageId: '4006', direction: 'fan' as const, sentAt: '2026-10-03T09:59:00.000Z', text: 'hey' }] };
    const on = buildStreamRequest(startOf({ fresh }), ctx);
    expect(on.ok && on.request.body.liveTextContext?.items[0]).toEqual({ platformMessageId: '4006', direction: 'fan', occurredAt: '2026-10-03T09:59:00.000Z', text: 'hey' });
    expect(ctx.freshText).toBe(true);
    const flagOff = pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['freshText']);
    const off = buildStreamRequest(startOf({ fresh }), { ...ctx, bootstrap: flagOff, freshText: freshTextOn(flagOff, binding.pageId) });
    expect(off.ok && off.request.body.liveTextContext).toBeUndefined();
    // The client's own need: without the hub's `context-v1` the request could not carry it, whatever the page's switch says.
    const noHeader = { ...BOOTSTRAP_PILOT_PAGES, capabilities: BOOTSTRAP_PILOT_PAGES.capabilities.filter((capability) => capability !== 'context-v1') };
    expect(freshTextOn(noHeader, binding.pageId)).toBe(false);
    const bare = buildStreamRequest(startOf({ fresh }), { ...ctx, bootstrap: noHeader, freshText: freshTextOn(noHeader, binding.pageId) });
    expect(bare.ok && bare.request.body.liveTextContext).toBeUndefined();
    const preview = buildStreamRequest(startOf({ surface: 'preview', target: targetOf('2003'), checkpoint: checkpointFor('2003') }), ctx);
    expect(preview.ok && preview.request.body.knownFanMessageIds).toEqual([WORLD.messages.fanLatest, WORLD.messages.fanFirst]);
    const previewOff = buildStreamRequest(startOf({ surface: 'preview', target: targetOf('2003'), checkpoint: checkpointFor('2003') }), { ...ctx, freshText: false });
    // The proof branch obeys freshText; ChatSpace's checkpoint request remains byte-identical.
    expect(JSON.stringify(previewOff)).toBe(JSON.stringify(preview));
    const noCtx = buildStreamRequest(startOf({ surface: 'preview', target: targetOf('2003'), checkpoint: checkpointFor('2003') }), { ...ctx, bootstrap: { ...BOOTSTRAP_PILOT_PAGES, capabilities: [] } });
    expect(noCtx.ok && noCtx.request.body.knownFanMessageIds).toBeUndefined();
    expect(noCtx.ok && noCtx.request.capabilities).toEqual([]);
  });

  it('[AI-121] a request the hub would refuse never leaves: the schema check reports it', () => {
    const bad = buildStreamRequest(startOf({ feature: 'coach', coach: { question: 'x'.repeat(5), history: [] } }), { ...ctx, opId: 'not-a-uuid' });
    expect(bad.ok).toBe(false);
  });
});

describe('[RB-016] [RB-004] [RB-005] the stream reader', () => {
  const expect0 = { opId: '00000000-0000-4000-8000-000000000100', personaDefinitionId: WORLD.persona.definitionId, debug: false };
  const metaFrame = meta('fast-reply');
  const delta = (text: string): HubFrame => ({ type: 'content_delta', text });

  it('[RB-016] frames of another operation are ignored: a foreign meta, a foreign context_v1', () => {
    const foreign = readFrame(INITIAL_STREAM_STATE, { ...metaFrame, clientRequestId: uuid(0x999) }, expect0);
    expect(foreign.effect).toEqual({ kind: 'ignored', reason: 'foreign-meta' });
    const afterMeta = readFrame(INITIAL_STREAM_STATE, metaFrame, expect0).state;
    expect(readFrame(afterMeta, contextFrame({ generationRef: uuid(0x999) }), expect0).effect).toEqual({ kind: 'ignored', reason: 'foreign-context' });
    expect(readFrame(afterMeta, metaFrame, expect0).effect).toEqual({ kind: 'ignored', reason: 'duplicate-meta' });
  });

  it('[RB-016] delayed frames after a terminal frame change nothing', () => {
    const done = readFrames([metaFrame, delta('Hi'), { type: 'done', stopReason: null }], expect0);
    const late = readFrame(done, delta(' more'), expect0);
    expect(late.effect).toEqual({ kind: 'ignored', reason: 'after-terminal' });
    expect(late.state.text).toBe('Hi');
  });

  it('[RB-004] a frame before meta or done without meta is a broken stream, not a result', () => {
    expect(readFrame(INITIAL_STREAM_STATE, delta('x'), expect0).effect).toEqual({ kind: 'terminal', terminal: { kind: 'contract', detail: 'content_delta before meta' } });
  });

  it('[RB-005] an error frame is terminal and nothing after it counts', () => {
    const state = readFrames([metaFrame, delta('Partial'), { type: 'error', code: 'provider_rate_limited', message: 'm', retryAfterMs: 30_000 }, { type: 'done', stopReason: null }], expect0);
    expect(state.terminal).toEqual({ kind: 'error', code: 'provider_rate_limited', retryAfterMs: 30_000 });
  });

  it('[AI-126] [AU-028] meta with another persona definition drops the result (§7 «Ограда»)', () => {
    const r = readFrame(INITIAL_STREAM_STATE, { ...metaFrame, personaDefinitionId: WORLD.persona.otherDefinitionId }, expect0);
    expect(r.effect).toEqual({ kind: 'terminal', terminal: { kind: 'persona-changed' } });
  });

  it('[AI-137] deltas accumulate; reasoning only in debug; usage and context are kept', () => {
    let s = readFrame(INITIAL_STREAM_STATE, metaFrame, expect0).state;
    const first = readFrame(s, delta('Hey '), expect0);
    expect(first.effect).toEqual({ kind: 'delta', text: 'Hey ', first: true });
    s = first.state;
    expect(readFrame(s, delta(''), expect0).effect).toEqual({ kind: 'ignored', reason: 'empty-delta' });
    expect(readFrame(s, { type: 'reasoning_delta', text: 'r' }, expect0).effect).toEqual({ kind: 'ignored', reason: 'reasoning-off' });
    expect(readFrame(s, { type: 'reasoning_delta', text: 'r' }, { ...expect0, debug: true }).state.reasoning).toBe('r');
    s = readFrame(s, contextFrame(), expect0).state;
    expect(s.servedContext?.source).toBe('union');
    expect(readFrame(s, { type: 'debug_input_v1', systemBlocks: [{ text: 's', cache: 'none' }], userBlocks: [{ text: 'u', cache: 'none' }], contextManifest: null }, expect0).effect).toEqual({
      kind: 'debug-input',
    });
    const usage = readFrame(s, { type: 'usage', usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, costMicroUsd: 5, costApproximate: false }, providerResponseId: null, cacheHit: false }, expect0);
    expect(usage.state.usage).toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, costMicroUsd: 5 });
  });

  it('[RB-016] [DB-028] context_v1 tokens this client does not know become null; foreign ids are dropped', () => {
    const served = narrowContext({
      ...contextFrame({ source: 'mirror_v2', live: { status: 'partial', accepted: 1, rejected: 1 } }),
      knownFanMessages: [
        { id: '4006', state: 'included' },
        { id: 'x', state: 'included' },
        { id: '4007', state: 'gone' },
      ],
      servedHead: { messageRef: 'not-numeric', occurredAt: null, isFromFan: true },
    });
    expect(served).toEqual({ source: null, servedHead: null, live: { status: null, accepted: 1, rejected: 1 }, knownFanMessages: [{ id: '4006', state: 'included' }, { id: '4007', state: null }] });
  });

  it('[AI-132] every hub SSE scenario reads to the same outcome as the reference reading', () => {
    for (const scenario of SSE_SCENARIOS) {
      const reference = readStreamScenario(scenario, NOW_MS);
      const last = scenario.responses[scenario.responses.length - 1];
      if (last?.kind !== 'stream') continue;
      const frames = last.steps.flatMap((step) => (step.kind === 'frame' ? [step.frame] : []));
      const state = readFrames(frames, { opId: scenario.request.body.clientRequestId, personaDefinitionId: WORLD.persona.definitionId, debug: true });
      if (reference.outcome === 'done') {
        expect(state.terminal, scenario.name).toEqual({ kind: 'done' });
        expect(state.text, scenario.name).toBe(reference.text);
      } else if (state.terminal === null) {
        expect(reference.resolution?.code, scenario.name).toBe('CG-STREAM-TRUNCATED');
      } else {
        expect(['error', 'persona-changed'], scenario.name).toContain(state.terminal.kind);
      }
    }
  });
});

describe('[AI-132] baseline result parse', () => {
  it('[AI-132] empty or whitespace output is unusable, never an empty result', () => {
    expect(basicParseResult('reply', '  ', { splitRequested: false, generationRef: uuid(1) })).toEqual({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
    expect(basicParseResult('reply', ' [NEXT] ', { splitRequested: true, generationRef: uuid(1) })).toEqual({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
  });

  it('[AI-132] parts, variants, review, recap and coach read as their result kinds', () => {
    expect(basicParseResult('reply', 'one [NEXT] two', { splitRequested: true, generationRef: uuid(1) })).toEqual({ ok: true, result: { kind: 'parts', parts: ['one', 'two'], splitRequested: true } });
    expect(basicParseResult('hi', 'a [NEXT] b[VARIANT]c', { splitRequested: false, generationRef: uuid(1) })).toEqual({ ok: true, result: { kind: 'variants', variants: [['a', 'b'], ['c']] } });
    expect(basicParseResult('review', ' r ', { splitRequested: false, generationRef: uuid(1) })).toEqual({ ok: true, result: { kind: 'review', doc: null, raw: 'r' } });
    expect(basicParseResult('recap', '## R', { splitRequested: false, generationRef: uuid(1) })).toMatchObject({ ok: true, result: { kind: 'recap', shared: { generationRef: uuid(1) } } });
    expect(basicParseResult('recap', '## R', { splitRequested: false, generationRef: null })).toEqual({ ok: false, code: 'CG-OUTPUT-UNUSABLE' });
    expect(basicParseResult('coach', 'do x', { splitRequested: false, generationRef: uuid(1) })).toMatchObject({ ok: true, result: { kind: 'coach' } });
    expect(basicParseResult('ping', Array.from({ length: 11 }, (_, i) => `p${i}`).join('[NEXT]'), { splitRequested: true, generationRef: uuid(1) }).ok).toBe(false);
    expect(basicParseResult('hi', 'a[VARIANT]b[VARIANT]c[VARIANT]d', { splitRequested: false, generationRef: uuid(1) }).ok).toBe(false);
    expect(splitParts('x[NEXT][NEXT]y')).toEqual(['x', 'y']);
    expect(splitVariants('[VARIANT]a')).toEqual([['a']]);
  });
});

describe('digests', () => {
  it('canonical JSON ignores key order and undefined members', () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [1, undefined] } })).toBe('{"a":{"c":[1,null]},"b":1}');
    expect(stableDigest({ a: 1, b: 2 })).toBe(stableDigest({ b: 2, a: 1 }));
    expect(digestHex('a')).not.toBe(digestHex('b'));
    expect(digestHex('')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('[RB-020] [RB-017] [AI-138] the tab mirror of an operation', () => {
  const phase = { name: 'streaming' as const, since: NOW_MS };
  const update = (seq: number, append: string, over: Partial<OpUpdate> = {}): OpUpdate => ({ opId: OP, seq, append, state: 'streaming', phase: { ...phase, since: NOW_MS + seq }, ...over });
  const doneView = (text: string) => ({
    opId: OP,
    feature: 'reply' as const,
    surface: 'dock' as const,
    target,
    state: 'done' as const,
    phase: { name: 'settled' as const, since: NOW_MS + 999 },
    startedAt: NOW_MS,
    endedAt: NOW_MS + 999,
    text,
    result: { kind: 'parts' as const, parts: [text], splitRequested: false },
    toneUsed: null,
  });

  it('[RB-020] property: shuffled, repeated and delayed batches never reorder text; seq only grows', () => {
    const rnd = seeded(20);
    for (let run = 0; run < 200; run += 1) {
      const count = 1 + rnd.int(12);
      const batches = Array.from({ length: count }, (_, i) => update(i + 1, `c${i + 1};`));
      // Delivery: in order with random duplicates and late repeats of earlier batches.
      const delivery: OpUpdate[] = [];
      for (const batch of batches) {
        delivery.push(batch);
        if (rnd.chance(0.3)) delivery.push(batch);
        if (rnd.chance(0.3)) delivery.push(rnd.pick(batches.slice(0, batch.seq)));
      }
      let mirror: OpMirror = newMirror(OP, { name: 'admitted', since: NOW_MS });
      let lastSeq = 0;
      for (const batch of delivery) {
        const next = applyOpUpdate(mirror, batch);
        expect(next.mirror.seq).toBeGreaterThanOrEqual(lastSeq);
        lastSeq = next.mirror.seq;
        mirror = next.mirror;
      }
      expect(mirror.text).toBe(batches.map((b) => b.append).join(''));
    }
  });

  it('[RB-016] a gap asks for a resync, another operation and anything after done change nothing', () => {
    let mirror = newMirror(OP, { name: 'admitted', since: NOW_MS });
    expect(applyOpUpdate(mirror, update(2, 'x')).outcome).toBe('gap');
    expect(applyOpUpdate(mirror, update(1, 'x', { opId: uuid(0x101) })).outcome).toBe('foreign');
    mirror = applyOpUpdate(mirror, update(1, 'Hel', { firstChunkAt: NOW_MS + 5 })).mirror;
    expect(mirror.firstChunkAt).toBe(NOW_MS + 5);
    const done = applyOpDone(mirror, doneView('Hello'));
    expect(done.outcome).toBe('applied');
    expect(done.mirror.text).toBe('Hello');
    expect(applyOpUpdate(done.mirror, update(2, 'late')).outcome).toBe('after-done');
    expect(applyOpDone(done.mirror, doneView('again')).outcome).toBe('stale');
    // [AI-128] the background sends the finished view again only to mark it stale.
    const marked = applyOpDone(done.mirror, { ...doneView('Hello'), stale: { reason: 'fan-wrote', at: null } });
    expect(marked.outcome).toBe('applied');
    expect(marked.mirror.done?.stale).toEqual({ reason: 'fan-wrote', at: null });
    expect(marked.mirror.text).toBe('Hello');
    expect(applyOpDone(marked.mirror, { ...doneView('Hello'), stale: { reason: 'fan-wrote', at: null } }).outcome).toBe('stale');
    expect(applyOpDone(mirror, { ...doneView('x'), opId: uuid(0x101) }).outcome).toBe('foreign');
    expect(applyOpDone(mirror, { ...doneView('x'), state: 'streaming' }).outcome).toBe('stale');
  });

  it('[RB-016] [AI-124] a mirror seeded from a re-attach view continues with the restarted batches; a finished view is done', () => {
    const running = { ...doneView('Hello there '), state: 'streaming' as const, phase, firstChunkAt: NOW_MS + 3 };
    delete (running as { endedAt?: number }).endedAt;
    delete (running as { result?: unknown }).result;
    const seeded = mirrorFromView(running);
    expect(seeded).toMatchObject({ seq: 0, text: 'Hello there ', state: 'streaming', firstChunkAt: NOW_MS + 3, done: null });
    const next = applyOpUpdate(seeded, update(1, 'friend'));
    expect(next.outcome).toBe('applied');
    expect(next.mirror.text).toBe('Hello there friend');
    const finished = mirrorFromView(doneView('All of it'));
    expect(finished.done?.state).toBe('done');
    expect(applyOpUpdate(finished, update(1, 'late')).outcome).toBe('after-done');
    const noText: OpView = { ...running };
    delete (noText as { text?: string }).text;
    expect(mirrorFromView(noText).text).toBe('');
  });

  it('[RB-020] an older state in a later batch does not move the mirror back', () => {
    const streaming = applyOpUpdate(newMirror(OP, { name: 'admitted', since: NOW_MS }), update(1, 'a')).mirror;
    const back = applyOpUpdate(streaming, update(2, 'b', { state: 'requesting', phase: { name: 'connecting', since: NOW_MS - 1 } })).mirror;
    expect(back.state).toBe('streaming');
    expect(back.phase.name).toBe('streaming');
    expect(back.text).toBe('ab');
  });

  it('[AI-138] Reply, Hi, Ping open with the first chunk or the cost; Fix only with its result', () => {
    const waiting = { state: 'streaming' as const, firstChunkAt: null };
    expect(panelOpens('reply', waiting, false)).toBe(false);
    expect(panelOpens('reply', { ...waiting, firstChunkAt: NOW_MS }, false)).toBe(true);
    expect(panelOpens('hi', waiting, true)).toBe(true);
    expect(panelOpens('fix', { ...waiting, firstChunkAt: NOW_MS }, true)).toBe(false);
    expect(panelOpens('fix', { state: 'done', firstChunkAt: NOW_MS }, false)).toBe(true);
    expect(showsStream('fix')).toBe(false);
    expect(showsStream('ping')).toBe(true);
  });

  it('[RB-017] a deferred render is dropped when the chat changed in between, kept otherwise', () => {
    const render = new DeferredRender(chatKeyOf(target.chat));
    const ticket = render.schedule();
    render.chatChanged(chatKeyOf(target.chat));
    expect(render.stillCurrent(ticket)).toBe(true);
    render.chatChanged(chatKeyOf(targetOf(WORLD.otherFan).chat));
    expect(render.stillCurrent(ticket)).toBe(false);
    render.chatChanged(chatKeyOf(target.chat));
    expect(render.stillCurrent(ticket)).toBe(false);
    expect(render.stillCurrent(render.schedule())).toBe(true);
  });
});

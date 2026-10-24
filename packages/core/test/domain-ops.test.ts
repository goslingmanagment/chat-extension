// core/domain/ops: admission, states, timeouts, the single retry, request
// identity and cache, the environment fence, the default request and the
// stream reader (architecture.md §7, §8.4). Tests are named after the parity
// rows they prove. Fansly's own cases are domain-ops-fansly.test.ts: a host
// mark puts a whole file on its site, and these rows are ChatSpace's too.

import { describe, expect, it } from 'vitest';

import { AdmissionSchema, HubStreamRequestSchema, OP_STATES, StartOpSchema, chatKeyOf, type HubFrame } from '@cg/contracts';
import {
  INITIAL_STREAM_STATE,
  MAX_STREAM_ATTEMPTS,
  buildStreamRequest,
  canMoveOp,
  canceledByChange,
  currentPersona,
  decideAdmission,
  followedPersonas,
  isActiveOpState,
  isTerminalOpState,
  readFrame,
  retryDecision,
  startPrecondition,
  type ActiveOpEntry,
  type OpsEnvironment,
} from '@cg/core/domain/ops';
import { BOOTSTRAP_PILOT_PAGES, contextFrame, meta, pageFeaturesOff } from '@cg/testing/hub';

import { featuresOf, freshTextOn } from './support/features';
import { NOW_MS, WORLD, binding, checkpointFor, persona, session, startOf, targetOf, uuid } from './support/world';
import { seeded } from './support/random';

const OP = uuid(0x100);

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
  // `freshText` — the admission of the manifest's `fresh-text` on the page, as the scheduler sets it.
  const ctx = { opId: OP, persona, bootstrap: BOOTSTRAP_PILOT_PAGES, debug: false, freshText: freshTextOn(BOOTSTRAP_PILOT_PAGES, binding.pageId) };

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

  it('«Рассылка»: a Fix of the mass message carries draftPurpose to a hub that lists outreach-fix-v1, and only a Fix', () => {
    const draft = { text: 'ok this one is SPECIAL', revision: 1, digest: 'abcdef12' };
    const served = { ...ctx, bootstrap: { ...BOOTSTRAP_PILOT_PAGES, capabilities: [...BOOTSTRAP_PILOT_PAGES.capabilities.filter((c) => c !== 'outreach-fix-v1'), 'outreach-fix-v1'] } };
    const built = buildStreamRequest(startOf({ feature: 'fix', draft, draftPurpose: 'outreach' }), served);
    expect(built.ok && built.request.body).toMatchObject({ draftText: 'ok this one is SPECIAL', draftPurpose: 'outreach' });
    // A hub that does not list it is never sent the field (its body is strict).
    const older = buildStreamRequest(startOf({ feature: 'fix', draft, draftPurpose: 'outreach' }), { ...ctx, bootstrap: { ...BOOTSTRAP_PILOT_PAGES, capabilities: BOOTSTRAP_PILOT_PAGES.capabilities.filter((c) => c !== 'outreach-fix-v1') } });
    expect(older.ok && 'draftPurpose' in older.request.body).toBe(false);
    expect(StartOpSchema.safeParse(startOf({ feature: 'reply', draftPurpose: 'outreach' })).success).toBe(false);
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
    // The request's own check (hub `assertLivePpvRequestShape`): in its page's shape — paid messages on OnlyFans, paid
    // attachments on Fansly — and on the features the hub takes it.
    const request = (feature: string, platform: 'onlyfans' | 'fansly', state: unknown) =>
      HubStreamRequestSchema.safeParse({
        feature,
        body: { clientRequestId: OP, pageLabel: 'p', platform, conversationRef: '1', ...(platform === 'fansly' ? { fanRef: '2' } : {}), ...(feature === 'fan-notes-fill' ? { noteFields: ['Имя'] } : {}), ...(state === undefined ? {} : { livePpvContext: state }) },
        capabilities: [],
      }).success;
    const attachments = { capturedAt: '2026-10-20T12:00:00.000Z', items: [{ platformMessageId: '9002', contentKind: 'media', contentRef: '9100', priceUsd: 25, purchased: false }] };
    expect(request('fast-reply', 'fansly', livePpv)).toBe(false);
    expect(request('fast-reply', 'onlyfans', attachments)).toBe(false);
    expect(request('fast-reply', 'fansly', attachments)).toBe(true);
    expect(request('chat-review', 'onlyfans', livePpv)).toBe(true);
    expect([request('fan-notes-fill', 'fansly', undefined), request('fan-notes-fill', 'fansly', attachments)]).toEqual([true, false]);
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

  it('[RB-004] a frame before meta or done without meta is a broken stream, not a result', () => {
    expect(readFrame(INITIAL_STREAM_STATE, delta('x'), expect0).effect).toEqual({ kind: 'terminal', terminal: { kind: 'contract', detail: 'content_delta before meta' } });
  });

  it('[AI-126] [AU-028] meta with another persona definition drops the result (§7 «Ограда»)', () => {
    const r = readFrame(INITIAL_STREAM_STATE, { ...metaFrame, personaDefinitionId: WORLD.persona.otherDefinitionId }, expect0);
    expect(r.effect).toEqual({ kind: 'terminal', terminal: { kind: 'persona-changed' } });
  });
});

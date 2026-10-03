// AI-142: the body of a generation request (architecture.md §8.4 table and
// «Общие поля», H-4, H-10) from an operation, the bootstrap and what the
// transport can carry.

import { HubStreamRequestSchema, type Bootstrap, type StartOp } from '@cg/contracts';
import { checkpoint, startReply, target, uuid } from '@cg/contracts/fixtures';
import { BOOTSTRAP_ALL_OFF, BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW_MS, WORLD } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildStreamRequest, type StreamRequestContext } from '../src/index';
import { fullStreamTransport } from './support/fake-hub';
import { makeHarness, signIn, type Harness } from './support/harness';
import { scenarioNamed, signInWorld } from './support/world';

const OP = uuid(0x777);
const PERSONA = { key: WORLD.persona.key, definitionId: WORLD.persona.definitionId };
const ALL = ['debug-input-v1', 'context-v1', 'split-all-v1'] as const;
const ctx = (over: Partial<StreamRequestContext> = {}): StreamRequestContext => ({
  opId: OP,
  persona: PERSONA,
  bootstrap: BOOTSTRAP_PILOT_ON,
  capabilities: ALL,
  debug: false,
  ...over,
});
const op = (over: Partial<StartOp>): StartOp => ({ ...startReply, fresh: undefined, ...over });
const build = (operation: StartOp, over: Partial<StreamRequestContext> = {}) => {
  const result = buildStreamRequest(operation, ctx(over));
  if (!result.ok) throw new Error(result.problem);
  expect(HubStreamRequestSchema.safeParse(result.request).success).toBe(true);
  return result.request;
};

describe('[AI-142] the request body of each feature', () => {
  it('[AI-142] Reply: refs, persona, tone, Split, window, fresh text and the context header', () => {
    const request = build(startReply);
    expect(request).toEqual({
      feature: 'fast-reply',
      capabilities: ['context-v1'],
      body: {
        clientRequestId: OP,
        pageLabel: target.binding.pageLabel,
        platform: 'onlyfans',
        conversationRef: target.fanRef,
        fanRef: target.fanRef,
        personaKey: PERSONA.key,
        expectedPersonaDefinitionId: PERSONA.definitionId,
        replyTone: 'flirty',
        replyMode: 'preferSplit',
        messageCount: 100,
        isRegeneration: false,
        liveTextContext: { capturedAt: startReply.fresh?.capturedAt, items: [{ platformMessageId: '4004', direction: 'fan', occurredAt: startReply.fresh?.messages[0]?.sentAt, text: 'hey' }] },
      },
    });
  });

  it('[AI-142] Reply without a tone sends `none`; Split off is `default`; Regenerate marks isRegeneration', () => {
    const request = build(op({ tone: null, split: false, regenerateOf: uuid(0x55) }));
    expect(request.body).toMatchObject({ replyTone: 'none', replyMode: 'default', isRegeneration: true });
    expect(request.body.liveTextContext).toBeUndefined();
  });

  it('[AI-142] Fix sends the draft; Hi the variant count; Ping and Hi preferSplit only with split-all-v1 and the splitAll flag', () => {
    expect(build(op({ feature: 'fix', tone: null, draft: { text: 'my draft', revision: 2, digest: 'deadbeefcafe0001' } })).body).toMatchObject({
      draftText: 'my draft',
      replyMode: 'preferSplit',
    });
    const hi = build(op({ feature: 'hi', tone: null, variantCount: 3 }));
    expect(hi).toMatchObject({ feature: 'hi-greeting', capabilities: ['context-v1', 'split-all-v1'], body: { variantCount: 3, replyMode: 'preferSplit' } });
    expect(hi.body.replyTone).toBeUndefined();
    const noSplitAll = build(op({ feature: 'ping', tone: null }), { capabilities: ['debug-input-v1', 'context-v1'] });
    expect(noSplitAll.body.replyMode).toBeUndefined();
    expect(noSplitAll.capabilities).toEqual(['context-v1']);
    const flagOff: Bootstrap = { ...BOOTSTRAP_PILOT_ON, flags: { ...BOOTSTRAP_PILOT_ON.flags, splitAll: false } };
    expect(build(op({ feature: 'ping', tone: null }), { bootstrap: flagOff }).body.replyMode).toBeUndefined();
    expect(build(op({ feature: 'ping', tone: null, split: false })).body.replyMode).toBeUndefined();
  });

  it('[AI-142] Review and Recap: no tone, no Split, no fresh text; the short recap is summaryMode short; the window is capped by deepMax', () => {
    const review = build(op({ feature: 'review', tone: null }));
    expect(review.feature).toBe('chat-review');
    expect(review.body).not.toHaveProperty('replyMode');
    expect(review.body).not.toHaveProperty('replyTone');
    expect(build(op({ feature: 'recap-short', tone: null, window: 3000 }), { bootstrap: BOOTSTRAP_ALL_OFF }).body).toMatchObject({ summaryMode: 'short', messageCount: 1500 });
    const full = build(op({ feature: 'recap', tone: null, window: 3000 }));
    expect(full).toMatchObject({ feature: 'fan-summary', body: { messageCount: 3000 } });
    expect(full.body.summaryMode).toBeUndefined();
  });

  it('[AI-142] Coach: question, preset, history and the attached reply; Split only with split-all-v1', () => {
    const coach = build(
      op({
        feature: 'coach',
        tone: null,
        coach: { question: 'How do I upsell?', preset: 'situation', history: [{ question: 'q1', answer: 'a1' }], attachDraft: 'my reply' },
      }),
    );
    expect(coach).toMatchObject({
      feature: 'coach-chat',
      capabilities: ['context-v1', 'split-all-v1'],
      body: { chatterQuestion: 'How do I upsell?', preset: 'situation', coachHistory: [{ question: 'q1', answer: 'a1' }], draftText: 'my reply', replyMode: 'preferSplit' },
    });
  });

  it('[AI-142] debug mode asks for the prompt echo; the transport\'s limits decide the header', () => {
    expect(build(startReply, { debug: true }).capabilities).toEqual(['debug-input-v1', 'context-v1']);
    // The vendored SDK carries only debug-input-v1: no context header, so no fresh text and no known ids.
    const sdk = build(op({ checkpoint, surface: 'preview' }), { capabilities: ['debug-input-v1'], debug: true });
    expect(sdk.capabilities).toEqual(['debug-input-v1']);
    expect(sdk.body.liveTextContext).toBeUndefined();
    expect(sdk.body.knownFanMessageIds).toBeUndefined();
  });

  it('[AI-142] the freshness checkpoint\'s known fan ids go with context-v1 (H-4b)', () => {
    expect(build(op({ checkpoint, surface: 'preview' })).body.knownFanMessageIds).toEqual(checkpoint.knownFanMessageIds);
  });

  it('[AI-142] fresh text only with the freshText flag usable, cut to the bootstrap limits', () => {
    const flagOff: Bootstrap = { ...BOOTSTRAP_PILOT_ON, flags: { ...BOOTSTRAP_PILOT_ON.flags, freshText: false } };
    expect(build(startReply, { bootstrap: flagOff }).body.liveTextContext).toBeUndefined();
    const tight: Bootstrap = { ...BOOTSTRAP_PILOT_ON, limits: { ...BOOTSTRAP_PILOT_ON.limits, freshTextMaxItems: 1, freshTextMaxChars: 3 } };
    const fresh = {
      capturedAt: startReply.fresh?.capturedAt ?? '',
      messages: [
        { platformMessageId: '4004', direction: 'fan' as const, sentAt: '2026-10-03T09:58:00Z', text: 'older' },
        { platformMessageId: '4006', direction: 'fan' as const, sentAt: '2026-10-03T09:59:00Z', text: 'newest' },
      ],
    };
    expect(build(op({ fresh }), { bootstrap: tight }).body.liveTextContext?.items).toEqual([{ platformMessageId: '4006', direction: 'fan', occurredAt: '2026-10-03T09:59:00Z', text: 'new' }]);
  });

  it('[AI-142] a request the contract refuses is never built', () => {
    const result = buildStreamRequest(startReply, ctx({ persona: { key: PERSONA.key, definitionId: 'short' } }));
    expect(result.ok).toBe(false);
  });
});

describe('[AI-142] the facade builds over the current bootstrap and transport', () => {
  let h: Harness;
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    h = makeHarness({ paths: HUB_ROUTE_PATHS, streamTransport: fullStreamTransport() });
  });
  afterEach(() => {
    h.facade.dispose();
    vi.useRealTimers();
  });

  it('[AI-142] refuses without a bootstrap; with one it asks only for what the hub declared', async () => {
    expect(h.facade.buildStreamRequest(startReply, { opId: OP, persona: PERSONA })).toEqual({ ok: false, problem: 'no bootstrap' });
    await signIn(h, signInWorld(scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off'), BOOTSTRAP_ALL_OFF, WORLD.user.username));
    // ALL_OFF declares no capability: only the echo (no declaration needed) would be possible.
    expect(h.facade.streamCapabilities()).toEqual(['debug-input-v1']);
    const result = h.facade.buildStreamRequest(startReply, { opId: OP, persona: PERSONA });
    expect(result.ok && result.request.capabilities).toEqual([]);
    expect(result.ok && result.request.body.liveTextContext).toBeUndefined();
  });
});

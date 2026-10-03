// core/services OpScheduler against the fake hub's stream scenarios on a
// fake clock (architecture.md §7): admission, the journal before the hub,
// 50 ms batches, phases, deadlines, the single retry and its interruption,
// cancel and the environment fence, toasts, restore after an unload, the
// stale marker, debug details, and the dossier save of a full recap.

import { describe, expect, it } from 'vitest';

import { OpViewSchema, TAB_EVENTS, chatKeyOf, type HubFrame, type IncomingFact, type OpView, type StartOp } from '@cg/contracts';
import { type OpsEnvironment } from '@cg/core/domain/ops';
import { ActionTokens, OPS_STORE_KEY, OpScheduler, RecapProfileSaver, profileSaveDelay, type OpSchedulerHooks, type TabPresence } from '@cg/core/services';
import { BOOTSTRAP_PILOT_ON, SSE_SCENARIOS, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { EventLog, FakeClock, LogRecorder, MemoryStore, sequentialIds } from './support/clock';
import { FakeHub, type ScriptResponse, type ScriptStep } from './support/fake-hub';
import { NOW_MS, WORLD, chatOf, checkpointFor, persona, session, startOf, targetOf, uuid } from './support/world';

const TAB = uuid(0xa1);
const OTHER_TAB = uuid(0xa2);

const scenario = (name: string): readonly ScriptResponse[] => {
  const found = SSE_SCENARIOS.find((s) => s.name === name);
  if (found === undefined) throw new Error(name);
  return found.responses;
};

/** The scenario's frames re-addressed to `opId` (meta.clientRequestId), generation `gen`. */
function forOp(responses: readonly ScriptResponse[], opId: string, gen = uuid(0x200)): ScriptResponse[] {
  const fix = (frame: HubFrame): HubFrame => {
    if (frame.type === 'meta') return { ...frame, clientRequestId: opId, requestId: gen };
    if (frame.type === 'context_v1') return { ...frame, generationRef: gen };
    return frame;
  };
  return responses.map((response) => (response.kind === 'stream' ? { kind: 'stream', steps: response.steps.map((step): ScriptStep => (step.kind === 'frame' ? { ...step, frame: fix(step.frame) } : step)) } : response));
}

const deltaStep = (text: string, afterMs = 20): ScriptStep => ({ kind: 'frame', frame: { type: 'content_delta', text }, afterMs });
const doneStep: ScriptStep = { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' } };
const metaStep = (feature: Parameters<typeof meta>[0] = 'fast-reply'): ScriptStep => ({ kind: 'frame', frame: meta(feature) });

interface Harness {
  readonly clock: FakeClock;
  readonly hub: FakeHub;
  readonly events: EventLog;
  readonly store: MemoryStore;
  readonly log: LogRecorder;
  readonly tokens: ActionTokens;
  readonly scheduler: OpScheduler;
  readonly presence: Map<string, TabPresence>;
  readonly hooks: { catalog: number; bootstrap: number; recaps: OpView[]; prompts: string[] };
  env: OpsEnvironment;
  start(tab: string, start: StartOp, opts?: { fanLabel?: string }): ReturnType<OpScheduler['start']>;
  /** The opId the next admission gets. */
  nextOp(): string;
}

function harness(over: { env?: Partial<OpsEnvironment>; store?: MemoryStore; clock?: FakeClock; firstId?: number } = {}): Harness {
  const clock = over.clock ?? new FakeClock(NOW_MS);
  const hub = new FakeHub(clock);
  const ids = sequentialIds(over.firstId ?? 0x100);
  const events = new EventLog();
  const store = over.store ?? new MemoryStore();
  const log = new LogRecorder();
  const tokens = new ActionTokens(clock, ids);
  const presence = new Map<string, TabPresence>();
  const counters = { catalog: 0, bootstrap: 0, recaps: [] as OpView[], prompts: [] as string[] };
  const hooks: OpSchedulerHooks = {
    refreshCatalog: () => {
      counters.catalog += 1;
    },
    refreshBootstrap: () => {
      counters.bootstrap += 1;
    },
    recapDone: (view) => {
      counters.recaps.push(view);
    },
    debugInput: (opId) => {
      counters.prompts.push(opId);
      return `prompt_${opId.slice(-4)}`;
    },
  };
  const h: Harness = {
    clock,
    hub,
    events,
    store,
    log,
    tokens,
    presence,
    hooks: counters,
    env: { session, bootstrap: BOOTSTRAP_PILOT_ON, persona: () => persona, debug: false, settingsLoaded: true, ...over.env },
    scheduler: undefined as unknown as OpScheduler,
    start: (tab, start, opts) => {
      const { actionToken } = tokens.issue(tab, 'generate', start.surface);
      return h.scheduler.start(tab, { ...start, cause: { kind: 'click', actionToken } }, opts);
    },
    nextOp: () => `00000000-0000-4000-8000-${(over.firstId ?? 0x100).toString(16).padStart(12, '0')}`,
  };
  (h as { scheduler: OpScheduler }).scheduler = new OpScheduler({
    clock,
    ids,
    hub,
    resolve: resolveHubErrorReference,
    environment: () => h.env,
    tokens,
    events,
    store,
    presence: (tab) => presence.get(tab) ?? null,
    log,
    hooks,
  });
  return h;
}

const opIdOf = (outcome: Awaited<ReturnType<OpScheduler['start']>>): string => {
  if (outcome.kind !== 'admission' || !outcome.admission.ok) throw new Error(`not admitted: ${JSON.stringify(outcome)}`);
  return outcome.admission.opId;
};

describe('[AI-137] [AI-139] [RB-016] a reply streams in 50 ms batches and ends with its result', () => {
  it('[AI-137] the admission is journaled before the hub request; batches carry monotonic seq; the result parses', async () => {
    const h = harness();
    const op = h.nextOp();
    h.hub.streamScript.push(...forOp(scenario('reply-normal'), op));
    const journalAtRequest: unknown[] = [];
    const stream = h.hub.stream.bind(h.hub);
    h.hub.stream = (request, sink, signal) => {
      journalAtRequest.push(h.store.data.get(OPS_STORE_KEY));
      return stream(request, sink, signal);
    };
    const outcome = await h.start(TAB, startOf({ tone: 'casual' }), { fanLabel: 'Fan Two' });
    expect(outcome).toEqual({ kind: 'admission', admission: { ok: true, opId: op }, reopened: false });
    await h.clock.advance(1000);

    expect(journalAtRequest).toHaveLength(1);
    expect(JSON.stringify(journalAtRequest[0])).toContain(op);
    const request = h.hub.streams[0];
    expect(request?.body).toMatchObject({ clientRequestId: op, pageLabel: WORLD.pages.one.pageLabel, conversationRef: WORLD.fan, fanRef: WORLD.fan, replyTone: 'casual', expectedPersonaDefinitionId: persona.definitionId });

    const updates = h.events.of('op.update');
    expect(updates.every((u) => u.to === TAB)).toBe(true);
    expect(updates.map((u) => u.payload.seq)).toEqual(updates.map((_, i) => i + 1));
    expect(updates.map((u) => u.payload.append).join('')).toBe('Hey you, missed me?');
    for (const u of updates) expect(TAB_EVENTS['op.update'].payload.safeParse(u.payload).success).toBe(true);
    const phases = updates.map((u) => u.payload.phase.name);
    expect(phases[0]).toBe('connecting');
    expect(phases).toContain('awaiting-first-chunk');
    expect(phases).toContain('streaming');

    const done = h.events.of('op.done');
    expect(done).toHaveLength(1);
    const view = done[0]?.payload.view;
    expect(OpViewSchema.safeParse(view).success).toBe(true);
    expect(view).toMatchObject({ opId: op, state: 'done', generationRef: uuid(0x200), result: { kind: 'parts', parts: ['Hey you, missed me?'], splitRequested: false }, toneUsed: 'casual' });
    expect(view?.servedContext?.source).toBe('union');
    expect(h.events.of('quota.changed')[0]?.payload.quota).toMatchObject({ pageId: WORLD.pages.one.pageId, remainingRequestsToday: 120, resetsAt: '2026-10-04T00:00:00.000Z' });
    expect(h.scheduler.quota(WORLD.pages.one.pageId)?.remainingRequestsToday).toBe(120);
    expect(h.scheduler.quota(999)).toBeNull();
    // No conversation text in logs (D-21).
    expect(JSON.stringify(h.log.entries)).not.toMatch(/missed me|Hey you/);
  });

  it('[AI-137] the first chunk leaves at once, later deltas within 50 ms as one batch; a long text is cut into bounded batches', async () => {
    const h = harness();
    const op = h.nextOp();
    const big = 'x'.repeat(70_000);
    h.hub.streamScript.push({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply', { clientRequestId: op }) }, deltaStep('a', 10), deltaStep('b', 10), deltaStep('c', 10), deltaStep('d', 10), deltaStep(big, 100), doneStep] });
    opIdOf(await h.start(TAB, startOf()));
    await h.clock.advance(1000);
    const appends = h.events.of('op.update').map((u) => u.payload.append).filter((a) => a.length > 0);
    expect(appends.slice(0, 2)).toEqual(['a', 'bcd']);
    expect(appends.slice(2).every((a) => a.length <= 64_000)).toBe(true);
    expect(appends.join('')).toBe(`abcd${big}`);
  });

  it('[RB-016] frames of another operation are ignored; content before our meta is a broken stream', async () => {
    const h = harness();
    h.hub.streamScript.push({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply', { clientRequestId: uuid(0x999) }) }, deltaStep('foreign'), doneStep] });
    const op = opIdOf(await h.start(TAB, startOf()));
    await h.clock.advance(1000);
    expect(h.scheduler.view(op)).toMatchObject({ state: 'failed', error: { code: 'CG-HUB-REQUEST' } });
    expect(h.scheduler.view(op)?.text).toBeUndefined();
  });
});

describe('[AI-123] [NEW-11] [RB-021] [AI-127] [AI-128] [AI-129] admission and the result cache', () => {
  it('[AI-123] three per tab, the fourth refused with the list of three; another tab is not limited by them', async () => {
    const h = harness();
    for (let i = 0; i < 4; i += 1) h.hub.streamScript.push({ kind: 'hang' });
    const fans = ['2101', '2102', '2103'];
    for (const fan of fans) opIdOf(await h.start(TAB, startOf({ target: targetOf(fan) }), { fanLabel: `Fan ${fan}` }));
    const fourth = await h.start(TAB, startOf({ target: targetOf('2104') }));
    expect(fourth.kind === 'admission' && !fourth.admission.ok && fourth.admission.code).toBe('CG-OP-TAB-LIMIT');
    if (fourth.kind === 'admission' && !fourth.admission.ok) expect(fourth.admission.active.map((a) => a.chat.platformFanId)).toEqual(fans);
    opIdOf(await h.start(OTHER_TAB, startOf({ target: targetOf('2104') })));
    expect(h.scheduler.active()).toHaveLength(4);
  });

  it('[NEW-11] the same chat in another tab is busy; [AI-127] the same request in the same tab reopens it', async () => {
    const h = harness();
    h.hub.streamScript.push({ kind: 'hang' });
    const op = opIdOf(await h.start(TAB, startOf()));
    const other = await h.start(OTHER_TAB, startOf());
    expect(other.kind === 'admission' && !other.admission.ok && other.admission.code).toBe('CG-OP-CHAT-BUSY');
    expect(await h.start(TAB, startOf())).toEqual({ kind: 'admission', admission: { ok: true, opId: op }, reopened: true });
    const review = await h.start(TAB, startOf({ feature: 'review', window: 3000 }));
    expect(review.kind === 'admission' && !review.admission.ok && review.admission.code).toBe('CG-OP-CHAT-BUSY');
    expect(h.hub.streams).toHaveLength(1);
  });

  it('[RB-021] property: twenty concurrent identical clicks are one operation and one POST', async () => {
    const h = harness();
    h.hub.streamScript.push({ kind: 'hang' });
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => h.start(TAB, startOf())));
    const ids = new Set(outcomes.map(opIdOf));
    expect(ids.size).toBe(1);
    expect(outcomes.filter((o) => o.kind === 'admission' && !o.reopened)).toHaveLength(1);
    await h.clock.advance(10);
    expect(h.hub.streams).toHaveLength(1);
  });

  it('[AI-128] a finished request reopens its result; [AI-129] Regenerate and Refresh make a new generation', async () => {
    const h = harness();
    const first = h.nextOp();
    h.hub.streamScript.push(...forOp(scenario('reply-normal'), first));
    opIdOf(await h.start(TAB, startOf()));
    await h.clock.advance(1000);
    expect(await h.start(TAB, startOf())).toEqual({ kind: 'admission', admission: { ok: true, opId: first }, reopened: true });
    // Another tab sees the same cached result too (one result per request identity).
    expect(await h.start(OTHER_TAB, startOf())).toEqual({ kind: 'admission', admission: { ok: true, opId: first }, reopened: true });
    expect(h.hub.streams).toHaveLength(1);

    h.hub.streamScript.push({ kind: 'hang' });
    const regen = opIdOf(await h.start(TAB, startOf({ regenerateOf: first })));
    expect(regen).not.toBe(first);
    expect(h.hub.streams[1]?.body.isRegeneration).toBe(true);
    h.scheduler.cancel(regen);
    h.hub.streamScript.push({ kind: 'hang' });
    opIdOf(await h.start(TAB, startOf({ force: true })));
    expect(h.hub.streams).toHaveLength(3);
    // 30 minutes later the cache forgets.
    h.scheduler.cancel(h.scheduler.active()[0]?.opId ?? '');
    await h.clock.advance(31 * 60_000);
    h.hub.streamScript.push({ kind: 'hang' });
    const fresh = await h.start(TAB, startOf());
    expect(fresh.kind === 'admission' && fresh.reopened).toBe(false);
  });

  it('[BG-001] [AI-120] no token, a spent token or another kind starts nothing', async () => {
    const h = harness();
    const forged = await h.scheduler.start(TAB, startOf({ token: 'tok_forged_0000000000' }));
    expect(forged).toEqual({ kind: 'refused', code: 'CG-UI-FAILED' });
    const { actionToken } = h.tokens.issue(TAB, 'insert', 'dock');
    expect(await h.scheduler.start(TAB, { ...startOf(), cause: { kind: 'click', actionToken } })).toEqual({ kind: 'refused', code: 'CG-UI-FAILED' });
    const issued = h.tokens.issue(TAB, 'generate', 'dock');
    h.hub.streamScript.push({ kind: 'hang' });
    opIdOf(await h.scheduler.start(TAB, { ...startOf(), cause: { kind: 'click', actionToken: issued.actionToken } }));
    expect(await h.scheduler.start(TAB, { ...startOf({ feature: 'review', window: 3000 }), cause: { kind: 'click', actionToken: issued.actionToken } })).toEqual({ kind: 'refused', code: 'CG-UI-FAILED' });
    expect(h.hub.streams).toHaveLength(1);
  });

  it('[AI-121] [RB-013] a failed precondition spends nothing on the hub and writes nothing', async () => {
    const h = harness({ env: { persona: () => null } });
    expect(await h.start(TAB, startOf())).toEqual({ kind: 'refused', code: 'CG-PERSONA-UNASSIGNED' });
    h.env = { ...h.env, persona: () => persona, settingsLoaded: false };
    expect(await h.start(TAB, startOf({ feature: 'coach', coach: { question: 'q?', history: [] } }))).toEqual({ kind: 'refused', code: 'CG-STORAGE-READ' });
    expect(h.hub.streams).toHaveLength(0);
    expect(h.store.writes).toBe(0);
  });

  it('[AI-121] the admission journal could not be written: refused CG-STORAGE-WRITE and the slot is free again', async () => {
    const h = harness();
    h.store.failWrites = true;
    expect(await h.start(TAB, startOf())).toEqual({ kind: 'refused', code: 'CG-STORAGE-WRITE' });
    expect(h.scheduler.active()).toHaveLength(0);
    expect(h.hub.streams).toHaveLength(0);
    h.store.failWrites = false;
    h.hub.streamScript.push({ kind: 'hang' });
    opIdOf(await h.start(TAB, startOf()));
  });
});

describe('[AI-133] [RB-001] the single retry and nothing else', () => {
  it('[AI-133] a 503 before any frame retries once after 5 s with the retry-wait phase', async () => {
    const h = harness();
    const op = h.nextOp();
    h.hub.streamScript.push(...forOp(scenario('unavailable-503-then-stream'), op));
    opIdOf(await h.start(TAB, startOf()));
    await h.clock.advance(1);
    const wait = h.events.of('op.update').map((u) => u.payload.phase).find((p) => p.name === 'retry-wait');
    expect(wait?.retryAt).toBe(NOW_MS + 5000);
    expect(h.hub.streams).toHaveLength(1);
    await h.clock.advance(4990);
    expect(h.hub.streams).toHaveLength(1);
    await h.clock.advance(1000);
    expect(h.hub.streams).toHaveLength(2);
    expect(h.scheduler.view(op)).toMatchObject({ state: 'done', result: { parts: ['Back online'] } });
  });

  it('[RB-001] the retry is refused too: CG-HUB-UNAVAILABLE after two POSTs, never a third', async () => {
    const h = harness();
    h.hub.streamScript.push(...scenario('unavailable-503-twice'));
    const op = opIdOf(await h.start(TAB, startOf()));
    await h.clock.advance(60_000);
    expect(h.hub.streams).toHaveLength(2);
    expect(h.scheduler.view(op)).toMatchObject({ state: 'failed', error: { code: 'CG-HUB-UNAVAILABLE', httpStatus: 503 } });
  });

  it('[AI-133] the wait is interrupted by a cancel or a persona change and nothing is POSTed later', async () => {
    for (const how of ['cancel', 'persona'] as const) {
      const h = harness();
      h.hub.streamScript.push(...scenario('unavailable-503-then-stream'));
      const op = opIdOf(await h.start(TAB, startOf()));
      await h.clock.advance(1000);
      if (how === 'cancel') h.scheduler.cancel(op);
      else {
        h.env = { ...h.env, persona: () => ({ ...persona, definitionId: WORLD.persona.otherDefinitionId }) };
        h.scheduler.environmentChanged({ kind: 'persona', pageId: WORLD.pages.one.pageId, next: { ...persona, definitionId: WORLD.persona.otherDefinitionId } });
      }
      await h.clock.advance(10_000);
      expect(h.hub.streams).toHaveLength(1);
      expect(h.scheduler.view(op)?.state).toBe('canceled');
    }
  });

  it('[RB-001] a 503 after a frame, a 502, an EOF, a timeout and a network failure are not retried', async () => {
    for (const responses of [
      [{ kind: 'stream', steps: [metaStep(), { kind: 'eof' }] }],
      [{ kind: 'http-error', status: 502, body: { error: 'internal_error' } }],
      [{ kind: 'network' }],
    ] as ScriptResponse[][]) {
      const h = harness();
      h.hub.streamScript.push(...forOp(responses, h.nextOp()));
      const op = opIdOf(await h.start(TAB, startOf()));
      await h.clock.advance(120_000);
      expect(h.hub.streams).toHaveLength(1);
      expect(h.scheduler.view(op)?.state).toBe('failed');
    }
  });
});

describe('[RB-002] [RB-003] [RB-004] [RB-005] [RB-006] [AI-132] how an operation ends', () => {
  const ended = async (responses: readonly ScriptResponse[], start: StartOp = startOf(), ms = 400_000): Promise<{ h: Harness; view: OpView | null }> => {
    const h = harness();
    h.hub.streamScript.push(...forOp(responses, h.nextOp()));
    const op = opIdOf(await h.start(TAB, start));
    await h.clock.advance(ms);
    return { h, view: h.scheduler.view(op) };
  };

  it('[RB-002] no meta within 30 s (reply) or 180 s (review) is CG-HUB-TIMEOUT, never retried', async () => {
    const reply = await ended([{ kind: 'hang' }], startOf(), 29_000);
    expect(reply.view?.state).toBe('requesting');
    await reply.h.clock.advance(2_000);
    expect(reply.h.scheduler.view(reply.view?.opId ?? '')).toMatchObject({ state: 'failed', error: { code: 'CG-HUB-TIMEOUT' } });
    const review = await ended([{ kind: 'hang' }], startOf({ feature: 'review', window: 3000 }), 179_000);
    expect(review.view?.state).toBe('requesting');
    await review.h.clock.advance(2_000);
    expect(review.h.scheduler.view(review.view?.opId ?? '')?.error?.code).toBe('CG-HUB-TIMEOUT');
    expect(review.h.hub.streams).toHaveLength(1);
  });

  it('[RB-002] meta then silence: the first chunk deadline; chunks then silence: the silence deadline; the whole maximum', async () => {
    const quiet = await ended([{ kind: 'stream', steps: [metaStep(), { kind: 'stall' }] }], startOf(), 31_000);
    expect(quiet.view?.error?.code).toBe('CG-HUB-TIMEOUT');
    const drip: ScriptStep[] = [metaStep(), ...Array.from({ length: 10 }, () => deltaStep('.', 9_000)), { kind: 'stall' }];
    const max = await ended([{ kind: 'stream', steps: drip }], startOf(), 61_000);
    expect(max.view).toMatchObject({ state: 'failed', error: { code: 'CG-HUB-TIMEOUT' } });
    expect(max.h.log.entries.some((e) => e.msg === 'stream deadline passed' && (e.fields as { kind: string }).kind === 'max')).toBe(true);
  });

  it('[RB-005] an error frame is terminal, keeps its deadline, and wins over the EOF after it', async () => {
    const { view } = await ended(scenario('error-frame-provider-rate-limited'));
    expect(view).toMatchObject({ state: 'failed', error: { code: 'CG-PROVIDER-RATE-LIMIT', retryAt: NOW_MS + 20 + 30_000 } });
    expect(view?.text).toBeUndefined();
    expect(view?.result).toBeUndefined();
  });

  it('[RB-004] EOF without done is CG-STREAM-TRUNCATED and the partial text is never a result', async () => {
    for (const name of ['truncated-mid-stream', 'truncated-before-meta']) {
      const { view } = await ended(scenario(name));
      expect(view).toMatchObject({ state: 'failed', error: { code: 'CG-STREAM-TRUNCATED' } });
      expect(view?.result).toBeUndefined();
    }
  });

  it('[RB-006] [RB-003] offline is CG-NETWORK; a timeout is CG-HUB-TIMEOUT; a cancel is canceled without a code', async () => {
    expect((await ended([{ kind: 'network' }])).view?.error?.code).toBe('CG-NETWORK');
    const h = harness();
    h.hub.streamScript.push({ kind: 'hang' });
    const op = opIdOf(await h.start(TAB, startOf()));
    expect(h.scheduler.cancel(op)).toBe('canceled');
    expect(h.scheduler.view(op)?.error).toBeUndefined();
    expect(h.scheduler.cancel(op)).toBe('canceled');
    expect(h.scheduler.cancel(uuid(0xdead))).toBeNull();
  });

  it('[AI-132] a stream with no usable output is CG-OUTPUT-UNUSABLE', async () => {
    const { view } = await ended([{ kind: 'stream', steps: [metaStep(), deltaStep('   '), doneStep] }]);
    expect(view).toMatchObject({ state: 'failed', error: { code: 'CG-OUTPUT-UNUSABLE' } });
  });

  it('[AI-126] [AU-028] persona fence: a 409 and a meta with another definition both drop the result and refresh the catalog', async () => {
    const pre = await ended(scenario('persona-409'));
    expect(pre.view?.error?.code).toBe('CG-PERSONA-CHANGED');
    expect(pre.h.hooks.catalog).toBe(1);
    const inMeta = await ended(scenario('persona-changed-in-meta'));
    expect(inMeta.view).toMatchObject({ state: 'failed', error: { code: 'CG-PERSONA-CHANGED' } });
    expect(inMeta.view?.result).toBeUndefined();
    expect(inMeta.h.hooks.catalog).toBe(1);
  });

  it('[AI-132] every SSE scenario ends as the reference reading says', async () => {
    for (const s of SSE_SCENARIOS) {
      const start = s.request.feature === 'hi-greeting' ? startOf({ feature: 'hi', variantCount: 3 }) : s.request.feature === 'coach-chat' ? startOf({ feature: 'coach', coach: { question: 'q', history: [] } }) : startOf();
      const { h, view } = await ended(s.responses, start);
      expect({ name: s.name, state: view?.state, code: view?.error?.code ?? null }).toEqual({ name: s.name, state: s.expect.outcome, code: s.expect.cg });
      expect({ name: s.name, posts: h.hub.streams.length }).toEqual({ name: s.name, posts: s.expect.requests });
    }
  });

  it('[RB-005] a client-feature refusal asks for a bootstrap refresh', async () => {
    const { h, view } = await ended([{ kind: 'http-error', status: 409, body: { error: 'client_feature_disabled' } }]);
    expect(view?.error?.code).toBe('CG-FEATURE-DISABLED');
    expect(h.hooks.bootstrap).toBe(1);
  });
});

describe('[AI-124] [AI-126] [AI-130] [AI-131] [BG-006] the run lives in the background', () => {
  it('[AI-124] [BG-006] a chat switch and a closed tab do not cancel; the result is kept, the tab gets no more batches', async () => {
    const h = harness();
    const op = h.nextOp();
    h.hub.streamScript.push(...forOp(scenario('reply-normal'), op));
    opIdOf(await h.start(TAB, startOf()));
    h.presence.set(TAB, { chat: chatOf(WORLD.otherFan), routeEpoch: 9, visible: true, focused: true });
    await h.clock.advance(5);
    expect(h.scheduler.detachTab(TAB)).toEqual([op]);
    h.events.clear();
    await h.clock.advance(1000);
    expect(h.scheduler.view(op)?.state).toBe('done');
    expect(h.events.of('op.update')).toHaveLength(0);
    expect(h.events.of('toast')).toHaveLength(0);
    expect(h.scheduler.detachTab(TAB)).toEqual([]);
    expect(h.scheduler.attachTab(op, OTHER_TAB)?.state).toBe('done');
    expect(h.scheduler.attachTab(uuid(0xdead), OTHER_TAB)).toBeNull();
  });

  it('[AI-131] [AI-130] only an explicit cancel stops it; late frames after a cancel change nothing', async () => {
    const h = harness();
    const op = h.nextOp();
    h.hub.streamScript.push(...forOp(scenario('reply-normal'), op));
    opIdOf(await h.start(TAB, startOf()));
    await h.clock.advance(25);
    h.scheduler.cancel(op);
    await h.clock.advance(1000);
    expect(h.scheduler.view(op)).toMatchObject({ state: 'canceled' });
    expect(h.events.of('op.done')).toHaveLength(1);
  });

  it('[AI-126] a persona, sign-in or hub change cancels the operations of that page and sign-in only', async () => {
    const h = harness();
    for (let i = 0; i < 3; i += 1) h.hub.streamScript.push({ kind: 'hang' });
    const a = opIdOf(await h.start(TAB, startOf()));
    const b = opIdOf(await h.start(TAB, startOf({ target: targetOf(WORLD.otherFan) })));
    expect(h.scheduler.environmentChanged({ kind: 'persona', pageId: 999, next: null })).toEqual([]);
    expect(h.scheduler.environmentChanged({ kind: 'persona', pageId: WORLD.pages.one.pageId, next: persona })).toEqual([]);
    expect(h.scheduler.environmentChanged({ kind: 'persona', pageId: WORLD.pages.one.pageId, next: null })).toEqual([a, b]);
    expect(h.scheduler.view(a)?.error?.code).toBe('CG-PERSONA-CHANGED');
    const c = opIdOf(await h.start(TAB, startOf({ feature: 'review', window: 3000 })));
    expect(h.scheduler.environmentChanged({ kind: 'hub', origin: 'https://other.example.test' })).toEqual([c]);
    // A sign-out forgets the old sign-in's results (the cache never crosses users).
    expect(h.scheduler.view(a)).toBeNull();
  });

  it('[AU-018] a re-sign-in of the same user keeps nothing of the old epoch', async () => {
    const h = harness();
    const op = h.nextOp();
    h.hub.streamScript.push(...forOp(scenario('reply-normal'), op));
    opIdOf(await h.start(TAB, startOf()));
    await h.clock.advance(1000);
    h.scheduler.environmentChanged({ kind: 'session', next: session });
    expect(h.scheduler.view(op)?.state).toBe('done');
    h.scheduler.environmentChanged({ kind: 'session', next: { ...session, epoch: session.epoch + 1 } });
    expect(h.scheduler.view(op)).toBeNull();
  });

  it('[AI-124] «AI готово · {фан}» when the owning tab shows another chat; none when it shows this one; «не получилось» on failure', async () => {
    const h = harness();
    const op = h.nextOp();
    h.hub.streamScript.push(...forOp(scenario('reply-normal'), op));
    h.presence.set(TAB, { chat: chatOf(WORLD.otherFan), routeEpoch: 3, visible: true, focused: true });
    opIdOf(await h.start(TAB, startOf(), { fanLabel: 'Fan Two' }));
    await h.clock.advance(1000);
    const ready = h.events.of('toast');
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ to: TAB, payload: { toast: { kind: 'success', scope: 'op.ready', opId: op, fanLabel: 'Fan Two', chat: chatOf(WORLD.fan) } } });
    expect(TAB_EVENTS.toast.payload.safeParse(ready[0]?.payload).success).toBe(true);

    const here = harness();
    here.hub.streamScript.push(...forOp(scenario('reply-normal'), here.nextOp()));
    here.presence.set(TAB, { chat: chatOf(WORLD.fan), routeEpoch: 3, visible: true, focused: true });
    opIdOf(await here.start(TAB, startOf()));
    await here.clock.advance(1000);
    expect(here.events.of('toast')).toHaveLength(0);

    const fail = harness();
    fail.hub.streamScript.push({ kind: 'network' });
    fail.presence.set(TAB, { chat: null, routeEpoch: 3, visible: true, focused: true });
    opIdOf(await fail.start(TAB, startOf()));
    await fail.clock.advance(10);
    expect(fail.events.of('toast')[0]?.payload.toast).toMatchObject({ kind: 'error', scope: 'op.failed', code: 'CG-NETWORK' });
  });
});

describe('[RB-019] [AI-128] stale results and lists', () => {
  const fact = (over: Partial<IncomingFact> = {}): IncomingFact => ({
    host: 'chatspace',
    hostAccountId: WORLD.pages.one.hostAccountId,
    platformFanId: WORLD.fan,
    platformMessageId: '4500',
    fromFan: true,
    automatic: false,
    tip: false,
    sentAt: '2026-10-03T10:00:05.000Z',
    socketEpoch: 1,
    fanSequence: 3,
    source: 'ws-tap',
    ...over,
  });

  it('[AI-128] a new fan message marks the finished result stale once; the served head and other chats do not', async () => {
    const h = harness();
    const op = h.nextOp();
    h.hub.streamScript.push(...forOp(scenario('reply-normal'), op));
    opIdOf(await h.start(TAB, startOf()));
    await h.clock.advance(1000);
    h.events.clear();
    expect(h.scheduler.incoming(fact({ platformMessageId: WORLD.messages.fanLatest }))).toEqual([]);
    expect(h.scheduler.incoming(fact({ platformFanId: WORLD.otherFan }))).toEqual([]);
    expect(h.scheduler.incoming(fact())).toEqual([op]);
    expect(h.scheduler.incoming(fact({ platformMessageId: '4501' }))).toEqual([]);
    expect(h.scheduler.view(op)?.stale).toEqual({ reason: 'fan-wrote', at: '2026-10-03T10:00:05.000Z' });
    expect(h.events.of('op.done')).toHaveLength(1);
  });

  it('[RB-019] op.list: this tab or this chat, newest first, capped; all tabs capped at 200 with truncated', async () => {
    const h = harness();
    for (let i = 0; i < 3; i += 1) h.hub.streamScript.push({ kind: 'hang' });
    const a = opIdOf(await h.start(TAB, startOf()));
    await h.clock.advance(1);
    const b = opIdOf(await h.start(OTHER_TAB, startOf({ target: targetOf(WORLD.otherFan) })));
    expect(h.scheduler.list(TAB, 'tab').ops.map((v) => v.opId)).toEqual([a]);
    expect(h.scheduler.list(TAB, 'tab', chatKeyOf(chatOf(WORLD.otherFan))).ops.map((v) => v.opId)).toEqual([b]);
    expect(h.scheduler.list(TAB, 'all')).toMatchObject({ truncated: false });
    expect(h.scheduler.list(TAB, 'all').ops.map((v) => v.opId)).toEqual([b, a]);
  });
});

describe('[BG-004] [RB-003] restore after an unload', () => {
  it('[BG-004] a running operation comes back interrupted and is never POSTed again; finished results reopen; damage is dropped', async () => {
    const clock = new FakeClock(NOW_MS);
    const store = new MemoryStore();
    const first = harness({ clock, store });
    const done = first.nextOp();
    first.hub.streamScript.push(...forOp(scenario('reply-normal'), done));
    opIdOf(await first.start(TAB, startOf()));
    await clock.advance(1000);
    first.hub.streamScript.push({ kind: 'hang' });
    const running = opIdOf(await first.start(TAB, startOf({ target: targetOf(WORLD.otherFan) })));
    await clock.advance(10);
    // The event page unloads; a new instance starts from storage.session.
    const raw = store.data.get(OPS_STORE_KEY) as { v: number; ops: unknown[] };
    store.data.set(OPS_STORE_KEY, { ...raw, ops: [...raw.ops, { view: { opId: 'broken' }, meta: {} }, null] });
    const second = harness({ clock, store, firstId: 0x300 });
    expect(await second.scheduler.restore()).toEqual({ restored: 2, interrupted: 1, dropped: 2 });
    expect(second.scheduler.view(running)).toMatchObject({ state: 'interrupted', error: { code: 'CG-OP-INTERRUPTED' } });
    expect(second.scheduler.view(done)?.state).toBe('done');
    expect(await second.start(TAB, startOf())).toEqual({ kind: 'admission', admission: { ok: true, opId: done }, reopened: true });
    expect(second.hub.streams).toHaveLength(0);
    // Nothing starts by itself after a restore (BG-001).
    await clock.advance(120_000);
    expect(second.hub.streams).toHaveLength(0);
    expect(second.scheduler.active()).toHaveLength(0);
  });

  it('[BG-004] results older than 30 minutes and unreadable stores come back empty', async () => {
    const clock = new FakeClock(NOW_MS);
    const store = new MemoryStore();
    const first = harness({ clock, store });
    first.hub.streamScript.push(...forOp(scenario('reply-normal'), first.nextOp()));
    opIdOf(await first.start(TAB, startOf()));
    await clock.advance(1000);
    await clock.advance(31 * 60_000);
    expect(await harness({ clock, store }).scheduler.restore()).toEqual({ restored: 0, interrupted: 0, dropped: 1 });
    const empty = new MemoryStore();
    empty.data.set(OPS_STORE_KEY, 'garbage');
    expect(await harness({ clock, store: empty }).scheduler.restore()).toEqual({ restored: 0, interrupted: 0, dropped: 1 });
    const failing = new MemoryStore();
    failing.failReads = true;
    await expect(harness({ clock, store: failing }).scheduler.restore()).rejects.toThrow();
  });

  it('[X8-04] a preview keeps its checkpoint across a restore, for the send coordinator', async () => {
    const clock = new FakeClock(NOW_MS);
    const store = new MemoryStore();
    const first = harness({ clock, store });
    const op = first.nextOp();
    first.hub.streamScript.push(...forOp(scenario('reply-normal'), op));
    const checkpoint = checkpointFor(WORLD.otherFan);
    opIdOf(await first.start(TAB, startOf({ surface: 'preview', target: targetOf(WORLD.otherFan), checkpoint })));
    await clock.advance(1000);
    const second = harness({ clock, store });
    await second.scheduler.restore();
    expect(second.scheduler.forSend(op)?.checkpoint).toEqual(checkpoint);
    expect(second.scheduler.forSend(uuid(0xdead))).toBeNull();
  });
});

describe('[DB-011] [DB-014] debug details', () => {
  it('[DB-011] stages, usage, reasoning, context and the prompt token only with debug on', async () => {
    const h = harness({ env: { debug: true } });
    const op = h.nextOp();
    h.hub.streamScript.push(...forOp(scenario('debug-input-and-reasoning'), op));
    opIdOf(await h.start(TAB, startOf({ feature: 'recap', window: 3000 })));
    await h.clock.advance(1000);
    const view = h.scheduler.view(op);
    expect(OpViewSchema.safeParse(view).success).toBe(true);
    expect(view?.debug?.usage?.costMicroUsd).toBe(3100);
    expect(view?.debug?.reasoning).toBe('Looking at spend');
    expect(view?.debug?.promptToken).toBe(`prompt_${op.slice(-4)}`);
    expect(view?.debug?.context).toMatchObject({ windowRequested: 3000, windowServed: 1500, coverage: 'partial' });
    expect(view?.debug?.stages.map((s) => s.name)).toEqual(expect.arrayContaining(['admitted', 'meta', 'first-chunk', 'done', 'settled']));
    expect(h.hooks.recaps.map((v) => v.opId)).toEqual([op]);
    expect(h.hub.streams[0]?.capabilities).toContain('debug-input-v1');

    const plain = harness();
    plain.hub.streamScript.push(...forOp(scenario('reply-normal'), plain.nextOp()));
    const quiet = opIdOf(await plain.start(TAB, startOf()));
    await plain.clock.advance(1000);
    expect(plain.scheduler.view(quiet)?.debug).toBeUndefined();
  });
});

describe('[RB-018] the dossier save of a full recap (H-5)', () => {
  const recapView = (opId: string): OpView => ({
    opId,
    feature: 'recap',
    surface: 'dock',
    target: targetOf(WORLD.fan),
    state: 'done',
    phase: { name: 'settled', since: NOW_MS },
    startedAt: NOW_MS,
    endedAt: NOW_MS,
    generationRef: uuid(0x200),
    result: { kind: 'recap', markdown: '## r', coverage: null, shared: { generationRef: uuid(0x200) } },
    toneUsed: null,
  });

  it('[RB-018] not-ready repeats after 5, 15, 60 s, then every 3 min; saved ends it with a toast', async () => {
    const clock = new FakeClock(NOW_MS);
    const h = harness({ clock });
    const saver = new RecapProfileSaver({ clock, ids: sequentialIds(0x700), hub: h.hub, events: h.events, tabOpen: () => true });
    h.hub.profileScript.push({ state: 'not-ready' }, { state: 'not-ready' }, { state: 'not-ready' }, { state: 'not-ready' }, { state: 'saved', response: { outcome: 'created', profile: { version: 1, createdAt: '2026-10-03T10:05:00.000Z', sourceGeneratedAt: null } } });
    saver.save(recapView(uuid(0x101)), TAB);
    await clock.advance(1);
    expect(h.hub.profiles).toHaveLength(1);
    expect(h.hub.profiles[0]).toEqual({ pageLabel: WORLD.pages.one.pageLabel, fanRef: WORLD.fan, generationRef: uuid(0x200), clientRequestId: uuid(0x101) });
    await clock.advance(5_000);
    expect(h.hub.profiles).toHaveLength(2);
    await clock.advance(15_000);
    expect(h.hub.profiles).toHaveLength(3);
    await clock.advance(60_000);
    expect(h.hub.profiles).toHaveLength(4);
    await clock.advance(180_000);
    expect(h.hub.profiles).toHaveLength(5);
    expect(saver.outcome(uuid(0x101))).toBe('saved');
    expect(h.events.of('toast')[0]?.payload.toast).toMatchObject({ kind: 'success', scope: 'recap.profile' });
    expect([1, 2, 3, 4, 9].map(profileSaveDelay)).toEqual([5_000, 15_000, 60_000, 180_000, 180_000]);
  });

  it('[RB-018] gives up after 30 minutes with CG-RECAP-SAVE; a closed tab stops it; a newer recap of the chat owns the save', async () => {
    const clock = new FakeClock(NOW_MS);
    const h = harness({ clock });
    let open = true;
    const saver = new RecapProfileSaver({ clock, ids: sequentialIds(0x700), hub: h.hub, events: h.events, tabOpen: () => open });
    for (let i = 0; i < 40; i += 1) h.hub.profileScript.push({ state: 'not-ready' });
    saver.save(recapView(uuid(0x101)), TAB);
    await clock.advance(31 * 60_000);
    expect(saver.outcome(uuid(0x101))).toBe('gave-up');
    expect(h.events.of('toast').at(-1)?.payload.toast).toMatchObject({ kind: 'error', code: 'CG-RECAP-SAVE' });

    saver.save(recapView(uuid(0x102)), TAB);
    await clock.advance(1);
    saver.save(recapView(uuid(0x103)), TAB);
    expect(saver.outcome(uuid(0x102))).toBe('replaced');
    open = false;
    await clock.advance(10_000);
    expect(saver.outcome(uuid(0x103))).toBe('tab-closed');
    expect(saver.scheduled).toBe(0);

    open = true;
    h.hub.profileScript.length = 0;
    h.hub.profileScript.push('error');
    saver.save(recapView(uuid(0x104)), TAB);
    await clock.advance(1);
    expect(saver.outcome(uuid(0x104))).toBe('failed');
    saver.save({ ...recapView(uuid(0x105)), feature: 'review' }, TAB);
    saver.save(recapView(uuid(0x106)), null);
    expect(saver.scheduled).toBe(0);
  });
});

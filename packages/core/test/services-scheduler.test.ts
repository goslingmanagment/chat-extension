// core/services OpScheduler against the fake hub's stream scenarios on a
// fake clock (architecture.md §7): admission, the journal before the hub,
// 50 ms batches, phases, deadlines, the single retry and its interruption,
// cancel and the environment fence, toasts, restore after an unload, the
// stale marker, debug details, and the dossier save of a full recap.

import { describe, expect, it } from 'vitest';

import { OpViewSchema, TAB_EVENTS, type HubFrame, type OpView, type StartOp } from '@cg/contracts';
import { requestDigestOf, requestIdentityOf, type OpsEnvironment } from '@cg/core/domain/ops';
import { ActionTokens, OPS_STORE_KEY, OpScheduler, type OpSchedulerDeps, type OpSchedulerHooks, type TabPresence } from '@cg/core/services';
import { BOOTSTRAP_PILOT_PAGES, SSE_SCENARIOS, meta, resolveHubErrorReference } from '@cg/testing/hub';

import { EventLog, FakeClock, LogRecorder, MemoryStore, sequentialIds } from './support/clock';
import { FakeHub, type ScriptResponse, type ScriptStep } from './support/fake-hub';
import { featuresOf, featuresOfBoth } from './support/features';
import { FANSLY, NOW_MS, WORLD, checkpointFor, fanslyTarget, persona, session, startOf, targetOf, uuid, withFanslyPage } from './support/world';

/** What the scheduler reads of a tab's presence, as a tab reports it. */
type ShownTab = Pick<TabPresence, 'chat' | 'routeEpoch' | 'visible' | 'focused'>;

const TAB = uuid(0xa1);

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
  readonly presence: Map<string, ShownTab>;
  readonly hooks: { settled: number; catalog: number; bootstrap: number; recaps: OpView[]; prompts: string[]; usages: { feature: string; costMicroUsd: number }[] };
  env: OpsEnvironment;
  start(tab: string, start: StartOp, opts?: { fanLabel?: string }): ReturnType<OpScheduler['start']>;
  /** The opId the next admission gets. */
  nextOp(): string;
}

function harness(over: { env?: Partial<OpsEnvironment>; store?: MemoryStore; clock?: FakeClock; firstId?: number; online?: () => boolean; drivers?: OpSchedulerDeps['drivers']; promptToken?: (opId: string) => string | null; personaNow?: OpSchedulerDeps['personaNow'] } = {}): Harness {
  const clock = over.clock ?? new FakeClock(NOW_MS);
  const hub = new FakeHub(clock);
  const ids = sequentialIds(over.firstId ?? 0x100);
  const events = new EventLog();
  const store = over.store ?? new MemoryStore();
  const log = new LogRecorder();
  const tokens = new ActionTokens(clock, ids);
  const presence = new Map<string, ShownTab>();
  const counters = { settled: 0, catalog: 0, bootstrap: 0, recaps: [] as OpView[], prompts: [] as string[], usages: [] as { feature: string; costMicroUsd: number }[] };
  const hooks: OpSchedulerHooks = {
    ...(over.promptToken === undefined ? {} : { promptToken: over.promptToken }),
    settled: () => { counters.settled++; },
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
    usage: (feature, usage) => {
      counters.usages.push({ feature, costMicroUsd: usage.costMicroUsd });
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
    env: { session, bootstrap: BOOTSTRAP_PILOT_PAGES, persona: () => persona, debug: false, settingsLoaded: true, features: featuresOf, ...over.env },
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
    ...(over.online === undefined ? {} : { online: over.online }),
    ...(over.drivers === undefined ? {} : { drivers: over.drivers }),
    ...(over.personaNow === undefined ? {} : { personaNow: over.personaNow }),
  });
  return h;
}

const opIdOf = (outcome: Awaited<ReturnType<OpScheduler['start']>>): string => {
  if (outcome.kind !== 'admission' || !outcome.admission.ok) throw new Error(`not admitted: ${JSON.stringify(outcome)}`);
  return outcome.admission.opId;
};

describe('[AI-137] [AI-139] [RB-016] a reply streams in 50 ms batches and ends with its result', () => {
  it('[AI-137] [DB-028] the admission is journaled before the hub request; batches carry monotonic seq; the result parses', async () => {
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
});

describe('[AI-123] [NEW-11] [RB-021] [AI-127] [AI-128] [AI-129] admission and the result cache', () => {

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
        const other = { key: 'second', definitionId: WORLD.persona.otherDefinitionId };
        h.env = { ...h.env, persona: () => other };
        h.scheduler.environmentChanged({ kind: 'persona', pageId: WORLD.pages.one.pageId, next: other });
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

  it('[RB-004] EOF without done is CG-STREAM-TRUNCATED and the partial text is never a result', async () => {
    for (const name of ['truncated-mid-stream', 'truncated-before-meta']) {
      const { view } = await ended(scenario(name));
      expect(view).toMatchObject({ state: 'failed', error: { code: 'CG-STREAM-TRUNCATED' } });
      expect(view?.result).toBeUndefined();
    }
  });

  it('[AI-126] [AU-027] [AU-028] persona fence: a 409 and a meta with another definition both drop the result and refresh the catalog', async () => {
    const pre = await ended(scenario('persona-409'));
    expect(pre.view?.error?.code).toBe('CG-PERSONA-CHANGED');
    expect(pre.h.hooks.catalog).toBe(1);
    const inMeta = await ended(scenario('persona-changed-in-meta'));
    expect(inMeta.view).toMatchObject({ state: 'failed', error: { code: 'CG-PERSONA-CHANGED' } });
    expect(inMeta.view?.result).toBeUndefined();
    expect(inMeta.h.hooks.catalog).toBe(1);
  });

  it('[AI-126] [AI-140] the owner edited the persona: a 409 before any frame is asked once more at once, with the definition the hub has now', async () => {
    const edited = { ...persona, definitionId: WORLD.persona.otherDefinitionId };
    const asked: number[] = [];
    const h = harness({ personaNow: (pageId) => (asked.push(pageId), Promise.resolve(edited)) });
    const op = h.nextOp();
    h.hub.streamScript.push(...scenario('persona-409'), ...forOp([{ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fast-reply', { personaDefinitionId: edited.definitionId }) }, deltaStep('Hey you'), doneStep] }], op));
    opIdOf(await h.start(TAB, startOf()));
    await h.clock.advance(5_000);
    expect(asked).toEqual([WORLD.pages.one.pageId]);
    const named = h.hub.streams.map((request) => ({ id: request.body.clientRequestId, definition: (request.body as { expectedPersonaDefinitionId?: string }).expectedPersonaDefinitionId }));
    // The same operation, the same id (the hub refused it before taking it), the persona as the hub has it now.
    expect(named).toEqual([{ id: op, definition: persona.definitionId }, { id: op, definition: edited.definitionId }]);
    expect(h.scheduler.view(op)).toMatchObject({ state: 'done' });
    expect(h.scheduler.view(op)?.error).toBeUndefined();
    // At once: no «Сервис недоступен, повтор через 5 с…» wait in between.
    expect(h.events.of('op.update').map((event) => event.payload.phase.name)).not.toContain('retry-wait');
    expect(h.log.entries.find((entry) => entry.msg === 'persona definition followed')).toMatchObject({ level: 'info', ctx: { opId: op } });
  });
});

describe('[AI-124] [AI-126] [AI-130] [AI-131] [BG-006] the run lives in the background', () => {

  it('[AI-126] [AU-027] a persona, sign-in or hub change cancels the operations of that page and sign-in only', async () => {
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
    const raw = store.data.get(OPS_STORE_KEY) as { v: number; ops: { view: OpView; meta: unknown }[] };
    // Results saved by older builds have only the cache key in metadata, not its fingerprint in the view.
    const legacy = raw.ops.map(({ view, meta }) => {
      const { requestDigest: _requestDigest, ...oldView } = view;
      return { view: oldView, meta };
    });
    store.data.set(OPS_STORE_KEY, { ...raw, ops: [...legacy, { view: { opId: 'broken' }, meta: {} }, null] });
    const second = harness({ clock, store, firstId: 0x300 });
    expect(await second.scheduler.restore()).toEqual({ restored: 2, interrupted: 1, dropped: 2 });
    expect(second.scheduler.view(running)).toMatchObject({ state: 'interrupted', error: { code: 'CG-OP-INTERRUPTED' } });
    expect(second.scheduler.view(done)?.state).toBe('done');
    expect(second.scheduler.view(done)?.requestDigest).toBe(requestDigestOf(requestIdentityOf({ session, start: startOf(), persona, archiveHead: null })));
    expect(await second.start(TAB, startOf())).toEqual({ kind: 'admission', admission: { ok: true, opId: done }, reopened: true });
    expect(second.hub.streams).toHaveLength(0);
    // Nothing starts by itself after a restore (BG-001).
    await clock.advance(120_000);
    expect(second.hub.streams).toHaveLength(0);
    expect(second.scheduler.active()).toHaveLength(0);
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

describe('[DB-018] [DB-022] AI spend in the log', () => {
  it('[DB-022] [DB-018] every usage frame is logged with its feature, tokens and cost, debug on or off, and no text', async () => {
    const h = harness();
    const op = h.nextOp();
    h.hub.streamScript.push(...forOp(scenario('debug-input-and-reasoning'), op));
    opIdOf(await h.start(TAB, startOf({ feature: 'recap', window: 3000 })));
    await h.clock.advance(1000);
    const usage = h.log.entries.filter((e) => e.msg === 'ai usage');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ level: 'info', scope: 'bg.ops.usage', fields: { feature: 'recap', surface: 'dock', pageId: WORLD.pages.one.pageId, costMicroUsd: 3100 }, ctx: { opId: op } });
    expect(typeof usage[0]?.fields?.['inputTokens']).toBe('number');
    expect(h.scheduler.view(op)?.debug).toBeUndefined();
    expect(JSON.stringify(usage)).not.toMatch(/Looking at spend/);
    // The local spend journal of debug mode hears the same frame once, numbers only.
    expect(h.hooks.usages).toEqual([{ feature: 'recap', costMicroUsd: 3100 }]);
  });
});

it('[DB-010] [FS-TAIL-9] a completed generation exposes its exact proof only in memory; one terminal hook, then debug revoke clears it', async () => {
  const h = harness({ env: { debug: true, bootstrap: withFanslyPage(BOOTSTRAP_PILOT_PAGES), features: featuresOfBoth } });
  const op = h.nextOp();
  h.hub.streamScript.push(...forOp(scenario('debug-input-and-reasoning'), op));
  const proof: NonNullable<StartOp['proof']> = { kind: 'tab-snapshot', conversationRef: FANSLY.group, takenAt: new Date(NOW_MS).toISOString(), completeness: 'complete', window: [{ id: '10001', dir: 'fan' }], knownFanMessageIds: ['10001'], deletedIds: [], tail: [{ platformMessageId: '10001', direction: 'fan', sentAt: new Date(NOW_MS).toISOString(), text: 'unique-synthetic-tail-debug-only' }], truncated: false };
  opIdOf(await h.start(TAB, startOf({ target: fanslyTarget, proof })));
  await h.clock.advance(1000); await h.scheduler.idle();
  const token = `prompt_${op.slice(-4)}`;
  expect(h.hooks.settled).toBe(1);
  expect(h.scheduler.generationDebug(token)?.proof).toEqual(proof);
  expect(JSON.stringify(h.store.data.get(OPS_STORE_KEY))).not.toContain('unique-synthetic-tail-debug-only');
  expect(JSON.stringify(h.log.entries)).not.toContain('unique-synthetic-tail-debug-only');
  h.env = { ...h.env, debug: false }; h.scheduler.clearDebug(); await h.scheduler.idle();
  expect(h.scheduler.generationDebug(token)).toBeUndefined();
  expect(h.scheduler.view(op)?.debug).toBeUndefined();
});

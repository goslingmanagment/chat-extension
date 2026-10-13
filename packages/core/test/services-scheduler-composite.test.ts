// A Coach turn with auto-recap in the scheduler (architecture.md §7 «ход
// Coach с авто-рекапом — один составной слот»; AI-096): one start, one
// token, one admission. The recap runs first as an operation of its own;
// the moment it ends the answer step holds the chat's slot — no other start
// can be admitted in between — and the recap's terminal view names it.
// Over the real scheduler with R11's drivers and the scripted hub.

import { describe, expect, it } from 'vitest';

import { OpViewSchema, type Bootstrap, type OpView, type StartOp, type TabEventPayload, type TabEventType } from '@cg/contracts';
import { AI_FEATURE_DRIVERS } from '@cg/core/domain/features';
import { type OpsEnvironment } from '@cg/core/domain/ops';
import { ActionTokens, OPS_STORE_KEY, OpScheduler, type TabPresence } from '@cg/core/services';
import { BOOTSTRAP_PILOT_PAGES, meta, resolveHubErrorReference, pageFeaturesOff } from '@cg/testing/hub';

import { AddressedHub } from './support/ai-background';
import { EventLog, FakeClock, LogRecorder, MemoryStore, sequentialIds } from './support/clock';
import { type ScriptResponse, type ScriptStep } from './support/fake-hub';
import { featuresOf } from './support/features';
import { NOW_MS, WORLD, chatOf, persona, session, startOf, targetOf, uuid } from './support/world';

/** What the scheduler reads of a tab's presence, as a tab reports it. */
type ShownTab = Pick<TabPresence, 'chat' | 'routeEpoch' | 'visible' | 'focused'>;

const TAB = uuid(0xa1);
const OTHER_TAB = uuid(0xa2);

const delta = (text: string, afterMs = 20): ScriptStep => ({ kind: 'frame', frame: { type: 'content_delta', text }, afterMs });
const doneStep: ScriptStep = { kind: 'frame', frame: { type: 'done', stopReason: 'end_turn' } };
const RECAP_TEXT = ['## Кто он', 'Марк, 34.'].join('\n');
const recapStream = (afterMs = 100): ScriptResponse => ({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fan-summary') }, delta(RECAP_TEXT, afterMs), doneStep] });
const coachStream = (text = 'Сначала согрей.'): ScriptResponse => ({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('coach-chat'), afterMs: 50 }, delta(text, 50), doneStep] });
const stalled = (feature: Parameters<typeof meta>[0]): ScriptResponse => ({ kind: 'stream', steps: [{ kind: 'frame', frame: meta(feature) }, { kind: 'stall' }] });

/** A Coach start that asks for its auto-recap first. */
const turn = (over: Partial<StartOp> = {}, length: 'short' | 'full' = 'full'): StartOp =>
  startOf({ feature: 'coach', surface: 'coach', coach: { question: 'How do I reply?', history: [], attachDraft: 'my draft', autoRecap: { length, window: length === 'full' ? 3000 : 300 } }, ...over });

interface Harness {
  readonly clock: FakeClock;
  readonly hub: AddressedHub;
  readonly events: EventLog;
  readonly store: MemoryStore;
  readonly log: LogRecorder;
  readonly tokens: ActionTokens;
  readonly scheduler: OpScheduler;
  readonly presence: Map<string, ShownTab>;
  readonly recaps: OpView[];
  env: OpsEnvironment;
  /** Called on every event the background emits, as it is emitted. */
  onEvent: (<T extends TabEventType>(type: T, payload: TabEventPayload<T>) => void) | null;
  start(tab: string, start: StartOp): ReturnType<OpScheduler['start']>;
}

function harness(over: { store?: MemoryStore; clock?: FakeClock; firstId?: number; bootstrap?: Bootstrap } = {}): Harness {
  const clock = over.clock ?? new FakeClock(NOW_MS);
  const hub = new AddressedHub(clock);
  const ids = sequentialIds(over.firstId ?? 0x100);
  const events = new EventLog();
  const store = over.store ?? new MemoryStore();
  const log = new LogRecorder();
  const tokens = new ActionTokens(clock, ids);
  const presence = new Map<string, ShownTab>();
  const recaps: OpView[] = [];
  const h: Harness = {
    clock,
    hub,
    events,
    store,
    log,
    tokens,
    presence,
    recaps,
    onEvent: null,
    env: { session, bootstrap: over.bootstrap ?? BOOTSTRAP_PILOT_PAGES, persona: () => persona, debug: false, settingsLoaded: true, features: featuresOf },
    scheduler: undefined as unknown as OpScheduler,
    start: (tab, start) => {
      const { actionToken } = tokens.issue(tab, 'generate', start.surface);
      return h.scheduler.start(tab, { ...start, cause: { kind: 'click', actionToken } });
    },
  };
  (h as { scheduler: OpScheduler }).scheduler = new OpScheduler({
    clock,
    ids,
    hub,
    resolve: resolveHubErrorReference,
    environment: () => h.env,
    tokens,
    events: {
      emit: (to, type, payload) => {
        events.emit(to, type, payload);
        h.onEvent?.(type, payload);
      },
    },
    store,
    presence: (tab) => presence.get(tab) ?? null,
    log,
    drivers: AI_FEATURE_DRIVERS,
    hooks: { recapDone: (view) => recaps.push(view) },
  });
  return h;
}

const opIdOf = (outcome: Awaited<ReturnType<OpScheduler['start']>>): string => {
  if (outcome.kind !== 'admission' || !outcome.admission.ok) throw new Error(`not admitted: ${JSON.stringify(outcome)}`);
  return outcome.admission.opId;
};
const doneOf = (h: Harness, opId: string): OpView | undefined => h.events.of('op.done').find((event) => event.payload.view.opId === opId)?.payload.view;
const admissionCode = (outcome: Awaited<ReturnType<OpScheduler['start']>>): string | null => (outcome.kind === 'admission' && !outcome.admission.ok ? outcome.admission.code : null);

describe('[AI-096] a Coach turn with auto-recap is one composite slot (§7)', () => {
  it('one start and one token run both steps: the recap, then the question — with the draft read at the click', async () => {
    const h = harness();
    h.hub.streamScript.push(recapStream(), coachStream());
    const recap = opIdOf(await h.start(TAB, turn()));
    // The admitted operation is the recap step; the token of the click is spent, and no other was asked.
    expect(h.scheduler.view(recap)).toMatchObject({ feature: 'recap', surface: 'coach' });
    expect(h.scheduler.view(recap)?.endedAt).toBeUndefined();
    expect(h.tokens.outstanding(TAB)).toBe(0);
    expect(h.scheduler.active()).toHaveLength(1);
    await h.clock.advance(10);
    expect(h.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary']);
    expect(h.hub.streams[0]?.body).toMatchObject({ messageCount: 3000 });
    // The recap is not a message to the fan and carries nothing of the question.
    expect(h.hub.streams[0]?.body.chatterQuestion).toBeUndefined();
    expect(h.hub.streams[0]?.body.draftText).toBeUndefined();

    await h.clock.advance(110);
    const ended = doneOf(h, recap);
    expect(OpViewSchema.safeParse(ended).success).toBe(true);
    expect(ended).toMatchObject({ state: 'done', result: { kind: 'recap', markdown: RECAP_TEXT } });
    const answer = ended?.continuedBy as string;
    expect(answer).toMatch(/^[0-9a-f-]{36}$/);
    expect(answer).not.toBe(recap);
    // A full recap is the dossier's, as any other.
    expect(h.recaps.map((view) => view.opId)).toEqual([recap]);

    await h.clock.advance(1_000);
    expect(h.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat']);
    expect(h.hub.streams[1]?.body).toMatchObject({ clientRequestId: answer, chatterQuestion: 'How do I reply?', draftText: 'my draft', messageCount: 100 });
    expect(doneOf(h, answer)).toMatchObject({ feature: 'coach', surface: 'coach', state: 'done', result: { kind: 'coach', answer: { prose: 'Сначала согрей.' } } });
    expect(doneOf(h, answer)?.continuedBy).toBeUndefined();
    // Its batches went to the tab that asked.
    expect(h.events.of('op.update').filter((event) => event.payload.opId === answer).every((event) => event.to === TAB)).toBe(true);
    expect(h.tokens.outstanding(TAB)).toBe(0);
    // The question never reaches the log.
    expect(JSON.stringify(h.log.entries)).not.toMatch(/How do I reply|my draft|согрей/);
  });

  it('the chat is never free between the steps: a start that arrives the moment the recap ends is refused', async () => {
    const h = harness();
    h.hub.streamScript.push(recapStream(), coachStream());
    const recap = opIdOf(await h.start(TAB, turn()));
    const atTheEnd: { active: readonly OpView[]; other: Promise<Awaited<ReturnType<OpScheduler['start']>>> }[] = [];
    h.onEvent = (type, payload) => {
      if (type !== 'op.done' || (payload as TabEventPayload<'op.done'>).view.opId !== recap || atTheEnd.length > 0) return;
      // What a Reply click of another tab finds at this very moment.
      atTheEnd.push({ active: h.scheduler.active(), other: h.start(OTHER_TAB, startOf()) });
    };
    await h.clock.advance(120);
    expect(atTheEnd).toHaveLength(1);
    const answer = doneOf(h, recap)?.continuedBy;
    expect(atTheEnd[0]?.active.map((view) => `${view.feature}:${view.opId}`)).toEqual([`coach:${answer}`]);
    expect(admissionCode(await (atTheEnd[0]?.other as Promise<Awaited<ReturnType<OpScheduler['start']>>>))).toBe('CG-OP-CHAT-BUSY');
    // And the same from the turn's own tab: Reply in the dock is not let in either.
    expect(admissionCode(await h.start(TAB, startOf()))).toBe('CG-OP-CHAT-BUSY');
    await h.clock.advance(1_000);
    expect(h.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat']);
    expect(doneOf(h, answer as string)).toMatchObject({ state: 'done' });
  });

  it('[AI-123] the turn counts once against the tab\'s three', async () => {
    const h = harness();
    h.hub.streamScript.push({ kind: 'hang' }, { kind: 'hang' }, recapStream(), stalled('coach-chat'));
    opIdOf(await h.start(TAB, startOf({ target: targetOf('2101') })));
    opIdOf(await h.start(TAB, startOf({ target: targetOf('2102') })));
    const recap = opIdOf(await h.start(TAB, turn()));
    await h.clock.advance(300);
    // Three run: the two replies and the answer step that replaced the recap step.
    expect(h.scheduler.active().map((view) => view.feature).sort()).toEqual(['coach', 'reply', 'reply']);
    expect(doneOf(h, recap)?.continuedBy).toBeDefined();
    expect(admissionCode(await h.start(TAB, startOf({ target: targetOf('2104') })))).toBe('CG-OP-TAB-LIMIT');
  });

  it('the answer step is journaled before its hub request, like any admission', async () => {
    const h = harness();
    h.hub.streamScript.push(recapStream(), coachStream());
    const journalAtRequest: string[] = [];
    const stream = h.hub.stream.bind(h.hub);
    h.hub.stream = (request, sink, signal) => {
      journalAtRequest.push(JSON.stringify(h.store.data.get(OPS_STORE_KEY)));
      return stream(request, sink, signal);
    };
    const recap = opIdOf(await h.start(TAB, turn()));
    await h.clock.advance(1_500);
    const answer = doneOf(h, recap)?.continuedBy as string;
    expect(journalAtRequest).toHaveLength(2);
    expect(journalAtRequest[1]).toContain(answer);
    // Neither step leaves the question or the draft in storage.
    expect(JSON.stringify(h.store.data.get(OPS_STORE_KEY))).not.toMatch(/How do I reply|my draft/);
  });

  it('a journal that cannot be written: the answer step fails with CG-STORAGE-WRITE and the hub is not asked', async () => {
    const h = harness();
    h.hub.streamScript.push(recapStream(), coachStream());
    const recap = opIdOf(await h.start(TAB, turn()));
    h.store.failWrites = true;
    await h.clock.advance(1_500);
    const answer = doneOf(h, recap)?.continuedBy as string;
    expect(doneOf(h, answer)).toMatchObject({ state: 'failed', error: { code: 'CG-STORAGE-WRITE' } });
    expect(h.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary']);
    expect(h.scheduler.active()).toEqual([]);
  });

  it('one cancel: canceling the recap step ends the turn — the Coach is never asked', async () => {
    const h = harness();
    h.hub.streamScript.push(stalled('fan-summary'), coachStream());
    const recap = opIdOf(await h.start(TAB, turn()));
    await h.clock.advance(50);
    expect(h.scheduler.cancel(recap)).toBe('canceled');
    await h.clock.advance(1_000);
    const ended = doneOf(h, recap);
    expect(ended).toMatchObject({ state: 'canceled' });
    expect(ended?.continuedBy).toBeUndefined();
    expect(h.scheduler.active()).toEqual([]);
    expect(h.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary']);
    // The slot is free again at once.
    h.hub.streamScript.length = 0;
    h.hub.streamScript.push({ kind: 'hang' });
    opIdOf(await h.start(TAB, startOf()));
  });

  it('canceling the answer step ends it like any operation', async () => {
    const h = harness();
    h.hub.streamScript.push(recapStream(), stalled('coach-chat'));
    const recap = opIdOf(await h.start(TAB, turn()));
    await h.clock.advance(400);
    const answer = doneOf(h, recap)?.continuedBy as string;
    expect(h.scheduler.view(answer)).toMatchObject({ state: 'streaming' });
    expect(h.scheduler.cancel(answer)).toBe('canceled');
    expect(doneOf(h, answer)).toMatchObject({ state: 'canceled' });
    expect(h.scheduler.active()).toEqual([]);
  });

  it('a recap that cannot be made for the conversation\'s own reasons lets the question go; any other failure stops the turn', async () => {
    const h = harness();
    h.hub.streamScript.push({ kind: 'http-error', status: 409, body: { error: 'gate_min_messages' } }, coachStream());
    const recap = opIdOf(await h.start(TAB, turn()));
    await h.clock.advance(1_000);
    const gated = doneOf(h, recap);
    expect(gated).toMatchObject({ state: 'failed', error: { code: 'CG-GATE-HISTORY' } });
    expect(gated?.continuedBy).toBeDefined();
    expect(doneOf(h, gated?.continuedBy as string)).toMatchObject({ feature: 'coach', state: 'done' });
    expect(h.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary', 'coach-chat']);

    const down = harness();
    down.hub.streamScript.push({ kind: 'stream', steps: [{ kind: 'frame', frame: meta('fan-summary') }, { kind: 'frame', frame: { type: 'error', code: 'provider_new_failure', message: 'Something new', retryAfterMs: null } }] }, coachStream());
    const stopped = opIdOf(await down.start(TAB, turn()));
    await down.clock.advance(1_000);
    expect(doneOf(down, stopped)).toMatchObject({ state: 'failed', error: { code: 'CG-PROVIDER-UNKNOWN' } });
    expect(doneOf(down, stopped)?.continuedBy).toBeUndefined();
    expect(down.scheduler.active()).toEqual([]);
    expect(down.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary']);
  });

  it('the tab went away during the recap step: the recap finishes, the answer nobody could read is not asked', async () => {
    const h = harness();
    h.hub.streamScript.push(recapStream(), coachStream());
    const recap = opIdOf(await h.start(TAB, turn()));
    h.scheduler.detachTab(TAB);
    await h.clock.advance(1_000);
    expect(doneOf(h, recap)).toMatchObject({ state: 'done' });
    expect(doneOf(h, recap)?.continuedBy).toBeUndefined();
    expect(h.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary']);
    expect(h.scheduler.active()).toEqual([]);
  });

  it('[AI-126] a persona or sign-in change during the recap step cancels the turn; a persona that changed without a word stops it too', async () => {
    const h = harness();
    h.hub.streamScript.push(stalled('fan-summary'), coachStream());
    const recap = opIdOf(await h.start(TAB, turn()));
    await h.clock.advance(50);
    const other = { key: 'other', definitionId: WORLD.persona.otherDefinitionId };
    h.env = { ...h.env, persona: () => other };
    expect(h.scheduler.environmentChanged({ kind: 'persona', pageId: WORLD.pages.one.pageId, next: other })).toEqual([recap]);
    await h.clock.advance(1_000);
    expect(doneOf(h, recap)).toMatchObject({ state: 'canceled', error: { code: 'CG-PERSONA-CHANGED' } });
    expect(doneOf(h, recap)?.continuedBy).toBeUndefined();
    expect(h.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary']);

    // No change event reached the scheduler, yet the environment is another one when the recap ends.
    const quiet = harness();
    quiet.hub.streamScript.push(recapStream(), coachStream());
    const second = opIdOf(await quiet.start(TAB, turn()));
    await quiet.clock.advance(50);
    quiet.env = { ...quiet.env, persona: () => other };
    await quiet.clock.advance(1_000);
    expect(doneOf(quiet, second)?.continuedBy).toBeUndefined();
    expect(quiet.hub.streams.map((stream) => stream.feature)).toEqual(['fan-summary']);
    expect(quiet.scheduler.active()).toEqual([]);
  });

  it('the Recap switch of the owner off: the question is asked right away, as an ordinary Coach operation', async () => {
    const off: Bootstrap = pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['recap']);
    const h = harness({ bootstrap: off });
    h.hub.streamScript.push(coachStream());
    const op = opIdOf(await h.start(TAB, turn()));
    expect(h.scheduler.view(op)).toMatchObject({ feature: 'coach', surface: 'coach' });
    await h.clock.advance(1_000);
    expect(h.hub.streams.map((stream) => stream.feature)).toEqual(['coach-chat']);
    expect(doneOf(h, op)).toMatchObject({ state: 'done', result: { kind: 'coach' } });
    expect(doneOf(h, op)?.continuedBy).toBeUndefined();
    // And the Coach switch off refuses the whole turn before anything is admitted.
    const none: Bootstrap = pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['coach']);
    const refused = harness({ bootstrap: none });
    expect(await refused.start(TAB, turn())).toEqual({ kind: 'refused', code: 'CG-FEATURE-DISABLED' });
    expect(refused.scheduler.active()).toEqual([]);
  });

  it('«short» builds the short recap, which has no dossier', async () => {
    const h = harness();
    h.hub.streamScript.push(recapStream(), coachStream());
    const recap = opIdOf(await h.start(TAB, turn({}, 'short')));
    expect(h.scheduler.view(recap)).toMatchObject({ feature: 'recap-short' });
    await h.clock.advance(1_500);
    expect(h.hub.streams[0]?.body).toMatchObject({ summaryMode: 'short', messageCount: 300 });
    expect(h.recaps).toEqual([]);
    expect(doneOf(h, doneOf(h, recap)?.continuedBy as string)).toMatchObject({ state: 'done' });
  });

  it('«AI готово» is said once, for the answer — not for the recap step of a turn that goes on', async () => {
    const h = harness();
    h.presence.set(TAB, { chat: chatOf(WORLD.otherFan), routeEpoch: 1, visible: true, focused: true });
    h.hub.streamScript.push(recapStream(), coachStream());
    const recap = opIdOf(await h.start(TAB, turn()));
    await h.clock.advance(120);
    expect(doneOf(h, recap)?.continuedBy).toBeDefined();
    expect(h.events.of('toast')).toEqual([]);
    await h.clock.advance(1_000);
    const toasts = h.events.of('toast').map((event) => event.payload.toast);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ scope: 'op.ready', feature: 'coach', opId: doneOf(h, recap)?.continuedBy });
  });

  it('an unload during the recap step: the turn is interrupted and nothing is asked later', async () => {
    const store = new MemoryStore();
    const clock = new FakeClock(NOW_MS);
    const first = harness({ store, clock });
    first.hub.streamScript.push(stalled('fan-summary'));
    const recap = opIdOf(await first.start(TAB, turn()));
    await clock.advance(50);
    // A new background over the same storage.session.
    const next = harness({ store, clock, firstId: 0x300 });
    expect(await next.scheduler.restore()).toMatchObject({ interrupted: 1 });
    expect(next.scheduler.view(recap)).toMatchObject({ state: 'interrupted', error: { code: 'CG-OP-INTERRUPTED' } });
    expect(next.scheduler.view(recap)?.continuedBy).toBeUndefined();
    await clock.advance(5_000);
    expect(next.hub.streams).toEqual([]);
    expect(next.scheduler.active()).toEqual([]);
  });

  it('a second click on the same turn while its recap runs reopens it; nothing is started twice', async () => {
    const h = harness();
    h.hub.streamScript.push(stalled('fan-summary'));
    const recap = opIdOf(await h.start(TAB, turn()));
    expect(await h.start(TAB, turn())).toEqual({ kind: 'admission', admission: { ok: true, opId: recap }, reopened: true });
    await h.clock.advance(50);
    expect(h.hub.streams).toHaveLength(1);
    expect(h.scheduler.active()).toHaveLength(1);
  });
});

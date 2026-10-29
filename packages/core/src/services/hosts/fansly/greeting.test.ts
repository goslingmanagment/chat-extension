// The greeting of a «Новые» card in Fansly's background (R20 P10c): the card's requests against the pass and the send
// played here — the order of the checks before an attempt, the three admissions, the history read again before the
// custody, the draft's revision as the final check's «now», and the person's own send registered.

import { type FanslyGreetingRequest, type FanslySendView } from '@cg/contracts/send-fansly';
import { STORAGE_KEYS } from '@cg/contracts/settings';
import { FANSLY_TAB_REQUESTS, type FanslyFollowerRow, type FanslyTabResponsePayload } from '@cg/contracts/tab-messages-fansly';
import { describe, expect, it } from 'vitest';

import { readDraftStore } from '../../../domain/newcomers/drafts';
import { createMemoryKv } from '../../test-support/memory-kv';
import { ActionTokens } from '../../tokens';
import { createFanslyGreeting, type FanslyGreetingDeps, type GreetingAccepted, type GreetingGeneration } from './greeting';
import { type FanslyNativeSend, type FanslySendStart } from './send';

const C = '700000000000000017';
const FAN = '710000000000000001';
const GROUP = '900000000000000001';
const TAB = 'tab-1';
const PASS = '00000000-0000-4000-8000-000000000301';
const REV = '00000000-0000-4000-8000-000000000501';
const REV2 = '00000000-0000-4000-8000-000000000502';
const GEN = '00000000-0000-4000-8000-000000000601';
const OP = '00000000-0000-4000-8000-0000000000c1';
const PAGE = { pageId: 13, pageLabel: 'lora-fansly', flagRevision: 4 };
const T0 = Date.UTC(2026, 9, 16, 12);
const settle = async (): Promise<void> => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

const readyRow = (patch: Partial<FanslyFollowerRow> = {}): FanslyFollowerRow => ({
  fanRef: FAN,
  groupId: GROUP,
  username: 'fan_1',
  displayName: 'Fan 1',
  followedAt: new Date(T0).toISOString(),
  status: 'ready',
  dmClosed: null,
  historyRevision: REV,
  checkedAt: new Date(T0).toISOString(),
  ...patch,
});

function world(tokens: Pick<ActionTokens, 'redeem'> = { redeem: () => true }) {
  const kv = createMemoryKv();
  const log: string[] = [];
  const state = {
    row: readyRow() as FanslyFollowerRow | null,
    creator: C,
    /** The revision the history read again finds. */
    recheck: { ok: true, historyRevision: REV } as { ok: true; historyRevision: string } | { ok: false; code: 'CG-SEND-PART' },
    generation: null as GreetingGeneration | null,
    view: (attemptId: string): FanslySendView => ({ attemptId, fanRef: FAN, state: 'sent', proof: 'echo', platformMessageId: '830000000000000001' }),
    tabOn: true,
    sendGate: null as Promise<void> | null,
    status: null as FanslySendView | null,
  };
  const starts: FanslySendStart[] = [];
  const natives: FanslyNativeSend[] = [];
  const greeted: string[] = [];
  const accepted: GreetingAccepted[] = [];
  const listeners = new Set<(view: FanslySendView) => void>();
  const deps: FanslyGreetingDeps = {
    tokens,
    newcomers: {
      row: (passId, fanRef, tab) => (passId === PASS && fanRef === FAN && tab === TAB && state.row !== null ? { creator: state.creator, view: state.row, proof: state.row.status === 'ready' && state.row.historyRevision !== null ? { groupId: GROUP, historyRevision: state.row.historyRevision, window: [], startProof: { v: 1, source: 'pass-empty-page', groupId: GROUP, startWitnessId: null, coveredCount: 0, personalCount: 0, automatedIds: [] } } : null } : null),
      creatorOf: (passId, tab) => (passId === PASS && tab === TAB ? state.creator : null),
      freshProof: () => Promise.resolve({ ok: false, code: 'CG-FNEW-UNVERIFIED' }),
      recheck() {
        log.push('recheck');
        if (state.recheck.ok && state.row !== null) state.row = { ...state.row, historyRevision: state.recheck.historyRevision };
        return Promise.resolve(state.recheck);
      },
      live: () => (state.row === null || state.row.status !== 'ready' || state.row.historyRevision === null ? null : { hostAccountId: C, groupId: GROUP, fanRef: FAN, historyRevision: state.row.historyRevision }),
      greeted: (creator, fanRef) => {
        greeted.push(`${creator}|${fanRef}`);
      },
    },
    send: {
      async send(start) {
        log.push('send');
        starts.push(start);
        await state.sendGate;
        state.status = state.view(start.request.attemptId);
        return state.status;
      },
      native(sent) {
        log.push('native');
        natives.push(sent);
        return Promise.resolve('registered');
      },
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      status: () => Promise.resolve(state.status),
      latest: () => Promise.resolve(state.status === null ? [] : [state.status]),
    },
    local: kv.open(),
    session: () => ({ hubOrigin: 'https://hub.example.test', userId: 7 }),
    page: (creator, tab) => Promise.resolve(creator === C && tab === TAB ? { ok: true, page: PAGE } : { ok: false, code: 'CG-BINDING-NOT-GRANTED' }),
    generation: (opId) => (opId === OP ? state.generation : null),
    tabOn: () => state.tabOn,
    now: () => T0,
    accepted: (fact) => {
      accepted.push(fact);
    },
  };
  let greeting = createFanslyGreeting(deps);
  const ask = async <T extends 'fansly.followers.draft' | 'fansly.followers.outcomes' | 'fansly.followers.send' | 'fansly.followers.sent'>(type: T, payload: unknown): Promise<FanslyTabResponsePayload<T>> => {
    expect(FANSLY_TAB_REQUESTS[type].req.safeParse(payload).success, `${type} request`).toBe(true);
    const answer = await greeting.answer(type, payload, TAB);
    expect(FANSLY_TAB_REQUESTS[type].res.safeParse(answer).success, `${type} answer`).toBe(true);
    return answer as FanslyTabResponsePayload<T>;
  };
  const draft = async (text?: string) => {
    const answer = await ask('fansly.followers.draft', text === undefined ? { passId: PASS, fanRef: FAN } : { passId: PASS, fanRef: FAN, text });
    if (!answer.ok) throw new Error(answer.error.code);
    return answer.draft;
  };
  const request = (over: Partial<FanslyGreetingRequest> = {}): FanslyGreetingRequest => ({
    attemptId: '00000000-0000-4000-8000-000000000a01',
    passId: PASS,
    hostAccountId: C,
    fanRef: FAN,
    groupId: GROUP,
    text: 'Hi there!',
    draftRevision: 1,
    historyRevision: REV,
    admission: { kind: 'own' },
    cause: { kind: 'click', actionToken: 'a'.repeat(32) },
    ...over,
  });
  const stored = () => readDraftStore(kv.read(STORAGE_KEYS.newcomersDrafts), T0);
  return { get greeting() { return greeting; }, state, log, starts, natives, greeted, accepted, ask, draft, request, stored, restart() { greeting.dispose(); greeting = createFanslyGreeting(deps); }, emit: (view: FanslySendView) => { state.status = view; listeners.forEach((listener) => listener(view)); } };
}

describe('[host:fansly] the greeting of a «Новые» card in the background (R20 P10c)', () => {
  it.each(['unknown', 'spent', 'expired', 'other-tab', 'other-kind', 'other-surface'] as const)('refuses a %s send token before history or a send attempt', async (fault) => {
    let now = T0;
    const tokens = new ActionTokens({ now: () => now, setTimer: () => 0, clearTimer: () => undefined }, { token: () => 'a'.repeat(32) });
    const w = world(tokens);
    await w.draft('Hi there!');
    if (fault !== 'unknown') tokens.issue(fault === 'other-tab' ? 'other' : TAB, fault === 'other-kind' ? 'generate' : 'send', fault === 'other-surface' ? 'preview' : 'newcomers');
    if (fault === 'spent') tokens.redeem({ tabSessionId: TAB, kind: 'send', surface: 'newcomers', actionToken: 'a'.repeat(32) });
    if (fault === 'expired') now += 10_000;
    expect(await w.ask('fansly.followers.send', w.request())).toEqual({ ok: false, error: { code: 'CG-UI-FAILED' } });
    expect(w.log).toEqual([]);
    expect(w.starts).toEqual([]);
  });

  it('redeems a valid newcomers send token once; an explicit retry needs a fresh click token', async () => {
    let tokenId = 0;
    const tokens = new ActionTokens({ now: () => T0, setTimer: () => 0, clearTimer: () => undefined }, { token: () => String(++tokenId).padStart(32, 'a') });
    const w = world(tokens);
    await w.draft('Hi there!');
    w.state.view = (attemptId) => ({ attemptId, fanRef: FAN, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'network' });
    const cause = { kind: 'click' as const, actionToken: tokens.issue(TAB, 'send', 'newcomers').actionToken };
    expect(await w.ask('fansly.followers.send', w.request({ cause }))).toMatchObject({ ok: true });
    const attemptId = '00000000-0000-4000-8000-000000000a02';
    expect(await w.ask('fansly.followers.send', w.request({ cause, attemptId }))).toEqual({ ok: false, error: { code: 'CG-UI-FAILED' } });
    expect(w.starts).toHaveLength(1);
    expect(await w.ask('fansly.followers.send', w.request({ attemptId, cause: { kind: 'click', actionToken: tokens.issue(TAB, 'send', 'newcomers').actionToken } }))).toMatchObject({ ok: true });
    expect(w.starts).toHaveLength(2);
  });

  it.each(['ready', 'claimed', 'routed', 'dispatched', 'intentWritten', 'requestStarted', 'uncertain'] as const)('a batch refuses a prior %s greeting at background admission', async (state) => {
    const w = world();
    await w.draft('Hi there!');
    const prior = { attemptId: '00000000-0000-4000-8000-000000000b01', fanRef: FAN };
    w.state.status = state === 'uncertain' ? { ...prior, state, code: 'CG-SEND-UNCERTAIN', cause: 'network' } : { ...prior, state };
    expect(await w.ask('fansly.followers.send', w.request({ batch: true }))).toEqual({ ok: false, error: { code: 'CG-SEND-UNCERTAIN' } });
    expect(w.log).toEqual([]);
    expect(w.starts).toEqual([]);
  });

  it.each([false, true])('a batch sends with no unresolved attempt (previous refusal: %s)', async (refused) => {
    const w = world();
    await w.draft('Hi there!');
    if (refused) w.state.status = { attemptId: '00000000-0000-4000-8000-000000000b01', fanRef: FAN, state: 'refused', code: 'CG-CLAIM-BUSY', proof: 'before-dispatch' };
    expect(await w.ask('fansly.followers.send', w.request({ batch: true }))).toMatchObject({ ok: true, attempt: { state: 'sent' } });
    expect(w.starts).toHaveLength(1);
  });

  it('[NF-012] [NF-018] the card’s draft: kept per creator and fan in the shared drafts with the history revision it was written on; read back; an empty text clears it', async () => {
    const w = world();
    expect(await w.draft()).toEqual({ text: '', revision: 0, historyRevision: null });
    expect(await w.draft('Hi there!')).toEqual({ text: 'Hi there!', revision: 1, historyRevision: REV });
    expect(w.stored().drafts).toMatchObject([{ key: 'https://hub.example.test|7|13|newcomers|' + FAN, text: 'Hi there!', revision: 1, threadRevision: REV }]);
    expect(await w.draft()).toEqual({ text: 'Hi there!', revision: 1, historyRevision: REV });
    expect(await w.draft('')).toEqual({ text: '', revision: 2, historyRevision: null });
    expect(w.stored().drafts).toEqual([]);
  });

  it('[NF-019] [NF-036] [FS-NEW-6] the person’s own text: the history read again before the custody, then ONE attempt of the send with the page, the tab and the click; it went — «Уже писали», the draft cleared', async () => {
    const w = world();
    await w.draft('Hi there!');
    const answer = await w.ask('fansly.followers.send', w.request());
    expect(answer).toEqual({ ok: true, attempt: { attemptId: w.request().attemptId, fanRef: FAN, state: 'sent', proof: 'echo', platformMessageId: '830000000000000001' } });
    expect(w.log).toEqual(['recheck', 'send']);
    expect(w.starts).toEqual([{ request: w.request(), tabSessionId: TAB, page: PAGE }]);
    expect(w.greeted).toEqual([`${C}|${FAN}`]);
    await settle();
    expect(w.stored().drafts).toEqual([]);
  });

  it('[FS-TAIL-8] [NF-012] [X69] an unverified AI draft keeps its attribution and warning after restart and sends without an edit', async () => {
    const w = world();
    w.state.generation = { generationRef: GEN, fanRef: FAN, conversationRef: GROUP, text: 'Hey you', fresh: false, mark: 'unverified' };
    await w.ask('fansly.followers.draft', { passId: PASS, fanRef: FAN, text: 'Hey you', generation: { opId: OP, historyRevision: REV } });
    w.restart();
    w.state.generation = null;
    expect(await w.draft()).toMatchObject({ text: 'Hey you', generation: { opId: OP, generationRef: GEN, text: 'Hey you', historyRevision: REV, mark: 'unverified' } });
    // A reopened or older tab that labels the unchanged AI text as the person's own: no refusal (2026-10-22) — it goes
    // as the tab says, the person's own text.
    expect(await w.ask('fansly.followers.send', w.request({ text: 'Hey you', admission: { kind: 'own' } }))).toMatchObject({ ok: true });
    expect(w.starts[0]?.request).toMatchObject({ text: 'Hey you', admission: { kind: 'own' } });
    w.state.status = null;
    expect(await w.ask('fansly.followers.send', w.request({ attemptId: '00000000-0000-4000-8000-000000000a02', text: 'Hey you', admission: { kind: 'ai', generationRef: GEN, variant: 0 }, opId: OP }))).toMatchObject({ ok: true });
    expect(w.log).toEqual(['recheck', 'send', 'recheck', 'send']);
    expect(w.starts).toHaveLength(2);
    expect(w.starts[1]?.request).toMatchObject({ text: 'Hey you', admission: { kind: 'ai', generationRef: GEN }, opId: OP });
  });

  it('[FS-NEW-6] a saved fresh verdict remains usable when the background no longer holds the operation', async () => {
    const w = world();
    w.state.generation = { generationRef: GEN, fanRef: FAN, conversationRef: GROUP, text: 'Hey you', fresh: true };
    await w.ask('fansly.followers.draft', { passId: PASS, fanRef: FAN, text: 'Hey you', generation: { opId: OP, historyRevision: REV } });
    w.restart();
    w.state.generation = null;
    expect(await w.ask('fansly.followers.send', w.request({ text: 'Hey you', admission: { kind: 'ai', generationRef: GEN, variant: 0 }, opId: OP }))).toMatchObject({ ok: true });
  });

  it('[FS-NEW-3] the reopened draft reads uncertain and sent from the durable send service, including after the greeting service restarts', async () => {
    const w = world();
    await w.draft('Hi there!');
    w.state.view = (attemptId) => ({ attemptId, fanRef: FAN, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'network' });
    await w.ask('fansly.followers.send', w.request());
    w.restart();
    expect(await w.draft()).toMatchObject({ attempt: { state: 'uncertain' } });
    // An unknown outcome holds nothing («как раньше»): the person's own new click is one more attempt — never ours.
    const again = '00000000-0000-4000-8000-000000000a02';
    expect(await w.ask('fansly.followers.send', w.request({ attemptId: again }))).toMatchObject({ ok: true, attempt: { attemptId: again, state: 'uncertain' } });
    expect(w.starts).toHaveLength(2);
    w.emit({ attemptId: again, fanRef: FAN, state: 'sent', proof: 'resolved-sent' });
    w.restart();
    expect(await w.draft()).toMatchObject({ attempt: { state: 'sent' } });
    // X5: a greeting that went is never sent again.
    expect(await w.ask('fansly.followers.send', w.request({ attemptId: '00000000-0000-4000-8000-000000000a03' }))).toEqual({ ok: false, error: { code: 'CG-SEND-PART' } });
    expect(w.starts).toHaveLength(2);
  });

  it('[FS-NEW-3] the list reads every fan’s kept attempt at once (an unknown outcome is never «Не писали»); a refused one is left out; another pass or tab gets nothing', async () => {
    const w = world();
    expect(await w.ask('fansly.followers.outcomes', { passId: PASS })).toEqual({ ok: true, attempts: [] });
    const unsure: FanslySendView = { attemptId: '00000000-0000-4000-8000-000000000a01', fanRef: FAN, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'network' };
    w.state.status = unsure;
    expect(await w.ask('fansly.followers.outcomes', { passId: PASS })).toEqual({ ok: true, attempts: [unsure] });
    w.state.status = { attemptId: unsure.attemptId, fanRef: FAN, state: 'refused', proof: 'before-dispatch', code: 'CG-CLAIM-BUSY' };
    expect(await w.ask('fansly.followers.outcomes', { passId: PASS })).toEqual({ ok: true, attempts: [] });
    expect(await w.ask('fansly.followers.outcomes', { passId: '00000000-0000-4000-8000-000000000999' })).toEqual({ ok: false, error: { code: 'CG-CONTEXT-CHANGED' } });
  });

  it('[NF-018] [NF-024] what stops a click before any attempt, each with its own reason: the history changed since the review, the draft changed, the fan is written to or closed, not checked in full, another account, another conversation', async () => {
    const w = world();
    await w.draft('Hi there!');
    w.state.recheck = { ok: true, historyRevision: REV2 };
    expect(await w.ask('fansly.followers.send', w.request())).toEqual({ ok: false, error: { code: 'CG-FNEW-HISTORY' } });
    expect(w.starts).toEqual([]);
    // The card shows the new history now: the next click with it goes.
    expect(await w.ask('fansly.followers.send', w.request({ historyRevision: REV2 }))).toMatchObject({ ok: true });
    const v = world();
    await v.draft('Hi there!');
    expect(await v.ask('fansly.followers.send', v.request({ draftRevision: 0 }))).toEqual({ ok: false, error: { code: 'CG-DRAFT-CHANGED' } });
    expect(await v.ask('fansly.followers.send', v.request({ hostAccountId: '700000000000000099' }))).toEqual({ ok: false, error: { code: 'CG-FNEW-ACCOUNT' } });
    // The conversation is the group the pass resolved — the fan's id in its place is no conversation (FS-IDN-6).
    expect(await v.ask('fansly.followers.send', v.request({ groupId: FAN }))).toEqual({ ok: false, error: { code: 'CG-CONTEXT-CHANGED' } });
    for (const [patch, code] of [
      [{ status: 'greeted', historyRevision: null }, 'CG-SEND-PART'],
      [{ status: 'dm-closed', dmClosed: 'paid', historyRevision: null }, 'CG-FNEW-DM-CLOSED'],
      [{ status: 'failed', historyRevision: null }, 'CG-FNEW-UNVERIFIED'],
    ] as const) {
      v.state.row = readyRow(patch);
      expect(await v.ask('fansly.followers.send', v.request()), code).toEqual({ ok: false, error: { code } });
    }
    expect(v.starts).toEqual([]);
    expect(v.log).not.toContain('recheck');
  });

  it('[FS-NEW-6] [FS-TAIL-8] the three admissions: the own text and an edited AI result go on the reviewed history; [X69] an unchanged AI result keeps THIS generation and text even with an unverified verdict', async () => {
    const w = world();
    await w.draft('Hey you');
    const ai = { kind: 'ai', generationRef: GEN, variant: 0 } as const;
    // No operation named, one that is not this generation, or not its text: the background cannot vouch for an AI text,
    // so it goes as the person's own (2026-10-22) — never a refusal, never under another generation's name.
    const unvouched: readonly (GreetingGeneration | null)[] = [
      null,
      { generationRef: '00000000-0000-4000-8000-000000000602', fanRef: FAN, conversationRef: GROUP, text: 'Hey you', fresh: true },
      { generationRef: GEN, fanRef: FAN, conversationRef: GROUP, text: 'Hey you!', fresh: true },
    ];
    for (const [index, generation] of unvouched.entries()) {
      const u = world();
      await u.draft('Hey you');
      u.state.generation = generation;
      expect(await u.ask('fansly.followers.send', u.request({ text: 'Hey you', admission: ai, ...(index === 0 ? {} : { opId: OP }) })), String(index)).toMatchObject({ ok: true });
      expect(u.starts.map((start) => start.request)).toEqual([{ ...u.request({ text: 'Hey you' }), admission: { kind: 'own' } }]);
    }
    expect(w.starts).toEqual([]);
    // This generation and its text: its unverified verdict is advisory (X69).
    const v = world();
    await v.draft('Hey you');
    v.state.generation = { generationRef: GEN, fanRef: FAN, conversationRef: GROUP, text: 'Hey you\n', fresh: false, mark: 'unverified' };
    expect(await v.ask('fansly.followers.send', v.request({ text: 'Hey you', admission: ai, opId: OP }))).toMatchObject({ ok: true });
    expect(v.starts[0]?.request).toMatchObject({ admission: ai, opId: OP });
    // An edited result is the person's own: no operation is asked of it.
    const e = world();
    await e.draft('Hey you, welcome');
    expect(await e.ask('fansly.followers.send', e.request({ text: 'Hey you, welcome', admission: { kind: 'ai-edited', generationRef: GEN, variant: 0 } }))).toMatchObject({ ok: true });
    expect(e.starts[0]?.request.admission).toEqual({ kind: 'ai-edited', generationRef: GEN, variant: 0 });
  });

  it('[TL-004] Hi’s text that went is its generation’s `sent`: our send by its attempt, an edited result by the operation its draft kept, the person’s own send after «Открыть и вставить» without one; the person’s own text is nobody’s', async () => {
    const ai = { kind: 'ai', generationRef: GEN, variant: 0 } as const;
    const edited = { kind: 'ai-edited', generationRef: GEN, variant: 0 } as const;
    const fact = (over: Partial<GreetingAccepted> = {}): GreetingAccepted => ({ opId: OP, generationRef: GEN, pageLabel: PAGE.pageLabel, platformMessageId: '830000000000000001', edited: false, attemptId: '00000000-0000-4000-8000-000000000a01', ...over });
    // An unchanged result: the click names its operation, Fansly's receipt its message.
    const w = world();
    w.state.generation = { generationRef: GEN, fanRef: FAN, conversationRef: GROUP, text: 'Hey you', fresh: true };
    await w.ask('fansly.followers.draft', { passId: PASS, fanRef: FAN, text: 'Hey you', generation: { opId: OP, historyRevision: REV } });
    expect(await w.ask('fansly.followers.send', w.request({ text: 'Hey you', admission: ai, opId: OP }))).toMatchObject({ ok: true });
    expect(w.accepted).toEqual([fact()]);
    // Edited in the field, hours later (the operation is gone): the draft still knows the generation.
    const e = world();
    e.state.generation = { generationRef: GEN, fanRef: FAN, conversationRef: GROUP, text: 'Hey you', fresh: true };
    await e.ask('fansly.followers.draft', { passId: PASS, fanRef: FAN, text: 'Hey you', generation: { opId: OP, historyRevision: REV } });
    e.state.generation = null;
    await e.draft('Hey you, welcome');
    expect(await e.ask('fansly.followers.send', e.request({ text: 'Hey you, welcome', draftRevision: 2, admission: edited }))).toMatchObject({ ok: true });
    expect(e.accepted).toEqual([fact({ edited: true })]);
    // The person's own text, an AI text the background cannot vouch for, a send that did not go: no `sent`.
    const o = world();
    await o.draft('Hey you');
    expect(await o.ask('fansly.followers.send', o.request({ text: 'Hey you' }))).toMatchObject({ ok: true });
    o.state.status = null;
    expect(await o.ask('fansly.followers.send', o.request({ attemptId: '00000000-0000-4000-8000-000000000a02', text: 'Hey you', admission: ai, opId: OP }))).toMatchObject({ ok: true });
    expect(o.starts[1]?.request.admission).toEqual({ kind: 'own' });
    const r = world();
    r.state.generation = { generationRef: GEN, fanRef: FAN, conversationRef: GROUP, text: 'Hey you', fresh: true };
    await r.ask('fansly.followers.draft', { passId: PASS, fanRef: FAN, text: 'Hey you', generation: { opId: OP, historyRevision: REV } });
    r.state.view = (attemptId) => ({ attemptId, fanRef: FAN, state: 'refused', proof: 'before-dispatch', code: 'CG-CLAIM-BUSY' });
    expect(await r.ask('fansly.followers.send', r.request({ text: 'Hey you', admission: ai, opId: OP }))).toMatchObject({ ok: true });
    expect([...o.accepted, ...r.accepted]).toEqual([]);
    // The person sent the inserted result with Fansly's own button: the composer's `sent`, no attempt of ours.
    const n = world();
    n.state.generation = { generationRef: GEN, fanRef: FAN, conversationRef: GROUP, text: 'Hey you', fresh: true };
    await n.ask('fansly.followers.draft', { passId: PASS, fanRef: FAN, text: 'Hey you', generation: { opId: OP, historyRevision: REV } });
    expect(await n.ask('fansly.followers.sent', { passId: PASS, hostAccountId: C, fanRef: FAN, groupId: GROUP, platformMessageId: '830000000000000009', text: 'Hey you', admission: ai })).toEqual({ recorded: true });
    const { attemptId: _none, ...composer } = fact({ platformMessageId: '830000000000000009' });
    expect(n.accepted).toEqual([composer]);
  });

  it('[NF-023] one action of a fan at a time: a second click while the first runs is busy, and only one attempt is made', async () => {
    const w = world();
    await w.draft('Hi there!');
    let open = (): void => undefined;
    w.state.sendGate = new Promise((resolve) => (open = resolve));
    const first = w.ask('fansly.followers.send', w.request());
    await settle();
    expect(await w.ask('fansly.followers.send', w.request({ attemptId: '00000000-0000-4000-8000-000000000a02' }))).toEqual({ ok: false, error: { code: 'CG-SEND-BUSY' } });
    expect(await w.ask('fansly.followers.send', w.request({ attemptId: '00000000-0000-4000-8000-000000000a03', batch: true }))).toEqual({ ok: false, error: { code: 'CG-SEND-UNCERTAIN' } });
    open();
    expect(await first).toMatchObject({ ok: true });
    expect(w.starts).toHaveLength(1);
  });

  it('[FS-NEW-3] the final check’s «now» from memory: the pass’s row, the tab on its creator, the draft’s revision — another revision written meanwhile, or the tab gone, fails it', async () => {
    const w = world();
    await w.draft('Hi there!');
    const start: FanslySendStart = { request: w.request(), tabSessionId: TAB, page: PAGE };
    expect(w.greeting.live(start)).toEqual({ hostAccountId: C, groupId: GROUP, fanRef: FAN, historyRevision: REV, tabSessionId: TAB, draftRevision: 1 });
    await w.draft('Hi there! 2');
    expect(w.greeting.live(start)?.draftRevision).toBe(2);
    w.state.tabOn = false;
    expect(w.greeting.live(start)).toBeNull();
  });

  it('[NF-019] [FS-NEW-3] the person sent the card’s text with Fansly’s own button: registered for everyone, «Уже писали», the draft cleared; a tab on another creator registers nothing', async () => {
    const w = world();
    await w.draft('Hi there!');
    const report = { passId: PASS, hostAccountId: C, fanRef: FAN, groupId: GROUP, platformMessageId: '830000000000000009', text: 'Hi there!', admission: { kind: 'own' } };
    expect(await w.ask('fansly.followers.sent', report)).toEqual({ recorded: true });
    expect(w.natives).toEqual([{ page: PAGE, fanRef: FAN, groupId: GROUP, platformMessageId: '830000000000000009', admission: { kind: 'own' }, text: 'Hi there!' }]);
    expect(w.greeted).toEqual([`${C}|${FAN}`]);
    await settle();
    expect(w.stored().drafts).toEqual([]);
    // The pass may be gone (the window closed for the chat): the registration does not need it.
    w.state.row = null;
    expect(await w.ask('fansly.followers.sent', { ...report, platformMessageId: '830000000000000010' })).toEqual({ recorded: true });
    w.state.tabOn = false;
    expect(await w.ask('fansly.followers.sent', { ...report, platformMessageId: '830000000000000011' })).toEqual({ recorded: false });
    expect(w.natives).toHaveLength(2);
  });

  it('[NF-019] a receipt the send got after the click answered: the echo’s `sent` later still marks the fan', async () => {
    const w = world();
    await w.draft('Hi there!');
    w.state.view = (attemptId) => ({ attemptId, fanRef: FAN, state: 'uncertain', code: 'CG-SEND-UNCERTAIN', cause: 'network' });
    expect(await w.ask('fansly.followers.send', w.request())).toMatchObject({ ok: true, attempt: { state: 'uncertain' } });
    expect(w.greeted).toEqual([]);
    w.emit({ attemptId: w.request().attemptId, fanRef: FAN, state: 'sent', proof: 'resolved-sent' });
    expect(w.greeted).toEqual([`${C}|${FAN}`]);
  });
});

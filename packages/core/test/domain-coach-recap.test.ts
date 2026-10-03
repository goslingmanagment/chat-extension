// core/domain/coach and core/domain/recap: Coach sessions and history, the
// auto-recap step, shared recaps as local copies, the dossier save schedule
// and the archive's lag behind the open chat.

import { describe, expect, it } from 'vitest';

import { COACH_LIMITS, HUB_FACADE_TIMING, ProfileFromGenerationRequestSchema, STORAGE_LIMITS, parseTabPayload, type ChatWindow, type CoachAnswer, type LiveTextTail, type RecapStatus, type SharedRecaps } from '@cg/contracts';
import {
  COACH_PROJECTION,
  COACH_RECAP_FRESH_MS,
  CoachSessions,
  autoRecapFor,
  clampHistoryLimit,
  exchangesOf,
  historyFor,
  outsideMemory,
  projectCoachAnswer,
  recapStepVerdict,
  serializeCoachHistory,
  type CoachSession,
  type CoachSessionKey,
  type CoachSessionLimits,
} from '@cg/core/domain/coach';
import {
  RECAP_SLOT_LIMITS,
  RecapSlots,
  archiveLag,
  copiesOfShared,
  copyOfResult,
  copyOfShared,
  coverageLevelOf,
  latestLength,
  profileRequestOf,
  recapSaveAnswer,
  saveAnswered,
  saveRetryDelay,
  saveSchedule,
  saveStarted,
  supersedes,
  type RecapCopy,
  type RecapSlotKey,
} from '@cg/core/domain/recap';
import { profileSaveDelay } from '@cg/core/services';

import { NOW_MS, WORLD, chatOf, uuid } from './support/world';

const key = (fan: string = WORLD.fan, personaDefinitionId: string = WORLD.persona.definitionId): CoachSessionKey => ({
  chatKey: `chatspace:${WORLD.pages.one.hostAccountId}:${fan}`,
  personaDefinitionId,
});

const answer = (prose: string): CoachAnswer => ({ prose, blocks: null, drafts: [] });

function store(limits: Partial<CoachSessionLimits> = {}): CoachSessions {
  let n = 0;
  return new CoachSessions({ newId: () => uuid(0x700 + n++), limits });
}

/** Asks and finishes one exchange. */
function exchange(sessions: CoachSessions, session: CoachSession, n: number, text = `answer ${n}`): void {
  const turnId = uuid(0x800 + n);
  const begun = sessions.begin(session.sessionId, { turnId, question: `question ${n}`, preset: null, attachedDraft: false, askedAt: NOW_MS + n, step: 'coach' });
  if (!begun.ok) throw new Error(begun.reason);
  sessions.step(session.sessionId, turnId, 'coach', uuid(0x900 + n));
  sessions.complete(session.sessionId, turnId, { opId: uuid(0x900 + n), generationRef: uuid(0xa00 + n), answerRaw: text, answer: answer(text), completedAt: NOW_MS + n + 1 });
}

describe('[AI-089] Coach sessions', () => {
  it('one current dialog per chat and persona; opening it again gives the same one', () => {
    const sessions = store();
    const a = sessions.open(key(), NOW_MS);
    expect(sessions.open(key(), NOW_MS + 5).sessionId).toBe(a.sessionId);
    expect(sessions.open(key(WORLD.otherFan), NOW_MS).sessionId).not.toBe(a.sessionId);
    expect(sessions.open(key(WORLD.fan, WORLD.persona.otherDefinitionId), NOW_MS).sessionId).not.toBe(a.sessionId);
    expect(sessions.peek(key('2999'))).toBeNull();
  });

  it('keeps five sessions: the least recently used goes first', () => {
    const sessions = store();
    const fans = ['2101', '2102', '2103', '2104', '2105'];
    for (const fan of fans) sessions.open(key(fan), NOW_MS);
    sessions.open(key('2101'), NOW_MS + 1); // touched: now the most recent
    sessions.open(key('2106'), NOW_MS + 2);
    expect(sessions.all().length).toBe(STORAGE_LIMITS.coachSessions);
    expect(sessions.peek(key('2102'))).toBeNull();
    expect(sessions.peek(key('2101'))).not.toBeNull();
  });

  it('keeps fifty exchanges per session: the oldest go', () => {
    const sessions = store();
    const session = sessions.open(key(), NOW_MS);
    for (let n = 0; n < STORAGE_LIMITS.coachExchangesPerSession + 3; n += 1) exchange(sessions, session, n);
    const kept = exchangesOf(sessions.byId(session.sessionId) as CoachSession);
    expect(kept.length).toBe(STORAGE_LIMITS.coachExchangesPerSession);
    expect(kept[0]?.question).toBe('question 3');
  });

  it('stays within its bytes: archived and old sessions go before the current one loses exchanges', () => {
    const sessions = store({ totalBytes: 60_000 });
    const first = sessions.open(key('2101'), NOW_MS);
    exchange(sessions, first, 1, 'x'.repeat(8_000));
    const second = sessions.open(key('2102'), NOW_MS);
    exchange(sessions, second, 2, 'y'.repeat(8_000));
    expect(sessions.all().length).toBe(1);
    expect(sessions.peek(key('2101'))).toBeNull();
    exchange(sessions, second, 3, 'z'.repeat(8_000));
    const kept = exchangesOf(sessions.byId(second.sessionId) as CoachSession);
    expect(kept.map((e) => e.question)).toEqual(['question 3']);
    expect(sessions.bytes()).toBeLessThanOrEqual(60_000);
  });

  it('a session with an answer on its way is never evicted', () => {
    const sessions = store({ sessions: 1 });
    const busy = sessions.open(key('2101'), NOW_MS);
    sessions.begin(busy.sessionId, { turnId: uuid(1), question: 'q', preset: null, attachedDraft: false, askedAt: NOW_MS, step: 'coach' });
    sessions.open(key('2102'), NOW_MS);
    expect(sessions.peek(key('2101'))?.pending?.question).toBe('q');
  });

  it('a change of persona or account wipes the dialogs', () => {
    const sessions = store();
    sessions.open(key('2101'), NOW_MS);
    sessions.open(key('2102', WORLD.persona.otherDefinitionId), NOW_MS);
    expect(sessions.reset((session) => session.key.personaDefinitionId === WORLD.persona.otherDefinitionId)).toBe(1);
    expect(sessions.all().length).toBe(1);
    expect(sessions.reset()).toBe(1);
    expect(sessions.all()).toEqual([]);
  });
});

describe('Coach turns', () => {
  it('[AI-100] one turn at a time: a second question while the Coach answers is refused', () => {
    const sessions = store();
    const session = sessions.open(key(), NOW_MS);
    const turn = { turnId: uuid(1), question: 'q', preset: null, attachedDraft: false, askedAt: NOW_MS, step: 'coach' as const };
    expect(sessions.begin(session.sessionId, turn).ok).toBe(true);
    expect(sessions.begin(session.sessionId, { ...turn, turnId: uuid(2) })).toEqual({ ok: false, reason: 'busy' });
    expect(sessions.begin(uuid(0xdead), turn)).toEqual({ ok: false, reason: 'no-session' });
  });

  it('[AI-092] a failed or canceled turn keeps its question and never enters the history', () => {
    const sessions = store();
    const session = sessions.open(key(), NOW_MS);
    exchange(sessions, session, 1);
    sessions.begin(session.sessionId, { turnId: uuid(5), question: 'lost?', preset: null, attachedDraft: true, askedAt: NOW_MS + 10, step: 'coach' });
    sessions.step(session.sessionId, uuid(5), 'coach', uuid(0x905));
    const failed = sessions.fail(session.sessionId, uuid(5), { outcome: 'failed', error: { code: 'CG-PROVIDER-UNAVAILABLE' }, endedAt: NOW_MS + 20 });
    expect(failed?.pending).toBeNull();
    expect(failed?.feed.map((item) => item.kind)).toEqual(['exchange', 'failed']);
    expect(failed?.feed[1]).toMatchObject({ question: 'lost?', outcome: 'failed', opId: uuid(0x905), attachedDraft: true, error: { code: 'CG-PROVIDER-UNAVAILABLE' } });
    expect(historyFor(failed as CoachSession, 10)).toEqual([{ question: 'question 1', answer: 'answer 1' }]);

    sessions.begin(session.sessionId, { turnId: uuid(6), question: 'stopped', preset: null, attachedDraft: false, askedAt: NOW_MS + 30, step: 'coach' });
    const canceled = sessions.fail(session.sessionId, uuid(6), { outcome: 'canceled', error: null, endedAt: NOW_MS + 31 });
    expect(canceled?.feed[2]).toMatchObject({ outcome: 'canceled', error: null });
  });

  it('asking the same question again replaces its failed attempt', () => {
    const sessions = store();
    const session = sessions.open(key(), NOW_MS);
    sessions.begin(session.sessionId, { turnId: uuid(5), question: 'again?', preset: null, attachedDraft: false, askedAt: NOW_MS, step: 'coach' });
    sessions.fail(session.sessionId, uuid(5), { outcome: 'failed', error: { code: 'CG-HUB-TIMEOUT' }, endedAt: NOW_MS + 1 });
    const again = sessions.begin(session.sessionId, { turnId: uuid(6), question: 'again?', preset: null, attachedDraft: false, askedAt: NOW_MS + 2, step: 'coach' });
    expect(again.ok && again.session.feed).toEqual([]);
  });

  it('[AI-099] a start refused before anything ran leaves no trace: the question stays with the person', () => {
    const sessions = store();
    const session = sessions.open(key(), NOW_MS);
    sessions.begin(session.sessionId, { turnId: uuid(5), question: 'q', preset: null, attachedDraft: false, askedAt: NOW_MS, step: 'coach' });
    const after = sessions.abandon(session.sessionId, uuid(5));
    expect(after?.pending).toBeNull();
    expect(after?.feed).toEqual([]);
    expect(sessions.abandon(session.sessionId, uuid(5))).toBeNull();
  });

  it('a late event of another turn changes nothing', () => {
    const sessions = store();
    const session = sessions.open(key(), NOW_MS);
    sessions.begin(session.sessionId, { turnId: uuid(5), question: 'q', preset: null, attachedDraft: false, askedAt: NOW_MS, step: 'coach' });
    expect(sessions.complete(session.sessionId, uuid(99), { opId: uuid(1), generationRef: null, answerRaw: 'a', answer: answer('a'), completedAt: NOW_MS })).toBeNull();
    expect(sessions.fail(session.sessionId, uuid(99), { outcome: 'failed', error: null, endedAt: NOW_MS })).toBeNull();
    expect(sessions.byId(session.sessionId)?.pending?.turnId).toBe(uuid(5));
    expect(sessions.byOp(uuid(1))).toBeNull();
    sessions.step(session.sessionId, uuid(5), 'coach', uuid(0x905));
    expect(sessions.byOp(uuid(0x905))?.sessionId).toBe(session.sessionId);
  });

  it('[AI-090] «Новый диалог» puts the dialog aside and starts a new one; refused while the Coach answers', () => {
    const sessions = store();
    const session = sessions.open(key(), NOW_MS);
    exchange(sessions, session, 1);
    const fresh = sessions.newDialog(key(), NOW_MS + 100);
    if (!fresh.ok) throw new Error(fresh.reason);
    expect(fresh.session.sessionId).not.toBe(session.sessionId);
    expect(fresh.session.feed).toEqual([]);
    expect(sessions.byId(session.sessionId)?.archived).toBe(true);
    expect(sessions.peek(key())?.sessionId).toBe(fresh.session.sessionId);

    sessions.begin(fresh.session.sessionId, { turnId: uuid(7), question: 'q', preset: null, attachedDraft: false, askedAt: NOW_MS, step: 'coach' });
    expect(sessions.newDialog(key(), NOW_MS + 200)).toEqual({ ok: false, reason: 'busy' });
  });

  it('an empty dialog is not kept as history', () => {
    const sessions = store();
    const first = sessions.open(key(), NOW_MS);
    const next = sessions.newDialog(key(), NOW_MS + 1);
    expect(next.ok && next.session.sessionId).not.toBe(first.sessionId);
    expect(sessions.all().length).toBe(1);
  });
});

describe('[AI-088] Coach history', () => {
  it('the limit is held to 1–20, default range of the setting', () => {
    expect([0, 1, 10, 20, 21, 99, Number.NaN, 7.9].map(clampHistoryLimit)).toEqual([1, 1, 10, 20, 20, 20, 1, 7]);
  });

  it('replays the last N exchanges, oldest first', () => {
    const sessions = store();
    const session = sessions.open(key(), NOW_MS);
    for (let n = 1; n <= 5; n += 1) exchange(sessions, session, n);
    const current = sessions.byId(session.sessionId) as CoachSession;
    expect(historyFor(current, 2)).toEqual([
      { question: 'question 4', answer: 'answer 4' },
      { question: 'question 5', answer: 'answer 5' },
    ]);
    expect(historyFor(current, 20).length).toBe(5);
  });

  it('[AI-094] exchanges above the limit are outside the memory', () => {
    const sessions = store();
    const session = sessions.open(key(), NOW_MS);
    for (let n = 1; n <= 5; n += 1) exchange(sessions, session, n);
    const current = sessions.byId(session.sessionId) as CoachSession;
    expect([...outsideMemory(current, 2)]).toEqual([uuid(0x801), uuid(0x802), uuid(0x803)]);
    expect(outsideMemory(current, 10).size).toBe(0);
  });

  it('a long answer is replayed as head and tail with the omission marked; a short one as it is', () => {
    expect(projectCoachAnswer('short')).toBe('short');
    const exact = 'a'.repeat(COACH_PROJECTION.maxChars);
    expect(projectCoachAnswer(exact)).toBe(exact);
    const long = `${'h'.repeat(6_000)}${'m'.repeat(5_000)}${'t'.repeat(3_800)}`;
    const projected = projectCoachAnswer(long);
    expect(projected).toBe(`${'h'.repeat(6_000)}\n[… 5000 chars omitted …]\n${'t'.repeat(3_800)}`);
    expect(projected.length).toBeLessThanOrEqual(COACH_PROJECTION.maxChars);
    // Code points: an emoji is never cut in half.
    const emoji = projectCoachAnswer('😊'.repeat(10_001));
    expect(emoji.includes('�')).toBe(false);
    expect(Array.from(emoji.split('\n')[0] ?? '').length).toBe(6_000);
  });

  it('stays inside the hub body: twenty turns, bounded questions and answers', () => {
    const many = Array.from({ length: 30 }, (_, n) => ({ question: `q${n}`, answerRaw: `a${n}` }));
    expect(serializeCoachHistory(many, 20).length).toBe(COACH_LIMITS.historyMaxTurns);
    const [turn] = serializeCoachHistory([{ question: 'q'.repeat(5_000), answerRaw: 'ok' }], 10);
    expect(turn?.question.length).toBe(COACH_LIMITS.questionMaxChars);
    expect(serializeCoachHistory([{ question: '  ', answerRaw: 'a' }], 10)).toEqual([]);
  });
});

const slot = (ageMs: number, requestedCount: number | null = 3000): NonNullable<RecapStatus['full']> => ({
  generatedAt: new Date(NOW_MS - ageMs).toISOString(),
  ageMs,
  transcriptCoverage: 'window',
  requestedCount,
  keptCount: requestedCount,
});

describe('[AI-096] auto-recap before the first question', () => {
  const facts = (over: Partial<Parameters<typeof autoRecapFor>[0]> = {}) => ({ mode: 'short' as const, attempted: false, hasExchanges: false, status: { full: null, short: null }, deepWindow: 3000, ...over });

  it('off, already tried, or not the first question: ask right away', () => {
    expect(autoRecapFor(facts({ mode: 'off' }))).toBeNull();
    expect(autoRecapFor(facts({ attempted: true }))).toBeNull();
    expect(autoRecapFor(facts({ hasExchanges: true }))).toBeNull();
  });

  it('short is satisfied by any fresh recap; a recap older than 24 hours is not fresh', () => {
    expect(autoRecapFor(facts())).toBe('short');
    expect(autoRecapFor(facts({ status: { full: null, short: slot(60_000, 300) } }))).toBeNull();
    expect(autoRecapFor(facts({ status: { full: slot(60_000), short: null } }))).toBeNull();
    expect(autoRecapFor(facts({ status: { full: slot(COACH_RECAP_FRESH_MS + 1), short: slot(COACH_RECAP_FRESH_MS + 1, 300) } }))).toBe('short');
    expect(autoRecapFor(facts({ status: { full: null, short: slot(COACH_RECAP_FRESH_MS, 300) } }))).toBeNull();
  });

  it('full needs a fresh full recap made at the current deep window', () => {
    expect(autoRecapFor(facts({ mode: 'full', status: { full: slot(60_000, 3000), short: null } }))).toBeNull();
    expect(autoRecapFor(facts({ mode: 'full', status: { full: slot(60_000, 1500), short: null } }))).toBe('full');
    expect(autoRecapFor(facts({ mode: 'full', status: { full: null, short: slot(60_000, 300) } }))).toBe('full');
  });

  it('an unknown status does not count as a fresh recap', () => {
    expect(autoRecapFor(facts({ status: null }))).toBe('short');
    expect(autoRecapFor(facts({ mode: 'full', status: null }))).toBe('full');
  });

  it('a recap step that failed for the conversation itself still lets the question go; anything else stops', () => {
    for (const code of ['CG-OUTPUT-UNUSABLE', 'CG-GATE-HISTORY', 'CG-PROVIDER-EMPTY'] as const) expect(recapStepVerdict(code), code).toBe('proceed');
    for (const code of ['CG-HUB-UNAVAILABLE', 'CG-QUOTA-DAILY', 'CG-OP-CHAT-BUSY', 'CG-PROVIDER-RATE-LIMIT', 'CG-UNKNOWN'] as const) expect(recapStepVerdict(code), code).toBe('stop');
  });
});

// ── recap ────────────────────────────────────────────────────────────────────

const slotKey: RecapSlotKey = { hubOrigin: WORLD.hubOrigin, pageId: WORLD.pages.one.pageId, fanRef: WORLD.fan, personaDefinitionId: WORLD.persona.definitionId };

function ids(start = 0x500): { newLocalId: () => string; now: number } {
  let n = start;
  return { newLocalId: () => uuid(n++), now: NOW_MS };
}

const body = (generationRef: string, generatedAt: string, text: string, transcriptCoverage: string | null = 'full-history') => ({
  generationRef,
  generatedAt,
  personaDefinitionId: WORLD.persona.definitionId,
  coverage: { transcriptCoverage, requestedCount: 3000, keptCount: 412 },
  text,
});

const shared: SharedRecaps = {
  full: body(uuid(0x201), '2026-10-02T10:00:00.000Z', 'КТО ОН\nHubert, 34.\n\nСЕЙЧАС\nждёт ответа'),
  short: body(uuid(0x202), '2026-10-03T09:00:00.000Z', 'Hubert, 34. Buys sets.', 'window'),
  fullSavedToProfile: true,
};

describe('[REC-01] [AI-063] [AI-066] shared recaps as local copies', () => {
  it('a copy carries the shared artifact id and revision, and the text prepared once', () => {
    const copies = copiesOfShared(shared, ids());
    expect(copies.full).toMatchObject({
      length: 'full',
      id: uuid(0x201),
      revision: '2026-10-02T10:00:00.000Z',
      markdown: 'КТО ОН\nHubert, 34.\n\nСЕЙЧАС\nждёт ответа',
      blocks: [
        { heading: 'КТО ОН', markdown: 'Hubert, 34.' },
        { heading: 'СЕЙЧАС', markdown: 'ждёт ответа' },
      ],
      coverage: { level: 'complete', requested: 3000, served: 412 },
      savedToProfile: true,
      source: 'hub',
      opId: null,
    });
    expect(copies.short).toMatchObject({ length: 'short', id: uuid(0x202), blocks: null, coverage: { level: 'partial' }, savedToProfile: null });
    expect(copies.full?.localId).not.toBe(copies.short?.localId);
  });

  it('there is nothing private in a copy: no user, no chatter, only the page, the fan and the persona key it', () => {
    const copy = copyOfShared(shared.full as NonNullable<SharedRecaps['full']>, 'full', false, ids());
    expect(Object.keys(copy as RecapCopy).sort()).toEqual(['blocks', 'coverage', 'id', 'length', 'localId', 'markdown', 'opId', 'revision', 'savedToProfile', 'source', 'storedAt']);
    expect(Object.keys(slotKey).sort()).toEqual(['fanRef', 'hubOrigin', 'pageId', 'personaDefinitionId']);
  });

  it('an empty body is not a recap; an unknown coverage word is unknown', () => {
    expect(copyOfShared(body(uuid(1), '2026-10-02T10:00:00.000Z', '  \n '), 'short', null, ids())).toBeNull();
    expect(copiesOfShared({ full: null, short: null, fullSavedToProfile: false }, ids())).toEqual({ short: null, full: null });
    expect(['full-history', 'window', 'something-new', null].map(coverageLevelOf)).toEqual(['complete', 'partial', 'unknown', 'unknown']);
  });

  it('[AI-066] the two lengths never overwrite each other', () => {
    const slots = new RecapSlots();
    const copies = copiesOfShared(shared, ids());
    slots.put(slotKey, copies.full as RecapCopy);
    slots.put(slotKey, copies.short as RecapCopy);
    expect(slots.both(slotKey).full?.id).toBe(uuid(0x201));
    expect(slots.both(slotKey).short?.id).toBe(uuid(0x202));
    expect(slots.get({ ...slotKey, fanRef: WORLD.otherFan }, 'full')).toBeNull();
    expect(slots.get({ ...slotKey, personaDefinitionId: WORLD.persona.otherDefinitionId }, 'full')).toBeNull();
  });

  it('a newer shared revision replaces the copy; an older one never does; the same artifact keeps its handle', () => {
    const slots = new RecapSlots();
    const first = copyOfShared(body(uuid(0x201), '2026-10-02T10:00:00.000Z', 'old'), 'full', false, ids(0x500)) as RecapCopy;
    const older = copyOfShared(body(uuid(0x1ff), '2026-10-01T10:00:00.000Z', 'older'), 'full', false, ids(0x510)) as RecapCopy;
    const newer = copyOfShared(body(uuid(0x203), '2026-10-03T10:00:00.000Z', 'new'), 'full', true, ids(0x520)) as RecapCopy;
    slots.put(slotKey, first);
    expect(slots.put(slotKey, older).id).toBe(uuid(0x201));
    const again = slots.put(slotKey, { ...first, localId: uuid(0x599), savedToProfile: true });
    expect(again.localId).toBe(first.localId);
    expect(again.savedToProfile).toBe(true);
    expect(slots.put(slotKey, newer).markdown).toBe('new');
    expect(supersedes({ id: 'a', revision: 'not a date' }, { id: 'b', revision: '2026-10-03T10:00:00.000Z' })).toBe(true);
  });

  it('[AI-066] when the store is full the ten oldest entries go', () => {
    const slots = new RecapSlots();
    const make = (n: number) => copyOfShared(body(uuid(0x1000 + n), '2026-10-02T10:00:00.000Z', `recap ${n}`), 'short', null, ids(0x2000 + n)) as RecapCopy;
    for (let n = 0; n < RECAP_SLOT_LIMITS.maxEntries; n += 1) slots.put({ ...slotKey, fanRef: String(5000 + n) }, make(n));
    expect(slots.size).toBe(RECAP_SLOT_LIMITS.maxEntries);
    slots.put({ ...slotKey, fanRef: '9999' }, make(999));
    expect(slots.size).toBe(RECAP_SLOT_LIMITS.maxEntries + 1 - RECAP_SLOT_LIMITS.evictBatch);
    expect(slots.get({ ...slotKey, fanRef: '5000' }, 'short')).toBeNull();
    expect(slots.get({ ...slotKey, fanRef: '5010' }, 'short')).not.toBeNull();
    expect(slots.get({ ...slotKey, fanRef: '9999' }, 'short')).not.toBeNull();
  });

  it('a recap generated here becomes a copy of the shared artifact it now is', () => {
    const copy = copyOfResult(
      { opId: uuid(0x100), feature: 'recap', endedAt: NOW_MS, result: { kind: 'recap', markdown: 'ONE\na\n\nTWO\nb', coverage: { level: 'partial', requested: 3000, served: 900, asOf: null }, shared: { generationRef: uuid(0x200) } } },
      ids(),
    );
    expect(copy).toMatchObject({ length: 'full', id: uuid(0x200), revision: new Date(NOW_MS).toISOString(), source: 'generated', opId: uuid(0x100), savedToProfile: false, coverage: { level: 'partial', requested: 3000, served: 900 } });
    expect(copy?.blocks?.length).toBe(2);
    const short = copyOfResult({ opId: uuid(0x101), feature: 'recap-short', endedAt: NOW_MS, result: { kind: 'recap', markdown: 'short', coverage: null, shared: { generationRef: uuid(0x204) } } }, ids());
    expect(short).toMatchObject({ length: 'short', blocks: null, savedToProfile: null, coverage: { level: 'unknown', requested: null, served: null } });
    expect(copyOfResult({ opId: uuid(1), feature: 'reply', endedAt: NOW_MS, result: { kind: 'parts', parts: ['x'], splitRequested: false } }, ids())).toBeNull();
  });

  it('the handle of a copy finds it; the dossier state of the full copy can be updated; an emptied slot loses its copy', () => {
    const slots = new RecapSlots();
    const copies = copiesOfShared({ ...shared, fullSavedToProfile: false }, ids());
    const full = slots.put(slotKey, copies.full as RecapCopy);
    expect(slots.byLocalId(full.localId)?.id).toBe(uuid(0x201));
    expect(slots.byLocalId(uuid(0xdead))).toBeNull();
    expect(slots.markSaved(slotKey, uuid(0x201), true)?.savedToProfile).toBe(true);
    expect(slots.markSaved(slotKey, uuid(0x999), true)).toBeNull();
    slots.drop(slotKey, 'full');
    expect(slots.get(slotKey, 'full')).toBeNull();
    slots.put(slotKey, copies.short as RecapCopy);
    slots.clear();
    expect(slots.size).toBe(0);
  });

  it('[AI-065] «Открыть последний» takes the fresher slot; a tie and full-only give the full one', () => {
    const at = (revision: string) => ({ revision });
    expect(latestLength({ short: at('2026-10-03T09:00:00.000Z'), full: at('2026-10-02T10:00:00.000Z') })).toBe('short');
    expect(latestLength({ short: at('2026-10-02T10:00:00.000Z'), full: at('2026-10-02T10:00:00.000Z') })).toBe('full');
    expect(latestLength({ short: null, full: at('2026-10-02T10:00:00.000Z') })).toBe('full');
    expect(latestLength({ short: at('2026-10-02T10:00:00.000Z'), full: null })).toBe('short');
    expect(latestLength({ short: null, full: null })).toBeNull();
  });
});

describe('[AI-067] [AI-068] the dossier save schedule', () => {
  it('not-ready repeats after 5 s, 15 s, 60 s, then every 3 minutes, for at most 30 minutes', () => {
    expect([1, 2, 3, 4, 5].map(saveRetryDelay)).toEqual([5_000, 15_000, 60_000, 180_000, 180_000]);
    const offsets = saveSchedule();
    expect(offsets.slice(0, 4)).toEqual([5_000, 20_000, 80_000, 260_000]);
    expect(offsets.every((offset) => offset <= HUB_FACADE_TIMING.profileSaveGiveUpMs)).toBe(true);
    expect((offsets[offsets.length - 1] ?? 0) + 180_000).toBeGreaterThan(HUB_FACADE_TIMING.profileSaveGiveUpMs);
    // The same delays as the background's saver uses.
    expect([1, 2, 3, 4].map(saveRetryDelay)).toEqual([1, 2, 3, 4].map(profileSaveDelay));
  });

  it('saved ends it; a refusal or a transport failure is CG-RECAP-SAVE and is not repeated by itself', () => {
    const started = saveStarted(NOW_MS);
    expect(saveAnswered(started, 'saved', NOW_MS + 10, '2026-10-03T10:00:00.000Z')).toEqual({ s: 'saved', at: '2026-10-03T10:00:00.000Z' });
    expect(saveAnswered(started, 'rejected', NOW_MS)).toEqual({ s: 'failed', reason: 'rejected' });
    expect(saveAnswered(started, 'error', NOW_MS)).toEqual({ s: 'failed', reason: 'error' });
    expect(saveAnswered(started, 'not-ready', NOW_MS + 100)).toEqual({ s: 'saving', startedAt: NOW_MS, attempts: 1, nextAt: NOW_MS + 5_100 });
  });

  it('gives up when the next attempt would start more than 30 minutes after the first', () => {
    const late = { s: 'saving' as const, startedAt: NOW_MS, attempts: 9, nextAt: null };
    expect(saveAnswered(late, 'not-ready', NOW_MS + HUB_FACADE_TIMING.profileSaveGiveUpMs - 1_000)).toEqual({ s: 'failed', reason: 'gave-up' });
  });

  it('an answer to a state that is not saving changes nothing', () => {
    expect(saveAnswered({ s: 'saved', at: null }, 'rejected', NOW_MS)).toEqual({ s: 'saved', at: null });
    expect(saveAnswered({ s: 'not-applicable' }, 'saved', NOW_MS)).toEqual({ s: 'not-applicable' });
  });

  it('[AI-067] `recap.save` on the background\'s side: the hub is asked by the generation, never with the text', () => {
    const request = { pageId: 11, fanRef: '2002', generationRef: '00000000-0000-4000-8000-000000000200', opId: '00000000-0000-4000-8000-000000000100' };
    expect(parseTabPayload('req', 'recap.save', request).ok).toBe(true);
    const asked = profileRequestOf(request, 'model-one');
    expect(asked).toEqual({ pageLabel: 'model-one', fanRef: '2002', generationRef: request.generationRef, clientRequestId: request.opId });
    expect(ProfileFromGenerationRequestSchema.safeParse(asked).success).toBe(true);
    // A copy of the hub's recap has no operation of ours.
    expect(profileRequestOf({ pageId: 11, fanRef: '2002', generationRef: request.generationRef }, 'model-one')).toEqual({ pageLabel: 'model-one', fanRef: '2002', generationRef: request.generationRef });

    const answers = [
      recapSaveAnswer({ state: 'saved', response: { outcome: 'existing', profile: { version: 3, createdAt: '2026-10-03T10:00:01.000Z', sourceGeneratedAt: null } } }),
      recapSaveAnswer({ state: 'not-ready' }),
      recapSaveAnswer({ state: 'rejected', reason: 'generation_not_found' }),
    ];
    expect(answers).toEqual([
      { state: 'saved', savedAt: '2026-10-03T10:00:01.000Z' },
      { state: 'not-ready', savedAt: null },
      { state: 'rejected', savedAt: null },
    ]);
    for (const answer of answers) expect(parseTabPayload('res', 'recap.save', answer).ok).toBe(true);
  });
});

const tailOf = (ids: readonly string[], startSeconds = -600): LiveTextTail => ({
  capturedAt: new Date(NOW_MS).toISOString(),
  messages: ids.map((id, index) => ({ platformMessageId: id, direction: index % 2 === 0 ? 'fan' : 'model', sentAt: new Date(NOW_MS + (startSeconds + index * 60) * 1000).toISOString(), text: `m${id}` })),
});

const windowOf = (over: Partial<ChatWindow> = {}): ChatWindow => ({
  chat: chatOf(WORLD.fan),
  state: 'ready',
  loaded: 40,
  fanMessages: 22,
  modelMessages: 18,
  lastFanMessageId: '4008',
  lastFanMessageAt: new Date(NOW_MS - 60_000).toISOString(),
  lastModelMessageAt: new Date(NOW_MS - 120_000).toISOString(),
  hasOlder: true,
  ...over,
});

describe('[NEW-02] [AI-070] the archive lags behind the open chat by K messages', () => {
  const tail = tailOf(['4004', '4005', '4006', '4007', '4008']);

  it('counts the page messages after the archive head', () => {
    expect(archiveLag({ messageRef: '4006', at: null }, { tail, window: null })).toEqual({ messages: 2 });
    expect(archiveLag({ messageRef: '4007', at: null }, { tail, window: null })).toEqual({ messages: 1 });
  });

  it('is not behind when the archive head is the newest page message', () => {
    expect(archiveLag({ messageRef: '4008', at: null }, { tail, window: null })).toBeNull();
  });

  it('ids are compared for equality, never by size: a head that is not in the tail falls back to its time', () => {
    const at = (seconds: number) => new Date(NOW_MS + seconds * 1000).toISOString();
    // A numerically larger id that is not there says nothing by itself.
    expect(archiveLag({ messageRef: '9999', at: null }, { tail, window: null })).toBeNull();
    expect(archiveLag({ messageRef: '9999', at: at(-450) }, { tail, window: null })).toEqual({ messages: 2 });
    expect(archiveLag({ messageRef: null, at: at(-361) }, { tail, window: null })).toEqual({ messages: 1 });
    expect(archiveLag({ messageRef: null, at: at(0) }, { tail, window: null })).toBeNull();
  });

  it('when every visible message is newer the number is not known', () => {
    expect(archiveLag({ messageRef: null, at: new Date(NOW_MS - 3_600_000).toISOString() }, { tail, window: null })).toEqual({ messages: null });
  });

  it('without a readable tail the window still says behind or not, never a number', () => {
    const before = new Date(NOW_MS - 90_000).toISOString();
    const after = new Date(NOW_MS - 10_000).toISOString();
    expect(archiveLag({ messageRef: null, at: before }, { tail: null, window: windowOf() })).toEqual({ messages: null });
    expect(archiveLag({ messageRef: null, at: after }, { tail: null, window: windowOf() })).toBeNull();
    expect(archiveLag({ messageRef: null, at: before }, { tail: null, window: windowOf({ state: 'loading' }) })).toBeNull();
    expect(archiveLag({ messageRef: '4004', at: null }, { tail: null, window: windowOf() })).toBeNull();
  });

  it('nothing is said without an archive point', () => {
    expect(archiveLag(null, { tail, window: windowOf() })).toBeNull();
    expect(archiveLag({ messageRef: null, at: null }, { tail, window: windowOf() })).toBeNull();
    expect(archiveLag({ messageRef: null, at: 'not a date' }, { tail, window: windowOf() })).toBeNull();
  });
});

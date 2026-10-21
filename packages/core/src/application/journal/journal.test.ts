import { type LogLevel } from '@cg/contracts/logs';
import { describe, expect, it } from 'vitest';

import { createRedactor, sanitizeFields } from '../../domain/logging';
import { MemoryLogStore, LogService } from '../../services/logs';
import { actionFacts, handleFacts } from './actions';
import { AVAILABLE, diffAvailability, type Availability } from './availability';
import { createActionJournal, createDecisionWatch, type JournalLog } from './watch';

const OP = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

function sink(): JournalLog & { readonly lines: { level: LogLevel; scope: string; msg: string; fields: Record<string, unknown> }[] } {
  const lines: { level: LogLevel; scope: string; msg: string; fields: Record<string, unknown> }[] = [];
  return {
    lines,
    write(level, scope, msg, options) {
      lines.push({ level, scope, msg, fields: { ...(options?.fields ?? {}) } });
    },
  };
}

const off = (why: string, code: string | null = null): Availability => ({ on: false, why, code, say: `${why} said` });

describe('the chatter\'s log: what a click was, by ids only', () => {
  it('a typed text is its length, a sign-in is only its type, a handle is read back into the fan\'s ids', () => {
    expect(actionFacts({ type: 'Search', list: 'spenders', query: 'Jessica from Ohio' })).toEqual({ action: 'Search', list: 'spenders', queryChars: 17 });
    expect(actionFacts({ type: 'SignIn', login: 'chatter1', password: 'secret-password' })).toEqual({ action: 'SignIn' });
    expect(actionFacts({ type: 'Generate', targetHandle: 'dock:chatspace:910101:74001001', feature: 'hi', options: { variants: 3 } })).toEqual({
      action: 'Generate',
      source: 'dock',
      accountId: '910101',
      fanId: '74001001',
      feature: 'hi',
      variants: 3,
    });
    expect(actionFacts({ type: 'SendPart', operationId: OP, variant: 0, part: 1 })).toEqual({ action: 'SendPart', opId: OP, variant: 0, part: 1 });
    expect(actionFacts({ type: 'Navigate', to: { kind: 'surface', surface: 'spenders', open: true } })).toEqual({ action: 'Navigate', toKind: 'surface', surface: 'spenders', open: true });
    expect(handleFacts('spenders:11:5001')).toEqual({ source: 'spenders', pageId: 11, fanId: '5001' });
    expect(handleFacts('chatspace:910101:74001001')).toEqual({ accountId: '910101', fanId: '74001001' });
    // The log's own redaction keeps every one of these words, and turns a name under any of them into its length.
    const kept = sanitizeFields({ ...actionFacts({ type: 'Search', list: 'spenders', query: 'Jessica' }), input: 'click', via: 'spenders', toKind: 'surface' }, createRedactor());
    expect(kept).toEqual({ action: 'Search', list: 'spenders', queryChars: 7, input: 'click', via: 'spenders', toKind: 'surface' });
  });

  it('a quick answer joins its click in one record; a slow one is a record of its own', () => {
    const log = sink();
    let now = 0;
    const timers: (() => void)[] = [];
    const journal = createActionJournal(log, { now: () => now, setTimer: (_ms, fn) => timers.push(fn), clearTimer: () => timers.splice(0) });
    journal.pressed({ type: 'Generate', targetHandle: 'dock:chatspace:1:2', feature: 'hi', options: {} }, { input: 'click', via: 'dock' })({
      ok: false,
      type: 'Generate',
      code: 'CG-GATE-HI',
      error: { code: 'CG-GATE-HI', title: 'Hi недоступен', body: '' },
    });
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toMatchObject({ msg: 'pressed', fields: { action: 'Generate', feature: 'hi', ok: false, code: 'CG-GATE-HI', say: 'Hi недоступен', via: 'dock', input: 'click' } });
    const answered = journal.pressed({ type: 'OpenPreview', targetHandle: 'spenders:11:5001' }, { input: 'click', via: 'spenders' });
    now = 2000;
    for (const fire of timers.splice(0)) fire();
    answered({ ok: true, type: 'OpenPreview', outcome: 'opened' });
    expect(log.lines.slice(1).map((line) => [line.msg, line.fields['ms'] ?? null])).toEqual([
      ['pressed', null],
      ['answered', 2000],
    ]);
  });
});

describe('the chatter\'s log: what went off and why, on change only', () => {
  it('a passing state keeps what was; a new entry that is on is no news; a change in the reason is one', () => {
    const before = new Map([
      ['hi', off('hi-gate', 'CG-GATE-HI')],
      ['reply', AVAILABLE],
    ]);
    const next = new Map([
      ['hi', off('hi-gate', 'CG-GATE-HI')],
      ['fix', AVAILABLE],
      ['ping', off('ping-gate')],
      ['reply', off('feature-disabled', 'CG-FEATURE-DISABLED')],
    ]);
    const { changes, kept } = diffAvailability(before, next);
    expect(changes.map((change) => change.key)).toEqual(['ping', 'reply']);
    expect(kept.get('reply')?.why).toBe('feature-disabled');
    // An entry the next map leaves out (it only passes now) keeps its last state, and says nothing.
    expect(diffAvailability(kept, new Map([['hi', off('hi-gate', 'CG-GATE-HI')]])).changes).toEqual([]);
  });

  it('a first look at a chat is one record of what is off there; then one record per change, a burst as one', () => {
    const log = sink();
    const watch = createDecisionWatch(log, 'dock');
    watch.see('chatspace:1:2', new Map([['hi', off('hi-gate', 'CG-GATE-HI')], ['reply', AVAILABLE]]));
    watch.see('chatspace:1:2', new Map([['hi', off('hi-gate', 'CG-GATE-HI')], ['reply', AVAILABLE]]));
    watch.see('chatspace:1:2', null);
    watch.see('chatspace:1:2', new Map([['hi', AVAILABLE]]));
    watch.see('chatspace:1:3', new Map([['hi', AVAILABLE]]));
    const many = new Map(Array.from({ length: 12 }, (_, i) => [`f${i}`, off('feature-disabled')] as const));
    watch.see('chatspace:1:3', many);
    expect(log.lines.map((line) => line.msg)).toEqual(['state', 'available', 'state', 'changed']);
    expect(log.lines[0]?.fields).toMatchObject({ surface: 'dock', fanId: '2', offCount: 1, items: [{ feature: 'hi', why: 'hi-gate', code: 'CG-GATE-HI', say: 'hi-gate said' }] });
    expect(log.lines[1]?.fields).toMatchObject({ feature: 'hi', wasReason: 'hi-gate' });
    expect(log.lines[3]?.fields).toMatchObject({ changedCount: 12 });
  });
});

describe('the file of the last 24 hours reads every session', () => {
  it('records of the window across sessions, and the newest ones however old when the window is thin', async () => {
    const store = new MemoryLogStore();
    let now = Date.UTC(2026, 9, 21, 12);
    const scheduler = { now: () => now, after: () => () => undefined };
    const record = (ts: number, seq: number) => ({ ts: new Date(ts).toISOString(), seq, level: 'info' as const, scope: 'ui.action', msg: 'pressed' });
    const first = new LogService({ store, scheduler });
    await first.open(null);
    first.sink(record(now - 30 * 3_600_000, 1));
    first.sink(record(now - 20 * 3_600_000, 2));
    await first.flush();
    now += 1000;
    const second = new LogService({ store, scheduler });
    expect(await second.open(null)).toBe(2);
    second.sink(record(now - 1000, 3));
    await second.flush();
    const day = await second.window({ windowMs: 24 * 3_600_000, minRecords: 1, maxRecords: 100 });
    expect(day.records.map((r) => r.seq)).toEqual([2, 3]);
    expect(day.sessions).toEqual([1, 2]);
    const thin = await second.window({ windowMs: 24 * 3_600_000, minRecords: 3, maxRecords: 100 });
    expect(thin.records.map((r) => r.seq)).toEqual([1, 2, 3]);
  });
});

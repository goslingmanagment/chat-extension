// Who sent each message (decision X48; hub `clientSendAttributions`): every
// send of the person that the page's own response named is reported to the
// hub under their sign-in — a report of what happened, never a send. What
// the hub has not answered is owed and journaled; every answer is final.

import { SEND_ATTRIBUTION_LIMITS, SendAttributionsRequestSchema, type SendAttributionsRequest, type SendAttributionsResult } from '@cg/contracts';
import { REPORT_RETRY_DELAYS_MS } from '@cg/core/domain/send';
import { SEND_ATTRIBUTIONS_KEY, SEND_ATTRIBUTIONS_MAX, SEND_ATTRIBUTION_BATCH_MS, SEND_ATTRIBUTION_KEEP_MS, SendAttributionReporter, type SendAttributionInput } from '@cg/core/services';
import { describe, expect, it } from 'vitest';

import { FakeClock, LogRecorder, MemoryStore, settle } from './support/clock';
import { NOW_MS, WORLD } from './support/world';

const OWNER = `${WORLD.hubOrigin}|${WORLD.user.userId}`;
const OTHER = `${WORLD.hubOrigin}|9999`;
const PAGE = WORLD.pages.one.pageLabel;

let next = 7_001_000_000;
const send = (over: Partial<SendAttributionInput> = {}): SendAttributionInput => ({
  pageLabel: PAGE,
  source: 'chatspace-extension',
  platformMessageId: String(++next),
  fanRef: '74001001',
  observedAt: new Date(NOW_MS).toISOString(),
  priced: false,
  withMedia: false,
  ...over,
});

/** A hub that answers as told: `recorded` for each fact by default, or throws what the test gives. */
class ScriptedHub {
  readonly calls: SendAttributionsRequest[] = [];
  readonly answers: (((request: SendAttributionsRequest) => SendAttributionsResult) | Error)[] = [];

  sendAttributions(request: SendAttributionsRequest): Promise<SendAttributionsResult> {
    this.calls.push(request);
    const answer = this.answers.shift();
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer?.(request) ?? { pageLabel: request.pageLabel, results: request.facts.map((fact) => ({ platformMessageId: fact.platformMessageId, outcome: 'recorded' })), serverNow: new Date(NOW_MS).toISOString() });
  }
}

const httpError = (status: number): Error => Object.assign(new Error(`HTTP ${status}`), { name: 'HubCallError', failure: { kind: 'http', status, error: null, reason: null, retryAfterMs: null } });
const transportError = (): Error => Object.assign(new Error('offline'), { name: 'HubCallError', failure: { kind: 'transport', failure: 'network' } });
const checkError = (): Error => Object.assign(new Error('clientSendAttributions: capabilityMissing'), { name: 'HubCheckError', check: 'capabilityMissing' });

function world(owner: { now: string | null } = { now: OWNER }, shared?: { readonly store: MemoryStore; readonly hub: ScriptedHub; readonly clock: FakeClock }) {
  const clock = shared?.clock ?? new FakeClock(NOW_MS);
  const hub = shared?.hub ?? new ScriptedHub();
  const store = shared?.store ?? new MemoryStore();
  const log = new LogRecorder();
  const reporter = new SendAttributionReporter({ clock, hub, owner: () => owner.now, store, log });
  return { clock, hub, log, reporter, owner, store };
}
const owedIn = (store: MemoryStore): { platformMessageId: string; owner: string }[] => (store.data.get(SEND_ATTRIBUTIONS_KEY) as { owed?: { platformMessageId: string; owner: string }[] } | undefined)?.owed ?? [];

describe('the report', () => {
  it('a burst of sends is one request after a short quiet: ids, a time and two marks — the person is the token’s, and there is no text', async () => {
    const { clock, hub, reporter } = world();
    const ppv = send({ priced: true, withMedia: true });
    const text = send();
    expect(reporter.report(ppv)).toBe('queued');
    expect(reporter.report(text)).toBe('queued');
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS - 1);
    expect(hub.calls).toEqual([]);
    await clock.advance(1);
    await reporter.idle();
    expect(hub.calls).toEqual([
      {
        pageLabel: PAGE,
        source: 'chatspace-extension',
        facts: [
          { platformMessageId: ppv.platformMessageId, fanRef: ppv.fanRef, observedAt: ppv.observedAt, priced: true, withMedia: true },
          { platformMessageId: text.platformMessageId, fanRef: text.fanRef, observedAt: text.observedAt, priced: false, withMedia: false },
        ],
      },
    ]);
    expect(SendAttributionsRequestSchema.safeParse(hub.calls[0]).success).toBe(true);
    expect(JSON.stringify(hub.calls)).not.toMatch(/userId|owner|text"/);
    expect(reporter.pending).toBe(0);
  });

  it('a page and a client per request, at most the hub’s limit of facts in one', async () => {
    const { clock, hub, reporter } = world();
    for (let i = 0; i < SEND_ATTRIBUTION_LIMITS.maxFacts + 1; i += 1) reporter.report(send());
    reporter.report(send({ pageLabel: 'model-two' }));
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(hub.calls.map((call) => [call.pageLabel, call.facts.length])).toEqual([
      [PAGE, SEND_ATTRIBUTION_LIMITS.maxFacts],
      ['model-two', 1],
      [PAGE, 1],
    ]);
    expect(reporter.pending).toBe(0);
  });

  it('the same message of a page is one fact: reported twice, it is asked once; answered, it is never asked again', async () => {
    const { clock, hub, reporter } = world();
    const one = send();
    expect(reporter.report(one)).toBe('queued');
    expect(reporter.report(one)).toBe('known');
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(reporter.report(one)).toBe('known');
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(hub.calls.flatMap((call) => call.facts.map((fact) => fact.platformMessageId))).toEqual([one.platformMessageId]);
  });

  it('every answer of the hub is final, an outcome this build does not know too; a conflict is logged, never repeated', async () => {
    const { clock, hub, log, reporter } = world();
    hub.answers.push((request) => ({ pageLabel: request.pageLabel, results: [{ platformMessageId: request.facts[0]!.platformMessageId, outcome: 'conflict' }, { platformMessageId: request.facts[1]!.platformMessageId, outcome: 'superseded' }], serverNow: '' }));
    reporter.report(send());
    reporter.report(send());
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(hub.calls).toHaveLength(1);
    expect(reporter.pending).toBe(0);
    expect(log.entries.find((entry) => entry.msg === 'send attributions reported')).toMatchObject({ level: 'warn', fields: { facts: 2, conflict: 1, other: 1 } });
  });

  it('a fact the hub’s own schema would refuse is never taken: it would hold its whole group', () => {
    const { reporter, store } = world();
    expect(reporter.report(send({ observedAt: '2026-10-03T12:00:00.123456789Z' }))).toBe('invalid');
    expect(reporter.report(send({ platformMessageId: '0123' }))).toBe('invalid');
    expect(reporter.pending).toBe(0);
    expect(owedIn(store)).toEqual([]);
  });

  it('a clock that runs fast: the hub’s answer says its own time, the fact goes once more corrected, and every later time is corrected too', async () => {
    const { clock, hub, reporter } = world();
    const AHEAD = 10 * 60_000;
    const hubNow = (): string => new Date(clock.now() - AHEAD).toISOString();
    const at = (): string => new Date(clock.now()).toISOString();
    hub.answers.push((request) => ({ pageLabel: request.pageLabel, results: request.facts.map((fact) => ({ platformMessageId: fact.platformMessageId, outcome: 'out_of_range' })), serverNow: hubNow() }));
    hub.answers.push((request) => ({ pageLabel: request.pageLabel, results: request.facts.map((fact) => ({ platformMessageId: fact.platformMessageId, outcome: 'recorded' })), serverNow: hubNow() }));
    const one = send({ observedAt: at() });
    reporter.report(one);
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(hub.calls.map((call) => call.facts[0]?.observedAt)).toEqual([one.observedAt, new Date(Date.parse(one.observedAt) - AHEAD).toISOString()]);
    expect(reporter.pending).toBe(0);
    // Learned: the next send goes corrected the first time.
    hub.answers.push((request) => ({ pageLabel: request.pageLabel, results: request.facts.map((fact) => ({ platformMessageId: fact.platformMessageId, outcome: 'recorded' })), serverNow: hubNow() }));
    const two = send({ observedAt: at() });
    reporter.report(two);
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(hub.calls[2]?.facts[0]?.observedAt).toBe(new Date(Date.parse(two.observedAt) - AHEAD).toISOString());
  });

  it('a fact out of range by the hub’s clock is final: an old one, or one still ahead after its correction', async () => {
    const { clock, hub, reporter } = world();
    hub.answers.push((request) => ({ pageLabel: request.pageLabel, results: request.facts.map((fact) => ({ platformMessageId: fact.platformMessageId, outcome: 'out_of_range' })), serverNow: new Date(clock.now()).toISOString() }));
    reporter.report(send({ observedAt: new Date(NOW_MS - 40 * 86_400_000).toISOString() }));
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(hub.calls).toHaveLength(1);
    expect(reporter.pending).toBe(0);
  });

  it('nobody signed in: there is nobody whose send it could be', () => {
    const { reporter, store } = world({ now: null });
    expect(reporter.report(send())).toBe('signed-out');
    expect(reporter.pending).toBe(0);
    expect(owedIn(store)).toEqual([]);
  });
});

describe('what is owed', () => {
  it('is journaled before the hub is asked, ids only, and leaves the journal when the hub answers', async () => {
    const { clock, reporter, store } = world();
    const one = send({ priced: true });
    reporter.report(one);
    await settle();
    expect(owedIn(store)).toEqual([expect.objectContaining({ platformMessageId: one.platformMessageId, owner: OWNER, priced: true })]);
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(owedIn(store)).toEqual([]);
  });

  it('a failure the hub may not have heard is retried on the custody schedule; still no answer — it waits for the next word of the hub', async () => {
    const { clock, hub, reporter } = world();
    for (let i = 0; i <= REPORT_RETRY_DELAYS_MS.length; i += 1) hub.answers.push(i % 2 === 0 ? transportError() : httpError(503));
    reporter.report(send());
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS + REPORT_RETRY_DELAYS_MS.reduce((sum, delay) => sum + delay, 0));
    await reporter.idle();
    expect(hub.calls).toHaveLength(REPORT_RETRY_DELAYS_MS.length + 1);
    expect(reporter.pending).toBe(1);
    expect(reporter.resume()).toBe(1);
    await reporter.idle();
    expect(hub.calls).toHaveLength(REPORT_RETRY_DELAYS_MS.length + 2);
    expect(reporter.pending).toBe(0);
  });

  it('a refusal of the hub layer itself (a hub without send-attribution-v1 — a rollback) and a 401 keep it owed; another 4xx gives it up', async () => {
    const { clock, hub, log, reporter } = world();
    hub.answers.push(checkError());
    reporter.report(send());
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(reporter.pending).toBe(1);
    hub.answers.push(httpError(401));
    reporter.resume();
    await reporter.idle();
    expect(reporter.pending).toBe(1);
    hub.answers.push(httpError(409));
    reporter.resume();
    await reporter.idle();
    expect(reporter.pending).toBe(0);
    expect(hub.calls).toHaveLength(3);
    expect(log.entries.some((entry) => entry.msg === 'send attributions refused by the hub, given up' && entry.fields?.['status'] === 409)).toBe(true);
  });

  it('belongs to the person who sent: another person’s sign-in never reports it, the sender’s next sign-in does', async () => {
    const owner = { now: OWNER as string | null };
    const { clock, hub, reporter } = world(owner);
    reporter.report(send());
    owner.now = null;
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    owner.now = OTHER;
    expect(reporter.resume()).toBe(0);
    const theirs = send();
    reporter.report(theirs);
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(hub.calls.flatMap((call) => call.facts.map((fact) => fact.platformMessageId))).toEqual([theirs.platformMessageId]);
    expect(reporter.pending).toBe(1);
    owner.now = OWNER;
    expect(reporter.resume()).toBe(1);
    await reporter.idle();
    expect(hub.calls).toHaveLength(2);
    expect(reporter.pending).toBe(0);
  });

  it('a sign-out under the call: nothing was refused, the fact waits for its sender', async () => {
    const owner = { now: OWNER as string | null };
    const { clock, hub, reporter } = world(owner);
    hub.answers.push(Object.assign(transportError(), {}));
    reporter.report(send());
    const sendAttributions = hub.sendAttributions.bind(hub);
    hub.sendAttributions = (request) => {
      owner.now = null;
      return sendAttributions(request);
    };
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(hub.calls).toHaveLength(1);
    expect(reporter.pending).toBe(1);
  });

  it('the next instance of the event page delivers what the previous one owed; too old, foreign or broken entries go', async () => {
    const first = world();
    first.hub.answers.push(transportError());
    first.reporter.report(send());
    await settle();
    const stored = owedIn(first.store);
    expect(stored).toHaveLength(1);
    first.store.data.set(SEND_ATTRIBUTIONS_KEY, {
      v: 1,
      owed: [...stored, { ...stored[0], platformMessageId: '7009', at: NOW_MS - SEND_ATTRIBUTION_KEEP_MS - 1 }, { broken: true }, { ...stored[0], platformMessageId: '7010', text: undefined, priced: 'yes' }],
    });
    const hub = new ScriptedHub();
    const second = world({ now: OWNER }, { store: first.store, hub, clock: first.clock });
    expect(await second.reporter.restore()).toBe(1);
    await second.reporter.idle();
    expect(hub.calls.flatMap((call) => call.facts.map((fact) => fact.platformMessageId))).toEqual([stored[0]!.platformMessageId]);
    expect(owedIn(first.store)).toEqual([]);
  });

  it('is bounded: beyond the limit the oldest go', () => {
    const { reporter } = world();
    for (let i = 0; i < SEND_ATTRIBUTIONS_MAX + 5; i += 1) reporter.report(send());
    expect(reporter.pending).toBe(SEND_ATTRIBUTIONS_MAX);
  });

  it('a journal that cannot be read starts empty, one that cannot be written keeps the facts in memory', async () => {
    const { reporter, store, log, clock, hub } = world();
    store.failReads = true;
    expect(await reporter.restore()).toBe(0);
    store.failWrites = true;
    reporter.report(send());
    await settle();
    expect(log.entries.map((entry) => entry.code)).toEqual(expect.arrayContaining(['CG-STORAGE-READ', 'CG-STORAGE-WRITE']));
    await clock.advance(SEND_ATTRIBUTION_BATCH_MS);
    await reporter.idle();
    expect(hub.calls).toHaveLength(1);
  });
});

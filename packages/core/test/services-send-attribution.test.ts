// Who sent each message (decision X48; hub `clientSendAttributions`): every
// send of the person that the page's own response named is reported to the
// hub under their sign-in — a report of what happened, never a send. What
// the hub has not answered is owed and journaled; every answer is final.

import { SendAttributionsRequestSchema, type SendAttributionsRequest, type SendAttributionsResult } from '@cg/contracts';
import { SEND_ATTRIBUTIONS_KEY, SEND_ATTRIBUTION_BATCH_MS, SEND_ATTRIBUTION_KEEP_MS, SendAttributionReporter, type SendAttributionInput } from '@cg/core/services';
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

const transportError = (): Error => Object.assign(new Error('offline'), { name: 'HubCallError', failure: { kind: 'transport', failure: 'network' } });

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
});

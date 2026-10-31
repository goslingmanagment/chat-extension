// The OnlyFans feed's uploader (hub #953, `clientOnlyfansFeed`): every ChatSpace tab of the browser passes on what
// its page received, through one uploader. What it must get right is what reaches the hub once: the same thing seen
// by two tabs, or read twice, goes once; a changed one goes again; a lost answer is asked again, a refusal never.

import { type OnlyfansFeedRecord, type OnlyfansFeedRequest, type OnlyfansFeedResult } from '@cg/contracts';
import { ONLYFANS_FEED_BATCH_MS, ONLYFANS_FEED_RETRY_DELAYS_MS, OnlyfansFeedUploader, onlyfansFeedSeenKey } from '@cg/core/services';
import { describe, expect, it } from 'vitest';

import { FakeClock, LogRecorder, settle } from './support/clock';
import { NOW_MS, WORLD } from './support/world';

const OWNER = `${WORLD.hubOrigin}|${WORLD.user.userId}`;
const PAGE = WORLD.pages.one.pageLabel;
const at = new Date(NOW_MS).toISOString();

let next = 7_300_000_000;
const message = (over: Partial<Extract<OnlyfansFeedRecord, { kind: 'message' }>> = {}): OnlyfansFeedRecord => ({
  kind: 'message', messageRef: String(++next), fanRef: '74001001', fromFan: true, sentAt: at, observedAt: at, via: 'socket',
  textHtml: '<p>hey</p>', price: null, isFree: true, isOpened: null, isNew: true, isTip: false, tipText: null,
  mediaCount: 0, media: [], automatic: false, changedAt: null, fan: null,
  ...over,
});

class ScriptedHub {
  readonly calls: OnlyfansFeedRequest[] = [];
  readonly answers: Error[] = [];

  onlyfansFeed(request: OnlyfansFeedRequest): Promise<OnlyfansFeedResult> {
    this.calls.push(request);
    const failure = this.answers.shift();
    if (failure !== undefined) return Promise.reject(failure);
    return Promise.resolve({ pageLabel: request.pageLabel, taken: request.records.length, duplicates: 0, held: 0, outOfRange: 0, serverNow: at });
  }
}

const transportError = (): Error => Object.assign(new Error('offline'), { name: 'HubCallError', failure: { kind: 'transport', failure: 'network' } });
const refusal = (status: number): Error => Object.assign(new Error('refused'), { name: 'HubCallError', failure: { kind: 'http', status } });

function world(owner: { now: string | null } = { now: OWNER }) {
  const clock = new FakeClock(NOW_MS);
  const hub = new ScriptedHub();
  const uploader = new OnlyfansFeedUploader({ clock, hub, owner: () => owner.now, log: new LogRecorder() });
  const report = (records: OnlyfansFeedRecord[]) => uploader.report({ pageLabel: PAGE, hostAccountRef: 'onlymonster:36408', creatorRef: '433999001', records });
  return { clock, hub, uploader, report, owner };
}

describe('what reaches the hub once', () => {
  it('two tabs, or one history page read twice: the same message goes once, a changed one goes again', async () => {
    const { clock, hub, report } = world();
    const seen = message();
    expect(report([seen])).toEqual({ queued: 1, known: 0, invalid: 0 });
    // Another tab saw it, later and from the history: the same thing.
    expect(report([{ ...seen, observedAt: new Date(NOW_MS + 5000).toISOString(), via: 'history' } as OnlyfansFeedRecord])).toEqual({ queued: 0, known: 1, invalid: 0 });
    // The fan bought it: a new reading of the same message.
    expect(report([{ ...seen, isOpened: true } as OnlyfansFeedRecord])).toEqual({ queued: 1, known: 0, invalid: 0 });
    await clock.advance(ONLYFANS_FEED_BATCH_MS);
    await settle();
    expect(hub.calls).toHaveLength(1);
    expect(hub.calls[0]?.records.map((record) => (record.kind === 'message' ? record.isOpened : null))).toEqual([null, true]);
    expect(hub.calls[0]).toMatchObject({ pageLabel: PAGE, hostAccountRef: 'onlymonster:36408', creatorRef: '433999001' });
  });

  it('a record the hub would refuse is never sent', () => {
    const { report } = world();
    expect(report([message({ messageRef: 'not-an-id' })])).toEqual({ queued: 0, known: 0, invalid: 1 });
  });

  it('a lost answer is asked again with the same records; the hub dedups the repeat', async () => {
    const { clock, hub, report } = world();
    hub.answers.push(transportError());
    report([message()]);
    await clock.advance(ONLYFANS_FEED_BATCH_MS);
    await settle();
    expect(hub.calls).toHaveLength(1);
    await clock.advance(ONLYFANS_FEED_RETRY_DELAYS_MS[0] ?? 0);
    await settle();
    expect(hub.calls).toHaveLength(2);
    expect(hub.calls[1]?.records).toEqual(hub.calls[0]?.records);
  });

  it('a refusal is never asked again, and the next sighting of the same thing may carry it', async () => {
    const { clock, hub, report } = world();
    hub.answers.push(refusal(409));
    const seen = message();
    report([seen]);
    await clock.advance(ONLYFANS_FEED_BATCH_MS);
    await settle();
    await clock.advance(120_000);
    await settle();
    expect(hub.calls).toHaveLength(1);
    expect(report([seen])).toEqual({ queued: 1, known: 0, invalid: 0 });
  });

  it('records wait for nobody: signed out, nothing is taken; another person signed in drops what the one before had waiting', async () => {
    const owner = { now: null as string | null };
    const { clock, hub, report } = world(owner);
    expect(report([message()])).toBe('signed-out');
    owner.now = OWNER;
    report([message()]);
    owner.now = `${WORLD.hubOrigin}|9999`;
    await clock.advance(ONLYFANS_FEED_BATCH_MS);
    await settle();
    expect(hub.calls).toHaveLength(0);
  });

  it('a burst goes in requests of at most 200 records', async () => {
    const { clock, hub, report } = world();
    report(Array.from({ length: 450 }, () => message()));
    await clock.advance(ONLYFANS_FEED_BATCH_MS);
    await settle(10);
    expect(hub.calls.map((call) => call.records.length)).toEqual([200, 200, 50]);
  });

  it('money is keyed by OnlyFans ids, never by when it was seen', () => {
    const tip = { kind: 'tip', fanRef: '74001001', tipRef: '77', amountGross: 5, observedAt: at } as const;
    expect(onlyfansFeedSeenKey(tip)).toBe(onlyfansFeedSeenKey({ ...tip, observedAt: new Date(NOW_MS + 1).toISOString() }));
    expect(onlyfansFeedSeenKey(tip)).not.toBe(onlyfansFeedSeenKey({ ...tip, tipRef: '78' }));
  });
});

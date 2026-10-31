// «Онлайн» on OnlyFans from ChatSpace (2026-10-31, hub #952): what ChatSpace's own poll found online goes to the hub
// once per moment; the page's probe is asked of the hub at ChatSpace's own pace, run once when lent, and after an error
// or ChatSpace's own `timed_out` this tab waits 10, 20, then 40 minutes — it never hammers.

import type { OnlineProbeResult } from '@cg/contracts/hub';
import type { OnlinePresencePort, OnlineProbeRead } from '@cg/contracts/host';
import { describe, expect, it } from 'vitest';

import { createChatSpaceOnlineSource } from '../src/application/hosts/chatspace/online';

const PAGE = 13;
const CREATOR = '366000001';
const ACC = '36408';
const MINUTE = 60_000;
const START = Date.parse('2026-10-31T20:00:00.000Z');

function world(answers: OnlineProbeRead[]) {
  let now = START;
  const reports: { pageId: number; seen: readonly { fanRef: string; lastSeenAt: string }[] }[] = [];
  const lends: number[] = [];
  const probes: (readonly string[])[] = [];
  let memory: { fanRef: string; at: string }[] = [];
  let lent: OnlineProbeResult | null = null;
  const port: OnlinePresencePort = {
    seen: () => Promise.resolve({ ok: true, fans: memory }),
    probe: (_account, fans) => {
      probes.push(fans);
      return Promise.resolve(answers.shift() ?? { ok: false, reason: 'unavailable', status: null });
    },
  };
  const source = createChatSpaceOnlineSource({
    port,
    accounts: () => [{ host: 'chatspace', hostAccountId: ACC, platform: 'onlyfans', platformAccountId: CREATOR, username: null, displayName: null }],
    report: (pageId, seen) => {
      reports.push({ pageId, seen });
      return Promise.resolve(true);
    },
    lend: (pageId) => {
      lends.push(pageId);
      return Promise.resolve(lent);
    },
    clock: { now: () => now },
    random: () => 0,
    visible: () => true,
  });
  const tick = async (): Promise<void> => {
    await source.seen(PAGE, CREATOR);
    // The probe runs after the report and is not awaited by it.
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  };
  return {
    source,
    reports,
    lends,
    probes,
    tick,
    advance: (ms: number) => void (now += ms),
    remember: (fans: { fanRef: string; at: string }[]) => void (memory = fans),
    lend: (result: OnlineProbeResult | null) => void (lent = result),
    now: () => now,
  };
}

const granted = (now: number, fanRefs: string[]): OnlineProbeResult => ({ granted: true, fanRefs, nextAt: new Date(now + 5 * MINUTE).toISOString(), serverNow: new Date(now).toISOString() });

describe('«Онлайн» on OnlyFans from ChatSpace', () => {
  it('tells the hub each moment ChatSpace’s own poll found once, never again', async () => {
    const w = world([]);
    w.remember([{ fanRef: '74001001', at: new Date(START - MINUTE).toISOString() }]);
    await w.tick();
    await w.tick();
    expect(w.reports.map((report) => report.seen.map((fan) => fan.fanRef))).toEqual([['74001001']]);
    w.remember([{ fanRef: '74001001', at: new Date(START).toISOString() }]);
    await w.tick();
    expect(w.reports).toHaveLength(2);
  });

  it('asks for the probe at most every five minutes, and a switched-off page costs no probe', async () => {
    const w = world([]);
    w.lend(null);
    for (let i = 0; i < 5; i += 1) {
      await w.tick();
      w.advance(MINUTE);
    }
    expect(w.lends).toHaveLength(1);
    expect(w.probes).toEqual([]);
    w.advance(MINUTE);
    await w.tick();
    expect(w.lends).toHaveLength(2);
  });

  it('a lent probe asks ChatSpace once and reports who is online, the most paid first', async () => {
    const w = world([{ ok: true, online: ['74001003', '74001001'], timedOut: false, at: new Date(START).toISOString() }]);
    w.lend(granted(START, ['74001001', '74001002', '74001003']));
    await w.tick();
    expect(w.probes).toEqual([['74001001', '74001002', '74001003']]);
    expect(w.reports.at(-1)?.seen.map((fan) => fan.fanRef)).toEqual(['74001001', '74001003']);
    expect(w.source.probe.trouble(PAGE)).toBeNull();
  });

  it('an error or ChatSpace’s own timed_out reports nothing and backs off 10, 20, then 40 minutes, saying so', async () => {
    const w = world([
      { ok: false, reason: 'http', status: 503 },
      { ok: true, online: ['74001001'], timedOut: true, at: new Date(START).toISOString() },
      { ok: false, reason: 'timeout', status: null },
    ]);
    w.lend(granted(START, ['74001001']));
    await w.tick();
    expect(w.source.probe.trouble(PAGE)).toEqual({ kind: 'error', retryAt: START + 10 * MINUTE });
    w.advance(9 * MINUTE);
    await w.tick();
    expect(w.probes).toHaveLength(1);
    w.advance(MINUTE);
    await w.tick();
    expect(w.probes).toHaveLength(2);
    expect(w.reports).toEqual([]);
    expect(w.source.probe.trouble(PAGE)).toEqual({ kind: 'timeout', retryAt: w.now() + 20 * MINUTE });
    w.advance(20 * MINUTE);
    await w.tick();
    expect(w.probes).toHaveLength(3);
    expect(w.source.probe.trouble(PAGE)?.retryAt).toBe(w.now() + 40 * MINUTE);
  });

  it('a probe that asked nothing (the page off screen) is skipped, not a trouble of ChatSpace’s', async () => {
    const w = world([{ ok: false, reason: 'hidden', status: null }]);
    w.lend(granted(START, ['74001001']));
    await w.tick();
    expect(w.source.probe.trouble(PAGE)).toBeNull();
    expect(w.reports).toEqual([]);
  });
});

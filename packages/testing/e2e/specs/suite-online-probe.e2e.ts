// «Онлайн» on OnlyFans from ChatSpace (2026-10-31, hub #952), its account on the wire. The TEST build on the
// ChatSpace-like stand against the fake hub, with the owner's `onlineProbe` on for the page. What it proves end to end:
// - the tab's one request of its own to ChatSpace's API is the page's probe: one `POST …/platforms/onlyfans/fans-online`
//   with the page's bearer, of at most 400 of the page's spenders, however often the list is read — the hub lends it
//   at most every five minutes, and the tab asks no sooner;
// - the online spenders it found reach the hub;
// - nothing else of ours, and nothing foreign, talks to the stand.
// The other suites keep the switch off, as the hub does until the owner sets it (the pilot world): their tab asks
// ChatSpace's API nothing at all.

import { expect } from '@wdio/globals';

import { PAGE } from '../../src/scenarios/hub';
import { useFakeHub } from '../support/fake-hub';
import { useNetworkTrap } from '../support/network-trap';
import { pressOurs, pressOursNow } from '../support/ours';
import { startShift } from '../support/shift';
import { foreignCalls, ourCalls, STAND_IDS, standServer } from '../support/stand';
import { STAND_SPENDERS } from '../support/world';

const ACC = STAND_IDS.accounts.a;
/** Who ChatSpace's presence endpoint answers as online: three spenders of account a. */
const ONLINE = [STAND_IDS.fans.a2, STAND_IDS.fans.a5, STAND_IDS.fans.a7];
const PROBE = /\/api\/v0\/accounts\/\d+\/platforms\/onlyfans\/fans-online$/;
/** One `fans-online` read of ChatSpace's own size (contracts ONLINE_SOURCE_LIMITS.probeMax). */
const PROBE_MAX = 400;

describe('«Онлайн» on OnlyFans — the page’s probe of ChatSpace keeps its pace and its bounds', () => {
  useNetworkTrap();
  const { hub } = useFakeHub();
  let journalStart = 0;

  before(async () => {
    await standServer.reset();
    journalStart = await standServer.mark();
    // OnlyFansAPI's feed is gone: the hub knows only what the tabs report; the owner's switch of the page's probe is on.
    await hub().command({ op: 'config', patch: { onlineStand: false, pageFlags: { [PAGE]: { onlineProbe: true } } } });
    await standServer.presence(ACC, ONLINE);
    await startShift(hub());
  });

  it('one probe however often the list is read, of the page’s spenders; its online fans reach the hub; nothing else of ours', async () => {
    const lent = async (): Promise<number> => (await hub().status()).online.probes.length;
    const reported = async (): Promise<readonly string[]> => (await hub().status()).online.presence.flatMap((report) => report.seen.map((fan) => fan.fanRef));
    // The window's list is read on open (the bar's count has read it already), and again on each «Обновить».
    await pressOurs('dock', '.cg-strip button', /Онлайн/);
    await browser.waitUntil(async () => (await lent()) > 0, { timeout: 30_000, interval: 300, timeoutMsg: 'the page’s probe was never lent' });
    await browser.waitUntil(async () => {
      const fans = await reported();
      return ONLINE.every((fan) => fans.includes(fan));
    }, {
      timeout: 30_000,
      interval: 300,
      timeoutMsg: 'the probe’s online fans did not reach the hub',
    });
    for (let read = 0; read < 3; read += 1) {
      expect(await pressOursNow('modal', '.cg-nw__refresh')).toBe(true);
      await browser.pause(800);
    }
    await browser.pause(1_500);

    const entries = (await standServer.journal(journalStart)).entries;
    // One probe, however often the list was read; of the page's spenders alone, at most ChatSpace's own batch.
    const probes = ourCalls(entries).filter((entry) => entry.method === 'POST' && PROBE.test(entry.path ?? ''));
    expect(probes).toHaveLength(1);
    const asked = (probes[0]?.detail?.['asked'] as readonly string[] | undefined) ?? [];
    const spenders = STAND_SPENDERS.filter((seed) => (seed.lifetimeUsd ?? 0) > 0).map((seed) => seed.fanRef);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.length).toBeLessThanOrEqual(PROBE_MAX);
    expect(asked.filter((fan) => !spenders.includes(fan))).toEqual([]);
    // Nothing else of ours (the probe's preflight is its own), and nothing foreign.
    expect(ourCalls(entries).filter((entry) => !PROBE.test(entry.path ?? ''))).toEqual([]);
    expect(foreignCalls(entries)).toEqual([]);
    // The hub lent the probe once; every online fan it asked about was reported.
    expect(await lent()).toBe(1);
    const told = await reported();
    expect(ONLINE.filter((fan) => asked.includes(fan) && !told.includes(fan))).toEqual([]);
  });
});

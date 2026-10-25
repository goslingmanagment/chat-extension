import type { CgErrorWire } from '@cg/contracts/errors';
import { FEATURES_COMMON } from '@cg/contracts/features/common';
import { FANSLY_FEATURES } from '@cg/contracts/features/fansly';
import type { OnlinePresenceRequest } from '@cg/contracts/hub';
import { featureSlice } from '@cg/core/domain/features';
import { FanslyApiError, type FanslyCall, type FanslyClient } from '@cg/fansly-api';
import { describe, expect, it, vi } from 'vitest';

import { createOnlineSeen, onlineQuery, ONLINE_SEEN } from '../bg/fansly/online';
import type { BackgroundKit, HostSiteSender } from '../src/composition/background/host-module';

const CREATOR = '700000000000000017';
const PAGE_ID = 13;
const PAGE_LABEL = 'model-two-fansly';
const FANS = { a: '920000000000000003', b: '920000000000000032', c: '930000000000000007', d: '930000000000000038', e: '930000000000000069' } as const;
const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 26, 10);
const sender: HostSiteSender = { kind: 'tab', host: 'fansly-web', tabId: 1, tabSessionId: 'tab', url: 'https://fansly.com/messages' };
const request = { pageId: PAGE_ID, hostAccountId: CREATOR };
const SLICE = featureSlice(FEATURES_COMMON, FANSLY_FEATURES);

/** A `followersnew` page: the follow entries and, beside them, the accounts (each with its own moment, or none). */
function page(entries: ReadonlyArray<{ readonly fan: string; readonly entrySeen?: number }>, accounts: ReadonlyArray<{ readonly fan: string; readonly seen?: number }> = []): unknown {
  return {
    followers: entries.map((entry, index) => ({ id: String(800000000000000000n + BigInt(index)), followerId: entry.fan, ...(entry.entrySeen === undefined ? {} : { lastSeenAt: entry.entrySeen }) })),
    aggregationData: { accounts: accounts.map((account) => ({ id: account.fan, username: `fan_${account.fan.slice(-2)}`, ...(account.seen === undefined ? {} : { lastSeenAt: account.seen }) })) },
  };
}

function world() {
  let now = T0;
  let features: Record<string, { available: boolean; reason?: string }> = { preview: { available: true } };
  let capabilities: string[] = ['online-v1'];
  const reports: OnlinePresenceRequest[] = [];
  const onlinePresence = vi.fn((report: OnlinePresenceRequest) => {
    reports.push(report);
    return Promise.resolve({ recorded: report.seen.length - 1, skipped: 1, serverNow: new Date(now).toISOString() });
  });
  const kit = {
    hub: {
      page: (pageId: number) => Promise.resolve(pageId === PAGE_ID ? { ok: true, page: { pageId, pageLabel: PAGE_LABEL, platform: 'fansly' } } : { ok: false, code: 'CG-BINDING-NOT-GRANTED' }),
      bootstrap: () => ({ capabilities, pages: [{ pageId: PAGE_ID, pageLabel: PAGE_LABEL, platform: 'fansly', platformAccountId: CREATOR, features }] }),
      facade: { onlinePresence },
      errorWire: (error: unknown): CgErrorWire => (error as { wire?: CgErrorWire }).wire ?? { code: 'CG-HUB-UNKNOWN' },
    },
    clock: { now: () => now },
    networkSession: { aliases: () => [] },
    log: { service: vi.fn() },
  } as unknown as BackgroundKit;
  const answers: Array<unknown> = [];
  const call = vi.fn((_call: FanslyCall) => {
    const next = answers.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve({ response: next, status: 200 });
  });
  let client: Pick<FanslyClient, 'call'> | null = { call };
  const online = createOnlineSeen(kit, SLICE, () => Promise.resolve(client));
  return {
    online,
    call,
    answers,
    reports,
    onlinePresence,
    advance: (ms: number) => {
      now += ms;
    },
    set: (change: { readonly features?: typeof features; readonly capabilities?: string[]; readonly client?: null }) => {
      if (change.features !== undefined) features = change.features;
      if (change.capabilities !== undefined) capabilities = change.capabilities;
      if (change.client === null) client = null;
    },
  };
}

describe('[host:fansly] «Онлайн»: the followers Fansly saw active, reported to the hub (`fansly.online.seen`)', () => {
  it('one `followersnew?lastSeenAfter=` per creator a minute: a call within it is answered from the last read, one in flight is joined', async () => {
    const w = world();
    w.answers.push(page([{ fan: FANS.a }, { fan: FANS.b }], [{ fan: FANS.a, seen: T0 - MIN }, { fan: FANS.b, seen: T0 - 3 * MIN }]));
    const [first, joined] = await Promise.all([w.online.seen(request, sender), w.online.seen(request, { ...sender, tabSessionId: 'tab-2', tabId: 2 })]);
    expect(first).toEqual({ ok: true, seen: 2, recorded: 1 });
    expect(joined).toEqual(first);
    // FBuddy's own read: the head of the list, the followers seen in the last 15 minutes, epoch ms as a string.
    expect(w.call.mock.calls).toEqual([[{ purpose: 'online', route: 'followers.new', account: CREATOR, path: { account: CREATOR }, query: { before: '0', after: '0', limit: '100', offset: '0', search: '', lastSeenAfter: String(T0 - 15 * MIN) } }]]);
    expect(onlineQuery(T0 - ONLINE_SEEN.windowMs)).toEqual(w.call.mock.calls[0]?.[0].query);
    w.advance(59_000);
    expect(await w.online.seen(request, sender)).toEqual(first);
    expect(w.call).toHaveBeenCalledTimes(1);
    expect(w.onlinePresence).toHaveBeenCalledTimes(1);
    w.advance(1_000);
    w.answers.push(page([]));
    expect(await w.online.seen(request, sender)).toEqual({ ok: true, seen: 0, recorded: 0 });
    expect(w.call).toHaveBeenCalledTimes(2);
    // Nobody seen: nothing to report.
    expect(w.onlinePresence).toHaveBeenCalledTimes(1);
  });

  it('a fan\'s moment is his account\'s, else the entry\'s; each fan once, the newest first; the creator, a wrong id, a stale or a future moment left out', async () => {
    const w = world();
    w.answers.push(
      page(
        [
          { fan: FANS.a, entrySeen: T0 - 14 * MIN },
          { fan: FANS.b, entrySeen: T0 - 2 * MIN },
          { fan: 'fan_12' },
          { fan: CREATOR, entrySeen: T0 - MIN },
          { fan: FANS.c, entrySeen: T0 + 10 * MIN },
          { fan: FANS.d, entrySeen: T0 - 20 * MIN },
          { fan: FANS.e, entrySeen: T0 + 30_000 },
          { fan: FANS.a, entrySeen: T0 - 9 * MIN },
        ],
        [{ fan: FANS.a, seen: T0 - MIN }, { fan: FANS.d }],
      ),
    );
    expect(await w.online.seen(request, sender)).toEqual({ ok: true, seen: 3, recorded: 2 });
    // Within the clocks' minute of skew a moment ahead is now; the account's moment wins over the entry's.
    expect(w.reports).toEqual([
      {
        pageLabel: PAGE_LABEL,
        seen: [
          { fanRef: FANS.e, lastSeenAt: new Date(T0).toISOString() },
          { fanRef: FANS.a, lastSeenAt: new Date(T0 - MIN).toISOString() },
          { fanRef: FANS.b, lastSeenAt: new Date(T0 - 2 * MIN).toISOString() },
        ],
      },
    ]);
  });

  it('a page that is not one is a failed read; it held the minute (the request left)', async () => {
    const w = world();
    w.answers.push({ followers: 'none' });
    expect(await w.online.seen(request, sender)).toEqual({ ok: false, error: { code: 'CG-FAN-REQUEST' } });
    expect(await w.online.seen(request, sender)).toEqual({ ok: false, error: { code: 'CG-FAN-REQUEST' } });
    expect(w.call).toHaveBeenCalledTimes(1);
    expect(w.onlinePresence).not.toHaveBeenCalled();
  });

  it('[FS-NET-3] a cooldown asks Fansly nothing and holds nothing; a failure that may have reached Fansly holds the minute; neither is asked again by itself', async () => {
    const w = world();
    w.answers.push(new FanslyApiError('cooling', { sent: false, retryAt: T0 + 90_000 }));
    expect(await w.online.seen(request, sender)).toEqual({ ok: false, error: { code: 'CG-FAN-RATE-LIMIT', retryAt: T0 + 90_000 } });
    w.answers.push(new FanslyApiError('http', { sent: true, httpStatus: 502 }));
    // Not a read: the next call asks (the pacer refuses it again at once while the creator still cools down).
    expect(await w.online.seen(request, sender)).toEqual({ ok: false, error: { code: 'CG-FAN-REQUEST', httpStatus: 502 } });
    expect(await w.online.seen(request, sender)).toEqual({ ok: false, error: { code: 'CG-FAN-REQUEST', httpStatus: 502 } });
    expect(w.call).toHaveBeenCalledTimes(2);
    expect(w.onlinePresence).not.toHaveBeenCalled();
  });

  it('the hub\'s refusal of a report is the answer: never sent again by itself, the next minute\'s read reports anew', async () => {
    const w = world();
    w.onlinePresence.mockImplementationOnce(() => Promise.reject(Object.assign(new Error('refused'), { wire: { code: 'CG-HUB-UNAVAILABLE' } })));
    w.answers.push(page([{ fan: FANS.a }], [{ fan: FANS.a, seen: T0 - MIN }]));
    expect(await w.online.seen(request, sender)).toEqual({ ok: false, error: { code: 'CG-HUB-UNAVAILABLE' } });
    w.advance(30_000);
    expect(await w.online.seen(request, sender)).toEqual({ ok: false, error: { code: 'CG-HUB-UNAVAILABLE' } });
    expect(w.onlinePresence).toHaveBeenCalledTimes(1);
    w.advance(30_000);
    w.answers.push(page([{ fan: FANS.a }], [{ fan: FANS.a, seen: T0 + 50_000 }]));
    expect(await w.online.seen(request, sender)).toEqual({ ok: true, seen: 1, recorded: 0 });
    expect(w.call).toHaveBeenCalledTimes(2);
    expect(w.onlinePresence).toHaveBeenCalledTimes(2);
  });

  it('only a tab of the creator\'s page where the window is admitted asks Fansly: the page\'s switch, the hub\'s `online-v1`, a session', async () => {
    const w = world();
    expect(await w.online.seen(request, { kind: 'page', page: 'options' } as unknown as HostSiteSender)).toEqual({ ok: false, error: { code: 'CG-CONTEXT-CHANGED' } });
    expect(await w.online.seen({ pageId: 99, hostAccountId: CREATOR }, sender)).toEqual({ ok: false, error: { code: 'CG-BINDING-NOT-GRANTED' } });
    expect(await w.online.seen({ pageId: PAGE_ID, hostAccountId: '700000000000000099' }, sender)).toEqual({ ok: false, error: { code: 'CG-BINDING-NOT-GRANTED' } });
    w.set({ features: { preview: { available: false, reason: 'flag_off' } } });
    expect(await w.online.seen(request, sender)).toEqual({ ok: false, error: { code: 'CG-FEATURE-DISABLED', detail: 'flag_off' } });
    w.set({ features: { preview: { available: true } }, capabilities: [] });
    expect(await w.online.seen(request, sender)).toEqual({ ok: false, error: { code: 'CG-HUB-CAPABILITY', detail: 'hub_not_ready' } });
    w.set({ capabilities: ['online-v1'], client: null });
    expect(await w.online.seen(request, sender)).toEqual({ ok: false, error: { code: 'CG-FAN-SESSION' } });
    expect(w.call).not.toHaveBeenCalled();
    expect(w.onlinePresence).not.toHaveBeenCalled();
  });
});

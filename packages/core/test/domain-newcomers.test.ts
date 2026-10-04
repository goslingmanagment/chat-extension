// core/domain/newcomers against the fake hub's scenario scripts
// (architecture.md §8.5, hub H-7): the fixed window of a cursor pass,
// greeting statuses, the lease and its renewals, polling and «news once»,
// the checks around a greeting, and local drafts.

import { describe, expect, it } from 'vitest';

import {
  AUDIENCE_LIMITS,
  AudienceNewPageSchema,
  GREETING_STATUSES,
  NEWCOMERS_WINDOW_HOURS,
  SEND_LIMITS,
  STORAGE_LIMITS,
  type AudienceNewItem,
  type AudienceNewPage,
  type ClaimState,
  type ClaimSummary,
} from '@cg/contracts';
import {
  DEFAULT_LEASE_POLICY,
  EMPTY_DRAFTS,
  FILTER_STATUSES,
  NO_SEEN_EVENTS,
  POLL_JITTER,
  POLL_MAX_BACKOFF_MS,
  POLL_OPEN_MS,
  POLL_RESUME_SPREAD_MS,
  POLL_SOUND_MS,
  RowLocks,
  SEEN_EVENTS_MAX,
  WINDOW_HOURS,
  appendAudiencePage,
  claimRefusal,
  clampWindow,
  draftKey,
  draftStale,
  findDraft,
  greetingOutputProblem,
  greetingStatus,
  hiBlock,
  inTab,
  keepOnlyUser,
  leaseNow,
  leaseOfClaim,
  leasePolicy,
  matchesSearch,
  newcomerRow,
  nextPollDelay,
  observeEvents,
  passesFilter,
  personalMessages,
  pollMode,
  progressOfClaim,
  putDraft,
  readDraftStore,
  removeDraft,
  mergeDraftStores,
  sameDraftStore,
  BUSY_MAX_MS,
  changedDraftKeys,
  keepOnly,
  resumeDelay,
  shouldRenew,
  startWalk,
  subscriptionCurrent,
  threadRevision,
  tooManyForHi,
  unprime,
  utf8Bytes,
  walkHasMore,
  walkIncomplete,
  windowLimit,
  windowOptions,
} from '@cg/core/domain/newcomers';
import { HTTP_SCENARIOS, NOW, SCENARIO_DATA } from '@cg/testing/hub';

const NOW_MS = Date.parse(NOW);
const at = (seconds: number): string => new Date(NOW_MS + seconds * 1000).toISOString();

const scenario = (name: string) => {
  const found = HTTP_SCENARIOS.find((s) => s.name === name);
  if (found === undefined) throw new Error(name);
  return found;
};
const audiencePages = scenario('audience-new')
  .exchanges.filter((exchange) => exchange.response.status === 200)
  .map((exchange) => exchange.response.body as AudienceNewPage);
const [pageOne, pageTwo] = audiencePages as [AudienceNewPage, AudienceNewPage];

const claimState = (name: string, index: number): ClaimState => scenario(name).exchanges[index]?.response.body as ClaimState;
const NONE: ClaimSummary = { greeting: 'none', lease: 'none', heldBy: null, custody: null };

describe('the constants repeated from the contracts stay equal to them', () => {
  it('the window bounds, the poll periods and the filter statuses are the contracts own', () => {
    expect(WINDOW_HOURS).toEqual(NEWCOMERS_WINDOW_HOURS);
    expect(WINDOW_HOURS.default).toBe(AUDIENCE_LIMITS.defaultWindowHours);
    expect(WINDOW_HOURS.quick).toEqual(AUDIENCE_LIMITS.quickWindowsHours);
    expect(WINDOW_HOURS.max).toBe(AUDIENCE_LIMITS.maxWindowHours);
    expect(POLL_OPEN_MS).toBe(AUDIENCE_LIMITS.pollOpenMs);
    expect(POLL_SOUND_MS).toBe(AUDIENCE_LIMITS.pollSoundMs);
    expect(Object.keys(FILTER_STATUSES.any).length).toBe(GREETING_STATUSES.length);
  });
});

describe('[NF-003] the window: 48 hours by default, the quick four, any 1–720 inside the hub limit', () => {
  it('clamps to whole hours inside 1…limit and offers only the quick windows that fit', () => {
    expect(WINDOW_HOURS.default).toBe(48);
    expect(windowLimit(720)).toBe(720);
    expect(windowLimit(100_000)).toBe(720);
    expect(windowLimit(null)).toBe(720);
    expect(windowLimit(96)).toBe(96);
    expect(clampWindow(48, 720)).toBe(48);
    expect(clampWindow(0, 720)).toBe(1);
    expect(clampWindow(5000, 720)).toBe(720);
    expect(clampWindow(72.4, 720)).toBe(72);
    expect(clampWindow(168, 96)).toBe(96);
    expect(clampWindow(Number.NaN, 24)).toBe(24);
    expect(windowOptions(720)).toEqual([24, 48, 72, 168]);
    expect(windowOptions(96)).toEqual([24, 48, 72]);
  });
});

describe('[NF-004] [NF-006] [NF-025] a cursor pass keeps one window', () => {
  it('appends the scenario pages in cursor order: five rows over two pages, then nothing more', () => {
    expect(audiencePages.every((page) => AudienceNewPageSchema.safeParse(page).success)).toBe(true);
    let walk = startWalk(48);
    const first = appendAudiencePage(walk, null, pageOne);
    if (first.kind !== 'appended') throw new Error('first page');
    walk = first.walk;
    expect(walk.items).toHaveLength(3);
    expect(walk).toMatchObject({ pages: 1, nextCursor: 'aud-2', started: true, snapshotAt: NOW, coverage: 'partial', unknownCount: 1 });
    expect(walkHasMore(walk)).toBe(true);
    const second = appendAudiencePage(walk, 'aud-2', pageTwo);
    if (second.kind !== 'appended') throw new Error('second page');
    walk = second.walk;
    expect(walk.items.map((item) => item.fanRef)).toEqual(['2010', '2011', '2012', '2013', '2014']);
    expect(walkHasMore(walk)).toBe(false);
    expect(walk.reasons).toEqual(['audience_sweep_pending']);
  });

  it('[NF-003] a page of another window is never appended: the window is fixed for the whole pass', () => {
    const walk = startWalk(72);
    expect(appendAudiencePage(walk, null, pageOne)).toEqual({ kind: 'ignored', reason: 'window' });
    const started = appendAudiencePage(startWalk(48), null, pageOne);
    if (started.kind !== 'appended') throw new Error('first page');
    expect(appendAudiencePage(started.walk, 'aud-2', { ...pageTwo, window: { ...pageTwo.window, hours: 72 } })).toEqual({ kind: 'ignored', reason: 'window' });
  });

  it('a late page of an older pass (another cursor) changes nothing; a fan is listed once', () => {
    const started = appendAudiencePage(startWalk(48), null, pageOne);
    if (started.kind !== 'appended') throw new Error('first page');
    expect(appendAudiencePage(started.walk, 'aud-9', pageTwo)).toEqual({ kind: 'ignored', reason: 'cursor' });
    expect(appendAudiencePage(started.walk, null, pageOne)).toEqual({ kind: 'ignored', reason: 'cursor' });
    expect(appendAudiencePage(startWalk(48), 'aud-2', pageTwo)).toEqual({ kind: 'ignored', reason: 'cursor' });
    const again = appendAudiencePage(started.walk, 'aud-2', { ...pageTwo, items: [...pageOne.items, ...pageTwo.items] });
    if (again.kind !== 'appended') throw new Error('second page');
    expect(again.walk.items).toHaveLength(5);
  });

  it('[NF-025] «результат неполный»: a coverage that is not complete, left-out events, or the visible cut', () => {
    const partial = appendAudiencePage(startWalk(48), null, pageOne);
    if (partial.kind !== 'appended') throw new Error('first page');
    expect(walkIncomplete(partial.walk)).toBe(true);
    const complete = appendAudiencePage(startWalk(48), null, { ...pageOne, coverage: { ...pageOne.coverage, state: 'complete', reasons: [] }, unknownCount: 0, nextCursor: null });
    if (complete.kind !== 'appended') throw new Error('complete page');
    expect(walkIncomplete(complete.walk)).toBe(false);
    expect(walkIncomplete(startWalk(48))).toBe(false);
    // More rows than the visible limit: cut, with the rest behind the cursor.
    const many: AudienceNewItem[] = Array.from({ length: STORAGE_LIMITS.listVisibleRows + 5 }, (_, i) => SCENARIO_DATA.audienceItem(i));
    const cut = appendAudiencePage(startWalk(48), null, { ...pageOne, coverage: { ...pageOne.coverage, state: 'complete' }, unknownCount: 0, items: many, nextCursor: 'more' });
    if (cut.kind !== 'appended') throw new Error('cut page');
    expect(cut.walk.items).toHaveLength(STORAGE_LIMITS.listVisibleRows);
    expect(cut.walk).toMatchObject({ truncated: true, nextCursor: null });
    expect(walkIncomplete(cut.walk)).toBe(true);
  });
});

describe('[NF-005] [NF-007] rows and greeting statuses', () => {
  const rows = [...pageOne.items, ...pageTwo.items].map(newcomerRow);

  it('[NF-007] a row names the fan (the handle when there is no name), the kind, and when they subscribed', () => {
    expect(rows[0]).toMatchObject({ fanRef: '2010', name: 'newfan_0', username: 'newfan_0', kind: 'new', trial: false, eventRef: 'evt-1000' });
    expect(rows[1]).toMatchObject({ kind: 'new', trial: true });
    expect(rows[2]).toMatchObject({ kind: 'returning' });
    expect(newcomerRow({ ...pageOne.items[0]!, kind: 'something-new' }).kind).toBe('new');
    expect(newcomerRow({ ...pageOne.items[0]!, displayName: 'Tomasz', username: '@tomasz_k' })).toMatchObject({ name: 'Tomasz', username: 'tomasz_k' });
    expect(newcomerRow({ ...pageOne.items[0]!, displayName: null, username: null }).name).toBe('2010');
  });

  it('the subscription is «active» only when the hub says so plainly; a disagreement is unknown', () => {
    const status = pageOne.items[0]!.status;
    expect(newcomerRow(pageOne.items[0]!).subscription).toEqual({ state: 'active', asOf: status.asOf, endsAt: status.endsAt });
    expect(newcomerRow({ ...pageOne.items[0]!, status: { ...status, isSubscriber: false, subscriptionStatus: 'expired' } }).subscription.state).toBe('expired');
    expect(newcomerRow({ ...pageOne.items[0]!, status: { ...status, isSubscriber: true, subscriptionStatus: 'expired' } }).subscription.state).toBe('unknown');
    expect(newcomerRow({ ...pageOne.items[0]!, status: { ...status, isSubscriber: null, subscriptionStatus: 'unknown' } }).subscription.state).toBe('unknown');
    expect(newcomerRow({ ...pageOne.items[0]!, status: { ...status, isSubscriber: null, subscriptionStatus: 'active' } }).subscription.state).toBe('active');
  });

  it('[X8-09] «Новые» confirms a subscription only by an explicit current status WITH its data time: no time, or an end that passed, refuses (§6.7.4 condition 9)', () => {
    const active = { state: 'active', asOf: at(-60), endsAt: at(86_400) } as const;
    expect(subscriptionCurrent(active, NOW_MS)).toBe(true);
    expect(subscriptionCurrent({ ...active, endsAt: null }, NOW_MS)).toBe(true);
    // «Active» with no data time is a status nobody dated: unknown, not a confirmation.
    expect(subscriptionCurrent({ ...active, asOf: null }, NOW_MS)).toBe(false);
    expect(subscriptionCurrent({ ...active, asOf: 'not a time' }, NOW_MS)).toBe(false);
    // The end the hub itself named has passed: the status is stale, whatever its word says.
    expect(subscriptionCurrent({ ...active, endsAt: at(-1) }, NOW_MS)).toBe(false);
    expect(subscriptionCurrent({ ...active, endsAt: at(1) }, NOW_MS)).toBe(true);
    expect(subscriptionCurrent({ ...active, endsAt: 'soon' }, NOW_MS)).toBe(false);
    expect(subscriptionCurrent({ ...active, state: 'expired' }, NOW_MS)).toBe(false);
    expect(subscriptionCurrent({ ...active, state: 'unknown' }, NOW_MS)).toBe(false);
  });

  it('[NF-005] statuses from the hub summary: nobody yet, a colleague, greeted (the desktop outbox included)', () => {
    expect(rows.map((row) => greetingStatus(row.claim).s)).toEqual(['none', 'none', 'none', 'claim-other', 'greeted']);
    expect(greetingStatus({ ...NONE, lease: 'owned' })).toEqual({ s: 'claim-mine' });
    expect(greetingStatus({ ...NONE, lease: 'held', heldBy: 'you-elsewhere' })).toEqual({ s: 'claim-elsewhere' });
    expect(greetingStatus({ ...NONE, lease: 'expired' })).toEqual({ s: 'none' });
    expect(greetingStatus({ ...NONE, lease: 'released' })).toEqual({ s: 'none' });
    // A greeting the desktop confirmed is the same fact.
    expect(greetingStatus({ ...NONE, greeting: 'confirmed' }, undefined, at(-60))).toEqual({ s: 'greeted', at: at(-60) });
    // Somebody's send on its way or unresolved holds the fan as their lease does.
    expect(greetingStatus({ ...NONE, custody: 'uncertain-held' })).toEqual({ s: 'claim-other' });
    expect(greetingStatus({ ...NONE, custody: 'dispatching' })).toEqual({ s: 'claim-other' });
    expect(greetingStatus({ ...NONE, custody: 'failed' })).toEqual({ s: 'none' });
  });

  it('[NF-005] what this tab knows wins: parts on their way, a stop at an unknown outcome, every part confirmed', () => {
    const local = (progress: { sent: number; total: number; uncertainPart: number | null; inFlight: boolean; sentAt: string | null }) => ({ leaseMine: true, heldBy: null, progress });
    expect(greetingStatus(NONE, local({ sent: 0, total: 3, uncertainPart: null, inFlight: false, sentAt: null }))).toEqual({ s: 'claim-mine' });
    expect(greetingStatus(NONE, local({ sent: 0, total: 3, uncertainPart: null, inFlight: true, sentAt: null }))).toEqual({ s: 'sending', sent: 0, total: 3 });
    expect(greetingStatus({ ...NONE, greeting: 'confirmed' }, local({ sent: 1, total: 3, uncertainPart: null, inFlight: false, sentAt: at(5) }))).toEqual({ s: 'sending', sent: 1, total: 3 });
    expect(greetingStatus({ ...NONE, greeting: 'confirmed' }, local({ sent: 1, total: 3, uncertainPart: 1, inFlight: false, sentAt: at(5) }))).toEqual({ s: 'stopped', sent: 1, total: 3, part: 2 });
    expect(greetingStatus({ ...NONE, greeting: 'confirmed' }, local({ sent: 3, total: 3, uncertainPart: null, inFlight: false, sentAt: at(5) }))).toEqual({ s: 'greeted', at: at(5) });
    expect(greetingStatus({ ...NONE, lease: 'owned' }, { leaseMine: false, heldBy: 'someone-else', progress: null })).toEqual({ s: 'claim-other' });
  });

  it('the hub group of a claim answer gives the part numbers', () => {
    expect(progressOfClaim(null)).toBeNull();
    expect(progressOfClaim(claimState('claim-greeting-two-parts', 4))).toEqual({ sent: 1, total: 2, uncertainPart: null, inFlight: false, sentAt: at(5) });
    expect(progressOfClaim(claimState('claim-greeting-two-parts', 5))).toMatchObject({ sent: 1, total: 2, inFlight: true });
    expect(progressOfClaim(claimState('claim-uncertain-held', 2))).toMatchObject({ sent: 0, total: 2, uncertainPart: 0 });
  });

  it('[NF-006] tabs, filters and the search', () => {
    const statuses = rows.map((row) => greetingStatus(row.claim));
    expect(statuses.filter((status) => inTab(status, 'todo'))).toHaveLength(4);
    expect(statuses.filter((status) => inTab(status, 'all'))).toHaveLength(5);
    expect(statuses.filter((status) => passesFilter(status, 'claimed'))).toHaveLength(1);
    expect(statuses.filter((status) => passesFilter(status, 'greeted'))).toHaveLength(1);
    expect(statuses.filter((status) => passesFilter(status, 'none'))).toHaveLength(3);
    expect(statuses.every((status) => passesFilter(status, 'any'))).toBe(true);
    expect(rows.filter((row) => matchesSearch(row, 'NEWFAN_3')).map((row) => row.fanRef)).toEqual(['2013']);
    expect(rows.filter((row) => matchesSearch(row, '@newfan_1'))).toHaveLength(1);
    expect(rows.filter((row) => matchesSearch(row, '2012'))).toHaveLength(1);
    expect(rows.filter((row) => matchesSearch(row, '  '))).toHaveLength(5);
  });

  it('[NF-014] Hi is off for a fan a colleague leads, one this person leads elsewhere, a stopped or a greeted one', () => {
    expect(hiBlock({ s: 'none' })).toBeNull();
    expect(hiBlock({ s: 'claim-mine' })).toBeNull();
    // §6.7.9: after the first confirmed part another generation is a second greeting; while the first part is on its way Hi waits.
    expect(hiBlock({ s: 'sending', sent: 1, total: 3 })).toBe('greeted');
    expect(hiBlock({ s: 'sending', sent: 0, total: 3 })).toBe('sending');
    expect(hiBlock({ s: 'claim-other' })).toBe('claim-busy');
    expect(hiBlock({ s: 'claim-elsewhere' })).toBe('claim-elsewhere');
    expect(hiBlock({ s: 'stopped', sent: 1, total: 3, part: 2 })).toBe('uncertain');
    expect(hiBlock({ s: 'greeted', at: null })).toBe('greeted');
  });

  it('[NF-015] more than ten personal messages is a dialogue: only the fan messages and ours known to be typed count', () => {
    const fan = { sender: 'fan', automatic: null, deleted: false };
    const typed = { sender: 'model', automatic: false, deleted: false };
    const unknownOrigin = { sender: 'model', automatic: null, deleted: false };
    const automatic = { sender: 'model', automatic: true, deleted: false };
    expect(personalMessages([fan, typed, unknownOrigin, automatic, { ...fan, deleted: true }, { sender: 'system', automatic: null, deleted: false }])).toBe(2);
    expect(tooManyForHi(10)).toBe(false);
    expect(tooManyForHi(11)).toBe(true);
    expect(tooManyForHi(personalMessages(Array.from({ length: 30 }, () => unknownOrigin)))).toBe(false);
  });

  it('[NF-018] a draft written on another state of the thread is stale', () => {
    const row = newcomerRow(pageOne.items[0]!);
    const then = threadRevision(row);
    expect(draftStale(then, threadRevision(row))).toBe(false);
    const moved = newcomerRow({ ...pageOne.items[0]!, thread: { ...pageOne.items[0]!.thread!, storedMessageCount: 2, lastMessageAt: at(30) } });
    expect(draftStale(then, threadRevision(moved))).toBe(true);
    expect(draftStale(null, threadRevision(moved))).toBe(false);
    expect(threadRevision({ thread: null })).toBe('none');
  });
});

describe('[NF-021] [NF-023] the greeting lease', () => {
  const owned = claimState('claim-greeting-two-parts', 1);
  const renewed = claimState('claim-greeting-two-parts', 2);
  const held = claimState('claim-refusals', 1);

  it('[NF-021] the deadline comes from the hub clock, moved onto ours with a margin: 120 s, then 160 s after a renewal', () => {
    const lease = leaseOfClaim(owned, 1_000_000);
    expect(lease).toEqual({ s: 'mine', leaseToken: owned.lease.leaseToken, until: 1_000_000 + 120_000 - 1000 });
    expect(leaseOfClaim(renewed, 1_000_000)).toMatchObject({ s: 'mine', until: 1_000_000 + 160_000 - 1000 });
    // A client clock that is minutes off changes nothing: only the hub's own remaining time counts.
    expect(leaseOfClaim(owned, 5)).toMatchObject({ until: 5 + 119_000 });
  });

  it('[NF-021] a colleague lease has no countdown; mine in another tab is told apart; a passed deadline is expired whatever was last heard', () => {
    expect(leaseOfClaim(held, 0)).toEqual({ s: 'other' });
    expect(leaseOfClaim({ ...held, lease: { ...held.lease, heldBy: 'you-elsewhere' } }, 0)).toEqual({ s: 'elsewhere' });
    expect(leaseOfClaim({ ...owned, lease: { state: 'expired', leaseToken: null, expiresAt: at(-1), heldBy: null } }, 0)).toEqual({ s: 'expired' });
    expect(leaseOfClaim({ ...owned, lease: { state: 'released', leaseToken: null, expiresAt: null, heldBy: null } }, 0)).toEqual({ s: 'none' });
    const mine = leaseOfClaim(owned, 0);
    expect(leaseNow(mine, 118_999)).toBe(mine);
    expect(leaseNow(mine, 119_000)).toEqual({ s: 'expired' });
    expect(leaseNow({ s: 'other' }, 9e12)).toEqual({ s: 'other' });
  });

  it('[NF-021] the lease is renewed every 40 s only while the person works with the fan', () => {
    expect(DEFAULT_LEASE_POLICY).toEqual({ leaseMs: 120_000, renewMs: 40_000, activityMs: 120_000 });
    expect(leasePolicy(SCENARIO_DATA.limits)).toEqual(DEFAULT_LEASE_POLICY);
    expect(leasePolicy(null)).toEqual(DEFAULT_LEASE_POLICY);
    // A renewal period no shorter than the lease would let it lapse between renewals.
    expect(leasePolicy({ claimLeaseSec: 60, claimRenewSec: 90, claimActivityWindowSec: 120 }).renewMs).toBe(30_000);
    const mine = leaseOfClaim(owned, 0);
    const policy = DEFAULT_LEASE_POLICY;
    expect(shouldRenew(mine, { lastActivityAt: 0, busy: false }, 40_000, policy)).toBe(true);
    expect(shouldRenew(mine, { lastActivityAt: -100_000, busy: false }, 40_000, policy)).toBe(false);
    expect(shouldRenew(mine, { lastActivityAt: -100_000, busy: true }, 40_000, policy)).toBe(true);
    // «In flight» is not for ever: five minutes after the last sign of life a flag left behind renews nothing.
    expect(shouldRenew(mine, { lastActivityAt: 40_000 - BUSY_MAX_MS, busy: true }, 40_000, policy)).toBe(true);
    expect(shouldRenew(mine, { lastActivityAt: 40_000 - BUSY_MAX_MS - 1, busy: true }, 40_000, policy)).toBe(false);
    expect(BUSY_MAX_MS).toBeGreaterThan(policy.activityMs);
    expect(shouldRenew(mine, { lastActivityAt: 0, busy: true }, 119_000, policy)).toBe(false);
    expect(shouldRenew({ s: 'other' }, { lastActivityAt: 0, busy: true }, 1, policy)).toBe(false);
  });

  it('[NF-024] a refusal is read by its code', () => {
    expect(claimRefusal('CG-CLAIM-BUSY')).toBe('other');
    expect(claimRefusal('CG-CLAIM-EXPIRED')).toBe('expired');
    expect(claimRefusal('CG-SEND-UNCERTAIN')).toBe('held-uncertain');
    expect(claimRefusal('CG-CLAIM-ROW-CHANGED')).toBe('row-changed');
    expect(claimRefusal('CG-CLAIM-ROW-BUSY')).toBe('row-changed');
    expect(claimRefusal('CG-HUB-UNAVAILABLE')).toBe('error');
  });

  it('[NF-023] one action per fan at a time: the second is refused, not queued', () => {
    const locks = new RowLocks();
    expect(locks.acquire('2010')).toBe(true);
    expect(locks.acquire('2010')).toBe(false);
    expect(locks.acquire('2011')).toBe(true);
    locks.release('2010');
    expect(locks.has('2010')).toBe(false);
    expect(locks.acquire('2010')).toBe(true);
  });
});

describe('[NF-004] polling: 30 s open, 60 s for the sound, spread, paused offline', () => {
  it('the mode: the open window, else the sound while a working tab lives, else nothing', () => {
    expect(pollMode({ windowOpen: true, liveTab: false, soundOn: false })).toBe('open');
    expect(pollMode({ windowOpen: false, liveTab: true, soundOn: true })).toBe('sound');
    expect(pollMode({ windowOpen: false, liveTab: true, soundOn: false })).toBe('off');
    expect(pollMode({ windowOpen: false, liveTab: false, soundOn: true })).toBe('off');
  });

  it('30 s and 60 s with a ±10 % spread; never the 700 ms of the old scan', () => {
    const open = { mode: 'open' as const, online: true, failures: 0 };
    expect(nextPollDelay(open, 0.5)).toBe(POLL_OPEN_MS);
    expect(nextPollDelay(open, 0)).toBe(POLL_OPEN_MS * (1 - POLL_JITTER));
    expect(nextPollDelay(open, 0.999_999)).toBeLessThanOrEqual(POLL_OPEN_MS * (1 + POLL_JITTER));
    expect(nextPollDelay({ ...open, mode: 'sound' }, 0.5)).toBe(POLL_SOUND_MS);
    for (let i = 0; i <= 10; i += 1) expect(nextPollDelay(open, i / 10) ?? 0).toBeGreaterThanOrEqual(27_000);
  });

  it('no poll while offline or off; failures slow it down, up to five minutes; back online the first poll is spread out', () => {
    expect(nextPollDelay({ mode: 'open', online: false, failures: 0 }, 0.5)).toBeNull();
    expect(nextPollDelay({ mode: 'off', online: true, failures: 0 }, 0.5)).toBeNull();
    expect(nextPollDelay({ mode: 'open', online: true, failures: 1 }, 0.5)).toBe(60_000);
    expect(nextPollDelay({ mode: 'open', online: true, failures: 2 }, 0.5)).toBe(120_000);
    expect(nextPollDelay({ mode: 'open', online: true, failures: 30 }, 0.5)).toBe(POLL_MAX_BACKOFF_MS);
    expect(resumeDelay(0)).toBe(0);
    expect(resumeDelay(0.5)).toBe(POLL_RESUME_SPREAD_MS / 2);
  });

  it('the first snapshot and the one after a reconnect are silent; a subscription is news once, by its event id', () => {
    let seen = NO_SEEN_EVENTS;
    const first = observeEvents(seen, ['evt-1', 'evt-2']);
    expect(first.fresh).toEqual([]);
    seen = first.seen;
    const second = observeEvents(seen, ['evt-1', 'evt-2', 'evt-3']);
    expect(second.fresh).toEqual(['evt-3']);
    seen = second.seen;
    expect(observeEvents(seen, ['evt-3', 'evt-2']).fresh).toEqual([]);
    // A reconnect: what arrived meanwhile is not news, what comes after it is.
    seen = unprime(seen);
    const after = observeEvents(seen, ['evt-3', 'evt-4']);
    expect(after.fresh).toEqual([]);
    expect(observeEvents(after.seen, ['evt-4', 'evt-5']).fresh).toEqual(['evt-5']);
    expect(unprime(NO_SEEN_EVENTS)).toBe(NO_SEEN_EVENTS);
  });

  it('the memory of seen events is bounded', () => {
    const many = Array.from({ length: SEEN_EVENTS_MAX + 50 }, (_, i) => `evt-${i}`);
    const seen = observeEvents(NO_SEEN_EVENTS, many).seen;
    expect(seen.ids).toHaveLength(SEEN_EVENTS_MAX);
    expect(seen.ids.at(-1)).toBe(`evt-${SEEN_EVENTS_MAX + 49}`);
  });
});

describe('[NF-017] the output of a greeting', () => {
  it('empty, longer than a preview draft, or still carrying part markers is not a message to a fan', () => {
    expect(greetingOutputProblem(['Hi Tomasz!', 'So happy you are here'])).toBeNull();
    expect(greetingOutputProblem([])).toBe('CG-OUTPUT-UNUSABLE');
    expect(greetingOutputProblem(['Hi', '   '])).toBe('CG-OUTPUT-UNUSABLE');
    expect(greetingOutputProblem(['Hi [NEXT] there'])).toBe('CG-OUTPUT-UNUSABLE');
    expect(greetingOutputProblem(['[VARIANT] Hi'])).toBe('CG-OUTPUT-UNUSABLE');
    expect(greetingOutputProblem(['a'.repeat(SEND_LIMITS.previewDraftMaxChars)])).toBeNull();
    expect(greetingOutputProblem(['a'.repeat(3000), 'b'.repeat(2001)])).toBe('CG-OUTPUT-UNUSABLE');
  });
});

describe('[NF-012] [NEW-10] local drafts: 5000 characters, 24 hours, 100 drafts, one MiB', () => {
  const owner = { hubOrigin: 'https://hub.example.test', userId: 7, pageId: 11, list: 'newcomers' as const, fanRef: '2010' };
  const key = draftKey(owner);

  it('a draft is kept per hub, user, page, list and fan; an empty text removes it and still moves the revision', () => {
    expect(draftKey({ ...owner, list: 'spenders' })).not.toBe(key);
    expect(draftKey({ ...owner, userId: 8 })).not.toBe(key);
    let put = putDraft(EMPTY_DRAFTS, key, 'hello there', 1000, 'rev-1');
    expect(put.draft).toEqual({ key, text: 'hello there', revision: 1, threadRevision: 'rev-1', updatedAt: 1000 });
    put = putDraft(put.store, key, 'hello there!', 2000);
    expect(put.revision).toBe(2);
    expect(findDraft(put.store, key, 2000)?.text).toBe('hello there!');
    const cleared = putDraft(put.store, key, '   ', 3000);
    expect(cleared.draft).toBeNull();
    expect(cleared.revision).toBe(3);
    expect(findDraft(cleared.store, key, 3000)).toBeNull();
    expect(removeDraft(put.store, key, 2500).drafts).toEqual([]);
    expect(removeDraft(EMPTY_DRAFTS, key, 2500)).toBe(EMPTY_DRAFTS);
    // A removal leaves a mark without text, and the next draft continues its revision.
    expect(cleared.store.removed).toEqual([{ key, revision: 3, removedAt: 3000 }]);
    expect(JSON.stringify(cleared.store)).not.toContain('hello');
    expect(putDraft(cleared.store, key, 'again', 4000).revision).toBe(4);
  });

  it('[NEW-10] two tabs merge draft by draft: the newer entry of each draft stands, whichever tab merges, and a removal is not undone', () => {
    const other = draftKey({ ...owner, fanRef: '2011' });
    const a = putDraft(EMPTY_DRAFTS, key, 'from tab A', 1000).store;
    const b = putDraft(putDraft(EMPTY_DRAFTS, other, 'from tab B', 1100).store, key, 'older text', 900).store;
    const ab = mergeDraftStores(a, b, 2000);
    expect(sameDraftStore(ab, mergeDraftStores(b, a, 2000))).toBe(true);
    expect(findDraft(ab, key, 2000)?.text).toBe('from tab A');
    expect(findDraft(ab, other, 2000)?.text).toBe('from tab B');
    // Tab B clears its draft later: the mark beats the text tab A still holds.
    const cleared = putDraft(b, other, '', 1500).store;
    const merged = mergeDraftStores(ab, cleared, 2000);
    expect(findDraft(merged, other, 2000)).toBeNull();
    expect(changedDraftKeys(ab, merged)).toEqual([other]);
    // A tie keeps the text a person typed; marks expire with the drafts.
    const tie = mergeDraftStores(putDraft(EMPTY_DRAFTS, key, 'typed', 3000).store, { v: 1, drafts: [], removed: [{ key, revision: 1, removedAt: 3000 }] }, 3000);
    expect(findDraft(tie, key, 3000)?.text).toBe('typed');
    expect(readDraftStore(cleared, 1500 + STORAGE_LIMITS.previewDraftTtlMs).removed).toBeUndefined();
    // Reading drops a broken mark and lets the newer of a draft and its mark stand.
    const read = readDraftStore({ v: 1, drafts: [{ key, text: 'old', revision: 1, threadRevision: null, updatedAt: 10 }], removed: [{ key, revision: 2, removedAt: 20 }, { key: 5 }] }, 30);
    expect(read).toEqual({ v: 1, drafts: [], removed: [{ key, revision: 2, removedAt: 20 }] });
    expect(keepOnly(merged, () => false)).toEqual({ v: 1, drafts: [] });
  });

  it('longer than 5000 is cut at 5000; older than 24 hours is gone', () => {
    const long = putDraft(EMPTY_DRAFTS, key, 'x'.repeat(6000), 0);
    expect(long.draft?.text).toHaveLength(SEND_LIMITS.previewDraftMaxChars);
    expect(findDraft(long.store, key, STORAGE_LIMITS.previewDraftTtlMs - 1)).not.toBeNull();
    expect(findDraft(long.store, key, STORAGE_LIMITS.previewDraftTtlMs)).toBeNull();
    expect(readDraftStore(long.store, STORAGE_LIMITS.previewDraftTtlMs + 1).drafts).toEqual([]);
  });

  it('at most 100 drafts and one MiB: the oldest go first', () => {
    let store = EMPTY_DRAFTS;
    for (let i = 0; i < 120; i += 1) store = putDraft(store, draftKey({ ...owner, fanRef: String(3000 + i) }), `draft ${i}`, 1000 + i).store;
    expect(store.drafts).toHaveLength(STORAGE_LIMITS.previewDrafts);
    expect(store.drafts[0]?.text).toBe('draft 119');
    expect(store.drafts.some((draft) => draft.text === 'draft 19')).toBe(false);
    // «€» is three bytes: a hundred drafts of 5000 of them would be past one MiB, so fewer are kept.
    let heavy = EMPTY_DRAFTS;
    for (let i = 0; i < 300; i += 1) heavy = putDraft(heavy, draftKey({ ...owner, fanRef: String(4000 + i) }), '€'.repeat(5000), 1000 + i).store;
    const bytes = heavy.drafts.reduce((sum, draft) => sum + utf8Bytes(draft.text), 0);
    expect(bytes).toBeLessThanOrEqual(STORAGE_LIMITS.previewDraftsTotalBytes);
    expect(heavy.drafts.length).toBeLessThan(STORAGE_LIMITS.previewDrafts);
    expect(heavy.drafts[0]?.key).toBe(draftKey({ ...owner, fanRef: '4299' }));
    expect(utf8Bytes('aж€😀')).toBe(1 + 2 + 3 + 4);
  });

  it('whatever is stored is read without throwing: unknown shapes and broken entries are dropped', () => {
    expect(readDraftStore(undefined, 0)).toBe(EMPTY_DRAFTS);
    expect(readDraftStore('text', 0)).toBe(EMPTY_DRAFTS);
    expect(readDraftStore({ v: 2, drafts: [] }, 0)).toBe(EMPTY_DRAFTS);
    const good = { key, text: 'ok', revision: 1, threadRevision: null, updatedAt: 10 };
    const read = readDraftStore({ v: 1, drafts: [good, { key: 'x', text: 5 }, null, { ...good, key: 'long', text: 'y'.repeat(5001) }, { ...good }] }, 20);
    expect(read.drafts).toEqual([good]);
  });

  it('another user signs in: only their own drafts stay', () => {
    let store = putDraft(EMPTY_DRAFTS, key, 'mine', 1).store;
    store = putDraft(store, draftKey({ ...owner, userId: 8 }), 'theirs', 2).store;
    const kept = keepOnlyUser(store, owner.hubOrigin, 7);
    expect(kept.drafts.map((draft) => draft.text)).toEqual(['mine']);
    expect(keepOnlyUser(kept, owner.hubOrigin, 7)).toBe(kept);
    expect(keepOnlyUser(store, 'https://other.example.test', 7).drafts).toEqual([]);
  });
});

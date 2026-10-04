// core/domain/fanpanel (architecture.md D-29, §10.2 FanPanelVM): the fan
// panel's money by kind, the subscription to the page of the open chat and
// the churn risk from the hub's `spenderDetail`, with ChatSpace's own memory
// as decoration only and every unknown left unknown.

import { describe, expect, it } from 'vitest';

import { CHURN_RISK_BY_RETENTION, type Dossier, type HostFan, type SpenderDetail } from '@cg/contracts';
import { churnRisk, fanPanelModel, initials, spendByKind, subscriptionMonths, targetPage } from '@cg/core/domain/fanpanel';
import { NOW, SCENARIO_DATA } from '@cg/testing/hub';

const NOW_MS = Date.parse(NOW);
const at = (seconds: number): string => new Date(NOW_MS + seconds * 1000).toISOString();

describe('the constants repeated from the contracts stay equal to them', () => {
  it('the churn risk of a retention status is the contracts own', () => {
    for (const [retention, risk] of Object.entries(CHURN_RISK_BY_RETENTION)) {
      expect(churnRisk(null, retention as keyof typeof CHURN_RISK_BY_RETENTION)).toBe(risk);
    }
  });
});

const PAGE_ID = 11;
const pageOf = (over: Partial<SpenderDetail['pages'][number]> = {}): SpenderDetail['pages'][number] => ({
  pageId: PAGE_ID,
  pageLabel: 'model-one',
  modelSlug: 'model-one',
  modelName: 'Model One',
  inScope: true,
  grossAmountMills: 12_480_000,
  creatorNetAmountMills: 9_984_000,
  lastTransactionAt: at(-3600),
  isFollower: true,
  followerSince: '2024-03-14T10:00:00.000Z',
  isSubscriber: true,
  subscriberSince: '2025-04-03T10:00:00.000Z',
  subscriptionExpiresAt: at(86_400 * 20),
  autoRenew: true,
  autoRenewOffDetectedAt: null,
  ...over,
});

const detail = (over: Partial<SpenderDetail> = {}): SpenderDetail => ({
  scope: SCENARIO_DATA.scope,
  fan: { platform: 'onlyfans', platformUserId: '2002', username: 'hubert_pl', displayName: 'Hubert', createdAtExternal: null, pageAlias: null },
  period: SCENARIO_DATA.period,
  metrics: {
    window: {
      grossAmountMills: 320_000,
      creatorNetAmountMills: 256_000,
      postedGrossAmountMills: 320_000,
      pendingGrossAmountMills: 0,
      unknownGrossAmountMills: 0,
      postedCreatorNetAmountMills: 256_000,
      pendingCreatorNetAmountMills: 0,
      unknownCreatorNetAmountMills: 0,
      transactionCount: 4,
      lastTransactionAt: at(-3600),
    },
    lifetime: { scopeGrossAmountMills: 12_480_000, scopeCreatorNetAmountMills: 9_984_000, platformGrossAmountMills: 20_000_000, platformCreatorNetAmountMills: 16_000_000 },
    comparison: null,
  },
  typeBreakdown: [
    { canonicalType: 'message_purchase', grossAmountMills: 9_860_000, creatorNetAmountMills: 7_888_000, transactionCount: 120 },
    { canonicalType: 'tip', grossAmountMills: 2_000_000, creatorNetAmountMills: 1_600_000, transactionCount: 30 },
    { canonicalType: 'stream_tip', grossAmountMills: 140_000, creatorNetAmountMills: 112_000, transactionCount: 2 },
    { canonicalType: 'subscription', grossAmountMills: 480_000, creatorNetAmountMills: 384_000, transactionCount: 18 },
  ],
  pages: [pageOf({ pageId: 12, pageLabel: 'model-one-vip', isSubscriber: false, subscriberSince: null, autoRenew: null }), pageOf()],
  ...over,
});

const hostFan: HostFan = {
  chat: { host: 'chatspace', hostAccountId: '1001', platformFanId: '2002' },
  username: 'hubert_pl',
  displayName: 'Hubert',
  isBlocked: false,
  canReceiveMessages: true,
  isRestricted: null,
  isOnline: false,
  lastSeenAt: at(-360),
  buyingPowerLabel: 'High',
  insights: [{ label: 'Tips', value: '8/10' }],
  bio: 'Works shifts, writes in the evening.',
  lists: ['VIP', 'Whales'],
};

describe('[CS-031] [CS-033] [CS-034] the fan panel', () => {
  it('[CS-034] the subscription is the target page element only, never another page of the agency', () => {
    expect(targetPage(detail(), PAGE_ID)?.pageLabel).toBe('model-one');
    expect(targetPage(detail(), 99)).toBeNull();
    expect(targetPage(null, PAGE_ID)).toBeNull();
    const model = fanPanelModel({ fanRef: '2002', pageId: 12, lifetime: detail(), last30: detail(), hostFan: null, row: null, now: NOW_MS });
    expect(model.subscription).toMatchObject({ months: null, since: null, autoRenew: null });
  });

  it('[CS-033] money by kind from the lifetime read: messages, tips (stream tips with them), the subscription', () => {
    expect(spendByKind(detail().typeBreakdown)).toEqual([
      { kind: 'messages', mills: 9_860_000 },
      { kind: 'tips', mills: 2_140_000 },
      { kind: 'subscription', mills: 480_000 },
    ]);
    expect(spendByKind([{ canonicalType: 'refund', grossAmountMills: -45_000, creatorNetAmountMills: -36_000, transactionCount: 1 }])).toEqual([{ kind: 'other', mills: -45_000 }]);
    const model = fanPanelModel({ fanRef: '2002', pageId: PAGE_ID, lifetime: detail(), last30: detail(), hostFan, row: null, now: NOW_MS });
    expect(model.spent).toMatchObject({ total: 12_480_000, period30: 320_000 });
    expect(model.spent?.byKind).toHaveLength(3);
    // Only the 30-day read answered: the total is known, the kinds are not passed off as lifetime ones.
    const partial = fanPanelModel({ fanRef: '2002', pageId: PAGE_ID, lifetime: null, last30: detail(), hostFan, row: null, now: NOW_MS });
    expect(partial.spent).toEqual({ total: 12_480_000, period30: 320_000, byKind: [] });
    expect(fanPanelModel({ fanRef: '2002', pageId: PAGE_ID, lifetime: detail(), last30: null, hostFan, row: null, now: NOW_MS }).spent?.period30).toBeNull();
  });

  it('[CS-017] «фан уже N мес»: whole calendar months of the current subscription', () => {
    expect(subscriptionMonths('2025-04-03T10:00:00.000Z', NOW_MS)).toBe(18);
    expect(subscriptionMonths('2025-04-04T10:00:00.000Z', NOW_MS)).toBe(17);
    expect(subscriptionMonths(at(-86_400), NOW_MS)).toBe(0);
    expect(subscriptionMonths(at(86_400), NOW_MS)).toBeNull();
    expect(subscriptionMonths(null, NOW_MS)).toBeNull();
    const model = fanPanelModel({ fanRef: '2002', pageId: PAGE_ID, lifetime: detail(), last30: null, hostFan, row: null, now: NOW_MS });
    expect(model.subscription).toEqual({ months: 18, since: '2025-04-03T10:00:00.000Z', autoRenew: true, churnRisk: 'low' });
  });

  it('[CS-032] the churn risk: auto-renewal off or a lapsed subscription is high; otherwise the board row retention; nothing known is null', () => {
    expect(churnRisk(pageOf({ autoRenew: false }), 'active')).toBe('high');
    expect(churnRisk(pageOf({ autoRenewOffDetectedAt: at(-60) }), null)).toBe('high');
    expect(churnRisk(pageOf({ isSubscriber: false }), 'active')).toBe('high');
    expect(churnRisk(pageOf(), 'cooling')).toBe('medium');
    expect(churnRisk(pageOf(), 'needs_reactivation')).toBe('high');
    expect(churnRisk(pageOf(), null)).toBe('low');
    expect(churnRisk(pageOf({ autoRenew: null }), null)).toBeNull();
    expect(churnRisk(null, null)).toBeNull();
    expect(churnRisk(pageOf({ isSubscriber: false, subscriberSince: null }), null)).toBeNull();
  });

  const profile = (body: string): Dossier => ({
    fan: { platform: 'onlyfans', platformUserId: '2002', username: 'hubert_hub', displayName: 'Hubert K.', createdAtExternal: null, pageAlias: null },
    profile: { version: 3, body, source: 'chatmuse', createdAt: at(-60), sourceGeneratedAt: at(-3600), createdByUserId: 7 },
  });

  it('[CS-035] the bio is the hub profile of the fan; ChatSpace memory stands in only while the hub has none', () => {
    const base = { fanRef: '2002', pageId: PAGE_ID, lifetime: detail(), last30: detail(), row: null, now: NOW_MS };
    // The hub has a profile: its body is the bio, whatever ChatSpace holds.
    expect(fanPanelModel({ ...base, hostFan, dossier: profile('## Fan\nLikes short replies.') })).toMatchObject({ bio: '## Fan\nLikes short replies.', bioSource: 'hub' });
    expect(fanPanelModel({ ...base, hostFan: null, dossier: profile('  Night owl.  ') })).toMatchObject({ bio: 'Night owl.', bioSource: 'hub' });
    // The hub knows the fan but has no profile document, or an empty one, or does not know the fan: ChatSpace's «О себе» is the stand-in.
    for (const dossier of [{ ...profile('x'), profile: null }, profile('   '), null]) {
      expect(fanPanelModel({ ...base, hostFan, dossier })).toMatchObject({ bio: 'Works shifts, writes in the evening.', bioSource: 'host' });
      expect(fanPanelModel({ ...base, hostFan: null, dossier })).toMatchObject({ bio: null, bioSource: null });
    }
    // Lists are ChatSpace's own (the hub holds none): decoration, when in memory.
    expect(fanPanelModel({ ...base, hostFan, dossier: profile('x') }).lists).toEqual(['VIP', 'Whales']);
    // With no money read, the hub's profile still names the fan before ChatSpace's memory is all there is.
    expect(fanPanelModel({ ...base, lifetime: null, last30: null, hostFan: null, dossier: profile('x') })).toMatchObject({ name: 'Hubert K.', username: 'hubert_hub' });
  });

  it('[CS-036] [DB-026] ChatSpace memory is decoration only; the archive coverage is the archive\'s own word, then the board row\'s; the message count comes with the row', () => {
    const model = fanPanelModel({ fanRef: '2002', pageId: PAGE_ID, lifetime: detail(), last30: detail(), hostFan, row: { retention: 'active', storedMessages: 412, history: 'complete' }, now: NOW_MS });
    expect(model).toMatchObject({
      name: 'Hubert',
      username: 'hubert_pl',
      initials: 'H',
      lastSeenAt: at(-360),
      online: false,
      host: { buyingPower: 'High', scores: [{ label: 'Tips', value: '8/10' }] },
      lists: ['VIP', 'Whales'],
      asOf: NOW,
      coverage: 'complete',
      archiveMessages: 412,
    });
    const partial = { retention: null, storedMessages: 3, history: 'partial' } as const;
    expect(fanPanelModel({ fanRef: '2002', pageId: PAGE_ID, lifetime: detail(), last30: null, hostFan, row: partial, now: NOW_MS }).coverage).toBe('partial');
    // The archive's own state, read for the open chat, needs no board: complete without a row, and it overrides an older row.
    expect(fanPanelModel({ fanRef: '2002', pageId: PAGE_ID, lifetime: detail(), last30: null, hostFan, archive: { coverage: 'complete' }, row: null, now: NOW_MS })).toMatchObject({ coverage: 'complete', archiveMessages: null });
    expect(fanPanelModel({ fanRef: '2002', pageId: PAGE_ID, lifetime: detail(), last30: null, hostFan, archive: { coverage: 'unknown' }, row: partial, now: NOW_MS })).toMatchObject({ coverage: 'unknown', archiveMessages: 3 });
    // Neither: unknown, never «complete» by default.
    expect(fanPanelModel({ fanRef: '2002', pageId: PAGE_ID, lifetime: detail(), last30: null, hostFan, row: null, now: NOW_MS })).toMatchObject({ coverage: 'unknown', archiveMessages: null });
  });

  it('[CS-037] nothing known stays unknown: no hub card and nothing in ChatSpace memory', () => {
    const model = fanPanelModel({ fanRef: '2002', pageId: PAGE_ID, lifetime: null, last30: null, hostFan: null, row: null, now: NOW_MS });
    expect(model).toEqual({
      name: '2002',
      username: null,
      initials: '2',
      lastSeenAt: null,
      online: null,
      spent: null,
      subscription: null,
      host: null,
      bio: null,
      bioSource: null,
      lists: [],
      asOf: null,
      coverage: 'unknown',
      archiveMessages: null,
    });
    expect(initials('Theodore Whitfield')).toBe('TW');
    expect(initials('  ')).toBe('?');
    expect(initials('marco_r')).toBe('MR');
  });
});

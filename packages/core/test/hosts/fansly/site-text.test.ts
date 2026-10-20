import { describe, expect, it, vi } from 'vitest';

import type { FanslyHostPort } from '@cg/contracts/fansly-host';
import { FanslySnapshotSchema, type FanslySnapshot } from '@cg/contracts/fansly';
import type { FreshnessRequest, HostSnapshot } from '@cg/contracts/host';
import type { Bootstrap } from '@cg/contracts/hub';
import type { SiteStartOp } from '@cg/contracts/ops';
import { withFanslyOpText } from '@cg/core/application/hosts/fansly/ai';
import { stableDigest } from '@cg/core/domain/ops';
import { identity, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES } from '@cg/testing/hub';

import { FANSLY, NOW_MS, fanslyAccount, fanslyChat, fanslyTarget, tokenN } from '../../support/world';

const NOW = new Date(NOW_MS).toISOString();
const startOf = (feature: SiteStartOp['feature']): SiteStartOp => {
  const base = { target: fanslyTarget, cause: { kind: 'click' as const, actionToken: tokenN(1) }, window: 100 };
  return feature === 'notes-fill'
    ? { ...base, feature, fields: ['Name'], values: ['Existing value'] }
    : { ...base, feature, tone: null, draft: { text: 'My draft', revision: 1, digest: stableDigest('My draft') } };
};

function snapshot(feature: SiteStartOp['feature']): FanslySnapshot {
  const tail = [1, 2, 3].map((n) => ({
    platformMessageId: String(8000 + n), direction: n === 2 ? 'model' as const : 'fan' as const,
    sentAt: new Date(NOW_MS - (4 - n) * 1000).toISOString(), text: `Message ${n}`,
  }));
  return FanslySnapshotSchema.parse({
    feature, identity: { creatorId: FANSLY.creator, groupId: FANSLY.group, fanId: FANSLY.fan },
    epochs: { document: 'doc-1', socket: 1, route: 5 }, completeness: 'complete',
    window: tail.map((message) => ({ id: message.platformMessageId, dir: message.direction })),
    knownFanMessageIds: ['8001', '8003'], deletedIds: [], tail, truncated: false,
  });
}

function harness(feature: SiteStartOp['feature'] = 'notes-fill') {
  let route: HostSnapshot['route'] = { epoch: 5, name: 'chat', chat: fanslyChat, account: fanslyAccount, conversationRef: FANSLY.group };
  const read = vi.fn<FanslyHostPort['freshness']['snapshot']>().mockResolvedValue(snapshot(feature));
  const host: Pick<FanslyHostPort, 'current' | 'freshness'> = {
    current: () => ({
      ...startSnapshot, kind: 'fansly-web', accounts: [fanslyAccount], route,
      identity: { ...identity, host: 'fansly-web', hostAccountId: FANSLY.creator, platformAccountId: FANSLY.creator, routeEpoch: route.epoch, chat: route.chat },
    }),
    freshness: { snapshot: read },
  };
  return {
    read,
    move(change: Partial<HostSnapshot['route']>) { route = { ...route, ...change }; },
    // This consumer has only these two read ports; other host dependencies must not be required.
    prepare(start = startOf(feature), bootstrap: Bootstrap | null = BOOTSTRAP_PILOT_PAGES, admitted = true) {
      return withFanslyOpText(host as FanslyHostPort, start, bootstrap, admitted, () => NOW_MS);
    },
  };
}

describe('[host:fansly] latest text for notes and voice operations', () => {
  it.each(['notes-fill', 'voice-script'] as const)('attaches the newest bounded messages for %s without changing its target or input', async (feature) => {
    const h = harness(feature);
    const input = startOf(feature);
    const bootstrap = { ...BOOTSTRAP_PILOT_PAGES, limits: { ...BOOTSTRAP_PILOT_PAGES.limits, freshTextMaxItems: 2, freshTextMaxChars: 5 } };
    const output = await h.prepare(input, bootstrap);
    expect(h.read).toHaveBeenCalledExactlyOnceWith(fanslyChat, {
      conversationRef: FANSLY.group, feature, window: 60, withText: true,
    } satisfies FreshnessRequest);
    expect(output).toEqual({
      ...input, fresh: { capturedAt: NOW, messages: [
        { platformMessageId: '8002', direction: 'model', sentAt: new Date(NOW_MS - 2000).toISOString(), text: 'Messa' },
        { platformMessageId: '8003', direction: 'fan', sentAt: new Date(NOW_MS - 1000).toISOString(), text: 'Messa' },
      ] },
    });
    expect(input).not.toHaveProperty('fresh');
  });

  it('never reads the page without admission, hub support or a positive text budget', async () => {
    const input = startOf('notes-fill');
    const noCapability = { ...BOOTSTRAP_PILOT_PAGES, capabilities: BOOTSTRAP_PILOT_PAGES.capabilities.filter((cap) => cap !== 'live-text-fansly-tools-v1') };
    const cases: readonly [Bootstrap | null, boolean][] = [
      [BOOTSTRAP_PILOT_PAGES, false], [null, true], [noCapability, true],
      ...(['freshTextMaxItems', 'freshTextMaxChars'] as const).map((key): [Bootstrap, boolean] => [
        { ...BOOTSTRAP_PILOT_PAGES, limits: { ...BOOTSTRAP_PILOT_PAGES.limits, [key]: 0 } }, true,
      ]),
    ];
    for (const [bootstrap, admitted] of cases) {
      const h = harness();
      expect(await h.prepare(input, bootstrap, admitted)).toBe(input);
      expect(h.read).not.toHaveBeenCalled();
    }
  });

  it.each(['groupId', 'creatorId', 'fanId'] as const)('does not attach a snapshot with a different %s', async (field) => {
    const h = harness();
    const input = startOf('notes-fill');
    const held = snapshot('notes-fill');
    h.read.mockResolvedValue({ ...held, identity: { ...held.identity, [field]: '9999' } });
    expect(await h.prepare(input)).toBe(input);
  });

  it('refuses a target outside the open chat before reading any page text, even with fresh text disabled', async () => {
    const h = harness();
    h.move({ conversationRef: FANSLY.otherGroup });
    expect(await h.prepare()).toBeNull();
    expect(await h.prepare(startOf('notes-fill'), BOOTSTRAP_PILOT_PAGES, false)).toBeNull();
    expect(h.read).not.toHaveBeenCalled();
  });

  it.each(['other-chat', 'away-and-back', 'failed-read'] as const)('never starts on a changed route after awaiting the snapshot: %s', async (change) => {
    const h = harness();
    const pending = Promise.withResolvers<FanslySnapshot | null>();
    h.read.mockReturnValue(pending.promise);
    const prepared = h.prepare();
    expect(h.read).toHaveBeenCalledOnce();
    // Returning to the same group still changes the epoch: the original click has expired.
    h.move({ epoch: 7, conversationRef: change === 'away-and-back' ? FANSLY.group : FANSLY.otherGroup });
    if (change === 'failed-read') pending.reject(new Error('bridge unavailable'));
    else pending.resolve(snapshot('notes-fill'));
    expect(await prepared).toBeNull();
  });
});

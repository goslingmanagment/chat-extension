// The client/* routes, all of them through the vendored SDK since the
// re-vendor of hub c8514c5c: archive feed (H-9), «Новые» (H-7c), claim and
// custody (H-7b), Spenders statistics and «ждут ответа» (H-8), shared recaps
// and the dossier (H-13, H-5), every scenario of the fake hub with its
// expected reading (parity NF-010, NF-023, NF-026, SN-012, AI-060…AI-071,
// AI-097, NEW-02, HB-006).

import { CLAIM_REVISION_MAX, CLIENT_FEATURE_FLAG_NAMES, isHubCallError, isHubCheckError, type ClaimOp, type ClaimSendGroup, type HubClaimOp } from '@cg/contracts';
import { HUB_SAMPLES } from '@cg/contracts/fixtures';
import { FanslyGreetingClaimOpSchema } from '@cg/contracts/send-fansly';
import { BOOTSTRAP_PILOT_ON, HTTP_SCENARIOS, HUB_ROUTE_PATHS, NOW_MS, PAGE, WORLD, hubServing, uuid, type HttpExchange, pageFeaturesOff } from '@cg/testing/hub';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorWireOf, type ChatExtensionHub } from '../src/index';
import { hubError, json } from './support/fake-hub';
import { flush, makeHarness, signIn, type Harness } from './support/harness';
import { scenarioNamed, signInWorld } from './support/world';

const SIGN_IN = scenarioNamed(HTTP_SCENARIOS, 'sign-in-and-bootstrap-all-off');
/**
 * Every page feature available (X8 included), so only the hub's own answers decide — and every top-level flag
 * false, as on a hub whose owner switches pages on one by one: the facade reads the page, never those.
 */
const BOOTSTRAP_ALL_ON = {
  ...BOOTSTRAP_PILOT_ON,
  flags: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, false])),
  pages: BOOTSTRAP_PILOT_ON.pages.map((page) => (page.platform === 'onlyfans' ? { ...page, features: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, { available: true }])) } : page)),
};
const WORLD_ON = signInWorld(SIGN_IN, BOOTSTRAP_ALL_ON, WORLD.user.username);

/** The facade method of one scenario exchange (the routes the data scenarios use). */
function call(facade: ChatExtensionHub, exchange: HttpExchange): Promise<unknown> {
  const request = exchange.request as never;
  switch (exchange.route) {
    case 'clientConversationFeed':
      return facade.feed(request);
    case 'clientAudienceNew':
      return facade.audienceNew(request);
    case 'clientFanClaim':
      return facade.claim(request);
    case 'clientFanClaimStatus': {
      const { pageLabel, fanRef } = exchange.request as { pageLabel: string; fanRef: string };
      return facade.claimStatus(pageLabel, fanRef);
    }
    case 'clientConversationRecaps':
      return facade.recaps(request);
    case 'clientFanProfileFromGeneration':
      return facade.profileFromGeneration(request);
    case 'pageConversationProfile':
      return facade.dossier(request);
    case 'pageFanProfile':
      return facade.fanDossier(request);
    case 'clientSpenderStats':
      return facade.spendersStats(request);
    case 'clientSpenderAwaitingReply':
      return facade.awaitingReply(request);
    case 'pageSpenderAutoLists':
      return facade.autoLists((exchange.request as { pageLabel: string }).pageLabel);
    default:
      throw new Error(`no facade call for ${exchange.route}`);
  }
}

let h: Harness;
beforeEach(async () => {
  vi.useFakeTimers({ now: NOW_MS, toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  h = makeHarness({ paths: HUB_ROUTE_PATHS });
  await signIn(h, WORLD_ON);
  await flush(20);
});
afterEach(() => {
  h.facade.dispose();
  vi.useRealTimers();
});

const DATA_SCENARIOS = [
  'claim-greeting-two-parts',
  'claim-uncertain-held',
  'claim-refusals',
  'preview-reply-rejected-then-sent',
  'register-native-send',
] as const;

describe('[NF-010] [NF-023] [AI-061] every client-route scenario of the fake hub, exchange by exchange', () => {
  for (const name of DATA_SCENARIOS) {
    const scenario = scenarioNamed(HTTP_SCENARIOS, name);
    it(`[NF-010] ${name}: ${scenario.description}`, async () => {
      for (const exchange of scenario.exchanges) {
        // The fake hub answers exactly this request (path, query, body), once.
        const before = h.hub.requests.length;
        const served = h.hub.serve([exchange]);
        const outcome = await call(h.facade, exchange).then(
          (value) => ({ ok: true as const, value }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        const sent = h.hub.requests.slice(before).filter((request) => request.route === exchange.route);
        if (exchange.facts?.pageGranted === false) {
          // A page outside the bootstrap is refused before any request.
          expect(sent).toEqual([]);
          expect(outcome.ok ? null : isHubCheckError(outcome.error) && outcome.error.code).toBe(exchange.expect?.cg);
          continue;
        }
        expect(served.left()).toEqual([]);
        expect(sent).toHaveLength(1);
        if (exchange.expect === undefined) {
          if (!outcome.ok) throw outcome.error as Error;
          if (exchange.route === 'clientFanProfileFromGeneration') expect(outcome.value).toEqual({ state: 'saved', response: exchange.response.body });
          else expect(outcome.value).toEqual(exchange.response.body);
          continue;
        }
        // An error answer: the expected reading, or the facade's settled outcome for it.
        if (exchange.expect.disposition === 'not-ready') {
          expect(outcome).toEqual({ ok: true, value: { state: 'not-ready' } });
          continue;
        }
        if (exchange.route === 'clientFanProfileFromGeneration') {
          expect(outcome).toEqual({ ok: true, value: { state: 'rejected', reason: (exchange.response.body as { reason?: string }).reason ?? null } });
          continue;
        }
        if (exchange.expect.disposition === 'empty') {
          expect(outcome).toEqual({ ok: true, value: null });
          continue;
        }
        expect(outcome.ok).toBe(false);
        const error = outcome.ok ? null : outcome.error;
        expect(isHubCallError(error) && error.resolution).toMatchObject({ code: exchange.expect.cg, disposition: exchange.expect.disposition });
        if (exchange.response.retryAfterSec !== undefined) expect(errorWireOf(error)?.retryAt).toBe(NOW_MS + exchange.response.retryAfterSec * 1000);
      }
      expect(h.hub.unexpected).toEqual([]);
    });
  }
});

describe('[NF-026] claim and custody: never repeated, flags checked for taking work only', () => {
  const dispatch = (purpose: 'greeting' | 'preview-reply'): ClaimOp => ({
    pageLabel: PAGE,
    fanRef: WORLD.newFan,
    body: {
      action: 'dispatch',
      attemptId: uuid(0x4a1),
      instanceId: WORLD.instanceId,
      purpose,
      group: { generationRef: uuid(0x200), variant: 0, partCount: 1 },
      partIndex: 0,
      textRevision: 0,
      ...(purpose === 'greeting' ? { leaseToken: uuid(0x300) } : {}),
      flagRevision: WORLD.configRevision,
    },
  });

  it('[NF-026] a dispatch that fails (503, network, timeout) is asked exactly once', async () => {
    for (const answer of [() => hubError(503, 'service_unavailable'), () => 'network-error' as const]) {
      const before = h.hub.of('clientFanClaim').length;
      h.hub.on('clientFanClaim', answer);
      const error = await h.facade.claim(dispatch('preview-reply')).catch((reason: unknown) => reason);
      expect(isHubCallError(error)).toBe(true);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.hub.of('clientFanClaim').length - before).toBe(1);
    }
    h.hub.on('clientFanClaim', () => 'hang');
    const before = h.hub.of('clientFanClaim').length;
    const timedOut = h.facade.claim(dispatch('preview-reply')).catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(errorWireOf(await timedOut)?.code).toBe('CG-HUB-TIMEOUT');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.hub.of('clientFanClaim').length - before).toBe(1);
  });

  it('[NF-026] previewSend off on the page: a dispatch is refused locally with CG-SEND-OFF; registerNativeSend and reports still go', async () => {
    await signIn(h, { ...WORLD_ON, bootstrap: BOOTSTRAP_PILOT_ON });
    expect(errorWireOf(await h.facade.claim(dispatch('preview-reply')).catch((reason: unknown) => reason))).toEqual({ code: 'CG-SEND-OFF', detail: 'flag_off' });
    expect(h.hub.of('clientFanClaim')).toEqual([]);
    const state = scenarioNamed(HTTP_SCENARIOS, 'register-native-send').exchanges[0];
    h.hub.on('clientFanClaim', () => json(200, state?.response.body));
    await h.facade.claim(state?.request as ClaimOp);
    await h.facade.claim({ pageLabel: PAGE, fanRef: WORLD.newFan, body: { action: 'failed', attemptId: uuid(0x4a2), instanceId: WORLD.instanceId, reason: 'not_enqueued' } });
    expect(h.hub.of('clientFanClaim')).toHaveLength(2);
  });

  it('[NF-023] «Новые» off: a lease is refused locally; a status read is not', async () => {
    const off = pageFeaturesOff(BOOTSTRAP_ALL_ON, ['newcomers']);
    await signIn(h, { ...WORLD_ON, bootstrap: off });
    const lease: ClaimOp = { pageLabel: PAGE, fanRef: WORLD.newFan, body: { action: 'claim', leaseToken: uuid(0x300), instanceId: WORLD.instanceId } };
    expect(errorWireOf(await h.facade.claim(lease).catch((reason: unknown) => reason))).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect(errorWireOf(await h.facade.audienceNew({ pageLabel: PAGE, windowHours: 48 }).catch((reason: unknown) => reason))?.code).toBe('CG-FEATURE-DISABLED');
    h.hub.on('clientFanClaimStatus', () => json(200, scenarioNamed(HTTP_SCENARIOS, 'claim-greeting-two-parts').exchanges[0]?.response.body));
    await expect(h.facade.claimStatus(PAGE, WORLD.newFan)).resolves.toMatchObject({ greeting: { state: 'none' } });
  });
});

describe('[HB-006] one transport: every client/* route goes through the vendored SDK', () => {
  it('[HB-006] a request outside its schema is never sent; an extra key is our bug — a dispatch past the hub\'s 32-bit revisions too (1.6.0)', async () => {
    const error = await h.facade.feed({ pageLabel: PAGE, fanRef: WORLD.fan, limit: 500 }).catch((reason: unknown) => reason);
    expect(errorWireOf(error)?.code).toBe('CG-HUB-REQUEST');
    expect(h.hub.of('clientConversationFeed')).toEqual([]);
    const tooFar: ClaimOp = {
      pageLabel: PAGE,
      fanRef: WORLD.newFan,
      body: { action: 'dispatch', attemptId: uuid(0x4a9), instanceId: WORLD.instanceId, purpose: 'preview-reply', group: { generationRef: uuid(0x200), variant: 0, partCount: 1 }, partIndex: 0, textRevision: CLAIM_REVISION_MAX + 1, flagRevision: WORLD.configRevision },
    };
    expect(errorWireOf(await h.facade.claim(tooFar).catch((reason: unknown) => reason))?.code).toBe('CG-HUB-REQUEST');
    expect(h.hub.of('clientFanClaim')).toEqual([]);
  });
});

describe('R20 F6b: the reads by conversation (architecture §11.1, hub HF-10)', () => {
  const FANSLY_PAGE = WORLD.pages.fansly.pageLabel;
  /** A Fansly fan and the group of the read: two ids, never one for the other. */
  const FAN = '700000000000000002';
  const GROUP = '700000000000000003';
  const OTHER_GROUP = '700000000000000004';
  /** The Fansly page with its recap and preview admitted, as R20 HF-2 will: only the hub's answers decide here. */
  const FANSLY_ON = {
    ...BOOTSTRAP_ALL_ON,
    pages: BOOTSTRAP_ALL_ON.pages.map((page) => (page.platform === 'fansly' ? { ...page, features: Object.fromEntries(CLIENT_FEATURE_FLAG_NAMES.map((flag) => [flag, { available: true }])) } : page)),
  };
  const fanslyFeed = (conversationRef: string | undefined) => ({ ...HUB_SAMPLES.feedPage, target: { pageLabel: FANSLY_PAGE, fanRef: FAN, ...(conversationRef === undefined ? {} : { conversationRef }) } });

  async function signedIn(bootstrap: unknown): Promise<Harness> {
    const made = makeHarness({ paths: HUB_ROUTE_PATHS });
    await signIn(made, signInWorld(SIGN_IN, bootstrap, WORLD.user.username));
    await flush(20);
    return made;
  }

  it('a feed page of another group than the one asked for, or of none, is a broken answer — never shown as this chat\'s', async () => {
    const f = await signedIn(FANSLY_ON);
    try {
      for (const answered of [OTHER_GROUP, undefined]) {
        f.hub.on('clientConversationFeed', () => json(200, fanslyFeed(answered)));
        const error = await f.facade.feed({ pageLabel: FANSLY_PAGE, fanRef: FAN, conversationRef: GROUP, limit: 50 }).catch((reason: unknown) => reason);
        expect(isHubCallError(error) && error.failure, String(answered)).toEqual({ kind: 'transport', failure: 'contract' });
      }
    } finally {
      f.facade.dispose();
    }
  });

  it('the dossier is the fan\'s: on Fansly it is read by the fan, on OnlyFans by its conversation as always', async () => {
    const f = await signedIn(FANSLY_ON);
    try {
      f.hub.on('pageFanProfile', () => json(200, HUB_SAMPLES.dossier)).on('pageConversationProfile', () => json(200, HUB_SAMPLES.dossier));
      await expect(f.facade.dossier({ pageLabel: FANSLY_PAGE, fanRef: FAN })).resolves.toEqual(HUB_SAMPLES.dossier);
      expect(f.hub.of('pageFanProfile').map((request) => request.path)).toEqual([`/api/v1/pages/${FANSLY_PAGE}/fans/${FAN}/profile`]);
      expect(f.hub.of('pageConversationProfile')).toEqual([]);
      await f.facade.dossier({ pageLabel: PAGE, fanRef: WORLD.fan });
      expect(f.hub.of('pageConversationProfile').map((request) => request.path)).toEqual([`/api/v1/pages/${PAGE}/conversations/${WORLD.fan}/profile`]);
      expect(f.hub.of('pageFanProfile')).toHaveLength(1);
    } finally {
      f.facade.dispose();
    }
  });

  it('[NF-021] R20 P9d: a Fansly greeting\'s dispatch asks `newcomers` alone (HF-3) — `previewSend` off on the page does not stop it, a manual group goes as it is; OnlyFans\' still needs both', async () => {
    const f = await signedIn(pageFeaturesOff(FANSLY_ON, ['previewSend']));
    try {
      const greeting = (pageLabel: string, fanRef: string, group: ClaimSendGroup): HubClaimOp => ({
        pageLabel,
        fanRef,
        body: { action: 'dispatch', attemptId: uuid(0x4b1), instanceId: WORLD.instanceId, purpose: 'greeting', group, partIndex: 0, textRevision: 3, leaseToken: uuid(0x301), flagRevision: WORLD.configRevision },
      });
      const manual = { kind: 'manual', textFingerprint: 'a'.repeat(64) } as const;
      f.hub.on('clientFanClaim', () => json(200, scenarioNamed(HTTP_SCENARIOS, 'claim-greeting-two-parts').exchanges[1]?.response.body));
      // The registry's ClaimOpSchema names no manual group: without the site's own schema it is never sent (HB-006).
      const unchecked = await f.facade.claim(greeting(FANSLY_PAGE, FAN, manual)).catch((reason: unknown) => reason);
      expect(isHubCallError(unchecked) && unchecked.failure).toEqual({ kind: 'transport', failure: 'contract' });
      expect(f.hub.of('clientFanClaim')).toEqual([]);
      const fansly = await f.facade.claim(greeting(FANSLY_PAGE, FAN, manual), FanslyGreetingClaimOpSchema).catch((reason: unknown) => reason);
      expect(errorWireOf(fansly) ?? (isHubCallError(fansly) ? fansly.failure : null)).toBeNull();
      expect(f.hub.of('clientFanClaim')).toHaveLength(1);
      expect(f.hub.of('clientFanClaim')[0]).toMatchObject({ method: 'POST', path: `/api/v1/client/pages/${FANSLY_PAGE}/fans/${FAN}/claim`, body: { action: 'dispatch', group: manual } });
      // A hub without `manual-greeting-v1` is never asked a manual group.
      const older = await signedIn(hubServing(pageFeaturesOff(FANSLY_ON, ['previewSend']), FANSLY_ON.capabilities.filter((capability) => capability !== 'manual-greeting-v1')));
      try {
        const refused = await older.facade.claim(greeting(FANSLY_PAGE, FAN, manual), FanslyGreetingClaimOpSchema).catch((reason: unknown) => reason);
        expect(isHubCheckError(refused) && refused.code).toBe('CG-HUB-CAPABILITY');
        expect(older.hub.of('clientFanClaim')).toEqual([]);
      } finally {
        older.facade.dispose();
      }
      const onlyfans = await f.facade.claim(greeting(PAGE, WORLD.newFan, { generationRef: uuid(0x200), variant: 0, partCount: 1 }), FanslyGreetingClaimOpSchema).catch((reason: unknown) => reason);
      expect(errorWireOf(onlyfans)).toEqual({ code: 'CG-SEND-OFF', detail: 'flag_off' });
      expect(f.hub.of('clientFanClaim')).toHaveLength(1);
    } finally {
      f.facade.dispose();
    }
  });
});

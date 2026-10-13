// A click on one fan in a board — the Spenders row «Открыть чат», a preview's
// «Открыть» / «Открыть и вставить», a card of «Новые» — through both gates
// at once: the tab's navigator (the BOARD's own switch on the page the board
// shows) and the background's token gate (the real one, over the hub layer's
// real `flagState`). The bootstrap has two pilot pages whose switches differ.
//
// Decision X13: such a click is never under the owner's `navigation` switch.
// `navigation` covers what walks or jumps between chats by our keys and lists
// (J/K, ⌘U, ⌘1–9, quick jump, the palette's chats) — the `overlay` surface.

import { type Surface } from '@cg/contracts/features';
import { type HostPort, type NavigationIntent } from '@cg/contracts/host';
import { type Bootstrap, type ClientFeatureFlag } from '@cg/contracts/hub';
import { type HubBinding, type SessionIdentity } from '@cg/contracts/ids';
import { boardOpenRefusal, createChatNavigator, type BoardSwitch, type PageContextPort, type PageContextState } from '@cg/core/application/boards';
import { flagUsable } from '@cg/core/domain/ops';
import { flagState } from '@cg/hub';
import { BOOTSTRAP_PILOT_PAGES, WORLD, pageFeaturesOff } from '@cg/testing/hub';
import { describe, expect, it } from 'vitest';

import { tokenRefusal, type TokenGateHub, type TokenKind } from '../src/composition/background/token-gate.ts';
import { CHATSPACE_FEATURE_SLICE as FEATURES } from '../src/composition/features/chatspace.ts';

const ONE = WORLD.pages.one;
const VIP = WORLD.pages.vip;
type Page = typeof ONE | typeof VIP;

const session: SessionIdentity = { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId, login: WORLD.user.username, role: 'chatter', epoch: 1 };

/** The page context of a tab whose ChatSpace shows the account bound to `page`. */
function contextOf(bootstrap: Bootstrap, page: Page): PageContextPort {
  const binding: HubBinding = {
    hubOrigin: session.hubOrigin,
    principalId: session.userId,
    loginEpoch: session.epoch,
    host: 'chatspace',
    hostAccountId: page.hostAccountId,
    platform: 'onlyfans',
    platformAccountId: page.platformAccountId,
    pageId: page.pageId,
    pageLabel: page.pageLabel,
    bindingRevision: page.bindingRevision,
  };
  const state: PageContextState = {
    phase: 'ready',
    blocker: null,
    session,
    bootstrap,
    account: { host: 'chatspace', hostAccountId: page.hostAccountId, platform: 'onlyfans', platformAccountId: page.platformAccountId, username: null, displayName: page.title },
    binding,
    page: bootstrap.pages.find((candidate) => candidate.pageId === page.pageId) ?? null,
    settings: null,
    persona: null,
    epoch: 1,
  };
  return { current: () => state, subscribe: () => () => undefined, refresh: () => Promise.resolve(), dispose: () => undefined };
}

/** A tab on `page`'s account: the board navigator over the background's real token gate and a host that records. */
function tabOn(bootstrap: Bootstrap, page: Page) {
  const hub: TokenGateHub = {
    session: () => session,
    cachedBootstrap: () => bootstrap,
    flagState: (flag, pageLabel) => flagState(bootstrap, flag, pageLabel),
    bootstrap: () => Promise.resolve(bootstrap),
  };
  const asked: { kind: TokenKind; surface: Surface }[] = [];
  const navigated: NavigationIntent[] = [];
  const rpc = {
    request: async (type: string, payload: { kind: TokenKind; surface: Surface }) => {
      if (type !== 'token.issue') throw new Error(`unexpected ${type}`);
      asked.push(payload);
      const refusal = await tokenRefusal(payload.kind, payload.surface, hub, () => ({ code: 'CG-HUB-UNAVAILABLE' }), FEATURES);
      return refusal === null ? { ok: true, payload: { actionToken: 'tok_0000000000000001', expiresAt: 0 } } : { ok: false, error: refusal };
    },
  };
  const host = {
    current: () => ({ contract: { capabilities: { navigate: { state: 'on' } } } }),
    navigate: (intent: NavigationIntent) => {
      navigated.push(intent);
      return Promise.resolve({ state: 'navigated', insert: null });
    },
  } as unknown as HostPort;
  const context = contextOf(bootstrap, page);
  const navigator = createChatNavigator({ rpc: rpc as never, host, ids: { uuid: () => '00000000-0000-4000-8000-000000000001' }, context });
  const chat = { host: 'chatspace', hostAccountId: page.hostAccountId, platformFanId: WORLD.otherFan } as const;
  return {
    asked,
    navigated,
    context,
    open: (surface: Surface, boards: readonly BoardSwitch[]) => navigator.open(chat, surface, boards),
    /** Our own navigation into this account (a key, the palette): the background's half of its gate. */
    ours: () => tokenRefusal('navigate', 'overlay', hub, () => ({ code: 'CG-HUB-UNAVAILABLE' }), FEATURES),
    chat,
    navigator,
  };
}

const off = (flags: readonly ClientFeatureFlag[], page: Page, from: Bootstrap = BOOTSTRAP_PILOT_PAGES): Bootstrap => pageFeaturesOff(from, flags, { pageIds: [page.pageId] });

/** The clicks of a board and the switches each answers to on its page. */
const CLICKS: readonly { readonly name: string; readonly surface: Surface; readonly boards: readonly BoardSwitch[] }[] = [
  { name: 'the Spenders row «Открыть чат»', surface: 'preview', boards: ['spenders'] },
  { name: 'a preview’s «Открыть»', surface: 'preview', boards: ['preview'] },
  { name: 'a card of «Новые»', surface: 'newcomers', boards: ['newcomers'] },
  { name: 'the preview of a card of «Новые»', surface: 'newcomers', boards: ['preview', 'newcomers'] },
];

describe('[SP-035] a click on a fan in a board is the board’s own switch on its page — never `navigation`', () => {
  it('`navigation` off on every granted page (the live pilot): every board click still opens its fan’s chat, and our own navigation stays refused', async () => {
    const bootstrap = pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['navigation']);
    for (const page of [ONE, VIP]) {
      expect(flagUsable(bootstrap, page.pageId, 'navigation')).toBe(false);
      for (const click of CLICKS) {
        const tab = tabOn(bootstrap, page);
        expect((await tab.open(click.surface, click.boards)).state, `${click.name} on ${page.pageLabel}`).toBe('navigated');
        expect(tab.navigated.map((intent) => intent.target)).toEqual([{ hostAccountId: page.hostAccountId, platformFanId: WORLD.otherFan }]);
        expect(tab.asked).toEqual([{ kind: 'navigate', surface: click.surface }]);
        expect(await tab.ours()).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
      }
    }
  });

  it('two pages whose switches differ: the board that is off on ITS page opens nothing — the host and the background are not even asked — while the other page’s opens', async () => {
    for (const click of CLICKS) {
      for (const flag of click.boards) {
        // Off on the VIP page only; `navigation` is on everywhere, and says nothing here.
        const bootstrap = off([flag], VIP);
        expect(flagUsable(bootstrap, VIP.pageId, 'navigation') && flagUsable(bootstrap, ONE.pageId, flag)).toBe(true);
        const vip = tabOn(bootstrap, VIP);
        expect(await vip.open(click.surface, click.boards), `${click.name}: ${flag} off on the VIP page`).toEqual({ state: 'failed', code: 'CG-FEATURE-DISABLED', insert: null });
        expect([vip.navigated, vip.asked]).toEqual([[], []]);
        const one = tabOn(bootstrap, ONE);
        expect((await one.open(click.surface, click.boards)).state).toBe('navigated');
        expect(one.navigated).toHaveLength(1);
      }
    }
  });

  it('the reason of the page’s own switch picks the code: a hub that does not serve the board yet, the owner’s master switch', async () => {
    const notReady = tabOn(pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['preview'], { pageIds: [VIP.pageId], reason: 'hub_not_ready' }), VIP);
    expect(await notReady.open('preview', ['preview'])).toEqual({ state: 'failed', code: 'CG-HUB-CAPABILITY', insert: null });
    const masterOff = tabOn(pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['spenders'], { pageIds: [VIP.pageId], reason: 'disabled' }), VIP);
    expect(await masterOff.open('preview', ['spenders'])).toEqual({ state: 'failed', code: 'CG-FEATURE-DISABLED', insert: null });
    expect([notReady.navigated, masterOff.navigated]).toEqual([[], []]);
  });

  it('«Открыть и вставить» also needs `insertion` on THAT page: off there — refused there, with `navigation` off everywhere it still works on the other page', () => {
    const bootstrap = off(['insertion'], VIP, pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['navigation']));
    const vip = tabOn(bootstrap, VIP).context.current();
    const one = tabOn(bootstrap, ONE).context.current();
    // The plain open of the preview is not the insert's business…
    expect(boardOpenRefusal(vip, ['preview'])).toBeNull();
    // …the insert half is: the page's own `insertion`, whatever the other page allows.
    expect(boardOpenRefusal(vip, ['preview'], true)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect(boardOpenRefusal(one, ['preview'], true)).toBeNull();
    expect(boardOpenRefusal(one, ['preview', 'newcomers'], true)).toBeNull();
    // A board without a bound page has no switch to ask.
    expect(boardOpenRefusal({ ...vip, binding: null }, ['preview'])).toEqual({ code: 'CG-BINDING-MISSING' });
    // [RB-010] The port to the background is down, or the page is read again after it came back: the switches
    // in hand are from before the outage — the owner may have changed them unheard. Nothing is opened by them.
    const waiting = { ...one, phase: 'blocked' as const, blocker: { code: 'CG-RUNTIME-UNREACHABLE' as const } };
    expect(boardOpenRefusal(waiting, ['preview'])).toEqual({ code: 'CG-RUNTIME-UNREACHABLE' });
    expect(boardOpenRefusal(waiting, ['preview', 'newcomers'], true)).toEqual({ code: 'CG-RUNTIME-UNREACHABLE' });
    // A page whose last reading merely failed (the hub did not answer) is still the page it was.
    expect(boardOpenRefusal({ ...one, phase: 'blocked' as const, blocker: { code: 'CG-HUB-TIMEOUT' as const } }, ['preview'], true)).toBeNull();
  });

  it('a chat of another account than the board’s is not the board’s to open: its page’s switch was never asked', async () => {
    const tab = tabOn(BOOTSTRAP_PILOT_PAGES, ONE);
    expect(await tab.navigator.open({ ...tab.chat, hostAccountId: VIP.hostAccountId }, 'preview', ['spenders'])).toEqual({ state: 'failed', code: 'CG-CONTEXT-CHANGED', insert: null });
    expect([tab.navigated, tab.asked]).toEqual([[], []]);
  });

  it('a board that is off on every page gets no token either, whatever `navigation` says', async () => {
    const bootstrap = pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['spenders', 'preview', 'newcomers']);
    const hub: TokenGateHub = { session: () => session, cachedBootstrap: () => bootstrap, flagState: (flag, pageLabel) => flagState(bootstrap, flag, pageLabel), bootstrap: () => Promise.resolve(bootstrap) };
    const wire = () => ({ code: 'CG-HUB-UNAVAILABLE' }) as const;
    expect(await tokenRefusal('navigate', 'preview', hub, wire, FEATURES)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect(await tokenRefusal('navigate', 'newcomers', hub, wire, FEATURES)).toEqual({ code: 'CG-FEATURE-DISABLED', detail: 'flag_off' });
    expect(await tokenRefusal('navigate', 'overlay', hub, wire, FEATURES)).toBeNull();
  });
});

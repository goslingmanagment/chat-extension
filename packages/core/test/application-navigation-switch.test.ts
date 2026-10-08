// The owner's `navigation` switch as the tab wires it (composition/tab/
// controllers.ts): the navigation controller asks the workspace for the
// switch of the ACCOUNT a key or a list would walk into — the feature of the
// hub page that account is bound to. Opening a chat marks it read on
// OnlyFans, so the answer is never a guess: only an account the hub
// definitely binds to no page follows the owner's `"*"` row; a binding that
// is ambiguous, unread or unknown fails closed (docs/protocols/hub.md «Флаги:
// решает страница»). Synthetic ids only.

import { CLIENT_FEATURE_FLAG_NAMES, type ActionReceipt, type CgCode, type HostAccount, type NavigationItem, type UiAction } from '@cg/contracts';
import { chatHandle, createNavigationController, createOverlayState } from '@cg/core/application/navigation';
import { createI18n } from '@cg/core/domain/i18n';
import { createFakeCatalog, ctxOf } from '@cg/testing/app-client';
import { FakeHostPort, hostAccount, memory, openChat, startSnapshot } from '@cg/testing/host';
import { BOOTSTRAP_PILOT_PAGES, WORLD, meta, pageFeaturesOff, resolveHubErrorReference } from '@cg/testing/hub';
import { describe, expect, it } from 'vitest';

import { TAB } from './support/ai-background';
import { readyHarness, type HarnessParts } from './support/ai-harness';
import { sequentialIds } from './support/clock';
import { NOW_MS } from './support/world';

/** Account A is the open chat's (bound to the first pilot page), account B is bound to the VIP page. */
const A = hostAccount;
const B: HostAccount = { host: 'chatspace', hostAccountId: WORLD.pages.vip.hostAccountId, platform: 'onlyfans', platformAccountId: WORLD.pages.vip.platformAccountId, username: 'model_one_vip', displayName: 'Model One VIP' };
/** An account ChatSpace shows whose creator no hub page has: definitely bound to no page. */
const UNBOUND: HostAccount = { host: 'chatspace', hostAccountId: '1009', platform: 'onlyfans', platformAccountId: '3999', username: 'nobody', displayName: 'Nobody' };

const item = (account: HostAccount, fan: string, position: number): NavigationItem => ({ chat: { host: 'chatspace', hostAccountId: account.hostAccountId, platformFanId: fan }, position, displayName: `Fan ${fan}`, username: `fan_${fan}`, unreadCount: 1, isOnline: null });
const LIST = [item(A, '2005', 0), item(A, openChat.platformFanId, 1), item(A, '2003', 2)];

/** `"*"`: navigation ON. Page A's own row: navigation OFF. Page B's own row: navigation ON. */
const A_OFF = { ...pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['navigation'], { pageIds: [WORLD.pages.one.pageId] }), flags: { ...BOOTSTRAP_PILOT_PAGES.flags, navigation: true } };

async function world(bootstrap = A_OFF) {
  const fake = new FakeHostPort({ start: { ...startSnapshot, accounts: [A, B, UNBOUND] }, memory: { ...memory, chatList: LIST }, checkpoint: null, answers: {}, timeline: [] });
  const parts: HarnessParts = { baseHost: fake, memory, catalog: createFakeCatalog(ctxOf({ now: NOW_MS })), bootstrap, resolve: resolveHubErrorReference, meta: (feature) => meta(feature as Parameters<typeof meta>[0]) };
  const h = await readyHarness(parts);
  const overlays = createOverlayState();
  // Wired as the tab does: the switch is the workspace's answer for the account.
  const navigation = createNavigationController({
    host: h.host,
    rpc: h.bg.rpc(TAB),
    i18n: createI18n({ language: 'ru', now: () => h.clock.now() }),
    ids: sequentialIds(0x700),
    clock: h.clock,
    overlays,
    ownerSwitch: (hostAccountId) => h.ai.workspace.accountFlag(hostAccountId, 'navigation'),
  });
  const go = async (action: UiAction): Promise<ActionReceipt> => {
    const pending = navigation.dispatch(action);
    if (pending === null) throw new Error(`the navigation controller did not take ${action.type}`);
    // A cold list is asked once more after a short wait: let that timer fire.
    await h.clock.advance(200);
    return pending;
  };
  const flag = (account: HostAccount | null) => h.ai.workspace.accountFlag(account?.hostAccountId ?? null, 'navigation');
  /** What reached the host and what was asked of the background for a navigation. */
  const touched = () => ({ navigations: fake.calls.navigations.length, tokens: h.bg.callsOf('token.issue').length });
  return { h, fake, navigation, overlays, go, flag, touched };
}

const failed = (receipt: ActionReceipt): CgCode | null => (receipt.ok ? null : receipt.code);
const step: UiAction = { type: 'Navigate', to: { kind: 'chat-step', direction: 'next' } };
const NEXT_UNREAD: UiAction = { type: 'Navigate', to: { kind: 'next-unread' } };
const slot: UiAction = { type: 'Navigate', to: { kind: 'chat-slot', slot: 1 } };
const jump = (account: HostAccount, fan: string): UiAction => ({ type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle({ hostAccountId: account.hostAccountId, platformFanId: fan }) } });

describe('[HK-037] the owner’s `navigation` switch is the page’s own for a bound account', () => {
  it('two bound accounts, page A off while `"*"` says on: A answers off, B answers on — the `"*"` row decides for neither', async () => {
    const w = await world();
    expect(await w.flag(A)).toBe(false);
    expect(await w.flag(B)).toBe(true);
    // The mirror image: `"*"` off, the page's own row on.
    const mirrored = await world({ ...pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['navigation'], { pageIds: [WORLD.pages.vip.pageId] }), flags: { ...BOOTSTRAP_PILOT_PAGES.flags, navigation: false } });
    expect(await mirrored.flag(A)).toBe(true);
    expect(await mirrored.flag(B)).toBe(false);
  });

  it('walking or jumping into A is refused with CG-FEATURE-DISABLED before anything is touched: no token asked, no navigation on the host', async () => {
    const w = await world();
    const before = w.touched();
    // J/K, ⌘U and ⌘1–9 walk the account on screen (A); a jump names its account itself.
    for (const action of [step, NEXT_UNREAD, slot, jump(A, '2003')]) expect(failed(await w.go(action)), JSON.stringify(action.type === 'Navigate' ? action.to : action)).toBe('CG-FEATURE-DISABLED');
    expect(w.touched()).toEqual(before);
    // The same jump into B, whose page says on, goes through ChatSpace's router on the person's token.
    expect(await w.go(jump(B, '2010'))).toMatchObject({ ok: true, outcome: 'opened' });
    expect(w.fake.calls.navigations.map((intent) => intent.target)).toEqual([{ hostAccountId: B.hostAccountId, platformFanId: '2010' }]);
    expect(w.touched().tokens).toBe(before.tokens + 1);
  });

  it('only an account the hub DEFINITELY binds to no page follows `"*"`; no account on screen does too', async () => {
    const on = await world();
    expect(await on.flag(UNBOUND)).toBe(true);
    expect(await on.flag(null)).toBe(true);
    const off = await world({ ...A_OFF, flags: { ...A_OFF.flags, navigation: false } });
    expect(await off.flag(UNBOUND)).toBe(false);
    expect(await off.flag(null)).toBe(false);
    expect(failed(await off.go(jump(UNBOUND, '2001')))).toBe('CG-FEATURE-DISABLED');
    expect(off.fake.calls.navigations).toEqual([]);
  });

  for (const code of ['CG-BINDING-AMBIGUOUS', 'CG-DATA-NOT-READY', 'CG-HUB-UNAVAILABLE', 'CG-RUNTIME-UNREACHABLE'] as const) {
    it(`a binding that could not be told (${code}) fails closed: page A may say off, so \`"*"\` (on) is not taken for its answer`, async () => {
      const w = await world();
      // The owner's config moves: the binding is read again, and this time the read does not tell.
      w.h.bg.bindingError = { code };
      w.h.bg.bootstrap = { ...A_OFF, configRevision: A_OFF.configRevision + 1 };
      w.h.bg.emit(null, 'bootstrap.changed', { configRevision: A_OFF.configRevision + 1, issuedAt: new Date(NOW_MS).toISOString() });
      await w.h.settle();
      expect(await w.flag(A)).toBe(false);
      // …and B, whose page says ON, is not walked into on a guess either.
      expect(await w.flag(B)).toBe(false);
      const before = w.touched();
      expect(failed(await w.go(step))).toBe('CG-FEATURE-DISABLED');
      expect(failed(await w.go(jump(B, '2010')))).toBe('CG-FEATURE-DISABLED');
      expect(w.touched()).toEqual(before);
    });
  }

  it('[NEW-07] the ⌘-hold popup «Быстрый переход» stands under the same switch and needs its definite «on»: page off, master switch off, a binding not told, nobody signed in — no popup; the page that says on — the popup', async () => {
    const POPUP: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: true } };
    const CLOSE: UiAction = { type: 'Navigate', to: { kind: 'surface', surface: 'quick-jump', open: false } };
    const opened = async (w: Awaited<ReturnType<typeof world>>): Promise<boolean> => {
      expect((await w.go(POPUP)).ok).toBe(true);
      const open = w.overlays.isOpen('quick-jump');
      await w.go(CLOSE);
      return open;
    };
    // The live case (2026-10-07): the open chat is on page A, whose owner left `navigation` off — `"*"` says on.
    const w = await world();
    const before = w.touched();
    expect(await opened(w)).toBe(false);
    // Nothing was asked of the background or of ChatSpace for a popup that did not open.
    expect(w.touched()).toEqual(before);
    // The person goes to an account of page B, whose own row says on: there the hold opens the popup.
    w.h.host.openChat({ host: 'chatspace', hostAccountId: B.hostAccountId, platformFanId: '2010' }, B);
    await w.h.settle();
    expect(await opened(w)).toBe(true);
    // Back on A it is closed again: the answer is the account's on screen, asked at every hold.
    w.h.host.openChat(openChat, A);
    await w.h.settle();
    expect(await opened(w)).toBe(false);

    // The owner's master switch is off: every page answers «disabled», `"*"` or not.
    const master = await world({ ...pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, CLIENT_FEATURE_FLAG_NAMES, { reason: 'disabled' }), flags: { ...BOOTSTRAP_PILOT_PAGES.flags, navigation: true } });
    expect(await master.flag(A)).toBe(false);
    expect(await opened(master)).toBe(false);

    // A binding that could not be told fails closed for the popup as for the keys.
    const untold = await world({ ...BOOTSTRAP_PILOT_PAGES, flags: { ...BOOTSTRAP_PILOT_PAGES.flags, navigation: true } });
    expect(await opened(untold)).toBe(true);
    untold.h.bg.bindingError = { code: 'CG-BINDING-AMBIGUOUS' };
    untold.h.bg.bootstrap = { ...BOOTSTRAP_PILOT_PAGES, configRevision: BOOTSTRAP_PILOT_PAGES.configRevision + 1 };
    untold.h.bg.emit(null, 'bootstrap.changed', { configRevision: BOOTSTRAP_PILOT_PAGES.configRevision + 1, issuedAt: new Date(NOW_MS).toISOString() });
    await untold.h.settle();
    expect(await opened(untold)).toBe(false);

    // Nobody signed in: the switch is unknown. A key still walks ChatSpace's own list (§6.9); the popup, which
    // would list other fans' chats on a guess, does not open.
    const out = await world({ ...BOOTSTRAP_PILOT_PAGES, flags: { ...BOOTSTRAP_PILOT_PAGES.flags, navigation: true } });
    out.h.bg.changeSession(null, 'sign-out');
    await out.h.settle();
    expect(await out.flag(A)).toBeNull();
    expect(await opened(out)).toBe(false);
  });

  it('[RB-010] the port to the background was down: back, the switch is not answered from what was read before — while the bootstrap is read again every account is «off», then each is what its page says now', async () => {
    const w = await world();
    expect([await w.flag(A), await w.flag(B)]).toEqual([false, true]);
    w.h.bg.setConnection('lost');
    // The owner turns navigation off on page B too. This tab's port is down: it hears nothing.
    const off = { ...pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['navigation']), flags: { ...BOOTSTRAP_PILOT_PAGES.flags, navigation: true }, configRevision: BOOTSTRAP_PILOT_PAGES.configRevision + 1 };
    w.h.bg.bootstrap = off;
    w.h.bg.emit(null, 'bootstrap.changed', { configRevision: off.configRevision, issuedAt: new Date(NOW_MS).toISOString() });
    await w.h.settle();
    w.h.bg.setConnection('ready');
    // In the step the port returns the old answer for B («on») is not given, and «unknown» — which lets a key
    // walk — is not either: somebody is signed in, and their page may say off.
    const before = w.touched();
    expect(failed(await w.go(jump(B, '2010')))).toBe('CG-FEATURE-DISABLED');
    expect(w.touched()).toEqual(before);
    await w.h.settle();
    expect([await w.flag(A), await w.flag(B), await w.flag(UNBOUND)]).toEqual([false, false, true]);
    expect(failed(await w.go(jump(B, '2010')))).toBe('CG-FEATURE-DISABLED');
    expect(w.fake.calls.navigations).toEqual([]);
    // The hub cannot be read after the port is back: still nobody's «on».
    const down = await world();
    down.h.bg.setConnection('lost');
    down.h.bg.bootstrap = { error: { code: 'CG-HUB-UNAVAILABLE' } };
    down.h.bg.setConnection('ready');
    await down.h.settle();
    expect([await down.flag(A), await down.flag(B), await down.flag(null)]).toEqual([false, false, false]);
  });

  it('an account ChatSpace has not listed yet fails closed; nobody signed in is «unknown» — ChatSpace’s own list needs no hub; a sign-in whose bootstrap is not read is not', async () => {
    const w = await world();
    expect(await w.h.ai.workspace.accountFlag('999999', 'navigation')).toBe(false);
    expect(failed(await w.go({ type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle({ hostAccountId: '999999', platformFanId: '2001' }) } }))).toBe('CG-FEATURE-DISABLED');
    expect(w.fake.calls.navigations).toEqual([]);
    w.h.bg.changeSession(null, 'sign-out');
    await w.h.settle();
    expect(await w.flag(A)).toBeNull();
    expect(await w.flag(null)).toBeNull();
  });
});

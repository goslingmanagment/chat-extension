// An owner switch for a HOST ACCOUNT, as the background reads it for an event that names an account and no page
// (composition/background/account-switch.ts): a fan's message heard by the WS tap (`wsTap`) and the message
// sound (`sound`). Over the hub layer's real binding rule and two pilot pages whose switches differ.

import { type Bootstrap } from '@cg/contracts/hub';
import { type HostAccount, type SessionIdentity } from '@cg/contracts/ids';
import { resolveBinding } from '@cg/hub';
import { BOOTSTRAP_PILOT_PAGES, WORLD, pageFeaturesOff } from '@cg/testing/hub';
import { describe, expect, it } from 'vitest';

import { createAccountSwitch, humanSendObservable, incomingFactUsable } from '../src/composition/background/account-switch.ts';

const session: SessionIdentity = { hubOrigin: WORLD.hubOrigin, userId: WORLD.user.userId, login: WORLD.user.username, role: 'chatter', epoch: 1 };
const accountOf = (hostAccountId: string, platformAccountId: string | null): HostAccount => ({ host: 'chatspace', hostAccountId, platform: 'onlyfans', platformAccountId, username: null, displayName: null });

/** Bound to the first pilot page, to the VIP page, to no page at all, and one whose creator id ChatSpace has not loaded. */
const ONE = accountOf(WORLD.pages.one.hostAccountId, WORLD.pages.one.platformAccountId);
const VIP = accountOf(WORLD.pages.vip.hostAccountId, WORLD.pages.vip.platformAccountId);
const NOBODY = accountOf('1009', '3999');
const LOADING = accountOf('1010', null);

/** `"*"`: wsTap and sound ON. Page one's own row: both OFF. The VIP page's own row: both ON. */
const ONE_OFF: Bootstrap = { ...pageFeaturesOff(BOOTSTRAP_PILOT_PAGES, ['wsTap', 'sound'], { pageIds: [WORLD.pages.one.pageId] }), flags: { ...BOOTSTRAP_PILOT_PAGES.flags, wsTap: true, sound: true }, bindingsByHost: {} };

function switchOver(bootstrap: Bootstrap | null, seen: readonly HostAccount[] = [ONE, VIP, NOBODY, LOADING]) {
  return createAccountSwitch({
    bootstrap: () => bootstrap,
    seenAccounts: () => seen.map((account) => ({ account })),
    resolveBinding: (account) => (bootstrap === null ? { state: 'signed-out' } : resolveBinding(bootstrap, session, account)),
  });
}

describe('an owner switch for a host account (the WS tap, the message sound)', () => {
  it('a bound account answers with its page’s own feature — `"*"` decides for neither page', () => {
    const flag = switchOver(ONE_OFF);
    for (const name of ['wsTap', 'sound'] as const) {
      expect(flag('chatspace', ONE.hostAccountId, name)).toBe(false);
      expect(flag('chatspace', VIP.hostAccountId, name)).toBe(true);
    }
    // The mirror image: `"*"` off, the page's own row on.
    const mirrored = switchOver({ ...BOOTSTRAP_PILOT_PAGES, bindingsByHost: {} });
    expect(BOOTSTRAP_PILOT_PAGES.flags['wsTap']).toBe(false);
    expect(mirrored('chatspace', ONE.hostAccountId, 'wsTap')).toBe(true);
  });

  it('only an account the hub definitely binds to no page follows `"*"`', () => {
    expect(switchOver(ONE_OFF)('chatspace', NOBODY.hostAccountId, 'wsTap')).toBe(true);
    expect(switchOver({ ...ONE_OFF, flags: { ...ONE_OFF.flags, wsTap: false } })('chatspace', NOBODY.hostAccountId, 'wsTap')).toBe(false);
  });

  it('a binding that cannot be told fails closed, whatever `"*"` says: an account no tab reported, a creator id not loaded yet, two pages claiming one account, another host’s account of the same id', () => {
    const flag = switchOver(ONE_OFF);
    expect(flag('chatspace', '999999', 'wsTap')).toBe(false);
    expect(flag('chatspace', LOADING.hostAccountId, 'wsTap')).toBe(false);
    expect(flag('fansly-web', VIP.hostAccountId, 'wsTap')).toBe(false);
    const twin = { ...ONE_OFF, pages: ONE_OFF.pages.map((page) => (page.pageId === WORLD.pages.one.pageId ? { ...page, platformAccountId: WORLD.pages.vip.platformAccountId } : page)) };
    expect(resolveBinding(twin, session, VIP)).toEqual({ state: 'refused', check: 'bindingAmbiguous' });
    expect(switchOver(twin)('chatspace', VIP.hostAccountId, 'wsTap')).toBe(false);
    // A binding to a page the bootstrap no longer lists is not a page that says «on».
    const gone = createAccountSwitch({ bootstrap: () => ONE_OFF, seenAccounts: () => [{ account: VIP }], resolveBinding: () => ({ state: 'bound', binding: { pageId: 404 } }) });
    expect(gone('chatspace', VIP.hostAccountId, 'wsTap')).toBe(false);
  });

  it('no bootstrap: unknown (null) — nobody is signed in, and the message sound needs no hub', () => {
    expect(switchOver(null)('chatspace', ONE.hostAccountId, 'sound')).toBeNull();
  });
});

describe('whose WS-tap facts are ours to use', () => {
  const fact = (account: HostAccount, source: 'ws-tap' | 'store') => ({ source, host: account.host, hostAccountId: account.hostAccountId });

  it('a tap fact is used only where the account’s own `wsTap` allows; a fact of the page’s own stores is not the tap’s', () => {
    const flag = switchOver(ONE_OFF);
    expect(incomingFactUsable(fact(ONE, 'ws-tap'), flag)).toBe(false);
    expect(incomingFactUsable(fact(VIP, 'ws-tap'), flag)).toBe(true);
    expect(incomingFactUsable(fact(NOBODY, 'ws-tap'), flag)).toBe(true);
    expect(incomingFactUsable(fact(LOADING, 'ws-tap'), flag)).toBe(false);
    // The stores of the page are ChatSpace's own memory: the tap's switch says nothing about them.
    expect(incomingFactUsable(fact(ONE, 'store'), flag)).toBe(true);
    // The switch asked is `wsTap` — not `sound`, which is the arbiter's own question.
    const asked: string[] = [];
    incomingFactUsable(fact(ONE, 'ws-tap'), (_host, _account, name) => (asked.push(name), true));
    expect(asked).toEqual(['wsTap']);
  });

  it('signed out there is no switch to ask: the fact is used (the message sound needs no hub)', () => {
    expect(incomingFactUsable(fact(ONE, 'ws-tap'), switchOver(null))).toBe(true);
  });
});

describe('whose human sends are ours to know (`op.reportSent`)', () => {
  const viewOn = (pageId: number) => ({ target: { binding: { pageId } } });

  it('a send of an operation is recorded only where the PAGE of the operation has `wsTap`: another page’s tap vouches for nothing', () => {
    expect(humanSendObservable(viewOn(WORLD.pages.one.pageId), ONE_OFF)).toBe(false);
    expect(humanSendObservable(viewOn(WORLD.pages.vip.pageId), ONE_OFF)).toBe(true);
    // A page the bootstrap does not list has no tap to listen to.
    expect(humanSendObservable(viewOn(404), ONE_OFF)).toBe(false);
  });

  it('no operation (forgotten by now) or no bootstrap: there is no page to ask — the report goes to its own checks as before', () => {
    expect(humanSendObservable(null, ONE_OFF)).toBe(true);
    expect(humanSendObservable(viewOn(WORLD.pages.one.pageId), null)).toBe(true);
  });
});

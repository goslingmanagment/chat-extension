// An owner switch as it stands for a HOST ACCOUNT of this browser
// (docs/protocols/hub.md «Флаги: решает страница»): what the background asks
// for an event that names an account and no page — a fan's message heard by
// the WS tap (`wsTap`: whose facts are ours to use) and the message sound
// (`sound`).
//
// - The account is bound to a hub page: that page's own feature decides.
// - The hub DEFINITELY binds it to no page (`bindingMissing`): there is no
//   page row to ask, and only there the owner's `"*"` value (the bootstrap's
//   top-level flag) decides.
// - Anything in between fails closed, `false`: no tab has reported the
//   account yet, ChatSpace has not loaded its creator id, or two pages claim
//   it. Its page may well say «off», and `"*"` is not that page's answer.
// - No bootstrap: `null`, unknown — nobody is signed in, and what needs no hub
//   (the message sound) goes on.
// And for an event that names an operation (a part sent by hand): its page and
// its site's slice of the feature manifest (`humanSendObservable`).

import type { FeatureSlice } from '@cg/contracts/features/types';
import { type Bootstrap, type ClientFeatureFlag } from '@cg/contracts/hub';
import { type HostAccount, type HostKind } from '@cg/contracts/ids';
import { admission, onPage } from '@cg/core/domain/features';
import { pageFlagState, starFlag } from '@cg/core/domain/ops';

/** How the hub layer resolved an account (`ChatExtensionHub.resolveBinding`), as far as this rule reads it. */
export type AccountBinding =
  | { readonly state: 'bound'; readonly binding: { readonly pageId: number } }
  | { readonly state: 'refused'; readonly check: string }
  | { readonly state: 'loading' | 'signed-out' };

export interface AccountSwitchDeps {
  /** The cached bootstrap of this sign-in; null — none. */
  bootstrap(): Bootstrap | null;
  /** The host accounts the tabs of this browser reported. */
  seenAccounts(): readonly { readonly account: HostAccount }[];
  resolveBinding(account: HostAccount): AccountBinding;
}

export type AccountSwitch = (host: HostKind, hostAccountId: string, flag: ClientFeatureFlag) => boolean | null;

export function createAccountSwitch(deps: AccountSwitchDeps): AccountSwitch {
  return (host, hostAccountId, flag) => {
    const bootstrap = deps.bootstrap();
    if (bootstrap === null) return null;
    const seen = deps.seenAccounts().find((entry) => entry.account.host === host && entry.account.hostAccountId === hostAccountId);
    if (seen === undefined) return false;
    const resolution = deps.resolveBinding(seen.account);
    if (resolution.state === 'bound') {
      const page = bootstrap.pages.find((candidate) => candidate.pageId === resolution.binding.pageId);
      return page !== undefined && pageFlagState(page, flag).usable;
    }
    return resolution.state === 'refused' && resolution.check === 'bindingMissing' ? starFlag(bootstrap, flag) : false;
  };
}

/**
 * Whether a fact about an incoming message may be used at all (freshness of results, the sound). The tap script
 * is registered while ANY page has `wsTap`; whose facts are heard is the account's own answer. A fact of an
 * account whose tap is off is not ours to use: it marks nothing stale and rings nothing. A fact the page's own
 * stores gave (`store`) is not the tap's, and with nobody signed in there is no switch to ask.
 */
export function incomingFactUsable(fact: { readonly source: string; readonly host: HostKind; readonly hostAccountId: string }, accountSwitch: AccountSwitch): boolean {
  return fact.source !== 'ws-tap' || accountSwitch(fact.host, fact.hostAccountId, 'wsTap') !== false;
}

/**
 * Whether a human send of an operation's part may be taken for known (`op.reportSent`: the hub's registration of
 * a greeting, telemetry `sent`). How a site sees a send by hand is the site's, and its slice of the feature manifest
 * says when (`human-send`, R20 P7i): ChatSpace's socket tells it, and that socket may be listened to only where the
 * page's own `wsTap` is usable; Fansly's MAIN sees it with no switch of the owner. Asked of the operation's page, the
 * site's capabilities left to its tab. No operation (forgotten by now) or no bootstrap: there is no page to ask, and
 * the report is taken as before — its own checks follow. No slice of the operation's site: nothing to say it is seen.
 */
export function humanSendObservable(
  view: { readonly target: { readonly binding: { readonly pageId: number; readonly host: HostKind } } } | null,
  bootstrap: Bootstrap | null,
  features: (host: HostKind) => FeatureSlice | null,
): boolean {
  if (view === null || bootstrap === null) return true;
  const { host, pageId } = view.target.binding;
  return admission(features(host), 'human-send', null, onPage(bootstrap, bootstrap.pages.find((page) => page.pageId === pageId))).state === 'on';
}

// Opening a chat on Fansly, and «Открыть и вставить» (docs/project-unite/
// architecture.md §7.6; FS-INS-4; SP-036, NEW-01). Only on a human action: the
// port spends the click's token before it gets here.
//
// - The way in: a click on the inbox row's own link `a[href="/messages/<id>"]`
//   in `div.messages-list-wrapper` when the row is rendered — the list is
//   virtual (20 groups a page, the rows near the view only), so a rendered row
//   is a row near the view; otherwise `history.pushState` and a `popstate`
//   with `state: null`, which Angular's router reads a task later (an object
//   of our world is nothing it may read). No request of ours: the page loads
//   what it loads for a click, and marks the chat read as for a click
//   (`markGroupAsRead`).
// - Checked after 2 s (SP-036): the chat opened if the old chat's container is
//   gone or another stands in its place (from no chat: a conversation is
//   there). If the address shows the target and nothing opened, or the click
//   did not move the address at all, the page is loaded by the address; a
//   deferred insert still waiting is given up then. The person's own
//   navigation meanwhile is never overridden.
// - The deferred insert (`thenInsert`): it waits for the target's own field —
//   the address on the target's group under a generation after the click, the
//   group's fan named by MAIN, the field ready and no IME composition — seen
//   the same on two ticks of ours, which are tasks: a new field gets the page's
//   cached draft in a microtask and its height in a timer of 0 ms, so the
//   second look comes after both. Then the port's one synchronous write, which
//   writes only into an empty field or our own unchanged insert; a draft of the
//   person is `rejected` with `confirm-human-draft`, and their answer comes
//   back as an open insert. The deadline is the insert's own (`expiresAt`,
//   capped by `limits.navInsertTimeoutSec`): CG-NAV-TIMEOUT. The person
//   opening another chat, another write of ours, a newer navigation and the
//   extension's own signal (sign-out, a persona or binding change) give it up:
//   CG-INSERT-CANCELED — the navigation itself stays.

import type { CgCode } from '@cg/contracts/errors';
import type { InsertReceipt, InsertWire, NavigateOptions, NavigationIntent, NavigationReceipt } from '@cg/contracts/host';

import { FANSLY_SELECTORS } from './anchors';
import { rejected } from './insert';

/** SP-036: how long the page has to show the chat before it is loaded by its address. */
export const NAV_CHECK_MS = 2000;
/** A tick of the deferred insert's wait: one task of ours. */
const STEP_MS = 25;
/** `limits.navInsertTimeoutSec` × 1000 before a bootstrap names it. */
const NAV_INSERT_DEFAULT_MS = 20_000;

/** The open chat as the port says it now. */
export interface OpenChat {
  /** The address's group; null — not a conversation. */
  readonly groupId: string | null;
  /** The group's fan, once MAIN named it for this route; null — not yet, or a group chat. */
  readonly fanId: string | null;
  /** The port's generation (its route epoch). */
  readonly generation: number;
  /** The field the port follows: its instance, ready (attached and enabled); null — none. */
  readonly composer: { readonly instanceId: string; readonly ready: boolean } | null;
  readonly composing: boolean;
  /** The conversation's container under the route; null — none. */
  readonly container: Element | null;
  /** A conversation route stands on the page. */
  readonly conversation: boolean;
}

export type NavigationWay = 'here' | 'link' | 'popstate' | 'load';

export interface NavigatorEnv {
  readonly win: Window;
  readonly creator: () => string | null;
  readonly open: () => OpenChat;
  /** The deferred write, in one synchronous step, into the field the two looks saw. */
  readonly write: (intent: InsertWire, seen: { readonly generation: number; readonly instanceId: string }) => InsertReceipt | Promise<InsertReceipt>;
  /** `limits.navInsertTimeoutSec` × 1000, read at each navigation; undefined — the default. */
  readonly timeoutMs?: () => number | undefined;
  /** The page loaded by its address (tests replace it). */
  readonly load?: (path: string) => void;
  /** Each navigation's way and outcome, for the tab's log. */
  readonly onNavigate?: (way: NavigationWay, receipt: NavigationReceipt) => void;
}

export interface Navigator {
  navigate(intent: NavigationIntent, options?: NavigateOptions): Promise<NavigationReceipt>;
  /** Another write of ours: a deferred insert still waiting is given up. */
  cancel(): void;
  dispose(): void;
}

/** The inbox row's link of a group, when the virtual list has it rendered. */
function inboxLink(doc: Document, groupId: string): HTMLElement | null {
  const href = `/messages/${groupId}`;
  for (const list of doc.getElementsByClassName(FANSLY_SELECTORS.inbox)) {
    if (list.tagName !== 'DIV') continue;
    for (const link of list.getElementsByTagName('a')) if (link.getAttribute('href') === href) return link;
  }
  return null;
}

export function createNavigator(env: NavigatorEnv): Navigator {
  const { win } = env;
  const doc = win.document;
  const load = env.load ?? ((path: string) => win.location.assign(path));
  /** The deferred insert waiting now: one at a time. */
  let waiting: { readonly cancel: () => void } | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (run: () => void, ms: number): void => {
    const timer = win.setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  };

  /** Into the chat the way a person goes: its inbox row, else the address and a `popstate` Angular reads. */
  const enter = (groupId: string, path: string): NavigationWay => {
    const link = inboxLink(doc, groupId);
    if (link !== null) {
      link.click();
      return 'link';
    }
    win.history.pushState(null, '', path);
    win.dispatchEvent(new PopStateEvent('popstate', { state: null }));
    return 'popstate';
  };

  /** SP-036: did the chat open? If not — and the person did not go elsewhere — the page loads it by its address. */
  const verify = (path: string, before: OpenChat, moved: number): void => {
    const now = env.open();
    const here = win.location.pathname === path;
    const opened = before.container === null ? now.conversation : !before.container.isConnected || (now.container !== null && now.container !== before.container);
    // The address went elsewhere after the click: the person's own navigation.
    if ((here && opened) || (!here && now.generation !== moved)) return;
    waiting?.cancel();
    load(path);
  };

  const navigate = (intent: NavigationIntent, options: NavigateOptions = {}): Promise<NavigationReceipt> => {
    const then = intent.thenInsert;
    const target = intent.target;
    let way: NavigationWay = 'here';
    const said = (receipt: NavigationReceipt): NavigationReceipt => {
      env.onNavigate?.(way, receipt);
      return receipt;
    };
    const failed = (code: CgCode): NavigationReceipt => said({ state: 'failed', code, insert: then === undefined ? null : rejected(code) });
    // A newer navigation gives the older insert up (the person chose again).
    waiting?.cancel();
    const start = env.open();
    // Fansly's tab is one creator's: another account cannot be opened from it.
    if (target.hostAccountId !== env.creator()) return Promise.resolve(failed('CG-NAV-FAILED'));
    // The account itself (Б13): it is the one open.
    if (target.platformFanId === null) return Promise.resolve(said({ state: 'navigated', routeEpoch: start.generation, insert: null }));
    // The fan's conversation is its group (FS-IDN-6): named by the target, or the open chat's when it is that fan's.
    const groupId = target.conversationRef ?? (start.fanId === target.platformFanId ? start.groupId : null);
    if (groupId === null) return Promise.resolve(failed('CG-NAV-FAILED'));
    const path = `/messages/${groupId}`;
    const already = start.groupId === groupId;
    /** A field of this generation or before is not the target's: the field to write into comes after the click. */
    const since = already ? start.generation - 1 : start.generation;
    if (!already) {
      try {
        way = enter(groupId, path);
      } catch {
        return Promise.resolve(failed('CG-NAV-FAILED'));
      }
      const moved = env.open().generation;
      later(() => verify(path, start, moved), NAV_CHECK_MS);
    }
    const timeout = env.timeoutMs?.() ?? NAV_INSERT_DEFAULT_MS;
    const deadline = then === undefined ? Date.now() + NAV_CHECK_MS : Math.min(then.expiresAt, Date.now() + (timeout > 0 ? timeout : NAV_INSERT_DEFAULT_MS));

    return new Promise<NavigationReceipt>((resolve) => {
      let settled = false;
      let last = '';
      let stable = 0;
      const signal = options.signal;
      const finish = (receipt: NavigationReceipt | Promise<NavigationReceipt>): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', step);
        if (waiting === self) waiting = null;
        resolve(Promise.resolve(receipt).then(said));
      };
      const navigated = (insert: InsertReceipt | null): NavigationReceipt => ({ state: 'navigated', routeEpoch: env.open().generation, insert });
      const self = { cancel: () => finish(navigated(then === undefined ? null : rejected('CG-INSERT-CANCELED'))) };
      function step(): void {
        if (settled) return;
        if (then !== undefined && signal?.aborted === true) return self.cancel();
        const now = env.open();
        const arrived = now.groupId === groupId && now.generation > since;
        // The address moved, and not to the target: the person went elsewhere.
        if (!arrived && now.generation > since && now.groupId !== groupId) return then === undefined ? finish(failed('CG-NAV-FAILED')) : self.cancel();
        if (then === undefined) {
          if (arrived || already) return finish(navigated(null));
          if (Date.now() > deadline) return finish(failed('CG-NAV-FAILED'));
          return later(step, STEP_MS);
        }
        if (Date.now() > deadline) return finish({ state: 'failed', code: 'CG-NAV-TIMEOUT', insert: rejected('CG-NAV-TIMEOUT') });
        const field = now.composer;
        const key = arrived && now.fanId === target.platformFanId && field !== null && field.ready && !now.composing ? `${now.generation}:${field.instanceId}` : '';
        stable = key !== '' && key === last ? stable + 1 : key === '' ? 0 : 1;
        last = key;
        if (stable < 2 || field === null) return later(step, STEP_MS);
        // Written now, in this task: nothing gives it up any more.
        settled = true;
        signal?.removeEventListener('abort', step);
        if (waiting === self) waiting = null;
        const receipt = env.write(then, { generation: now.generation, instanceId: field.instanceId });
        resolve(Promise.resolve(receipt).then((insert) => said({ state: 'navigated', routeEpoch: now.generation, insert })));
      }
      if (then !== undefined) {
        waiting = self;
        signal?.addEventListener('abort', step, { once: true });
      }
      // The first look comes a task later: a link's navigation runs in the router's own microtasks first.
      later(step, 0);
    });
  };

  return {
    navigate,
    cancel: () => waiting?.cancel(),
    dispose() {
      waiting?.cancel();
      for (const timer of timers) win.clearTimeout(timer);
      timers.clear();
    },
  };
}

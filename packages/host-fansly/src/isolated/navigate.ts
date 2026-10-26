// Opening a chat on Fansly, and «Открыть и вставить» (docs/project-unite/
// architecture.md §7.6; FS-INS-4; SP-036, NEW-01). Only on a human action: the
// port spends the click's token before it gets here.
//
// - The target's group: the one the target names, the open chat's for its own
//   fan, else (2026-10-26) the fan's direct group MAIN already received from
//   the page (`fx.groupForFan`). None of them: nothing moves.
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
//   capped by `limits.navInsertTimeoutSec`): CG-NAV-TIMEOUT. Any change of
//   route while it waits — seen as it happens, not only where a look falls:
//   away, or away and back — another write of ours, a newer navigation and
//   the extension's own signal (sign-out, a persona or binding change) give
//   it up: CG-INSERT-CANCELED — the navigation itself stays.
// - Only the latest navigation lives: a newer one, a write of ours into the
//   open chat and the port's end stop it, its 2-second check with it — a
//   check of an older choice never loads a chat over a newer one.

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
  /** Each change of the port's route as it happens (after the port took it); returns the unsubscription. */
  readonly onRoute: (listener: () => void) => () => void;
  /**
   * The fan's direct group as the page already received it (MAIN's memory, `fx.groupForFan`; no request of ours), for a
   * target that names no conversation (2026-10-26: a row of the palette the hub named no chat for). Absent — none.
   */
  readonly groupForFan?: (creatorId: string, fanId: string) => Promise<string | null>;
  /** Each navigation's way and outcome, for the tab's log. */
  readonly onNavigate?: (way: NavigationWay, receipt: NavigationReceipt) => void;
}

export interface Navigator {
  navigate(intent: NavigationIntent, options?: NavigateOptions): Promise<NavigationReceipt>;
  /** Another write of ours into the open chat: the latest navigation stops — its waiting insert, its 2-second check. */
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
  let disposed = false;
  /**
   * The latest navigation: its wait and its 2-second check. A newer choice of the person, a write of ours into the
   * open chat and the port's end stop it — its check never loads a chat over what came after (review of P7e).
   */
  let current: { readonly stop: () => void } | null = null;
  /** Grows with every navigation and every stop: a navigation still asking MAIN for its group is no longer the latest. */
  let latest = 0;

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

  const navigate = async (intent: NavigationIntent, options: NavigateOptions = {}): Promise<NavigationReceipt> => {
    const then = intent.thenInsert;
    const target = intent.target;
    let way: NavigationWay = 'here';
    const said = (receipt: NavigationReceipt): NavigationReceipt => {
      env.onNavigate?.(way, receipt);
      return receipt;
    };
    const failed = (code: CgCode): NavigationReceipt => said({ state: 'failed', code, insert: then === undefined ? null : rejected(code) });
    // A newer navigation stops the older one: its insert is given up, its check will load nothing.
    current?.stop();
    current = null;
    const mine = (latest += 1);
    if (disposed) return failed('CG-NAV-FAILED');
    let start = env.open();
    // Fansly's tab is one creator's: another account cannot be opened from it.
    if (target.hostAccountId !== env.creator()) return failed('CG-NAV-FAILED');
    // The account itself (Б13): it is the one open.
    if (target.platformFanId === null) return said({ state: 'navigated', routeEpoch: start.generation, insert: null });
    // The fan's conversation is its group (FS-IDN-6): named by the target, or the open chat's when it is that fan's,
    // else (2026-10-26) the fan's direct group as the page already received it — MAIN's memory, never a request of ours.
    let groupId = target.conversationRef ?? (start.fanId === target.platformFanId ? start.groupId : null);
    if (groupId === null && env.groupForFan !== undefined) {
      groupId = await env.groupForFan(target.hostAccountId, target.platformFanId).catch(() => null);
      // A newer navigation, a write of ours or the port's end meanwhile, or another creator: this one is over.
      if (disposed || mine !== latest || target.hostAccountId !== env.creator()) return failed('CG-NAV-FAILED');
      start = env.open();
    }
    if (groupId === null) return failed('CG-NAV-FAILED');
    const path = `/messages/${groupId}`;
    const already = start.groupId === groupId;
    /** A field of this generation or before is not the target's: the field to write into comes after the click. */
    const since = already ? start.generation - 1 : start.generation;
    const timeout = env.timeoutMs?.() ?? NAV_INSERT_DEFAULT_MS;
    const deadline = then === undefined ? Date.now() + NAV_CHECK_MS : Math.min(then.expiresAt, Date.now() + (timeout > 0 ? timeout : NAV_INSERT_DEFAULT_MS));

    return new Promise<NavigationReceipt>((resolve) => {
      let settled = false;
      let last = '';
      let stable = 0;
      let step: ReturnType<typeof setTimeout> | null = null;
      let check: ReturnType<typeof setTimeout> | null = null;
      /** The generation the deferred insert's target was reached in; any change of route after it gives the insert up. */
      let arrivedAt: number | null = already ? start.generation : null;
      const signal = then === undefined ? undefined : options.signal;
      let offRoute = (): void => undefined;
      const finish = (receipt: NavigationReceipt | Promise<NavigationReceipt>): void => {
        if (settled) return;
        settled = true;
        if (step !== null) win.clearTimeout(step);
        signal?.removeEventListener('abort', look);
        offRoute();
        resolve(Promise.resolve(receipt).then(said));
      };
      const navigated = (insert: InsertReceipt | null): NavigationReceipt => ({ state: 'navigated', routeEpoch: env.open().generation, insert });
      /** Given up: the insert is canceled, the navigation itself stays; a plain one that has not arrived did not happen. */
      const giveUp = (): void => finish(then === undefined ? { state: 'failed', code: 'CG-NAV-FAILED', insert: null } : navigated(rejected('CG-INSERT-CANCELED')));
      const self = {
        stop() {
          if (check !== null) win.clearTimeout(check);
          check = null;
          giveUp();
        },
      };
      current = self;
      const later = (run: () => void, ms: number): void => {
        step = win.setTimeout(() => {
          step = null;
          run();
        }, ms);
      };

      /** SP-036: did the chat open? If not — and the person did not go elsewhere — the page loads it by its address. */
      const verify = (moved: number): void => {
        check = null;
        if (disposed) return;
        const now = env.open();
        const here = win.location.pathname === path;
        const opened = start.container === null ? now.conversation : !start.container.isConnected || (now.container !== null && now.container !== start.container);
        // The address went elsewhere after the click: the person's own navigation.
        if ((here && opened) || (!here && now.generation !== moved)) return;
        giveUp();
        load(path);
      };

      function look(): void {
        if (settled) return;
        if (then !== undefined && signal?.aborted === true) return giveUp();
        const now = env.open();
        if (then === undefined) {
          // The address moved, and not to the target: the person went elsewhere.
          if (now.groupId === groupId && (already || now.generation > since)) return finish(navigated(null));
          if ((now.generation > since && now.groupId !== groupId) || Date.now() > deadline) return finish(failed('CG-NAV-FAILED'));
          return later(look, STEP_MS);
        }
        // The page's life or its creator moved since the target was reached: not the visit the insert was meant for.
        if (arrivedAt !== null && now.generation !== arrivedAt) return giveUp();
        if (Date.now() > deadline) return finish({ state: 'failed', code: 'CG-NAV-TIMEOUT', insert: rejected('CG-NAV-TIMEOUT') });
        const field = now.composer;
        const key = arrivedAt !== null && now.groupId === groupId && now.fanId === target.platformFanId && field !== null && field.ready && !now.composing ? `${now.generation}:${field.instanceId}` : '';
        stable = key !== '' && key === last ? stable + 1 : key === '' ? 0 : 1;
        last = key;
        if (stable < 2 || field === null) return later(look, STEP_MS);
        // Written now, in this task: nothing gives it up any more.
        settled = true;
        signal?.removeEventListener('abort', look);
        offRoute();
        const receipt = env.write(then, { generation: now.generation, instanceId: field.instanceId });
        resolve(Promise.resolve(receipt).then((insert) => said({ state: 'navigated', routeEpoch: now.generation, insert })));
      }

      if (then !== undefined) {
        signal?.addEventListener('abort', look, { once: true });
        // Every change of route while the insert waits, seen as it happens — not only where a look of ours falls: the
        // first one to the target is the arrival, any other one (away, or away and back) gives the insert up.
        offRoute = env.onRoute(() => {
          if (settled) return;
          const now = env.open();
          if (arrivedAt === null && now.groupId === groupId) arrivedAt = now.generation;
          else giveUp();
        });
      }
      if (!already) {
        try {
          way = enter(groupId, path);
        } catch {
          return finish(failed('CG-NAV-FAILED'));
        }
        const moved = env.open().generation;
        check = win.setTimeout(() => verify(moved), NAV_CHECK_MS);
      }
      // The first look comes a task later: a link's navigation runs in the router's own microtasks first.
      later(look, 0);
    });
  };

  return {
    navigate,
    cancel() {
      latest += 1;
      current?.stop();
    },
    dispose() {
      disposed = true;
      current?.stop();
      current = null;
    },
  };
}

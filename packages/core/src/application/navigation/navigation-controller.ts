// Chat navigation of the tab (architecture.md §6.9, D-30; HK-037, HK-039,
// NEW-07, CS-006): J/K, ⌘U, ⌘1–9 and the palette's «перейти» go through
// ChatSpace's own router — `HostPort.navigate`, the same thing a click on a
// row of its list does — and only as the result of a person's action: every
// navigation spends a one-time `navigate` token the background issued for it
// (§14). The order comes from the list ChatSpace already holds; nothing is
// loaded for navigation, and a chat is never opened by a timer, a toast or a
// finished generation.

import { type CgCode } from '@cg/contracts/errors';
import { type Surface } from '@cg/contracts/features';
import { type HostPort, type NavigationItem } from '@cg/contracts/host';
import { type ChatRef } from '@cg/contracts/ids';
import { NATIVE_ID_PATTERN } from '@cg/contracts/primitives';
import { type ActionReceipt, type I18n, type NavigationTarget, type ToastPort, type UiAction } from '@cg/contracts/vm';

import { chatAtSlot, nextUnreadChat, stepChat } from '../../domain/navigation';
import { type OverlayState } from './overlays';
import { failedReceipt, type IdPort, type SurfaceController, type TabClock, type TabRpc } from './ports';

/** The surface every navigation token of R17 is issued for; the redeemer of HostPort uses the same one. */
export const NAVIGATION_SURFACE: Surface = 'overlay';
/** Rows of the cached list navigation looks at: far more than a person walks with J/K. */
export const NAVIGATION_LIST_LIMIT = 500;
/**
 * The host port answers `listCachedChats` at once from its own cache and
 * only then refreshes it in the background — nothing tells it when another
 * chat moves up in ChatSpace's list, so the first answer may be minutes old.
 * Navigation reads the list, gives the refresh this long to land, and acts
 * on the second answer: a key must open the chat the person sees in that
 * row (opening a chat marks it read on OnlyFans).
 */
export const LIST_SETTLE_MS = 150;
/** A list settled this recently is the list ChatSpace shows: the next key in a row does not wait again. */
export const LIST_FRESH_MS = 1000;

const CHAT_HANDLE = 'nav.chat.';
const ACCOUNT_HANDLE = 'nav.acc.';

/** `nav.chat.<account>.<fan>`: the palette's and the quick jump's name for a chat; opaque to the UI. */
export function chatHandle(chat: Pick<ChatRef, 'hostAccountId' | 'platformFanId'>): string {
  return `${CHAT_HANDLE}${chat.hostAccountId}.${chat.platformFanId}`;
}

export function accountHandle(hostAccountId: string): string {
  return `${ACCOUNT_HANDLE}${hostAccountId}`;
}

export function parseChatHandle(handle: string): { readonly hostAccountId: string; readonly platformFanId: string } | null {
  if (!handle.startsWith(CHAT_HANDLE)) return null;
  const [hostAccountId, platformFanId, extra] = handle.slice(CHAT_HANDLE.length).split('.');
  if (hostAccountId === undefined || platformFanId === undefined || extra !== undefined) return null;
  return NATIVE_ID_PATTERN.test(hostAccountId) && NATIVE_ID_PATTERN.test(platformFanId) ? { hostAccountId, platformFanId } : null;
}

export function parseAccountHandle(handle: string): string | null {
  if (!handle.startsWith(ACCOUNT_HANDLE)) return null;
  const id = handle.slice(ACCOUNT_HANDLE.length);
  return NATIVE_ID_PATTERN.test(id) ? id : null;
}

/** Whether the next dispatched navigation came from a key (the hotkey runner says so right before it dispatches). */
export interface CauseHint {
  mark(kind: 'key'): void;
  take(): 'click' | 'key';
}

export function createCauseHint(): CauseHint {
  let next: 'click' | 'key' = 'click';
  return {
    mark(kind) {
      next = kind;
    },
    take() {
      const kind = next;
      next = 'click';
      return kind;
    },
  };
}

export interface NavigationControllerDeps {
  readonly host: HostPort;
  readonly rpc: Pick<TabRpc, 'request'>;
  readonly i18n: I18n;
  readonly ids: IdPort;
  readonly clock: TabClock;
  readonly overlays: OverlayState;
  /** The owner's `navigation` switch of bootstrap; null — unknown (signed out): ChatSpace's own list needs no hub. */
  readonly ownerSwitch?: () => boolean | null;
  readonly toasts?: ToastPort;
  readonly cause?: CauseHint;
}

export interface NavigationController extends SurfaceController {
  /** Opens a chat (or an account, `platformFanId: null`) through ChatSpace's router; `cause` — a click unless said otherwise. */
  open(target: { readonly hostAccountId: string; readonly platformFanId: string | null }, cause?: 'click' | 'key'): Promise<ActionReceipt>;
  /** The account whose chat list is on screen, or null. */
  currentAccountId(): string | null;
}

/** The overlays R17's own controllers own: the palette, the quick jump, the cheatsheet. */
const OWN_SURFACES: readonly string[] = ['palette', 'quick-jump', 'cheatsheet'];

export function createNavigationController(deps: NavigationControllerDeps): NavigationController {
  const { host, i18n, overlays } = deps;
  let inFlight = false;

  const fail = (code: CgCode): ActionReceipt => failedReceipt('Navigate', code, i18n);
  const done = (outcome: 'opened' | 'noop' | 'done'): ActionReceipt => ({ ok: true, type: 'Navigate', outcome });

  const currentAccountId = (): string | null => {
    const snapshot = host.current();
    return snapshot.route.account?.hostAccountId ?? snapshot.route.chat?.hostAccountId ?? snapshot.identity?.hostAccountId ?? null;
  };

  const wait = (ms: number): Promise<void> => new Promise((resolve) => void deps.clock.setTimer(ms, resolve));

  /** When this controller last read each account's list after letting the port's refresh land. */
  const settledAt = new Map<string, number>();

  /** The list ChatSpace holds for the account, as it is now: the first read starts the port's refresh, the second is the answer. */
  const readList = async (accountId: string): Promise<readonly NavigationItem[]> => {
    const first = host.listCachedChats(accountId, NAVIGATION_LIST_LIMIT);
    const settled = settledAt.get(accountId);
    if (first.length > 0 && settled !== undefined && deps.clock.now() - settled <= LIST_FRESH_MS) return first;
    await wait(LIST_SETTLE_MS);
    const fresh = host.listCachedChats(accountId, NAVIGATION_LIST_LIMIT);
    settledAt.set(accountId, deps.clock.now());
    return fresh;
  };

  const open: NavigationController['open'] = async (target, cause = 'click') => {
    if (deps.ownerSwitch?.() === false) return fail('CG-FEATURE-DISABLED');
    const capability = host.current().contract.capabilities.navigate;
    if (capability.state === 'off' || capability.state === 'contractBroken') return fail('CG-HOST-CONTRACT');
    // One navigation at a time: a second key while ChatSpace's router is still moving is not queued.
    if (inFlight) return done('noop');
    inFlight = true;
    try {
      const issued = await deps.rpc.request('token.issue', { kind: 'navigate', surface: NAVIGATION_SURFACE });
      if (!issued.ok) return fail(issued.error.code);
      const receipt = await host.navigate({
        intentId: deps.ids.uuid(),
        cause: { kind: cause, actionToken: issued.payload.actionToken },
        target: { hostAccountId: target.hostAccountId, platformFanId: target.platformFanId },
      });
      if (receipt.state !== 'navigated') return fail(receipt.code);
      // The chat is on screen now: the windows that led to it close.
      overlays.set('palette', false);
      overlays.set('quick-jump', false);
      return done('opened');
    } catch {
      return fail('CG-NAV-FAILED');
    } finally {
      inFlight = false;
    }
  };

  const walk = async (to: Extract<NavigationTarget, { kind: 'chat-step' | 'next-unread' | 'chat-slot' }>, cause: 'click' | 'key'): Promise<ActionReceipt> => {
    if (deps.ownerSwitch?.() === false) return fail('CG-FEATURE-DISABLED');
    const accountId = currentAccountId();
    if (accountId === null) return done('noop');
    const list = host.current().contract.capabilities.chatList;
    // §6.2: a broken `chatList` anchor switches J/K, ⌘U and ⌘1–9 off, with the reason.
    if (list.state === 'off' || list.state === 'contractBroken') return fail('CG-HOST-CONTRACT');
    const items = await readList(accountId);
    // The route is read after the list settled: the person may have clicked elsewhere meanwhile.
    if (currentAccountId() !== accountId) return done('noop');
    const here = host.current().route.chat?.platformFanId ?? null;
    const target = to.kind === 'chat-step' ? stepChat(items, here, to.direction) : to.kind === 'next-unread' ? nextUnreadChat(items, here) : chatAtSlot(items, to.slot);
    if (target === null) {
      if (to.kind === 'next-unread') deps.toasts?.show({ kind: 'info', code: null, scope: 'navigation', title: { key: 'toast.noUnread' }, body: null });
      return done('noop');
    }
    if (target.chat.platformFanId === here) return done('noop');
    return open({ hostAccountId: target.chat.hostAccountId, platformFanId: target.chat.platformFanId }, cause);
  };

  const dispatch = (action: UiAction): Promise<ActionReceipt> | null => {
    if (action.type !== 'Navigate') return null;
    const to = action.to;
    // The key's mark belongs to this very dispatch. It is taken here, whatever comes of the navigation — nothing to
    // open, a router still moving, a refusal — so it never rides on a later click.
    const cause = deps.cause?.take() ?? 'click';
    if (to.kind === 'chat-step' || to.kind === 'next-unread' || to.kind === 'chat-slot') return walk(to, cause);
    if (to.kind === 'chat') {
      const chat = parseChatHandle(to.targetHandle);
      return chat === null ? null : open(chat, cause);
    }
    if (to.kind === 'account') {
      const hostAccountId = parseAccountHandle(to.accountHandle);
      return hostAccountId === null ? null : open({ hostAccountId, platformFanId: null }, cause);
    }
    if (to.kind === 'surface' && OWN_SURFACES.includes(to.surface)) {
      const was = overlays.isOpen(to.surface);
      overlays.set(to.surface, to.open);
      return Promise.resolve(done(was === to.open ? 'noop' : to.open ? 'opened' : 'done'));
    }
    return null;
  };

  return {
    kinds: [],
    getSnapshot: () => undefined,
    subscribe: () => () => undefined,
    dispatch,
    open,
    currentAccountId,
  };
}

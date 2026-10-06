// The quick-jump popup (architecture.md §9.1, §10.2 QuickJumpVM; NEW-07):
// ⌘/Ctrl held alone for 400 ms shows the first nine chats of the list the
// person sees, numbered — our own window, nothing is drawn into ChatSpace's
// rows (Б9). A digit under the held modifier opens that chat; letting the
// modifier go closes the popup. The view itself reads the host only; whether
// the popup may open at all is the owner's `navigation` switch of the account
// on screen, asked by the navigation controller that opens it — so the popup
// is for one account: when the account on screen changes it closes, and the
// next hold asks that account's own switch.
//
// A row names its chat, not its place: the action of row N is «open this
// chat», so a click or a digit opens what the person sees in that row even
// if ChatSpace's list has moved since the popup was drawn (opening a chat
// marks it read on OnlyFans). The view is kept as shown and rebuilt only
// when the popup is told to look again.

import { type HostPort } from '@cg/contracts/host';
import { type I18n, type QuickJumpVM, type UiAction, type ViewSelector, type VmView } from '@cg/contracts/vm';

import { QUICK_JUMP_SLOTS, quickJumpRows } from '../../domain/navigation';
import { LIST_SETTLE_MS, chatHandle } from './navigation-controller';
import { type OverlayState } from './overlays';
import { codeView, createEmitter, type SurfaceController, type TabClock } from './ports';

export interface QuickJumpControllerDeps {
  readonly host: HostPort;
  readonly i18n: I18n;
  readonly overlays: OverlayState;
  readonly clock: TabClock;
}

export function createQuickJumpController(deps: QuickJumpControllerDeps): SurfaceController & { dispose(): void } {
  const { host, overlays } = deps;
  const changes = createEmitter();
  let wasOpen = overlays.isOpen('quick-jump');

  const accountOnScreen = (): string | null => {
    const { route } = host.current();
    return route.account?.hostAccountId ?? route.chat?.hostAccountId ?? null;
  };
  /** The account the open popup was allowed for. */
  let openedFor: string | null = accountOnScreen();

  const build = (): QuickJumpVM => {
    const snapshot = host.current();
    const accountId = accountOnScreen();
    const capability = snapshot.contract.capabilities.chatList;
    if (capability.state === 'off' || capability.state === 'contractBroken') {
      return { view: { s: 'error', error: codeView('CG-HOST-CONTRACT', deps.i18n), retry: null }, items: [] };
    }
    const rows = accountId === null ? [] : quickJumpRows(host.listCachedChats(accountId, QUICK_JUMP_SLOTS));
    const view: VmView =
      rows.length === 0 ? { s: 'empty', why: { key: 'quickJump.empty' } } : capability.state === 'degraded' ? { s: 'partial', gaps: [{ kind: 'host-degraded', capabilities: ['chatList'] }] } : { s: 'ready' };
    return {
      view,
      items: rows.map(({ slot, item }) => ({
        slot,
        name: item.displayName,
        username: item.username,
        unread: item.unreadCount,
        action: { type: 'Navigate', to: { kind: 'chat', targetHandle: chatHandle(item.chat) } } satisfies UiAction,
      })),
    };
  };

  /** The view as last shown: the popup's rows and what a digit under it opens are the same thing. */
  let shown: QuickJumpVM | null = null;
  const view = (): QuickJumpVM => (shown ??= build());
  /** Reads the list now — whether or not anybody is subscribed yet — and tells the popup. */
  const look = (): void => {
    shown = build();
    changes.emit();
  };

  const unsubscribeOverlays = overlays.subscribe(() => {
    const open = overlays.isOpen('quick-jump');
    if (open === wasOpen) return;
    wasOpen = open;
    if (!open) {
      shown = null;
      changes.emit();
      return;
    }
    openedFor = accountOnScreen();
    // The host port answers from its own copy and only then reads ChatSpace's list again: this look starts
    // that read, the second one shows what it brought.
    look();
    void deps.clock.setTimer(LIST_SETTLE_MS, () => overlays.isOpen('quick-jump') && look());
  });
  const unsubscribeHost = host.subscribe((event) => {
    if (!overlays.isOpen('quick-jump') || (event.type !== 'route' && event.type !== 'accounts')) return;
    // Another account is on screen: its chats are not shown under the permission of the one before.
    if (accountOnScreen() !== openedFor) overlays.set('quick-jump', false);
    else look();
  });

  return {
    kinds: ['quick-jump'],
    // Closed, nobody looks at it: built on demand. Open: as shown.
    getSnapshot: (selector: ViewSelector) => (selector.of === 'quick-jump' ? (overlays.isOpen('quick-jump') ? view() : build()) : undefined),
    subscribe(selector, listener) {
      if (selector.of !== 'quick-jump') return () => undefined;
      return changes.on(() => listener(view()));
    },
    // Opening and closing is the navigation controller's (`Navigate surface`); a row opens its chat through it too.
    dispatch: () => null,
    dispose() {
      unsubscribeOverlays();
      unsubscribeHost();
    },
  };
}

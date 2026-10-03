// The quick-jump popup (architecture.md §9.1, §10.2 QuickJumpVM; NEW-07):
// ⌘/Ctrl held alone for 400 ms shows the first nine chats of the list the
// person sees, numbered — our own window, nothing is drawn into ChatSpace's
// rows (Б9). A digit under the held modifier opens that chat; letting the
// modifier go closes the popup. A host-only view: no hub, no sign-in.

import { type HostPort } from '@cg/contracts/host';
import { type I18n, type QuickJumpVM, type UiAction, type ViewSelector, type VmView } from '@cg/contracts/vm';

import { QUICK_JUMP_SLOTS, quickJumpRows } from '../../domain/navigation';
import { LIST_SETTLE_MS } from './navigation-controller';
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

  const build = (): QuickJumpVM => {
    const snapshot = host.current();
    const accountId = snapshot.route.account?.hostAccountId ?? snapshot.route.chat?.hostAccountId ?? null;
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
        action: { type: 'Navigate', to: { kind: 'chat-slot', slot } } satisfies UiAction,
      })),
    };
  };

  const unsubscribeOverlays = overlays.subscribe(() => {
    const open = overlays.isOpen('quick-jump');
    if (open === wasOpen) return;
    wasOpen = open;
    changes.emit();
    // The host port refreshes its list cache in the background: look once more when it has.
    if (open) void deps.clock.setTimer(LIST_SETTLE_MS, () => overlays.isOpen('quick-jump') && changes.emit());
  });
  const unsubscribeHost = host.subscribe((event) => {
    if (overlays.isOpen('quick-jump') && (event.type === 'route' || event.type === 'accounts')) changes.emit();
  });

  return {
    kinds: ['quick-jump'],
    getSnapshot: (selector: ViewSelector) => (selector.of === 'quick-jump' ? build() : undefined),
    subscribe(selector, listener) {
      if (selector.of !== 'quick-jump') return () => undefined;
      return changes.on(() => listener(build()));
    },
    // Opening and closing is the navigation controller's (`Navigate surface`), a slot is its `chat-slot`.
    dispatch: () => null,
    dispose() {
      unsubscribeOverlays();
      unsubscribeHost();
    },
  };
}

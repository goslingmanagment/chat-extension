// Global hotkeys of the layout (metadata.ts «global-hotkeys»), registered on
// `window` in capture when the layout mounts — i.e. after any document_start
// listener. Only combos with Ctrl/Alt/Meta or a named key count; the combo
// string is built from `key`. Ctrl+Tab / Ctrl+Shift+Tab switch chat tabs.
// Escape is a «last resort»: it closes the active chat tab unless focus is in
// an input/textarea (a contenteditable composer does NOT count) or a
// `[data-dismissible-open]`, dialog, listbox or menu is visible.

import { record } from '../journal';

export interface HotkeyActions {
  readonly closeActiveChatTab: (via: string) => void;
  readonly switchChatTab: (step: 1 | -1) => void;
}

const DISMISSIBLE = '[data-dismissible-open], [role="dialog"], [role="listbox"], [role="menu"]';

const isCombo = (event: KeyboardEvent): boolean => event.ctrlKey || event.altKey || event.metaKey || event.key.length > 1;
const comboOf = (event: KeyboardEvent): string =>
  [event.ctrlKey && 'ctrl', event.altKey && 'alt', event.metaKey && 'meta', event.shiftKey && 'shift', event.key.toLowerCase()].filter(Boolean).join('+');

function somethingDismissibleOpen(): boolean {
  return [...document.querySelectorAll(DISMISSIBLE)].some((element) => element.checkVisibility());
}

function lastResortBlocked(): boolean {
  return document.activeElement?.matches('input, textarea') === true || somethingDismissibleOpen();
}

export function installGlobalHotkeys(actions: HotkeyActions): () => void {
  const bindings: ReadonlyArray<{ combo: string; lastResort: boolean; run: () => void }> = [
    { combo: 'ctrl+tab', lastResort: false, run: () => actions.switchChatTab(1) },
    { combo: 'ctrl+shift+tab', lastResort: false, run: () => actions.switchChatTab(-1) },
    { combo: 'escape', lastResort: true, run: () => actions.closeActiveChatTab('escape') },
  ];
  const onKeydown = (event: KeyboardEvent): void => {
    if (!isCombo(event)) return;
    const combo = comboOf(event);
    const binding = bindings.find((item) => item.combo === combo);
    if (binding === undefined) return;
    if (!binding.lastResort) {
      event.preventDefault();
      binding.run();
      return;
    }
    if (lastResortBlocked()) {
      record('hotkey-last-resort-skipped', { combo });
      return;
    }
    binding.run();
  };
  window.addEventListener('keydown', onKeydown, { capture: true });
  return () => window.removeEventListener('keydown', onKeydown, { capture: true });
}

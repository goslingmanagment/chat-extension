// Keys of the Spenders board and its preview (SP-033, SP-056; ui-design
// §6.4). Keys are read by `code`, not by the letter they print, so J/K, O
// and S work in the Russian layout too (the Fansly board read `key` and lost
// them). Nothing fires while the person types in one of our fields or with
// a modifier held, and the IME's composition keys are never ours.

/** What a key asks of the board; the controller turns it into its action. */
export type BoardCommand =
  | 'row-next'
  | 'row-previous'
  | 'open-chat'
  | 'preview'
  | 'toggle-stats'
  | 'focus-search'
  /** Esc, in order: clear the search → close the preview → close the board. */
  | 'clear-search'
  | 'close-preview'
  | 'close-board'
  | 'fan-next'
  | 'fan-previous';

export interface BoardKey {
  /** KeyboardEvent.code («KeyJ», «ArrowDown», «Slash», «Escape»). */
  readonly code: string;
  readonly ctrl: boolean;
  readonly meta: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  /** An IME composition is going on (KeyboardEvent.isComposing or keyCode 229). */
  readonly composing: boolean;
}

export interface BoardKeyContext {
  /** The caret is in one of our text fields (the search, the preview's draft). */
  readonly typing: boolean;
  /** The search field holds text. */
  readonly searching: boolean;
  readonly previewOpen: boolean;
  /** Focus is inside the preview (its keys move between fans, not rows). */
  readonly inPreview: boolean;
}

function escape(ctx: BoardKeyContext): BoardCommand {
  if (ctx.searching) return 'clear-search';
  return ctx.previewOpen ? 'close-preview' : 'close-board';
}

/** The command of a key press, or null when the key is not the board's. */
export function boardCommand(key: BoardKey, ctx: BoardKeyContext): BoardCommand | null {
  if (key.composing) return null;
  if (key.ctrl || key.meta || key.alt) return null;
  if (key.code === 'Escape') return escape(ctx);
  // Letters, the slash and the space are text while the person types.
  if (ctx.typing) return null;
  if (ctx.inPreview) {
    if (key.shift) return null;
    if (key.code === 'ArrowRight' || key.code === 'KeyJ') return 'fan-next';
    if (key.code === 'ArrowLeft' || key.code === 'KeyK') return 'fan-previous';
    return null;
  }
  switch (key.code) {
    case 'ArrowDown':
    case 'KeyJ':
      return key.shift ? null : 'row-next';
    case 'ArrowUp':
    case 'KeyK':
      return key.shift ? null : 'row-previous';
    case 'Enter':
    case 'NumpadEnter':
    case 'KeyO':
      return key.shift ? null : 'open-chat';
    case 'Space':
      return key.shift ? null : 'preview';
    case 'KeyS':
      return key.shift ? null : 'toggle-stats';
    case 'Slash':
      // «/» without Shift; with Shift it is «?», the cheatsheet's key.
      return key.shift ? null : 'focus-search';
    default:
      return null;
  }
}

/** The row a movement lands on; stays at either end, starts from the first row when nothing is focused. */
export function moveRow(order: readonly string[], current: string | null, direction: 'next' | 'previous'): string | null {
  if (order.length === 0) return null;
  const at = current === null ? -1 : order.indexOf(current);
  if (at < 0) return order[0] ?? null;
  const next = direction === 'next' ? Math.min(order.length - 1, at + 1) : Math.max(0, at - 1);
  return order[next] ?? null;
}

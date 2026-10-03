// Whose key is it (architecture.md §9.1 «Приоритет», «Кому принадлежит
// клавиша», «Политика»; HK-024…HK-029, HK-042). A pure decision over what
// the early dispatcher saw in one synchronous look at the page:
//
//   1. a native modal window and IME — theirs, always;
//   2. our top dialog;
//   3. the palette, a board, a preview;
//   4. the dock's actions;
//   5. chat navigation.
//
// `claim` — the key is ours: the dispatcher calls preventDefault and
// stopImmediatePropagation before any listener of ChatSpace, then runs the
// command or says why it cannot (HK-026). `isolate` — the focus is inside
// our own UI and the key is one ChatSpace would act on: ChatSpace does not
// get it, our UI does. `pass` — somebody else's key: nothing is touched.

import { type OverlaySurface } from '@cg/contracts/vm';

import { type DispatcherCommandId } from './keymap';
import { type KeyVerdict } from './resolver';

/** Where the focus is, as far as keys care. */
export const FOCUS_KINDS = [
  /** A text field inside one of our closed roots (search, a preview draft, the Coach question). */
  'ours-field',
  /** Anything else inside our roots: a card, a button, a list row. */
  'ours',
  /** ChatSpace's message field. */
  'composer',
  /** Any other field of the site. */
  'field',
  /** Nothing a person types into. */
  'page',
] as const;
export type FocusKind = (typeof FOCUS_KINDS)[number];

export type RouteKind = 'chat' | 'account' | 'other';

export interface KeyContext {
  /** IME composition (or keyCode 229): never ours. */
  readonly composing: boolean;
  /** A modal window of ChatSpace is open. */
  readonly nativeModal: boolean;
  readonly focus: FocusKind;
  /** `chat` — a chat is open; `account` — an account's list without a chat; `other` — the rest of ChatSpace. */
  readonly route: RouteKind;
  /**
   * Our open overlays, bottom first; a confirmation of ours counts as
   * `dialog`. The quick-jump popup is not listed: it lives only while ⌘/Ctrl
   * is held and never takes a key from anything.
   */
  readonly overlays: readonly OverlayKind[];
  /** A result, Recap or Review is open in the dock. */
  readonly dockSheet: boolean;
  /** The key is one ChatSpace's global listener would look at (`isComboLike`): ⌘/Ctrl/Alt held, or a named key. */
  readonly combo: boolean;
}

/** An overlay of ours as the policy sees it: the contract's surfaces plus our own confirmation dialog and the expanded result. */
export type OverlayKind = OverlaySurface | 'dialog' | 'result-expanded';

/** Why a claimed key runs nothing. */
export type KeyRefusal =
  /** HK-027: «сначала закройте открытое окно». */
  | 'overlay-open'
  /** ⌘⇧H: Help is removed (Б3). */
  | 'help-removed';

export type KeyDecision =
  | { readonly act: 'pass' }
  /** Ours. `run` null — claimed and nothing runs (auto-repeat, a swallowed habit, a refusal). */
  | { readonly act: 'claim'; readonly run: KeyCommand | null; readonly refusal: KeyRefusal | null; readonly command: DispatcherCommandId | null }
  /** Kept from ChatSpace, handed to our focused UI; `otherwise` runs if our UI did not take it. */
  | { readonly act: 'isolate'; readonly otherwise: KeyCommand | null };

export interface KeyCommand {
  readonly id: DispatcherCommandId;
  /** 1–9 with `quick-jump`. */
  readonly slot: number | null;
  /** Where the command goes: the open chat's dock or the preview on top. */
  readonly target: 'dock' | 'preview' | 'global';
}

const PASS: KeyDecision = { act: 'pass' };
const claim = (command: DispatcherCommandId | null, run: KeyCommand | null = null, refusal: KeyRefusal | null = null): KeyDecision => ({ act: 'claim', run, refusal, command });

/** The generation keys of a preview (HK-042): the same letters, the preview's own target. «Отправить» has no key at all. */
export const PREVIEW_COMMANDS: readonly DispatcherCommandId[] = ['reply', 'fix', 'hi', 'ping', 'cancel', 'tone', 'split'];
/** Works anywhere in ChatSpace, not only in an open chat. */
export const GLOBAL_COMMANDS: readonly DispatcherCommandId[] = ['spenders', 'palette', 'cheatsheet', 'settings'];
/** Need the chat list of an account: the open chat or the account's list. */
export const LIST_COMMANDS: readonly DispatcherCommandId[] = ['chat-next', 'chat-previous', 'next-unread', 'quick-jump'];
/**
 * Windows that cover the dock: a paid generation under them would run blind
 * (HK-027), so under them only their own toggles and Cancel work.
 */
export const COVERING_OVERLAYS: readonly OverlayKind[] = ['cheatsheet', 'spenders', 'newcomers', 'palette', 'dialog', 'result-expanded'];
/** What still runs under a covering window: the two reference windows and Cancel. */
export const UNDER_COVER_COMMANDS: readonly DispatcherCommandId[] = ['cheatsheet', 'spenders', 'cancel', 'close'];
/** Side panels next to the chat: the chat stays visible and usable, so they own no keys but their own. */
export const SIDE_PANELS: readonly OverlayKind[] = ['fan-panel', 'coach'];

const typing = (focus: FocusKind): boolean => focus === 'ours-field' || focus === 'composer' || focus === 'field';
const inOurs = (focus: FocusKind): boolean => focus === 'ours' || focus === 'ours-field';
const top = (overlays: readonly OverlayKind[]): OverlayKind | null => overlays[overlays.length - 1] ?? null;

/**
 * A key no command matched. Inside our UI everything ChatSpace's global
 * listener would look at is kept from it; plain typing passes untouched.
 */
export function decideUnmatched(context: Pick<KeyContext, 'composing' | 'focus' | 'combo'>): KeyDecision {
  if (context.composing) return PASS;
  if (inOurs(context.focus) && context.combo) return { act: 'isolate', otherwise: null };
  return PASS;
}

export function decideKey(verdict: KeyVerdict | null, context: KeyContext): KeyDecision {
  if (context.composing) return PASS;
  if (verdict === null) return decideUnmatched(context);

  const cover = top(context.overlays);
  const covered = cover !== null && COVERING_OVERLAYS.includes(cover);
  const inChat = context.route === 'chat';
  /** A window over the chat (anything but a side panel) is open. */
  const windowOpen = context.overlays.some((overlay) => !SIDE_PANELS.includes(overlay));
  /** Inside «the ChatGoose context»: an open chat, or one of our windows on screen. */
  const ourContext = inChat || context.overlays.length > 0;

  if (verdict.kind === 'swallow') return ourContext ? claim(null) : PASS;

  const id = verdict.command;
  const command = (target: KeyCommand['target']): KeyCommand => ({ id, slot: verdict.slot, target });
  /** Auto-repeat keeps the key ours and runs nothing again (HK-019). */
  const run = (target: KeyCommand['target']): KeyDecision => claim(id, verdict.repeat ? null : command(target));
  const refuse = (refusal: KeyRefusal): KeyDecision => claim(id, null, verdict.repeat ? null : refusal);

  // ── Esc: the top of ours first (HK-029) ──
  if (id === 'close') {
    if (context.nativeModal) return PASS;
    const ours = context.overlays.length > 0 || context.dockSheet;
    // Focus inside our UI: its own Esc first (a menu, a confirmation, a search); only then the window.
    if (inOurs(context.focus)) return { act: 'isolate', otherwise: ours && !verdict.repeat ? command('global') : null };
    return ours ? run('global') : PASS;
  }

  // ── keys without ⌘/Ctrl/Alt: J, K, `]`, `?` ──
  if (verdict.plain) {
    if (context.nativeModal || typing(context.focus)) return PASS;
    if (id === 'cheatsheet') return run('global');
    // Under a window of ours these letters belong to that window's own lists.
    if (windowOpen) return decideUnmatched(context);
    if (id === 'fan-panel') return inChat ? run('dock') : PASS;
    return context.route === 'other' ? PASS : run('global');
  }

  // ── a native modal window: our combinations stay ours in a chat, but run nothing ──
  if (context.nativeModal) return inChat && verdict.scheme ? refuse('overlay-open') : PASS;

  // ── chat navigation on ⌘/Ctrl/Alt: outside the composer and any field only (the table's «вне composer») ──
  if (LIST_COMMANDS.includes(id)) {
    if (typing(context.focus) || context.route === 'other') return decideUnmatched(context);
    return windowOpen ? refuse('overlay-open') : run('global');
  }

  if (GLOBAL_COMMANDS.includes(id)) {
    if (covered && !UNDER_COVER_COMMANDS.includes(id) && cover !== id) return refuse('overlay-open');
    return run('global');
  }

  if (id === 'cancel') {
    if (!ourContext) return PASS;
    return run(cover === 'preview' ? 'preview' : 'dock');
  }

  // ── the scheme's chat commands: Reply, Fix, Hi, Ping, Recap, Review, Coach, Tone, Split, Help ──
  if (!ourContext) return PASS;
  if (id === 'help') return refuse('help-removed');
  if (cover === 'preview') return PREVIEW_COMMANDS.includes(id) ? run('preview') : refuse('overlay-open');
  if (covered) return refuse('overlay-open');
  if (!inChat) return PASS;
  // AI keys work in ChatSpace's own message field and in our UI, not in an arbitrary field of the site.
  if (context.focus === 'field') return claim(id);
  return run('dock');
}

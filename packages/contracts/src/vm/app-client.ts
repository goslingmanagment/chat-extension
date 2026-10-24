// AppClient — the UI's only way to data (architecture.md §10.2 п. 2). The
// UI reads snapshots, subscribes, and dispatches UiActions; it never touches
// browser.*, the network, storage, postMessage or ChatSpace's DOM. ui/kit's
// `useView(selector)` turns this into signals.

import { type CgCode, type CgErrorView, type SettingsSection } from '../errors';
import { type Uuid } from '../primitives';
import { type UiActionType, type UiAction } from './actions';
import { type CoachVM, type RecapPickerVM, type RecapViewVM } from './analysis';
import { type DockVM } from './dock';
import { type NewcomersVM } from './newcomers';
import { type DebugPromptVM, type JournalVM, type OptionsVM, type PopupVM } from './pages';
import { type CheatsheetVM, type FanPanelVM, type PaletteVM, type QuickJumpVM, type ToastsVM } from './panels';
import { type PreviewVM } from './preview';
import { type ViewName, type ViewSelector } from './selectors';
import { type SpendersBoardVM, type SpendersStatsVM } from './spenders';
import { type RunningOpVM, type VmViewState } from './view';
import { type TalkingVM } from './talking';
import { type VoiceVM } from './voice';

export interface ViewMap {
  readonly dock: DockVM;
  readonly 'recap.picker': RecapPickerVM;
  readonly 'recap.view': RecapViewVM;
  readonly coach: CoachVM;
  readonly 'spenders.board': SpendersBoardVM;
  readonly 'spenders.stats': SpendersStatsVM;
  readonly preview: PreviewVM;
  readonly newcomers: NewcomersVM;
  readonly 'fan-panel': FanPanelVM;
  readonly palette: PaletteVM;
  readonly 'quick-jump': QuickJumpVM;
  readonly cheatsheet: CheatsheetVM;
  readonly toasts: ToastsVM;
  readonly popup: PopupVM;
  readonly options: OptionsVM;
  readonly 'debug-prompt': DebugPromptVM;
  readonly journal: JournalVM;
  /** 1.47.0: the voice studio of the open chat (the dock's sheet of the Voice chip). */
  readonly voice: VoiceVM;
  /** Chat Memory week 1: «в разговоре» of every fan, by chat. */
  readonly talking: TalkingVM;
}

/** The view model of a selector; an options selector narrows to its section. */
export type ViewOf<S extends ViewSelector> = S extends { readonly of: 'options'; readonly section: infer X extends SettingsSection }
  ? OptionsVM<X>
  : ViewMap[S['of']];

/** Every view has every one of the seven states in its type; these are the ones its controller produces. */
export const VM_STATE_SUPPORT = {
  dock: ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  'recap.picker': ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  'recap.view': ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  coach: ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  'spenders.board': ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  'spenders.stats': ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  preview: ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  newcomers: ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  'fan-panel': ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  palette: ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  popup: ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  options: ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  'debug-prompt': ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  journal: ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  voice: ['loading', 'ready', 'empty', 'partial', 'error', 'forbidden', 'offline'],
  /** Marks or none: nothing to be offline or forbidden about — no capability, no marks. */
  talking: ['loading', 'ready'],
  /**
   * Host-only views: ChatSpace's cached chat list and the vendored key
   * scheme. Neither needs a hub right nor the hub at all, so they have no
   * `forbidden` and no `offline`; a broken host capability is `error`.
   */
  'quick-jump': ['loading', 'ready', 'empty', 'partial', 'error'],
  cheatsheet: ['loading', 'ready', 'partial', 'error'],
  /** Toasts are a queue: something on screen or nothing. */
  toasts: ['ready', 'empty'],
} as const satisfies Record<ViewName, readonly VmViewState[]>;

/** What happened to a dispatched action. */
export const RECEIPT_OUTCOMES = [
  /** Done synchronously or confirmed (a copy written, a preference saved with a revision). */
  'done',
  /** An operation or an attempt started; its progress comes through the views. */
  'started',
  /** A surface or a chat opened. */
  'opened',
  /** The insert needs the person's answer first (Б2): see ResultVM.confirm. */
  'needs-confirm',
  /** Nothing to do (the same result reopened, a toast already gone). */
  'noop',
] as const;
export type ReceiptOutcome = (typeof RECEIPT_OUTCOMES)[number];

export type ActionReceipt =
  | {
      readonly ok: true;
      readonly type: UiActionType;
      readonly outcome: ReceiptOutcome;
      readonly opId?: Uuid;
      readonly attemptId?: Uuid;
      /** SetPreference and the other settings writes: «Сохранено ✓» only with this (ST-013…ST-015). */
      readonly revision?: number;
    }
  | {
      readonly ok: false;
      readonly type: UiActionType;
      readonly code: CgCode;
      readonly error: CgErrorView;
      /** CG-OP-TAB-LIMIT / CG-OP-CHAT-BUSY: the running list for «Перейти» and «Отменить». */
      readonly running?: readonly RunningOpVM[];
    };

export interface AppClient {
  getSnapshot<S extends ViewSelector>(selector: S): Readonly<ViewOf<S>>;
  subscribe<S extends ViewSelector>(selector: S, listener: (view: Readonly<ViewOf<S>>) => void): () => void;
  dispatch(action: UiAction): Promise<ActionReceipt>;
}

// @cg/ui/newcomers — the «Новые» window (R15; architecture.md §10.1, ui-design §3.6, §4.17): the list of new, renewed
// and returning subscribers with the greeting status, and the card of the chosen fan with its greeting. A lazy surface
// of the overlay host: `newcomers` and `preview` (from `newcomers`) through AppClient.
//
// One window and one card on every site (X59, X60): the window (./window.tsx) and the card (./card.tsx) are the family's,
// a site gives its adapter — ChatSpace's here (./NewcomersWindow.tsx, its card from the hub's preview ./hub-card.tsx),
// Fansly's in ui/hosts/fansly/newcomers (its pass and the card the pass reads).

import { type StyleSource, type SurfaceDefinition } from '../kit';
import { MEDIA_PICKER_CSS } from '../spenders/preview/MediaPicker';
import { WINDOW_STYLES } from '../spenders/window';
import { NEWCOMERS_CARD_STYLES } from './card.css';
import { NEWCOMERS_FRAME_STYLES } from './frame.css';
import { NewcomersWindow } from './NewcomersWindow';

export { NewcomersWindow, firstActionable, HUB_SITE } from './NewcomersWindow';
export { NewcomersWindowOf, RefreshButton, nextDraft, type NewcomersSite } from './window';
export { CardHoldContext, CardOpen, GreetingEditor, GreetingState, NewcomerCard, NoCard, type CardHold, type EditorButton, type EditorSend, type GreetingModel, type NewcomerCardProps } from './card';
export {
  BatchFoot,
  CLOSE_NEWCOMERS,
  ListTabs,
  NewcomerAvatar,
  NewcomerRow,
  NewcomersFrame,
  PeriodMenu,
  PickAll,
  ROW_HEIGHTS,
  StatusMenu,
  periodText,
  rowKey,
  toggleBatchPick,
  useLoadMore,
  useNewcomerRows,
  useRowHeight,
  useTextSize,
  type BatchWords,
  type ListTab,
  type RowKey,
  type RowParts,
} from './frame';
export { CARD_FOLLOW_MS } from '../spenders/rowFocus';
export { NEWCOMERS_FRAME_STYLES } from './frame.css';
export { NEWCOMERS_CARD_STYLES } from './card.css';

/** ChatSpace's own: the media picker's toggle and its line in the card's bar (X53). */
export const NEWCOMERS_STYLES: StyleSource = { id: 'cg-newcomers', css: MEDIA_PICKER_CSS };

/** What `mountSurface('newcomers', root, deps)` mounts. */
export const newcomersSurface: SurfaceDefinition = { view: NewcomersWindow, styles: [WINDOW_STYLES, NEWCOMERS_FRAME_STYLES, NEWCOMERS_CARD_STYLES, NEWCOMERS_STYLES] };

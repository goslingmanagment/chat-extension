// @cg/ui/newcomers — the «Новые» window (R15; architecture.md §10.1, ui-design
// §3.6, §4.17): the list of new, renewed and returning subscribers with the
// greeting status, and the card — the preview pane of Spenders with Hi only.
// A lazy surface of the overlay host: `newcomers` and `preview` (from
// `newcomers`) through AppClient.
//
// The window's frame (./frame.tsx) is the family's on every site (X59, X60):
// a site whose list a pass checks draws its own window in it
// (ui/hosts/fansly/newcomers) with the same look and keys.

import { type StyleSource, type SurfaceDefinition } from '../kit';
import { PREVIEW_STYLES } from '../spenders/preview/Preview';
import { WINDOW_STYLES } from '../spenders/window';
import { NEWCOMERS_FRAME_STYLES } from './frame.css';
import { NEWCOMERS_CSS, NewcomersWindow } from './NewcomersWindow';

export { NewcomersWindow, firstActionable, greetingStart } from './NewcomersWindow';
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

export const NEWCOMERS_STYLES: StyleSource = { id: 'cg-newcomers', css: NEWCOMERS_CSS };

/** What `mountSurface('newcomers', root, deps)` mounts. */
export const newcomersSurface: SurfaceDefinition = { view: NewcomersWindow, styles: [WINDOW_STYLES, PREVIEW_STYLES, NEWCOMERS_FRAME_STYLES, NEWCOMERS_STYLES] };

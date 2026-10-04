// @cg/ui/spenders — the Spenders window (R15; architecture.md §10.1, ui-design
// §3.5, §4.13–§4.16): the board with shelves, the statistics, the fan preview
// with «Отправить» on every part. A lazy surface of the overlay host: it
// renders `spenders.board`, `spenders.stats` and `preview` (from `spenders`)
// and reaches data only through AppClient.

import { type StyleSource, type SurfaceDefinition } from '../kit';
import { PREVIEW_STYLES } from './preview/Preview';
import { SPENDERS_CSS, SpendersWindow } from './SpendersWindow';
import { WINDOW_STYLES } from './window';

export { SpendersWindow, SPENDERS_PAINT_MARKS } from './SpendersWindow';
export { Board, PERIOD_KEYS, type BoardHandle, type BoardProps } from './Board';
export { StatsColumn, StatsExpanded, formatPct, statsDayName, type StatsProps } from './Stats';
export { useRowFocus, type RowFocus } from './rowFocus';
export { BOARD_HEIGHTS, boardItemHeight, boardItems, edgeStop, fanCount, initialStop, isStop, nextStop, shelfLabel, type BoardItem } from './rows';
export { PREVIEW_STYLES, Preview, matchesHotkey, type PreviewProps } from './preview/Preview';
export { PreviewResult, type PreviewResultProps } from './preview/Result';
export { SendRow, codeLineParts, sendStateWords, type SendRowProps } from './preview/SendRow';
export { MiniStrip, generateAction, pingHint, type MiniStripProps } from './preview/MiniStrip';
export { Feed, type FeedProps } from './preview/Feed';
export { DataFooter, FilterChip, WINDOW_STYLES, WindowHeader, ageOrUnknown, coverageWord, isPlainKey, isTextEntry, timeOrUnknown, unknownMark, type WindowHeaderProps } from './window';

export const SPENDERS_STYLES: StyleSource = { id: 'cg-spenders', css: SPENDERS_CSS };

/** What `mountSurface('spenders', root, deps)` mounts. */
export const spendersSurface: SurfaceDefinition = { view: SpendersWindow, styles: [WINDOW_STYLES, PREVIEW_STYLES, SPENDERS_STYLES] };

// @cg/ui/dock/analysis — Recap of the dock sheet (ui-design §4.11, §9.1
// п. 3), a lazy part of the dock: it brings the Markdown renderer and is read
// far less often than a draft is written. The same view serves the
// «Развернуть ↗» window (`place: 'dialog'`). Review is a turn of Coach's
// dialog since 1.51.0 (overlays/coach): it shares the report's pieces here —
// the score, the blocks, «Копировать», the age — and their sheet.

import { type JSX } from 'preact';

import { type AnalysisProps, type LazyPart } from '../lazy-part';
import { RecapView } from './Recap';
import { ANALYSIS_STYLE } from './styles';

export function AnalysisView({ place, debugPart }: AnalysisProps): JSX.Element {
  return <RecapView place={place} {...(debugPart === undefined ? {} : { debugPart })} />;
}

export const analysisPart: LazyPart<AnalysisProps> = { view: AnalysisView, styles: [ANALYSIS_STYLE] };

export { RecapView } from './Recap';
export { Block, CopyAll, MadeAgo, Score, type BlockTone } from './shared';
export { ANALYSIS_CSS, ANALYSIS_STYLE } from './styles';

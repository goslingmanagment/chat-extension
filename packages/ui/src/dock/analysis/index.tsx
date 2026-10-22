// @cg/ui/dock/analysis — Recap and Review of the dock sheet (ui-design §4.11,
// §9.1 п. 3), a lazy part of the dock: they bring the Markdown renderer and
// are read far less often than a draft is written. The same view serves the
// «Развернуть ↗» window (`place: 'dialog'`).

import { type JSX } from 'preact';

import { type AnalysisProps, type LazyPart } from '../lazy-part';
import { RecapView } from './Recap';
import { ReviewView } from './Review';
import { ANALYSIS_STYLE } from './styles';

export function AnalysisView({ which, place, debugPart }: AnalysisProps): JSX.Element {
  const debug = debugPart === undefined ? {} : { debugPart };
  return which === 'recap' ? <RecapView place={place} {...debug} /> : <ReviewView place={place} {...debug} />;
}

export const analysisPart: LazyPart<AnalysisProps> = { view: AnalysisView, styles: [ANALYSIS_STYLE] };

export { RecapView } from './Recap';
export { MadeAgo } from './shared';
export { ReviewView } from './Review';
export { ANALYSIS_CSS, ANALYSIS_STYLE } from './styles';

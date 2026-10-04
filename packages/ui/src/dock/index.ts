// @cg/ui/dock — the dock above ChatSpace's composer (architecture.md §10.1,
// R14): the strip with the seven AI actions, Tone, Split, persona and quota;
// the result sheet with parts, Hi variants, Fix, the Б2 question, error cards,
// the refusal of a fourth generation and the status banners. Everything is
// drawn from the `dock` view model (plus `recap.*` and `review` for the
// analysis sheet) and asks for things only with UiActions. This is the first
// dock chunk (§11: ≤ 45 KiB gzip with Preact); Recap, Review and the debug
// footer load on first use (`./analysis`, `./debug`).

export { DockView, type DockViewProps } from './Dock';
export { createDockSurface, dockSurface, mountDockSurface } from './surface';
export { DOCK_CSS, DOCK_STYLE } from './styles';
export { DEFAULT_PARTS } from './lazy';
export { DebugSlot, preloadPart, useLazyPart, type AnalysisProps, type DebugProps, type DockParts, type LazyPart, type PartLoader } from './lazy-part';
export { Strip, type StripProps } from './Strip';
export { Sheet, type SheetProps } from './Sheet';
export { ResultContent, type ResultContentProps } from './Result';
export { ConfirmRow, Parts, Variants, confirms, useConfirmFocus, usePartActions, type ConfirmRowProps, type PartsScope } from './Parts';
export { FixBody, type FixBodyProps } from './Fix';
export { AgainButton, DraftLabel, Head, HideButton, Meta, type AgainButtonProps, type HeadProps } from './Head';
export { StreamText, useSteadyView, useStreamText, type StreamTextProps } from './Stream';
export { STREAM_KEY, actionOf, deepEqual, errorToneOf, featureKey, isCrowded, isRunning, metaTexts, quotaSlot, stripAction } from './model';

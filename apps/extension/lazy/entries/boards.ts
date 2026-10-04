// The Spenders board, «Новые» and the fan panel as controllers (R12): the
// views `spenders.board`, `spenders.stats`, `newcomers` and `fan-panel`, and
// what they share — the page context, the open-surface state, the chat
// navigator, the palette's online fans. Loaded with the first of those
// surfaces; the preview controller is its own entry (`boards-preview`).

export { Surfaces, createChatNavigator, createPageContext } from '@cg/core/application/boards';
export { createFanPanelController } from '@cg/core/application/fanpanel';
export { createNewcomersController } from '@cg/core/application/newcomers';
export { createPaletteDirectory } from '@cg/core/application/preview';
export { createSpendersController } from '@cg/core/application/spenders';

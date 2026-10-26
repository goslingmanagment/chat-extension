// The Spenders board, «Новые», «Рассылка» and the fan panel as controllers (R12): the views `spenders.board`,
// `spenders.stats`, `newcomers`, `outreach` and `fan-panel`, and what they share — the page context, the open-surface
// state, the chat navigator, the palette's online fans. Loaded with the first of those surfaces; the preview
// controller is its own entry (`boards-preview`).

export { Surfaces, createChatNavigator, createPageContext } from '@cg/core/application/boards';
export { createFanPanelController } from '@cg/core/application/fanpanel';
export { createNewcomersController } from '@cg/core/application/newcomers';
export { createPaletteDirectory } from '@cg/core/application/preview';
import type { HostPort } from '@cg/contracts/host';
import { createOnlineController as createOnline, type OnlineControllerDeps } from '@cg/core/application/online';
import { createOutreachController as create, type OutreachControllerDeps } from '@cg/core/application/outreach';
import { createSpendersController as createSpenders, type SpendersControllerDeps } from '@cg/core/application/spenders';

/** The board as the hub ranks it; ChatSpace has no missing-data source of its own. */
export const createSpendersController = (deps: SpendersControllerDeps & { readonly host: HostPort }) => createSpenders(deps);

/**
 * «Рассылка» on ChatSpace: each fan's version goes by the fan's card's own send (X8) with the outreach's vault media
 * (X53) or the fan's own — the controller has no send of its own here.
 */
export const createOutreachController = (deps: OutreachControllerDeps & { readonly host: HostPort }) => create(deps);

/**
 * «Онлайн» on ChatSpace: who is online is the hub's (OnlyFansAPI), ChatSpace's own dots say «в сети»; each fan's text
 * goes by the fan's card's own send (X8) — the controller has no send of its own here.
 */
export const createOnlineController = (deps: OnlineControllerDeps & { readonly host: HostPort }) => createOnline(deps);

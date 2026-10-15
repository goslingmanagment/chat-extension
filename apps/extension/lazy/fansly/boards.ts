// The boards of a Fansly tab (R20 P10a; docs/project-unite/architecture.md §3.1, §8.15): what the shared `boards`
// entry gives the tab's application — the page context, the open-surface state, the chat navigator, Spenders, the fan
// panel, the palette's directory — built again in Fansly's own lazy build, with Fansly's «Новые»: the pass of
// Fansly's background module (Б17), never the hub's list of ChatSpace, which this build does not carry. The tab's
// application calls it as it calls the shared entry (composition/tab/controllers.ts `startBoards`); the type below
// holds the two to one signature.

import type * as SharedBoards from '../entries/boards';
import { createFanslyNewcomersController } from '../../src/composition/tab/hosts/fansly/newcomers';

export { Surfaces, createChatNavigator, createPageContext } from '@cg/core/application/boards';
export { createFanPanelController } from '@cg/core/application/fanpanel';
export { createPaletteDirectory } from '@cg/core/application/preview';
export { createSpendersController } from '@cg/core/application/spenders';

export const createNewcomersController: typeof SharedBoards.createNewcomersController = (deps) => createFanslyNewcomersController(deps);

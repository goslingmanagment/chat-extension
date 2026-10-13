// The cheatsheet's view (architecture.md §10.2 CheatsheetVM; HK-032, HK-034,
// ST-120, ST-121): the ActionCatalog as groups and rows — the rows of the
// features this site has (the feature manifest's slice). It needs neither
// the hub nor a chat, so it never is `forbidden` or `offline`.

import type { FeatureSlice } from '@cg/contracts/features/types';
import { type ActionCatalog, type CheatsheetVM, type ViewSelector } from '@cg/contracts/vm';

import { cheatsheetView } from '../../domain/hotkeys';
import { type SurfaceController } from './ports';

export function createCheatsheetController(deps: { readonly catalog: ActionCatalog; readonly features?: FeatureSlice }): SurfaceController {
  // The catalog and the site's slice are fixed for the life of the tab: one view, built once.
  const view: CheatsheetVM = cheatsheetView(deps.catalog, deps.features);
  return {
    kinds: ['cheatsheet'],
    getSnapshot: (selector: ViewSelector) => (selector.of === 'cheatsheet' ? view : undefined),
    subscribe: () => () => undefined,
    // Opening and closing is the navigation controller's (`Navigate surface`).
    dispatch: () => null,
  };
}

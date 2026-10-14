// ChatSpace's profile for our interface (docs/project-unite/architecture.md §1.5; R20 F5): what the shared
// surfaces take from the site instead of ChatSpace's constants. The application's half of the ChatSpace adapter
// hands it to every mount of the tab (composition/tab/hosts/chatspace/app.ts), and the stand's galleries draw in it
// by default (`?host=chatspace`). Not in the early bundle: only the application imports it.
//
// It adds nothing to what ChatSpace showed before the profile existed: our hosts get the variant's name, and that
// is all — the palette is the page's own, the rules are the shared ones.

import type { HostUiProfile } from '@cg/contracts/vm';

export const CHATSPACE_UI: HostUiProfile = {
  // No palette: ChatSpace defines `--color-om-*` on its <html>, and they reach our hosts by inheritance — the kit's
  // tokens read them as they always did (ui/kit/tokens.ts). The scroll's «near the bottom» (100 px, host-kit keep-bottom.ts)
  // and the layers' stacking are the host's own start, not the interface's.
  dock: { variant: 'chatspace' },
  // No sheet: the dock's shared rules are ChatSpace's.
  phrases: {
    ru: { site: 'ChatSpace', onSite: 'в ChatSpace' },
    en: { site: 'ChatSpace', onSite: 'in ChatSpace' },
  },
};

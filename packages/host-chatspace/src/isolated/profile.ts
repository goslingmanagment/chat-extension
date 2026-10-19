// ChatSpace's profile for our interface (docs/project-unite/architecture.md §1.5; R20 F5): what the shared
// surfaces take from the site instead of ChatSpace's constants. The application's half of the ChatSpace adapter
// hands it to every mount of the tab (composition/tab/hosts/chatspace/app.ts), and the stand's galleries draw in it
// by default (`?host=chatspace`). Not in the early bundle: only the application imports it.
//
// The look is the family's on every site (the kit's palette and face, X60); ChatSpace gives its blue and its name. Our
// hosts get the variant's name, and the rules are the shared ones.

import type { HostUiProfile } from '@cg/contracts/vm';
import { CHATSPACE_PHRASES } from '@cg/core/domain/hosts/chatspace/i18n';

export const CHATSPACE_UI: HostUiProfile = {
  // No palette: ChatSpace defines its blue (the brand steps of `--color-om-*`) on its <html>, and it reaches our hosts by
  // inheritance — the kit's tokens read it for what reaches the fan (ui/kit/tokens.ts). The scroll's «near the bottom»
  // (100 px, host-kit keep-bottom.ts) and the layers' stacking are the host's own start, not the interface's.
  dock: { variant: 'chatspace' },
  // No sheet: the dock's shared rules are ChatSpace's.
  // What the shared texts say instead of a site's name: ChatSpace's text pack (R20 F9b), the tab's I18n port fills them.
  phrases: CHATSPACE_PHRASES,
};
